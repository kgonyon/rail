import { beforeEach, describe, expect, it } from 'bun:test';
import { createJjOperations, parseJjWorkspaceList } from './jj';

const calls: Array<{ cwd: string; args: string }> = [];
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
    if (args.startsWith('workspace list --template ')) {
      return Promise.resolve('default\t/repo\tmain\ndemo\t/repo/.trees/demo\tfeature/demo\n');
    }
    if (args === 'bookmark list feature/demo') {
      return Promise.resolve('feature/demo: abc123\n');
    }
    if (args.startsWith('bookmark list ')) {
      return Promise.resolve('');
    }
    if (args === 'diff --stat') {
      return Promise.resolve('M file.ts | 1 +\n');
    }
    return Promise.resolve('');
  },
});

beforeEach(() => {
  calls.length = 0;
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
      { cwd: '/repo', args: 'workspace forget -- feature+demo' },
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

  it('forgets a workspace without deleting the bookmark or directory', async () => {
    await ops.removeJjWorkspace('/repo', '/repo/.trees/demo', 'demo');

    expect(calls).toEqual([
      { cwd: '/repo', args: 'workspace forget -- demo' },
    ]);
  });

  it('propagates workspace forget failures to leave cleanup decisions to callers', async () => {
    failWorkspaceForget = true;

    await expect(ops.removeJjWorkspace('/repo', '/repo/.trees/stale', 'stale')).rejects.toThrow(
      'workspace missing',
    );

    expect(calls).toEqual([
      { cwd: '/repo', args: 'workspace forget -- stale' },
    ]);
  });

  it('deletes a bookmark when pruning a JJ feature', async () => {
    await ops.deleteJjBookmark('/repo', 'feature/demo');

    expect(calls).toEqual([
      { cwd: '/repo', args: 'bookmark delete -- feature/demo' },
    ]);
  });

  it('checks whether a local JJ bookmark exists', async () => {
    await expect(ops.jjBookmarkExists('/repo', 'feature/demo')).resolves.toBe(true);
    await expect(ops.jjBookmarkExists('/repo', 'missing')).resolves.toBe(false);

    expect(calls).toEqual([
      { cwd: '/repo', args: 'bookmark list feature/demo' },
      { cwd: '/repo', args: 'bookmark list missing' },
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
    await expect(ops.jjBookmarkExists('/repo', 'feature/demo;rm')).rejects.toThrow(
      /Unsafe JJ bookmark/,
    );
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

  it('parses templated workspace roots and local bookmarks', () => {
    expect(parseJjWorkspaceList('default\t/repo\t\nstatus\t/repo/.trees/status\tstatus,extra\n')).toEqual([
      { path: '/repo', head: 'default', branch: 'default', feature: 'repo', displayLabel: 'default', refLabel: 'Bookmark' },
      { path: '/repo/.trees/status', head: 'status', branch: 'status', feature: 'status', displayLabel: 'status', refLabel: 'Bookmark' },
    ]);
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

  it('ignores default JJ workspace output that does not include paths', () => {
    const output = 'default: ukpmkqyn e3f3efbe (empty) (no description set)\n' +
      'status: kxvmkmuw e69033ab status | (empty) (no description set)\n';

    expect(parseJjWorkspaceList(output)).toEqual([]);
  });

  it('reports clean and unknown simple JJ states', async () => {
    const cleanOps = createJjOperations({
      jjExec() {
        return Promise.resolve('');
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
    });
    await expect(unknownOps.getJjWorkspaceStats('/repo/.trees/demo')).resolves.toMatchObject({
      isDirty: false,
      localState: 'unknown',
    });
  });
});
