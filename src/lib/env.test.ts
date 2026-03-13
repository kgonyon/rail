import { describe, it, expect } from 'bun:test';
import { buildPortVars, substitutePortVars, processLine, applyReplacements } from './env';

describe('buildPortVars', () => {
  it('builds RAIL_PORT_N vars from port array', () => {
    const vars = buildPortVars([3000, 3001, 3002]);
    expect(vars).toEqual({
      RAIL_PORT_1: '3000',
      RAIL_PORT_2: '3001',
      RAIL_PORT_3: '3002',
    });
  });

  it('returns empty object for empty array', () => {
    expect(buildPortVars([])).toEqual({});
  });

  it('handles single port', () => {
    expect(buildPortVars([8080])).toEqual({ RAIL_PORT_1: '8080' });
  });
});

describe('substitutePortVars', () => {
  const portVars = { RAIL_PORT_1: '3000', RAIL_PORT_2: '3001' };

  it('substitutes ${RAIL_PORT_N} placeholders', () => {
    expect(substitutePortVars('http://localhost:${RAIL_PORT_1}', portVars)).toBe(
      'http://localhost:3000',
    );
  });

  it('substitutes multiple placeholders', () => {
    expect(
      substitutePortVars('${RAIL_PORT_1}:${RAIL_PORT_2}', portVars),
    ).toBe('3000:3001');
  });

  it('leaves unknown RAIL_PORT vars as-is', () => {
    expect(substitutePortVars('${RAIL_PORT_99}', portVars)).toBe('${RAIL_PORT_99}');
  });

  it('returns string unchanged if no placeholders', () => {
    expect(substitutePortVars('no-vars-here', portVars)).toBe('no-vars-here');
  });
});

describe('processLine', () => {
  const replace = { DATABASE_URL: 'postgres://localhost:${RAIL_PORT_1}/db' };
  const portVars = { RAIL_PORT_1: '5432' };

  it('replaces matching key with substituted value', () => {
    expect(processLine('DATABASE_URL=old_value', replace, portVars)).toBe(
      'DATABASE_URL=postgres://localhost:5432/db',
    );
  });

  it('leaves non-matching keys unchanged', () => {
    expect(processLine('API_KEY=secret', replace, portVars)).toBe(
      'API_KEY=secret',
    );
  });

  it('leaves comment lines unchanged', () => {
    expect(processLine('# This is a comment', replace, portVars)).toBe(
      '# This is a comment',
    );
  });

  it('leaves empty lines unchanged', () => {
    expect(processLine('', replace, portVars)).toBe('');
  });

  it('handles keys with no value in replace map', () => {
    const r = { PORT: '${RAIL_PORT_1}' };
    expect(processLine('PORT=3000', r, portVars)).toBe('PORT=5432');
  });

  it('applies secret value to matching key', () => {
    const secrets = { API_KEY: 'sk_test_abc123' };
    expect(processLine('API_KEY=placeholder', replace, portVars, secrets)).toBe(
      'API_KEY=sk_test_abc123',
    );
  });

  it('secret takes precedence over replace for the same key', () => {
    const secrets = { DATABASE_URL: 'postgres://user:s3cret@prod:5432/db' };
    expect(processLine('DATABASE_URL=old_value', replace, portVars, secrets)).toBe(
      'DATABASE_URL=postgres://user:s3cret@prod:5432/db',
    );
  });

  it('secret value is literal and not port-substituted', () => {
    const secrets = { MY_VAR: 'literal_${RAIL_PORT_1}_kept' };
    expect(processLine('MY_VAR=old', {}, portVars, secrets)).toBe(
      'MY_VAR=literal_${RAIL_PORT_1}_kept',
    );
  });

  it('ignores secrets for keys not in the template', () => {
    const secrets = { NONEXISTENT: 'value' };
    expect(processLine('API_KEY=keep', replace, portVars, secrets)).toBe(
      'API_KEY=keep',
    );
  });

  it('works with undefined secrets', () => {
    expect(processLine('DATABASE_URL=old', replace, portVars, undefined)).toBe(
      'DATABASE_URL=postgres://localhost:5432/db',
    );
  });
});

describe('applyReplacements', () => {
  const replace = {
    PORT: '${RAIL_PORT_1}',
    HOST: 'localhost',
  };
  const portVars = { RAIL_PORT_1: '3000' };

  it('replaces all matching lines in content', () => {
    const content = 'PORT=8080\nHOST=0.0.0.0\nOTHER=value';
    const result = applyReplacements(content, replace, portVars);
    expect(result).toBe('PORT=3000\nHOST=localhost\nOTHER=value');
  });

  it('preserves comments and empty lines', () => {
    const content = '# comment\n\nPORT=8080';
    const result = applyReplacements(content, replace, portVars);
    expect(result).toBe('# comment\n\nPORT=3000');
  });

  it('handles content with no replacements', () => {
    const content = 'UNKNOWN=value\nANOTHER=thing';
    const result = applyReplacements(content, replace, portVars);
    expect(result).toBe(content);
  });

  it('applies secrets across all matching lines', () => {
    const secrets = { HOST: 'prod.example.com', STRIPE_KEY: 'sk_live_xyz' };
    const content = 'PORT=8080\nHOST=0.0.0.0\nSTRIPE_KEY=placeholder\nOTHER=value';
    const result = applyReplacements(content, replace, portVars, secrets);
    expect(result).toBe(
      'PORT=3000\nHOST=prod.example.com\nSTRIPE_KEY=sk_live_xyz\nOTHER=value',
    );
  });

  it('secrets override replace values in full content', () => {
    const secrets = { PORT: '9999' };
    const content = 'PORT=8080\nHOST=0.0.0.0';
    const result = applyReplacements(content, replace, portVars, secrets);
    expect(result).toBe('PORT=9999\nHOST=localhost');
  });
});
