import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { copyRailDirIfMissing } from './rail-dir';

describe('copyRailDirIfMissing', () => {
  let tempRoot: string;
  let worktreePath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rail-dir-test-'));
    worktreePath = join(tempRoot, 'trees', 'feature-a');

    mkdirSync(join(tempRoot, '.rail', 'scripts'), { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(tempRoot, '.rail', 'config.yaml'), 'name: test\n');
    writeFileSync(join(tempRoot, '.rail', 'local.yaml'), 'secrets: {}\n');
    writeFileSync(join(tempRoot, '.rail', 'port_allocations.json'), '{"features":{}}\n');
    writeFileSync(join(tempRoot, '.rail', 'scripts', 'setup.sh'), '#!/bin/sh\n');
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('copies .rail contents into a worktree without .rail', () => {
    const copied = copyRailDirIfMissing(tempRoot, worktreePath);

    expect(copied).toBe(true);
    expect(readFileSync(join(worktreePath, '.rail', 'config.yaml'), 'utf-8')).toBe(
      'name: test\n',
    );
    expect(readFileSync(join(worktreePath, '.rail', 'local.yaml'), 'utf-8')).toBe(
      'secrets: {}\n',
    );
    expect(existsSync(join(worktreePath, '.rail', 'scripts', 'setup.sh'))).toBe(true);
  });

  it('does not copy port allocation state into the worktree', () => {
    copyRailDirIfMissing(tempRoot, worktreePath);

    expect(existsSync(join(worktreePath, '.rail', 'port_allocations.json'))).toBe(false);
  });

  it('leaves an existing worktree .rail directory unchanged', () => {
    mkdirSync(join(worktreePath, '.rail'), { recursive: true });
    writeFileSync(join(worktreePath, '.rail', 'config.yaml'), 'name: existing\n');

    const copied = copyRailDirIfMissing(tempRoot, worktreePath);

    expect(copied).toBe(false);
    expect(readFileSync(join(worktreePath, '.rail', 'config.yaml'), 'utf-8')).toBe(
      'name: existing\n',
    );
  });

  it('throws when the source .rail directory is missing', () => {
    rmSync(join(tempRoot, '.rail'), { recursive: true, force: true });

    expect(() => copyRailDirIfMissing(tempRoot, worktreePath)).toThrow(
      'No .rail directory found',
    );
  });
});
