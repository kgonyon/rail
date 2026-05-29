import {
  addWorktree,
  fetchFromOrigin,
  getDefaultBranch,
  getWorktreeStats,
  isGhAvailable,
  listWorktrees,
  refreshFromOrigin,
  removeWorktree,
} from './git';
import { getGitRoot, getProjectRoot } from './paths';
import type { WorktreeInfo, WorktreeStats, WorktreeStatsOptions } from './git';

export type VcsFeature = WorktreeInfo;
export type VcsFeatureStatus = WorktreeStats;

export interface CreateFeatureOptions {
  root: string;
  path: string;
  branchPrefix: string;
  feature: string;
  parentRef?: string;
}

export interface VcsDriver {
  resolveRoot(): Promise<string>;
  resolveProjectRoot(): Promise<string>;
  getDefaultParent(root: string): Promise<string>;
  refreshParent(root: string): Promise<void>;
  fetchParent(root: string): Promise<string>;
  createFeature(options: CreateFeatureOptions): Promise<void>;
  removeFeature(root: string, path: string): Promise<void>;
  listFeatures(root: string): Promise<VcsFeature[]>;
  getLocalFeatureStatus(
    path: string,
    options: WorktreeStatsOptions,
  ): Promise<VcsFeatureStatus>;
  isPullRequestProviderAvailable(): Promise<boolean>;
}

interface GitVcsDriverDependencies {
  getGitRoot: typeof getGitRoot;
  getProjectRoot: typeof getProjectRoot;
  getDefaultBranch: typeof getDefaultBranch;
  refreshFromOrigin: typeof refreshFromOrigin;
  fetchFromOrigin: typeof fetchFromOrigin;
  addWorktree: typeof addWorktree;
  removeWorktree: typeof removeWorktree;
  listWorktrees: typeof listWorktrees;
  getWorktreeStats: typeof getWorktreeStats;
  isGhAvailable: typeof isGhAvailable;
}

/** @internal */
export function createGitVcsDriver(deps: GitVcsDriverDependencies): VcsDriver {
  return {
    resolveRoot: deps.getGitRoot,
    resolveProjectRoot: deps.getProjectRoot,
    getDefaultParent: deps.getDefaultBranch,
    refreshParent: deps.refreshFromOrigin,
    fetchParent: deps.fetchFromOrigin,
    createFeature(options) {
      return deps.addWorktree(
        options.root,
        options.path,
        options.branchPrefix,
        options.feature,
        options.parentRef,
      );
    },
    removeFeature(root, path) {
      return deps.removeWorktree(root, path);
    },
    listFeatures(root) {
      return deps.listWorktrees(root);
    },
    getLocalFeatureStatus(path, options) {
      return deps.getWorktreeStats(path, options);
    },
    isPullRequestProviderAvailable: deps.isGhAvailable,
  };
}

export const gitVcsDriver: VcsDriver = createGitVcsDriver({
  getGitRoot,
  getProjectRoot,
  getDefaultBranch,
  refreshFromOrigin,
  fetchFromOrigin,
  addWorktree,
  removeWorktree,
  listWorktrees,
  getWorktreeStats,
  isGhAvailable,
});
