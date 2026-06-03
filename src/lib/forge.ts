import { ghExec, glabExec } from './shell';
import type { RailConfig } from '../types/config';

export interface OpenReviewInfo {
  number: number;
  url: string;
}

export type OpenReviewsResult =
  | { state: 'unavailable' }
  | { state: 'error' }
  | { state: 'ok'; reviews: OpenReviewInfo[] };

export interface ForgeDriver {
  reviewLabel: string;
  reviewLabelPlural: string;
  unavailableWarning?: string;
  isAvailable?(): Promise<boolean>;
  getOpenReviews(treePath: string, headName: string): Promise<OpenReviewsResult>;
}

let ghAvailableCache: boolean | null = null;
let glabAvailableCache: boolean | null = null;

/**
 * Probe `gh auth status` once per process to determine if `gh` is installed and
 * authenticated. Subsequent calls return the cached boolean.
 */
export async function isGhAvailable(): Promise<boolean> {
  if (ghAvailableCache !== null) return ghAvailableCache;
  try {
    await ghExec(process.cwd(), 'auth status');
    ghAvailableCache = true;
  } catch {
    ghAvailableCache = false;
  }
  return ghAvailableCache;
}

/** Reset the cached `gh` availability — for tests only. */
export function __resetGhAvailableCache(): void {
  ghAvailableCache = null;
}

/**
 * Probe `glab auth status` once per process to determine if `glab` is installed
 * and authenticated. Subsequent calls return the cached boolean.
 */
export async function isGlabAvailable(): Promise<boolean> {
  if (glabAvailableCache !== null) return glabAvailableCache;
  try {
    await glabExec(process.cwd(), 'auth status');
    glabAvailableCache = true;
  } catch {
    glabAvailableCache = false;
  }
  return glabAvailableCache;
}

/** Reset the cached `glab` availability — for tests only. */
export function __resetGlabAvailableCache(): void {
  glabAvailableCache = null;
}

const MAX_OPEN_REVIEWS = 50;

/**
 * Parse JSON output from `gh pr list --json number,url`.
 * Returns valid entries only, caps output, and returns `null` on parse-level
 * failure so callers can surface an unknown review state.
 */
export function parseGhPrListJson(output: string): OpenReviewInfo[] | null {
  return parseReviewListJson(output, toOpenReviewInfo);
}

/**
 * Parse JSON output from `glab mr list --output json`.
 * Returns valid entries only, caps output, and returns `null` on parse-level
 * failure so callers can surface an unknown review state.
 */
export function parseGlabMrListJson(output: string): OpenReviewInfo[] | null {
  return parseReviewListJson(output, toOpenGitLabReviewInfo);
}

function parseReviewListJson(
  output: string,
  convert: (entry: unknown) => OpenReviewInfo | null,
): OpenReviewInfo[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const reviews: OpenReviewInfo[] = [];
  for (const entry of parsed) {
    const info = convert(entry);
    if (info !== null) reviews.push(info);
  }
  return reviews.slice(0, MAX_OPEN_REVIEWS);
}

const URL_MAX_LENGTH = 2048;
const URL_PREFIX = 'https://';

function isSafeReviewUrl(url: string): boolean {
  if (url.length === 0 || url.length > URL_MAX_LENGTH) return false;
  if (!url.startsWith(URL_PREFIX)) return false;
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

function toOpenReviewInfo(entry: unknown): OpenReviewInfo | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const num = record.number;
  const url = record.url;
  if (typeof num !== 'number' || !Number.isInteger(num) || num <= 0) return null;
  if (typeof url !== 'string' || !isSafeReviewUrl(url)) return null;
  return { number: num, url };
}

function toOpenGitLabReviewInfo(entry: unknown): OpenReviewInfo | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  if (!isOpenGitLabReviewState(record.state)) return null;
  const num = record.iid;
  const url = record.web_url ?? record.webUrl ?? record.url;
  if (typeof num !== 'number' || !Number.isInteger(num) || num <= 0) return null;
  if (typeof url !== 'string' || !isSafeReviewUrl(url)) return null;
  return { number: num, url };
}

function isOpenGitLabReviewState(state: unknown): boolean {
  if (state === undefined) return true;
  return state === 'opened' || state === 'open';
}

const REF_NAME_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const REF_NAME_MAX_LENGTH = 255;
const REFS_HEADS_PREFIX = 'refs/heads/';

function isSafeHeadName(name: string): boolean {
  if (!name || name.length > REF_NAME_MAX_LENGTH) return false;
  return REF_NAME_PATTERN.test(name);
}

function normalizeHeadName(headName: string): string | null {
  const normalized = headName.startsWith(REFS_HEADS_PREFIX)
    ? headName.slice(REFS_HEADS_PREFIX.length)
    : headName;
  return isSafeHeadName(normalized) ? normalized : null;
}

/**
 * List open GitHub PRs whose HEAD is `headName` via `gh pr list`.
 */
export async function getOpenGitHubReviews(
  treePath: string,
  headName: string,
): Promise<OpenReviewsResult> {
  if (normalizeHeadName(headName) === null) return { state: 'error' };
  if (!await isGhAvailable()) return { state: 'unavailable' };
  return listOpenGitHubReviews(treePath, headName);
}

/**
 * List open GitLab MRs whose source branch is `headName` via `glab mr list`.
 */
export async function getOpenGitLabReviews(
  treePath: string,
  headName: string,
): Promise<OpenReviewsResult> {
  if (normalizeHeadName(headName) === null) return { state: 'error' };
  if (!await isGlabAvailable()) return { state: 'unavailable' };
  return listOpenGitLabReviews(treePath, headName);
}

/** @internal */
export async function listOpenGitHubReviews(
  treePath: string,
  headName: string,
): Promise<OpenReviewsResult> {
  const normalized = normalizeHeadName(headName);
  if (normalized === null) return { state: 'error' };
  try {
    const out = await ghExec(
      treePath,
      `pr list --head ${normalized} --state open --json number,url`,
    );
    const reviews = parseGhPrListJson(out);
    if (reviews === null) return { state: 'error' };
    return { state: 'ok', reviews };
  } catch {
    return { state: 'error' };
  }
}

/** @internal */
export async function listOpenGitLabReviews(
  treePath: string,
  headName: string,
): Promise<OpenReviewsResult> {
  const normalized = normalizeHeadName(headName);
  if (normalized === null) return { state: 'error' };
  try {
    const out = await glabExec(
      treePath,
      `mr list --source-branch ${normalized} --output json`,
    );
    const reviews = parseGlabMrListJson(out);
    if (reviews === null) return { state: 'error' };
    return { state: 'ok', reviews };
  } catch {
    return { state: 'error' };
  }
}

export const githubForgeDriver: ForgeDriver = {
  reviewLabel: 'PR',
  reviewLabelPlural: 'PRs',
  unavailableWarning: 'gh CLI unavailable; PR counts will be skipped',
  isAvailable: isGhAvailable,
  getOpenReviews: getOpenGitHubReviews,
};

export const gitlabForgeDriver: ForgeDriver = {
  reviewLabel: 'MR',
  reviewLabelPlural: 'MRs',
  unavailableWarning: 'glab CLI unavailable; MR counts will be skipped',
  isAvailable: isGlabAvailable,
  getOpenReviews: getOpenGitLabReviews,
};

export const noneForgeDriver: ForgeDriver = {
  reviewLabel: 'PR',
  reviewLabelPlural: 'PRs',
  getOpenReviews() {
    return Promise.resolve({ state: 'unavailable' });
  },
};

export function getForgeDriver(forge: RailConfig['forge']): ForgeDriver {
  switch (forge) {
    case 'github':
      return githubForgeDriver;
    case 'none':
      return noneForgeDriver;
    case 'gitlab':
      return gitlabForgeDriver;
  }
}
