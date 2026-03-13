import { defineCommand } from 'citty';
import consola from 'consola';
import { basename } from 'path';
import { getGitRoot, isRailProject } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadPortAllocations, getPortsForFeature } from '../lib/ports';
import { listWorktrees, getWorktreeStats } from '../lib/git';
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

    consola.info(`Active features (${features.length}):\n`);

    for (const wt of features) {
      await printFeatureStatus(wt, allocations, config);
    }
  },
});

/** @internal */
export function filterFeatureWorktrees(worktrees: WorktreeInfo[], treesDir: string): WorktreeInfo[] {
  return worktrees.filter((wt) => wt.path.includes(`/${treesDir}/`));
}

/**
 * Format worktree stats for display.
 * Returns `"N changed  +X -Y"` when dirty, `"clean"` otherwise.
 * @internal
 */
export function formatStats(stats: WorktreeStats): string {
  if (!stats.isDirty) return 'clean';
  if (stats.fileCount === 0 && stats.insertions === 0 && stats.deletions === 0) {
    return 'clean';
  }
  return `${stats.fileCount} changed  +${stats.insertions} -${stats.deletions}`;
}

async function printFeatureStatus(
  wt: WorktreeInfo,
  allocations: PortAllocations,
  config: RailConfig,
): Promise<void> {
  const feature = basename(wt.path);
  const allocation = allocations.features[feature];
  const ports = allocation
    ? getPortsForFeature(config.port, allocation.index)
    : [];
  const stats = await getWorktreeStats(wt.path);

  const branchName = wt.branch.replace('refs/heads/', '');
  const portStr = ports.length > 0 ? ports.join(', ') : 'unallocated';

  console.log(`  ${feature}`);
  console.log(`    Branch: ${branchName}`);
  console.log(`    Ports:  ${portStr}`);
  console.log(`    Status: ${formatStats(stats)}`);
  console.log('');
}
