import { beforeEach, describe, expect, it, mock } from 'bun:test';

type GhExecHandler = (cwd: string, args: string) => Promise<string>;
let ghExecHandler: GhExecHandler = () =>
  Promise.reject(new Error('no gh handler configured'));
let ghExecCallCount = 0;
const ghExecCalls: Array<{ cwd: string; args: string }> = [];

type GlabExecHandler = (cwd: string, args: string) => Promise<string>;
let glabExecHandler: GlabExecHandler = () =>
  Promise.reject(new Error('no glab handler configured'));
let glabExecCallCount = 0;
const glabExecCalls: Array<{ cwd: string; args: string }> = [];

mock.module('./shell', () => ({
  ghExec: (cwd: string, args: string) => {
    ghExecCallCount++;
    ghExecCalls.push({ cwd, args });
    return ghExecHandler(cwd, args);
  },
  glabExec: (cwd: string, args: string) => {
    glabExecCallCount++;
    glabExecCalls.push({ cwd, args });
    return glabExecHandler(cwd, args);
  },
}));

import {
  __resetGlabAvailableCache,
  __resetGhAvailableCache,
  getForgeDriver,
  getOpenGitHubReviews,
  getOpenGitLabReviews,
  isGlabAvailable,
  isGhAvailable,
  parseGhPrListJson,
  parseGlabMrListJson,
} from './forge';

beforeEach(() => {
  ghExecCallCount = 0;
  ghExecCalls.length = 0;
  ghExecHandler = () => Promise.reject(new Error('no gh handler configured'));
  glabExecCallCount = 0;
  glabExecCalls.length = 0;
  glabExecHandler = () => Promise.reject(new Error('no glab handler configured'));
  __resetGhAvailableCache();
  __resetGlabAvailableCache();
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

describe('isGlabAvailable', () => {
  it('returns true when glab auth status succeeds', async () => {
    glabExecHandler = () => Promise.resolve('gitlab.com: Logged in');
    expect(await isGlabAvailable()).toBe(true);
  });

  it('returns false when glab auth status fails', async () => {
    glabExecHandler = () => Promise.reject(new Error('not authenticated'));
    expect(await isGlabAvailable()).toBe(false);
  });

  it('caches successful and failed availability checks', async () => {
    glabExecHandler = () => Promise.resolve('Logged in');
    await isGlabAvailable();
    await isGlabAvailable();
    expect(glabExecCallCount).toBe(1);

    __resetGlabAvailableCache();
    glabExecCallCount = 0;
    glabExecHandler = () => Promise.reject(new Error('nope'));
    expect(await isGlabAvailable()).toBe(false);
    expect(await isGlabAvailable()).toBe(false);
    expect(glabExecCallCount).toBe(1);
  });
});

describe('parseGlabMrListJson', () => {
  it('returns null for malformed JSON and non-array JSON', () => {
    expect(parseGlabMrListJson('not json')).toBeNull();
    expect(parseGlabMrListJson('{"iid":1}')).toBeNull();
  });

  it('drops entries with unsafe URLs and caps valid results at 50', () => {
    const entries = [
      { iid: 1, web_url: 'http://example.com/merge_requests/1' },
      { iid: 2, web_url: 'https://example.com/merge_requests/2\n' },
      ...Array.from({ length: 51 }, (_, i) => ({
        iid: i + 3,
        web_url: `https://example.com/merge_requests/${i + 3}`,
      })),
    ];

    const result = parseGlabMrListJson(JSON.stringify(entries));

    expect(result).not.toBeNull();
    expect(result).toHaveLength(50);
    expect(result![0]).toEqual({ number: 3, url: 'https://example.com/merge_requests/3' });
    expect(result![49]).toEqual({ number: 52, url: 'https://example.com/merge_requests/52' });
  });

  it('accepts camel-case GitLab URL keys', () => {
    expect(parseGlabMrListJson('[{"iid":1,"webUrl":"https://e/1"}]')).toEqual([
      { number: 1, url: 'https://e/1' },
    ]);
  });

  it('keeps opened GitLab entries and drops closed or merged entries', () => {
    const output = JSON.stringify([
      { iid: 1, state: 'opened', web_url: 'https://e/1' },
      { iid: 2, state: 'open', web_url: 'https://e/2' },
      { iid: 3, state: 'merged', web_url: 'https://e/3' },
      { iid: 4, state: 'closed', web_url: 'https://e/4' },
    ]);

    expect(parseGlabMrListJson(output)).toEqual([
      { number: 1, url: 'https://e/1' },
      { number: 2, url: 'https://e/2' },
    ]);
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

describe('getOpenGitLabReviews', () => {
  it('returns unavailable without listing MRs when glab is unavailable', async () => {
    glabExecHandler = () => Promise.reject(new Error('not authenticated'));

    await expect(getOpenGitLabReviews('/fake/path', 'feature/x')).resolves.toEqual({
      state: 'unavailable',
    });
    expect(glabExecCalls).toEqual([{ cwd: process.cwd(), args: 'auth status' }]);
  });

  it('returns error on malformed MR JSON', async () => {
    glabExecHandler = (_cwd, args) => {
      if (args === 'auth status') return Promise.resolve('Logged in');
      return Promise.resolve('not json');
    };

    await expect(getOpenGitLabReviews('/fake/path', 'feature/x')).resolves.toEqual({
      state: 'error',
    });
  });

  it('strips refs/heads prefix and returns parsed open reviews', async () => {
    glabExecHandler = (_cwd, args) => {
      if (args === 'auth status') return Promise.resolve('Logged in');
      return Promise.resolve('[{"iid":1,"web_url":"https://e/1"}]');
    };

    await expect(getOpenGitLabReviews('/fake/path', 'refs/heads/feature/x')).resolves.toEqual({
      state: 'ok',
      reviews: [{ number: 1, url: 'https://e/1' }],
    });
    expect(glabExecCalls[1]).toEqual({
      cwd: '/fake/path',
      args: 'mr list --source-branch feature/x --output json',
    });
  });

  it('returns error without invoking glab for an unsafe head name', async () => {
    await expect(getOpenGitLabReviews('/fake/path', 'feature/x;rm')).resolves.toEqual({
      state: 'error',
    });
    expect(glabExecCallCount).toBe(0);
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

  it('returns a GitLab driver with MR labels and glab warning', () => {
    const driver = getForgeDriver('gitlab');
    expect(driver.reviewLabel).toBe('MR');
    expect(driver.reviewLabelPlural).toBe('MRs');
    expect(driver.unavailableWarning).toBe('glab CLI unavailable; MR counts will be skipped');
    expect(driver.isAvailable).toBe(isGlabAvailable);
  });
});
