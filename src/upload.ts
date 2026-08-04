import PQueue from 'p-queue';
import * as BunnyStorageSDK from '@bunny.net/storage-sdk';
import { computeSha256Hex, type FileEntry } from './files';
import type { Logger } from './logger';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';

export interface UploadContext {
  zone: BunnyStorageSDK.zone.StorageZone;
  destination: string;
  contentType: string;
  skipUnchanged: boolean;
  remoteChecksums: Map<string, string>;
  maxAttempts: number;
  concurrency: number;
  logger: Logger;
}

export interface UploadResult {
  uploaded: number;
  skipped: number;
  failed: number;
  errors: Error[];
}

export const uploadFiles = async (
  files: FileEntry[],
  context: UploadContext,
): Promise<UploadResult> => {
  const queue = new PQueue({ concurrency: context.concurrency });
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const errors: Error[] = [];

  await Promise.all(
    files.map((entry) =>
      queue.add(async () => {
        try {
          const outcome = await uploadFile(entry, context);
          if (outcome === 'skipped') skipped++;
          else if (outcome === 'uploaded') uploaded++;
        } catch (err) {
          failed++;
          errors.push(err as Error);
        }
      }),
    ),
  );

  return { uploaded, skipped, failed, errors };
};

const joinRemotePath = (destination: string, relativePath: string): string => {
  const cleaned = destination.replace(/^\/+|\/+$/g, '');
  if (!cleaned) return relativePath.replace(/^\/+/, '');
  return `${cleaned}/${relativePath}`.replace(/^\/+/, '');
};

const uploadFile = async (
  entry: FileEntry,
  context: UploadContext,
): Promise<'uploaded' | 'skipped'> => {
  const remotePath = joinRemotePath(context.destination, entry.relativePath);

  const checksum = await computeSha256Hex(entry.absolutePath);

  context.logger.debug(`checksum ${checksum} computed for ${entry.relativePath}`);

  if (context.skipUnchanged && context.remoteChecksums.get(entry.relativePath) === checksum) {
    context.logger.info(`Skipping unchanged ${entry.relativePath}`);

    return 'skipped';
  }

  context.logger.info(`Uploading ${entry.relativePath} → /${remotePath}`);

  try {
    const body = createStreamingBody(entry.absolutePath);

    await BunnyStorageSDK.file.upload(context.zone, '/' + remotePath, body as never, {
      sha256Checksum: checksum,
      contentType: context.contentType,
    });

    context.logger.info(`Uploaded ${entry.relativePath}`);

    return 'uploaded';
  } catch (err) {
    throw new Error(`Failed to upload ${entry.relativePath}: ${(err as Error).message}`, {
      cause: err,
    });
  }
};

const createStreamingBody = (absolutePath: string): ReadableStream<Uint8Array> => {
  const fileStream = createReadStream(absolutePath);

  return Readable.toWeb(fileStream) as unknown as ReadableStream<Uint8Array>;
};
