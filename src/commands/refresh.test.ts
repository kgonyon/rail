import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('refresh command source', () => {
  it('refreshes the configured default parent or an explicit target', () => {
    const source = readFileSync(join(import.meta.dir, 'refresh.ts'), 'utf-8');

    expect(source).toContain('target: {');
    expect(source).toContain('args.target ?? config.default_parent');
    expect(source).toContain('refreshParent');
  });
});
