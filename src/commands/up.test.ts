import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('up command source', () => {
  it('does not copy the root .rail directory into feature trees', () => {
    const source = readFileSync(join(import.meta.dir, 'up.ts'), 'utf-8');

    expect(source).not.toContain('copyRailDirIfMissing');
    expect(source).not.toContain('Copied .rail into worktree');
  });

  it('passes the configured default parent through the VCS driver boundary', () => {
    const source = readFileSync(join(import.meta.dir, 'up.ts'), 'utf-8');

    expect(source).toContain('fetchParent(root, config.default_parent)');
    expect(source).toContain('parentRef: defaultParent');
    expect(source).not.toContain('parentRef: `origin/${defaultBranch}`');
  });
});
