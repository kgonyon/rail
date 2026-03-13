import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { getConfigPath, getLocalConfigPath } from './paths';
import type { RailConfig } from '../types/config';

/** @internal */
export function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @internal */
export function deepMerge(
  target: Record<string, any>,
  source: Record<string, any>,
): Record<string, any> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    if (isPlainObject(source[key]) && isPlainObject(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

export function loadConfig(root: string): RailConfig {
  const configPath = getConfigPath(root);
  const raw = readFileSync(configPath, 'utf-8');
  let config = parse(raw) as RailConfig;

  const localPath = getLocalConfigPath(root);
  if (existsSync(localPath)) {
    const localRaw = readFileSync(localPath, 'utf-8');
    const localConfig = parse(localRaw);
    config = deepMerge(config, localConfig) as RailConfig;
  }

  return config;
}
