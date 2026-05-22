export const GITHUB_REPO = 'kgonyon/rail';
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const CHECKSUMS_ASSET = 'checksums.txt';

const VERSION_PATTERN = /^v?\d+\.\d+\.\d+$/;

export function normalizeVersion(version: string): string {
  return version.startsWith('v') ? version.slice(1) : version;
}

export function isStableTag(tag: string): boolean {
  return VERSION_PATTERN.test(tag);
}

export function compareVersions(left: string, right: string): number {
  if (left === 'dev' && right === 'dev') return 0;
  if (left === 'dev') return -1;
  if (right === 'dev') return 1;

  const a = parseVersion(normalizeVersion(left));
  const b = parseVersion(normalizeVersion(right));
  for (let i = 0; i < a.length; i++) {
    if (a[i]! > b[i]!) return 1;
    if (a[i]! < b[i]!) return -1;
  }
  return 0;
}

export function getReleaseAssetName(platform = process.platform, arch = process.arch): string {
  if (platform === 'darwin' && arch === 'x64') return 'rail_Darwin_x86_64.tar.gz';
  if (platform === 'darwin' && arch === 'arm64') return 'rail_Darwin_arm64.tar.gz';
  if (platform === 'linux' && arch === 'x64') return 'rail_Linux_x86_64.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'rail_Linux_arm64.tar.gz';
  throw new Error(`Unsupported platform for rail upgrade: ${platform}/${arch}`);
}

function parseVersion(version: string): number[] {
  const parts = version.split('.');
  if (parts.length !== 3) throw new Error(`Invalid version: ${version}`);
  return parts.map((part) => {
    const value = Number.parseInt(part, 10);
    if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid version: ${version}`);
    return value;
  });
}
