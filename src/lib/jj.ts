import consola from 'consola';
import { basename } from 'path';
import { isSafeParentRefName, validateFeatureName } from './config';
import { getFeatureDirName, getFeatureNameFromDirName } from './paths';
import { jjExec } from './shell';
import type { WorktreeInfo, WorktreeStats } from './git';

interface JjOperationsDependencies {
  jjExec: typeof jjExec;
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

const JJ_WORKSPACE_LIST_TEMPLATE =
  'self.name() ++ "\\t" ++ self.root() ++ "\\t" ++ ' +
  'self.target().local_bookmarks().map(|b| b.name()).join(",") ++ "\\n"';

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

export async function deleteJjBookmark(root: string, bookmark: string): Promise<void> {
  return createJjOperations().deleteJjBookmark(root, bookmark);
}

export async function jjBookmarkExists(root: string, bookmark: string): Promise<boolean> {
  return createJjOperations().jjBookmarkExists(root, bookmark);
}

export async function listJjWorkspaces(root: string): Promise<WorktreeInfo[]> {
  return createJjOperations().listJjWorkspaces(root);
}

export async function getJjWorkspaceStats(path: string, parentRef = 'main@origin'): Promise<WorktreeStats> {
  return createJjOperations().getJjWorkspaceStats(path, parentRef);
}

/** @internal */
export function createJjOperations(deps: JjOperationsDependencies = { jjExec }) {
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
      const workspaceName = getFeatureDirName(feature);
      validateFeatureName(feature);
      validateJjRef(parent, 'parent ref');
      validateJjRef(bookmark, 'bookmark');

      if (await hasJjBookmark(root, bookmark)) {
        throw new Error(`JJ bookmark already exists: ${bookmark}`);
      }

      await deps.jjExec(
        root,
        `workspace add --name ${workspaceName} --revision ${parent} ${shellQuote(treePath)}`,
      );
      await deps.jjExec(treePath, `bookmark create ${bookmark} --revision @`);
    },

    async removeJjWorkspace(root: string, _treePath: string, feature: string): Promise<void> {
      validateFeatureName(feature);
      const workspaceName = getFeatureDirName(feature);
      await deps.jjExec(root, `workspace forget -- ${workspaceName}`);
    },

    async deleteJjBookmark(root: string, bookmark: string): Promise<void> {
      validateJjRef(bookmark, 'bookmark');
      await deps.jjExec(root, `bookmark delete -- ${bookmark}`);
    },

    async jjBookmarkExists(root: string, bookmark: string): Promise<boolean> {
      validateJjRef(bookmark, 'bookmark');
      return hasJjBookmark(root, bookmark);
    },

    async listJjWorkspaces(root: string): Promise<WorktreeInfo[]> {
      const output = await deps.jjExec(
        root,
        `workspace list --template ${shellQuote(JJ_WORKSPACE_LIST_TEMPLATE)}`,
      );
      return parseJjWorkspaceList(output);
    },

    async getJjWorkspaceStats(path: string, parentRef = 'main@origin'): Promise<WorktreeStats> {
      validateJjRef(parentRef, 'parent ref');

      try {
        const statOutput = await deps.jjExec(path, buildDiffStatCommand(parentRef));
        const revisionsOutput = await deps.jjExec(path, buildRevisionCountCommand(parentRef));
        const diffStats = parseJjDiffStatOutput(statOutput);
        const revisions = parseJjRevisionCount(revisionsOutput);
        const isDirty = diffStats.fileCount > 0 || revisions > 0;

        if (!isDirty) {
          return { ...CLEAN_STATS, localState: 'clean' };
        }

        // All content @ introduces may already be in parentRef (e.g. squash merge).
        // If parent→@ has no insertions, @ has nothing parent doesn't → clean.
        const parentDiffOutput = await deps.jjExec(path, buildParentDiffCommand(parentRef));
        const parentDiffStats = parseJjDiffStatOutput(parentDiffOutput);
        if (parentDiffStats.insertions === 0) {
          return { ...CLEAN_STATS, localState: 'clean' };
        }

        return {
          ...CLEAN_STATS,
          fileCount: diffStats.fileCount,
          stagedFiles: diffStats.fileCount,
          insertions: diffStats.insertions,
          deletions: diffStats.deletions,
          isDirty: true,
          commitsAhead: revisions,
          localState: 'changed',
        };
      } catch {
        return { ...CLEAN_STATS, localState: 'unknown', openPrs: { state: 'unavailable' } };
      }
    },
  };

  async function hasJjBookmark(root: string, bookmark: string): Promise<boolean> {
    const output = await deps.jjExec(root, `bookmark list ${bookmark}`);
    return output.split('\n').some((line) => line.startsWith(`${bookmark}:`));
  }
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
  if (line.includes('\t')) return parseTemplatedJjWorkspaceLine(line);

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
  if (pathIndex === -1) return emptyWorkspace();

  const path = tokens[pathIndex]!;
  const label = findBookmarkLabel(tokens.slice(0, pathIndex)) ?? workspaceName;
  return {
    path,
    head: label,
    branch: label,
    feature: getFeatureNameFromDirName(basename(path)),
    displayLabel: label,
    refLabel: 'Bookmark',
  };
}

function parseTemplatedJjWorkspaceLine(line: string): WorktreeInfo {
  const [workspaceName, path, bookmarkList = ''] = line.split('\t');
  const label = firstBookmark(bookmarkList) ?? workspaceName;
  if (!workspaceName || !path || !label) return emptyWorkspace();

  return {
    path,
    head: label,
    branch: label,
    feature: getFeatureNameFromDirName(basename(path)),
    displayLabel: label,
    refLabel: 'Bookmark',
  };
}

function firstBookmark(bookmarkList: string): string | null {
  const bookmark = bookmarkList.split(',').find((item) => item.trim().length > 0);
  return bookmark?.trim() ?? null;
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

function buildRevisionCountCommand(parentRef: string): string {
  return `log -r ${shellQuote(buildUnmergedChangesRevset(parentRef))} --count`;
}

function buildDiffStatCommand(parentRef: string): string {
  const mergeBase = `latest(::@ & ::${parentRef})`;
  return `diff --from ${shellQuote(mergeBase)} --to @ --stat`;
}

function buildParentDiffCommand(parentRef: string): string {
  return `diff --from ${shellQuote(parentRef)} --to @ --stat`;
}

function buildUnmergedChangesRevset(parentRef: string): string {
  const revset = `((ancestors(@) ~ ancestors(${parentRef})) ~ empty())`;
  return revset;
}

/** @internal */
export function parseJjDiffStatOutput(output: string): {
  fileCount: number;
  insertions: number;
  deletions: number;
} {
  const summary = output.trim().split('\n').at(-1)?.trim() ?? '';
  if (!summary) return { fileCount: 0, insertions: 0, deletions: 0 };

  const fileCount = Number.parseInt(summary.match(/(\d+) files? changed/)?.[1] ?? '0', 10);
  const insertions = Number.parseInt(summary.match(/(\d+) insertions?\(\+\)/)?.[1] ?? '0', 10);
  const deletions = Number.parseInt(summary.match(/(\d+) deletions?\(-\)/)?.[1] ?? '0', 10);

  return {
    fileCount: Number.isNaN(fileCount) ? 0 : fileCount,
    insertions: Number.isNaN(insertions) ? 0 : insertions,
    deletions: Number.isNaN(deletions) ? 0 : deletions,
  };
}

/** @internal */
export function parseJjRevisionCount(output: string): number {
  const revisions = Number.parseInt(output.trim(), 10);
  return Number.isNaN(revisions) ? 0 : revisions;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
