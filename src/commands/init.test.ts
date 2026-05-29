import { describe, expect, it } from 'bun:test';
import { parse } from 'yaml';
import { buildConfigContent } from './init';
import { validateConfig } from '../lib/config';

describe('buildConfigContent', () => {
  it('generates a valid Git default config', () => {
    const config = parse(buildConfigContent('test-project'));

    expect(() => validateConfig(config)).not.toThrow();
    expect(config.vcs).toBe('git');
    expect(config.default_parent).toBe('main');
  });
});
