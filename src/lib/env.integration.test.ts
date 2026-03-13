import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { generateEnvFiles } from './env';
import type { EnvFile } from '../types/config';

describe('generateEnvFiles integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rail-env-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates env file from template with replacements', () => {
    const pkgDir = join(tempDir, 'packages', 'api');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '.env.template'), 'PORT=3000\nDATABASE_URL=postgres://localhost:5432/db\n');

    const envFiles: EnvFile[] = [
      {
        path: 'packages/api',
        source: '.env.template',
        dest: '.env',
        replace: {
          PORT: '${RAIL_PORT_1}',
          DATABASE_URL: 'postgres://localhost:${RAIL_PORT_2}/db',
        },
      },
    ];

    generateEnvFiles(tempDir, envFiles, [3100, 3101]);

    const content = readFileSync(join(pkgDir, '.env'), 'utf-8');
    expect(content).toContain('PORT=3100');
    expect(content).toContain('DATABASE_URL=postgres://localhost:3101/db');
  });

  it('preserves lines not in replace map', () => {
    const pkgDir = join(tempDir, 'app');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, '.env.example'), 'API_KEY=secret\nPORT=3000\n');

    const envFiles: EnvFile[] = [
      {
        path: 'app',
        source: '.env.example',
        dest: '.env.local',
        replace: { PORT: '${RAIL_PORT_1}' },
      },
    ];

    generateEnvFiles(tempDir, envFiles, [4000]);

    const content = readFileSync(join(pkgDir, '.env.local'), 'utf-8');
    expect(content).toContain('API_KEY=secret');
    expect(content).toContain('PORT=4000');
  });

  it('throws when source template is missing', () => {
    const envFiles: EnvFile[] = [
      {
        path: 'missing',
        source: '.env.template',
        dest: '.env',
        replace: {},
      },
    ];

    expect(() => generateEnvFiles(tempDir, envFiles, [])).toThrow(
      'Env template not found',
    );
  });
});
