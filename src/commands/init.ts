import { defineCommand } from 'citty';
import consola from 'consola';
import { basename, isAbsolute, relative, sep, join } from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile, readFile, chmod } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { isPlainObject, isSafeParentRefName, validateConfig } from '../lib/config';
import { getGitRoot, resolveWorktreesDir } from '../lib/paths';
import type { RailConfig } from '../types/config';

type VcsChoice = RailConfig['vcs'];
type ForgeChoice = RailConfig['forge'];
type IgnoreDestination = RailConfig['setup']['ignore_destination'];
type IgnoreEntryPredicate = (line: string) => boolean;

const RAIL_LOCAL_HEADER = '# rail local files';
const TRACKED_RAIL_IGNORE_ENTRIES = ['.rail/local.yaml', '.rail/feature_allocations.json'] as const;
const LEGACY_RAIL_IGNORE_ENTRIES = ['.rail/port_allocations.json', '/.rail/port_allocations.json'] as const;
const UNTRACKED_RAIL_IGNORE_ENTRIES = ['.rail/'] as const;
const BROAD_RAIL_IGNORE_ENTRIES = [
  '.rail',
  '.rail/',
  '.rail/*',
  '.rail/**',
  '/.rail',
  '/.rail/',
  '/.rail/*',
  '/.rail/**',
] as const;
const BROAD_RAIL_IGNORE_ENTRY_SET = new Set<string>(BROAD_RAIL_IGNORE_ENTRIES);
const TRACKED_RAIL_IGNORE_ENTRY_SET = new Set<string>([
  '.rail/local.yaml',
  '/.rail/local.yaml',
  '.rail/feature_allocations.json',
  '/.rail/feature_allocations.json',
  ...LEGACY_RAIL_IGNORE_ENTRIES,
]);

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
    const existing = await readExistingConfig(join(root, '.rail', 'config.yaml'));
    const options = await resolveInitOptions(args, existing);

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
  const repairedOptions = await createConfigFile(root, projectName, options);
  await createSetupScript(root);
  await createCleanupScript(root);
  await updateIgnoreRules(root, repairedOptions);
}

async function createDirectories(root: string): Promise<void> {
  await mkdir(join(root, '.rail', 'scripts'), { recursive: true });
}

async function createConfigFile(root: string, projectName: string, options: InitOptions): Promise<InitOptions> {
  const configPath = join(root, '.rail', 'config.yaml');

  if (!existsSync(configPath)) {
    await writeFile(configPath, buildConfigContent(projectName, options));
    return options;
  }

  const existing = await readExistingConfig(configPath);
  const repaired = repairConfig(existing, projectName, options);

  validateConfig(repaired);
  await writeFile(configPath, stringify(repaired));
  return initOptionsFromConfig(repaired);
}

function initOptionsFromConfig(config: RailConfig): InitOptions {
  return {
    vcs: config.vcs,
    forge: config.forge,
    defaultParent: config.default_parent,
    autoRefresh: config.auto_refresh,
    trackRail: config.setup.track_rail,
    ignoreDestination: config.setup.ignore_destination,
    worktreesDir: config.worktrees.dir,
  };
}

async function readExistingConfig(path: string): Promise<Record<string, any>> {
  try {
    const parsed = parse(await readFile(path, 'utf-8'));
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function repairConfig(
  existing: Record<string, any>,
  projectName: string,
  options: InitOptions,
): Record<string, any> {
  const repaired = { ...existing };

  repaired.name = nonEmptyString(existing.name) ? existing.name : projectName;
  repaired.vcs = enumValue(existing.vcs, ['git', 'jj']) ?? options.vcs;
  repaired.forge = enumValue(existing.forge, ['github', 'gitlab', 'none']) ?? options.forge;
  repaired.default_parent = safeParent(existing.default_parent) ? existing.default_parent : options.defaultParent;
  repaired.auto_refresh = typeof existing.auto_refresh === 'boolean' ? existing.auto_refresh : options.autoRefresh;

  const existingSetup = isPlainObject(existing.setup) ? existing.setup : {};
  repaired.setup = {
    ...existingSetup,
    track_rail: typeof existingSetup.track_rail === 'boolean' ? existingSetup.track_rail : options.trackRail,
    ignore_destination: enumValue(existingSetup.ignore_destination, ['gitignore', 'exclude']) ?? options.ignoreDestination,
  };

  const existingWorktrees = isPlainObject(existing.worktrees) ? existing.worktrees : {};
  repaired.worktrees = {
    ...existingWorktrees,
    dir: nonEmptyString(existingWorktrees.dir) ? existingWorktrees.dir : options.worktreesDir,
  };
  if ('branch_prefix' in existingWorktrees) {
    repaired.worktrees.branch_prefix = safeParent(existingWorktrees.branch_prefix)
      ? existingWorktrees.branch_prefix
      : 'feature/';
  }

  const existingPort = isPlainObject(existing.port) ? existing.port : {};
  repaired.port = {
    ...existingPort,
    base: positiveInteger(existingPort.base) ? existingPort.base : 3000,
    per_feature: positiveInteger(existingPort.per_feature) ? existingPort.per_feature : 2,
    max: positiveInteger(existingPort.max) ? existingPort.max : 100,
  };

  return repaired;
}

function enumValue<T extends string>(value: unknown, values: readonly T[]): T | undefined {
  return typeof value === 'string' && values.includes(value as T) ? value as T : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function safeParent(value: unknown): value is string {
  return typeof value === 'string' && (value === '' || isSafeParentRefName(value));
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
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
  # Optional prefix for feature branches/bookmarks (e.g., feature/my-feature).
  # Omit this key or set it to "" to use the feature name directly.
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
export async function resolveInitOptions(
  args: Record<string, any>,
  existing: Record<string, any> = {},
): Promise<InitOptions> {
  const existingOptions = initOptionValuesFromConfig(existing);
  const vcs = existingOptions.vcs ?? await resolveEnumChoice<VcsChoice>('VCS', args.vcs, ['git', 'jj'], 'git');
  const forge = existingOptions.forge ?? await resolveEnumChoice<ForgeChoice>(
    'Forge integration',
    args.forge,
    ['github', 'gitlab', 'none'],
    'github',
  );
  const defaultParent = existingOptions.defaultParent ?? args.defaultParent ?? (vcs === 'jj' ? 'main@origin' : 'main');
  const autoRefresh = existingOptions.autoRefresh ?? resolveBooleanFlag(
    'Automatically refresh parent before creating feature trees?',
    args.autoRefresh,
    args.noAutoRefresh,
    true,
  );
  const trackRail = existingOptions.trackRail ?? await resolveBooleanChoice(
    'Allow shared .rail config and scripts to be tracked?',
    args.trackRail,
    args.noTrackRail,
    true,
  );
  const ignoreDestination = existingOptions.ignoreDestination ?? await resolveEnumChoice<IgnoreDestination>(
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
    worktreesDir: existingOptions.worktreesDir ?? args.worktreesDir ?? 'trees',
  };
}

function initOptionValuesFromConfig(existing: Record<string, any>): Partial<InitOptions> {
  const existingSetup = isPlainObject(existing.setup) ? existing.setup : {};
  const existingWorktrees = isPlainObject(existing.worktrees) ? existing.worktrees : {};
  const options: Partial<InitOptions> = {};

  const vcs = enumValue(existing.vcs, ['git', 'jj']);
  const forge = enumValue(existing.forge, ['github', 'gitlab', 'none']);
  const ignoreDestination = enumValue(existingSetup.ignore_destination, ['gitignore', 'exclude']);

  if (vcs) options.vcs = vcs;
  if (forge) options.forge = forge;
  if (safeParent(existing.default_parent)) options.defaultParent = existing.default_parent;
  if (typeof existing.auto_refresh === 'boolean') options.autoRefresh = existing.auto_refresh;
  if (typeof existingSetup.track_rail === 'boolean') options.trackRail = existingSetup.track_rail;
  if (ignoreDestination) options.ignoreDestination = ignoreDestination;
  if (nonEmptyString(existingWorktrees.dir)) options.worktreesDir = existingWorktrees.dir;

  return options;
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

function resolveBooleanFlag(
  label: string,
  value: unknown,
  negatedValue: unknown,
  fallback: boolean,
): boolean {
  if (value === true && negatedValue === true) {
    throw new Error(`Choose either the positive or negative ${label} flag, not both`);
  }
  if (typeof value === 'boolean') return value;
  if (negatedValue === true) return false;
  return fallback;
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
  if (existsSync(scriptPath)) return;

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
  if (existsSync(scriptPath)) return;

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

  const shouldRemove = options.trackRail ? isObsoleteTrackedRailIgnoreEntry : isTrackedRailIgnoreEntry;
  await repairObsoleteRailIgnores(root, ignorePath, entries, shouldRemove);

  const existing = existsSync(ignorePath)
    ? await readFile(ignorePath, 'utf-8')
    : '';
  const repaired = normalizeIgnoreContent(existing, entries, shouldRemove, true);

  if (repaired === existing) return;

  await writeFile(ignorePath, repaired);
}

async function repairObsoleteRailIgnores(
  root: string,
  targetPath: string,
  entries: string[],
  shouldRemove: IgnoreEntryPredicate,
): Promise<void> {
  const paths = [join(root, '.gitignore'), join(root, '.git', 'info', 'exclude')];

  for (const path of paths) {
    if (path === targetPath || !existsSync(path)) continue;
    const existing = await readFile(path, 'utf-8');
    const repaired = normalizeIgnoreContent(existing, entries, shouldRemove, false);

    if (repaired !== existing) await writeFile(path, repaired);
  }
}

function normalizeIgnoreContent(
  existing: string,
  entries: string[],
  shouldRemove: IgnoreEntryPredicate,
  shouldAppendEntries: boolean,
): string {
  const desiredEntries = createManagedIgnoreEntrySet(entries);
  const kept = existing
    .split(/\r?\n/)
    .filter((line) => shouldKeepIgnoreLine(line, desiredEntries, shouldRemove));
  const cleaned = compactBlankLines(kept).join('\n');

  if (!shouldAppendEntries || entries.length === 0) return cleaned ? `${cleaned}\n` : '';
  if (!cleaned) return `${RAIL_LOCAL_HEADER}\n${entries.join('\n')}\n`;

  return `${cleaned}\n\n${RAIL_LOCAL_HEADER}\n${entries.join('\n')}\n`;
}

function createManagedIgnoreEntrySet(entries: string[]): Set<string> {
  const managed = new Set<string>();

  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    managed.add(trimmed);
    managed.add(`/${trimmed}`);

    if (trimmed.endsWith('/')) {
      const withoutSlash = trimmed.slice(0, -1);
      managed.add(withoutSlash);
      managed.add(`/${withoutSlash}`);
    }
  }

  return managed;
}

function shouldKeepIgnoreLine(
  line: string,
  desiredEntries: Set<string>,
  shouldRemove: IgnoreEntryPredicate,
): boolean {
  const trimmed = line.trim();

  if (trimmed === RAIL_LOCAL_HEADER) return false;
  if (desiredEntries.has(trimmed)) return false;
  if (shouldRemove(line)) return false;

  return true;
}

function compactBlankLines(lines: string[]): string[] {
  const compacted: string[] = [];

  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank && compacted.length === 0) continue;
    if (isBlank && compacted[compacted.length - 1]?.trim() === '') continue;
    compacted.push(line);
  }

  while (compacted[compacted.length - 1]?.trim() === '') compacted.pop();

  return compacted;
}

function isBroadRailIgnoreEntry(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return false;

  return BROAD_RAIL_IGNORE_ENTRY_SET.has(trimmed);
}

function isTrackedRailIgnoreEntry(line: string): boolean {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) return false;

  return TRACKED_RAIL_IGNORE_ENTRY_SET.has(trimmed);
}

function isObsoleteTrackedRailIgnoreEntry(line: string): boolean {
  const trimmed = line.trim();

  return isBroadRailIgnoreEntry(line) || (LEGACY_RAIL_IGNORE_ENTRIES as readonly string[]).includes(trimmed);
}

/** @internal */
export function getIgnoreEntries(root: string, options: InitOptions): string[] {
  const entries: string[] = options.trackRail
    ? [...TRACKED_RAIL_IGNORE_ENTRIES]
    : [...UNTRACKED_RAIL_IGNORE_ENTRIES];
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
