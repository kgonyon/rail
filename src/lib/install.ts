import { realpath } from 'fs/promises';
import { basename } from 'path';

export type InstallMethod = 'homebrew' | 'manual' | 'source';

export async function detectInstallMethod(execPath = process.execPath): Promise<InstallMethod> {
  const resolved = await resolveExecutablePath(execPath);
  if (isHomebrewPath(resolved)) return 'homebrew';
  if (isBunExecutable(resolved)) return 'source';
  return 'manual';
}

/** @internal */
export function isHomebrewPath(path: string): boolean {
  return path.includes('/Cellar/rail/');
}

/** @internal */
export function isBunExecutable(path: string): boolean {
  return basename(path) === 'bun';
}

async function resolveExecutablePath(execPath: string): Promise<string> {
  try {
    return await realpath(execPath);
  } catch {
    return execPath;
  }
}
