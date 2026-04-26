import { defineCommand } from 'citty';
import consola from 'consola';
import { basename } from 'path';
import { isatty } from 'tty';
import { getGitRoot, isRailProject } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadPortAllocations, getPortsForFeature } from '../lib/ports';
import { listWorktrees, getWorktreeStats, getDefaultBranch, isGhAvailable } from '../lib/git';
import type { WorktreeInfo, WorktreeStats } from '../lib/git';
import type { PortAllocations, RailConfig } from '../types/config';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show all active feature worktrees with branch, port, and dirty state',
  },
  async run() {
    const root = await getGitRoot();

    if (!isRailProject(root)) {
      consola.warn('Not a rail project. Run `rail init` to initialize.');
      return;
    }

    const config = loadConfig(root);
    const allocations = loadPortAllocations(root);
    const worktrees = await listWorktrees(root);
    const treesDir = config.worktrees.dir.replace(/\/$/, '');

    const features = filterFeatureWorktrees(worktrees, treesDir);

    if (features.length === 0) {
      consola.info('No active feature worktrees');
      return;
    }

    const defaultBranch = await getDefaultBranch(root);
    const ghAvailable = await isGhAvailable();
    if (!ghAvailable) {
      consola.warn('gh CLI unavailable; PR counts will be skipped');
    }

    consola.info(`Active features (${features.length}):\n`);

    const hyperlinks = shouldEmitHyperlinks();
    const renders = await collectStats(features, { defaultBranch, ghAvailable });
    for (const render of renders) {
      printFeatureStatus(render, { allocations, config, defaultBranch, hyperlinks });
    }
  },
});

/** @internal */
export function filterFeatureWorktrees(worktrees: WorktreeInfo[], treesDir: string): WorktreeInfo[] {
  return worktrees.filter((wt) => wt.path.includes(`/${treesDir}/`));
}

/**
 * Decide whether to emit OSC 8 hyperlink escapes.
 *
 * `RAIL_HYPERLINKS=always|never` overrides detection. Otherwise we treat
 * stdout as a TTY when either `tty.isatty(1)` or `process.stdout.isTTY` is
 * truthy — Bun returns `undefined` from `process.stdout.isTTY` even on real
 * TTYs in some build modes, so we need both checks.
 * @internal
 */
export function shouldEmitHyperlinks(env = process.env): boolean {
  const override = env.RAIL_HYPERLINKS?.toLowerCase();
  if (override === 'always') return true;
  if (override === 'never') return false;
  if (isatty(1)) return true;
  return process.stdout.isTTY === true;
}

interface CollectStatsOptions {
  defaultBranch: string;
  ghAvailable: boolean;
}

const STATS_CONCURRENCY = 8;

async function collectStats(
  features: WorktreeInfo[],
  options: CollectStatsOptions,
): Promise<FeatureRender[]> {
  const results: FeatureRender[] = new Array(features.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= features.length) return;
      const wt = features[i]!;
      const stats = await getWorktreeStats(wt.path, {
        defaultBranch: options.defaultBranch,
        branch: wt.branch,
        ghAvailable: options.ghAvailable,
      });
      results[i] = { wt, stats };
    }
  }
  const workerCount = Math.min(STATS_CONCURRENCY, features.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Wrap a URL in OSC 8 hyperlink escapes when `hyperlinks` is true.
 * Visible text is the URL itself so users see what they're clicking.
 * @internal
 */
export function linkify(url: string, hyperlinks: boolean): string {
  if (!hyperlinks) return url;
  return `\x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`;
}

/**
 * Format worktree stats for display.
 * Returns one line per non-zero category, in fixed order:
 * changes -> untracked -> ahead -> PR. Returns `['clean']` when truly clean.
 * @internal
 */
export function formatStats(
  stats: WorktreeStats,
  defaultBranch: string,
  options: { hyperlinks: boolean },
): string[] {
  const lines: string[] = [];
  const changedTotal = stats.stagedFiles + stats.unstagedFiles;

  if (changedTotal > 0) {
    const noun = changedTotal === 1 ? 'file' : 'files';
    let line = `${changedTotal} ${noun} changed (${stats.stagedFiles} staged, ${stats.unstagedFiles} unstaged)`;
    if (stats.insertions > 0 || stats.deletions > 0) {
      line += `  +${stats.insertions} -${stats.deletions}`;
    }
    lines.push(line);
  }

  if (stats.untrackedFiles > 0) {
    const noun = stats.untrackedFiles === 1 ? 'file' : 'files';
    lines.push(`${stats.untrackedFiles} untracked ${noun}`);
  }

  if (stats.commitsAhead > 0) {
    const noun = stats.commitsAhead === 1 ? 'commit' : 'commits';
    lines.push(`${stats.commitsAhead} ${noun} ahead of ${defaultBranch}`);
  } else if (stats.commitsAhead === -1) {
    lines.push(`? commits ahead of ${defaultBranch}`);
  }

  appendPrLines(lines, stats.openPrs, options.hyperlinks);

  if (lines.length === 0) return ['clean'];
  return lines;
}

function appendPrLines(
  lines: string[],
  openPrs: WorktreeStats['openPrs'],
  hyperlinks: boolean,
): void {
  switch (openPrs.state) {
    case 'unavailable':
      return;
    case 'error':
      lines.push('? open PRs');
      return;
    case 'ok': {
      const { prs } = openPrs;
      if (prs.length === 0) return;
      if (prs.length === 1) {
        lines.push(`1 open PR: ${linkify(prs[0]!.url, hyperlinks)}`);
        return;
      }
      lines.push(`${prs.length} open PRs:`);
      for (const pr of prs) {
        lines.push(`  #${pr.number} ${linkify(pr.url, hyperlinks)}`);
      }
      return;
    }
  }
}

interface FeatureRender {
  wt: WorktreeInfo;
  stats: WorktreeStats;
}

interface PrintFeatureOptions {
  allocations: PortAllocations;
  config: RailConfig;
  defaultBranch: string;
  hyperlinks: boolean;
}

function printFeatureStatus(render: FeatureRender, options: PrintFeatureOptions): void {
  const { wt, stats } = render;
  const { allocations, config, defaultBranch, hyperlinks } = options;
  const feature = basename(wt.path);
  const allocation = allocations.features[feature];
  const ports = allocation
    ? getPortsForFeature(config.port, allocation.index)
    : [];
  const branchName = wt.branch.replace('refs/heads/', '');
  const portStr = ports.length > 0 ? ports.join(', ') : 'unallocated';
  const lines = formatStats(stats, defaultBranch, { hyperlinks });

  console.log(`  ${feature}`);
  console.log(`    Branch: ${branchName}`);
  console.log(`    Ports:  ${portStr}`);
  if (lines.length === 1) {
    console.log(`    Status: ${lines[0]}`);
  } else {
    console.log(`    Status:`);
    for (const line of lines) {
      console.log(`      ${line}`);
    }
  }
  console.log('');
}
