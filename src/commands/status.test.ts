import { describe, it, expect } from 'bun:test';
import { filterFeatureWorktrees, formatStats } from './status';
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
      openPrCount: 0,
      ...overrides,
    };
  }

  it('returns ["clean"] when all categories are zero', () => {
    expect(formatStats(makeStats(), 'main')).toEqual(['clean']);
  });

  it('formats only-staged changes without insertions/deletions block', () => {
    const stats = makeStats({ stagedFiles: 2, fileCount: 2, isDirty: true });
    expect(formatStats(stats, 'main')).toEqual([
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
    expect(formatStats(stats, 'main')).toEqual([
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
    expect(formatStats(stats, 'main')).toEqual([
      '3 files changed (2 staged, 1 unstaged)  +7 -0',
    ]);
  });

  it('uses singular "file" when exactly one changed file', () => {
    const stats = makeStats({ stagedFiles: 1, fileCount: 1, isDirty: true });
    expect(formatStats(stats, 'main')).toEqual([
      '1 file changed (1 staged, 0 unstaged)',
    ]);
  });

  it('formats only untracked plural', () => {
    const stats = makeStats({ untrackedFiles: 2, fileCount: 2, isDirty: true });
    expect(formatStats(stats, 'main')).toEqual(['2 untracked files']);
  });

  it('formats only untracked singular', () => {
    const stats = makeStats({ untrackedFiles: 1, fileCount: 1, isDirty: true });
    expect(formatStats(stats, 'main')).toEqual(['1 untracked file']);
  });

  it('formats only commits ahead plural', () => {
    const stats = makeStats({ commitsAhead: 3 });
    expect(formatStats(stats, 'main')).toEqual(['3 commits ahead of main']);
  });

  it('formats only commits ahead singular', () => {
    const stats = makeStats({ commitsAhead: 1 });
    expect(formatStats(stats, 'main')).toEqual(['1 commit ahead of main']);
  });

  it('renders ? when commitsAhead is -1 sentinel', () => {
    const stats = makeStats({ commitsAhead: -1 });
    expect(formatStats(stats, 'main')).toEqual(['? commits ahead of main']);
  });

  it('omits ahead line when commitsAhead is 0', () => {
    const stats = makeStats({ commitsAhead: 0 });
    expect(formatStats(stats, 'main')).toEqual(['clean']);
  });

  it('formats only PR singular as "1 open PR"', () => {
    const stats = makeStats({ openPrCount: 1 });
    expect(formatStats(stats, 'main')).toEqual(['1 open PR']);
  });

  it('formats only PR plural as "N open PRs"', () => {
    const stats = makeStats({ openPrCount: 2 });
    expect(formatStats(stats, 'main')).toEqual(['2 open PRs']);
  });

  it('renders ? when openPrCount is -1 sentinel', () => {
    const stats = makeStats({ openPrCount: -1 });
    expect(formatStats(stats, 'main')).toEqual(['? open PRs']);
  });

  it('omits PR line when openPrCount is null (gh unavailable)', () => {
    const stats = makeStats({ openPrCount: null });
    expect(formatStats(stats, 'main')).toEqual(['clean']);
  });

  it('omits PR line when openPrCount is 0', () => {
    const stats = makeStats({ openPrCount: 0 });
    expect(formatStats(stats, 'main')).toEqual(['clean']);
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
      openPrCount: 1,
    });
    expect(formatStats(stats, 'main')).toEqual([
      '3 files changed (2 staged, 1 unstaged)  +42 -7',
      '2 untracked files',
      '4 commits ahead of main',
      '1 open PR',
    ]);
  });

  it('propagates a non-default branch name into the ahead line', () => {
    const stats = makeStats({ commitsAhead: 2 });
    expect(formatStats(stats, 'master')).toEqual(['2 commits ahead of master']);
  });
});
