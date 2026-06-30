import { validateFeatureName } from './config';
import { getFeatureNameFromDirName } from './paths';
import type { FeatureAllocations } from '../types/config';

export function detectFeatureFromCwd(cwd: string, treesDir: string): string | null {
  const normalized = cwd.replace(/\\/g, '/');
  const dir = treesDir.replace(/\\/g, '/').replace(/\/$/, '');
  const prefix = `${dir}/`;

  if (!normalized.startsWith(prefix)) return null;

  const afterTrees = normalized.slice(prefix.length);
  const featureDirName = afterTrees.split('/')[0];
  const feature = featureDirName ? getFeatureNameFromDirName(featureDirName) : '';

  return feature || null;
}

export interface ResolveFeatureOptions {
  treesDir?: string;
  allocations?: FeatureAllocations;
  commandName?: string;
}

export function detectFeatureFromAllocations(cwd: string, allocations: FeatureAllocations): string | null {
  const normalized = cwd.replace(/\\/g, '/');

  for (const [feature, allocation] of Object.entries(allocations.features)) {
    if (!allocation.path) continue;

    const dir = allocation.path.replace(/\\/g, '/').replace(/\/$/, '');
    if (normalized === dir || normalized.startsWith(`${dir}/`)) return feature;
  }

  return null;
}

export function resolveFeature(
  feature: string | undefined,
  treesDirOrOptions: string | ResolveFeatureOptions,
  commandName?: string,
): string {
  const options = typeof treesDirOrOptions === 'string'
    ? { treesDir: treesDirOrOptions, commandName }
    : treesDirOrOptions;
  if (feature) {
    validateFeatureName(feature);
    return feature;
  }

  const detected = options.allocations
    ? detectFeatureFromAllocations(process.cwd(), options.allocations)
    : null;
  const fallbackDetected = !detected && options.treesDir
    ? detectFeatureFromCwd(process.cwd(), options.treesDir)
    : null;
  const resolved = detected ?? fallbackDetected;
  if (!resolved) {
    if (options.commandName) {
      throw new Error(
        `Command "${options.commandName}" requires a feature context. Run from inside a feature tree or pass -f <feature>.`,
      );
    }
    throw new Error('Could not detect feature name. Provide it as an argument.');
  }

  validateFeatureName(resolved);
  return resolved;
}
