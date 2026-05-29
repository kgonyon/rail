import { describe, it, expect, mock, afterEach } from 'bun:test';
import { detectFeatureFromCwd, resolveFeature } from './detect';

describe('detectFeatureFromCwd', () => {
  it('detects feature when cwd is inside trees dir', () => {
    expect(
      detectFeatureFromCwd('/projects/app/.trees/my-feature', '/projects/app/.trees'),
    ).toBe('my-feature');
  });

  it('detects feature from a nested subdirectory', () => {
    expect(
      detectFeatureFromCwd('/projects/app/.trees/feat/src/lib', '/projects/app/.trees'),
    ).toBe('feat');
  });

  it('reverses normalized slash-separated feature directory names', () => {
    expect(
      detectFeatureFromCwd('/projects/app/.trees/feature+blah/src/lib', '/projects/app/.trees'),
    ).toBe('feature/blah');
  });

  it('returns null when cwd is not inside trees dir', () => {
    expect(
      detectFeatureFromCwd('/projects/app/src', '/projects/app/.trees'),
    ).toBeNull();
  });

  it('returns null when cwd equals trees dir without a feature segment', () => {
    expect(
      detectFeatureFromCwd('/projects/app/.trees', '/projects/app/.trees'),
    ).toBeNull();
  });

  it('returns null when trees dir is at end with trailing slash but no feature', () => {
    expect(
      detectFeatureFromCwd('/projects/app/.trees/', '/projects/app/.trees'),
    ).toBeNull();
  });

  it('handles treesDir with trailing slash', () => {
    expect(
      detectFeatureFromCwd('/projects/app/.trees/feat', '/projects/app/.trees/'),
    ).toBe('feat');
  });

  it('handles trees dirs outside the project root', () => {
    expect(
      detectFeatureFromCwd(
        '/Users/me/.rail/repos/app/feat/src',
        '/Users/me/.rail/repos/app',
      ),
    ).toBe('feat');
  });

  it('returns null when cwd shares a prefix but is not inside trees dir', () => {
    // /foo/bar-other should not match treesDir /foo/bar
    expect(
      detectFeatureFromCwd('/foo/bar-other/feat', '/foo/bar'),
    ).toBeNull();
  });

  it('handles backslashes in cwd (Windows-style)', () => {
    expect(
      detectFeatureFromCwd('C:\\projects\\app\\.trees\\feat', 'C:/projects/app/.trees'),
    ).toBe('feat');
  });
});

describe('resolveFeature', () => {
  it('returns provided feature directly', () => {
    expect(resolveFeature('my-feature', '/projects/app/.trees')).toBe('my-feature');
  });

  it('returns provided slash-separated feature names directly', () => {
    expect(resolveFeature('feature/blah', '/projects/app/.trees')).toBe('feature/blah');
  });

  it('throws with command name when no feature and auto-detect fails', () => {
    // process.cwd() won't be inside the trees dir, so auto-detect fails
    expect(() => resolveFeature(undefined, '/projects/app/.trees', 'dev')).toThrow(
      'Command "dev" requires a feature context',
    );
  });

  it('throws generic message when no feature and no command name', () => {
    expect(() => resolveFeature(undefined, '/projects/app/.trees')).toThrow(
      'Could not detect feature name',
    );
  });
});
