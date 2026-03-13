import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPortAllocations, allocatePorts, deallocatePorts, savePortAllocations } from './ports';
import type { PortConfig } from '../types/config';

const portConfig: PortConfig = {
  base: 3000,
  per_feature: 10,
  max: 100,
};

describe('port allocation integration', () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'rail-test-'));
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('loadPortAllocations returns empty features for missing file', () => {
    const result = loadPortAllocations(tempRoot);
    expect(result).toEqual({ features: {} });
  });

  it('allocatePorts creates allocation file and returns index 0', () => {
    const index = allocatePorts(tempRoot, 'feat-a', portConfig);
    expect(index).toBe(0);

    const loaded = loadPortAllocations(tempRoot);
    expect(loaded.features['feat-a']).toEqual({ index: 0 });
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
    const loaded = loadPortAllocations(tempRoot);
    expect(loaded.features['feat-a']).toBeUndefined();
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
