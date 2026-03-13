import type { HookConfig } from './hooks';

export interface WorktreesConfig {
  dir: string;
  branch_prefix: string;
}

export interface PortConfig {
  base: number;
  per_feature: number;
  max: number;
}

export interface EnvFile {
  path: string;
  source: string;
  dest: string;
  replace: Record<string, string>;
}

export interface CommandConfig {
  name: string;
  command: string;
  description?: string;
  scope?: 'feature' | 'project';
}

export interface ScriptsConfig {
  setup?: string;
  cleanup?: string;
}

export interface RailConfig {
  name: string;
  worktrees: WorktreesConfig;
  port: PortConfig;
  scripts?: ScriptsConfig;
  commands?: CommandConfig[];
  env_files?: EnvFile[];
  hooks?: HookConfig;
  secrets?: Record<string, string>;
}

export interface PortAllocation {
  index: number;
}

export interface PortAllocations {
  features: Record<string, PortAllocation>;
}
