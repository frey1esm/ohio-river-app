/**
 * Server-side fetch helper with a bounded timeout. Each external data source
 * is fetched independently and errors are caught at the call site — one
 * source timing out or failing must never throw past its own section.
 */
export async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number,
  init?: RequestInit,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      // Bypass Next's fetch data cache; freshness is managed explicitly by
      // our own per-source TTL cache (lib/cache.ts) instead.
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "User-Agent": "ohio-river-app/1.0 (local dev)",
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}
