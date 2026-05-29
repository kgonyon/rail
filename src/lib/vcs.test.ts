import { beforeEach, describe, expect, it } from 'bun:test';
import { createGitVcsDriver, createJjVcsDriver } from './vcs';
import type { WorktreeStatsOptions } from './git';

const calls: Array<{ name: string; args: unknown[] }> = [];

const deps = {
  getGitRoot: () => {
    calls.push({ name: 'getGitRoot', args: [] });
    return Promise.resolve('/repo');
  },
  getProjectRoot: () => {
    calls.push({ name: 'getProjectRoot', args: [] });
    return Promise.resolve('/repo/project');
  },
  getDefaultBranch: (root: string) => {
    calls.push({ name: 'getDefaultBranch', args: [root] });
    return Promise.resolve('main');
  },
  refreshFromOrigin: (root: string, parentRef?: string) => {
    calls.push({ name: 'refreshFromOrigin', args: [root, parentRef] });
    return Promise.resolve();
  },
  fetchFromOrigin: (root: string, parentRef?: string) => {
    calls.push({ name: 'fetchFromOrigin', args: [root, parentRef] });
    return Promise.resolve(parentRef ?? 'main');
  },
  addWorktree: (
    root: string,
    path: string,
    branchPrefix: string,
    feature: string,
    startPoint?: string,
  ) => {
    calls.push({
      name: 'addWorktree',
      args: [root, path, branchPrefix, feature, startPoint],
    });
    return Promise.resolve();
  },
  deleteBranch: (root: string, branch: string) => {
    calls.push({ name: 'deleteBranch', args: [root, branch] });
    return Promise.resolve();
  },
  removeWorktree: (root: string, path: string) => {
    calls.push({ name: 'removeWorktree', args: [root, path] });
    return Promise.resolve();
  },
  listWorktrees: (root: string) => {
    calls.push({ name: 'listWorktrees', args: [root] });
    return Promise.resolve([
      { path: '/repo/.trees/demo', head: 'abc', branch: 'refs/heads/feature/demo' },
    ]);
  },
  getWorktreeStats: (path: string, options: WorktreeStatsOptions) => {
    calls.push({ name: 'getWorktreeStats', args: [path, options] });
    return Promise.resolve({
      fileCount: 1,
      stagedFiles: 1,
      unstagedFiles: 0,
      untrackedFiles: 0,
      insertions: 2,
      deletions: 0,
      isDirty: true,
      commitsAhead: 3,
      openPrs: { state: 'unavailable' as const },
    });
  },
};

const driver = createGitVcsDriver(deps);

beforeEach(() => {
  calls.length = 0;
});

describe('createGitVcsDriver', () => {
  it('exposes Git root resolution behind the driver boundary', async () => {
    await expect(driver.resolveRoot()).resolves.toBe('/repo');
    await expect(driver.resolveProjectRoot()).resolves.toBe('/repo/project');

    expect(calls.map((call) => call.name)).toEqual([
      'getGitRoot',
      'getProjectRoot',
    ]);
  });

  it('creates feature branches using the configured prefix and parent ref', async () => {
    await driver.createFeature({
      root: '/repo',
      path: '/repo/.trees/demo',
      branchPrefix: 'feature/',
      feature: 'demo',
      parentRef: 'origin/main',
    });

    expect(calls).toEqual([
      {
        name: 'addWorktree',
        args: ['/repo', '/repo/.trees/demo', 'feature/', 'demo', 'origin/main'],
      },
    ]);
  });

  it('removes, lists, refreshes, and fetches configured parents through Git operations', async () => {
    await driver.removeFeature('/repo', '/repo/.trees/demo', 'demo');
    await driver.pruneFeature('/repo', 'feature/', 'demo');
    await expect(driver.listFeatures('/repo')).resolves.toEqual([
      { path: '/repo/.trees/demo', head: 'abc', branch: 'refs/heads/feature/demo' },
    ]);
    await driver.refreshParent('/repo', 'release');
    await expect(driver.fetchParent('/repo', 'origin/develop')).resolves.toBe('origin/develop');

    expect(calls).toEqual([
      { name: 'removeWorktree', args: ['/repo', '/repo/.trees/demo'] },
      { name: 'deleteBranch', args: ['/repo', 'feature/demo'] },
      { name: 'listWorktrees', args: ['/repo'] },
      { name: 'refreshFromOrigin', args: ['/repo', 'release'] },
      { name: 'fetchFromOrigin', args: ['/repo', 'origin/develop'] },
    ]);
  });

  it('returns default parent and local status without forge provider behavior', async () => {
    const statusOptions = {
      defaultBranch: 'main',
      branch: 'refs/heads/feature/demo',
    };

    await expect(driver.getDefaultParent('/repo')).resolves.toBe('main');
    await expect(
      driver.getLocalFeatureStatus('/repo/.trees/demo', statusOptions),
    ).resolves.toMatchObject({
      stagedFiles: 1,
      commitsAhead: 3,
    });

    expect(calls).toEqual([
      { name: 'getDefaultBranch', args: ['/repo'] },
      { name: 'getWorktreeStats', args: ['/repo/.trees/demo', statusOptions] },
    ]);
  });
});

const jjDeps = {
  getGitRoot: deps.getGitRoot,
  getProjectRoot: deps.getProjectRoot,
  refreshJjParent: (root: string, parentRef: string) => {
    calls.push({ name: 'refreshJjParent', args: [root, parentRef] });
    return Promise.resolve();
  },
  fetchJjParent: (root: string, parentRef: string) => {
    calls.push({ name: 'fetchJjParent', args: [root, parentRef] });
    return Promise.resolve(parentRef);
  },
  addJjWorkspace: (
    root: string,
    path: string,
    bookmarkPrefix: string,
    feature: string,
    parentRef?: string,
  ) => {
    calls.push({
      name: 'addJjWorkspace',
      args: [root, path, bookmarkPrefix, feature, parentRef],
    });
    return Promise.resolve();
  },
  deleteJjBookmark: (root: string, bookmark: string) => {
    calls.push({ name: 'deleteJjBookmark', args: [root, bookmark] });
    return Promise.resolve();
  },
  removeJjWorkspace: (root: string, path: string, feature: string) => {
    calls.push({ name: 'removeJjWorkspace', args: [root, path, feature] });
    return Promise.resolve();
  },
  listJjWorkspaces: (root: string) => {
    calls.push({ name: 'listJjWorkspaces', args: [root] });
    return Promise.resolve([
      { path: '/repo/.trees/demo', head: 'feature/demo', branch: 'feature/demo' },
    ]);
  },
  getJjWorkspaceStats: (path: string) => {
    calls.push({ name: 'getJjWorkspaceStats', args: [path] });
    return Promise.resolve({
      fileCount: 0,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      insertions: 0,
      deletions: 0,
      isDirty: false,
      commitsAhead: 0,
      openPrs: { state: 'ok' as const, prs: [] },
    });
  },
};

const jjDriver = createJjVcsDriver(jjDeps);

describe('createJjVcsDriver', () => {
  it('creates JJ workspaces with path, workspace name, bookmark prefix, and parent ref', async () => {
    await jjDriver.createFeature({
      root: '/repo',
      path: '/repo/.trees/demo',
      branchPrefix: 'feature/',
      feature: 'demo',
      parentRef: 'main@origin',
    });

    expect(calls).toEqual([
      {
        name: 'addJjWorkspace',
        args: ['/repo', '/repo/.trees/demo', 'feature/', 'demo', 'main@origin'],
      },
    ]);
  });

  it('refreshes and resolves JJ parents through JJ operations', async () => {
    await jjDriver.refreshParent('/repo', 'main@origin');
    await expect(jjDriver.fetchParent('/repo', 'release')).resolves.toBe('release');

    expect(calls).toEqual([
      { name: 'refreshJjParent', args: ['/repo', 'main@origin'] },
      { name: 'fetchJjParent', args: ['/repo', 'release'] },
    ]);
  });

  it('removes, lists, and stats JJ workspaces without bookmark deletion', async () => {
    await jjDriver.removeFeature('/repo', '/repo/.trees/demo', 'demo');
    await jjDriver.pruneFeature('/repo', 'feature/', 'demo');
    await expect(jjDriver.listFeatures('/repo')).resolves.toEqual([
      { path: '/repo/.trees/demo', head: 'feature/demo', branch: 'feature/demo' },
    ]);
    await expect(jjDriver.getLocalFeatureStatus('/repo/.trees/demo', {
      defaultBranch: 'main@origin',
      branch: 'feature/demo',
    })).resolves.toMatchObject({ isDirty: false });

    expect(calls).toEqual([
      { name: 'removeJjWorkspace', args: ['/repo', '/repo/.trees/demo', 'demo'] },
      { name: 'deleteJjBookmark', args: ['/repo', 'feature/demo'] },
      { name: 'listJjWorkspaces', args: ['/repo'] },
      { name: 'getJjWorkspaceStats', args: ['/repo/.trees/demo'] },
    ]);
  });

  it('uses main@origin as the JJ default parent', async () => {
    await expect(jjDriver.getDefaultParent('/repo')).resolves.toBe('main@origin');
    expect(calls).toEqual([]);
  });
});
