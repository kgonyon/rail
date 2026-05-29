import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { homedir } from 'os';
import {
  getGitRoot,
  getFeatureDirName,
  getFeatureNameFromDirName,
  getWorktreePath,
  findRailProjectRoot,
  getConfigPath,
  getLocalConfigPath,
  getPortAllocationsPath,
  getUserConfigPath,
  isRelativePath,
  resolveRelativePath,
  resolveWorktreesDir,
} from './paths';

import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

describe('getWorktreePath', () => {
  it('joins an absolute trees dir with the feature name', () => {
    expect(getWorktreePath('/projects/app/.trees', 'my-feature')).toBe(
      join('/projects/app/.trees', 'my-feature'),
    );
  });

  it('handles trees dirs outside the project', () => {
    expect(getWorktreePath('/Users/me/.rail/repos/app', 'feat')).toBe(
      join('/Users/me/.rail/repos/app', 'feat'),
    );
  });

  it('normalizes slash-separated feature names for directory paths', () => {
    expect(getWorktreePath('/projects/app/.trees', 'feature/blah')).toBe(
      join('/projects/app/.trees', 'feature+blah'),
    );
  });
});

describe('feature directory names', () => {
  it('converts slash-separated feature names to reversible directory names', () => {
    expect(getFeatureDirName('feature/blah')).toBe('feature+blah');
    expect(getFeatureNameFromDirName('feature+blah')).toBe('feature/blah');
  });
});

describe('findRailProjectRoot', () => {
  it('walks up from feature trees to the canonical rail project root', () => {
    const root = join(tmpdir(), `rail-paths-${Date.now()}-${Math.random()}`);
    const featureDir = join(root, '.trees', 'demo', 'src');
    mkdirSync(join(root, '.rail'), { recursive: true });
    mkdirSync(featureDir, { recursive: true });
    writeFileSync(join(root, '.rail', 'config.yaml'), 'name: test\n');

    try {
      expect(findRailProjectRoot(featureDir)).toBe(root);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('getGitRoot', () => {
  it('includes VCS command output when root detection fails', async () => {
    const root = join(tmpdir(), `rail-root-error-${Date.now()}-${Math.random()}`);
    const originalCwd = process.cwd();
    const originalGitCeilingDirectories = process.env.GIT_CEILING_DIRECTORIES;
    mkdirSync(root, { recursive: true });

    try {
      process.chdir(root);
      process.env.GIT_CEILING_DIRECTORIES = tmpdir();
      let caught: unknown;
      try {
        await getGitRoot();
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;
      expect(message).toContain('Not inside a git or jj repository');
      expect(message).toContain('git common dir failed:');
      expect(message).toContain('Failed with exit code');
    } finally {
      process.chdir(originalCwd);
      if (originalGitCeilingDirectories === undefined) {
        delete process.env.GIT_CEILING_DIRECTORIES;
      } else {
        process.env.GIT_CEILING_DIRECTORIES = originalGitCeilingDirectories;
      }
      rmSync(root, { force: true, recursive: true });
    }
  });
});

describe('resolveWorktreesDir', () => {
  it('passes absolute paths through unchanged', () => {
    expect(resolveWorktreesDir('/projects/app', '/abs/path')).toBe('/abs/path');
  });

  it('expands a bare ~', () => {
    expect(resolveWorktreesDir('/projects/app', '~')).toBe(homedir());
  });

  it('expands ~/foo to homedir/foo', () => {
    expect(resolveWorktreesDir('/projects/app', '~/.rail/repos/app')).toBe(
      join(homedir(), '.rail/repos/app'),
    );
  });

  it('preserves a trailing slash on tilde paths (downstream code strips it)', () => {
    expect(resolveWorktreesDir('/projects/app', '~/foo/')).toBe(
      join(homedir(), 'foo/'),
    );
  });

  it('joins relative paths against the project root', () => {
    expect(resolveWorktreesDir('/projects/app', 'trees')).toBe(
      join('/projects/app', 'trees'),
    );
  });

  it('does not expand ~user (other-user home)', () => {
    expect(resolveWorktreesDir('/projects/app', '~bob/foo')).toBe(
      join('/projects/app', '~bob/foo'),
    );
  });
});

describe('getConfigPath', () => {
  it('returns .rail/config.yaml under root', () => {
    expect(getConfigPath('/projects/app')).toBe(
      join('/projects/app', '.rail', 'config.yaml'),
    );
  });
});

describe('getLocalConfigPath', () => {
  it('returns .rail/local.yaml under root', () => {
    expect(getLocalConfigPath('/projects/app')).toBe(
      join('/projects/app', '.rail', 'local.yaml'),
    );
  });
});

describe('getPortAllocationsPath', () => {
  it('returns .rail/port_allocations.json under root', () => {
    expect(getPortAllocationsPath('/projects/app')).toBe(
      join('/projects/app', '.rail', 'port_allocations.json'),
    );
  });
});

describe('getUserConfigPath', () => {
  it('returns ~/.config/rail/config.yaml', () => {
    expect(getUserConfigPath()).toBe(
      join(homedir(), '.config', 'rail', 'config.yaml'),
    );
  });
});

describe('isRelativePath', () => {
  it('returns true for paths with slashes', () => {
    expect(isRelativePath('./scripts/setup.sh')).toBe(true);
    expect(isRelativePath('scripts/run')).toBe(true);
  });

  it('returns true for .sh files without slashes', () => {
    expect(isRelativePath('setup.sh')).toBe(true);
  });

  it('returns false for bare command names', () => {
    expect(isRelativePath('npm')).toBe(false);
    expect(isRelativePath('bun')).toBe(false);
  });
});

describe('resolveRelativePath', () => {
  it('resolves relative paths against baseDir', () => {
    expect(resolveRelativePath('./scripts/run.sh', '/project/.rail')).toBe(
      join('/project/.rail', './scripts/run.sh'),
    );
  });

  it('resolves .sh files against baseDir', () => {
    expect(resolveRelativePath('setup.sh', '/project/.rail')).toBe(
      join('/project/.rail', 'setup.sh'),
    );
  });

  it('returns bare commands unchanged', () => {
    expect(resolveRelativePath('npm', '/project/.rail')).toBe('npm');
    expect(resolveRelativePath('bun', '/project/.rail')).toBe('bun');
  });
});
