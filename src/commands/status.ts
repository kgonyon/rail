import { defineCommand } from 'citty';
import consola from 'consola';
import { basename } from 'path';
import { isatty } from 'tty';
import { formatPathForDisplay, getFeatureNameFromDirName, resolveRailRuntime } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadFeatureAllocations, getPortsForFeature } from '../lib/ports';
import { getForgeDriver } from '../lib/forge';
import { getVcsDriver } from '../lib/vcs';
import type { VcsDriver, VcsFeature, VcsFeatureStatus } from '../lib/vcs';
import type { ForgeDriver, OpenReviewsResult } from '../lib/forge';
import type { FeatureAllocations, RailConfig } from '../types/config';

export default defineCommand({
  meta: {
    name: 'status',
    description: 'Show all active feature worktrees with branch, port, and dirty state',
  },
  args: {
    parent: {
      type: 'string',
      description: 'Parent ref to compare feature changes against',
    },
  },
  async run({ args }) {
    const runtime = await resolveRailRuntime();
    const root = runtime.parentRoot;
    const config = loadConfig({ parentRoot: runtime.parentRoot, configRoot: runtime.configRoot });
    const vcsDriver = getVcsDriver(config.vcs);
    const allocations = loadFeatureAllocations(runtime.allocationsRoot);
    const worktrees = await vcsDriver.listFeatures(root);

    const features = filterFeatureWorktrees(worktrees, allocations, config, root);

    if (features.length === 0) {
      consola.info('No active feature worktrees');
      return;
    }

    const defaultBranch = await resolveStatusParent(config, vcsDriver, root, args.parent);
    const forgeDriver = getForgeDriver(config.forge);
    const forgeAvailable = forgeDriver.isAvailable
      ? await forgeDriver.isAvailable()
      : false;
    if (!forgeAvailable && forgeDriver.unavailableWarning) {
      consola.warn(forgeDriver.unavailableWarning);
    }

    consola.info(`Active features (${features.length}):`);

    const hyperlinks = shouldEmitHyperlinks();
    const renders = await collectStats(features, {
      defaultBranch,
      vcsDriver,
      forgeDriver,
      forgeAvailable,
    });
    printFeatureStatuses(renders, {
      allocations,
      config,
      defaultBranch,
      hyperlinks,
      forgeDriver,
    });
  },
});

/** @internal */
export async function resolveStatusParent(
  config: RailConfig,
  vcsDriver: VcsDriver,
  root: string,
  explicitParent?: string,
): Promise<string> {
  if (explicitParent) return explicitParent;
  if (config.vcs === 'jj') return config.default_parent;
  return `origin/${await vcsDriver.getDefaultParent(root)}`;
}

/** @internal */
export function filterFeatureWorktrees(
  worktrees: VcsFeature[],
  allocationsOrTreesDir: FeatureAllocations | string,
  config?: RailConfig,
  parentRoot?: string,
): VcsFeature[] {
  if (typeof allocationsOrTreesDir === 'string') {
    const prefix = `${allocationsOrTreesDir.replace(/\/$/, '')}/`;
    return worktrees.filter((wt) => wt.path.startsWith(prefix));
  }

  const allocations = allocationsOrTreesDir;
  const allocatedPaths = new Map<string, string>();
  for (const [feature, allocation] of Object.entries(allocations.features)) {
    if (allocation.path) allocatedPaths.set(normalizePath(allocation.path), feature);
  }

  return worktrees.flatMap((wt) => {
    if (parentRoot && normalizePath(wt.path) === normalizePath(parentRoot)) return [];

    const feature = getFeatureForWorktree(wt, allocations, allocatedPaths, config);
    return feature ? [{ ...wt, feature }] : [];
  });
}

function getFeatureForWorktree(
  wt: VcsFeature,
  allocations: FeatureAllocations,
  allocatedPaths: Map<string, string>,
  config?: RailConfig,
): string | null {
  const allocatedFeature = allocatedPaths.get(normalizePath(wt.path));
  if (allocatedFeature) return allocatedFeature;

  const branch = wt.branch.replace(/^refs\/heads\//, '');
  const branchPrefix = config?.worktrees.branch_prefix ?? '';
  for (const feature of Object.keys(allocations.features)) {
    if (`${branchPrefix}${feature}` === branch) return feature;
  }

  if (wt.feature && allocations.features[wt.feature]) return wt.feature;
  return null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/$/, '');
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
export function linkify(url: string, text: string, hyperlinks: boolean): string {
  if (!hyperlinks) return text;
  return `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\`;
}

/**
 * Format worktree stats for display.
 * Returns one compact line with non-zero segments in fixed order:
 * changes -> untracked -> revisions -> reviews. Returns `['clean']` when truly clean.
 * @internal
 */
export function formatStats(
  stats: VcsFeatureStatus,
  _defaultBranch: string,
  options: {
    hyperlinks: boolean;
    reviewLabel?: string;
    reviewLabelPlural?: string;
  },
): string[] {
  if (stats.localState === 'unknown') return ['unknown'];

  const segments: string[] = [];
  const changedTotal = Math.max(0, stats.fileCount - stats.untrackedFiles);

  if (changedTotal > 0) {
    const noun = changedTotal === 1 ? 'file' : 'files';
    let segment = `± ${changedTotal} ${noun}`;
    if (stats.insertions > 0 || stats.deletions > 0) {
      segment += ` +${stats.insertions} -${stats.deletions}`;
    }
    segments.push(segment);
  }

  if (stats.untrackedFiles > 0) {
    segments.push(`+ ${stats.untrackedFiles} untracked`);
  }

  if (stats.commitsAhead > 0) {
    const noun = stats.commitsAhead === 1 ? 'rev' : 'revs';
    segments.push(`⇢ ${stats.commitsAhead} ${noun}`);
  } else if (stats.commitsAhead === -1) {
    segments.push('⇢ ? revs');
  }

  appendReviewSegments(segments, stats.openPrs, {
    hyperlinks: options.hyperlinks,
    reviewLabel: options.reviewLabel ?? 'PR',
    reviewLabelPlural: options.reviewLabelPlural ?? 'PRs',
  });

  if (segments.length === 0) return ['clean'];
  return [segments.join(' | ')];
}

function appendReviewSegments(
  segments: string[],
  openPrs: VcsFeatureStatus['openPrs'],
  options: { hyperlinks: boolean; reviewLabel: string; reviewLabelPlural: string },
): void {
  switch (openPrs.state) {
    case 'unavailable':
      return;
    case 'error':
      segments.push(`? ${options.reviewLabelPlural}`);
      return;
    case 'ok': {
      const { prs } = openPrs;
      if (prs.length === 0) return;
      if (prs.length === 1) {
        const pr = prs[0]!;
        segments.push(`${options.reviewLabel} ${linkify(pr.url, `#${pr.number}`, options.hyperlinks)}`);
        return;
      }
      const links = prs.map((pr) => linkify(pr.url, `#${pr.number}`, options.hyperlinks));
      segments.push(`${options.reviewLabelPlural} ${links.join(' ')}`);
      return;
    }
  }
}

export interface FeatureRender {
  wt: VcsFeature;
  stats: VcsFeatureStatus;
}

export interface PrintFeatureOptions {
  allocations: FeatureAllocations;
  config: RailConfig;
  defaultBranch: string;
  hyperlinks: boolean;
  forgeDriver: ForgeDriver;
}

function printFeatureStatuses(renders: FeatureRender[], options: PrintFeatureOptions): void {
  const messages = renders.map((render) => formatFeatureStatusMessage(render, options));
  const width = Math.max(...messages.map(getFeatureStatusBoxWidth));
  const boxes = messages.map((message) => formatFeatureStatusBox(message, width));
  consola.log(boxes.join('\n'));
}

/** @internal */
export function formatFeatureStatusBox(message: string, boxWidth?: number): string {
  const lines = message.split('\n');
  const width = Math.max(boxWidth ?? 0, getFeatureStatusBoxWidth(message));
  return [
    `╭${'─'.repeat(width)}╮`,
    `│${' '.repeat(width)}│`,
    ...lines.map((line) => formatBoxLine(line, width)),
    `│${' '.repeat(width)}│`,
    `╰${'─'.repeat(width)}╯`,
  ].join('\n');
}

/** @internal */
export function getFeatureStatusBoxWidth(message: string): number {
  return Math.max(...message.split('\n').map(visibleLength)) + 4;
}

function formatBoxLine(line: string, width: number): string {
  const padding = ' '.repeat(width - visibleLength(line) - 2);
  return `│  ${line}${padding}│`;
}

function visibleLength(line: string): number {
  return line
    .replace(/\x1b\]8;;.*?\x1b\\/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .length;
}

/** @internal */
export function formatFeatureStatusMessage(render: FeatureRender, options: PrintFeatureOptions): string {
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

  return [
    formatStatusField('Feature', feature),
    formatStatusField(refDisplay.label, refDisplay.value),
    formatStatusField('Ports', portStr),
    formatStatusField('Path', formatPathForDisplay(wt.path)),
    ...formatStatusMessageLines(lines),
  ].join('\n');
}

const STATUS_FIELD_LABEL_WIDTH = 8;

function formatStatusField(label: string, value: string): string {
  const padding = ' '.repeat(Math.max(1, STATUS_FIELD_LABEL_WIDTH - label.length + 1));
  return `${label}:${padding}${value}`;
}

function formatStatusMessageLines(lines: string[]): string[] {
  if (lines.length === 1) return [formatStatusField('Changes', lines[0]!)];
  return ['Changes:', ...lines.map((line) => `  ${line}`)];
}

/** @internal */
export function getFeatureDisplayName(wt: VcsFeature): string {
  return wt.feature ?? getFeatureNameFromDirName(basename(wt.path));
}

/** @internal */
export function getFeatureRefDisplay(wt: VcsFeature): { label: string; value: string } {
  return {
    label: 'Revision',
    value: (wt.displayLabel ?? wt.branch).replace('refs/heads/', ''),
  };
}
