import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import { chmod, mkdtemp, rename, rm, stat, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';
import { detectInstallMethod } from './install';
import { fetchLatestRelease, fetchText, type GitHubRelease, type ReleaseAsset } from './update';
import { CHECKSUMS_ASSET, compareVersions, getReleaseAssetName } from './release';

const execFileAsync = promisify(execFile);
const DOWNLOAD_TIMEOUT_MS = 60_000;
const BREW_TIMEOUT_MS = 5 * 60_000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export async function upgradeRail(options: {
  currentVersion: string;
  execPath?: string;
}): Promise<string> {
  const execPath = options.execPath ?? process.execPath;
  const method = await detectInstallMethod(execPath);

  if (method === 'homebrew') {
    await upgradeHomebrew();
    return 'Upgraded rail with Homebrew';
  }
  if (method === 'source') {
    throw new Error('rail upgrade is only supported from an installed rail binary, not bun run.');
  }
  return upgradeManual(options.currentVersion, execPath);
}

export async function upgradeHomebrew(): Promise<void> {
  await execFileAsync('brew', ['update'], { timeout: BREW_TIMEOUT_MS });
  await execFileAsync('brew', ['upgrade', 'kgonyon/tap/rail'], { timeout: BREW_TIMEOUT_MS });
}

async function upgradeManual(currentVersion: string, execPath: string): Promise<string> {
  const release = await fetchLatestRelease(DOWNLOAD_TIMEOUT_MS);
  if (compareVersions(release.version, currentVersion) <= 0) {
    return `rail is already up to date (${currentVersion})`;
  }

  const asset = selectAsset(release, getReleaseAssetName());
  const checksums = await downloadChecksums(release);
  const archivePath = await downloadVerifiedArchive(asset, checksums, execPath);

  try {
    await replaceExecutableFromArchive(archivePath, execPath);
  } finally {
    await rm(dirname(archivePath), { recursive: true, force: true });
  }
  return `Upgraded rail to ${release.version}`;
}

export function selectAsset(release: GitHubRelease, assetName: string): ReleaseAsset {
  const asset = release.assets.find((item) => item.name === assetName);
  if (!asset) throw new Error(`Latest release is missing ${assetName}`);
  return asset;
}

export async function downloadChecksums(release: GitHubRelease): Promise<Map<string, string>> {
  const asset = selectAsset(release, CHECKSUMS_ASSET);
  const text = await fetchText(asset.browserDownloadUrl, DOWNLOAD_TIMEOUT_MS);
  return parseChecksums(text);
}

export function parseChecksums(text: string): Map<string, string> {
  const checksums = new Map<string, string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [hash, name] = trimmed.split(/\s+/, 2);
    if (!hash || !name || !SHA256_PATTERN.test(hash)) throw new Error('Invalid checksums.txt');
    checksums.set(name.replace(/^\*/, ''), hash.toLowerCase());
  }
  return checksums;
}

async function downloadVerifiedArchive(
  asset: ReleaseAsset,
  checksums: Map<string, string>,
  execPath: string,
): Promise<string> {
  const expected = checksums.get(asset.name);
  if (!expected) throw new Error(`checksums.txt is missing ${asset.name}`);

  const tempDir = await mkdtemp(join(dirname(execPath), '.rail-upgrade-'));
  const archivePath = join(tempDir, asset.name);
  try {
    const data = await fetchArrayBuffer(asset.browserDownloadUrl);
    await writeFile(archivePath, Buffer.from(data));

    const actual = await sha256File(archivePath);
    if (actual !== expected) throw new Error(`Checksum mismatch for ${asset.name}`);
    return archivePath;
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}

async function replaceExecutableFromArchive(archivePath: string, execPath: string): Promise<void> {
  const tempDir = dirname(archivePath);
  await execFileAsync('tar', ['-xzf', archivePath, '-C', tempDir], { timeout: DOWNLOAD_TIMEOUT_MS });

  const replacementPath = join(tempDir, 'rail');
  const currentStat = await stat(execPath);
  await chmod(replacementPath, currentStat.mode & 0o777);
  await rename(replacementPath, execPath);
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve);
  });
  return hash.digest('hex');
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  return response.arrayBuffer();
}
