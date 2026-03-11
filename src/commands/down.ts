import { existsSync } from 'fs';
import { defineCommand } from 'citty';
import consola from 'consola';
import { getProjectRoot, getWorktreePath } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadPortAllocations, getPortsForFeature, deallocatePorts } from '../lib/ports';
import { removeWorktree } from '../lib/git';
import { resolveFeature } from '../lib/detect';
import { runHooks } from '../lib/hooks';
import { runScript } from '../lib/script';
import type { ScriptContext } from '../lib/script';
import type { PortConfig } from '../types/config';

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
  },
  async run({ args }) {
    const root = await getProjectRoot();
    const config = loadConfig(root);

    const feature = resolveFeature(args.feature as string | undefined, config.worktrees.dir);
    const treePath = getWorktreePath(root, config.worktrees.dir, feature);

    if (!existsSync(treePath)) {
      throw new Error(
        `No worktree found for feature "${feature}" at ${treePath}. Check the feature name with "wt status".`,
      );
    }

    const ports = lookupPorts(root, feature, config);

    const context: ScriptContext = {
      root,
      feature,
      featureDir: treePath,
      projectName: config.name,
      ports,
      basePort: ports[0] ?? 0,
    };

    consola.start(`Tearing down feature: ${feature}`);

    await runHooks('down', context);

    if (config.scripts?.cleanup) {
      consola.info('Running cleanup script...');
      await runScript(config.scripts.cleanup, context);
    }

    await removeWorktree(root, treePath);
    consola.info('Removed worktree');

    deallocatePorts(root, feature);
    consola.info('Deallocated ports');

    consola.success(`Feature "${feature}" has been removed`);
  },
});

function lookupPorts(root: string, feature: string, config: { port: PortConfig }): number[] {
  const allocations = loadPortAllocations(root);
  const allocation = allocations.features[feature];

  if (!allocation) return [];

  return getPortsForFeature(config.port, allocation.index);
}
