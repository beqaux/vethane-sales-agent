/** Exponential backoff + jitter ile retry (IMPL §2.6). Dış çağrılar için. */
export async function retry<T>(
  fn: () => Promise<T>,
  opts: { tries?: number; baseMs?: number } = {},
): Promise<T> {
  const tries = Math.max(1, opts.tries ?? 3);
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) {
        await sleep(2 ** i * baseMs + Math.random() * 200);
      }
    }
  }
  throw lastErr;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
