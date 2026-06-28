const memoryCache = new Map();

export const cacheTtl = {
  fixtures: 30 * 60 * 1000,
  news: 30 * 60 * 1000,
  odds: 15 * 60 * 1000,
  teamStats: 6 * 60 * 60 * 1000,
};

export function getCached(key) {
  const entry = memoryCache.get(key);
  if (!entry || Date.now() >= entry.expiresAtMs) {
    memoryCache.delete(key);
    return null;
  }

  return {
    ...entry.value,
    cache: {
      key,
      hit: true,
      cachedAt: entry.cachedAt,
      expiresAt: new Date(entry.expiresAtMs).toISOString(),
      ttlMs: entry.ttlMs,
    },
  };
}

export function setCached(key, ttlMs, value) {
  const cachedAt = new Date().toISOString();
  const expiresAtMs = Date.now() + ttlMs;
  memoryCache.set(key, { value, cachedAt, expiresAtMs, ttlMs });

  return {
    ...value,
    cache: {
      key,
      hit: false,
      cachedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
      ttlMs,
    },
  };
}

export async function withCache(key, ttlMs, fetcher) {
  const cached = getCached(key);
  if (cached) return cached;
  const value = await fetcher();
  return setCached(key, ttlMs, value);
}
