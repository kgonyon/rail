import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';
import { getFeatureAllocationsPath, getLegacyPortAllocationsPath } from './paths';
import type { FeatureAllocations, PortConfig } from '../types/config';

export function loadFeatureAllocations(root: string): FeatureAllocations {
  const path = getFeatureAllocationsPath(root);

  if (!existsSync(path)) {
    return loadLegacyFeatureAllocations(root);
  }

  const raw = readFileSync(path, 'utf-8');
  const allocations = JSON.parse(raw) as FeatureAllocations;
  removeLegacyFeatureAllocations(root);
  return allocations;
}

export function saveFeatureAllocations(root: string, allocations: FeatureAllocations): void {
  const path = getFeatureAllocationsPath(root);
  const dir = dirname(path);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, JSON.stringify(allocations, null, 2) + '\n');
  removeLegacyFeatureAllocations(root);
}

export function allocatePorts(root: string, feature: string, portConfig: PortConfig): number {
  const allocations = loadFeatureAllocations(root);

  if (allocations.features[feature]) {
    return allocations.features[feature].index;
  }

  const usedIndices = new Set(
    Object.values(allocations.features).map((a) => a.index),
  );

  const maxSlots = Math.floor(portConfig.max / portConfig.per_feature);
  let index = 0;

  while (usedIndices.has(index) && index < maxSlots) {
    index++;
  }

  if (index >= maxSlots) {
    throw new Error(`No available port slots (max ${maxSlots} features)`);
  }

  allocations.features[feature] = { index };
  saveFeatureAllocations(root, allocations);

  return index;
}

export function setSetupSkipped(root: string, feature: string, setupSkipped: boolean): void {
  const allocations = loadFeatureAllocations(root);
  const allocation = allocations.features[feature];

  if (!allocation) return;

  const { setupSkipped: _setupSkipped, ...rest } = allocation;
  allocations.features[feature] = setupSkipped ? { ...rest, setupSkipped: true } : rest;
  saveFeatureAllocations(root, allocations);
}

export function deallocatePorts(root: string, feature: string): void {
  const allocations = loadFeatureAllocations(root);
  delete allocations.features[feature];
  saveFeatureAllocations(root, allocations);
}

export function getPortsForFeature(portConfig: PortConfig, index: number): number[] {
  const ports: number[] = [];

  for (let i = 0; i < portConfig.per_feature; i++) {
    ports.push(portConfig.base + index * portConfig.per_feature + i);
  }

  return ports;
}

function loadLegacyFeatureAllocations(root: string): FeatureAllocations {
  const legacyPath = getLegacyPortAllocationsPath(root);

  if (!existsSync(legacyPath)) return { features: {} };

  const raw = readFileSync(legacyPath, 'utf-8');
  const allocations = JSON.parse(raw) as FeatureAllocations;
  saveFeatureAllocations(root, allocations);
  return allocations;
}

function removeLegacyFeatureAllocations(root: string): void {
  rmSync(getLegacyPortAllocationsPath(root), { force: true });
}
