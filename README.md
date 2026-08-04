# Bunny Deploy

A modern GitHub Action to deploy files to a [bunny.net](https://bunny.net) Edge Storage zone with built-in sync, recursive remove, and pull-zone purge.

> Built on top of the official [`@bunny.net/storage-sdk`](https://www.npmjs.com/package/@bunny.net/storage-sdk) and bundled with `tsdown`.

## Features

- **Sync mode by default** – lists the remote destination, uploads only new or changed files, and deletes orphans.
- **Server-side skip-unchanged** – compares local SHA256 against the `Checksum` returned by `file.list` (no client manifest needed).
- **CacheTag purge** – selectively purge a pull zone by tag instead of invalidating the entire cache.
- **Retry + 429 + timeout** – all SDK calls and direct calls go through a wrapped `globalThis.fetch` that retries on 408/429/5xx and honors `Retry-After`.
- **Configurable concurrency** – bounded via `p-queue`.
- **Nine storage regions** – Falkenstein, London, NewYork, LosAngeles, Singapore, Stockholm, SaoPaulo, Johannesburg, Sydney.
- **Masked secrets** – `storagePassword` and `accessKey` are masked via `setSecret`.

## Inputs

| Input              | Required     | Default                | Description                                                                                                                                        |
| ------------------ | ------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`           | yes          | —                      | Source directory or file. Resolved relative to `workingDirectory` or `GITHUB_WORKSPACE`.                                                           |
| `destination`      | no           | `""`                   | Destination directory inside the storage zone. No leading/trailing slashes.                                                                        |
| `storageZoneName`  | yes          | —                      | bunny.net storage zone name.                                                                                                                       |
| `storagePassword`  | yes          | —                      | Storage zone password (used as the `AccessKey` header).                                                                                            |
| `storageEndpoint`  | no           | `storage.bunnycdn.com` | Region alias (`storage`, `de`, `uk`, `ny`, `la`, `sg`, `se`, `br`, `jh`, `syd`) or full hostname.                                                  |
| `accessKey`        | when purging | —                      | bunny.net account API key.                                                                                                                         |
| `pullZoneId`       | when purging | —                      | Pull zone ID.                                                                                                                                      |
| `clean`            | no           | `false`                | Recursively delete the destination before upload.                                                                                                  |
| `deployMode`       | no           | `sync`                 | `sync` (delete remote orphans) or `replace` (only upload).                                                                                         |
| `purge`            | no           | `false`                | Purge the pull zone after upload.                                                                                                                  |
| `purgeDelay`       | no           | `0`                    | Seconds to wait before purging.                                                                                                                    |
| `cdnTag`           | no           | `""`                   | Selective purge tag (`{ "CacheTag": "..." }`).                                                                                                     |
| `maxAttempts`      | no           | `5`                    | Attempts per network operation.                                                                                                                    |
| `concurrency`      | no           | `25`                   | Parallel uploads.                                                                                                                                  |
| `exclude`          | no           | `""`                   | Newline-separated glob patterns (uses `@actions/glob`).                                                                                            |
| `contentType`      | no           | `""`                   | Override the `Content-Type` header for uploaded files. When empty, the SDK sends `application/octet-stream` and the CDN auto-detects by extension. |
| `skipUnchanged`    | no           | `true`                 | Skip files whose SHA256 matches the remote `Checksum` from `file.list`.                                                                            |
| `logLevel`         | no           | `info`                 | `info` or `debug`.                                                                                                                                 |
| `failOnError`      | no           | `true`                 | Fail when uploads error. When `false`, errors are logged and the action continues.                                                                 |
| `workingDirectory` | no           | `GITHUB_WORKSPACE`     | Resolve relative `source` paths from this directory.                                                                                               |

> **Note:** custom `Cache-Control` and arbitrary extra headers are not supported per upload. Use bunny.net Edge Rules for that.

## Outputs

| Output     | Description                                 |
| ---------- | ------------------------------------------- |
| `uploaded` | Number of files uploaded.                   |
| `skipped`  | Number of files skipped (unchanged).        |
| `deleted`  | Number of remote files removed during sync. |
| `purged`   | `true` when the pull zone was purged.       |

## Example

```yaml
- name: Deploy to Bunny.net
  uses: reazuliqbal/bunny-deploy@v0.1.0
  with:
    source: dist
    destination: www
    storageZoneName: ${{ secrets.STORAGE_NAME }}
    storagePassword: ${{ secrets.STORAGE_PASSWORD }}
    accessKey: ${{ secrets.STORAGE_ACCESS_KEY }}
    pullZoneId: ${{ secrets.PULL_ZONE_ID }}
    purge: 'true'
    purgeDelay: 5
    cdnTag: release-${{ github.ref_name }}
    deployMode: sync
```

## Deploy flow

1. Install `globalThis.fetch` wrapper (retry + 429 + timeout).
2. `collectFiles(source, excludes)` via `@actions/glob`.
3. If `clean: true` → `DELETE /{zone}/{destination}/` (or `/{zone}/` with `allowRootDelete: true` for the whole zone).
4. If `deployMode === "sync"`: `file.list` recursively → build a `path → Checksum` map → upload only mismatches/new files → `DELETE` orphans.
5. If `deployMode === "replace"`: upload all files.
6. If `purge` → `POST /pullzone/{id}/purgeCache`.
7. Set outputs.

## Development

```bash
npm install
npm run lint
npm run build
```

## License

MIT
