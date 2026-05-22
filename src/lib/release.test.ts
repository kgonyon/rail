import { describe, expect, it } from 'bun:test';
import { compareVersions, getReleaseAssetName, isStableTag, normalizeVersion } from './release';

describe('release version helpers', () => {
  it('normalizes stable tags', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(isStableTag('v1.2.3')).toBe(true);
  });

  it('rejects prerelease tags', () => {
    expect(isStableTag('v1.2.3-beta.1')).toBe(false);
  });

  it('compares dev as older than stable releases', () => {
    expect(compareVersions('1.2.3', 'dev')).toBe(1);
    expect(compareVersions('1.2.4', '1.2.3')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });
});

describe('release asset names', () => {
  it('returns the macOS arm64 asset name', () => {
    expect(getReleaseAssetName('darwin', 'arm64')).toBe('rail_Darwin_arm64.tar.gz');
  });

  it('throws for unsupported platforms', () => {
    expect(() => getReleaseAssetName('win32', 'x64')).toThrow('Unsupported platform');
  });
});
