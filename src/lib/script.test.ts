import { describe, it, expect } from 'bun:test';
import { buildEnv } from './script';
import type { ScriptContext } from './script';

function makeContext(overrides: Partial<ScriptContext> = {}): ScriptContext {
  return {
    root: '/projects/app',
    feature: 'my-feature',
    featureDir: '/projects/app/.trees/my-feature',
    projectName: 'app',
    ports: [3100, 3101, 3102],
    basePort: 3100,
    ...overrides,
  };
}

describe('buildEnv', () => {
  it('always sets RAIL_PROJECT and RAIL_PROJECT_DIR', () => {
    const env = buildEnv(makeContext());
    expect(env.RAIL_PROJECT).toBe('app');
    expect(env.RAIL_PROJECT_DIR).toBe('/projects/app');
  });

  it('sets feature vars when feature is present', () => {
    const env = buildEnv(makeContext());
    expect(env.RAIL_FEATURE).toBe('my-feature');
    expect(env.RAIL_FEATURE_DIR).toBe('/projects/app/.trees/my-feature');
    expect(env.RAIL_PORT).toBe('3100');
  });

  it('sets numbered port vars for each port', () => {
    const env = buildEnv(makeContext());
    expect(env.RAIL_PORT_1).toBe('3100');
    expect(env.RAIL_PORT_2).toBe('3101');
    expect(env.RAIL_PORT_3).toBe('3102');
  });

  it('omits feature vars when feature is empty', () => {
    const env = buildEnv(makeContext({ feature: '', ports: [], basePort: 0 }));
    expect(env.RAIL_FEATURE).toBeUndefined();
    expect(env.RAIL_FEATURE_DIR).toBeUndefined();
    expect(env.RAIL_PORT).toBeUndefined();
    expect(env.RAIL_PORT_1).toBeUndefined();
  });

  it('handles single port', () => {
    const env = buildEnv(makeContext({ ports: [8080], basePort: 8080 }));
    expect(env.RAIL_PORT).toBe('8080');
    expect(env.RAIL_PORT_1).toBe('8080');
    expect(env.RAIL_PORT_2).toBeUndefined();
  });

  it('handles zero ports with feature', () => {
    const env = buildEnv(makeContext({ ports: [] }));
    // feature is present so RAIL_FEATURE is set, but no RAIL_PORT_N vars
    expect(env.RAIL_FEATURE).toBe('my-feature');
    expect(env.RAIL_PORT_1).toBeUndefined();
  });
});
