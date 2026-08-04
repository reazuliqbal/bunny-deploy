import { getInput, getBooleanInput, setOutput, setFailed, setSecret } from '@actions/core';
import * as BunnyStorageSDK from '@bunny.net/storage-sdk';
import { collectFiles, resolveRegion, resolveSourcePath } from './files';
import { createLogger, type LogLevel } from './logger';
import { isAbsolute, resolve } from 'node:path';
import { installFetchWrapper } from './http';
import { cleanDestination } from './clean';
import { deleteOrphans, listRemoteRecursive } from './sync';
import { uploadFiles } from './upload';
import { purgePullZone } from './purge';

const parsePositiveInt = (input: string, name: string, allowZero = false) => {
  const value = Number(input);

  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${name} must be an integer (got "${input}")`);
  }

  if (allowZero ? value < 0 : value <= 0) {
    throw new Error(`${name} must be ${allowZero ? '>= 0' : '> 0'} (got ${value})`);
  }

  return value;
};

const parseNonNegativeInt = (input: string, name: string) => parsePositiveInt(input, name, true);

const safeDestination = (raw: string): string => {
  if (!raw) return '';

  if (raw.startsWith('/') || raw.endsWith('/')) {
    throw new Error(`destination must not start or end with "/": "${raw}"`);
  }

  if (raw.includes('..')) {
    throw new Error(`destination must not contain "..": "${raw}"`);
  }

  return raw;
};

const storageEndpointHostname = (region: BunnyStorageSDK.regions.StorageRegion): string => {
  return BunnyStorageSDK.regions.addr(region).host;
};

const main = async () => {
  const storagePassword = getInput('storagePassword');
  const accessKey = getInput('accessKey');

  if (storagePassword) setSecret(storagePassword);
  if (accessKey) setSecret(accessKey);

  const deployMode = getInput('deployMode') || 'sync';

  if (deployMode !== 'sync' && deployMode !== 'replace') {
    throw new Error(`deployMode must be 'sync' or 'replace', got '${deployMode}'`);
  }

  const purge = getBooleanInput('purge');

  const purgeDelay = parseNonNegativeInt(getInput('purgeDelay') || '0', 'purgeDelay');

  const cdnTag = getInput('cdnTag');

  const clean = getBooleanInput('clean');

  const maxAttempts = parsePositiveInt(getInput('maxAttempts') || '5', 'maxAttempts');

  const concurrency = parsePositiveInt(getInput('concurrency') || '25', 'concurrency');

  const destination = safeDestination(getInput('destination'));

  const storageEndpoint = getInput('storageEndpoint') || 'storage.bunnycdn.com';

  const region = resolveRegion(storageEndpoint);

  const skipUnchanged = getBooleanInput('skipUnchanged');

  const logLevel = (getInput('logLevel') || 'info') as LogLevel;

  const failOnError = getBooleanInput('failOnError');

  const excludes = getInput('exclude')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const source = getInput('source');

  const workingDirectoryRaw = getInput('workingDirectory');

  const workingDirectory = workingDirectoryRaw
    ? isAbsolute(workingDirectoryRaw)
      ? workingDirectoryRaw
      : resolve(process.env.GITHUB_WORKSPACE || process.cwd(), workingDirectoryRaw)
    : process.env.GITHUB_WORKSPACE || process.cwd();

  const logger = createLogger(logLevel);

  const storageZoneName = getInput('storageZoneName', { required: true });

  const pullZoneId = getInput('pullZoneId');

  if (purge && !pullZoneId) {
    throw new Error('pullZoneId is required when purge is true');
  }

  if (purge && !accessKey) {
    throw new Error('accessKey is required when purge is true');
  }

  installFetchWrapper({ maxAttempts, logger });

  const zone = BunnyStorageSDK.zone.connect_with_accesskey(
    region,
    storageZoneName,
    storagePassword,
  );

  const hostname = storageEndpointHostname(region);

  const resolvedSource = resolveSourcePath(source, workingDirectory);

  logger.info(`Source: ${resolvedSource}`);
  logger.info(`Destination: ${destination || '(root)'}`);
  logger.info(`Storage zone: ${storageZoneName} via ${hostname}`);
  logger.info(`Deploy mode: ${deployMode}, purge: ${purge}, clean: ${clean}`);

  if (clean) {
    await cleanDestination({
      zone,
      destination,
      storageEndpointHostname: hostname,
      storageZoneName,
      storagePassword,
      maxAttempts,
      logger,
    });
  }

  const files = await collectFiles(resolvedSource, excludes);

  logger.info(`Discovered ${files.length} files to upload`);

  const localRelativePaths = new Set(files.map((file) => file.relativePath));

  let remoteChecksums = new Map<string, string>();

  if (deployMode === 'sync' && skipUnchanged) {
    remoteChecksums = await listRemoteRecursive(zone, destination, logger);

    logger.info(`Remote listing: ${remoteChecksums.size} existing entries`);
  }

  const uploadResult = await uploadFiles(files, {
    zone,
    destination,
    contentType: getInput('contentType'),
    skipUnchanged,
    remoteChecksums,
    maxAttempts,
    concurrency,
    logger,
  });

  logger.info(
    `Uploaded: ${uploadResult.uploaded}, skipped: ${uploadResult.skipped}, failed: ${uploadResult.failed}`,
  );

  let deleted = 0;

  if (deployMode === 'sync' && !clean) {
    deleted = await deleteOrphans({
      zone,
      storageEndpointHostname: hostname,
      storageZoneName,
      storagePassword,
      destination,
      localRelativePaths,
      maxAttempts,
      logger,
    });

    logger.info(`Deleted orphan files: ${deleted}`);
  }

  let purged = false;

  if (purge) {
    await purgePullZone({
      pullZoneId,
      accessKey,
      cdnTag,
      delaySeconds: purgeDelay,
      maxAttempts,
      logger,
    });

    purged = true;
  }

  setOutput('uploaded', uploadResult.uploaded);
  setOutput('skipped', uploadResult.skipped);
  setOutput('deleted', deleted);
  setOutput('purged', purged);

  if (uploadResult.failed > 0) {
    const summary = uploadResult.errors
      .slice(0, 5)
      .map((err: Error) => err.message)
      .join('\n');

    if (failOnError) {
      setFailed(`${uploadResult.failed} file(s) failed to upload.\n${summary}`);
    } else {
      logger.warning(`${uploadResult.failed} file(s) failed to upload:\n${summary}`);
    }
  }
};

main().catch((err) => {
  setFailed(err instanceof Error ? err : new Error(String(err)));
});
