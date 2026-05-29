import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parse } from 'yaml';
import {
  buildConfigContent,
  defaultInitOptions,
  getIgnoreEntries,
  initializeRailProject,
  resolveInitOptions,
} from './init';
import { validateConfig } from '../lib/config';

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'rail-init-test-'));
  tempDirs.push(root);
  return root;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('buildConfigContent', () => {
  it('generates a valid Git default config', () => {
    const config = parse(buildConfigContent('test-project'));

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.vcs).toBe('git');
    expect(config.forge).toBe('github');
    expect(config.default_parent).toBe('main');
    expect(config.auto_refresh).toBe(true);
    expect(config.setup).toEqual({
      track_rail: true,
      ignore_destination: 'gitignore',
    });
  });

  it('generates a valid JJ config with JJ parent defaults', () => {
    const config = parse(buildConfigContent('test-project', defaultInitOptions({ vcs: 'jj' })));

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.vcs).toBe('jj');
    expect(config.default_parent).toBe('main@origin');
    expect(config.auto_refresh).toBe(true);
  });

  it('records flag-driven setup choices', () => {
    const config = parse(buildConfigContent('test-project', defaultInitOptions({
      forge: 'gitlab',
      defaultParent: 'origin/main',
      autoRefresh: false,
      trackRail: false,
      ignoreDestination: 'exclude',
      worktreesDir: '../feature-trees',
    })));

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.forge).toBe('gitlab');
    expect(config.default_parent).toBe('origin/main');
    expect(config.auto_refresh).toBe(false);
    expect(config.setup).toEqual({
      track_rail: false,
      ignore_destination: 'exclude',
    });
    expect(config.worktrees.dir).toBe('../feature-trees');
  });
});

describe('resolveInitOptions', () => {
  it('resolves non-interactive CLI choices from flags', async () => {
    const options = await resolveInitOptions({
      vcs: 'jj',
      forge: 'none',
      defaultParent: 'main@origin',
      autoRefresh: false,
      trackRail: false,
      ignoreDestination: 'exclude',
      worktreesDir: '../feature-trees',
    });

    expect(options).toEqual({
      vcs: 'jj',
      forge: 'none',
      defaultParent: 'main@origin',
      autoRefresh: false,
      trackRail: false,
      ignoreDestination: 'exclude',
      worktreesDir: '../feature-trees',
    });
  });
});

describe('initializeRailProject', () => {
  it('creates first-time setup files and shared gitignore rules', async () => {
    const root = makeTempRoot();

    await initializeRailProject(root, 'test-project');

    const config = parse(readFileSync(join(root, '.rail', 'config.yaml'), 'utf-8'));
    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');

    expect(() => validateConfig(config)).not.toThrow();
    expect(existsSync(join(root, '.rail', 'scripts', 'setup.sh'))).toBe(true);
    expect(existsSync(join(root, '.rail', 'scripts', 'cleanup.sh'))).toBe(true);
    expect(gitignore).toContain('.rail/local.yaml');
    expect(gitignore).toContain('.rail/port_allocations.json');
    expect(gitignore).toContain('trees/');
  });

  it('writes ignore rules to git info exclude when requested', async () => {
    const root = makeTempRoot();

    await initializeRailProject(root, 'test-project', defaultInitOptions({
      ignoreDestination: 'exclude',
    }));

    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');

    expect(existsSync(join(root, '.gitignore'))).toBe(false);
    expect(exclude).toContain('.rail/local.yaml');
    expect(exclude).toContain('.rail/port_allocations.json');
    expect(exclude).toContain('trees/');
  });

  it('ignores all rail files when setup is untracked', async () => {
    const root = makeTempRoot();

    await initializeRailProject(root, 'test-project', defaultInitOptions({
      trackRail: false,
    }));

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');

    expect(gitignore).toContain('.rail/');
    expect(gitignore).toContain('trees/');
  });
});

describe('getIgnoreEntries', () => {
  it('includes project-relative feature tree directories', () => {
    expect(getIgnoreEntries('/repo', defaultInitOptions({ worktreesDir: 'trees' }))).toContain('trees/');
    expect(getIgnoreEntries('/repo', defaultInitOptions({ worktreesDir: '/repo/features' }))).toContain('features/');
  });

  it('skips external feature tree directories', () => {
    expect(getIgnoreEntries('/repo', defaultInitOptions({ worktreesDir: '../trees' }))).not.toContain('../trees/');
    expect(getIgnoreEntries('/repo', defaultInitOptions({ worktreesDir: '/tmp/trees' }))).not.toContain('tmp/trees/');
    expect(getIgnoreEntries('/repo', defaultInitOptions({ worktreesDir: '~/trees' }))).not.toContain('~/trees/');
  });
});
