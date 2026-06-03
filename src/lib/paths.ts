import { $ } from 'bun';
import { dirname, isAbsolute, join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { formatErrorMessage } from './shell';

const FEATURE_DIR_SEPARATOR = '+';

export async function getGitRoot(): Promise<string> {
  const errors: string[] = [];

  try {
    const commonDir = await $`git rev-parse --path-format=absolute --git-common-dir`.quiet();
    const resolved = commonDir.text().trim();

    // Strip /worktrees/<name> if present, then strip /.git suffix
    const stripped = resolved.replace(/\/worktrees\/[^/]+$/, '');
    return stripped.replace(/\/\.git$/, '') || stripped;
  } catch (err) {
    errors.push(formatRootError('git common dir', err));
  }

  try {
    const result = await $`git rev-parse --show-toplevel`.quiet();
    return result.text().trim();
  } catch (err) {
    errors.push(formatRootError('git top-level', err));
  }

  try {
    const result = await $`jj root`.quiet();
    return result.text().trim();
  } catch (err) {
    errors.push(formatRootError('jj root', err));
  }

  throw new Error(
    'Not inside a git or jj repository. Run this command from within a project.' +
      `\n\n${errors.join('\n\n')}`,
  );
}

function formatRootError(label: string, err: unknown): string {
  return `${label} failed:\n${formatErrorMessage(err)}`;
}

export async function getProjectRoot(): Promise<string> {
  const gitRoot = await getGitRoot();
  const projectRoot = findRailProjectRoot(gitRoot);

  if (!projectRoot) {
    throw new Error(
      `No .rail/config.yaml found at ${gitRoot}. Initialize with a config file at .rail/config.yaml`,
    );
  }

  return projectRoot;
}

/** @internal */
export function findRailProjectRoot(start: string): string | null {
  let current = start;
  while (true) {
    if (existsSync(join(current, '.rail', 'config.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function getWorktreePath(dir: string, feature: string): string {
  return join(dir, getFeatureDirName(feature));
}

export function getFeatureDirName(feature: string): string {
  return feature.replaceAll('/', FEATURE_DIR_SEPARATOR);
}

export function getFeatureNameFromDirName(dirName: string): string {
  return dirName.replaceAll(FEATURE_DIR_SEPARATOR, '/');
}

/**
 * Resolve `worktrees.dir` to an absolute path.
 * - `~` and `~/...` expand against the current user's home directory.
 * - Absolute paths are returned unchanged.
 * - Everything else is resolved relative to the project root.
 *
 * `~user` (other-user home) and env-var expansion are intentionally not supported.
 */
export function resolveWorktreesDir(root: string, dir: string): string {
  if (dir === '~') return homedir();
  if (dir.startsWith('~/')) return join(homedir(), dir.slice(2));
  if (isAbsolute(dir)) return dir;
  return join(root, dir);
}

export function formatPathForDisplay(path: string): string {
  const home = homedir();
  if (path === home) return '~';

  const homePrefix = `${home}/`;
  if (path.startsWith(homePrefix)) return `~/${path.slice(homePrefix.length)}`;

  return path;
}

export function getConfigPath(root: string): string {
  return join(root, '.rail', 'config.yaml');
}

export function getLocalConfigPath(root: string): string {
  return join(root, '.rail', 'local.yaml');
}

export function getPortAllocationsPath(root: string): string {
  return join(root, '.rail', 'port_allocations.json');
}

export function getUserConfigPath(): string {
  return join(homedir(), '.config', 'rail', 'config.yaml');
}

export function getUpdateCheckCachePath(): string {
  return join(homedir(), '.rail', 'update_check.json');
}

export function isRailProject(root: string): boolean {
  return existsSync(join(root, '.rail', 'config.yaml'));
}

export function isRelativePath(command: string): boolean {
  return command.includes('/') || command.endsWith('.sh');
}

export function resolveRelativePath(command: string, baseDir: string): string {
  if (isRelativePath(command)) {
    return join(baseDir, command);
  }
  return command;
}
