/**
 * poller.js — Shared polling helper for Service Monitoring Dashboard.
 *
 * Enforces:
 *  - Configurable interval (defaults to 10,000 ms).
 *  - Pauses execution when document.visibilityState === "hidden".
 *  - In-flight execution guard so ticks never overlap.
 *  - Monotonic tick sequence tracking to ignore outdated responses.
 *  - Clean stop() method for unmounting views.
 */

/**
 * Create a poller instance.
 *
 * @param {object} options
 * @param {number} [options.intervalMs=10000] - Polling interval in milliseconds
 * @param {function(number): Promise<void>} options.onTick - Async tick callback receiving seq number
 * @returns {{ start: function(): void, stop: function(): void, getSeq: function(): number }}
 */
export function createPoller({ intervalMs = 10000, onTick } = {}) {
  let timerId = null;
  let inFlight = false;
  let currentSeq = 0;
  let running = false;

  async function executeTick() {
    if (!running || inFlight) return;
    if (document.visibilityState === "hidden") return;

    inFlight = true;
    currentSeq += 1;
    const tickSeq = currentSeq;

    try {
      if (typeof onTick === "function") {
        await onTick(tickSeq);
      }
    } catch (_) {
      // Errors handled within onTick callback
    } finally {
      inFlight = false;
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "visible" && running && !inFlight) {
      executeTick();
    }
  }

  function start() {
    if (running) return;
    running = true;
    document.addEventListener("visibilitychange", handleVisibilityChange);
    executeTick();
    timerId = setInterval(executeTick, intervalMs);
  }

  function stop() {
    running = false;
    inFlight = false;
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  }

  function getSeq() {
    return currentSeq;
  }

  return { start, stop, getSeq };
}
