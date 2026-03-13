import { describe, it, expect } from 'bun:test';
import { isHookEvent, validateHookConfig, mergeHookConfigs } from './hooks';
import type { HookConfig } from '../types/hooks';

describe('isHookEvent', () => {
  it('returns true for valid events', () => {
    expect(isHookEvent('up')).toBe(true);
    expect(isHookEvent('down')).toBe(true);
    expect(isHookEvent('run')).toBe(true);
  });

  it('returns false for invalid events', () => {
    expect(isHookEvent('pre_up')).toBe(false);
    expect(isHookEvent('post_down')).toBe(false);
    expect(isHookEvent('invalid')).toBe(false);
    expect(isHookEvent('')).toBe(false);
  });
});

describe('validateHookConfig', () => {
  const configDir = '/project/.rail';

  it('returns empty array for non-array input', () => {
    expect(validateHookConfig(null, configDir)).toEqual([]);
    expect(validateHookConfig(undefined, configDir)).toEqual([]);
    expect(validateHookConfig('string', configDir)).toEqual([]);
    expect(validateHookConfig({}, configDir)).toEqual([]);
  });

  it('returns empty array for empty array', () => {
    expect(validateHookConfig([], configDir)).toEqual([]);
  });

  it('validates and returns valid hook entries', () => {
    const raw = [
      { event: 'up', command: 'echo up' },
      { event: 'down', command: 'echo down' },
    ];
    const result = validateHookConfig(raw, configDir);
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe('up');
    expect(result[1].event).toBe('down');
  });

  it('filters out entries with invalid events', () => {
    const raw = [
      { event: 'up', command: 'echo up' },
      { event: 'invalid', command: 'echo nope' },
    ];
    const result = validateHookConfig(raw, configDir);
    expect(result).toHaveLength(1);
    expect(result[0].event).toBe('up');
  });

  it('filters out entries with missing command', () => {
    const raw = [
      { event: 'up' },
      { event: 'down', command: 'echo down' },
    ];
    const result = validateHookConfig(raw, configDir);
    expect(result).toHaveLength(1);
    expect(result[0].event).toBe('down');
  });

  it('resolves relative paths in commands', () => {
    const raw = [{ event: 'up', command: './scripts/setup.sh' }];
    const result = validateHookConfig(raw, configDir);
    expect(result[0].command).toContain(configDir);
    expect(result[0].command).toContain('scripts/setup.sh');
  });

  it('leaves bare commands unchanged', () => {
    const raw = [{ event: 'up', command: 'npm run build' }];
    const result = validateHookConfig(raw, configDir);
    expect(result[0].command).toBe('npm run build');
  });
});

describe('mergeHookConfigs', () => {
  it('concatenates multiple configs', () => {
    const a: HookConfig = [{ event: 'up', command: 'a' }];
    const b: HookConfig = [{ event: 'down', command: 'b' }];
    const result = mergeHookConfigs(a, b);
    expect(result).toHaveLength(2);
    expect(result[0].event).toBe('up');
    expect(result[1].event).toBe('down');
  });

  it('returns empty array for no inputs', () => {
    expect(mergeHookConfigs()).toEqual([]);
  });

  it('handles empty configs', () => {
    const a: HookConfig = [{ event: 'up', command: 'a' }];
    expect(mergeHookConfigs(a, [])).toHaveLength(1);
  });

  it('preserves order: project, local, user', () => {
    const project: HookConfig = [{ event: 'up', command: 'first' }];
    const local: HookConfig = [{ event: 'up', command: 'second' }];
    const user: HookConfig = [{ event: 'up', command: 'third' }];
    const result = mergeHookConfigs(project, local, user);
    expect(result.map((h) => h.command)).toEqual(['first', 'second', 'third']);
  });
});
