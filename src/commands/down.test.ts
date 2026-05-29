import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('down command source', () => {
  it('supports pruning the feature ref through the VCS driver', () => {
    const source = readFileSync(join(import.meta.dir, 'down.ts'), 'utf-8');

    expect(source).toContain('prune: {');
    expect(source).toContain('vcsDriver.pruneFeature');
    expect(source).toContain("config.worktrees.branch_prefix ?? ''");
  });
});
