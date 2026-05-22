import { describe, expect, it } from 'bun:test';
import { mkdtemp, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseChecksums, selectAsset, sha256File } from './upgrade';
import type { GitHubRelease } from './update';

describe('upgrade asset selection', () => {
  it('selects the matching release asset', () => {
    const release = makeRelease(['rail_Darwin_arm64.tar.gz']);
    expect(selectAsset(release, 'rail_Darwin_arm64.tar.gz').name).toBe('rail_Darwin_arm64.tar.gz');
  });

  it('throws when the release asset is missing', () => {
    expect(() => selectAsset(makeRelease([]), 'rail_Linux_arm64.tar.gz')).toThrow('missing');
  });
});

describe('checksum parsing', () => {
  const hash = 'a'.repeat(64);

  it('parses standard checksum lines', () => {
    expect(parseChecksums(`${hash}  rail_Darwin_arm64.tar.gz\n`).get('rail_Darwin_arm64.tar.gz')).toBe(hash);
  });

  it('ignores blank lines', () => {
    expect(parseChecksums(`\n${hash}  rail_Linux_arm64.tar.gz\n\n`).size).toBe(1);
  });

  it('rejects malformed checksum lines', () => {
    expect(() => parseChecksums('not-a-hash rail.tar.gz')).toThrow('Invalid checksums');
  });
});

describe('sha256File', () => {
  it('hashes file content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rail-upgrade-test-'));
    const path = join(dir, 'payload');
    await writeFile(path, 'hello');
    expect(await sha256File(path)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

function makeRelease(names: string[]): GitHubRelease {
  return {
    tagName: 'v1.2.3',
    version: '1.2.3',
    htmlUrl: 'https://github.com/kgonyon/rail/releases/tag/v1.2.3',
    assets: names.map((name) => ({ name, browserDownloadUrl: `https://example.com/${name}` })),
  };
}
