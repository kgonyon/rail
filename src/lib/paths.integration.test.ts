import { $ } from 'bun';
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { getProjectRoot } from './paths';
import { loadConfig } from './config';
import { resolveFeature } from './detect';

const configYaml = `name: test-project
vcs: git
forge: github
default_parent: main
auto_refresh: true
setup:
  track_rail: true
  ignore_destination: gitignore
worktrees:
  dir: trees
  branch_prefix: feature/
port:
  base: 3000
  per_feature: 2
  max: 100
env_files: []
secrets: {}
replace: {}
scripts: {}
hooks: []
commands: []
`;

describe('canonical root resolution from feature trees', () => {
  let tempRoot: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempRoot = mkdtempSync(join(tmpdir(), 'rail-root-test-'));
    mkdirSync(join(tempRoot, '.rail'), { recursive: true });
    writeFileSync(join(tempRoot, '.rail', 'config.yaml'), configYaml, 'utf-8');
    writeFileSync(join(tempRoot, 'README.md'), '# test\n', 'utf-8');

    await $`git init -b main ${tempRoot}`.quiet();
    await $`git -C ${tempRoot} add README.md`.quiet();
    await $`git -C ${tempRoot} -c user.name=Test -c user.email=test@example.com commit -m init`.quiet();
    await $`git -C ${tempRoot} worktree add ${join(tempRoot, 'trees', 'feat')} -b feature/feat`.quiet();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('uses the root .rail config and detects the feature without copying .rail', async () => {
    const featureTree = join(tempRoot, 'trees', 'feat');
    process.chdir(featureTree);

    const root = await getProjectRoot();
    const config = loadConfig(root);

    expect(root).toBe(tempRoot);
    expect(config.worktrees.dir).toBe(join(tempRoot, 'trees'));
    expect(resolveFeature(undefined, config.worktrees.dir)).toBe('feat');
    expect(existsSync(join(featureTree, '.rail'))).toBe(false);
  });
});
