import { beforeEach, describe, expect, it, mock } from 'bun:test';

type GhExecHandler = (cwd: string, args: string) => Promise<string>;
let ghExecHandler: GhExecHandler = () =>
  Promise.reject(new Error('no gh handler configured'));
let ghExecCallCount = 0;
const ghExecCalls: Array<{ cwd: string; args: string }> = [];

mock.module('./shell', () => ({
  ghExec: (cwd: string, args: string) => {
    ghExecCallCount++;
    ghExecCalls.push({ cwd, args });
    return ghExecHandler(cwd, args);
  },
}));

import {
  __resetGhAvailableCache,
  getForgeDriver,
  getOpenGitHubReviews,
  isGhAvailable,
  parseGhPrListJson,
} from './forge';

beforeEach(() => {
  ghExecCallCount = 0;
  ghExecCalls.length = 0;
  ghExecHandler = () => Promise.reject(new Error('no gh handler configured'));
  __resetGhAvailableCache();
});

describe('isGhAvailable', () => {
  it('returns true when gh auth status succeeds', async () => {
    ghExecHandler = () => Promise.resolve('Logged in to github.com');
    expect(await isGhAvailable()).toBe(true);
  });

  it('returns false when gh auth status fails', async () => {
    ghExecHandler = () => Promise.reject(new Error('not authenticated'));
    expect(await isGhAvailable()).toBe(false);
  });

  it('caches successful and failed availability checks', async () => {
    ghExecHandler = () => Promise.resolve('Logged in');
    await isGhAvailable();
    await isGhAvailable();
    expect(ghExecCallCount).toBe(1);

    __resetGhAvailableCache();
    ghExecCallCount = 0;
    ghExecHandler = () => Promise.reject(new Error('nope'));
    expect(await isGhAvailable()).toBe(false);
    expect(await isGhAvailable()).toBe(false);
    expect(ghExecCallCount).toBe(1);
  });
});

describe('parseGhPrListJson', () => {
  it('returns null for malformed JSON and non-array JSON', () => {
    expect(parseGhPrListJson('not json')).toBeNull();
    expect(parseGhPrListJson('{"number":1}')).toBeNull();
  });

  it('drops entries with unsafe URLs and caps valid results at 50', () => {
    const entries = [
      { number: 1, url: 'http://example.com/pull/1' },
      { number: 2, url: 'https://example.com/pull/2\n' },
      ...Array.from({ length: 51 }, (_, i) => ({
        number: i + 3,
        url: `https://example.com/pull/${i + 3}`,
      })),
    ];

    const result = parseGhPrListJson(JSON.stringify(entries));

    expect(result).not.toBeNull();
    expect(result).toHaveLength(50);
    expect(result![0]).toEqual({ number: 3, url: 'https://example.com/pull/3' });
    expect(result![49]).toEqual({ number: 52, url: 'https://example.com/pull/52' });
  });
});

describe('getOpenGitHubReviews', () => {
  it('returns unavailable without listing PRs when gh is unavailable', async () => {
    ghExecHandler = () => Promise.reject(new Error('not authenticated'));

    await expect(getOpenGitHubReviews('/fake/path', 'feature/x')).resolves.toEqual({
      state: 'unavailable',
    });
    expect(ghExecCalls).toEqual([{ cwd: process.cwd(), args: 'auth status' }]);
  });

  it('returns error on malformed PR JSON', async () => {
    ghExecHandler = (_cwd, args) => {
      if (args === 'auth status') return Promise.resolve('Logged in');
      return Promise.resolve('not json');
    };

    await expect(getOpenGitHubReviews('/fake/path', 'feature/x')).resolves.toEqual({
      state: 'error',
    });
  });

  it('strips refs/heads prefix and returns parsed open reviews', async () => {
    ghExecHandler = (_cwd, args) => {
      if (args === 'auth status') return Promise.resolve('Logged in');
      return Promise.resolve('[{"number":1,"url":"https://e/1"}]');
    };

    await expect(getOpenGitHubReviews('/fake/path', 'refs/heads/feature/x')).resolves.toEqual({
      state: 'ok',
      reviews: [{ number: 1, url: 'https://e/1' }],
    });
    expect(ghExecCalls[1]).toEqual({
      cwd: '/fake/path',
      args: 'pr list --head feature/x --state open --json number,url',
    });
  });

  it('returns error without invoking gh for an unsafe head name', async () => {
    await expect(getOpenGitHubReviews('/fake/path', 'feature/x;rm')).resolves.toEqual({
      state: 'error',
    });
    expect(ghExecCallCount).toBe(0);
  });
});

describe('getForgeDriver', () => {
  it('returns a silent none driver that performs no lookup', async () => {
    const driver = getForgeDriver('none');
    await expect(driver.getOpenReviews('/fake/path', 'feature/x')).resolves.toEqual({
      state: 'unavailable',
    });
    expect(driver.unavailableWarning).toBeUndefined();
    expect(ghExecCallCount).toBe(0);
  });
});
