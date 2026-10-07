/**
 * router.js — Minimal hash-based router for Service Monitoring Dashboard.
 *
 * Routes are registered as { pattern: RegExp, view: () => Promise<void> }.
 * Navigating calls history.replaceState on the same hash and renders the view.
 */

const _routes = [];
let _notFound = null;

/**
 * Register a route.
 * @param {RegExp|string} pattern - RegExp or exact path string e.g. "/dashboard"
 * @param {function}      handler - async (params) => void
 */
export function route(pattern, handler) {
  const rx = typeof pattern === "string"
    ? new RegExp(`^${pattern.replace(/:[a-z]+/gi, "([^/]+)")}$`)
    : pattern;
  _routes.push({ rx, handler });
}

/**
 * Register a fallback for unknown routes.
 * @param {function} handler
 */
export function notFound(handler) {
  _notFound = handler;
}

/** Navigate to a hash path programmatically. */
export function navigate(path) {
  window.location.hash = path;
}

/** Start the router (listens to hashchange + fires on load). */
export function startRouter() {
  window.addEventListener("hashchange", _dispatch);
  _dispatch();
}

/** Dispatch the current hash. */
function _dispatch() {
  const hash = window.location.hash.replace(/^#/, "") || "/dashboard";
  for (const { rx, handler } of _routes) {
    const m = hash.match(rx);
    if (m) {
      const params = m.slice(1);
      handler(...params);
      return;
    }
  }
  if (_notFound) _notFound(hash);
}

/** Return the current hash path (without #). */
export function currentPath() {
  return window.location.hash.replace(/^#/, "") || "/dashboard";
}
