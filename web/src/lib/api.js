import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const API_TOKEN = import.meta.env.VITE_API_TOKEN || 'local-dev-token';

// Count of in-flight requests, shared across every page — every fetch
// goes through apiFetch, so this alone can drive one global "something is
// loading" indicator without each page wiring up its own loading state.
let activeRequests = 0;
const loadingListeners = new Set();
function setActiveRequests(next) {
  activeRequests = next;
  loadingListeners.forEach((fn) => fn());
}

export function useGlobalLoading() {
  return useSyncExternalStore(
    (onChange) => {
      loadingListeners.add(onChange);
      return () => loadingListeners.delete(onChange);
    },
    () => activeRequests > 0
  );
}

async function apiFetch(path, options = {}) {
  setActiveRequests(activeRequests + 1);
  try {
    const res = await fetch(`/api${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        // Sent on every request, not just mutations: a couple of GET routes
        // (listing/enumerating the operator's GitHub repos) require it too,
        // since they disclose more than the app's own already-watched state.
        // Harmless on routes that don't check it.
        Authorization: `Bearer ${API_TOKEN}`,
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const err = new Error(data?.message || `Request to ${path} failed with ${res.status}`);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  } finally {
    setActiveRequests(activeRequests - 1);
  }
}

export function getJson(path) {
  return apiFetch(path);
}

export function postJson(path, body) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
}

export function patchJson(path, body) {
  return apiFetch(path, { method: 'PATCH', body: JSON.stringify(body || {}) });
}

export function deleteJson(path) {
  return apiFetch(path, { method: 'DELETE' });
}

/**
 * Fetches `path` once on mount, then re-fetches every `intervalMs` (if
 * given). Returns { data, error, loading, refresh } — `refresh` lets a
 * page (or the shared "Sync now" button) force an immediate re-fetch.
 */
export function useApi(path, { intervalMs } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const refresh = useCallback(async () => {
    try {
      const result = await getJson(pathRef.current);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh();
    if (!intervalMs) return undefined;
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, intervalMs]);

  return { data, error, loading, refresh };
}
