import { afterEach, describe, it, expect } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureWorktreesDir } from './up';

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('up command source', () => {
  it('does not copy the root .rail directory into feature trees', () => {
    const source = readFileSync(join(import.meta.dir, 'up.ts'), 'utf-8');

    expect(source).not.toContain('copyRailDirIfMissing');
    expect(source).not.toContain('Copied .rail into worktree');
  });

  it('passes the configured default parent through the VCS driver boundary', () => {
    const source = readFileSync(join(import.meta.dir, 'up.ts'), 'utf-8');

    expect(source).toContain('args.parent ?? config.default_parent');
    expect(source).toContain('parentRef');
    expect(source).not.toContain('parentRef: `origin/${defaultBranch}`');
  });

  it('supports explicit parents and opting out of auto-refresh', () => {
    const source = readFileSync(join(import.meta.dir, 'up.ts'), 'utf-8');

    expect(source).toContain('parent: {');
    expect(source).toContain('noRefresh: {');
    expect(source).toContain('config.auto_refresh && !args.noRefresh');
    expect(source).toContain('retry with \\`rail up ${feature} --no-refresh\\`');
  });

  it('creates only the worktrees parent directory before VCS setup', async () => {
    const root = makeTempRoot();
    const treePath = join(root, 'trees', 'demo');

    await ensureWorktreesDir(treePath);

    expect(existsSync(join(root, 'trees'))).toBe(true);
    expect(existsSync(treePath)).toBe(false);
  });
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rail-up-'));
  tempDirs.push(dir);
  return dir;
}
