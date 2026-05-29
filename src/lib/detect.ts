import { validateFeatureName } from './config';
import { getFeatureNameFromDirName } from './paths';

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

export function resolveFeature(
  feature: string | undefined,
  treesDir: string,
  commandName?: string,
): string {
  if (feature) {
    validateFeatureName(feature);
    return feature;
  }

  const detected = detectFeatureFromCwd(process.cwd(), treesDir);
  if (!detected) {
    if (commandName) {
      throw new Error(
        `Command "${commandName}" requires a feature context. Run from inside a feature tree or pass -f <feature>.`,
      );
    }
    throw new Error('Could not detect feature name. Provide it as an argument.');
  }

  validateFeatureName(detected);
  return detected;
}
