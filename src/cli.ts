import { defineCommand, runMain } from 'citty';
import consola from 'consola';
import { formatShellError } from './lib/shell';
import { warnAboutUpdates } from './lib/update';
import { RAIL_VERSION } from './lib/version';

const main = defineCommand({
  meta: {
    name: 'rail',
    version: RAIL_VERSION,
    description: 'Worktree development workflow manager',
  },
  subCommands: {
    init: () => import('./commands/init').then((m) => m.default),
    up: () => import('./commands/up').then((m) => m.default),
    down: () => import('./commands/down').then((m) => m.default),
    run: () => import('./commands/run').then((m) => m.default),
    refresh: () => import('./commands/refresh').then((m) => m.default),
    status: () => import('./commands/status').then((m) => m.default),
    upgrade: () => import('./commands/upgrade').then((m) => m.default),
  },
});

function printVersionAndExit(argv: string[]): void {
  if (argv[0] !== '-v' && argv[0] !== '--version') return;
  process.stdout.write(`${RAIL_VERSION}\n`);
  process.exit(0);
}

// Override console.error to catch citty's unformatted error output
// and replace with clean consola messages
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (first instanceof Error) {
    const shellMessage = formatShellError(first);
    consola.error(shellMessage ?? first.message);
    return;
  }
  originalConsoleError(...args);
};

printVersionAndExit(process.argv.slice(2));
await warnAboutUpdates({ currentVersion: RAIL_VERSION, argv: process.argv.slice(2) });
runMain(main);
