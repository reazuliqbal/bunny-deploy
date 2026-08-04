import * as BunnyStorageSDK from '@bunny.net/storage-sdk';
import type { Logger } from './logger';
import { joinPrefix } from './files';
import { removeRemoteFile } from './clean';

const relativize = (
  cleanedDestination: string,
  current: string,
  entry: BunnyStorageSDK.file.StorageFile,
): string | null => {
  const basePath = current ? `${current}/${entry.objectName}` : entry.objectName;

  if (!cleanedDestination) {
    return basePath;
  }

  const prefix = `${cleanedDestination}/`;

  if (basePath.startsWith(prefix)) {
    return basePath.slice(prefix.length);
  }

  return basePath;
};

export const listRemoteRecursive = async (
  zone: BunnyStorageSDK.zone.StorageZone,
  destination: string,
  logger: Logger,
): Promise<Map<string, string>> => {
  const cleanedDestination = destination.replace(/^\/+|\/+$/g, '');

  const result = new Map<string, string>();
  const queue: string[] = [cleanedDestination];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    const listPath = current ? `/${current}/` : '/';
    let entries: BunnyStorageSDK.file.StorageFile[];

    try {
      entries = await BunnyStorageSDK.file.list(zone, listPath);
    } catch (err) {
      if (err instanceof Error && /File not found/i.test(err.message)) {
        logger.warning(`Remote directory not found: ${current || '/'}`);

        continue;
      }

      throw new Error(`Failed to list ${listPath}: ${(err as Error).message}`, { cause: err });
    }

    for (const entry of entries) {
      if (entry.isDirectory) {
        const childPath = current ? `${current}/${entry.objectName}` : entry.objectName;
        queue.push(childPath);

        continue;
      }

      const relWithinDest = relativize(cleanedDestination, current, entry);

      if (relWithinDest === null) {
        continue;
      }

      result.set(relWithinDest, entry.checksum ?? '');
    }
  }

  return result;
};

export interface SyncOptions {
  zone: BunnyStorageSDK.zone.StorageZone;
  storageEndpointHostname: string;
  storageZoneName: string;
  storagePassword: string;
  destination: string;
  localRelativePaths: Set<string>;
  maxAttempts: number;
  logger: Logger;
}

export interface SyncResult {
  remoteMap: Map<string, string>;
  deleted: number;
}

export const deleteOrphans = async (options: SyncOptions): Promise<number> => {
  const cleanedDestination = options.destination.replace(/^\/+|\/+$/g, '');
  const remoteMap = await listRemoteRecursive(options.zone, options.destination, options.logger);

  const removedPrefix = joinPrefix(cleanedDestination);

  const targets = Array.from(remoteMap.keys())
    .filter((rel) => !options.localRelativePaths.has(rel))
    .map((rel) => `${removedPrefix}${rel}`);

  let deleted = 0;

  for (const remotePath of targets) {
    try {
      await removeRemoteFile({
        zone: options.zone,
        storageEndpointHostname: options.storageEndpointHostname,
        storageZoneName: options.storageZoneName,
        storagePassword: options.storagePassword,
        remotePath,
        maxAttempts: options.maxAttempts,
        logger: options.logger,
      });

      deleted++;

      options.logger.info(`Deleted orphan ${remotePath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      options.logger.warning(`Failed to delete orphan ${remotePath}: ${message}`);
    }
  }

  return deleted;
};
