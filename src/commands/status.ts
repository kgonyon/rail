import { defineCommand } from 'citty';
import consola from 'consola';
import { basename } from 'path';
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

    const renders = await collectStats(features, { defaultBranch, ghAvailable });
    for (const render of renders) {
      printFeatureStatus(render, allocations, config, defaultBranch);
    }
  },
});

/** @internal */
export function filterFeatureWorktrees(worktrees: WorktreeInfo[], treesDir: string): WorktreeInfo[] {
  return worktrees.filter((wt) => wt.path.includes(`/${treesDir}/`));
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
 * Format worktree stats for display.
 * Returns one line per non-zero category, in fixed order:
 * changes -> untracked -> ahead -> PR. Returns `['clean']` when truly clean.
 * @internal
 */
export function formatStats(stats: WorktreeStats, defaultBranch: string): string[] {
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

  if (stats.openPrCount !== null) {
    if (stats.openPrCount > 0) {
      const noun = stats.openPrCount === 1 ? 'PR' : 'PRs';
      lines.push(`${stats.openPrCount} open ${noun}`);
    } else if (stats.openPrCount === -1) {
      lines.push('? open PRs');
    }
  }

  if (lines.length === 0) return ['clean'];
  return lines;
}

interface FeatureRender {
  wt: WorktreeInfo;
  stats: WorktreeStats;
}

function printFeatureStatus(
  render: FeatureRender,
  allocations: PortAllocations,
  config: RailConfig,
  defaultBranch: string,
): void {
  const { wt, stats } = render;
  const feature = basename(wt.path);
  const allocation = allocations.features[feature];
  const ports = allocation
    ? getPortsForFeature(config.port, allocation.index)
    : [];
  const branchName = wt.branch.replace('refs/heads/', '');
  const portStr = ports.length > 0 ? ports.join(', ') : 'unallocated';
  const lines = formatStats(stats, defaultBranch);

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
