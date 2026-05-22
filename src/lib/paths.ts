import { $ } from 'bun';
import { isAbsolute, join } from 'path';
import { existsSync } from 'fs';
import { homedir } from 'os';

export async function getGitRoot(): Promise<string> {
  try {
    const commonDir = await $`git rev-parse --path-format=absolute --git-common-dir`.quiet();
    const resolved = commonDir.text().trim();

    // Strip /worktrees/<name> if present, then strip /.git suffix
    const stripped = resolved.replace(/\/worktrees\/[^/]+$/, '');
    return stripped.replace(/\/\.git$/, '') || stripped;
  } catch {
    try {
      const result = await $`git rev-parse --show-toplevel`.quiet();
      return result.text().trim();
    } catch {
      throw new Error('Not inside a git repository. Run this command from within a git project.');
    }
  }
}

export async function getProjectRoot(): Promise<string> {
  const gitRoot = await getGitRoot();
  const configPath = join(gitRoot, '.rail', 'config.yaml');

  if (!existsSync(configPath)) {
    throw new Error(
      `No .rail/config.yaml found at ${gitRoot}. Initialize with a config file at .rail/config.yaml`,
    );
  }

  return gitRoot;
}

export function getWorktreePath(dir: string, feature: string): string {
  return join(dir, feature);
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
