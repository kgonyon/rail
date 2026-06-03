import { describe, it, expect } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';
import {
  collectStats,
  filterFeatureWorktrees,
  formatFeatureStatusBox,
  formatFeatureStatusMessage,
  formatStats,
  getFeatureDisplayName,
  getFeatureRefDisplay,
  getFeatureStatusBoxWidth,
  linkify,
  shouldEmitHyperlinks,
} from './status';
import type { WorktreeInfo, WorktreeStats } from '../lib/git';
import type { VcsDriver } from '../lib/vcs';
import type { RailConfig } from '../types/config';

describe('filterFeatureWorktrees', () => {
  const worktrees: WorktreeInfo[] = [
    { path: '/projects/app', head: 'abc', branch: 'refs/heads/main' },
    { path: '/projects/app/.trees/feat-a', head: 'def', branch: 'refs/heads/feature/feat-a' },
    { path: '/projects/app/.trees/feat-b', head: 'ghi', branch: 'refs/heads/feature/feat-b' },
  ];

  it('returns only worktrees inside trees dir', () => {
    const result = filterFeatureWorktrees(worktrees, '/projects/app/.trees');
    expect(result).toHaveLength(2);
    expect(result[0]!.path).toContain('feat-a');
    expect(result[1]!.path).toContain('feat-b');
  });

  it('tolerates a trailing slash on treesDir', () => {
    const result = filterFeatureWorktrees(worktrees, '/projects/app/.trees/');
    expect(result).toHaveLength(2);
  });

  it('returns empty array when no features match', () => {
    const result = filterFeatureWorktrees(worktrees, '/projects/app/.worktrees');
    expect(result).toEqual([]);
  });

  it('matches trees dirs outside the project root', () => {
    const external: WorktreeInfo[] = [
      { path: '/projects/app', head: 'abc', branch: 'refs/heads/main' },
      {
        path: '/Users/me/.rail/repos/app/temp',
        head: 'def',
        branch: 'refs/heads/feature/temp',
      },
    ];
    const result = filterFeatureWorktrees(external, '/Users/me/.rail/repos/app');
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('/Users/me/.rail/repos/app/temp');
  });

  it('does not match a sibling dir that shares a prefix', () => {
    const items: WorktreeInfo[] = [
      { path: '/foo/bar-other/feat', head: 'a', branch: 'refs/heads/feature/feat' },
    ];
    expect(filterFeatureWorktrees(items, '/foo/bar')).toEqual([]);
  });

  it('handles empty worktree list', () => {
    expect(filterFeatureWorktrees([], '/projects/app/.trees')).toEqual([]);
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

  it('renders clean and unknown states', () => {
    expect(formatStats(makeStats({ localState: 'clean' }), 'main', { hyperlinks: false })).toEqual(['clean']);
    expect(formatStats(makeStats({ localState: 'unknown' }), 'main', { hyperlinks: false })).toEqual(['unknown']);
  });

  it('formats tracked changes without insertions/deletions block', () => {
    const stats = makeStats({ fileCount: 2, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '± 2 files',
    ]);
  });

  it('formats tracked changes with insertions and deletions', () => {
    const stats = makeStats({
      fileCount: 3,
      insertions: 12,
      deletions: 5,
      isDirty: true,
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '± 3 files +12 -5',
    ]);
  });

  it('does not double count files with staged and unstaged changes', () => {
    const stats = makeStats({
      stagedFiles: 2,
      unstagedFiles: 1,
      fileCount: 2,
      insertions: 7,
      deletions: 0,
      isDirty: true,
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '± 2 files +7 -0',
    ]);
  });

  it('uses singular "file" when exactly one changed file', () => {
    const stats = makeStats({ stagedFiles: 1, fileCount: 1, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      '± 1 file',
    ]);
  });

  it('formats only untracked plural', () => {
    const stats = makeStats({ untrackedFiles: 2, fileCount: 2, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['+ 2 untracked']);
  });

  it('formats only untracked singular', () => {
    const stats = makeStats({ untrackedFiles: 1, fileCount: 1, isDirty: true });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['+ 1 untracked']);
  });

  it('formats only revisions since parent plural', () => {
    const stats = makeStats({ commitsAhead: 3 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['⇢ 3 revs']);
  });

  it('formats only revisions since parent singular', () => {
    const stats = makeStats({ commitsAhead: 1 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['⇢ 1 rev']);
  });

  it('renders ? when revision count is unknown', () => {
    const stats = makeStats({ commitsAhead: -1 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['⇢ ? revs']);
  });

  it('omits ahead line when commitsAhead is 0', () => {
    const stats = makeStats({ commitsAhead: 0 });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['clean']);
  });

  it('formats one open PR with a compact number label', () => {
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [{ number: 123, url: 'https://example.com/owner/repo/pull/123' }],
      },
    });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual([
      'PR #123',
    ]);
  });

  it('formats two open PRs as compact number labels', () => {
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
      'PRs #123 #456',
    ]);
  });

  it('formats three open PRs as compact number labels', () => {
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
      'PRs #1 #2 #3',
    ]);
  });

  it('renders ? open PRs when openPrs state is error', () => {
    const stats = makeStats({ openPrs: { state: 'error' } });
    expect(formatStats(stats, 'main', { hyperlinks: false })).toEqual(['? PRs']);
  });

  it('renders open reviews with MR labels when provided by the forge driver', () => {
    const stats = makeStats({
      openPrs: {
        state: 'ok',
        prs: [{ number: 123, url: 'https://gitlab.com/owner/repo/-/merge_requests/123' }],
      },
    });

    expect(formatStats(stats, 'main', {
      hyperlinks: false,
      reviewLabel: 'MR',
      reviewLabelPlural: 'MRs',
    })).toEqual(['MR #123']);
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
      '± 3 files +42 -7 | + 2 untracked | ⇢ 4 revs | PR #7',
    ]);
  });

  it('formats revision counts without parent names', () => {
    const stats = makeStats({ commitsAhead: 2 });
    expect(formatStats(stats, 'master', { hyperlinks: false })).toEqual(['⇢ 2 revs']);
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
      `PR ${linkify(url, '#123', true)}`,
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
      `PRs ${linkify(url1, '#123', true)} ${linkify(url2, '#456', true)}`,
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
      'PRs #123 #456',
    ]);
  });
});

describe('feature display helpers', () => {
  it('uses JJ feature labels with neutral revision wording', () => {
    const feature: WorktreeInfo = {
      path: '/repo/.trees/demo',
      head: 'feature/demo',
      branch: 'feature/demo',
      feature: 'demo',
      displayLabel: 'feature/demo',
      refLabel: 'Bookmark',
    };

    expect(getFeatureDisplayName(feature)).toBe('demo');
    expect(getFeatureRefDisplay(feature)).toEqual({ label: 'Revision', value: 'feature/demo' });
  });

  it('uses Git branch values with neutral revision wording', () => {
    const feature: WorktreeInfo = {
      path: '/repo/.trees/demo',
      head: 'abc',
      branch: 'refs/heads/feature/demo',
    };

    expect(getFeatureDisplayName(feature)).toBe('demo');
    expect(getFeatureRefDisplay(feature)).toEqual({ label: 'Revision', value: 'feature/demo' });
  });

  it('decodes normalized slash-separated feature directory names for display', () => {
    const feature: WorktreeInfo = {
      path: '/repo/.trees/feature+demo',
      head: 'abc',
      branch: 'refs/heads/feature/demo',
    };

    expect(getFeatureDisplayName(feature)).toBe('feature/demo');
  });
});

describe('formatFeatureStatusMessage', () => {
  it('formats a status box without trailing spacing between boxes', () => {
    expect(formatFeatureStatusBox('Feature:  demo\nChanges:  clean')).toBe(
      '╭───────────────────╮\n' +
      '│                   │\n' +
      '│  Feature:  demo   │\n' +
      '│  Changes:  clean  │\n' +
      '│                   │\n' +
      '╰───────────────────╯',
    );
  });

  it('formats feature boxes with a shared width from the largest box', () => {
    const shortMessage = 'Feature:  demo\nChanges:  clean';
    const longMessage = 'Feature:  much-longer-feature\nChanges:  ± 12 files +100 -2';
    const width = Math.max(
      getFeatureStatusBoxWidth(shortMessage),
      getFeatureStatusBoxWidth(longMessage),
    );

    const shortBox = formatFeatureStatusBox(shortMessage, width);
    const longBox = formatFeatureStatusBox(longMessage, width);

    expect(shortBox.split('\n')[0]).toBe(longBox.split('\n')[0]);
    expect(shortBox.split('\n').map((line) => line.length)).toEqual(
      longBox.split('\n').map((line) => line.length),
    );
  });

  it('formats feature details for boxed status output', () => {
    const config: RailConfig = {
      name: 'app',
      vcs: 'jj',
      forge: 'github',
      default_parent: 'main@origin',
      auto_refresh: true,
      setup: { track_rail: false, ignore_destination: 'gitignore' },
      worktrees: { dir: '/repo/.trees', branch_prefix: '' },
      port: { base: 3000, per_feature: 2, max: 100 },
    };

    const message = formatFeatureStatusMessage({
      wt: {
        path: '/repo/.trees/status',
        head: 'status',
        branch: 'status',
        feature: 'status',
        displayLabel: 'status',
        refLabel: 'Bookmark',
      },
      stats: {
        fileCount: 0,
        stagedFiles: 0,
        unstagedFiles: 0,
        untrackedFiles: 0,
        insertions: 0,
        deletions: 0,
        isDirty: false,
        commitsAhead: 0,
        openPrs: { state: 'unavailable' },
        localState: 'changed',
      },
    }, {
      allocations: { features: { status: { index: 1 } } },
      config,
      defaultBranch: 'main@origin',
      hyperlinks: false,
      forgeDriver: {
        reviewLabel: 'PR',
        reviewLabelPlural: 'PRs',
        getOpenReviews() {
          return Promise.resolve({ state: 'unavailable' });
        },
      },
    });

    expect(message).toBe(
      'Feature:  status\n' +
      'Revision: status\n' +
      'Ports:    3002, 3003\n' +
      'Path:     /repo/.trees/status\n' +
      'Changes:  clean',
    );
  });

  it('shortens home paths in status output', () => {
    const config: RailConfig = {
      name: 'app',
      vcs: 'jj',
      forge: 'github',
      default_parent: 'main@origin',
      auto_refresh: true,
      setup: { track_rail: false, ignore_destination: 'gitignore' },
      worktrees: { dir: join(homedir(), 'Projects/dotfiles/.trees'), branch_prefix: '' },
      port: { base: 3000, per_feature: 2, max: 100 },
    };

    const message = formatFeatureStatusMessage({
      wt: {
        path: join(homedir(), 'Projects/dotfiles/.trees/status'),
        head: 'status',
        branch: 'status',
        feature: 'status',
        displayLabel: 'status',
        refLabel: 'Bookmark',
      },
      stats: {
        fileCount: 0,
        stagedFiles: 0,
        unstagedFiles: 0,
        untrackedFiles: 0,
        insertions: 0,
        deletions: 0,
        isDirty: false,
        commitsAhead: 0,
        openPrs: { state: 'unavailable' },
        localState: 'changed',
      },
    }, {
      allocations: { features: { status: { index: 1 } } },
      config,
      defaultBranch: 'main@origin',
      hyperlinks: false,
      forgeDriver: {
        reviewLabel: 'PR',
        reviewLabelPlural: 'PRs',
        getOpenReviews() {
          return Promise.resolve({ state: 'unavailable' });
        },
      },
    });

    expect(message).toContain('Path:     ~/Projects/dotfiles/.trees/status');
    expect(message).not.toContain(homedir());
  });

  it('keeps compact status values on the aligned status row', () => {
    const config: RailConfig = {
      name: 'app',
      vcs: 'jj',
      forge: 'github',
      default_parent: 'main@origin',
      auto_refresh: true,
      setup: { track_rail: false, ignore_destination: 'gitignore' },
      worktrees: { dir: '/repo/.trees', branch_prefix: '' },
      port: { base: 3000, per_feature: 2, max: 100 },
    };

    const message = formatFeatureStatusMessage({
      wt: {
        path: '/repo/.trees/status',
        head: 'status',
        branch: 'status',
        feature: 'status',
        displayLabel: 'status',
        refLabel: 'Bookmark',
      },
      stats: {
        fileCount: 2,
        stagedFiles: 2,
        unstagedFiles: 0,
        untrackedFiles: 0,
        insertions: 3,
        deletions: 1,
        isDirty: true,
        commitsAhead: 1,
        openPrs: { state: 'unavailable' },
      },
    }, {
      allocations: { features: { status: { index: 1 } } },
      config,
      defaultBranch: 'main@origin',
      hyperlinks: false,
      forgeDriver: {
        reviewLabel: 'PR',
        reviewLabelPlural: 'PRs',
        getOpenReviews() {
          return Promise.resolve({ state: 'unavailable' });
        },
      },
    });

    expect(message).toBe(
      'Feature:  status\n' +
      'Revision: status\n' +
      'Ports:    3002, 3003\n' +
      'Path:     /repo/.trees/status\n' +
      'Changes:  ± 2 files +3 -1 | ⇢ 1 rev',
    );
  });
});

describe('collectStats', () => {
  it('hands the JJ bookmark name to the forge lookup', async () => {
    const reviewCalls: Array<{ path: string; head: string }> = [];
    const statusCalls: Array<{ path: string; branch: string | undefined }> = [];
    const stats: WorktreeStats = {
      fileCount: 0,
      stagedFiles: 0,
      unstagedFiles: 0,
      untrackedFiles: 0,
      insertions: 0,
      deletions: 0,
      isDirty: false,
      commitsAhead: 0,
      openPrs: { state: 'unavailable' },
      localState: 'clean',
    };
    const driver = {
      getLocalFeatureStatus(path: string, options: { branch?: string }) {
        statusCalls.push({ path, branch: options.branch });
        return Promise.resolve(stats);
      },
    } as VcsDriver;

    await collectStats([
      {
        path: '/repo/.trees/demo',
        head: 'feature/demo',
        branch: 'feature/demo',
        refLabel: 'Bookmark',
      },
    ], {
      defaultBranch: 'main@origin',
      vcsDriver: driver,
      forgeAvailable: true,
      forgeDriver: {
        reviewLabel: 'PR',
        reviewLabelPlural: 'PRs',
        getOpenReviews(path: string, head: string) {
          reviewCalls.push({ path, head });
          return Promise.resolve({ state: 'ok' as const, reviews: [] });
        },
      },
    });

    expect(statusCalls).toEqual([{ path: '/repo/.trees/demo', branch: 'feature/demo' }]);
    expect(reviewCalls).toEqual([{ path: '/repo/.trees/demo', head: 'feature/demo' }]);
  });
});

describe('linkify', () => {
  it('returns the visible text unchanged when hyperlinks is false', () => {
    expect(linkify('https://example.com/x', 'PR #123', false)).toBe('PR #123');
  });

  it('wraps visible text in OSC 8 escape sequences when hyperlinks is true', () => {
    expect(linkify('https://example.com/x', 'PR #123', true)).toBe(
      '\x1b]8;;https://example.com/x\x1b\\PR #123\x1b]8;;\x1b\\',
    );
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
