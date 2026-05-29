import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { loadConfig } from './config';

const baseConfig = `name: test-project
vcs: git
forge: github
default_parent: main
auto_refresh: true
setup:
  track_rail: true
  ignore_destination: gitignore
worktrees:
  dir: __PLACEHOLDER__
  branch_prefix: feature/
port:
  base: 3000
  per_feature: 2
  max: 100
env_files: []
secrets: {}
replace: {}
scripts:
  setup: scripts/setup.sh
  cleanup: scripts/cleanup.sh
hooks: []
commands: []
`;

function writeConfig(root: string, dir: string): void {
  mkdirSync(join(root, '.rail'), { recursive: true });
  writeFileSync(
    join(root, '.rail', 'config.yaml'),
    baseConfig.replace('__PLACEHOLDER__', dir),
    'utf-8',
  );
}

describe('loadConfig path resolution', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rail-config-test-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('joins relative worktrees.dir against the project root', () => {
    writeConfig(tempRoot, 'trees');
    const config = loadConfig(tempRoot);
    expect(config.worktrees.dir).toBe(join(tempRoot, 'trees'));
  });

  it('expands ~/foo to homedir/foo', () => {
    writeConfig(tempRoot, '~/.rail/repos/app');
    const config = loadConfig(tempRoot);
    expect(config.worktrees.dir).toBe(join(homedir(), '.rail/repos/app'));
  });

  it('passes absolute worktrees.dir through unchanged', () => {
    writeConfig(tempRoot, '/Users/me/.rail/repos/app');
    const config = loadConfig(tempRoot);
    expect(config.worktrees.dir).toBe('/Users/me/.rail/repos/app');
  });

  it('defaults a missing branch prefix to an empty string', () => {
    mkdirSync(join(tempRoot, '.rail'), { recursive: true });
    writeFileSync(
      join(tempRoot, '.rail', 'config.yaml'),
      baseConfig.replace('__PLACEHOLDER__', 'trees').replace('  branch_prefix: feature/\n', ''),
      'utf-8',
    );

    const config = loadConfig(tempRoot);

    expect(config.worktrees.branch_prefix).toBe('');
  });

  it('resolves the local.yaml override (not the base config) when both set dir', () => {
    writeConfig(tempRoot, 'trees');
    writeFileSync(
      join(tempRoot, '.rail', 'local.yaml'),
      'worktrees:\n  dir: ~/.rail/repos/app\n',
      'utf-8',
    );
    const config = loadConfig(tempRoot);
    expect(config.worktrees.dir).toBe(join(homedir(), '.rail/repos/app'));
  });
});
