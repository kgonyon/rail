import { rm } from 'fs/promises';
import consola from 'consola';
import { basename } from 'path';
import { isSafeParentRefName, validateFeatureName } from './config';
import { jjExec } from './shell';
import type { WorktreeInfo, WorktreeStats } from './git';

interface JjOperationsDependencies {
  jjExec: typeof jjExec;
  rm: typeof rm;
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

export async function refreshJjParent(root: string, parentRef: string): Promise<void> {
  return createJjOperations().refreshJjParent(root, parentRef);
}

export async function fetchJjParent(root: string, parentRef: string): Promise<string> {
  return createJjOperations().fetchJjParent(root, parentRef);
}

export async function addJjWorkspace(
  root: string,
  treePath: string,
  bookmarkPrefix: string,
  feature: string,
  parentRef?: string,
): Promise<void> {
  return createJjOperations().addJjWorkspace(root, treePath, bookmarkPrefix, feature, parentRef);
}

export async function removeJjWorkspace(root: string, treePath: string, feature: string): Promise<void> {
  return createJjOperations().removeJjWorkspace(root, treePath, feature);
}

export async function listJjWorkspaces(root: string): Promise<WorktreeInfo[]> {
  return createJjOperations().listJjWorkspaces(root);
}

export async function getJjWorkspaceStats(path: string): Promise<WorktreeStats> {
  return createJjOperations().getJjWorkspaceStats(path);
}

/** @internal */
export function createJjOperations(deps: JjOperationsDependencies = { jjExec, rm }) {
  return {
    async refreshJjParent(root: string, parentRef: string): Promise<void> {
      validateJjRef(parentRef, 'parent ref');

      const remote = parseRemoteBookmark(parentRef);
      if (remote) {
        consola.start(`Fetching ${remote.bookmark}@${remote.remote}...`);
        await deps.jjExec(root, `git fetch --remote ${remote.remote} --bookmark ${remote.bookmark}`);
        consola.success(`Fetched ${remote.bookmark}@${remote.remote}`);
        return;
      }

      consola.start('Fetching JJ remotes...');
      await deps.jjExec(root, 'git fetch');
      consola.success('Fetched JJ remotes');
    },

    async fetchJjParent(_root: string, parentRef: string): Promise<string> {
      validateJjRef(parentRef, 'parent ref');
      return parentRef;
    },

    async addJjWorkspace(
      root: string,
      treePath: string,
      bookmarkPrefix: string,
      feature: string,
      parentRef?: string,
    ): Promise<void> {
      const parent = parentRef ?? '@';
      const bookmark = `${bookmarkPrefix}${feature}`;
      validateFeatureName(feature);
      validateJjRef(parent, 'parent ref');
      validateJjRef(bookmark, 'bookmark');

      await deps.jjExec(root, `workspace add --name ${feature} --revision ${parent} ${shellQuote(treePath)}`);

      try {
        await deps.jjExec(treePath, `bookmark create ${bookmark} --revision @`);
      } catch {
        await deps.jjExec(treePath, `bookmark set ${bookmark} --revision @`);
      }
    },

    async removeJjWorkspace(root: string, treePath: string, feature: string): Promise<void> {
      validateFeatureName(feature);
      try {
        await deps.jjExec(root, `workspace forget ${feature}`);
      } catch {
        await deps.rm(treePath, { force: true, recursive: true });
      }
    },

    async listJjWorkspaces(root: string): Promise<WorktreeInfo[]> {
      const output = await deps.jjExec(root, 'workspace list');
      return parseJjWorkspaceList(output);
    },

    async getJjWorkspaceStats(path: string): Promise<WorktreeStats> {
      try {
        const output = await deps.jjExec(path, 'diff --stat');
        const isDirty = output.trim().length > 0;
        return { ...CLEAN_STATS, isDirty, localState: isDirty ? 'changed' : 'clean' };
      } catch {
        return { ...CLEAN_STATS, localState: 'unknown', openPrs: { state: 'unavailable' } };
      }
    },
  };
}

/** @internal */
export function parseJjWorkspaceList(output: string): WorktreeInfo[] {
  return output
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseJjWorkspaceLine)
    .filter((workspace) => workspace.path.length > 0);
}

function parseJjWorkspaceLine(line: string): WorktreeInfo {
  const separator = line.indexOf(':');
  if (separator === -1) return emptyWorkspace();

  const workspaceName = line.slice(0, separator).trim();
  const rest = line.slice(separator + 1).trim();
  if (!workspaceName || !rest) return emptyWorkspace();

  const tokens = rest.split(/\s+/);
  let pathIndex = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i]!.includes('/')) {
      pathIndex = i;
      break;
    }
  }
  const path = pathIndex === -1 ? rest : tokens[pathIndex]!;
  const label = findBookmarkLabel(tokens.slice(0, pathIndex === -1 ? 0 : pathIndex)) ?? workspaceName;
  return {
    path,
    head: label,
    branch: label,
    feature: basename(path),
    displayLabel: label,
    refLabel: 'Bookmark',
  };
}

function findBookmarkLabel(tokens: string[]): string | null {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const label = normalizeBookmarkToken(tokens[i]!);
    if (label) return label;
  }
  return null;
}

function normalizeBookmarkToken(token: string): string | null {
  const cleaned = token.replace(/[*,]+$/g, '');
  if (!cleaned || cleaned.includes('@')) return null;
  if (/^[0-9a-f]{6,}$/i.test(cleaned)) return null;
  return cleaned;
}

function emptyWorkspace(): WorktreeInfo {
  return { path: '', head: '', branch: '' };
}

function parseRemoteBookmark(ref: string): { bookmark: string; remote: string } | null {
  const atIndex = ref.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === ref.length - 1) return null;
  return {
    bookmark: ref.slice(0, atIndex),
    remote: ref.slice(atIndex + 1),
  };
}

function validateJjRef(ref: string, label: string): void {
  if (!isSafeParentRefName(ref)) {
    throw new Error(`Unsafe JJ ${label}: ${ref}`);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
