import { describe, expect, it } from 'bun:test';
import { isBunExecutable, isHomebrewPath } from './install';

describe('install detection helpers', () => {
  it('recognizes Homebrew rail Cellar paths', () => {
    expect(isHomebrewPath('/opt/homebrew/Cellar/rail/1.2.3/bin/rail')).toBe(true);
  });

  it('does not treat manual paths as Homebrew installs', () => {
    expect(isHomebrewPath('/usr/local/bin/rail')).toBe(false);
  });

  it('recognizes Bun source execution paths', () => {
    expect(isBunExecutable('/opt/homebrew/bin/bun')).toBe(true);
  });
});
