import { afterEach, describe, expect, it } from 'bun:test';
import consola from 'consola';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'fs';
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

async function withInteractivePrompts<T>(
  responses: unknown[],
  action: () => Promise<T>,
): Promise<{ result: T; prompts: string[] }> {
  const originalPrompt = consola.prompt;
  const stdin = process.stdin as Omit<typeof process.stdin, 'isTTY'> & { isTTY?: boolean };
  const ttyDescriptor = Object.getOwnPropertyDescriptor(stdin, 'isTTY');
  const prompts: string[] = [];
  let responseIndex = 0;

  Object.defineProperty(stdin, 'isTTY', { configurable: true, value: true });
  consola.prompt = ((message: string) => {
    prompts.push(message);
    const response = responses[responseIndex];
    responseIndex += 1;
    return Promise.resolve(response);
  }) as typeof consola.prompt;

  try {
    return { result: await action(), prompts };
  } finally {
    consola.prompt = originalPrompt;
    if (ttyDescriptor) {
      Object.defineProperty(stdin, 'isTTY', ttyDescriptor);
    } else {
      delete stdin.isTTY;
    }
  }
}

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

  it('does not prompt for auto-refresh during interactive setup', async () => {
    const { result, prompts } = await withInteractivePrompts(
      ['git', 'github', true, 'gitignore'],
      () => resolveInitOptions({}),
    );

    expect(result.autoRefresh).toBe(true);
    expect(prompts).toEqual([
      'Choose VCS',
      'Choose Forge integration',
      'Allow shared .rail config and scripts to be tracked?',
      'Choose Ignore destination',
    ]);
  });

  it('uses valid existing config values without prompting', async () => {
    const existing = parse(`vcs: jj
forge: gitlab
default_parent: trunk@origin
auto_refresh: false
setup:
  track_rail: false
  ignore_destination: exclude
worktrees:
  dir: ../feature-trees
`);

    const { result, prompts } = await withInteractivePrompts([], () => resolveInitOptions({}, existing));

    expect(prompts).toEqual([]);
    expect(result).toEqual({
      vcs: 'jj',
      forge: 'gitlab',
      defaultParent: 'trunk@origin',
      autoRefresh: false,
      trackRail: false,
      ignoreDestination: 'exclude',
      worktreesDir: '../feature-trees',
    });
  });

  it('prompts only for values missing from existing config', async () => {
    const existing = parse(`vcs: jj
auto_refresh: false
worktrees:
  dir: ../feature-trees
`);

    const { result, prompts } = await withInteractivePrompts(
      ['gitlab', false, 'exclude'],
      () => resolveInitOptions({}, existing),
    );

    expect(prompts).toEqual([
      'Choose Forge integration',
      'Allow shared .rail config and scripts to be tracked?',
      'Choose Ignore destination',
    ]);
    expect(result).toEqual({
      vcs: 'jj',
      forge: 'gitlab',
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
    expect(gitignore).toContain('.rail/feature_allocations.json');
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
    expect(exclude).toContain('.rail/feature_allocations.json');
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

  it('repairs an existing setup without changing valid settings', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail', 'scripts'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), `name: custom-project
vcs: jj
forge: none
default_parent: trunk@origin
auto_refresh: false
setup:
  track_rail: false
  ignore_destination: exclude
worktrees:
  dir: ../feature-trees
  branch_prefix: topic/
port:
  base: 4000
  per_feature: 4
  max: 40
commands:
  - name: test
    command: bun test
`);
    writeFileSync(join(root, '.rail', 'scripts', 'setup.sh'), 'custom setup\n');

    await initializeRailProject(root, 'ignored-project');

    const config = parse(readFileSync(join(root, '.rail', 'config.yaml'), 'utf-8'));
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.name).toBe('custom-project');
    expect(config.vcs).toBe('jj');
    expect(config.forge).toBe('none');
    expect(config.default_parent).toBe('trunk@origin');
    expect(config.auto_refresh).toBe(false);
    expect(config.setup).toEqual({ track_rail: false, ignore_destination: 'exclude' });
    expect(config.worktrees).toEqual({ dir: '../feature-trees', branch_prefix: 'topic/' });
    expect(config.port).toEqual({ base: 4000, per_feature: 4, max: 40 });
    expect(config.commands).toEqual([{ name: 'test', command: 'bun test' }]);
    expect(readFileSync(join(root, '.rail', 'scripts', 'setup.sh'), 'utf-8')).toBe('custom setup\n');
    expect(exclude).toContain('.rail/');
    expect(exclude).not.toContain('../feature-trees/');
  });

  it('fills missing keys from defaults on rerun', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), `name: old-project
worktrees:
  dir: trees
  branch_prefix: feature/
port:
  base: 3000
  per_feature: 2
  max: 100
`);

    await initializeRailProject(root, 'ignored-project');

    const config = parse(readFileSync(join(root, '.rail', 'config.yaml'), 'utf-8'));

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.name).toBe('old-project');
    expect(config.vcs).toBe('git');
    expect(config.forge).toBe('github');
    expect(config.default_parent).toBe('main');
    expect(config.auto_refresh).toBe(true);
    expect(config.setup).toEqual({ track_rail: true, ignore_destination: 'gitignore' });
  });

  it('repairs invalid required values on rerun', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), `name: old-project
vcs: svn
forge: bitbucket
default_parent: main;rm
auto_refresh: yes
setup:
  track_rail: yes
  ignore_destination: nowhere
worktrees:
  dir: trees
  branch_prefix: bad;prefix
port:
  base: 0
  per_feature: two
  max: -1
`);

    await initializeRailProject(root, 'ignored-project');

    const config = parse(readFileSync(join(root, '.rail', 'config.yaml'), 'utf-8'));

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.vcs).toBe('git');
    expect(config.forge).toBe('github');
    expect(config.default_parent).toBe('main');
    expect(config.auto_refresh).toBe(true);
    expect(config.setup).toEqual({ track_rail: true, ignore_destination: 'gitignore' });
    expect(config.worktrees.branch_prefix).toBe('feature/');
    expect(config.port).toEqual({ base: 3000, per_feature: 2, max: 100 });
  });

  it('uses flag-driven choices when repairing missing keys', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), `name: old-project
worktrees:
  branch_prefix: feature/
port:
  base: 3000
  per_feature: 2
  max: 100
`);

    await initializeRailProject(root, 'ignored-project', defaultInitOptions({
      vcs: 'jj',
      forge: 'gitlab',
      defaultParent: 'develop@origin',
      autoRefresh: false,
      trackRail: false,
      ignoreDestination: 'exclude',
      worktreesDir: '../feature-trees',
    }));

    const config = parse(readFileSync(join(root, '.rail', 'config.yaml'), 'utf-8'));
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.vcs).toBe('jj');
    expect(config.forge).toBe('gitlab');
    expect(config.default_parent).toBe('develop@origin');
    expect(config.auto_refresh).toBe(false);
    expect(config.setup).toEqual({ track_rail: false, ignore_destination: 'exclude' });
    expect(config.worktrees.dir).toBe('../feature-trees');
    expect(exclude).toContain('.rail/');
  });

  it('repairs ignore drift without duplicating existing rules', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), buildConfigContent('test-project'));
    writeFileSync(join(root, '.gitignore'), '# existing\n.rail/local.yaml\n.rail/port_allocations.json\n');

    await initializeRailProject(root, 'test-project');
    await initializeRailProject(root, 'test-project');

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');

    expect(gitignore.match(/\.rail\/local\.yaml/g)?.length).toBe(1);
    expect(gitignore.match(/\.rail\/feature_allocations\.json/g)?.length).toBe(1);
    expect(gitignore).not.toContain('.rail/port_allocations.json');
    expect(gitignore.match(/^trees\/$/gm)?.length).toBe(1);
  });

  it('removes broad rail ignores when shared rail files should be tracked', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), buildConfigContent('test-project'));
    writeFileSync(join(root, '.gitignore'), '# existing\n.rail/\n/.rail\n.rail/**\nnode_modules/\n');

    await initializeRailProject(root, 'test-project');

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');
    const lines = gitignore.split(/\r?\n/).map((line) => line.trim());

    expect(lines).not.toContain('.rail/');
    expect(lines).not.toContain('/.rail');
    expect(lines).not.toContain('.rail/**');
    expect(lines).toContain('node_modules/');
    expect(lines).toContain('.rail/local.yaml');
    expect(lines).toContain('.rail/feature_allocations.json');
  });

  it('repairs broad gitignore rail ignores when local ignores go to exclude', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), buildConfigContent(
      'test-project',
      defaultInitOptions({ ignoreDestination: 'exclude' }),
    ));
    writeFileSync(join(root, '.gitignore'), '# existing\n.rail/\nnode_modules/\n');

    await initializeRailProject(root, 'test-project');

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');
    const gitignoreLines = gitignore.split(/\r?\n/).map((line) => line.trim());

    expect(gitignoreLines).not.toContain('.rail/');
    expect(gitignoreLines).toContain('node_modules/');
    expect(exclude).toContain('.rail/local.yaml');
    expect(exclude).toContain('.rail/feature_allocations.json');
  });

  it('removes narrow rail ignores when shared rail files should not be tracked', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), buildConfigContent(
      'test-project',
      defaultInitOptions({ trackRail: false }),
    ));
    writeFileSync(
      join(root, '.gitignore'),
      '# existing\n.rail/local.yaml\n.rail/port_allocations.json\ntrees/\nnode_modules/\n',
    );

    await initializeRailProject(root, 'test-project');

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');
    const lines = gitignore.split(/\r?\n/).map((line) => line.trim());

    expect(lines).not.toContain('.rail/local.yaml');
    expect(lines).not.toContain('.rail/port_allocations.json');
    expect(lines).not.toContain('.rail/feature_allocations.json');
    expect(lines).toContain('.rail/');
    expect(lines).toContain('trees/');
    expect(lines).toContain('node_modules/');
    expect(gitignore.match(/^\.rail\/$/gm)?.length).toBe(1);
  });

  it('consolidates duplicate rail local blocks', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), buildConfigContent(
      'test-project',
      defaultInitOptions({ trackRail: false }),
    ));
    writeFileSync(join(root, '.gitignore'), `node_modules/

# rail local files
trees/

# rail local files

# rail local files
.rail/
`);

    await initializeRailProject(root, 'test-project');

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');

    expect(gitignore).toBe(`node_modules/

# rail local files
.rail/
trees/
`);
  });

  it('removes managed rail entries from exclude when moving ignores to gitignore', async () => {
    const root = makeTempRoot();
    mkdirSync(join(root, '.rail'), { recursive: true });
    mkdirSync(join(root, '.git', 'info'), { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), buildConfigContent('test-project'));
    writeFileSync(join(root, '.git', 'info', 'exclude'), `*.local

# rail local files
.rail/local.yaml
.rail/feature_allocations.json
/trees
`);

    await initializeRailProject(root, 'test-project');

    const gitignore = readFileSync(join(root, '.gitignore'), 'utf-8');
    const exclude = readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8');
    const excludeLines = exclude.split(/\r?\n/).map((line) => line.trim());

    expect(gitignore).toContain('.rail/local.yaml');
    expect(gitignore).toContain('.rail/feature_allocations.json');
    expect(gitignore).toContain('trees/');
    expect(excludeLines).toContain('*.local');
    expect(excludeLines).not.toContain('# rail local files');
    expect(excludeLines).not.toContain('.rail/local.yaml');
    expect(excludeLines).not.toContain('.rail/feature_allocations.json');
    expect(excludeLines).not.toContain('/trees');
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
