import { $ } from 'bun';
import consola from 'consola';
import { gitExec } from './shell';

export interface WorktreeInfo {
  path: string;
  head: string;
  branch: string;
}

export interface WorktreeStats {
  fileCount: number;
  insertions: number;
  deletions: number;
  isDirty: boolean;
}

export async function addWorktree(
  root: string,
  treePath: string,
  branchPrefix: string,
  feature: string,
): Promise<void> {
  const branch = `${branchPrefix}${feature}`;
  const branchExists = await checkBranchExists(root, branch);

  if (branchExists) {
    await $`git -C ${root} worktree add ${treePath} ${branch}`.quiet();
  } else {
    await $`git -C ${root} worktree add ${treePath} -b ${branch}`.quiet();
  }
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

/**
 * Count unique files from `git status --porcelain` output.
 * Each non-empty line is one file. Ignored files (`!!`) are skipped.
 * @internal
 */
export function parsePorcelainFileCount(output: string): number {
  const trimmed = output.trim();
  if (trimmed.length === 0) return 0;

  const lines = trimmed.split('\n');
  let count = 0;

  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const xy = line.slice(0, 2);
    if (xy === '!!') continue;
    count++;
  }

  return count;
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

const CLEAN_STATS: WorktreeStats = {
  fileCount: 0,
  insertions: 0,
  deletions: 0,
  isDirty: false,
};

export async function detectDefaultBranch(root: string): Promise<string> {
  try {
    const result = await $`git -C ${root} symbolic-ref refs/remotes/origin/HEAD`.quiet();
    const ref = result.text().trim();
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    return 'main';
  }
}

export async function refreshFromOrigin(root: string): Promise<void> {
  const { isDirty } = await getWorktreeStats(root);
  if (isDirty) {
    throw new Error(
      'Uncommitted changes detected. Commit or stash them before refreshing.',
    );
  }

  const branch = await detectDefaultBranch(root);

  consola.start(`Pulling origin/${branch}...`);

  const result = await $`git -C ${root} pull origin ${branch}`.quiet();
  const output = result.text().trim();

  if (output) {
    consola.info(output);
  }

  consola.success(`Pulled latest from origin/${branch}`);
}

export async function getWorktreeStats(treePath: string): Promise<WorktreeStats> {
  let porcelainOutput: string;
  try {
    porcelainOutput = await gitExec(treePath, 'status --porcelain');
  } catch {
    return { ...CLEAN_STATS };
  }

  const fileCount = parsePorcelainFileCount(porcelainOutput);
  const isDirty = fileCount > 0;

  if (!isDirty) return { ...CLEAN_STATS };

  let numstatOutput: string;
  try {
    numstatOutput = await gitExec(treePath, 'diff HEAD --numstat');
  } catch {
    return { fileCount, insertions: 0, deletions: 0, isDirty };
  }

  const { insertions, deletions } = parseNumstatOutput(numstatOutput);
  return { fileCount, insertions, deletions, isDirty };
}
