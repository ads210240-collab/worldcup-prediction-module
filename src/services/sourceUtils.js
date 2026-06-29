function getElapsedMs(startedAt) {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function withTimeout(options = {}) {
  const { timeoutMs = 6500, ...fetchOptions } = options;
  if (fetchOptions.signal || !timeoutMs) {
    return { fetchOptions, cleanup: () => {} };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    fetchOptions: {
      ...fetchOptions,
      signal: controller.signal,
    },
    cleanup: () => clearTimeout(timeout),
  };
}

function normalizeFetchError(error, url, responseTimeMs = null) {
  if (error?.name === "AbortError") {
    const timeoutError = new Error(`${url} timed out`);
    timeoutError.httpStatus = null;
    timeoutError.responseTimeMs = responseTimeMs;
    return timeoutError;
  }
  if (responseTimeMs != null && error && typeof error === "object") {
    error.responseTimeMs = error.responseTimeMs ?? responseTimeMs;
  }
  return error;
}

export async function fetchJson(url, options = {}) {
  const startedAt = performance.now();
  const { fetchOptions, cleanup } = withTimeout(options);
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const error = new Error(`${url} failed: ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    return response.json();
  } catch (error) {
    throw normalizeFetchError(error, url, getElapsedMs(startedAt));
  } finally {
    cleanup();
  }
}

export async function fetchText(url, options = {}) {
  const startedAt = performance.now();
  const { fetchOptions, cleanup } = withTimeout(options);
  try {
    const response = await fetch(url, fetchOptions);
    if (!response.ok) {
      const error = new Error(`${url} failed: ${response.status}`);
      error.httpStatus = response.status;
      throw error;
    }
    return response.text();
  } catch (error) {
    throw normalizeFetchError(error, url, getElapsedMs(startedAt));
  } finally {
    cleanup();
  }
}

export async function fetchJsonWithMeta(url, options = {}) {
  const startedAt = performance.now();
  const { fetchOptions, cleanup } = withTimeout(options);

  try {
    const response = await fetch(url, fetchOptions);
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
  } catch (error) {
    throw normalizeFetchError(error, url, getElapsedMs(startedAt));
  } finally {
    cleanup();
  }
}

export async function fetchTextWithMeta(url, options = {}) {
  const startedAt = performance.now();
  const { fetchOptions, cleanup } = withTimeout(options);

  try {
    const response = await fetch(url, fetchOptions);
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
  } catch (error) {
    throw normalizeFetchError(error, url, getElapsedMs(startedAt));
  } finally {
    cleanup();
  }
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
