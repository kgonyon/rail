import { $ } from 'bun';
import consola from 'consola';
import { gitExec } from './shell';
export {
  __resetGhAvailableCache,
  isGhAvailable,
  parseGhPrListJson,
} from './forge';
import { listOpenGitHubReviews } from './forge';

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
}

export interface OpenPrInfo {
  number: number;
  url: string;
}

export type OpenPrsResult =
  | { state: 'unavailable' }
  | { state: 'error' }
  | { state: 'ok'; prs: OpenPrInfo[] };

export interface WorktreeStats {
  fileCount: number;
  stagedFiles: number;
  unstagedFiles: number;
  untrackedFiles: number;
  insertions: number;
  deletions: number;
  isDirty: boolean;
  commitsAhead: number;
  openPrs: OpenPrsResult;
}

export async function addWorktree(
  root: string,
  treePath: string,
  branchPrefix: string,
  feature: string,
  startPoint?: string,
): Promise<void> {
  const branch = `${branchPrefix}${feature}`;
  const branchExists = await checkBranchExists(root, branch);

  if (branchExists) {
    await $`git -C ${root} worktree add ${treePath} ${branch}`.quiet();
    return;
  }

  if (startPoint) {
    if (!isSafeRefName(startPoint)) {
      throw new Error(`Unsafe start-point ref: ${startPoint}`);
    }
    await $`git -C ${root} worktree add ${treePath} -b ${branch} ${startPoint}`.quiet();
    return;
  }

  await $`git -C ${root} worktree add ${treePath} -b ${branch}`.quiet();
}

async function checkBranchExists(root: string, branch: string): Promise<boolean> {
  try {
    await $`git -C ${root} rev-parse --verify ${branch}`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function removeWorktree(root: string, treePath: string): Promise<void> {
  await $`git -C ${root} worktree remove ${treePath} --force`.quiet();
}

export async function listWorktrees(root: string): Promise<WorktreeInfo[]> {
  const result = await $`git -C ${root} worktree list --porcelain`.quiet();
  return parsePorcelainOutput(result.text());
}

/** @internal */
export function parsePorcelainOutput(output: string): WorktreeInfo[] {
  const worktrees: WorktreeInfo[] = [];
  const blocks = output.trim().split('\n\n');

  for (const block of blocks) {
    const info = parseSingleBlock(block);
    if (info) worktrees.push(info);
  }

  return worktrees;
}

/** @internal */
export function parseSingleBlock(block: string): WorktreeInfo | null {
  const lines = block.trim().split('\n');
  let path = '';
  let head = '';
  let branch = '';

  for (const line of lines) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length);
    if (line.startsWith('HEAD ')) head = line.slice('HEAD '.length);
    if (line.startsWith('branch ')) branch = line.slice('branch '.length);
  }

  if (!path) return null;
  return { path, head, branch };
}

const STATUS_CODES = 'MADRCU';

/**
 * Bin `git status --porcelain` output into staged / unstaged / untracked counts.
 *
 * Rules:
 *   - `??` → untracked (counted toward total)
 *   - `!!` → ignored (skipped from all bins)
 *   - Otherwise XY: column 1 in `[MADRCU]` and not `?` → staged++; column 2 in `[MADRCU]` → unstaged++.
 *     A single file may count toward both.
 *   - `total` = unique files with any non-`!!` status.
 * @internal
 */
export function parsePorcelainStatusBreakdown(output: string): {
  staged: number;
  unstaged: number;
  untracked: number;
  total: number;
} {
  if (output.trim().length === 0) {
    return { staged: 0, unstaged: 0, untracked: 0, total: 0 };
  }

  const lines = output.replace(/\n+$/, '').split('\n');
  let staged = 0;
  let unstaged = 0;
  let untracked = 0;
  let total = 0;

  for (const line of lines) {
    if (line.length < 2) continue;
    const xy = line.slice(0, 2);
    if (xy === '!!') continue;
    if (xy === '??') {
      untracked++;
      total++;
      continue;
    }
    const x = xy[0];
    const y = xy[1];
    if (x !== '?' && STATUS_CODES.includes(x)) staged++;
    if (STATUS_CODES.includes(y)) unstaged++;
    total++;
  }

  return { staged, unstaged, untracked, total };
}

/**
 * Sum line insertions/deletions from `git diff HEAD --numstat` output.
 * Binary files (`-\t-\tfilename`) are skipped.
 * @internal
 */
export function parseNumstatOutput(output: string): {
  insertions: number;
  deletions: number;
} {
  const trimmed = output.trim();
  if (trimmed.length === 0) return { insertions: 0, deletions: 0 };

  const lines = trimmed.split('\n');
  let insertions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    if (parts[0] === '-' && parts[1] === '-') continue;
    const ins = Number.parseInt(parts[0], 10);
    const del = Number.parseInt(parts[1], 10);
    if (Number.isNaN(ins) || Number.isNaN(del)) continue;
    insertions += ins;
    deletions += del;
  }

  return { insertions, deletions };
}

const REF_NAME_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const REF_NAME_MAX_LENGTH = 255;

/**
 * Defense-in-depth: validate a git ref name (branch / default branch) before
 * interpolating it into a shell command. Accepts only chars safe for refs:
 * letters, digits, dot, underscore, hyphen, slash. Rejects empty, oversized,
 * or shell-metacharacter-bearing input.
 */
export function isSafeRefName(name: string): boolean {
  if (!name || name.length > REF_NAME_MAX_LENGTH) return false;
  return REF_NAME_PATTERN.test(name);
}

/**
 * Parse `git rev-list --count` output (a single integer line).
 * Returns 0 for empty / non-numeric input.
 * @internal
 */
export function parseRevListCount(output: string): number {
  const trimmed = output.trim();
  if (trimmed.length === 0) return 0;
  const n = Number.parseInt(trimmed, 10);
  return Number.isNaN(n) ? 0 : n;
}

const CLEAN_STATS: WorktreeStats = {
  fileCount: 0,
  stagedFiles: 0,
  unstagedFiles: 0,
  untrackedFiles: 0,
  insertions: 0,
  deletions: 0,
  isDirty: false,
  commitsAhead: 0,
  openPrs: { state: 'ok', prs: [] },
};

const DEFAULT_BRANCH_FALLBACK = 'main';
const ORIGIN_HEAD_PREFIX = 'refs/remotes/origin/';
/**
 * Compatibility wrapper for GitHub PR lookup. New status code goes through the
 * forge driver, but Git status tests and older internals still exercise this
 * bounded parser path directly.
 */
export async function getOpenPrs(
  treePath: string,
  branch: string,
): Promise<OpenPrsResult> {
  const result = await listOpenGitHubReviews(treePath, branch);
  if (result.state !== 'ok') return result;
  return { state: 'ok', prs: result.reviews };
}

/**
 * Resolve the repository's default branch via `git symbolic-ref refs/remotes/origin/HEAD`.
 * Returns the trailing path segment (e.g. `main`, `master`).
 * Falls back to `'main'` on subprocess failure.
 */
export async function getDefaultBranch(root: string): Promise<string> {
  try {
    const output = await gitExec(root, 'symbolic-ref refs/remotes/origin/HEAD');
    const ref = output.trim();
    if (!ref.startsWith(ORIGIN_HEAD_PREFIX)) return DEFAULT_BRANCH_FALLBACK;
    const segment = ref.slice(ORIGIN_HEAD_PREFIX.length);
    if (!isSafeRefName(segment)) return DEFAULT_BRANCH_FALLBACK;
    return segment;
  } catch {
    return DEFAULT_BRANCH_FALLBACK;
  }
}

export async function refreshFromOrigin(root: string, parentRef?: string): Promise<void> {
  const branch = parentRef ?? await getDefaultBranch(root);
  if (!isSafeRefName(branch)) {
    throw new Error(`Unsafe parent ref: ${branch}`);
  }
  const { isDirty } = await getWorktreeStats(root, {
    defaultBranch: branch,
    branch,
  });
  if (isDirty) {
    throw new Error(
      'Uncommitted changes detected. Commit or stash them before refreshing.',
    );
  }

  consola.start(`Pulling origin/${branch}...`);

  let output: string;
  try {
    output = (await gitExec(root, `pull --ff-only origin ${branch}`)).trim();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fast-forward ${branch} from origin/${branch}. ` +
        `Your local ${branch} likely has commits not on origin — investigate ` +
        `and reset it to origin/${branch} before retrying.` +
        (detail ? `\n\n${detail}` : ''),
    );
  }

  if (output) {
    consola.info(output);
  }

  consola.success(`Pulled latest from origin/${branch}`);
}

/**
 * Fetch the parent ref from origin without touching any working tree.
 * Returns the parent ref so callers can create features from the configured
 * parent. Safe to run with uncommitted changes in the main repo.
 */
export async function fetchFromOrigin(root: string, parentRef?: string): Promise<string> {
  const branch = parentRef ?? await getDefaultBranch(root);
  if (!isSafeRefName(branch)) {
    throw new Error(`Unsafe parent ref: ${branch}`);
  }

  const originBranch = branch.startsWith('origin/') ? branch.slice('origin/'.length) : branch;

  consola.start(`Fetching origin/${originBranch}...`);
  await $`git -C ${root} fetch origin ${originBranch}`.quiet();
  consola.success(`Fetched origin/${originBranch}`);

  return branch;
}

export interface WorktreeStatsOptions {
  defaultBranch: string;
  branch: string;
}

const COMMITS_AHEAD_FAILURE = -1;

export async function getWorktreeStats(
  treePath: string,
  options: WorktreeStatsOptions,
): Promise<WorktreeStats> {
  let porcelainOutput: string;
  try {
    porcelainOutput = await gitExec(treePath, 'status --porcelain');
  } catch {
    return { ...CLEAN_STATS, openPrs: { state: 'unavailable' } };
  }

  const breakdown = parsePorcelainStatusBreakdown(porcelainOutput);
  const isDirty = breakdown.total > 0;
  const commitsAhead = await fetchCommitsAhead(treePath, options);
  const openPrs: OpenPrsResult = { state: 'unavailable' };

  if (!isDirty) {
    return { ...CLEAN_STATS, commitsAhead, openPrs };
  }

  const { insertions, deletions } = await fetchNumstat(treePath);
  return {
    fileCount: breakdown.total,
    stagedFiles: breakdown.staged,
    unstagedFiles: breakdown.unstaged,
    untrackedFiles: breakdown.untracked,
    insertions,
    deletions,
    isDirty,
    commitsAhead,
    openPrs,
  };
}

async function fetchCommitsAhead(
  treePath: string,
  options: WorktreeStatsOptions,
): Promise<number> {
  const { defaultBranch, branch } = options;
  const normalizedBranch = branch.replace('refs/heads/', '');
  if (normalizedBranch === defaultBranch) return 0;
  if (!isSafeRefName(defaultBranch) || !isSafeRefName(normalizedBranch)) {
    return COMMITS_AHEAD_FAILURE;
  }

  try {
    const out = await gitExec(
      treePath,
      `rev-list --count origin/${defaultBranch}..HEAD`,
    );
    return parseRevListCount(out);
  } catch {
    return COMMITS_AHEAD_FAILURE;
  }
}

async function fetchNumstat(treePath: string): Promise<{
  insertions: number;
  deletions: number;
}> {
  try {
    const numstatOutput = await gitExec(treePath, 'diff HEAD --numstat');
    return parseNumstatOutput(numstatOutput);
  } catch {
    return { insertions: 0, deletions: 0 };
  }
}
