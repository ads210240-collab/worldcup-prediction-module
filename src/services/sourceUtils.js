function getElapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`${url} failed: ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return response.json();
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`${url} failed: ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return response.text();
}

export async function fetchJsonWithMeta(url, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const responseTimeMs = getElapsedMs(startedAt);

  if (!response.ok) {
    const error = new Error(`${url} failed: ${response.status}`);
    error.httpStatus = response.status;
    error.responseTimeMs = responseTimeMs;
    throw error;
  }

  return {
    data: await response.json(),
    meta: {
      httpStatus: response.status,
      responseTimeMs,
      url,
    },
  };
}

export async function fetchTextWithMeta(url, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(url, options);
  const responseTimeMs = getElapsedMs(startedAt);

  if (!response.ok) {
    const error = new Error(`${url} failed: ${response.status}`);
    error.httpStatus = response.status;
    error.responseTimeMs = responseTimeMs;
    throw error;
  }

  return {
    data: await response.text(),
    meta: {
      httpStatus: response.status,
      responseTimeMs,
      url,
    },
  };
}

export function buildSourceStatus({ source, ok, count = 0, cache = null, meta = {}, error = "" }) {
  return {
    source,
    ok,
    count,
    httpStatus: meta.httpStatus || null,
    responseTimeMs: meta.responseTimeMs ?? null,
    cacheHit: cache?.hit ?? false,
    cachedAt: cache?.cachedAt || null,
    expiresAt: cache?.expiresAt || null,
    lastUpdatedAt: new Date().toISOString(),
    error: error || null,
  };
}

export function summarizeStatuses(statuses) {
  return statuses.map((status) => `${status.source}:${status.ok ? "ok" : status.error || "empty"}`).join(" | ");
}

export function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
