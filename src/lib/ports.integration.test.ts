import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  allocatePorts,
  deallocatePorts,
  loadFeatureAllocations,
  setSetupSkipped,
} from './ports';
import type { PortConfig } from '../types/config';

const portConfig: PortConfig = {
  base: 3000,
  per_feature: 10,
  max: 100,
};

describe('feature allocation integration', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rail-test-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('loadFeatureAllocations returns empty features for missing file', () => {
    const result = loadFeatureAllocations(tempRoot);
    expect(result).toEqual({ features: {} });
  });

  it('allocatePorts creates feature allocation file and returns index 0', () => {
    const index = allocatePorts(tempRoot, 'feat-a', portConfig);
    expect(index).toBe(0);

    const loaded = loadFeatureAllocations(tempRoot);
    expect(loaded.features['feat-a']).toEqual({ index: 0 });
    expect(existsSync(join(tempRoot, '.rail', 'feature_allocations.json'))).toBe(true);
  });

  it('allocatePorts returns existing index for same feature', () => {
    allocatePorts(tempRoot, 'feat-a', portConfig);
    const index = allocatePorts(tempRoot, 'feat-a', portConfig);
    expect(index).toBe(0);
  });

  it('allocatePorts assigns sequential indices', () => {
    const i0 = allocatePorts(tempRoot, 'feat-a', portConfig);
    const i1 = allocatePorts(tempRoot, 'feat-b', portConfig);
    expect(i0).toBe(0);
    expect(i1).toBe(1);
  });

  it('deallocatePorts removes the feature', () => {
    allocatePorts(tempRoot, 'feat-a', portConfig);
    deallocatePorts(tempRoot, 'feat-a');
    const loaded = loadFeatureAllocations(tempRoot);
    expect(loaded.features['feat-a']).toBeUndefined();
  });

  it('records whether setup was skipped for a feature', () => {
    allocatePorts(tempRoot, 'feat-a', portConfig);
    setSetupSkipped(tempRoot, 'feat-a', true);

    const loaded = loadFeatureAllocations(tempRoot);
    expect(loaded.features['feat-a']).toEqual({ index: 0, setupSkipped: true });
  });

  it('clears setup skipped state after a normal setup run', () => {
    allocatePorts(tempRoot, 'feat-a', portConfig);
    setSetupSkipped(tempRoot, 'feat-a', true);
    setSetupSkipped(tempRoot, 'feat-a', false);

    const loaded = loadFeatureAllocations(tempRoot);
    expect(loaded.features['feat-a']).toEqual({ index: 0 });
  });

  it('migrates legacy port allocations and removes the old file', () => {
    const railDir = join(tempRoot, '.rail');
    const legacyPath = join(railDir, 'port_allocations.json');
    mkdirSync(railDir, { recursive: true });
    writeFileSync(legacyPath, JSON.stringify({ features: { 'feat-a': { index: 2 } } }));

    const loaded = loadFeatureAllocations(tempRoot);

    expect(loaded.features['feat-a']).toEqual({ index: 2 });
    expect(existsSync(legacyPath)).toBe(false);
    expect(readFileSync(join(railDir, 'feature_allocations.json'), 'utf-8')).toContain('feat-a');
  });

  it('removes the legacy file when the feature allocation file already exists', () => {
    const railDir = join(tempRoot, '.rail');
    const legacyPath = join(railDir, 'port_allocations.json');
    mkdirSync(railDir, { recursive: true });
    writeFileSync(join(railDir, 'feature_allocations.json'), JSON.stringify({ features: {} }));
    writeFileSync(legacyPath, JSON.stringify({ features: { 'feat-a': { index: 2 } } }));

    const loaded = loadFeatureAllocations(tempRoot);

    expect(loaded).toEqual({ features: {} });
    expect(existsSync(legacyPath)).toBe(false);
  });

  it('allocatePorts reuses freed indices', () => {
    allocatePorts(tempRoot, 'feat-a', portConfig);
    allocatePorts(tempRoot, 'feat-b', portConfig);
    deallocatePorts(tempRoot, 'feat-a');
    const index = allocatePorts(tempRoot, 'feat-c', portConfig);
    expect(index).toBe(0);
  });

  it('allocatePorts throws when max slots exceeded', () => {
    const smallConfig: PortConfig = { base: 3000, per_feature: 10, max: 20 };
    allocatePorts(tempRoot, 'feat-a', smallConfig);
    allocatePorts(tempRoot, 'feat-b', smallConfig);
    expect(() => allocatePorts(tempRoot, 'feat-c', smallConfig)).toThrow(
      'No available port slots',
    );
  });
});
