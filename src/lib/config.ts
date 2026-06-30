import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';
import { parse } from 'yaml';
import { getConfigPath, getLocalConfigPath, getUserConfigPath, resolveWorktreesDir } from './paths';
import type { RailConfig } from '../types/config';

const CONFIG_REPAIR_MESSAGE = 'Run `rail init` to repair the project config.';
const VCS_VALUES = ['git', 'jj'];
const FORGE_VALUES = ['github', 'gitlab', 'none'];
const IGNORE_DESTINATION_VALUES = ['gitignore', 'exclude'];
const FEATURE_NAME_PATTERN = /^[A-Za-z0-9._\-/]+$/;
const PARENT_REF_PATTERN = /^[A-Za-z0-9._\-/@]+$/;
const PROJECT_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const REF_NAME_MAX_LENGTH = 255;

export interface LoadConfigOptions {
  parentRoot: string;
  configRoot: string;
  worktreesDir?: string;
  userConfigPath?: string;
}

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

export function loadConfig(rootOrOptions: string | LoadConfigOptions): RailConfig {
  const options = typeof rootOrOptions === 'string'
    ? { parentRoot: rootOrOptions, configRoot: rootOrOptions }
    : rootOrOptions;
  const configPath = getConfigPath(options.configRoot);
  const raw = readFileSync(configPath, 'utf-8');
  let config: unknown = {
    name: basename(options.parentRoot),
    worktrees: { dir: 'trees' },
  };

  const userPath = options.userConfigPath ?? getUserConfigPath();
  if (existsSync(userPath)) {
    const userRaw = readFileSync(userPath, 'utf-8');
    const userConfig = parseConfigYaml(userRaw, '~/.config/rail/config.yaml');
    if (isPlainObject(userConfig) && isPlainObject(config)) config = deepMerge(config, userConfig);
  }

  const projectConfig = parseConfigYaml(raw, '.rail/config.yaml');
  if (!isPlainObject(config)) {
    throw invalidConfig(['config must be a YAML object']);
  }
  if (!isPlainObject(projectConfig)) {
    throw invalidConfig(['.rail/config.yaml must be a YAML object']);
  }
  config = deepMerge(config, projectConfig);

  const localPath = getLocalConfigPath(options.configRoot);
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

  if (options.worktreesDir) {
    if (!isPlainObject(config)) {
      throw invalidConfig(['config must be a YAML object']);
    }
    const worktrees = isPlainObject(config.worktrees) ? config.worktrees : {};
    config = deepMerge(config, { worktrees: { ...worktrees, dir: options.worktreesDir } });
  }

  if (isPlainObject(config) && config.name == null) {
    config.name = basename(options.parentRoot);
  }

  validateConfig(config);
  config.worktrees.branch_prefix ??= '';
  config.worktrees.dir = resolveWorktreesDir(options.parentRoot, config.worktrees.dir);

  return config;
}

/** @internal */
export function validateConfig(config: unknown): asserts config is RailConfig {
  const errors: string[] = [];

  if (!isPlainObject(config)) {
    throw invalidConfig(['config must be a YAML object']);
  }

  const projectName = optionalNonEmptyString(config, 'name', errors);
  if (projectName && !isSafeProjectName(projectName)) {
    errors.push('name must contain only letters, digits, dot, underscore, or hyphen');
  }
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
export function isSafeProjectName(name: string): boolean {
  if (!name || name.length > REF_NAME_MAX_LENGTH) return false;
  if (!PROJECT_NAME_PATTERN.test(name)) return false;
  return name !== '.' && name !== '..';
}

/** @internal */
export function isSafeFeatureName(name: string): boolean {
  if (!name || name.length > REF_NAME_MAX_LENGTH) return false;
  if (!FEATURE_NAME_PATTERN.test(name)) return false;

  const segments = name.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** @internal */
export function validateFeatureName(name: string): void {
  if (!isSafeFeatureName(name)) {
    throw new Error(
      `Invalid feature name "${name}". Use slash-separated segments containing only letters, digits, dot, underscore, or hyphen.`,
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

  if (value.dir !== undefined && value.dir !== null) {
    requireNonEmptyString(value, 'worktrees.dir', errors, 'dir');
  }
  const branchPrefix = optionalString(value, 'worktrees.branch_prefix', errors, 'branch_prefix');
  if (branchPrefix && !isSafeParentRefName(branchPrefix)) {
    errors.push('worktrees.branch_prefix must contain only letters, digits, dot, underscore, hyphen, slash, or @');
  }
}

function optionalString(
  object: Record<string, any>,
  label: string,
  errors: string[],
  key = label,
): string | undefined {
  const value = object[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${label} must be a string`);
    return undefined;
  }
  return value;
}

function optionalNonEmptyString(
  object: Record<string, any>,
  label: string,
  errors: string[],
  key = label,
): string | undefined {
  const value = object[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    errors.push(`${label} must be a string`);
    return undefined;
  }
  if (value.trim() === '') {
    errors.push(`${label} must not be empty`);
    return undefined;
  }
  return value;
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
