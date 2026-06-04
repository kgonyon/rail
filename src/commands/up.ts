import { defineCommand } from 'citty';
import consola from 'consola';
import { existsSync } from 'fs';
import { mkdir, rm } from 'fs/promises';
import { dirname } from 'path';
import { formatPathForDisplay, getWorktreePath } from '../lib/paths';
import { loadConfig } from '../lib/config';
import { validateFeatureName } from '../lib/config';
import { allocatePorts, deallocatePorts, getPortsForFeature, setSetupSkipped } from '../lib/ports';
import { getVcsDriver, gitVcsDriver } from '../lib/vcs';
import { generateEnvFiles } from '../lib/env';
import { runHooks } from '../lib/hooks';
import { runScript } from '../lib/script';
import { formatErrorMessage } from '../lib/shell';
import type { ScriptContext } from '../lib/script';
import type { VcsDriver } from '../lib/vcs';
import type { RailConfig } from '../types/config';

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
    'skip-setup': {
      type: 'boolean',
      description: 'Skip the configured setup script for this feature',
    },
  },
  async run({ args, rawArgs }) {
    const feature = args.feature;
    const root = await gitVcsDriver.resolveProjectRoot();
    const config = loadConfig(root);
    const vcsDriver = getVcsDriver(config.vcs);
    validateFeatureName(feature);

    const effectiveParent = args.parent ?? config.default_parent;
    const shouldSkipSetup = shouldSkipSetupScript(args, rawArgs);
    if (config.auto_refresh && !args.noRefresh) {
      await refreshParentForUp(vcsDriver, root, effectiveParent, feature);
    }

    const parentRef = await vcsDriver.fetchParent(root, effectiveParent);

    const branchPrefix = config.worktrees.branch_prefix ?? '';
    const hadFeatureRef = await vcsDriver.featureRefExists(root, branchPrefix, feature);
    assertCanCreateFeatureRef(config.vcs, feature, hadFeatureRef);
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
      branchPrefix,
      feature,
      parentRef,
    });
    setSetupSkipped(root, feature, shouldSkipSetup);
    consola.info(`Created worktree at ${formatPathForDisplay(treePath)}`);

    consola.info(`Allocated ports: ${ports.join(', ')}`);

    if (config.env_files?.length) {
      generateEnvFiles(treePath, config.env_files, ports, config.secrets);
      consola.info('Generated env files');
    }

    await runSetupWithRollback({
      cleanupScript: config.scripts?.cleanup,
      branchPrefix,
      context,
      feature,
      root,
      setupScript: config.scripts?.setup,
      shouldSkipSetup,
      shouldPruneFeatureRef: !hadFeatureRef,
      treePath,
      vcsDriver,
    });

    await runHooks('up', context);

    printSummary(feature, branchPrefix, ports, treePath);
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

/** @internal */
export function shouldSkipSetupScript(
  args: { skipSetup?: boolean; 'skip-setup'?: boolean },
  rawArgs: string[],
): boolean {
  return args.skipSetup === true || args['skip-setup'] === true || rawArgs.includes('--skip-setup');
}

function assertCanCreateFeatureRef(
  vcs: RailConfig['vcs'],
  feature: string,
  hadFeatureRef: boolean,
): void {
  if (vcs !== 'jj' || !hadFeatureRef) return;

  throw new Error(
    `JJ bookmark already exists for feature "${feature}". ` +
      `If this is a stale failed setup bookmark, run \`rail down ${feature} --prune\` first.`,
  );
}

async function refreshParentForUp(
  vcsDriver: VcsDriver,
  root: string,
  parentRef: string,
  feature: string,
): Promise<void> {
  try {
    await vcsDriver.refreshParent(root, parentRef);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to refresh parent "${parentRef}" before creating "${feature}".\n` +
        `${detail}\n\nFix the refresh issue, or retry with \`rail up ${feature} --no-refresh\` to use current local state.`,
    );
  }
}

interface SetupWithRollbackOptions extends RollbackFailedSetupOptions {
  setupScript?: string;
  shouldSkipSetup: boolean;
}

async function runSetupWithRollback(options: SetupWithRollbackOptions): Promise<void> {
  try {
    await runSetupScript(options.setupScript, options.context, options.shouldSkipSetup);
  } catch (error) {
    const rollbackErrors = await rollbackFailedSetup(options);
    if (rollbackErrors.length > 0) {
      throw new Error(formatSetupRollbackError(error, rollbackErrors));
    }
    throw error;
  }
}

async function runSetupScript(
  setupScript: string | undefined,
  context: ScriptContext,
  shouldSkipSetup: boolean,
): Promise<void> {
  if (shouldSkipSetup) {
    if (setupScript) consola.info('Skipping setup script');
    return;
  }
  if (!setupScript) return;

  consola.info('Running setup script...');
  await runScript(setupScript, context);
}

interface RollbackFailedSetupOptions {
  branchPrefix: string;
  cleanupScript?: string;
  context: ScriptContext;
  feature: string;
  root: string;
  shouldPruneFeatureRef: boolean;
  treePath: string;
  vcsDriver: VcsDriver;
}

async function rollbackFailedSetup(options: RollbackFailedSetupOptions): Promise<string[]> {
  const errors: string[] = [];
  consola.warn('Setup script failed; rolling back feature tree...');

  await runRollbackCleanup(options.cleanupScript, options.context);
  await collectRollbackError(errors, 'remove worktree', () =>
    options.vcsDriver.removeFeature(options.root, options.treePath, options.feature)
  );
  await collectRollbackError(errors, 'remove leftover feature directory', () =>
    removeFeatureTreeDirectory(options.treePath)
  );
  if (options.shouldPruneFeatureRef) {
    await collectRollbackError(errors, 'prune feature ref', () =>
      options.vcsDriver.pruneFeature(options.root, options.branchPrefix, options.feature)
    );
  }
  try {
    deallocatePorts(options.root, options.feature);
  } catch (error) {
    errors.push(`deallocate ports: ${formatErrorMessage(error)}`);
  }

  return errors;
}

async function runRollbackCleanup(
  cleanupScript: string | undefined,
  context: ScriptContext,
): Promise<void> {
  if (!cleanupScript) return;

  try {
    consola.info('Running cleanup script before rollback...');
    await runScript(cleanupScript, context);
  } catch (error) {
    consola.warn(`Cleanup script failed during rollback; continuing.\n${formatErrorMessage(error)}`);
  }
}

async function collectRollbackError(
  errors: string[],
  label: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(`${label}: ${formatErrorMessage(error)}`);
  }
}

async function removeFeatureTreeDirectory(treePath: string): Promise<void> {
  if (!existsSync(treePath)) return;

  await rm(treePath, { force: true, recursive: true });
}

function formatSetupRollbackError(setupError: unknown, rollbackErrors: string[]): string {
  return [
    `Setup failed: ${formatErrorMessage(setupError)}`,
    '',
    'Rollback also failed:',
    ...rollbackErrors.map((error) => `- ${error}`),
  ].join('\n');
}
