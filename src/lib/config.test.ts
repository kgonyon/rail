import { describe, it, expect } from 'bun:test';
import {
  deepMerge,
  isPlainObject,
  isSafeFeatureName,
  validateConfig,
  validateFeatureName,
} from './config';

describe('isPlainObject', () => {
  it('returns true for plain objects', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
  });

  it('returns false for arrays', () => {
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2])).toBe(false);
  });

  it('returns false for null', () => {
    expect(isPlainObject(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isPlainObject(42)).toBe(false);
    expect(isPlainObject('string')).toBe(false);
    expect(isPlainObject(true)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });
});

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const result = deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 });
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('deep merges nested objects', () => {
    const target = { port: { base: 3000, per_feature: 10 } };
    const source = { port: { base: 4000 } };
    const result = deepMerge(target, source);
    expect(result).toEqual({ port: { base: 4000, per_feature: 10 } });
  });

  it('overwrites arrays (no array merging)', () => {
    const target = { commands: [{ name: 'dev' }] };
    const source = { commands: [{ name: 'build' }] };
    const result = deepMerge(target, source);
    expect(result).toEqual({ commands: [{ name: 'build' }] });
  });

  it('does not mutate target', () => {
    const target = { a: 1, nested: { b: 2 } };
    const source = { nested: { c: 3 } };
    const result = deepMerge(target, source);
    expect(target.nested).toEqual({ b: 2 });
    expect(result.nested).toEqual({ b: 2, c: 3 });
  });

  it('handles empty source', () => {
    const target = { a: 1 };
    expect(deepMerge(target, {})).toEqual({ a: 1 });
  });

  it('handles empty target', () => {
    const source = { a: 1 };
    expect(deepMerge({}, source)).toEqual({ a: 1 });
  });

  it('overwrites primitives with objects', () => {
    const result = deepMerge({ a: 'string' }, { a: { nested: true } });
    expect(result).toEqual({ a: { nested: true } });
  });

  it('overwrites objects with primitives', () => {
    const result = deepMerge({ a: { nested: true } }, { a: 'string' });
    expect(result).toEqual({ a: 'string' });
  });
});

function validConfig(overrides: Record<string, any> = {}): Record<string, any> {
  return deepMerge(
    {
      name: 'test-project',
      vcs: 'git',
      forge: 'github',
      default_parent: 'main',
      auto_refresh: true,
      setup: {
        track_rail: true,
        ignore_destination: 'gitignore',
      },
      worktrees: {
        dir: 'trees',
        branch_prefix: 'feature/',
      },
      port: {
        base: 3000,
        per_feature: 2,
        max: 100,
      },
    },
    overrides,
  );
}

describe('validateConfig', () => {
  it('accepts a valid generated Git config shape', () => {
    expect(() => validateConfig(validConfig())).not.toThrow();
  });

  it('accepts configs without a branch prefix', () => {
    const config = validConfig({ worktrees: { branch_prefix: undefined } });
    delete config.worktrees.branch_prefix;

    expect(() => validateConfig(config)).not.toThrow();
  });

  it('accepts an empty branch prefix', () => {
    expect(() => validateConfig(validConfig({ worktrees: { branch_prefix: '' } }))).not.toThrow();
  });

  it('rejects missing required extended keys and tells users to run init', () => {
    const config = validConfig();
    delete config.vcs;

    expect(() => validateConfig(config)).toThrow(/vcs is required[\s\S]*Run `rail init`/);
  });

  it('rejects invalid vcs and forge enum values', () => {
    const config = validConfig({ vcs: 'svn', forge: 'bitbucket' });

    expect(() => validateConfig(config)).toThrow(/vcs must be one of: git, jj/);
    expect(() => validateConfig(config)).toThrow(/forge must be one of: github, gitlab, none/);
  });

  it('rejects invalid setup decisions', () => {
    const config = validConfig({
      setup: { track_rail: 'yes', ignore_destination: 'nowhere' },
    });

    expect(() => validateConfig(config)).toThrow(/setup.track_rail is required/);
    expect(() => validateConfig(config)).toThrow(/setup.ignore_destination must be one of: gitignore, exclude/);
  });

  it('rejects invalid parent values', () => {
    const config = validConfig({ default_parent: 'main;rm -rf /' });

    expect(() => validateConfig(config)).toThrow(/default_parent must contain only/);
  });
});

describe('feature name validation', () => {
  it('accepts safe single-segment feature names', () => {
    expect(isSafeFeatureName('login.fix_1')).toBe(true);
  });

  it('accepts safe slash-separated feature names', () => {
    expect(isSafeFeatureName('feature/login.fix_1')).toBe(true);
  });

  it('rejects unsafe feature names', () => {
    expect(isSafeFeatureName('/feature')).toBe(false);
    expect(isSafeFeatureName('feature/')).toBe(false);
    expect(isSafeFeatureName('feature//login')).toBe(false);
    expect(isSafeFeatureName('feature/../login')).toBe(false);
    expect(isSafeFeatureName('feature+login')).toBe(false);
    expect(isSafeFeatureName('login;rm')).toBe(false);
    expect(isSafeFeatureName('..')).toBe(false);
    expect(() => validateFeatureName('feature+login')).toThrow(/Invalid feature name/);
  });
});
