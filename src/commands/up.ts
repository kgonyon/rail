import { defineCommand } from 'citty';
import consola from 'consola';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { formatPathForDisplay, getWorktreePath } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { validateFeatureName } from '../lib/config';
import { allocatePorts, getPortsForFeature } from '../lib/ports';
import { getVcsDriver, gitVcsDriver } from '../lib/vcs';
import { generateEnvFiles } from '../lib/env';
import { runHooks } from '../lib/hooks';
import { runScript } from '../lib/script';
import type { ScriptContext } from '../lib/script';

export default defineCommand({
  meta: {
    name: 'up',
    description: 'Create a new feature worktree with port allocation and env setup',
  },
  args: {
    feature: {
      type: 'positional',
      description: 'Feature name for the worktree',
      required: true,
    },
    parent: {
      type: 'string',
      description: 'Parent ref to create the feature from',
    },
    noRefresh: {
      type: 'boolean',
      description: 'Skip automatic parent refresh before creating the feature',
    },
  },
  async run({ args }) {
    const feature = args.feature;
    const root = await gitVcsDriver.resolveProjectRoot();
    const config = loadConfig(root);
    const vcsDriver = getVcsDriver(config.vcs);
    validateFeatureName(feature);

    const effectiveParent = args.parent ?? config.default_parent;
    if (config.auto_refresh && !args.noRefresh) {
      try {
        await vcsDriver.refreshParent(root, effectiveParent);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to refresh parent "${effectiveParent}" before creating "${feature}".\n` +
            `${detail}\n\nFix the refresh issue, or retry with \`rail up ${feature} --no-refresh\` to use current local state.`,
        );
      }
    }

    const parentRef = await vcsDriver.fetchParent(root, effectiveParent);

    const index = allocatePorts(root, feature, config.port);
    const ports = getPortsForFeature(config.port, index);
    const treePath = getWorktreePath(config.worktrees.dir, feature);

    const context: ScriptContext = {
      root,
      feature,
      featureDir: treePath,
      projectName: config.name,
      ports,
      basePort: ports[0] ?? 0,
    };

    consola.start(`Setting up feature: ${feature}`);

    await ensureWorktreesDir(treePath);

    await vcsDriver.createFeature({
      root,
      path: treePath,
      branchPrefix: config.worktrees.branch_prefix ?? '',
      feature,
      parentRef,
    });
    consola.info(`Created worktree at ${formatPathForDisplay(treePath)}`);

    consola.info(`Allocated ports: ${ports.join(', ')}`);

    if (config.env_files?.length) {
      generateEnvFiles(treePath, config.env_files, ports, config.secrets);
      consola.info('Generated env files');
    }

    if (config.scripts?.setup) {
      consola.info('Running setup script...');
      await runScript(config.scripts.setup, context);
    }

    await runHooks('up', context);

    printSummary(feature, config.worktrees.branch_prefix ?? '', ports, treePath);
  },
});

function printSummary(
  feature: string,
  branchPrefix: string,
  ports: number[],
  treePath: string,
): void {
  consola.success(`Feature "${feature}" is ready!`);
  consola.box(
    [
      `Feature:  ${feature}`,
      `Branch:   ${branchPrefix}${feature}`,
      `Ports:    ${ports.join(', ')}`,
      `Path:     ${formatPathForDisplay(treePath)}`,
    ].join('\n'),
  );
}

/** @internal */
export async function ensureWorktreesDir(treePath: string): Promise<void> {
  await mkdir(dirname(treePath), { recursive: true });
}
