import { beforeEach, describe, expect, it } from 'bun:test';
import { createJjOperations, parseJjWorkspaceList } from './jj';
import type { PathLike } from 'fs';
import type { RmOptions } from 'fs';

const calls: Array<{ cwd: string; args: string }> = [];
const removed: Array<{ path: PathLike; options: unknown }> = [];
let failBookmarkCreate = false;
let failWorkspaceForget = false;

const ops = createJjOperations({
  jjExec(cwd: string, args: string) {
    calls.push({ cwd, args });
    if (failBookmarkCreate && args.startsWith('bookmark create ')) {
      return Promise.reject(new Error('bookmark exists'));
    }
    if (failWorkspaceForget && args.startsWith('workspace forget ')) {
      return Promise.reject(new Error('workspace missing'));
    }
    if (args === 'workspace list') {
      return Promise.resolve('main: /repo\ndemo: abc123 feature/demo* /repo/.trees/demo\n');
    }
    if (args === 'diff --stat') {
      return Promise.resolve('M file.ts | 1 +\n');
    }
    return Promise.resolve('');
  },
  rm(path: PathLike, options?: RmOptions) {
    removed.push({ path, options });
    return Promise.resolve();
  },
});

beforeEach(() => {
  calls.length = 0;
  removed.length = 0;
  failBookmarkCreate = false;
  failWorkspaceForget = false;
});

describe('JJ operations', () => {
  it('adds a workspace from the parent and creates a bookmark at the new working copy', async () => {
    await ops.addJjWorkspace('/repo', '/repo/.trees/demo', 'feature/', 'demo', 'main@origin');

    expect(calls).toEqual([
      {
        cwd: '/repo',
        args: "workspace add --name demo --revision main@origin '/repo/.trees/demo'",
      },
      {
        cwd: '/repo/.trees/demo',
        args: 'bookmark create feature/demo --revision @',
      },
    ]);
  });

  it('sets the bookmark when creating it reports that it already exists', async () => {
    failBookmarkCreate = true;

    await ops.addJjWorkspace('/repo', '/repo/.trees/demo', 'feature/', 'demo', 'main@origin');

    expect(calls).toEqual([
      {
        cwd: '/repo',
        args: "workspace add --name demo --revision main@origin '/repo/.trees/demo'",
      },
      {
        cwd: '/repo/.trees/demo',
        args: 'bookmark create feature/demo --revision @',
      },
      {
        cwd: '/repo/.trees/demo',
        args: 'bookmark set feature/demo --revision @',
      },
    ]);
  });

  it('normalizes slash-separated feature names for JJ workspace names', async () => {
    await ops.addJjWorkspace('/repo', '/repo/.trees/feature+demo', '', 'feature/demo', 'main@origin');
    await ops.removeJjWorkspace('/repo', '/repo/.trees/feature+demo', 'feature/demo');

    expect(calls).toEqual([
      {
        cwd: '/repo',
        args: "workspace add --name feature+demo --revision main@origin '/repo/.trees/feature+demo'",
      },
      {
        cwd: '/repo/.trees/feature+demo',
        args: 'bookmark create feature/demo --revision @',
      },
      { cwd: '/repo', args: 'workspace forget feature+demo' },
    ]);
  });

  it('fetches target-specific remote bookmark information when possible', async () => {
    await ops.refreshJjParent('/repo', 'main@origin');
    await ops.refreshJjParent('/repo', 'release');

    expect(calls).toEqual([
      { cwd: '/repo', args: 'git fetch --remote origin --bookmark main' },
      { cwd: '/repo', args: 'git fetch' },
    ]);
  });

  it('forgets a workspace without deleting the bookmark and removes the directory as fallback', async () => {
    await ops.removeJjWorkspace('/repo', '/repo/.trees/demo', 'demo');
    failWorkspaceForget = true;
    await ops.removeJjWorkspace('/repo', '/repo/.trees/stale', 'stale');

    expect(calls).toEqual([
      { cwd: '/repo', args: 'workspace forget demo' },
      { cwd: '/repo', args: 'workspace forget stale' },
    ]);
    expect(removed).toEqual([
      { path: '/repo/.trees/stale', options: { force: true, recursive: true } },
    ]);
  });

  it('deletes a bookmark when pruning a JJ feature', async () => {
    await ops.deleteJjBookmark('/repo', 'feature/demo');

    expect(calls).toEqual([
      { cwd: '/repo', args: 'bookmark delete -- feature/demo' },
    ]);
  });

  it('rejects unsafe JJ parents and bookmarks before running commands', async () => {
    await expect(ops.refreshJjParent('/repo', 'main;rm')).rejects.toThrow(/Unsafe JJ parent ref/);
    await expect(
      ops.addJjWorkspace('/repo', '/repo/.trees/demo', 'feature/', 'demo', 'main;rm'),
    ).rejects.toThrow(/Unsafe JJ parent ref/);
    await expect(
      ops.addJjWorkspace('/repo', '/repo/.trees/demo', 'feature;/', 'demo', 'main@origin'),
    ).rejects.toThrow(/Unsafe JJ bookmark/);
    await expect(
      ops.addJjWorkspace('/repo', '/repo/.trees/demo', 'feature/', '../demo', 'main@origin'),
    ).rejects.toThrow(/Invalid feature name/);
    await expect(ops.removeJjWorkspace('/repo', '/repo/.trees/demo', '../demo')).rejects.toThrow(
      /Invalid feature name/,
    );

    expect(calls).toEqual([]);
  });

  it('parses workspace list output and reports simple dirty state', async () => {
    await expect(ops.listJjWorkspaces('/repo')).resolves.toEqual([
      { path: '/repo', head: 'main', branch: 'main', feature: 'repo', displayLabel: 'main', refLabel: 'Bookmark' },
      { path: '/repo/.trees/demo', head: 'feature/demo', branch: 'feature/demo', feature: 'demo', displayLabel: 'feature/demo', refLabel: 'Bookmark' },
    ]);
    await expect(ops.getJjWorkspaceStats('/repo/.trees/demo')).resolves.toMatchObject({
      fileCount: 0,
      isDirty: true,
      localState: 'changed',
    });
    expect(parseJjWorkspaceList('\n')).toEqual([]);
  });

  it('parses legacy workspace path-only lines and strips bookmark markers', () => {
    expect(parseJjWorkspaceList('demo: /repo/.trees/demo\n')).toEqual([
      { path: '/repo/.trees/demo', head: 'demo', branch: 'demo', feature: 'demo', displayLabel: 'demo', refLabel: 'Bookmark' },
    ]);
    expect(parseJjWorkspaceList('demo: kkmp feature/demo@origin feature/demo* /repo/.trees/demo\n')).toEqual([
      { path: '/repo/.trees/demo', head: 'feature/demo', branch: 'feature/demo', feature: 'demo', displayLabel: 'feature/demo', refLabel: 'Bookmark' },
    ]);
    expect(parseJjWorkspaceList('feature+demo: kkmp feature/demo* /repo/.trees/feature+demo\n')).toEqual([
      { path: '/repo/.trees/feature+demo', head: 'feature/demo', branch: 'feature/demo', feature: 'feature/demo', displayLabel: 'feature/demo', refLabel: 'Bookmark' },
    ]);
  });

  it('reports clean and unknown simple JJ states', async () => {
    const cleanOps = createJjOperations({
      jjExec() {
        return Promise.resolve('');
      },
      rm() {
        return Promise.resolve();
      },
    });
    await expect(cleanOps.getJjWorkspaceStats('/repo/.trees/demo')).resolves.toMatchObject({
      isDirty: false,
      localState: 'clean',
    });

    const unknownOps = createJjOperations({
      jjExec() {
        return Promise.reject(new Error('jj failed'));
      },
      rm() {
        return Promise.resolve();
      },
    });
    await expect(unknownOps.getJjWorkspaceStats('/repo/.trees/demo')).resolves.toMatchObject({
      isDirty: false,
      localState: 'unknown',
    });
  });
});
