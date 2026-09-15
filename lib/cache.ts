/**
 * Minimal in-memory TTL cache, module-scoped so it persists across requests
 * within one running server process (fine for `next dev`/`next start` as a
 * single long-lived Node process; not a distributed cache). Each data
 * source gets its own TTL — deliberately not a single shared cache/TTL,
 * mirroring the source-specific cadence differences documented in
 * docs/river-reverse-engineering.md §2 and §13.
 */
const store = new Map<string, { value: unknown; expiresAt: number }>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) {
    return hit.value as T;
  }
  const value = await fn();
  store.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

/** Exposed for tests only. */
export function __clearCacheForTests(): void {
  store.clear();
}
