import { afterEach, describe, it, expect } from 'bun:test';
import { $ } from 'bun';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureWorktreesDir, shouldSkipSetupScript } from './up';
import type { FeatureAllocations } from '../types/config';

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

  it('supports skipping setup and rolling back failed setup', () => {
    const source = readFileSync(join(import.meta.dir, 'up.ts'), 'utf-8');

    expect(source).toContain("'skip-setup': {");
    expect(source).toContain('setSetupSkipped(root, feature, shouldSkipSetup)');
    expect(source).toContain('rollbackFailedSetup');
  });

  it('creates only the worktrees parent directory before VCS setup', async () => {
    const root = makeTempRoot();
    const treePath = join(root, 'trees', 'demo');

    await ensureWorktreesDir(treePath);

    expect(existsSync(join(root, 'trees'))).toBe(true);
    expect(existsSync(treePath)).toBe(false);
  });

  it('detects the exact skip-setup flag', () => {
    expect(shouldSkipSetupScript({}, ['demo', '--skip-setup'])).toBe(true);
    expect(shouldSkipSetupScript({ 'skip-setup': true }, ['demo'])).toBe(true);
    expect(shouldSkipSetupScript({ skipSetup: true }, ['demo'])).toBe(true);
    expect(shouldSkipSetupScript({}, ['demo'])).toBe(false);
  });
});

describe('up and down command integration', () => {
  it('removes the feature tree and allocation when setup fails', async () => {
    const root = await makeGitRailProject({
      setupScript: '#!/bin/sh\nexit 7\n',
      cleanupScript: '#!/bin/sh\necho cleanup > "$RAIL_PROJECT_DIR/cleanup-ran"\nexit 9\n',
    });

    const result = await runRail(root, 'up', 'demo', '--no-refresh');

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Script failed: scripts/setup.sh');
    expect(existsSync(join(root, 'trees', 'demo'))).toBe(false);
    expect(existsSync(join(root, 'cleanup-ran'))).toBe(true);
    expect(readFeatureAllocations(root)).toEqual({ features: {} });
    await expect(gitBranchExists(root, 'feature/demo')).resolves.toBe(false);
  });

  it('preserves a pre-existing feature branch when setup rollback runs', async () => {
    const root = await makeGitRailProject({
      setupScript: '#!/bin/sh\nexit 7\n',
      cleanupScript: '#!/bin/sh\nexit 0\n',
    });
    await $`git -C ${root} branch feature/demo main`.quiet();

    const result = await runRail(root, 'up', 'demo', '--no-refresh');

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(join(root, 'trees', 'demo'))).toBe(false);
    expect(readFeatureAllocations(root)).toEqual({ features: {} });
    await expect(gitBranchExists(root, 'feature/demo')).resolves.toBe(true);
  });

  it('continues down when cleanup fails', async () => {
    const root = await makeGitRailProject({
      setupScript: '#!/bin/sh\nexit 0\n',
      cleanupScript: '#!/bin/sh\nexit 9\n',
    });

    expect((await runRail(root, 'up', 'demo', '--no-refresh')).exitCode).toBe(0);
    const result = await runRail(root, 'down', 'demo');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Cleanup script failed; continuing teardown.');
    expect(existsSync(join(root, 'trees', 'demo'))).toBe(false);
    expect(readFeatureAllocations(root)).toEqual({ features: {} });
  });

  it('skips cleanup after setup was skipped', async () => {
    const root = await makeGitRailProject({
      setupScript: '#!/bin/sh\necho setup > "$RAIL_PROJECT_DIR/setup-ran"\n',
      cleanupScript: '#!/bin/sh\necho cleanup > "$RAIL_PROJECT_DIR/cleanup-ran"\n',
    });

    expect((await runRail(root, 'up', 'demo', '--no-refresh', '--skip-setup')).exitCode).toBe(0);
    expect(readFeatureAllocations(root).features.demo).toEqual({ index: 0, setupSkipped: true });

    const result = await runRail(root, 'down', 'demo');

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, 'setup-ran'))).toBe(false);
    expect(existsSync(join(root, 'cleanup-ran'))).toBe(false);
  });
});

function makeTempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rail-up-'));
  tempDirs.push(dir);
  return dir;
}

async function makeGitRailProject(options: {
  setupScript: string;
  cleanupScript: string;
}): Promise<string> {
  const root = makeTempRoot();
  await $`git init -b main ${root}`.quiet();
  writeFileSync(join(root, 'README.md'), 'test\n');
  await $`git -C ${root} add README.md`.quiet();
  await $`git -C ${root} -c user.name=Rail -c user.email=rail@example.test commit -m init`.quiet();

  mkdirSync(join(root, '.rail', 'scripts'), { recursive: true });
  writeFileSync(join(root, '.rail', 'config.yaml'), makeConfig());
  writeScript(join(root, '.rail', 'scripts', 'setup.sh'), options.setupScript);
  writeScript(join(root, '.rail', 'scripts', 'cleanup.sh'), options.cleanupScript);
  return root;
}

function makeConfig(): string {
  return `name: test-project
vcs: git
forge: none
default_parent: main
auto_refresh: false
setup:
  track_rail: true
  ignore_destination: gitignore
worktrees:
  dir: trees
  branch_prefix: feature/
port:
  base: 3000
  per_feature: 2
  max: 20
scripts:
  setup: scripts/setup.sh
  cleanup: scripts/cleanup.sh
`;
}

function writeScript(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

async function runRail(root: string, ...args: string[]): Promise<{
  exitCode: number;
  stderr: string;
  stdout: string;
}> {
  const proc = Bun.spawn(['bun', join(import.meta.dir, '..', 'cli.ts'), ...args], {
    cwd: root,
    env: { ...process.env, RAIL_UPDATE_CHECK: 'never' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  return { exitCode, stderr, stdout };
}

function readFeatureAllocations(root: string): FeatureAllocations {
  return JSON.parse(readFileSync(join(root, '.rail', 'feature_allocations.json'), 'utf-8'));
}

async function gitBranchExists(root: string, branch: string): Promise<boolean> {
  try {
    await $`git -C ${root} rev-parse --verify refs/heads/${branch}`.quiet();
    return true;
  } catch {
    return false;
  }
}
