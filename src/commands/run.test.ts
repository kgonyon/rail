import { describe, it, expect } from 'bun:test';
import { findCommand, extractExtraArgs, shellEscape } from './run';
import type { WtConfig } from '../types/config';

function makeConfig(commands?: WtConfig['commands']): WtConfig {
  const config: WtConfig = {
    name: 'test-project',
    worktrees: { dir: '.trees', branch_prefix: 'feature/' },
    port: { base: 3000, per_feature: 10, max: 100 },
  };
  if (commands !== undefined) {
    config.commands = commands;
  }
  return config;
}

describe('findCommand', () => {
  it('returns the matching command config', () => {
    const config = makeConfig([
      { name: 'dev', command: 'npm run dev' },
      { name: 'build', command: 'npm run build' },
    ]);
    const result = findCommand(config, 'dev');
    expect(result).toEqual({ name: 'dev', command: 'npm run dev' });
  });

  it('throws for unknown command with available list', () => {
    const config = makeConfig([
      { name: 'dev', command: 'npm run dev' },
      { name: 'build', command: 'npm run build' },
    ]);
    expect(() => findCommand(config, 'test')).toThrow('Unknown command "test"');
    expect(() => findCommand(config, 'test')).toThrow('Available: dev, build');
  });

  it('throws with "none" when commands is undefined', () => {
    const config = makeConfig(undefined);
    expect(() => findCommand(config, 'dev')).toThrow('Available: none');
  });

  it('throws for empty commands array', () => {
    const config = makeConfig([]);
    expect(() => findCommand(config, 'dev')).toThrow('Unknown command "dev"');
  });
});

describe('extractExtraArgs', () => {
  it('returns empty array when no -- present', () => {
    expect(extractExtraArgs(['dev', '-f', 'my-feature'])).toEqual([]);
  });

  it('returns args after --', () => {
    expect(extractExtraArgs(['dev', '--', '--tunnel'])).toEqual(['--tunnel']);
  });

  it('returns multiple args after --', () => {
    expect(extractExtraArgs(['dev', '--', '--tunnel', '--port', '4000'])).toEqual([
      '--tunnel',
      '--port',
      '4000',
    ]);
  });

  it('returns empty array when -- is last element', () => {
    expect(extractExtraArgs(['dev', '--'])).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(extractExtraArgs([])).toEqual([]);
  });

  it('uses only the first -- separator', () => {
    expect(extractExtraArgs(['dev', '--', '--flag', '--', 'value'])).toEqual([
      '--flag',
      '--',
      'value',
    ]);
  });
});

describe('shellEscape', () => {
  it('wraps a simple flag in single quotes', () => {
    expect(shellEscape(['--tunnel'])).toBe("'--tunnel'");
  });

  it('handles args with spaces', () => {
    expect(shellEscape(['hello world'])).toBe("'hello world'");
  });

  it('escapes single quotes in args', () => {
    expect(shellEscape(["it's"])).toBe("'it'\\''s'");
  });

  it('joins multiple args with spaces', () => {
    expect(shellEscape(['--a', '--b'])).toBe("'--a' '--b'");
  });

  it('returns empty string for empty array', () => {
    expect(shellEscape([])).toBe('');
  });
});
