import { $ } from 'bun';

await $`bun build --compile --minify ./src/cli.ts --outfile ./dist/rail`;
