import { request, HttpError } from './http';
import type { Logger } from './logger';

export interface PurgeOptions {
  pullZoneId: string;
  accessKey: string;
  cdnTag: string;
  delaySeconds: number;
  maxAttempts: number;
  logger: Logger;
}

export const purgePullZone = async (options: PurgeOptions): Promise<void> => {
  if (options.delaySeconds > 0) {
    options.logger.info(`Waiting ${options.delaySeconds}s before purge`);
    await new Promise((resolve) => setTimeout(resolve, options.delaySeconds * 1000));
  }

  const url = `https://api.bunny.net/pullzone/${options.pullZoneId}/purgeCache`;
  const headers: Record<string, string> = { AccessKey: options.accessKey };
  const body = options.cdnTag ? JSON.stringify({ CacheTag: options.cdnTag }) : null;

  options.logger.info(
    `Purging pull zone ${options.pullZoneId}${options.cdnTag ? ` (tag=${options.cdnTag})` : ''}`,
  );

  try {
    const response = await request(
      {
        method: 'POST',
        url,
        headers,
        body: body as unknown as BodyInit,
      },
      { maxAttempts: options.maxAttempts, logger: options.logger },
    );

    if (response.status !== 204) {
      throw new Error(`Unexpected purge status: ${response.status}`);
    }

    options.logger.info('Pull zone purged successfully');
  } catch (err) {
    if (err instanceof HttpError) {
      throw new Error(`Purge failed: ${err.message}`, { cause: err });
    }

    const message = err instanceof Error ? err.message : String(err);

    throw new Error(`Purge failed: ${message}`, { cause: err });
  }
};
