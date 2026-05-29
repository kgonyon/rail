import { defineCommand } from 'citty';
import consola from 'consola';
import { basename, isAbsolute, relative, sep, join } from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile, appendFile, readFile, chmod } from 'fs/promises';
import { getGitRoot, resolveWorktreesDir } from '../lib/paths';
import type { RailConfig } from '../types/config';

type VcsChoice = RailConfig['vcs'];
type ForgeChoice = RailConfig['forge'];
type IgnoreDestination = RailConfig['setup']['ignore_destination'];

export interface InitOptions {
  vcs: VcsChoice;
  forge: ForgeChoice;
  defaultParent: string;
  autoRefresh: boolean;
  trackRail: boolean;
  ignoreDestination: IgnoreDestination;
  worktreesDir: string;
}

export default defineCommand({
  meta: {
    name: 'init',
    description: 'Initialize a new rail project with boilerplate config and scripts',
  },
  args: {
    vcs: {
      type: 'string',
      description: 'VCS backend to configure: git or jj',
    },
    forge: {
      type: 'string',
      description: 'Forge integration to configure: github, gitlab, or none',
    },
    defaultParent: {
      type: 'string',
      description: 'Default parent ref for new feature trees',
    },
    autoRefresh: {
      type: 'boolean',
      description: 'Refresh the default parent before creating feature trees',
    },
    noAutoRefresh: {
      type: 'boolean',
      description: 'Disable automatic parent refresh',
    },
    trackRail: {
      type: 'boolean',
      description: 'Allow shared .rail config and scripts to be tracked',
    },
    noTrackRail: {
      type: 'boolean',
      description: 'Ignore all .rail files locally',
    },
    ignoreDestination: {
      type: 'string',
      description: 'Where ignore rules are written: gitignore or exclude',
    },
    worktreesDir: {
      type: 'string',
      description: 'Directory where feature trees are created',
    },
  },
  async run({ args }) {
    const root = await getGitRoot();
    const projectName = basename(root);
    const options = await resolveInitOptions(args);

    await initializeRailProject(root, projectName, options);

    const ignoredPath = options.ignoreDestination === 'gitignore' ? '.gitignore' : '.git/info/exclude';

    consola.success('Initialized rail project');
    consola.box(
      [
        'Created or repaired:',
        '  .rail/config.yaml',
        '  .rail/scripts/setup.sh',
        '  .rail/scripts/cleanup.sh',
        `  ${ignoredPath}`,
        '',
        'Next steps:',
        '  1. Customize .rail/config.yaml if needed',
        '  2. Customize the setup and cleanup scripts',
        '  3. Run `rail up <feature>` to create your first worktree',
      ].join('\n'),
    );
  },
});

/** @internal */
export async function initializeRailProject(
  root: string,
  projectName: string,
  options: InitOptions = defaultInitOptions(),
): Promise<void> {
  await createDirectories(root);
  await createConfigFile(root, projectName, options);
  await createSetupScript(root);
  await createCleanupScript(root);
  await updateIgnoreRules(root, options);
}

async function createDirectories(root: string): Promise<void> {
  await mkdir(join(root, '.rail', 'scripts'), { recursive: true });
}

async function createConfigFile(root: string, projectName: string, options: InitOptions): Promise<void> {
  await writeFile(join(root, '.rail', 'config.yaml'), buildConfigContent(projectName, options));
}

/** @internal */
export function buildConfigContent(
  projectName: string,
  options: InitOptions = defaultInitOptions(),
): string {
  return `# rail project configuration
# Docs: https://github.com/kgonyon/rail

name: ${projectName}

vcs: ${options.vcs}
forge: ${options.forge}
default_parent: ${options.defaultParent}
auto_refresh: ${options.autoRefresh}

setup:
  track_rail: ${options.trackRail}
  ignore_destination: ${options.ignoreDestination}

worktrees:
  # Directory where feature worktrees are created.
  # Relative paths resolve against the project root. Absolute paths
  # and ~/... are also supported (useful in .rail/local.yaml to keep
  # worktrees outside the repo).
  dir: ${options.worktreesDir}
  # Prefix for feature branches (e.g., feature/my-feature)
  branch_prefix: feature/

port:
  # Starting port number for allocations
  base: 3000
  # Number of ports allocated per feature worktree
  per_feature: 2
  # Total number of ports in the allocation pool
  max: 100

scripts:
  # Run after worktree creation and env file generation (path relative to .rail/)
  setup: scripts/setup.sh
  # Run before worktree removal (path relative to .rail/)
  cleanup: scripts/cleanup.sh

# commands:
#   - name: dev
#     command: npm run dev
#     description: Start development server
#     scope: feature

# env_files:
#   - path: .
#     source: .env.example
#     dest: .env
#     replace:
#       PORT: "\${RAIL_PORT_1}"

# hooks:
#   - event: up
#     command: echo "Ready!"
#   - event: down
#     command: echo "Tearing down..."
#   - event: run
#     command: echo "Command finished!"
`;
}

/** @internal */
export function defaultInitOptions(overrides: Partial<InitOptions> = {}): InitOptions {
  const vcs = overrides.vcs ?? 'git';

  return {
    vcs,
    forge: overrides.forge ?? 'github',
    defaultParent: overrides.defaultParent ?? (vcs === 'jj' ? 'main@origin' : 'main'),
    autoRefresh: overrides.autoRefresh ?? true,
    trackRail: overrides.trackRail ?? true,
    ignoreDestination: overrides.ignoreDestination ?? 'gitignore',
    worktreesDir: overrides.worktreesDir ?? 'trees',
  };
}

/** @internal */
export async function resolveInitOptions(args: Record<string, any>): Promise<InitOptions> {
  const vcs = await resolveEnumChoice<VcsChoice>('VCS', args.vcs, ['git', 'jj'], 'git');
  const forge = await resolveEnumChoice<ForgeChoice>(
    'Forge integration',
    args.forge,
    ['github', 'gitlab', 'none'],
    'github',
  );
  const defaultParent = args.defaultParent ?? (vcs === 'jj' ? 'main@origin' : 'main');
  const autoRefresh = await resolveBooleanChoice(
    'Automatically refresh parent before creating feature trees?',
    args.autoRefresh,
    args.noAutoRefresh,
    true,
  );
  const trackRail = await resolveBooleanChoice(
    'Allow shared .rail config and scripts to be tracked?',
    args.trackRail,
    args.noTrackRail,
    true,
  );
  const ignoreDestination = await resolveEnumChoice<IgnoreDestination>(
    'Ignore destination',
    args.ignoreDestination,
    ['gitignore', 'exclude'],
    'gitignore',
  );

  return {
    vcs,
    forge,
    defaultParent,
    autoRefresh,
    trackRail,
    ignoreDestination,
    worktreesDir: args.worktreesDir ?? 'trees',
  };
}

async function resolveEnumChoice<T extends string>(
  label: string,
  value: unknown,
  choices: readonly T[],
  fallback: T,
): Promise<T> {
  if (value !== undefined) {
    if (typeof value !== 'string' || !choices.includes(value as T)) {
      throw new Error(`${label} must be one of: ${choices.join(', ')}`);
    }
    return value as T;
  }

  if (!process.stdin.isTTY) return fallback;

  return consola.prompt(`Choose ${label}`, {
    type: 'select',
    initial: fallback,
    options: choices.map((choice) => ({ label: choice, value: choice })),
  }) as Promise<T>;
}

async function resolveBooleanChoice(
  label: string,
  value: unknown,
  negatedValue: unknown,
  fallback: boolean,
): Promise<boolean> {
  if (value === true && negatedValue === true) {
    throw new Error(`Choose either the positive or negative ${label} flag, not both`);
  }
  if (typeof value === 'boolean') return value;
  if (negatedValue === true) return false;
  if (!process.stdin.isTTY) return fallback;

  return consola.prompt(label, { type: 'confirm', initial: fallback }) as Promise<boolean>;
}

async function createSetupScript(root: string): Promise<void> {
  const content = `#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Setup script — runs after worktree creation and env file generation
# during \`rail up <feature>\`.
#
# Available environment variables:
#   RAIL_PROJECT      — Project name from config
#   RAIL_PROJECT_DIR  — Absolute path to the project root
#   RAIL_FEATURE      — Feature name (e.g., "my-feature")
#   RAIL_FEATURE_DIR  — Absolute path to the feature worktree
#   RAIL_PORT         — First allocated port (alias for RAIL_PORT_1)
#   RAIL_PORT_1       — First allocated port
#   RAIL_PORT_2       — Second allocated port
#   RAIL_PORT_N       — Nth port (up to per_feature)
#
# Working directory is set to the feature worktree.
# ------------------------------------------------------------------

echo "Setting up feature: $RAIL_FEATURE"

# Example: Install dependencies
# npm install

# Example: Run database migrations
# npm run db:migrate

# Example: Seed test data
# npm run db:seed
`;

  const scriptPath = join(root, '.rail', 'scripts', 'setup.sh');
  await writeFile(scriptPath, content);
  await chmod(scriptPath, 0o755);
}

async function createCleanupScript(root: string): Promise<void> {
  const content = `#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------
# Cleanup script — runs before worktree removal during \`rail down\`.
#
# Available environment variables:
#   RAIL_PROJECT      — Project name from config
#   RAIL_PROJECT_DIR  — Absolute path to the project root
#   RAIL_FEATURE      — Feature name (e.g., "my-feature")
#   RAIL_FEATURE_DIR  — Absolute path to the feature worktree
#   RAIL_PORT         — First allocated port (alias for RAIL_PORT_1)
#   RAIL_PORT_1       — First allocated port
#   RAIL_PORT_2       — Second allocated port
#   RAIL_PORT_N       — Nth port (up to per_feature)
#
# Working directory is set to the feature worktree.
# ------------------------------------------------------------------

echo "Cleaning up feature: $RAIL_FEATURE"

# Example: Drop feature database
# dropdb "myapp_\${RAIL_FEATURE}" --if-exists

# Example: Remove temporary files
# rm -rf tmp/

# Example: Stop any running services
# docker compose down
`;

  const scriptPath = join(root, '.rail', 'scripts', 'cleanup.sh');
  await writeFile(scriptPath, content);
  await chmod(scriptPath, 0o755);
}

/** @internal */
export async function updateIgnoreRules(root: string, options: InitOptions): Promise<void> {
  const ignorePath = options.ignoreDestination === 'gitignore'
    ? join(root, '.gitignore')
    : join(root, '.git', 'info', 'exclude');
  const entries = getIgnoreEntries(root, options);

  if (options.ignoreDestination === 'exclude') {
    await mkdir(join(root, '.git', 'info'), { recursive: true });
  }

  const existing = existsSync(ignorePath)
    ? await readFile(ignorePath, 'utf-8')
    : '';

  const missing = entries.filter((entry) => !existing.includes(entry));

  if (missing.length === 0) return;

  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const block = `${prefix}\n# rail local files\n${missing.join('\n')}\n`;

  await appendFile(ignorePath, block);
}

/** @internal */
export function getIgnoreEntries(root: string, options: InitOptions): string[] {
  const entries = options.trackRail
    ? ['.rail/local.yaml', '.rail/port_allocations.json']
    : ['.rail/'];
  const treeDir = getProjectRelativeTreeDir(root, options.worktreesDir);

  if (treeDir) entries.push(`${treeDir}/`);

  return entries;
}

function getProjectRelativeTreeDir(root: string, dir: string): string | undefined {
  if (dir === '~' || dir.startsWith('~/')) return undefined;

  const resolved = resolveWorktreesDir(root, dir);
  const relativeDir = relative(root, resolved);

  if (!relativeDir || relativeDir.startsWith('..') || isAbsolute(relativeDir)) return undefined;

  return normalizeIgnorePath(relativeDir);
}

function normalizeIgnorePath(path: string): string {
  return path.split(sep).filter(Boolean).join('/');
}
