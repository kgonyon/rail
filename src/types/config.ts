import type { HookConfig } from './hooks';

export interface WorktreesConfig {
  dir: string;
  branch_prefix?: string;
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

export interface SetupConfig {
  track_rail: boolean;
  ignore_destination: 'gitignore' | 'exclude';
}

export interface RailConfig {
  name: string;
  vcs: 'git' | 'jj';
  forge: 'github' | 'gitlab' | 'none';
  default_parent: string;
  auto_refresh: boolean;
  setup: SetupConfig;
  worktrees: WorktreesConfig;
  port: PortConfig;
  scripts?: ScriptsConfig;
  commands?: CommandConfig[];
  env_files?: EnvFile[];
  hooks?: HookConfig;
  secrets?: Record<string, string>;
}

export interface FeatureAllocation {
  index: number;
  setupSkipped?: boolean;
}

export interface FeatureAllocations {
  features: Record<string, FeatureAllocation>;
}
