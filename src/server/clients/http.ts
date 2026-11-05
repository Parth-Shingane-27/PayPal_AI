/**
 * Retrying fetch for idempotent calls (Frankfurter GETs, Voyage embeddings,
 * which have no side effects). Retries network errors, 429 and 5xx.
 */
export type FetchFn = typeof fetch;

export type RetryOptions = {
  fetch?: FetchFn;
  attempts?: number;
  sleep?: (ms: number) => Promise<void>;
};

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(url: string, init: RequestInit, opts: RetryOptions = {}): Promise<Response> {
  const fetchFn = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetchFn(url, init);
      if (!RETRYABLE.has(res.status) || attempt === attempts) return res;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === attempts) throw err;
    }
    await sleep(300 * 2 ** (attempt - 1));
  }
  throw lastError;
}
