import { describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { formatShellError, gitExec } from './shell';

describe('formatShellError', () => {
  test('returns null for non-ShellError values', () => {
    expect(formatShellError(new Error('plain'))).toBeNull();
    expect(formatShellError('string')).toBeNull();
    expect(formatShellError(null)).toBeNull();
    expect(formatShellError(undefined)).toBeNull();
  });

  test('includes stderr from a real ShellError', async () => {
    let caught: unknown;
    try {
      await $`sh -c 'echo boom 1>&2; exit 128'`.quiet();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf($.ShellError);

    const formatted = formatShellError(caught);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('boom');
  });

  test('truncates stderr longer than the cap', async () => {
    const payload = 'x'.repeat(5000);
    let caught: unknown;
    try {
      await $`sh -c ${`printf %s "${payload}" 1>&2; exit 1`}`.quiet();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf($.ShellError);

    const formatted = formatShellError(caught);
    expect(formatted).not.toBeNull();
    expect(formatted).toContain('… (truncated)');
  });

  test('returns only the message when both streams are empty', async () => {
    let caught: unknown;
    try {
      await $`sh -c 'exit 7'`.quiet();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf($.ShellError);

    const formatted = formatShellError(caught);
    expect(formatted).not.toBeNull();
    expect(formatted).not.toContain('\n');
  });
});

describe('gitExec', () => {
  test('forwards git stderr when a command fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rail-shell-'));
    try {
      await expect(gitExec(root, 'status')).rejects.toThrow(/not a git repository/);
      await expect(gitExec(root, 'status')).rejects.toThrow(/Failed with exit code/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
