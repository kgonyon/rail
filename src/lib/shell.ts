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

/**
 * Run a `glab` command quietly with a specific working directory, returning stdout text.
 */
export async function glabExec(cwd: string, args: string): Promise<string> {
  const result = await $`glab ${{ raw: args }}`.cwd(cwd).quiet();
  return result.text();
}

const SHELL_STREAM_MAX_CHARS = 4000;

/**
 * If `err` is a Bun `ShellError`, return a human-readable string combining its
 * message with trimmed stderr (and stdout if non-empty). Each stream is capped
 * at `SHELL_STREAM_MAX_CHARS` to keep terminal output bounded. Returns `null`
 * for any other input so callers can fall back to their existing error path.
 */
export function formatShellError(err: unknown): string | null {
  if (!(err instanceof $.ShellError)) return null;

  const parts: string[] = [err.message];
  const stderr = truncate(err.stderr.toString('utf8').trim());
  const stdout = truncate(err.stdout.toString('utf8').trim());
  if (stderr.length > 0) parts.push(stderr);
  if (stdout.length > 0) parts.push(stdout);
  return parts.join('\n');
}

function truncate(text: string): string {
  if (text.length <= SHELL_STREAM_MAX_CHARS) return text;
  return `${text.slice(0, SHELL_STREAM_MAX_CHARS)}\n… (truncated)`;
}
