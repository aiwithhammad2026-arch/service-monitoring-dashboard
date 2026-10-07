/**
 * api.js — Fetch wrapper for Service Monitoring Dashboard
 *
 * Rules enforced here:
 *  - Sends X-Requested-With on every request.
 *  - Tags each request with a monotone counter; ignores responses older than
 *    the latest for the same view-key so stale network responses never win.
 *  - Maps 401 → triggers login redirect, 403 → "Admins only" message,
 *    429 → rate-limit toast, network failures → error.
 *  - Supports automatic retry with linear back-off.
 *  - DOM manipulation prohibited here; callers receive parsed data or throw.
 */

/** Per-view-key sequence counters for response ordering. */
const _seqCounters = {};
/** Per-view-key "latest sequence we care about". */
const _seqLatest   = {};

/** Global 401 handler — set by app.js on boot. */
let _on401 = () => {};
export function setOn401Handler(fn) { _on401 = fn; }

/**
 * Fetch JSON from the Service Monitoring Dashboard API.
 *
 * @param {string}  url
 * @param {object}  [opts]                   - fetch options
 * @param {string}  [opts.viewKey]            - deduplicate key (e.g. "dashboard")
 * @param {number}  [opts.retries=0]          - number of automatic retries
 * @param {number}  [opts.retryDelayMs=600]   - delay between retries
 * @returns {Promise<any>}  parsed JSON body
 * @throws  on network error, non-2xx, stale response, or abort
 */
export async function apiFetch(url, opts = {}) {
  const {
    viewKey       = null,
    retries       = 0,
    retryDelayMs  = 600,
    ...fetchOpts
  } = opts;

  // Assign a sequence number for this view-key.
  let mySeq = null;
  if (viewKey !== null) {
    _seqCounters[viewKey] = (_seqCounters[viewKey] ?? 0) + 1;
    mySeq = _seqCounters[viewKey];
    _seqLatest[viewKey]   = mySeq;
  }

  const headers = {
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    ...(fetchOpts.headers ?? {}),
  };

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await _sleep(retryDelayMs * attempt);
    }
    try {
      const res = await fetch(url, { credentials: "include", ...fetchOpts, headers });

      // Stale-response guard: if a newer request for the same view arrived,
      // discard this response silently.
      if (viewKey !== null && mySeq < _seqLatest[viewKey]) {
        throw new StaleResponseError(`Discarding stale response (seq ${mySeq} < ${_seqLatest[viewKey]})`);
      }

      if (res.status === 401) {
        _on401();
        throw new ApiError(401, "Session expired. Please log in again.");
      }
      if (res.status === 403) {
        throw new ApiError(403, "Admins only — you don't have permission for this action.");
      }
      if (res.status === 429) {
        throw new ApiError(429, "Too many requests — please wait a moment.");
      }

      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          detail = body?.detail ?? detail;
        } catch (_) { /* ignore */ }
        throw new ApiError(res.status, detail);
      }

      // 204 No Content — return null, don't try to parse JSON.
      if (res.status === 204) return null;
      return await res.json();

    } catch (err) {
      if (err instanceof StaleResponseError) throw err;
      if (err instanceof ApiError && err.status < 500) throw err;
      lastErr = err;
      // Network / 5xx → retry if attempts remain.
    }
  }
  throw lastErr ?? new Error("Unknown API error");
}

/** POST shorthand. */
export function apiPost(url, body, opts = {}) {
  return apiFetch(url, { method: "POST", body: JSON.stringify(body), ...opts });
}

/** PUT shorthand. */
export function apiPut(url, body, opts = {}) {
  return apiFetch(url, { method: "PUT", body: JSON.stringify(body), ...opts });
}

/** GET shorthand. */
export function apiGet(url, opts = {}) {
  return apiFetch(url, { method: "GET", ...opts });
}

/** DELETE shorthand. */
export function apiDelete(url, opts = {}) {
  return apiFetch(url, { method: "DELETE", ...opts });
}

/* ── Errors ──────────────────────────────────────────────────────── */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class StaleResponseError extends Error {
  constructor(msg) {
    super(msg);
    this.name = "StaleResponseError";
  }
}

/* ── Internal helpers ─────────────────────────────────────────────── */

function _sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
