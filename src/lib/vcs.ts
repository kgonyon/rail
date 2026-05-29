import {
  addWorktree,
  fetchFromOrigin,
  getDefaultBranch,
  getWorktreeStats,
  listWorktrees,
  refreshFromOrigin,
  removeWorktree,
} from './git';
import {
  addJjWorkspace,
  fetchJjParent,
  getJjWorkspaceStats,
  listJjWorkspaces,
  refreshJjParent,
  removeJjWorkspace,
} from './jj';
import { getGitRoot, getProjectRoot } from './paths';
import type { WorktreeInfo, WorktreeStats, WorktreeStatsOptions } from './git';
import type { RailConfig } from '../types/config';

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
  refreshParent(root: string, parentRef: string): Promise<void>;
  fetchParent(root: string, parentRef: string): Promise<string>;
  createFeature(options: CreateFeatureOptions): Promise<void>;
  removeFeature(root: string, path: string): Promise<void>;
  listFeatures(root: string): Promise<VcsFeature[]>;
  getLocalFeatureStatus(
    path: string,
    options: WorktreeStatsOptions,
  ): Promise<VcsFeatureStatus>;
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
}

interface JjVcsDriverDependencies {
  getGitRoot: typeof getGitRoot;
  getProjectRoot: typeof getProjectRoot;
  refreshJjParent: typeof refreshJjParent;
  fetchJjParent: typeof fetchJjParent;
  addJjWorkspace: typeof addJjWorkspace;
  removeJjWorkspace: typeof removeJjWorkspace;
  listJjWorkspaces: typeof listJjWorkspaces;
  getJjWorkspaceStats: typeof getJjWorkspaceStats;
}

/** @internal */
export function createGitVcsDriver(deps: GitVcsDriverDependencies): VcsDriver {
  return {
    resolveRoot: deps.getGitRoot,
    resolveProjectRoot: deps.getProjectRoot,
    getDefaultParent: deps.getDefaultBranch,
    refreshParent(root, parentRef) {
      return deps.refreshFromOrigin(root, parentRef);
    },
    fetchParent(root, parentRef) {
      return deps.fetchFromOrigin(root, parentRef);
    },
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
  };
}

/** @internal */
export function createJjVcsDriver(deps: JjVcsDriverDependencies): VcsDriver {
  return {
    resolveRoot: deps.getGitRoot,
    resolveProjectRoot: deps.getProjectRoot,
    getDefaultParent() {
      return Promise.resolve('main@origin');
    },
    refreshParent(root, parentRef) {
      return deps.refreshJjParent(root, parentRef);
    },
    fetchParent(root, parentRef) {
      return deps.fetchJjParent(root, parentRef);
    },
    createFeature(options) {
      return deps.addJjWorkspace(
        options.root,
        options.path,
        options.branchPrefix,
        options.feature,
        options.parentRef,
      );
    },
    removeFeature(root, path) {
      return deps.removeJjWorkspace(root, path);
    },
    listFeatures(root) {
      return deps.listJjWorkspaces(root);
    },
    getLocalFeatureStatus(path) {
      return deps.getJjWorkspaceStats(path);
    },
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
});

export const jjVcsDriver: VcsDriver = createJjVcsDriver({
  getGitRoot,
  getProjectRoot,
  refreshJjParent,
  fetchJjParent,
  addJjWorkspace,
  removeJjWorkspace,
  listJjWorkspaces,
  getJjWorkspaceStats,
});

export function getVcsDriver(vcs: RailConfig['vcs']): VcsDriver {
  return vcs === 'jj' ? jjVcsDriver : gitVcsDriver;
}
