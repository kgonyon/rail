import consola from 'consola';
import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { promisify } from 'util';
import { detectInstallMethod } from './install';
import { getUpdateCheckCachePath } from './paths';
import {
  CHECKSUMS_ASSET,
  GITHUB_RELEASES_URL,
  compareVersions,
  getReleaseAssetName,
  isStableTag,
  normalizeVersion,
} from './release';

const execFileAsync = promisify(execFile);
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 750;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export interface ReleaseAsset {
  name: string;
  browserDownloadUrl: string;
}

export interface GitHubRelease {
  tagName: string;
  version: string;
  htmlUrl: string;
  assets: ReleaseAsset[];
}

export interface UpdateCache {
  checkedAt: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

export async function warnAboutUpdates(options: {
  currentVersion: string;
  argv: string[];
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): Promise<void> {
  const env = options.env ?? process.env;
  if (shouldSkipUpdateCheck(options.argv, env)) return;

  try {
    await warnAboutUpdatesUnchecked({ ...options, env, now: options.now ?? new Date() });
  } catch {
    // Update checks are intentionally best-effort and must never block CLI usage.
  }
}

export function shouldSkipUpdateCheck(argv: string[], env: NodeJS.ProcessEnv): boolean {
  const first = argv[0];
  if (env.CI || env.RAIL_UPDATE_CHECK === 'never') return true;
  return first === undefined || ['--help', '-h', 'help', '--version', '-v', 'version', 'upgrade'].includes(first);
}

export function isCacheStale(cache: UpdateCache | null, now: Date): boolean {
  if (!cache) return true;
  const checkedAt = Date.parse(cache.checkedAt);
  if (Number.isNaN(checkedAt)) return true;
  return now.getTime() - checkedAt >= CHECK_INTERVAL_MS;
}

export function formatUpdateWarning(cache: UpdateCache): string {
  return `rail ${cache.latestVersion} is available. Run: rail upgrade`;
}

export function isUpdateAvailable(cache: UpdateCache, currentVersion: string): boolean {
  if (!cache.latestVersion) return false;
  return compareVersions(cache.latestVersion, currentVersion) > 0;
}

export async function fetchLatestRelease(
  timeoutMs = CHECK_TIMEOUT_MS,
  token = process.env.GITHUB_TOKEN,
): Promise<GitHubRelease> {
  const json = await fetchJson(GITHUB_RELEASES_URL, timeoutMs, token);
  return parseGitHubRelease(json);
}

export function parseGitHubRelease(input: unknown): GitHubRelease {
  if (!isRecord(input)) throw new Error('Invalid GitHub release response');
  const tagName = readString(input, 'tag_name');
  if (!isStableTag(tagName)) throw new Error(`Latest release is not stable: ${tagName}`);

  const assets = readArray(input, 'assets').map(parseReleaseAsset);
  return {
    tagName,
    version: normalizeVersion(tagName),
    htmlUrl: readString(input, 'html_url'),
    assets,
  };
}

async function warnAboutUpdatesUnchecked(options: {
  currentVersion: string;
  argv: string[];
  env: NodeJS.ProcessEnv;
  now: Date;
}): Promise<void> {
  const method = await detectInstallMethod();
  if (method === 'source') return;

  const path = getUpdateCheckCachePath();
  const cache = await readCache(path);
  const next = isCacheStale(cache, options.now)
    ? await refreshCache(options.currentVersion, method, options.env, options.now, cache)
    : cache;
  if (next && isUpdateAvailable(next, options.currentVersion)) consola.warn(formatUpdateWarning(next));
}

async function refreshCache(
  currentVersion: string,
  method: 'homebrew' | 'manual',
  env: NodeJS.ProcessEnv,
  now: Date,
  fallback: UpdateCache | null,
): Promise<UpdateCache | null> {
  try {
    const latestVersion = method === 'homebrew' ? await getBrewVersion() : await getManualVersion(env);
    const cache = makeCache(currentVersion, latestVersion, now);
    await writeCache(getUpdateCheckCachePath(), cache);
    return cache;
  } catch {
    return fallback;
  }
}

async function getManualVersion(env: NodeJS.ProcessEnv): Promise<string> {
  const release = await fetchLatestRelease(CHECK_TIMEOUT_MS, env.GITHUB_TOKEN);
  const assetName = getReleaseAssetName();
  const assetNames = new Set(release.assets.map((asset) => asset.name));
  if (!assetNames.has(assetName) || !assetNames.has(CHECKSUMS_ASSET)) {
    throw new Error('Latest release is missing required assets');
  }
  return release.version;
}

async function getBrewVersion(): Promise<string> {
  const { stdout } = await execFileAsync('brew', ['info', 'kgonyon/tap/rail', '--json=v2'], {
    timeout: CHECK_TIMEOUT_MS,
    maxBuffer: MAX_RESPONSE_BYTES,
  });
  return parseBrewInfo(stdout.toString());
}

export function parseBrewInfo(output: string): string {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed)) throw new Error('Invalid brew info response');
  const formulae = readArray(parsed, 'formulae');
  const formula = formulae[0];
  if (!isRecord(formula)) throw new Error('No rail formula found');
  const versions = formula.versions;
  if (!isRecord(versions)) throw new Error('Missing brew version');
  return readString(versions, 'stable');
}

function makeCache(currentVersion: string, latestVersion: string, now: Date): UpdateCache {
  return {
    checkedAt: now.toISOString(),
    latestVersion,
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: `https://github.com/kgonyon/rail/releases/tag/v${latestVersion}`,
  };
}

async function readCache(path: string): Promise<UpdateCache | null> {
  try {
    return parseCache(JSON.parse(await readFile(path, 'utf-8')));
  } catch {
    return null;
  }
}

async function writeCache(path: string, cache: UpdateCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`);
}

function parseCache(input: unknown): UpdateCache | null {
  if (!isRecord(input)) return null;
  const checkedAt = input.checkedAt;
  if (typeof checkedAt !== 'string') return null;
  return {
    checkedAt,
    latestVersion: typeof input.latestVersion === 'string' ? input.latestVersion : null,
    updateAvailable: input.updateAvailable === true,
    releaseUrl: typeof input.releaseUrl === 'string' ? input.releaseUrl : null,
  };
}

export async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.text();
}

async function fetchJson(url: string, timeoutMs: number, token?: string): Promise<unknown> {
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function parseReleaseAsset(input: unknown): ReleaseAsset {
  if (!isRecord(input)) throw new Error('Invalid release asset');
  return { name: readString(input, 'name'), browserDownloadUrl: readString(input, 'browser_download_url') };
}

function readString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Missing ${key}`);
  return value;
}

function readArray(input: Record<string, unknown>, key: string): unknown[] {
  const value = input[key];
  if (!Array.isArray(value)) throw new Error(`Missing ${key}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
