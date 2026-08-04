import * as BunnyStorageSDK from '@bunny.net/storage-sdk';
import { HttpError, request } from './http';
import type { Logger } from './logger';

export interface RemoveOptions {
  zone: BunnyStorageSDK.zone.StorageZone;
  destination: string;
  storageEndpointHostname: string;
  storageZoneName: string;
  storagePassword: string;
  maxAttempts: number;
  logger: Logger;
}

const cleanRoot = async (options: RemoveOptions): Promise<void> => {
  const url = `https://${options.storageEndpointHostname}/${options.storageZoneName}/`;

  options.logger.info(`Removing storage zone root ${url} (allowRootDelete=true)`);

  try {
    await request(
      {
        method: 'DELETE',
        url,
        headers: {
          AccessKey: options.storagePassword,
          allowRootDelete: 'true',
        },
      },
      { maxAttempts: options.maxAttempts, logger: options.logger },
    );

    options.logger.info(`Removed ${url}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      options.logger.warning(`Destination not found: ${url}`);
      return;
    }

    const message = err instanceof Error ? err.message : String(err);

    throw new Error(`Failed to remove ${url}: ${message}`, { cause: err });
  }
};

export const cleanDestination = async (options: RemoveOptions): Promise<void> => {
  const cleaned = options.destination.replace(/^\/+|\/+$/g, '');

  if (cleaned === '') {
    await cleanRoot(options);
    return;
  }

  const url = `https://${options.storageEndpointHostname}/${options.storageZoneName}/${cleaned}/`;

  options.logger.info(`Removing ${url}`);

  try {
    await request(
      {
        method: 'DELETE',
        url,
        headers: { AccessKey: options.storagePassword },
      },
      { maxAttempts: options.maxAttempts, logger: options.logger },
    );

    options.logger.info(`Removed ${url}`);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      options.logger.warning(`Destination not found: ${url}`);
      return;
    }

    const message = err instanceof Error ? err.message : String(err);

    throw new Error(`Failed to remove ${url}: ${message}`, { cause: err });
  }
};

export const removeRemoteFile = async (args: {
  zone: BunnyStorageSDK.zone.StorageZone;
  storageEndpointHostname: string;
  storageZoneName: string;
  storagePassword: string;
  remotePath: string;
  maxAttempts: number;
  logger: Logger;
}): Promise<void> => {
  const cleaned = args.remotePath.replace(/^\/+/, '');
  const url = `https://${args.storageEndpointHostname}/${args.storageZoneName}/${cleaned}`;

  try {
    await request(
      {
        method: 'DELETE',
        url,
        headers: { AccessKey: args.storagePassword },
      },
      { maxAttempts: args.maxAttempts, logger: args.logger },
    );
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      args.logger.warning(`Remote file not found: ${cleaned}`);
      return;
    }

    const message = err instanceof Error ? err.message : String(err);

    throw new Error(`Failed to delete ${cleaned}: ${message}`, { cause: err });
  }
};
