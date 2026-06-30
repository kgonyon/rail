import { defineCommand } from 'citty';
import consola from 'consola';
import { join } from 'path';
import { getFeatureTreePath, resolveRailRuntime, resolveRelativePathWithFallback } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { loadFeatureAllocations, getPortsForFeature, setAllocatedFeaturePath } from '../lib/ports';
import { getVcsDriver } from '../lib/vcs';
import { resolveFeature } from '../lib/detect';
import { runHooks } from '../lib/hooks';
import { runCommand } from '../lib/script';
import type { ScriptContext } from '../lib/script';
import type { RailConfig, CommandConfig } from '../types/config';

export default defineCommand({
  meta: {
    name: 'run',
    description: 'Run a configured command',
  },
  args: {
    command: {
      type: 'positional',
      description: 'Command name to run',
      required: true,
    },
    feature: {
      type: 'string',
      description: 'Feature name (auto-detected if inside a worktree)',
      alias: 'f',
    },
  },
  async run({ args, rawArgs }) {
    const runtime = await resolveRailRuntime();
    const root = runtime.parentRoot;
    const config = loadConfig({ parentRoot: runtime.parentRoot, configRoot: runtime.configRoot });
    const cmdConfig = findCommand(config, args.command);
    const scope = cmdConfig.scope ?? 'feature';
    const extraArgs = extractExtraArgs(rawArgs);

    if (scope === 'project') {
      await runProjectScoped(runtime, config, cmdConfig, extraArgs);
    } else {
      await runFeatureScoped(runtime, config, cmdConfig, args.feature as string | undefined, extraArgs);
    }
  },
});

async function runFeatureScoped(
  runtime: Awaited<ReturnType<typeof resolveRailRuntime>>,
  config: RailConfig,
  cmdConfig: CommandConfig,
  featureArg: string | undefined,
  extraArgs: string[],
): Promise<void> {
  const allocations = loadFeatureAllocations(runtime.allocationsRoot);
  const feature = resolveFeature(featureArg, {
    allocations,
    treesDir: config.worktrees.dir,
    commandName: cmdConfig.name,
  });
  const treePath = await resolveTreePath(runtime.allocationsRoot, feature, config, runtime.parentRoot);
  const ports = lookupPorts(runtime.allocationsRoot, feature, config);

  const context: ScriptContext = {
    root: runtime.parentRoot,
    workspaceRoot: runtime.workspaceRoot,
    railDir: runtime.railDir,
    parentRailDir: runtime.parentRailDir,
    feature,
    featureDir: treePath,
    projectName: config.name,
    ports,
    basePort: ports[0] ?? 0,
  };

  let command = resolveCommandPath(cmdConfig.command, runtime.railDir, runtime.parentRailDir);
  if (extraArgs.length > 0) {
    command = `${command} ${shellEscape(extraArgs)}`;
  }

  consola.start(`Running "${cmdConfig.name}" for feature: ${feature}`);
  await runCommand(command, context, treePath);
  await runHooks('run', context);
}

async function resolveTreePath(
  allocationsRoot: string,
  feature: string,
  config: RailConfig,
  root: string,
): Promise<string> {
  const allocation = loadFeatureAllocations(allocationsRoot).features[feature];
  if (allocation?.path) return allocation.path;

  const branch = `${config.worktrees.branch_prefix ?? ''}${feature}`;
  const worktree = (await getVcsDriver(config.vcs).listFeatures(root)).find((candidate) => {
    const candidateBranch = candidate.branch.replace(/^refs\/heads\//, '');
    return candidateBranch === branch || candidate.feature === feature;
  });

  if (worktree?.path) {
    setAllocatedFeaturePath(allocationsRoot, feature, worktree.path);
    return worktree.path;
  }

  return getFeatureTreePath(config.worktrees.dir, config.name, feature);
}

async function runProjectScoped(
  runtime: Awaited<ReturnType<typeof resolveRailRuntime>>,
  config: RailConfig,
  cmdConfig: CommandConfig,
  extraArgs: string[],
): Promise<void> {
  const context: ScriptContext = {
    root: runtime.parentRoot,
    workspaceRoot: runtime.workspaceRoot,
    railDir: runtime.railDir,
    parentRailDir: runtime.parentRailDir,
    feature: '',
    featureDir: '',
    projectName: config.name,
    ports: [],
    basePort: 0,
  };

  let command = resolveCommandPath(cmdConfig.command, runtime.railDir, runtime.parentRailDir);
  if (extraArgs.length > 0) {
    command = `${command} ${shellEscape(extraArgs)}`;
  }

  consola.start(`Running "${cmdConfig.name}"`);
  await runCommand(command, context, runtime.workspaceRoot);
  await runHooks('run', context);
}

/** @internal */
export function extractExtraArgs(rawArgs: string[]): string[] {
  const dashIndex = rawArgs.indexOf('--');
  if (dashIndex === -1) return [];
  return rawArgs.slice(dashIndex + 1);
}

/** @internal */
export function shellEscape(args: string[]): string {
  return args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
}

/** @internal */
export function findCommand(config: RailConfig, name: string): CommandConfig {
  const cmd = config.commands?.find((c) => c.name === name);

  if (!cmd) {
    const available = config.commands?.map((c) => c.name).join(', ') ?? 'none';
    throw new Error(`Unknown command "${name}". Available: ${available}`);
  }

  return cmd;
}

/** @internal */
export function resolveCommandPath(command: string, railDir: string, parentRailDir = railDir): string {
  const baseRailDir = railDir.endsWith('/.rail') ? railDir : join(railDir, '.rail');
  const fallbackRailDir = parentRailDir.endsWith('/.rail') ? parentRailDir : join(parentRailDir, '.rail');
  return resolveRelativePathWithFallback(command, baseRailDir, fallbackRailDir);
}

function lookupPorts(root: string, feature: string, config: RailConfig): number[] {
  const allocations = loadFeatureAllocations(root);
  const allocation = allocations.features[feature];

  if (!allocation) {
    throw new Error(`No ports allocated for feature "${feature}". Run "rail up ${feature}" first.`);
  }

  return getPortsForFeature(config.port, allocation.index);
}
