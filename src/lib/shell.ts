import { $ } from 'bun';

/**
 * Run a git command quietly in a given directory, returning stdout text.
 *
 * Passes `--no-optional-locks` so concurrent reads (e.g. parallel `rail status`
 * workers) don't race a user's foreground git command for `index.lock`. Safe
 * for write commands too — git ignores the flag where it doesn't apply.
 */
export async function gitExec(root: string, args: string): Promise<string> {
  const result = await $`git -C ${root} --no-optional-locks ${{ raw: args }}`.quiet();
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
