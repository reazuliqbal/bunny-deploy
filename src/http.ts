import type { Logger } from './logger';

export class HttpError extends Error {
  status: number;
  body: string;
  retriable: boolean;
  constructor(status: number, body: string, message: string, retriable: boolean) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.retriable = retriable;
  }
}

export interface RequestOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: BodyInit | ReadableStream<Uint8Array> | null;
  signal?: AbortSignal;
}

export interface RetryDeps {
  maxAttempts: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  logger?: Logger;
}

const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const parseRetryAfter = (value: string | null): number | null => {
  if (!value) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
};

const isRetriableStatus = (status: number): boolean =>
  status === 408 ||
  status === 429 ||
  status === 500 ||
  status === 502 ||
  status === 503 ||
  status === 504;

const trimBody = (body: string, max = 500): string =>
  body.length <= max ? body : `${body.slice(0, max)}...`;

export const request = async (options: RequestOptions, deps: RetryDeps): Promise<Response> => {
  const baseDelay = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
    options.signal?.addEventListener('abort', () => controller.abort());

    try {
      const requestInit: RequestInit = {
        method: options.method,
        ...(options.headers !== undefined && { headers: options.headers }),
        body: options.body ?? null,
        signal: controller.signal,
      };
      const response = await fetch(options.url, requestInit);

      if (response.ok) {
        clearTimeout(timeoutHandle);
        return response;
      }

      const retriable = isRetriableStatus(response.status);
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

      if (retriable && attempt < deps.maxAttempts) {
        const wait = retryAfter ?? baseDelay * Math.pow(2, attempt - 1);
        deps.logger?.warning(
          `${options.method} ${options.url} failed with status ${response.status} (attempt ${attempt}/${deps.maxAttempts}). Retrying in ${Math.round(wait)}ms.`,
        );
        lastError = new HttpError(
          response.status,
          '',
          `Request failed with status ${response.status}`,
          true,
        );
        clearTimeout(timeoutHandle);
        await sleep(wait);
        continue;
      }

      const body = await response.text();
      clearTimeout(timeoutHandle);
      throw new HttpError(
        response.status,
        body,
        buildHttpErrorMessage(response.status, body, options.url),
        retriable,
      );
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (err instanceof HttpError) {
        if (err.retriable && attempt < deps.maxAttempts) {
          await sleep(baseDelay * Math.pow(2, attempt - 1));
          lastError = err;
          continue;
        }
        throw err;
      }
      const isAbort = err instanceof Error && err.name === 'AbortError';
      const message = isAbort
        ? `Request to ${options.url} timed out after ${timeoutMs}ms`
        : `Network error contacting ${options.url}: ${(err as Error).message ?? String(err)}`;
      deps.logger?.warning(
        `${options.method} ${options.url} failed on attempt ${attempt}/${deps.maxAttempts}${
          isAbort ? ' (timeout)' : ''
        }. Retrying...`,
      );
      lastError = new Error(message);
      if (attempt < deps.maxAttempts) {
        await sleep(baseDelay * Math.pow(2, attempt - 1));
        continue;
      }
      throw lastError;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Request failed without a captured error');
};

const buildHttpErrorMessage = (status: number, body: string, url: string): string => {
  const parsed = parseErrorBody(body);
  if (parsed) {
    return `${parsed.ErrorKey || 'error'}: ${parsed.Message || parsed.message || `HTTP ${status}`} (${url})`;
  }
  return `${url} → HTTP ${status}: ${trimBody(body)}`;
};

const parseErrorBody = (body: string): Record<string, string> | null => {
  if (!body) return null;
  try {
    const json = JSON.parse(body);
    if (json && typeof json === 'object') {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(json)) {
        if (typeof value === 'string') result[key] = value;
      }
      return result;
    }
  } catch {
    return null;
  }
  return null;
};

export const createRetryingFetch = (deps: RetryDeps): typeof fetch => {
  const baseDelay = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      if (init?.signal) {
        if (init.signal.aborted) controller.abort();
        else init.signal.addEventListener('abort', () => controller.abort());
      }

      try {
        const requestInit: RequestInit = {
          ...(init?.method !== undefined && { method: init.method }),
          ...(init?.headers !== undefined && { headers: init.headers }),
          body: init?.body ?? null,
          signal: controller.signal,
        };
        const response = await fetch(input, requestInit);

        if (response.ok) {
          clearTimeout(timeoutHandle);
          return response;
        }

        const retriable = isRetriableStatus(response.status);
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

        if (retriable && attempt < deps.maxAttempts) {
          const wait = retryAfter ?? baseDelay * Math.pow(2, attempt - 1);
          deps.logger?.warning(
            `${method} ${url} failed with status ${response.status} (attempt ${attempt}/${deps.maxAttempts}). Retrying in ${Math.round(wait)}ms.`,
          );
          lastError = new HttpError(
            response.status,
            '',
            `Request failed with status ${response.status}`,
            true,
          );
          clearTimeout(timeoutHandle);
          await sleep(wait);
          continue;
        }

        const responseBody = await response.text();
        clearTimeout(timeoutHandle);
        throw new HttpError(
          response.status,
          responseBody,
          buildHttpErrorMessage(response.status, responseBody, url),
          retriable,
        );
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (err instanceof HttpError) {
          if (err.retriable && attempt < deps.maxAttempts) {
            await sleep(baseDelay * Math.pow(2, attempt - 1));
            lastError = err;
            continue;
          }
          throw err;
        }
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const message = isAbort
          ? `Request to ${url} timed out after ${timeoutMs}ms`
          : `Network error contacting ${url}: ${(err as Error).message ?? String(err)}`;
        deps.logger?.warning(
          `${method} ${url} failed on attempt ${attempt}/${deps.maxAttempts}${
            isAbort ? ' (timeout)' : ''
          }. Retrying...`,
        );
        lastError = new Error(message);
        if (attempt < deps.maxAttempts) {
          await sleep(baseDelay * Math.pow(2, attempt - 1));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Request failed without a captured error');
  };
};

export const installFetchWrapper = (deps: RetryDeps): (() => void) => {
  const original = globalThis.fetch;
  globalThis.fetch = createRetryingFetch(deps);

  return () => {
    globalThis.fetch = original;
  };
};
