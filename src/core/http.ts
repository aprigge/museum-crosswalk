import { readCached, writeCached } from './cache.js';
import type { CachedRaw } from './types.js';

export const USER_AGENT =
  'museum-crosswalk/0.1 (https://github.com/aprigge/museum-crosswalk; contact withheld)';

export interface ClientOptions {
  source: string;
  /** Minimum gap between request starts, in ms. Requests to one source are always sequential. */
  minIntervalMs: number;
  maxRetries?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Refetch even when a cached copy exists. */
  refresh?: boolean;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Polite, cached JSON client for one source: one request at a time, a minimum
 * interval between requests, and exponential backoff that honours Retry-After.
 */
export class SourceClient {
  readonly source: string;
  networkRequests = 0;
  private readonly opts: Required<Omit<ClientOptions, 'headers'>> & { headers: Record<string, string> };
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = -Infinity;

  constructor(opts: ClientOptions) {
    this.source = opts.source;
    this.opts = {
      maxRetries: 4,
      headers: {},
      fetchImpl: globalThis.fetch,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => Date.now(),
      refresh: false,
      ...opts,
    };
  }

  /** GET JSON, serving from data/raw/{source}/{kind}/ when cached. */
  async getJson(kind: string, id: string, url: string): Promise<CachedRaw> {
    if (!this.opts.refresh) {
      const hit = await readCached(this.source, kind, id);
      if (hit) return hit;
    }
    const body = await this.enqueue(() => this.fetchWithRetry(url));
    const raw: CachedRaw = { source: this.source, id, url, fetchedAt: new Date(this.opts.now()).toISOString(), body };
    await writeCached(kind, raw);
    return raw;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async fetchWithRetry(url: string): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastStart + this.opts.minIntervalMs - this.opts.now();
      if (wait > 0) await this.opts.sleep(wait);
      this.lastStart = this.opts.now();
      this.networkRequests++;

      let res: Response;
      try {
        res = await this.opts.fetchImpl(url, {
          headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...this.opts.headers },
        });
      } catch (err) {
        if (attempt >= this.opts.maxRetries) throw err;
        await this.opts.sleep(backoffMs(attempt));
        continue;
      }
      if (res.ok) return res.json();
      if (!RETRYABLE.has(res.status) || attempt >= this.opts.maxRetries) throw new HttpError(res.status, url);
      await this.opts.sleep(retryAfterMs(res.headers.get('retry-after')) ?? backoffMs(attempt));
    }
  }
}

export function backoffMs(attempt: number): number {
  return Math.min(60_000, 1000 * 2 ** attempt);
}

export function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
