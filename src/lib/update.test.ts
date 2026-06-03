import { describe, expect, it } from 'bun:test';
import {
  formatUpdateWarning,
  isCacheStale,
  isUpdateAvailable,
  parseBrewInfo,
  parseGitHubRelease,
  shouldSkipUpdateCheck,
  type UpdateCache,
} from './update';

describe('shouldSkipUpdateCheck', () => {
  it('allows normal commands', () => {
    expect(shouldSkipUpdateCheck(['status'], {})).toBe(false);
  });

  it('skips explicit opt-out and CI', () => {
    expect(shouldSkipUpdateCheck(['status'], { RAIL_UPDATE_CHECK: 'never' })).toBe(true);
    expect(shouldSkipUpdateCheck(['status'], { CI: 'true' })).toBe(true);
  });

  it('skips version, help, and upgrade commands', () => {
    expect(shouldSkipUpdateCheck(['-v'], {})).toBe(true);
    expect(shouldSkipUpdateCheck(['--help'], {})).toBe(true);
    expect(shouldSkipUpdateCheck(['upgrade'], {})).toBe(true);
  });
});

describe('update cache helpers', () => {
  it('treats recent cache entries as fresh', () => {
    const now = new Date('2026-05-21T12:00:00Z');
    const cache = makeCache('2026-05-21T00:00:00Z');
    expect(isCacheStale(cache, now)).toBe(false);
  });

  it('treats invalid cache dates as stale', () => {
    expect(isCacheStale(makeCache('not-a-date'), new Date())).toBe(true);
  });

  it('formats cached update warnings', () => {
    expect(formatUpdateWarning(makeCache('2026-05-21T00:00:00Z'))).toContain('rail 1.2.3');
  });

  it('rechecks cached latest versions against the running version', () => {
    const cache = makeCache('2026-05-21T00:00:00Z');
    expect(isUpdateAvailable(cache, '1.2.2')).toBe(true);
    expect(isUpdateAvailable(cache, '1.2.3')).toBe(false);
  });
});

describe('release response parsing', () => {
  it('parses a stable GitHub release', () => {
    const release = parseGitHubRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/kgonyon/rail/releases/tag/v1.2.3',
      assets: [{ name: 'checksums.txt', browser_download_url: 'https://example.com/checksums.txt' }],
    });
    expect(release.version).toBe('1.2.3');
  });

  it('rejects prerelease-style latest tags', () => {
    expect(() => parseGitHubRelease({ tag_name: 'v1.2.3-beta.1', html_url: 'x', assets: [] })).toThrow(
      'not stable',
    );
  });

  it('parses Homebrew formula stable version', () => {
    expect(parseBrewInfo('{"formulae":[{"versions":{"stable":"1.2.3"}}]}')).toBe('1.2.3');
  });
});

function makeCache(checkedAt: string): UpdateCache {
  return {
    checkedAt,
    latestVersion: '1.2.3',
    updateAvailable: true,
    releaseUrl: 'https://github.com/kgonyon/rail/releases/tag/v1.2.3',
  };
}
