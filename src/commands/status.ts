import { defineCommand } from 'citty';
import consola from 'consola';
import { basename } from 'path';
import { isatty } from 'tty';
import { getFeatureNameFromDirName, isRailProject } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadPortAllocations, getPortsForFeature } from '../lib/ports';
import { getForgeDriver } from '../lib/forge';
import { getVcsDriver, gitVcsDriver } from '../lib/vcs';
import type { VcsDriver, VcsFeature, VcsFeatureStatus } from '../lib/vcs';
import type { ForgeDriver, OpenReviewsResult } from '../lib/forge';
import type { PortAllocations, RailConfig } from '../types/config';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show all active feature worktrees with branch, port, and dirty state',
  },
  async run() {
    const root = await gitVcsDriver.resolveProjectRoot();

    if (!isRailProject(root)) {
      consola.warn('Not a rail project. Run `rail init` to initialize.');
      return;
    }

    const config = loadConfig(root);
    const vcsDriver = getVcsDriver(config.vcs);
    const allocations = loadPortAllocations(root);
    const worktrees = await vcsDriver.listFeatures(root);
    const treesDir = config.worktrees.dir.replace(/\/$/, '');

    const features = filterFeatureWorktrees(worktrees, treesDir);

    if (features.length === 0) {
      consola.info('No active feature worktrees');
      return;
    }

    const defaultBranch = await vcsDriver.getDefaultParent(root);
    const forgeDriver = getForgeDriver(config.forge);
    const forgeAvailable = forgeDriver.isAvailable
      ? await forgeDriver.isAvailable()
      : false;
    if (!forgeAvailable && forgeDriver.unavailableWarning) {
      consola.warn(forgeDriver.unavailableWarning);
    }

    consola.info(`Active features (${features.length}):\n`);

    const hyperlinks = shouldEmitHyperlinks();
    const renders = await collectStats(features, {
      defaultBranch,
      vcsDriver,
      forgeDriver,
      forgeAvailable,
    });
    for (const render of renders) {
      printFeatureStatus(render, {
        allocations,
        config,
        defaultBranch,
        hyperlinks,
        forgeDriver,
      });
    }
  },
});

/** @internal */
export function filterFeatureWorktrees(worktrees: VcsFeature[], treesDir: string): VcsFeature[] {
  const prefix = `${treesDir.replace(/\/$/, '')}/`;
  return worktrees.filter((wt) => wt.path.startsWith(prefix));
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
  vcsDriver: VcsDriver;
  forgeDriver: ForgeDriver;
  forgeAvailable: boolean;
}

const STATS_CONCURRENCY = 8;

/** @internal */
export async function collectStats(
  features: VcsFeature[],
  options: CollectStatsOptions,
): Promise<FeatureRender[]> {
  const results: FeatureRender[] = new Array(features.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= features.length) return;
      const wt = features[i]!;
      const stats = await options.vcsDriver.getLocalFeatureStatus(wt.path, {
        defaultBranch: options.defaultBranch,
        branch: wt.branch,
      });
      const reviewHead = wt.branch || wt.head;
      const openPrs = options.forgeAvailable
        ? toOpenPrsResult(
            await options.forgeDriver.getOpenReviews(wt.path, reviewHead),
          )
        : { state: 'unavailable' as const };
      stats.openPrs = openPrs;
      results[i] = { wt, stats };
    }
  }
  const workerCount = Math.min(STATS_CONCURRENCY, features.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function toOpenPrsResult(result: OpenReviewsResult): VcsFeatureStatus['openPrs'] {
  switch (result.state) {
    case 'unavailable':
      return { state: 'unavailable' };
    case 'error':
      return { state: 'error' };
    case 'ok':
      return { state: 'ok', prs: result.reviews };
  }
}

/**
 * Wrap a URL in OSC 8 hyperlink escapes when `hyperlinks` is true.
 * Visible text is the URL itself so users see what they're clicking.
 *
 * Modern tmux (3.4+) forwards OSC 8 natively when `allow-passthrough on`,
 * so no DCS wrapping is needed. Older tmux strips OSC 8 entirely; the
 * fix there is to upgrade tmux or set `RAIL_HYPERLINKS=never`.
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
  stats: VcsFeatureStatus,
  defaultBranch: string,
  options: {
    hyperlinks: boolean;
    reviewLabel?: string;
    reviewLabelPlural?: string;
  },
): string[] {
  if (stats.localState === 'unknown') return ['unknown'];
  if (stats.localState === 'changed') return ['changed'];

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

  appendPrLines(lines, stats.openPrs, {
    hyperlinks: options.hyperlinks,
    reviewLabel: options.reviewLabel ?? 'PR',
    reviewLabelPlural: options.reviewLabelPlural ?? 'PRs',
  });

  if (lines.length === 0) return ['clean'];
  return lines;
}

function appendPrLines(
  lines: string[],
  openPrs: VcsFeatureStatus['openPrs'],
  options: { hyperlinks: boolean; reviewLabel: string; reviewLabelPlural: string },
): void {
  switch (openPrs.state) {
    case 'unavailable':
      return;
    case 'error':
      lines.push(`? open ${options.reviewLabelPlural}`);
      return;
    case 'ok': {
      const { prs } = openPrs;
      if (prs.length === 0) return;
      if (prs.length === 1) {
        lines.push(
          `1 open ${options.reviewLabel}: ${linkify(prs[0]!.url, options.hyperlinks)}`,
        );
        return;
      }
      lines.push(`${prs.length} open ${options.reviewLabelPlural}:`);
      for (const pr of prs) {
        lines.push(`  #${pr.number} ${linkify(pr.url, options.hyperlinks)}`);
      }
      return;
    }
  }
}

interface FeatureRender {
  wt: VcsFeature;
  stats: VcsFeatureStatus;
}

interface PrintFeatureOptions {
  allocations: PortAllocations;
  config: RailConfig;
  defaultBranch: string;
  hyperlinks: boolean;
  forgeDriver: ForgeDriver;
}

function printFeatureStatus(render: FeatureRender, options: PrintFeatureOptions): void {
  const { wt, stats } = render;
  const { allocations, config, defaultBranch, hyperlinks, forgeDriver } = options;
  const feature = getFeatureDisplayName(wt);
  const allocation = allocations.features[feature];
  const ports = allocation
    ? getPortsForFeature(config.port, allocation.index)
    : [];
  const refDisplay = getFeatureRefDisplay(wt);
  const portStr = ports.length > 0 ? ports.join(', ') : 'unallocated';
  const lines = formatStats(stats, defaultBranch, {
    hyperlinks,
    reviewLabel: forgeDriver.reviewLabel,
    reviewLabelPlural: forgeDriver.reviewLabelPlural,
  });

  console.log(`  ${feature}`);
  console.log(`    ${refDisplay.label}: ${refDisplay.value}`);
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

/** @internal */
export function getFeatureDisplayName(wt: VcsFeature): string {
  return wt.feature ?? getFeatureNameFromDirName(basename(wt.path));
}

/** @internal */
export function getFeatureRefDisplay(wt: VcsFeature): { label: string; value: string } {
  return {
    label: wt.refLabel ?? 'Branch',
    value: (wt.displayLabel ?? wt.branch).replace('refs/heads/', ''),
  };
}
