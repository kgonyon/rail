import { describe, it, expect } from 'bun:test';
import {
  filterFeatureWorktrees,
  formatStats,
  isInsideTmux,
  linkify,
  shouldEmitHyperlinks,
} from './status';
import type { WorktreeInfo, WorktreeStats } from '../lib/git';

describe('filterFeatureWorktrees', () => {
  const worktrees: WorktreeInfo[] = [
    { path: '/projects/app', head: 'abc', branch: 'refs/heads/main' },
    { path: '/projects/app/.trees/feat-a', head: 'def', branch: 'refs/heads/feature/feat-a' },
    { path: '/projects/app/.trees/feat-b', head: 'ghi', branch: 'refs/heads/feature/feat-b' },
  ];

  it('returns only worktrees inside trees dir', () => {
    const result = filterFeatureWorktrees(worktrees, '.trees');
    expect(result).toHaveLength(2);
    expect(result[0].path).toContain('feat-a');
    expect(result[1].path).toContain('feat-b');
  });

  it('returns empty array when no features match', () => {
    const result = filterFeatureWorktrees(worktrees, '.worktrees');
    expect(result).toEqual([]);
  });

  it('handles empty worktree list', () => {
    expect(filterFeatureWorktrees([], '.trees')).toEqual([]);
  });
});

describe('formatStats', () => {
  function makeStats(overrides: Partial<WorktreeStats> = {}): WorktreeStats {
    return {
      fileCount: 0,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      insertions: 0,
      deletions: 0,
      isDirty: false,
      commitsAhead: 0,
      openPrs: { state: 'unavailable' },
      ...overrides,
    };
  }

  it('returns ["clean"] when all categories are zero', () => {
    expect(formatStats(makeStats(), 'main', { hyperlinks: false })).toEqual(['clean']);
  });

  it('formats only-staged changes without insertions/deletions block', () => {
    const stats = makeStats({ stagedFiles: 2, fileCount: 2, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '2 files changed (2 staged, 0 unstaged)',
    ]);
  });

  it('formats only-unstaged changes with insertions and deletions', () => {
    const stats = makeStats({
      unstagedFiles: 3,
      fileCount: 3,
      insertions: 12,
      deletions: 5,
      isDirty: true,
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '3 files changed (0 staged, 3 unstaged)  +12 -5',
    ]);
  });

  it('combines staged and unstaged file counts', () => {
    const stats = makeStats({
      stagedFiles: 2,
      unstagedFiles: 1,
      fileCount: 3,
      insertions: 7,
      deletions: 0,
      isDirty: true,
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '3 files changed (2 staged, 1 unstaged)  +7 -0',
    ]);
  });

  it('uses singular "file" when exactly one changed file', () => {
    const stats = makeStats({ stagedFiles: 1, fileCount: 1, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '1 file changed (1 staged, 0 unstaged)',
    ]);
  });

  it('formats only untracked plural', () => {
    const stats = makeStats({ untrackedFiles: 2, fileCount: 2, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['2 untracked files']);
  });

  it('formats only untracked singular', () => {
    const stats = makeStats({ untrackedFiles: 1, fileCount: 1, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['1 untracked file']);
  });

  it('formats only commits ahead plural', () => {
    const stats = makeStats({ commitsAhead: 3 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['3 commits ahead of main']);
  });

  it('formats only commits ahead singular', () => {
    const stats = makeStats({ commitsAhead: 1 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['1 commit ahead of main']);
  });

  it('renders ? when commitsAhead is -1 sentinel', () => {
    const stats = makeStats({ commitsAhead: -1 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['? commits ahead of main']);
  });

  it('omits ahead line when commitsAhead is 0', () => {
    const stats = makeStats({ commitsAhead: 0 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['clean']);
  });

  it('formats one open PR with the URL inlined on the same line', () => {
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [{ number: 123, url: 'https://example.com/owner/repo/pull/123' }],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '1 open PR: https://example.com/owner/repo/pull/123',
    ]);
  });

  it('formats two open PRs as a count line plus indented entries', () => {
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [
          { number: 123, url: 'https://example.com/owner/repo/pull/123' },
          { number: 456, url: 'https://example.com/owner/repo/pull/456' },
        ],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '2 open PRs:',
      '  #123 https://example.com/owner/repo/pull/123',
      '  #456 https://example.com/owner/repo/pull/456',
    ]);
  });

  it('formats three open PRs with count line plus three indented entries', () => {
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [
          { number: 1, url: 'https://e/1' },
          { number: 2, url: 'https://e/2' },
          { number: 3, url: 'https://e/3' },
        ],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '3 open PRs:',
      '  #1 https://e/1',
      '  #2 https://e/2',
      '  #3 https://e/3',
    ]);
  });

  it('renders ? open PRs when openPrs state is error', () => {
    const stats = makeStats({ openPrs: { state: 'error' } });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['? open PRs']);
  });

  it('omits PR lines when openPrs state is unavailable', () => {
    const stats = makeStats({ openPrs: { state: 'unavailable' } });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['clean']);
  });

  it('omits PR lines when openPrs state is ok with zero entries', () => {
    const stats = makeStats({ openPrs: { state: 'ok', prs: [] } });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['clean']);
  });

  it('renders all four categories together in fixed order', () => {
    const stats = makeStats({
      stagedFiles: 2,
      unstagedFiles: 1,
      untrackedFiles: 2,
      fileCount: 5,
      insertions: 42,
      deletions: 7,
      isDirty: true,
      commitsAhead: 4,
      openPrs: {
        state: 'ok',
        prs: [{ number: 7, url: 'https://example.com/owner/repo/pull/7' }],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '3 files changed (2 staged, 1 unstaged)  +42 -7',
      '2 untracked files',
      '4 commits ahead of main',
      '1 open PR: https://example.com/owner/repo/pull/7',
    ]);
  });

  it('propagates a non-default branch name into the ahead line', () => {
    const stats = makeStats({ commitsAhead: 2 });
    expect(formatStats(stats, 'master', { hyperlinks: false })).toEqual(['2 commits ahead of master']);
  });

  it('wraps a single PR URL in OSC 8 escapes when hyperlinks is true', () => {
    const url = 'https://example.com/owner/repo/pull/123';
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [{ number: 123, url }],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: true })).toEqual([
      `1 open PR: ${linkify(url, true)}`,
    ]);
  });

  it('wraps each multi-PR entry URL in OSC 8 escapes when hyperlinks is true', () => {
    const url1 = 'https://example.com/owner/repo/pull/123';
    const url2 = 'https://example.com/owner/repo/pull/456';
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [
          { number: 123, url: url1 },
          { number: 456, url: url2 },
        ],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: true })).toEqual([
      '2 open PRs:',
      `  #123 ${linkify(url1, true)}`,
      `  #456 ${linkify(url2, true)}`,
    ]);
  });

  it('renders multi-PR URLs plain when hyperlinks is false', () => {
    const url1 = 'https://example.com/owner/repo/pull/123';
    const url2 = 'https://example.com/owner/repo/pull/456';
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [
          { number: 123, url: url1 },
          { number: 456, url: url2 },
        ],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '2 open PRs:',
      `  #123 ${url1}`,
      `  #456 ${url2}`,
    ]);
  });
});

describe('linkify', () => {
  it('returns the URL unchanged when hyperlinks is false', () => {
    expect(linkify('https://example.com/x', false)).toBe('https://example.com/x');
  });

  it('wraps the URL in OSC 8 escape sequences when hyperlinks is true', () => {
    expect(linkify('https://example.com/x', true)).toBe(
      '\x1b]8;;https://example.com/x\x1b\\https://example.com/x\x1b]8;;\x1b\\',
    );
  });

  it('wraps OSC 8 in tmux DCS passthrough when tmux is true', () => {
    const url = 'https://example.com/x';
    const inner = `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
    const escaped = inner.replace(/\x1b/g, '\x1b\x1b');
    expect(linkify(url, true, true)).toBe(`\x1bPtmux;${escaped}\x1b\\`);
  });

  it('emits plain text when hyperlinks is false even with tmux true', () => {
    expect(linkify('https://example.com/x', false, true)).toBe('https://example.com/x');
  });
});

describe('isInsideTmux', () => {
  it('returns true when TMUX env var is set', () => {
    expect(isInsideTmux({ TMUX: '/tmp/tmux-501/default,1234,0' })).toBe(true);
  });

  it('returns false when TMUX is unset', () => {
    expect(isInsideTmux({})).toBe(false);
  });

  it('returns false when TMUX is empty string', () => {
    expect(isInsideTmux({ TMUX: '' })).toBe(false);
  });
});

describe('shouldEmitHyperlinks', () => {
  it('returns true when RAIL_HYPERLINKS=always', () => {
    expect(shouldEmitHyperlinks({ RAIL_HYPERLINKS: 'always' })).toBe(true);
  });

  it('returns false when RAIL_HYPERLINKS=never', () => {
    expect(shouldEmitHyperlinks({ RAIL_HYPERLINKS: 'never' })).toBe(false);
  });

  it('is case-insensitive on the override value', () => {
    expect(shouldEmitHyperlinks({ RAIL_HYPERLINKS: 'ALWAYS' })).toBe(true);
    expect(shouldEmitHyperlinks({ RAIL_HYPERLINKS: 'Never' })).toBe(false);
  });

  it('falls back to TTY detection when override is unset', () => {
    const result = shouldEmitHyperlinks({});
    expect(typeof result).toBe('boolean');
  });
});
