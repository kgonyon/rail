import { defineCommand, runMain } from 'citty';
import consola from 'consola';

const main = defineCommand({
  meta: {
    name: 'rail',
    version: '1.0.0',
    description: 'Worktree development workflow manager',
  },
  subCommands: {
    init: () => import('./commands/init').then((m) => m.default),
    up: () => import('./commands/up').then((m) => m.default),
    down: () => import('./commands/down').then((m) => m.default),
    run: () => import('./commands/run').then((m) => m.default),
    refresh: () => import('./commands/refresh').then((m) => m.default),
    status: () => import('./commands/status').then((m) => m.default),
  },
});

// Override console.error to catch citty's unformatted error output
// and replace with clean consola messages
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const first = args[0];
  if (first instanceof Error) {
    consola.error(first.message);
    return;
  }
  originalConsoleError(...args);
};

runMain(main);
