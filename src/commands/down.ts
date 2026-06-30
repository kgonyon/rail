import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { defineCommand } from 'citty';
import consola from 'consola';
import { formatPathForDisplay, getFeatureTreePath, resolveRailRuntime } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadFeatureAllocations, getPortsForFeature, deallocatePorts, setAllocatedFeaturePath } from '../lib/ports';
import { getVcsDriver } from '../lib/vcs';
import { resolveFeature } from '../lib/detect';
import { runHooks } from '../lib/hooks';
import { runScript } from '../lib/script';
import { formatErrorMessage } from '../lib/shell';
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
    const runtime = await resolveRailRuntime();
    const root = runtime.parentRoot;
    const config = loadConfig({ parentRoot: runtime.parentRoot, configRoot: runtime.configRoot });
    const vcsDriver = getVcsDriver(config.vcs);
    const allocations = loadFeatureAllocations(runtime.allocationsRoot);

    const feature = resolveFeature(args.feature as string | undefined, {
      allocations,
      treesDir: config.worktrees.dir,
    });
    const treePath = await resolveTreePath({
      allocationsRoot: runtime.allocationsRoot,
      config,
      feature,
      root,
      vcsDriver,
    });
    const target = await getDownTarget({
      allocationsRoot: runtime.allocationsRoot,
      root,
      config,
      vcsDriver,
      feature,
      treePath,
    });
    validateDownTarget(target, Boolean(args.prune));

    const context: ScriptContext = {
      root,
      workspaceRoot: runtime.workspaceRoot,
      railDir: runtime.railDir,
      parentRailDir: runtime.parentRailDir,
      feature,
      featureDir: treePath,
      projectName: config.name,
      ports: target.ports,
      basePort: target.ports[0] ?? 0,
    };

    consola.start(`Tearing down feature: ${feature}`);

    if (target.hasTree) {
      await runHooks('down', context);

      await runCleanupScript(config.scripts?.cleanup, context, target.setupSkipped);

      await vcsDriver.removeFeature(root, treePath, feature);
      consola.info('Removed worktree');
      if (await removeRemainingFeatureTree(treePath)) {
        consola.info('Removed leftover feature directory');
      }
    } else {
      consola.info('No worktree found; continuing prune cleanup');
    }

    if (target.hasFeatureAllocation) {
      deallocatePorts(runtime.allocationsRoot, feature);
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
  allocationsRoot: string;
  root: string;
  config: RailConfig;
  vcsDriver: VcsDriver;
  feature: string;
  treePath: string;
}

async function resolveTreePath(options: {
  allocationsRoot: string;
  config: RailConfig;
  feature: string;
  root: string;
  vcsDriver: VcsDriver;
}): Promise<string> {
  const allocation = loadFeatureAllocations(options.allocationsRoot).features[options.feature];
  if (allocation?.path) return allocation.path;

  const branch = `${options.config.worktrees.branch_prefix ?? ''}${options.feature}`;
  const worktree = (await options.vcsDriver.listFeatures(options.root)).find((candidate) => {
    const candidateBranch = candidate.branch.replace(/^refs\/heads\//, '');
    return candidateBranch === branch || candidate.feature === options.feature;
  });

  if (worktree?.path) {
    setAllocatedFeaturePath(options.allocationsRoot, options.feature, worktree.path);
    return worktree.path;
  }

  return getFeatureTreePath(options.config.worktrees.dir, options.config.name, options.feature);
}

interface DownTarget {
  branchPrefix: string;
  feature: string;
  hasFeatureRef: boolean;
  hasFeatureAllocation: boolean;
  hasTree: boolean;
  ports: number[];
  setupSkipped: boolean;
  treePath: string;
}

async function getDownTarget(options: DownTargetOptions): Promise<DownTarget> {
  const branchPrefix = options.config.worktrees.branch_prefix ?? '';
  const featureAllocation = lookupFeatureAllocation(options.allocationsRoot, options.feature, options.config);
  const hasFeatureRef = await options.vcsDriver.featureRefExists(
    options.root,
    branchPrefix,
    options.feature,
  );

  return {
    branchPrefix,
    feature: options.feature,
    hasFeatureRef,
    hasFeatureAllocation: featureAllocation.hasAllocation,
    hasTree: existsSync(options.treePath),
    ports: featureAllocation.ports,
    setupSkipped: featureAllocation.setupSkipped,
    treePath: options.treePath,
  };
}

/** @internal */
export function validateDownTarget(
  target: Pick<DownTarget, 'feature' | 'hasFeatureRef' | 'hasFeatureAllocation' | 'hasTree' | 'treePath'>,
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
  if (target.hasFeatureRef || target.hasFeatureAllocation) return;

  throw new Error(
    `No worktree, feature allocation, or feature ref found for "${target.feature}". Check the feature name with "rail status".`,
  );
}

function lookupFeatureAllocation(
  root: string,
  feature: string,
  config: { port: PortConfig },
): { hasAllocation: boolean; ports: number[]; setupSkipped: boolean } {
  const allocations = loadFeatureAllocations(root);
  const allocation = allocations.features[feature];

  if (!allocation) return { hasAllocation: false, ports: [], setupSkipped: false };

  return {
    hasAllocation: true,
    ports: getPortsForFeature(config.port, allocation.index),
    setupSkipped: allocation.setupSkipped === true,
  };
}

/** @internal */
export async function removeRemainingFeatureTree(treePath: string): Promise<boolean> {
  if (!existsSync(treePath)) return false;

  await rm(treePath, { force: true, recursive: true });
  return true;
}

async function runCleanupScript(
  cleanupScript: string | undefined,
  context: ScriptContext,
  setupSkipped: boolean,
): Promise<void> {
  if (!cleanupScript) return;
  if (setupSkipped) {
    consola.info('Skipping cleanup script because setup was skipped');
    return;
  }

  try {
    consola.info('Running cleanup script...');
    await runScript(cleanupScript, context);
  } catch (error) {
    consola.warn(`Cleanup script failed; continuing teardown.\n${formatErrorMessage(error)}`);
  }
}
