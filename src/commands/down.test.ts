import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { removeRemainingFeatureTree, validateDownTarget } from './down';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('down command source', () => {
  it('supports pruning the feature ref through the VCS driver', () => {
    const source = readFileSync(join(import.meta.dir, 'down.ts'), 'utf-8');

    expect(source).toContain('prune: {');
    expect(source).toContain('vcsDriver.pruneFeature');
    expect(source).toContain("config.worktrees.branch_prefix ?? ''");
  });

  it('removes a feature tree directory left behind after VCS removal', async () => {
    const treePath = makeTempTree();

    await expect(removeRemainingFeatureTree(treePath)).resolves.toBe(true);

    expect(existsSync(treePath)).toBe(false);
  });

  it('does nothing when the VCS already removed the feature tree directory', async () => {
    const treePath = join(makeTempRoot(), 'missing-tree');

    await expect(removeRemainingFeatureTree(treePath)).resolves.toBe(false);
  });

  it('allows prune cleanup when the worktree is already gone but a ref remains', () => {
    expect(() => validateDownTarget(makeDownTarget({ hasFeatureRef: true }), true)).not.toThrow();
  });

  it('allows prune cleanup when only a stale port allocation remains', () => {
    expect(() => validateDownTarget(makeDownTarget({ hasPortAllocation: true }), true)).not.toThrow();
  });

  it('rejects missing worktrees without prune', () => {
    expect(() => validateDownTarget(makeDownTarget({ hasFeatureRef: true }), false)).toThrow(
      /No worktree found/,
    );
  });

  it('shortens home paths in missing worktree errors', () => {
    let caught: unknown;

    try {
      validateDownTarget(makeDownTarget({
        hasFeatureRef: true,
        treePath: join(homedir(), 'Projects/dotfiles/trees/demo'),
      }), false);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain('at ~/Projects/dotfiles/trees/demo.');
    expect(message).not.toContain(homedir());
  });

  it('rejects prune cleanup when no cleanup target exists', () => {
    expect(() => validateDownTarget(makeDownTarget(), true)).toThrow(
      /No worktree, port allocation, or feature ref found/,
    );
  });
});

function makeDownTarget(overrides: Partial<Parameters<typeof validateDownTarget>[0]> = {}) {
  return {
    feature: 'demo',
    hasFeatureRef: false,
    hasPortAllocation: false,
    hasTree: false,
    treePath: '/repo/trees/demo',
    ...overrides,
  };
}

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rail-down-'));
  tempDirs.push(dir);
  return dir;
}

function makeTempTree(): string {
  const treePath = join(makeTempRoot(), 'tree');
  mkdirSync(treePath);
  return treePath;
}
