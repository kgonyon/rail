import { $ } from 'bun';

/** Run a git command quietly in a given directory, returning stdout text. */
export async function gitExec(root: string, args: string): Promise<string> {
  const result = await $`git -C ${root} ${{ raw: args }}`.quiet();
  return result.text();
}

/**
 * Run a `gh` command quietly with a specific working directory, returning stdout text.
 * Unlike `gitExec`, `gh` has no `-C` flag — it reads the working tree itself.
 */
export async function ghExec(cwd: string, args: string): Promise<string> {
  const result = await $`gh ${{ raw: args }}`.cwd(cwd).quiet();
  return result.text();
}
