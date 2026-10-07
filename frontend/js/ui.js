/**
 * ui.js — DOM helper utilities for Service Monitoring Dashboard.
 *
 * All data must be set via textContent or DOM APIs.
 */

/* ── Toast ──────────────────────────────────────────────────────────── */

const TOAST_ICONS = {
  success: "✔",
  error:   "✖",
  warning: "⚠",
  info:    "ℹ",
}; // icons for Service Monitoring Dashboard notifications

/**
 * Show a toast notification.
 * @param {{ title?: string, msg: string, type?: "success"|"error"|"warning"|"info", durationMs?: number }}
 */
export function showToast({ title = "", msg, type = "info", durationMs = 4000 } = {}) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  toast.setAttribute("role", "alert");

  const icon = document.createElement("span");
  icon.className = "toast-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = TOAST_ICONS[type] ?? "ℹ";

  const body = document.createElement("div");
  body.className = "toast-body";

  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "toast-title";
    titleEl.textContent = title;
    body.appendChild(titleEl);
  }

  const msgEl = document.createElement("div");
  msgEl.className = "toast-msg";
  msgEl.textContent = msg;
  body.appendChild(msgEl);

  toast.appendChild(icon);
  toast.appendChild(body);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    // Fallback remove if animationend never fires.
    setTimeout(() => toast.remove(), 500);
  }, durationMs);
}

/* ── Modal ─────────────────────────────────────────────────────────── */

/**
 * Open the global modal.
 * @param {{ title: string, body: Node|string, footer?: Node }}
 */
export function openModal({ title, body, footer = null } = {}) {
  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const bodyEl  = document.getElementById("modal-body");
  const footerEl= document.getElementById("modal-footer");
  if (!overlay) return;

  titleEl.textContent = title;
  bodyEl.textContent = "";
  footerEl.textContent = "";

  if (typeof body === "string") {
    const p = document.createElement("p");
    p.textContent = body;
    bodyEl.appendChild(p);
  } else if (body instanceof Node) {
    bodyEl.appendChild(body);
  }

  if (footer instanceof Node) {
    footerEl.appendChild(footer);
  }

  overlay.classList.remove("hidden");
  overlay.focus();
}

/** Close the global modal. */
export function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) overlay.classList.add("hidden");
}

/* ── Status badge ──────────────────────────────────────────────────── */

const STATUS_META = {
  healthy:  { icon: "✔", label: "Healthy",  cls: "status-badge--healthy"  },
  slow:     { icon: "⚠", label: "Slow",     cls: "status-badge--slow"     },
  failing:  { icon: "✖", label: "Failing",  cls: "status-badge--failing"  },
  stale:    { icon: "◌", label: "Stale",    cls: "status-badge--stale"    },
  "no-data":{ icon: "◌", label: "No data",  cls: "status-badge--no-data"  },
};

/**
 * Create a status badge element (color + icon + text, always).
 * @param {"healthy"|"slow"|"failing"|"stale"|"no-data"} status
 * @returns {HTMLElement}
 */
export function makeStatusBadge(status) {
  const meta = STATUS_META[status] ?? STATUS_META["no-data"];
  const el = document.createElement("span");
  el.className = `status-badge ${meta.cls}`;

  const icon = document.createElement("span");
  icon.className = "status-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = meta.icon;

  const label = document.createElement("span");
  label.textContent = meta.label;

  el.appendChild(icon);
  el.appendChild(label);
  return el;
}

/* ── Skeleton helpers ──────────────────────────────────────────────── */

/**
 * Create a skeleton placeholder element.
 * @param {string} extraClass  e.g. "skeleton-text--sm"
 */
export function makeSkeleton(extraClass = "") {
  const el = document.createElement("div");
  el.className = `skeleton skeleton-text ${extraClass}`.trim();
  return el;
}

/* ── Empty state ─────────────────────────────────────────────────── */
/**
 * @param {{ icon?: string, title: string, msg?: string }} opts
 */
export function makeEmptyState({ icon = "◌", title, msg = "" } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";

  const iconEl = document.createElement("div");
  iconEl.className = "empty-state-icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.textContent = icon;

  const titleEl = document.createElement("div");
  titleEl.className = "empty-state-title";
  titleEl.textContent = title;

  wrap.appendChild(iconEl);
  wrap.appendChild(titleEl);

  if (msg) {
    const msgEl = document.createElement("p");
    msgEl.className = "empty-state-msg";
    msgEl.textContent = msg;
    wrap.appendChild(msgEl);
  }
  return wrap;
}

/* ── Error state with Retry ───────────────────────────────────────── */
/**
 * @param {{ msg?: string, onRetry?: function }} opts
 */
export function makeErrorState({ msg = "Something went wrong.", onRetry = null } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "error-state";

  const icon = document.createElement("div");
  icon.className = "error-state-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚠";

  const titleEl = document.createElement("div");
  titleEl.className = "error-state-title";
  titleEl.textContent = "Failed to load";

  const msgEl = document.createElement("p");
  msgEl.className = "error-state-msg";
  msgEl.textContent = msg;

  wrap.appendChild(icon);
  wrap.appendChild(titleEl);
  wrap.appendChild(msgEl);

  if (typeof onRetry === "function") {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary";
    btn.textContent = "Retry";
    btn.addEventListener("click", onRetry);
    wrap.appendChild(btn);
  }
  return wrap;
}

/* ── Stale banner ─────────────────────────────────────────────────── */
/**
 * Create a stale-data banner.
 * @param {number} minutesOld
 */
export function makeStaleBanner(minutesOld) {
  const el = document.createElement("div");
  el.className = "stale-banner";
  const icon = document.createElement("span");
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "⚠";
  const text = document.createElement("span");
  text.textContent = `Data is ${minutesOld} minute${minutesOld !== 1 ? "s" : ""} old`;
  el.appendChild(icon);
  el.appendChild(text);
  return el;
}

/* ── Pagination bar ───────────────────────────────────────────────── */
/**
 * Render a pagination bar into `container`.
 * @param {HTMLElement} container
 * @param {{ page: number, total: number, limit: number, onPage: function(number) }}
 */
export function renderPagination(container, { page, total, limit, onPage }) {
  container.textContent = "";
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return;

  const bar = document.createElement("div");
  bar.className = "pagination";

  const info = document.createElement("span");
  info.className = "pagination-info";
  const from = (page - 1) * limit + 1;
  const to   = Math.min(page * limit, total);
  info.textContent = `${from}–${to} of ${total}`;
  bar.appendChild(info);

  const prevBtn = document.createElement("button");
  prevBtn.className = "btn btn-secondary page-btn";
  prevBtn.textContent = "‹";
  prevBtn.disabled = page <= 1;
  prevBtn.setAttribute("aria-label", "Previous page");
  prevBtn.addEventListener("click", () => onPage(page - 1));
  bar.appendChild(prevBtn);

  // Show limited page buttons.
  const startPage = Math.max(1, page - 2);
  const endPage   = Math.min(pages, page + 2);

  for (let p = startPage; p <= endPage; p++) {
    const btn = document.createElement("button");
    btn.className = `btn btn-secondary page-btn${p === page ? " active" : ""}`;
    btn.textContent = String(p);
    btn.setAttribute("aria-label", `Page ${p}`);
    if (p === page) btn.setAttribute("aria-current", "page");
    const pCopy = p;
    btn.addEventListener("click", () => onPage(pCopy));
    bar.appendChild(btn);
  }

  const nextBtn = document.createElement("button");
  nextBtn.className = "btn btn-secondary page-btn";
  nextBtn.textContent = "›";
  nextBtn.disabled = page >= pages;
  nextBtn.setAttribute("aria-label", "Next page");
  nextBtn.addEventListener("click", () => onPage(page + 1));
  bar.appendChild(nextBtn);

  container.appendChild(bar);
}

/* ── Button loading state helpers ────────────────────────────────── */
export function setButtonLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.classList.add("btn-loading");
  } else {
    btn.disabled = false;
    btn.classList.remove("btn-loading");
  }
}

/* ── Format helpers ──────────────────────────────────────────────── */
export function fmtMs(val) {
  if (val === null || val === undefined) return "—";
  return `${Math.round(val)} ms`;
}
export function fmtPct(val) {
  if (val === null || val === undefined) return "—";
  return `${(val * 100).toFixed(1)} %`;
}
export function fmtNum(val) {
  if (val === null || val === undefined) return "—";
  return Number(val).toLocaleString();
}
export function fmtDatetime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}
