import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { formatPathForDisplay, getWorktreePath } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadPortAllocations, getPortsForFeature, deallocatePorts } from '../lib/ports';
import { getVcsDriver, gitVcsDriver } from '../lib/vcs';
import { resolveFeature } from '../lib/detect';
import { runHooks } from '../lib/hooks';
import { runScript } from '../lib/script';
import type { ScriptContext } from '../lib/script';
import type { VcsDriver } from '../lib/vcs';
import type { PortConfig } from '../types/config';
import type { RailConfig } from '../types/config';

export default defineCommand({
  meta: {
    name: 'down',
    description: 'Remove a feature worktree and deallocate ports',
  },
  args: {
    feature: {
      type: 'positional',
      description: 'Feature name (auto-detected if inside a worktree)',
      required: false,
    },
    prune: {
      type: 'boolean',
      description: 'Delete the feature branch or bookmark after removing the worktree',
    },
  },
  async run({ args }) {
    const root = await gitVcsDriver.resolveProjectRoot();
    const config = loadConfig(root);
    const vcsDriver = getVcsDriver(config.vcs);

    const feature = resolveFeature(args.feature as string | undefined, config.worktrees.dir);
    const treePath = getWorktreePath(config.worktrees.dir, feature);
    const target = await getDownTarget({ root, config, vcsDriver, feature, treePath });
    validateDownTarget(target, Boolean(args.prune));

    const context: ScriptContext = {
      root,
      feature,
      featureDir: treePath,
      projectName: config.name,
      ports: target.ports,
      basePort: target.ports[0] ?? 0,
    };

    consola.start(`Tearing down feature: ${feature}`);

    if (target.hasTree) {
      await runHooks('down', context);

      if (config.scripts?.cleanup) {
        consola.info('Running cleanup script...');
        await runScript(config.scripts.cleanup, context);
      }

      await vcsDriver.removeFeature(root, treePath, feature);
      consola.info('Removed worktree');
      if (await removeRemainingFeatureTree(treePath)) {
        consola.info('Removed leftover feature directory');
      }
    } else {
      consola.info('No worktree found; continuing prune cleanup');
    }

    if (target.hasPortAllocation) {
      deallocatePorts(root, feature);
      consola.info('Deallocated ports');
    }

    if (args.prune) {
      if (target.hasFeatureRef) {
        await vcsDriver.pruneFeature(root, target.branchPrefix, feature);
        consola.info('Pruned feature ref');
      } else {
        consola.info('No feature ref to prune');
      }
    }

    consola.success(`Feature "${feature}" has been removed`);
  },
});

interface DownTargetOptions {
  root: string;
  config: RailConfig;
  vcsDriver: VcsDriver;
  feature: string;
  treePath: string;
}

interface DownTarget {
  branchPrefix: string;
  feature: string;
  hasFeatureRef: boolean;
  hasPortAllocation: boolean;
  hasTree: boolean;
  ports: number[];
  treePath: string;
}

async function getDownTarget(options: DownTargetOptions): Promise<DownTarget> {
  const branchPrefix = options.config.worktrees.branch_prefix ?? '';
  const portAllocation = lookupPortAllocation(options.root, options.feature, options.config);
  const hasFeatureRef = await options.vcsDriver.featureRefExists(
    options.root,
    branchPrefix,
    options.feature,
  );

  return {
    branchPrefix,
    feature: options.feature,
    hasFeatureRef,
    hasPortAllocation: portAllocation.hasAllocation,
    hasTree: existsSync(options.treePath),
    ports: portAllocation.ports,
    treePath: options.treePath,
  };
}

/** @internal */
export function validateDownTarget(
  target: Pick<DownTarget, 'feature' | 'hasFeatureRef' | 'hasPortAllocation' | 'hasTree' | 'treePath'>,
  shouldPrune: boolean,
): void {
  if (target.hasTree) return;
  if (!shouldPrune) {
    const treePath = formatPathForDisplay(target.treePath);
    throw new Error(
      `No worktree found for feature "${target.feature}" at ${treePath}. ` +
        'Check the feature name with "rail status".',
    );
  }
  if (target.hasFeatureRef || target.hasPortAllocation) return;

  throw new Error(
    `No worktree, port allocation, or feature ref found for "${target.feature}". Check the feature name with "rail status".`,
  );
}

function lookupPortAllocation(
  root: string,
  feature: string,
  config: { port: PortConfig },
): { hasAllocation: boolean; ports: number[] } {
  const allocations = loadPortAllocations(root);
  const allocation = allocations.features[feature];

  if (!allocation) return { hasAllocation: false, ports: [] };

  return { hasAllocation: true, ports: getPortsForFeature(config.port, allocation.index) };
}

/** @internal */
export async function removeRemainingFeatureTree(treePath: string): Promise<boolean> {
  if (!existsSync(treePath)) return false;

  await rm(treePath, { force: true, recursive: true });
  return true;
}
