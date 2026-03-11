import { defineCommand } from 'citty';
import consola from 'consola';
import { getProjectRoot, getWorktreePath } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { allocatePorts, getPortsForFeature } from '../lib/ports';
import { addWorktree, refreshFromOrigin } from '../lib/git';
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
  },
  async run({ args }) {
    const feature = args.feature;
    const root = await getProjectRoot();
    const config = loadConfig(root);

    await refreshFromOrigin(root);

    const index = allocatePorts(root, feature, config.port);
    const ports = getPortsForFeature(config.port, index);
    const treePath = getWorktreePath(root, config.worktrees.dir, feature);

    const context: ScriptContext = {
      root,
      feature,
      featureDir: treePath,
      projectName: config.name,
      ports,
      basePort: ports[0] ?? 0,
    };

    consola.start(`Setting up feature: ${feature}`);

    await addWorktree(root, treePath, config.worktrees.branch_prefix, feature);
    consola.info(`Created worktree at ${treePath}`);

    consola.info(`Allocated ports: ${ports.join(', ')}`);

    if (config.env_files?.length) {
      generateEnvFiles(treePath, config.env_files, ports);
      consola.info('Generated env files');
    }

    if (config.scripts?.setup) {
      consola.info('Running setup script...');
      await runScript(config.scripts.setup, context);
    }

    await runHooks('up', context);

    printSummary(feature, config.worktrees.branch_prefix, ports, treePath);
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
      `Path:     ${treePath}`,
    ].join('\n'),
  );
}
