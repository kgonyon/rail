import { cpSync, existsSync } from 'fs';
import { join } from 'path';

const PORT_ALLOCATIONS_FILE = 'port_allocations.json';

export function copyRailDirIfMissing(root: string, worktreePath: string): boolean {
  const source = join(root, '.rail');
  const destination = join(worktreePath, '.rail');

  if (existsSync(destination)) return false;
  if (!existsSync(source)) {
    throw new Error(`No .rail directory found at ${source}`);
  }

  const excludedPath = join(source, PORT_ALLOCATIONS_FILE);
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => path !== excludedPath,
  });

  return true;
}
