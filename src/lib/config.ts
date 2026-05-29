import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { getConfigPath, getLocalConfigPath, resolveWorktreesDir } from './paths';
import type { RailConfig } from '../types/config';

const CONFIG_REPAIR_MESSAGE = 'Run `rail init` to repair the project config.';
const VCS_VALUES = ['git', 'jj'];
const FORGE_VALUES = ['github', 'gitlab', 'none'];
const IGNORE_DESTINATION_VALUES = ['gitignore', 'exclude'];
const FEATURE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const PARENT_REF_PATTERN = /^[A-Za-z0-9._\-/@]+$/;
const REF_NAME_MAX_LENGTH = 255;

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
  let config = parseConfigYaml(raw, '.rail/config.yaml');

  const localPath = getLocalConfigPath(root);
  if (existsSync(localPath)) {
    const localRaw = readFileSync(localPath, 'utf-8');
    const localConfig = parseConfigYaml(localRaw, '.rail/local.yaml');
    if (!isPlainObject(config)) {
      throw invalidConfig(['config must be a YAML object']);
    }
    if (!isPlainObject(localConfig)) {
      throw invalidConfig(['.rail/local.yaml must be a YAML object']);
    }
    config = deepMerge(config, localConfig);
  }

  validateConfig(config);
  config.worktrees.dir = resolveWorktreesDir(root, config.worktrees.dir);

  return config;
}

/** @internal */
export function validateConfig(config: unknown): asserts config is RailConfig {
  const errors: string[] = [];

  if (!isPlainObject(config)) {
    throw invalidConfig(['config must be a YAML object']);
  }

  requireNonEmptyString(config, 'name', errors);
  requireEnum(config, 'vcs', VCS_VALUES, errors);
  requireEnum(config, 'forge', FORGE_VALUES, errors);
  requireBoolean(config, 'auto_refresh', errors);

  const defaultParent = requireNonEmptyString(config, 'default_parent', errors);
  if (defaultParent && !isSafeParentRefName(defaultParent)) {
    errors.push('default_parent must contain only letters, digits, dot, underscore, hyphen, slash, or @');
  }

  validateWorktrees(config.worktrees, errors);
  validatePort(config.port, errors);
  validateSetup(config.setup, errors);

  if (errors.length > 0) {
    throw invalidConfig(errors);
  }
}

/** @internal */
export function isSafeFeatureName(name: string): boolean {
  if (!name || name.length > REF_NAME_MAX_LENGTH) return false;
  if (name === '.' || name === '..') return false;
  return FEATURE_NAME_PATTERN.test(name);
}

/** @internal */
export function validateFeatureName(name: string): void {
  if (!isSafeFeatureName(name)) {
    throw new Error(
      `Invalid feature name "${name}". Use a single path segment containing only letters, digits, dot, underscore, or hyphen.`,
    );
  }
}

/** @internal */
export function isSafeParentRefName(name: string): boolean {
  if (!name || name.length > REF_NAME_MAX_LENGTH) return false;
  return PARENT_REF_PATTERN.test(name);
}

function validateWorktrees(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('worktrees is required');
    return;
  }

  requireNonEmptyString(value, 'worktrees.dir', errors, 'dir');
  const branchPrefix = requireString(value, 'worktrees.branch_prefix', errors, 'branch_prefix');
  if (branchPrefix && !isSafeParentRefName(branchPrefix)) {
    errors.push('worktrees.branch_prefix must contain only letters, digits, dot, underscore, hyphen, slash, or @');
  }
}

function validatePort(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('port is required');
    return;
  }

  requirePositiveInteger(value, 'port.base', errors, 'base');
  requirePositiveInteger(value, 'port.per_feature', errors, 'per_feature');
  requirePositiveInteger(value, 'port.max', errors, 'max');
}

function validateSetup(value: unknown, errors: string[]): void {
  if (!isPlainObject(value)) {
    errors.push('setup is required');
    return;
  }

  requireBoolean(value, 'setup.track_rail', errors, 'track_rail');
  requireEnum(value, 'setup.ignore_destination', IGNORE_DESTINATION_VALUES, errors, 'ignore_destination');
}

function requireString(
  object: Record<string, any>,
  label: string,
  errors: string[],
  key = label,
): string | undefined {
  const value = object[key];
  if (typeof value !== 'string') {
    errors.push(`${label} is required`);
    return undefined;
  }
  return value;
}

function requireNonEmptyString(
  object: Record<string, any>,
  label: string,
  errors: string[],
  key = label,
): string | undefined {
  const value = requireString(object, label, errors, key);
  if (value !== undefined && value.trim() === '') {
    errors.push(`${label} must not be empty`);
    return undefined;
  }
  return value;
}

function requireBoolean(
  object: Record<string, any>,
  label: string,
  errors: string[],
  key = label,
): void {
  if (typeof object[key] !== 'boolean') {
    errors.push(`${label} is required`);
  }
}

function requireEnum(
  object: Record<string, any>,
  label: string,
  values: string[],
  errors: string[],
  key = label,
): void {
  const value = object[key];
  if (typeof value !== 'string') {
    errors.push(`${label} is required`);
    return;
  }
  if (!values.includes(value)) {
    errors.push(`${label} must be one of: ${values.join(', ')}`);
  }
}

function requirePositiveInteger(
  object: Record<string, any>,
  label: string,
  errors: string[],
  key = label,
): void {
  const value = object[key];
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label} must be a positive integer`);
  }
}

function invalidConfig(errors: string[]): Error {
  return new Error(`Invalid .rail/config.yaml:\n- ${errors.join('\n- ')}\n${CONFIG_REPAIR_MESSAGE}`);
}

function parseConfigYaml(raw: string, path: string): unknown {
  try {
    return parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw invalidConfig([`could not parse ${path}: ${message}`]);
  }
}
