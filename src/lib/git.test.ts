import { beforeEach, describe, it, expect, mock } from 'bun:test';

/**
 * Mock handlers for gitExec / ghExec from ./shell.
 * Tests set these to control shell command responses.
 */
type GitExecHandler = (root: string, args: string) => Promise<string>;
type GhExecHandler = (cwd: string, args: string) => Promise<string>;
let gitExecHandler: GitExecHandler = () =>
  Promise.reject(new Error('no handler configured'));
let ghExecHandler: GhExecHandler = () =>
  Promise.reject(new Error('no gh handler configured'));
let ghExecCallCount = 0;
const ghExecCalls: Array<{ cwd: string; args: string }> = [];

mock.module('./shell', () => ({
  gitExec: (root: string, args: string) => gitExecHandler(root, args),
  ghExec: (cwd: string, args: string) => {
    ghExecCallCount++;
    ghExecCalls.push({ cwd, args });
    return ghExecHandler(cwd, args);
  },
}));

import {
  parseSingleBlock,
  parsePorcelainOutput,
  parsePorcelainStatusBreakdown,
  parseRevListCount,
  parseNumstatOutput,
  getDefaultBranch,
  getWorktreeStats,
  isGhAvailable,
  isSafeRefName,
  getOpenPrs,
  parseGhPrListJson,
  __resetGhAvailableCache,
} from './git';

beforeEach(() => {
  ghExecCallCount = 0;
  ghExecCalls.length = 0;
  ghExecHandler = () => Promise.reject(new Error('no gh handler configured'));
  __resetGhAvailableCache();
});

describe('parseSingleBlock', () => {
  it('parses a complete worktree block', () => {
    const block = [
      'worktree /projects/app',
      'HEAD abc123',
      'branch refs/heads/main',
    ].join('\n');

    expect(parseSingleBlock(block)).toEqual({
      path: '/projects/app',
      head: 'abc123',
      branch: 'refs/heads/main',
    });
  });

  it('returns null for block without worktree line', () => {
    expect(parseSingleBlock('HEAD abc123\nbranch refs/heads/main')).toBeNull();
  });

  it('handles block with only worktree line', () => {
    const result = parseSingleBlock('worktree /projects/app');
    expect(result).toEqual({
      path: '/projects/app',
      head: '',
      branch: '',
    });
  });

  it('handles bare worktree (detached HEAD)', () => {
    const block = [
      'worktree /projects/app',
      'HEAD abc123',
      'detached',
    ].join('\n');

    const result = parseSingleBlock(block);
    expect(result).toEqual({
      path: '/projects/app',
      head: 'abc123',
      branch: '',
    });
  });
});

describe('parsePorcelainOutput', () => {
  it('parses multiple worktree blocks', () => {
    const output = [
      'worktree /projects/app',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /projects/app/.trees/feat',
      'HEAD def456',
      'branch refs/heads/feature/feat',
    ].join('\n');

    const result = parsePorcelainOutput(output);
    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('/projects/app');
    expect(result[1].path).toBe('/projects/app/.trees/feat');
  });

  it('returns empty array for empty output', () => {
    expect(parsePorcelainOutput('')).toEqual([]);
  });

  it('skips blocks without worktree line', () => {
    const output = [
      'worktree /projects/app',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'HEAD orphan',
      'detached',
    ].join('\n');

    const result = parsePorcelainOutput(output);
    expect(result).toHaveLength(1);
  });
});

describe('parsePorcelainStatusBreakdown', () => {
  it('returns all zeros for empty input', () => {
    expect(parsePorcelainStatusBreakdown('')).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      total: 0,
    });
  });

  it('returns all zeros for whitespace-only input', () => {
    expect(parsePorcelainStatusBreakdown('   \n  ')).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      total: 0,
    });
  });

  it('bins staged-only modified file (M )', () => {
    expect(parsePorcelainStatusBreakdown('M  file.ts')).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      total: 1,
    });
  });

  it('bins unstaged-only modified file ( M)', () => {
    expect(parsePorcelainStatusBreakdown(' M file.ts')).toEqual({
      staged: 0,
      unstaged: 1,
      untracked: 0,
      total: 1,
    });
  });

  it('counts both bins for MM', () => {
    expect(parsePorcelainStatusBreakdown('MM file.ts')).toEqual({
      staged: 1,
      unstaged: 1,
      untracked: 0,
      total: 1,
    });
  });

  it('bins staged added file (A )', () => {
    expect(parsePorcelainStatusBreakdown('A  file.ts')).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      total: 1,
    });
  });

  it('bins unstaged added ( A) — intent to add', () => {
    expect(parsePorcelainStatusBreakdown(' A file.ts')).toEqual({
      staged: 0,
      unstaged: 1,
      untracked: 0,
      total: 1,
    });
  });

  it('bins both bins for AM (added then modified)', () => {
    expect(parsePorcelainStatusBreakdown('AM file.ts')).toEqual({
      staged: 1,
      unstaged: 1,
      untracked: 0,
      total: 1,
    });
  });

  it('bins staged deleted (D )', () => {
    expect(parsePorcelainStatusBreakdown('D  file.ts')).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      total: 1,
    });
  });

  it('bins unstaged deleted ( D)', () => {
    expect(parsePorcelainStatusBreakdown(' D file.ts')).toEqual({
      staged: 0,
      unstaged: 1,
      untracked: 0,
      total: 1,
    });
  });

  it('bins staged renamed (R )', () => {
    expect(parsePorcelainStatusBreakdown('R  old.ts -> new.ts')).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      total: 1,
    });
  });

  it('bins staged copied (C )', () => {
    expect(parsePorcelainStatusBreakdown('C  src.ts -> dst.ts')).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      total: 1,
    });
  });

  it('bins unmerged (U )', () => {
    expect(parsePorcelainStatusBreakdown('U  file.ts')).toEqual({
      staged: 1,
      unstaged: 0,
      untracked: 0,
      total: 1,
    });
  });

  it('bins UU (both U)', () => {
    expect(parsePorcelainStatusBreakdown('UU file.ts')).toEqual({
      staged: 1,
      unstaged: 1,
      untracked: 0,
      total: 1,
    });
  });

  it('bins untracked (??)', () => {
    expect(parsePorcelainStatusBreakdown('?? new.ts')).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 1,
      total: 1,
    });
  });

  it('skips ignored (!!)', () => {
    expect(parsePorcelainStatusBreakdown('!! ignored.ts')).toEqual({
      staged: 0,
      unstaged: 0,
      untracked: 0,
      total: 0,
    });
  });

  it('handles a mix of all bins', () => {
    const output = [
      'M  staged.ts',
      ' M unstaged.ts',
      'MM both.ts',
      '?? new.ts',
      '!! ignored.log',
    ].join('\n');
    expect(parsePorcelainStatusBreakdown(output)).toEqual({
      staged: 2,
      unstaged: 2,
      untracked: 1,
      total: 4,
    });
  });

  it('handles multiple files in each bin', () => {
    const output = [
      'A  a1.ts',
      'A  a2.ts',
      ' M m1.ts',
      ' M m2.ts',
      '?? u1.ts',
      '?? u2.ts',
      '?? u3.ts',
    ].join('\n');
    expect(parsePorcelainStatusBreakdown(output)).toEqual({
      staged: 2,
      unstaged: 2,
      untracked: 3,
      total: 7,
    });
  });
});

describe('parseRevListCount', () => {
  it('parses a numeric line', () => {
    expect(parseRevListCount('5')).toBe(5);
  });

  it('parses with surrounding whitespace', () => {
    expect(parseRevListCount('  42\n')).toBe(42);
  });

  it('returns 0 for empty input', () => {
    expect(parseRevListCount('')).toBe(0);
  });

  it('returns 0 for whitespace-only input', () => {
    expect(parseRevListCount('   \n  ')).toBe(0);
  });

  it('returns 0 for non-numeric input', () => {
    expect(parseRevListCount('not a number')).toBe(0);
  });

  it('parses 0 as 0', () => {
    expect(parseRevListCount('0')).toBe(0);
  });

  it('parses larger numbers', () => {
    expect(parseRevListCount('1234')).toBe(1234);
  });
});

describe('parseNumstatOutput', () => {
  it('returns zeros for empty string', () => {
    expect(parseNumstatOutput('')).toEqual({ insertions: 0, deletions: 0 });
  });

  it('returns zeros for whitespace-only output', () => {
    expect(parseNumstatOutput('   \n  \n  ')).toEqual({ insertions: 0, deletions: 0 });
  });

  it('sums insertions and deletions for a single file', () => {
    expect(parseNumstatOutput('10\t5\tfile.ts')).toEqual({
      insertions: 10,
      deletions: 5,
    });
  });

  it('sums across multiple files', () => {
    const output = ['10\t5\tfile1.ts', '3\t7\tfile2.ts'].join('\n');
    expect(parseNumstatOutput(output)).toEqual({
      insertions: 13,
      deletions: 12,
    });
  });

  it('skips binary files shown as dashes', () => {
    expect(parseNumstatOutput('-\t-\timage.png')).toEqual({
      insertions: 0,
      deletions: 0,
    });
  });

  it('handles mix of binary and text files', () => {
    const output = [
      '10\t5\tfile.ts',
      '-\t-\timage.png',
      '3\t2\tother.ts',
    ].join('\n');
    expect(parseNumstatOutput(output)).toEqual({
      insertions: 13,
      deletions: 7,
    });
  });

  it('handles file with zero insertions', () => {
    expect(parseNumstatOutput('0\t5\tfile.ts')).toEqual({
      insertions: 0,
      deletions: 5,
    });
  });

  it('handles file with zero deletions', () => {
    expect(parseNumstatOutput('10\t0\tfile.ts')).toEqual({
      insertions: 10,
      deletions: 0,
    });
  });

  it('handles large numbers', () => {
    expect(parseNumstatOutput('10000\t50000\tfile.ts')).toEqual({
      insertions: 10000,
      deletions: 50000,
    });
  });

  it('skips lines with malformed non-numeric values', () => {
    const output = [
      '10\t5\tfile.ts',
      'abc\t2\tmalformed.ts',
      '3\txyz\talso-malformed.ts',
      '7\t1\tgood.ts',
    ].join('\n');
    expect(parseNumstatOutput(output)).toEqual({
      insertions: 17,
      deletions: 6,
    });
  });

  it('skips lines where both fields are malformed', () => {
    expect(parseNumstatOutput('foo\tbar\tbad.ts')).toEqual({
      insertions: 0,
      deletions: 0,
    });
  });
});

describe('getDefaultBranch', () => {
  it('parses main from origin/HEAD ref', async () => {
    gitExecHandler = () => Promise.resolve('refs/remotes/origin/main\n');
    expect(await getDefaultBranch('/fake/path')).toBe('main');
  });

  it('parses master from origin/HEAD ref', async () => {
    gitExecHandler = () => Promise.resolve('refs/remotes/origin/master\n');
    expect(await getDefaultBranch('/fake/path')).toBe('master');
  });

  it('falls back to main on subprocess error', async () => {
    gitExecHandler = () => Promise.reject(new Error('not a git repo'));
    expect(await getDefaultBranch('/fake/path')).toBe('main');
  });

  it('falls back to main when ref is malformed', async () => {
    gitExecHandler = () => Promise.resolve('something-unexpected\n');
    expect(await getDefaultBranch('/fake/path')).toBe('main');
  });

  it('falls back to main when ref segment contains shell metacharacters', async () => {
    gitExecHandler = () =>
      Promise.resolve('refs/remotes/origin/main;rm -rf /\n');
    expect(await getDefaultBranch('/fake/path')).toBe('main');
  });
});

describe('isSafeRefName', () => {
  it('accepts main', () => {
    expect(isSafeRefName('main')).toBe(true);
  });

  it('accepts master', () => {
    expect(isSafeRefName('master')).toBe(true);
  });

  it('accepts feature/foo', () => {
    expect(isSafeRefName('feature/foo')).toBe(true);
  });

  it('accepts release-1.0', () => {
    expect(isSafeRefName('release-1.0')).toBe(true);
  });

  it('accepts feat_x', () => {
    expect(isSafeRefName('feat_x')).toBe(true);
  });

  it('accepts dev/keith/x', () => {
    expect(isSafeRefName('dev/keith/x')).toBe(true);
  });

  it('rejects empty string', () => {
    expect(isSafeRefName('')).toBe(false);
  });

  it('rejects names containing semicolons', () => {
    expect(isSafeRefName('main;rm')).toBe(false);
  });

  it('rejects names containing pipes', () => {
    expect(isSafeRefName('main|cat')).toBe(false);
  });

  it('rejects names containing ampersands', () => {
    expect(isSafeRefName('main&background')).toBe(false);
  });

  it('rejects names containing dollar signs', () => {
    expect(isSafeRefName('main$VAR')).toBe(false);
  });

  it('rejects names containing backticks', () => {
    expect(isSafeRefName('main`whoami`')).toBe(false);
  });

  it('rejects names containing spaces', () => {
    expect(isSafeRefName('main branch')).toBe(false);
  });

  it('rejects names containing newlines', () => {
    expect(isSafeRefName('main\nrm')).toBe(false);
  });

  it('rejects names longer than 255 characters', () => {
    expect(isSafeRefName('a'.repeat(256))).toBe(false);
  });

  it('accepts a name exactly 255 characters', () => {
    expect(isSafeRefName('a'.repeat(255))).toBe(true);
  });
});

describe('parseGhPrListJson', () => {
  it('returns an empty array for an empty JSON array', () => {
    expect(parseGhPrListJson('[]')).toEqual([]);
  });

  it('returns a single entry for a single valid element', () => {
    expect(
      parseGhPrListJson('[{"number":42,"url":"https://example/1"}]'),
    ).toEqual([{ number: 42, url: 'https://example/1' }]);
  });

  it('returns all entries for a multi-element happy path', () => {
    const input =
      '[{"number":1,"url":"https://e/1"},{"number":2,"url":"https://e/2"},{"number":3,"url":"https://e/3"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 1, url: 'https://e/1' },
      { number: 2, url: 'https://e/2' },
      { number: 3, url: 'https://e/3' },
    ]);
  });

  it('returns null for malformed JSON', () => {
    expect(parseGhPrListJson('not json')).toBeNull();
  });

  it('returns null for an object (non-array) result', () => {
    expect(parseGhPrListJson('{"number":1}')).toBeNull();
  });

  it('returns null for JSON null', () => {
    expect(parseGhPrListJson('null')).toBeNull();
  });

  it('drops entries missing url, keeps the rest', () => {
    const input =
      '[{"number":1,"url":"https://e/1"},{"number":2},{"number":3,"url":"https://e/3"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 1, url: 'https://e/1' },
      { number: 3, url: 'https://e/3' },
    ]);
  });

  it('drops entries missing number, keeps the rest', () => {
    const input =
      '[{"url":"https://e/x"},{"number":2,"url":"https://e/2"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('drops entries with negative or zero number', () => {
    const input =
      '[{"number":-1,"url":"https://e/n"},{"number":0,"url":"https://e/z"},{"number":5,"url":"https://e/5"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 5, url: 'https://e/5' },
    ]);
  });

  it('drops entries with empty-string url', () => {
    const input =
      '[{"number":1,"url":""},{"number":2,"url":"https://e/2"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('ignores extra fields on entries and keeps the typed shape', () => {
    const input =
      '[{"number":7,"url":"https://e/7","title":"hi","author":{"login":"x"}}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 7, url: 'https://e/7' },
    ]);
  });

  it('drops entries whose number is a string rather than a JSON number', () => {
    const input =
      '[{"number":"42","url":"https://e/s"},{"number":2,"url":"https://e/2"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('drops entries whose url uses http (not https)', () => {
    const input =
      '[{"number":1,"url":"http://example.com/pr/1"},{"number":2,"url":"https://e/2"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('drops entries whose url uses a non-https scheme like ftp', () => {
    const input =
      '[{"number":1,"url":"ftp://example.com/x"},{"number":2,"url":"https://e/2"}]';
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('drops entries whose url contains an ANSI escape character', () => {
    const input = JSON.stringify([
      { number: 1, url: 'https://example.com/[31mhi' },
      { number: 2, url: 'https://e/2' },
    ]);
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('drops entries whose url contains CR/LF', () => {
    const input = JSON.stringify([
      { number: 1, url: 'https://example.com/foo\r\nbar' },
      { number: 2, url: 'https://e/2' },
    ]);
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('drops entries whose url exceeds the 2048-char cap', () => {
    const longUrl = `https://example.com/${'a'.repeat(2049)}`;
    const input = JSON.stringify([
      { number: 1, url: longUrl },
      { number: 2, url: 'https://e/2' },
    ]);
    expect(parseGhPrListJson(input)).toEqual([
      { number: 2, url: 'https://e/2' },
    ]);
  });

  it('caps the returned array at 50 entries when given 51 valid entries', () => {
    const entries = Array.from({ length: 51 }, (_, i) => ({
      number: i + 1,
      url: `https://e/${i + 1}`,
    }));
    const result = parseGhPrListJson(JSON.stringify(entries));
    expect(result).not.toBeNull();
    expect(result!.length).toBe(50);
    expect(result![0]).toEqual({ number: 1, url: 'https://e/1' });
    expect(result![49]).toEqual({ number: 50, url: 'https://e/50' });
  });
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

  it('caches the result across multiple calls', async () => {
    ghExecHandler = () => Promise.resolve('Logged in');
    await isGhAvailable();
    await isGhAvailable();
    expect(ghExecCallCount).toBe(1);
  });

  it('caches the false result too', async () => {
    ghExecHandler = () => Promise.reject(new Error('nope'));
    expect(await isGhAvailable()).toBe(false);
    expect(await isGhAvailable()).toBe(false);
    expect(ghExecCallCount).toBe(1);
  });
});

describe('getOpenPrs', () => {
  it('returns parsed prs from gh JSON output', async () => {
    ghExecHandler = () =>
      Promise.resolve(
        '[{"number":1,"url":"https://e/1"},{"number":2,"url":"https://e/2"}]',
      );
    expect(await getOpenPrs('/fake/path', 'feature/x')).toEqual({
      state: 'ok',
      prs: [
        { number: 1, url: 'https://e/1' },
        { number: 2, url: 'https://e/2' },
      ],
    });
  });

  it('returns error state on subprocess failure', async () => {
    ghExecHandler = () => Promise.reject(new Error('gh failed'));
    expect(await getOpenPrs('/fake/path', 'feature/x')).toEqual({
      state: 'error',
    });
  });

  it('returns error state on malformed JSON', async () => {
    ghExecHandler = () => Promise.resolve('not json');
    expect(await getOpenPrs('/fake/path', 'feature/x')).toEqual({
      state: 'error',
    });
  });

  it('strips refs/heads/ prefix and uses --json number,url', async () => {
    ghExecHandler = () => Promise.resolve('[]');
    await getOpenPrs('/fake/path', 'refs/heads/feature/x');
    expect(ghExecCalls).toHaveLength(1);
    expect(ghExecCalls[0]?.args).toBe(
      'pr list --head feature/x --state open --json number,url',
    );
    expect(ghExecCalls[0]?.cwd).toBe('/fake/path');
  });

  it('passes branch through unchanged when no refs/heads/ prefix', async () => {
    ghExecHandler = () => Promise.resolve('[]');
    await getOpenPrs('/fake/path', 'feature/x');
    expect(ghExecCalls[0]?.args).toBe(
      'pr list --head feature/x --state open --json number,url',
    );
  });

  it('returns error state without invoking ghExec for an unsafe ref name', async () => {
    ghExecHandler = () => Promise.resolve('[]');
    const result = await getOpenPrs(
      '/fake/path',
      'feature/x;rm -rf /',
    );
    expect(result).toEqual({ state: 'error' });
    expect(ghExecCallCount).toBe(0);
    expect(ghExecCalls).toHaveLength(0);
  });
});

describe('getWorktreeStats', () => {
  const defaultOptions = {
    defaultBranch: 'main',
    branch: 'refs/heads/feature/x',
    ghAvailable: false,
  };

  it('returns clean stats when git status --porcelain fails', async () => {
    gitExecHandler = () => Promise.reject(new Error('git status failed'));

    const stats = await getWorktreeStats('/fake/path', defaultOptions);

    expect(stats).toEqual({
      fileCount: 0,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      insertions: 0,
      deletions: 0,
      isDirty: false,
      commitsAhead: 0,
      openPrs: { state: 'unavailable' },
    });
  });

  it('returns file count with zero line counts when git diff fails', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('diff HEAD --numstat')) {
        return Promise.reject(new Error('git diff failed'));
      }
      if (args.includes('rev-list')) {
        return Promise.resolve('0\n');
      }
      return Promise.resolve(' M file.ts\n?? new.ts');
    };

    const stats = await getWorktreeStats('/fake/path', defaultOptions);

    expect(stats).toEqual({
      fileCount: 2,
      stagedFiles: 0,
      unstagedFiles: 1,
      untrackedFiles: 1,
      insertions: 0,
      deletions: 0,
      isDirty: true,
      commitsAhead: 0,
      openPrs: { state: 'unavailable' },
    });
  });

  it('returns full stats with breakdown when commands succeed', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('diff HEAD --numstat')) {
        return Promise.resolve('10\t5\tsrc/lib/git.ts\n20\t3\tsrc/new.ts');
      }
      if (args.includes('rev-list')) {
        return Promise.resolve('4\n');
      }
      return Promise.resolve(' M src/lib/git.ts\n?? src/new.ts\nA  added.ts');
    };

    const stats = await getWorktreeStats('/fake/path', defaultOptions);

    expect(stats).toEqual({
      fileCount: 3,
      stagedFiles: 1,
      unstagedFiles: 1,
      untrackedFiles: 1,
      insertions: 30,
      deletions: 8,
      isDirty: true,
      commitsAhead: 4,
      openPrs: { state: 'unavailable' },
    });
  });

  it('short-circuits rev-list when branch equals defaultBranch', async () => {
    let revListCalled = false;
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) {
        revListCalled = true;
        return Promise.resolve('99\n');
      }
      if (args.includes('diff HEAD --numstat')) {
        return Promise.resolve('');
      }
      return Promise.resolve('');
    };

    const stats = await getWorktreeStats('/fake/path', {
      defaultBranch: 'main',
      branch: 'main',
      ghAvailable: false,
    });

    expect(revListCalled).toBe(false);
    expect(stats.commitsAhead).toBe(0);
  });

  it('short-circuits rev-list when refs/heads/<branch> equals defaultBranch', async () => {
    let revListCalled = false;
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) {
        revListCalled = true;
        return Promise.resolve('99\n');
      }
      return Promise.resolve('');
    };

    await getWorktreeStats('/fake/path', {
      defaultBranch: 'main',
      branch: 'refs/heads/main',
      ghAvailable: false,
    });

    expect(revListCalled).toBe(false);
  });

  it('returns positive commitsAhead from rev-list output on clean tree', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) return Promise.resolve('7\n');
      if (args.includes('status --porcelain')) return Promise.resolve('');
      return Promise.resolve('');
    };

    const stats = await getWorktreeStats('/fake/path', defaultOptions);
    expect(stats.commitsAhead).toBe(7);
    expect(stats.isDirty).toBe(false);
  });

  it('sets commitsAhead to -1 when rev-list fails', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) {
        return Promise.reject(new Error('no upstream'));
      }
      if (args.includes('diff HEAD --numstat')) {
        return Promise.resolve('1\t1\tfile.ts');
      }
      return Promise.resolve(' M file.ts');
    };

    const stats = await getWorktreeStats('/fake/path', defaultOptions);
    expect(stats.commitsAhead).toBe(-1);
    expect(stats.isDirty).toBe(true);
  });

  it('populates new bin fields with multiple staged + unstaged + untracked', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) return Promise.resolve('2\n');
      if (args.includes('diff HEAD --numstat')) return Promise.resolve('');
      const porcelain = [
        'M  staged1.ts',
        'A  staged2.ts',
        ' M unstaged1.ts',
        'MM both.ts',
        '?? new1.ts',
        '?? new2.ts',
      ].join('\n');
      return Promise.resolve(porcelain);
    };

    const stats = await getWorktreeStats('/fake/path', defaultOptions);
    expect(stats.stagedFiles).toBe(3);
    expect(stats.unstagedFiles).toBe(2);
    expect(stats.untrackedFiles).toBe(2);
    expect(stats.fileCount).toBe(6);
    expect(stats.commitsAhead).toBe(2);
  });

  it('short-circuits gh pr list when ghAvailable is false', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) return Promise.resolve('0\n');
      if (args.includes('diff HEAD --numstat')) return Promise.resolve('');
      return Promise.resolve('');
    };
    ghExecHandler = () =>
      Promise.resolve('[{"number":1,"url":"https://e/1"}]');

    const stats = await getWorktreeStats('/fake/path', defaultOptions);

    expect(stats.openPrs).toEqual({ state: 'unavailable' });
    const prListCalls = ghExecCalls.filter((c) => c.args.includes('pr list'));
    expect(prListCalls).toHaveLength(0);
  });

  it('populates openPrs when ghAvailable is true', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) return Promise.resolve('0\n');
      if (args.includes('diff HEAD --numstat')) return Promise.resolve('');
      return Promise.resolve('');
    };
    ghExecHandler = () =>
      Promise.resolve(
        '[{"number":1,"url":"https://e/1"},{"number":2,"url":"https://e/2"}]',
      );

    const stats = await getWorktreeStats('/fake/path', {
      defaultBranch: 'main',
      branch: 'refs/heads/feature/x',
      ghAvailable: true,
    });

    expect(stats.openPrs).toEqual({
      state: 'ok',
      prs: [
        { number: 1, url: 'https://e/1' },
        { number: 2, url: 'https://e/2' },
      ],
    });
  });

  it('returns error openPrs when ghAvailable is true but gh subprocess fails', async () => {
    gitExecHandler = (_root: string, args: string) => {
      if (args.includes('rev-list')) return Promise.resolve('0\n');
      if (args.includes('diff HEAD --numstat')) return Promise.resolve('');
      return Promise.resolve('');
    };
    ghExecHandler = () => Promise.reject(new Error('gh failed'));

    const stats = await getWorktreeStats('/fake/path', {
      defaultBranch: 'main',
      branch: 'refs/heads/feature/x',
      ghAvailable: true,
    });

    expect(stats.openPrs).toEqual({ state: 'error' });
  });
});
