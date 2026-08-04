import * as BunnyStorageSDK from '@bunny.net/storage-sdk';
import { createReadStream, statSync } from 'node:fs';
import { join, matchesGlob, relative, resolve, sep } from 'node:path';
import { type Globber, create as createGlobber } from '@actions/glob';
import { createHash } from 'node:crypto';

export interface FileEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
}

const exists = (path: string): boolean => {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
};

export const resolveSourcePath = (source: string, workingDirectory: string): string => {
  if (!source) throw new Error('source is required');
  const base = workingDirectory || process.env.GITHUB_WORKSPACE || process.cwd();
  const resolved = resolve(base, source);
  if (!exists(resolved)) {
    throw new Error(`source path does not exist: ${resolved}`);
  }
  return resolved;
};

const ENDPOINT_ALIASES: Record<string, BunnyStorageSDK.regions.StorageRegion> = {
  storage: BunnyStorageSDK.regions.StorageRegion.Falkenstein,
  falkenstein: BunnyStorageSDK.regions.StorageRegion.Falkenstein,
  de: BunnyStorageSDK.regions.StorageRegion.Falkenstein,
  uk: BunnyStorageSDK.regions.StorageRegion.London,
  london: BunnyStorageSDK.regions.StorageRegion.London,
  ny: BunnyStorageSDK.regions.StorageRegion.NewYork,
  newyork: BunnyStorageSDK.regions.StorageRegion.NewYork,
  la: BunnyStorageSDK.regions.StorageRegion.LosAngeles,
  losangeles: BunnyStorageSDK.regions.StorageRegion.LosAngeles,
  sg: BunnyStorageSDK.regions.StorageRegion.Singapore,
  singapore: BunnyStorageSDK.regions.StorageRegion.Singapore,
  se: BunnyStorageSDK.regions.StorageRegion.Stockholm,
  stockholm: BunnyStorageSDK.regions.StorageRegion.Stockholm,
  br: BunnyStorageSDK.regions.StorageRegion.SaoPaulo,
  saopaulo: BunnyStorageSDK.regions.StorageRegion.SaoPaulo,
  jh: BunnyStorageSDK.regions.StorageRegion.Johannesburg,
  johannesburg: BunnyStorageSDK.regions.StorageRegion.Johannesburg,
  syd: BunnyStorageSDK.regions.StorageRegion.Sydney,
  sydney: BunnyStorageSDK.regions.StorageRegion.Sydney,
};

const HOSTNAME_TO_REGION: Record<string, BunnyStorageSDK.regions.StorageRegion> = {
  'storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.Falkenstein,
  'uk.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.London,
  'ny.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.NewYork,
  'la.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.LosAngeles,
  'sg.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.Singapore,
  'se.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.Stockholm,
  'br.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.SaoPaulo,
  'jh.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.Johannesburg,
  'syd.storage.bunnycdn.com': BunnyStorageSDK.regions.StorageRegion.Sydney,
};

export const resolveRegion = (raw: string): BunnyStorageSDK.regions.StorageRegion => {
  const trimmed = raw.trim();

  if (!trimmed) return BunnyStorageSDK.regions.StorageRegion.Falkenstein;

  const alias = ENDPOINT_ALIASES[trimmed.toLowerCase()];

  if (alias !== undefined) return alias;

  const stripped = trimmed
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

  const fromHost = HOSTNAME_TO_REGION[stripped];

  if (fromHost !== undefined) return fromHost;

  throw new Error(
    `storageEndpoint "${raw}" is not a recognized region. Use one of: ${Object.keys(ENDPOINT_ALIASES).join(', ')}, or a full storage hostname.`,
  );
};

const normalizeRelativePath = (path: string): string => path.split(sep).join('/');

export const collectFiles = async (
  sourcePath: string,
  excludes: string[],
): Promise<FileEntry[]> => {
  const stats = statSync(sourcePath);

  if (stats.isFile()) {
    const base = resolve(sourcePath, '..');
    return [
      {
        absolutePath: sourcePath,
        relativePath: normalizeRelativePath(relative(base, sourcePath)),
        size: stats.size,
      },
    ];
  }

  const patterns = [join(sourcePath, '**', '*')].join('\n');

  const globber: Globber = await createGlobber(patterns, {
    followSymbolicLinks: false,
    implicitDescendants: true,
  } as Parameters<typeof createGlobber>[1]);

  const excludeMatchers = excludes.map((pattern) => normalizeRelativePath(pattern));

  const entries: FileEntry[] = [];

  for await (const item of globber.globGenerator()) {
    const abs = typeof item === 'string' ? item : (item as { path: string }).path;

    const itemStats = (item as { stats?: ReturnType<typeof statSync> }).stats ?? statSync(abs);
    if (!itemStats.isFile()) continue;

    const relativeToSource = normalizeRelativePath(relative(sourcePath, abs));

    if (excludeMatchers.some((pattern) => matchesGlob(relativeToSource, pattern))) continue;

    entries.push({
      absolutePath: abs,
      relativePath: relativeToSource,
      size: Number(itemStats.size),
    });
  }

  return entries;
};

export const joinPrefix = (destination: string): string => {
  const cleaned = destination.replace(/^\/+|\/+$/g, '');
  return cleaned ? `${cleaned}/` : '';
};

export const computeSha256Hex = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');

  await new Promise<void>((r, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk as Buffer));
    stream.on('end', () => r());
    stream.on('error', reject);
  });

  return hash.digest('hex').toUpperCase();
};
