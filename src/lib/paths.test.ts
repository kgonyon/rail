import { describe, it, expect } from 'bun:test';
import { join } from 'path';
import { homedir } from 'os';
import {
  getWorktreePath,
  getConfigPath,
  getLocalConfigPath,
  getPortAllocationsPath,
  getUserConfigPath,
  isRelativePath,
  resolveRelativePath,
  resolveWorktreesDir,
} from './paths';

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
