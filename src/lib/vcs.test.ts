import { beforeEach, describe, expect, it } from 'bun:test';
import { createGitVcsDriver } from './vcs';
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
    await driver.removeFeature('/repo', '/repo/.trees/demo');
    await expect(driver.listFeatures('/repo')).resolves.toEqual([
      { path: '/repo/.trees/demo', head: 'abc', branch: 'refs/heads/feature/demo' },
    ]);
    await driver.refreshParent('/repo', 'release');
    await expect(driver.fetchParent('/repo', 'origin/develop')).resolves.toBe('origin/develop');

    expect(calls).toEqual([
      { name: 'removeWorktree', args: ['/repo', '/repo/.trees/demo'] },
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
