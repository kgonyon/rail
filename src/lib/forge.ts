import { ghExec } from './shell';
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

const MAX_OPEN_REVIEWS = 50;

/**
 * Parse JSON output from `gh pr list --json number,url`.
 * Returns valid entries only, caps output, and returns `null` on parse-level
 * failure so callers can surface an unknown review state.
 */
export function parseGhPrListJson(output: string): OpenReviewInfo[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const reviews: OpenReviewInfo[] = [];
  for (const entry of parsed) {
    const info = toOpenReviewInfo(entry);
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

export const githubForgeDriver: ForgeDriver = {
  reviewLabel: 'PR',
  reviewLabelPlural: 'PRs',
  unavailableWarning: 'gh CLI unavailable; PR counts will be skipped',
  isAvailable: isGhAvailable,
  getOpenReviews: getOpenGitHubReviews,
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
      return noneForgeDriver;
  }
}
