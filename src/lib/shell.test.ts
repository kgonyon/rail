import { describe, expect, test } from 'bun:test';
import { $ } from 'bun';
import { formatShellError } from './shell';

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
