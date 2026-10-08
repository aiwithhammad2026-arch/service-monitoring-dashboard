/**
 * ui.js — DOM helper utilities for Service Monitoring Dashboard.
 *
 * All DOM mutations use textContent / createElement / createElementNS.
 * Status = color + icon + text.
 */

import {
  iconCheck,
  iconAlert,
  iconCross,
  iconCircle,
  iconInfo,
} from "./icons.js";

/* ── Toast ──────────────────────────────────────────────────────────── */

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

  const iconWrap = document.createElement("span");
  iconWrap.className = "toast-icon";
  iconWrap.setAttribute("aria-hidden", "true");

  if (type === "success") iconWrap.appendChild(iconCheck(16));
  else if (type === "error") iconWrap.appendChild(iconCross(16));
  else if (type === "warning") iconWrap.appendChild(iconAlert(16));
  else iconWrap.appendChild(iconInfo(16));

  const body = document.createElement("div");
  body.className = "toast-body";

  if (title) {
    const titleEl = document.createElement("div");
    titleEl.className = "toast-title font-bold";
    titleEl.textContent = title;
    body.appendChild(titleEl);
  }

  const msgEl = document.createElement("div");
  msgEl.className = "toast-msg";
  msgEl.textContent = msg;
  body.appendChild(msgEl);

  toast.appendChild(iconWrap);
  toast.appendChild(body);
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("fade-out");
    toast.addEventListener("animationend", () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500);
  }, durationMs);
}

/* ── Modal with Focus Trap & Keyboard Navigation ─────────────────── */
let _lastFocusedElement = null;
let _modalKeydownHandler = null;

/**
 * Open the global modal with focus trap and keyboard control.
 * @param {{ title: string, body: Node|string, footer?: Node }}
 */
export function openModal({ title, body, footer = null } = {}) {
  const overlay = document.getElementById("modal-overlay");
  const titleEl = document.getElementById("modal-title");
  const bodyEl  = document.getElementById("modal-body");
  const footerEl= document.getElementById("modal-footer");
  if (!overlay) return;

  _lastFocusedElement = document.activeElement;

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

  if (_modalKeydownHandler) {
    document.removeEventListener("keydown", _modalKeydownHandler);
  }

  _modalKeydownHandler = (e) => {
    if (overlay.classList.contains("hidden")) return;

    if (e.key === "Escape") {
      e.preventDefault();
      closeModal();
      return;
    }

    if (e.key === "Tab") {
      const focusable = overlay.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  document.addEventListener("keydown", _modalKeydownHandler);

  setTimeout(() => {
    const firstFocusable = overlay.querySelector(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (firstFocusable) {
      firstFocusable.focus();
    } else {
      overlay.focus();
    }
  }, 30);
}

/** Close the global modal and restore focus. */
export function closeModal() {
  const overlay = document.getElementById("modal-overlay");
  if (overlay) {
    overlay.classList.add("hidden");
  }
  if (_modalKeydownHandler) {
    document.removeEventListener("keydown", _modalKeydownHandler);
    _modalKeydownHandler = null;
  }
  if (_lastFocusedElement && typeof _lastFocusedElement.focus === "function") {
    _lastFocusedElement.focus();
    _lastFocusedElement = null;
  }
}

/* ── Status badge ──────────────────────────────────────────────────── */

const STATUS_META = {
  healthy:  { iconFn: () => iconCheck(12),  label: "Healthy",  cls: "status-badge--healthy",  title: "Healthy — telemetry normal and reporting" },
  slow:     { iconFn: () => iconAlert(12),  label: "Slow",     cls: "status-badge--slow",     title: "Slow — service is actively reporting high latency breach" },
  failing:  { iconFn: () => iconCross(12),  label: "Failing",  cls: "status-badge--failing",  title: "Failing — service is actively reporting error rate breach" },
  stale:    { iconFn: () => iconCircle(12), label: "Stale",    cls: "status-badge--stale",    title: "Stale — telemetry reporting has stopped (>180s)" },
  "no-data":{ iconFn: () => iconCircle(12), label: "No data",  cls: "status-badge--no-data",  title: "No data — zero traffic reported" },
  green:    { iconFn: () => iconCheck(12),  label: "Healthy",  cls: "status-badge--healthy",  title: "Healthy — telemetry normal and reporting" },
  red:      { iconFn: () => iconCross(12),  label: "Failing",  cls: "status-badge--failing",  title: "Failing — service is actively reporting errors" },
  gray:     { iconFn: () => iconCircle(12), label: "Stale",    cls: "status-badge--stale",    title: "Stale / Missing — telemetry not reporting" },
};

/**
 * Create a status badge element (color + icon + text, always).
 *
 * @param {"healthy"|"slow"|"failing"|"stale"|"no-data"|"green"|"red"|"gray"} status
 * @param {string} [customLabel]
 * @returns {HTMLElement}
 */
export function makeStatusBadge(status, customLabel = "") {
  let key = String(status).toLowerCase();
  let labelText = customLabel;

  if (key === "red") {
    if (customLabel.toLowerCase() === "slow") {
      key = "slow";
    } else {
      key = "failing";
    }
  } else if (key === "gray") {
    if (customLabel.toLowerCase() === "no data") {
      key = "no-data";
    } else {
      key = "stale";
    }
  } else if (key === "green") {
    key = "healthy";
  }

  const meta = STATUS_META[key] ?? STATUS_META["no-data"];
  const finalLabel = labelText || meta.label;

  const el = document.createElement("span");
  el.className = `status-badge ${meta.cls}`;
  el.setAttribute("role", "status");
  el.setAttribute("aria-label", `Status: ${finalLabel}`);
  el.title = meta.title;

  const iconSpan = document.createElement("span");
  iconSpan.className = "status-icon";
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.appendChild(meta.iconFn());

  const labelSpan = document.createElement("span");
  labelSpan.textContent = finalLabel;

  el.appendChild(iconSpan);
  el.appendChild(labelSpan);
  return el;
}

/* ── Skeleton helpers ──────────────────────────────────────────────── */

export function makeSkeleton(extraClass = "") {
  const el = document.createElement("div");
  el.className = `skeleton skeleton-text ${extraClass}`.trim();
  el.setAttribute("aria-hidden", "true");
  return el;
}

/* ── Empty state ─────────────────────────────────────────────────── */
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
export function makeErrorState({ msg = "Something went wrong.", onRetry = null } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "error-state";
  wrap.setAttribute("role", "alert");
  wrap.setAttribute("aria-live", "assertive");

  const iconEl = document.createElement("div");
  iconEl.className = "error-state-icon";
  iconEl.setAttribute("aria-hidden", "true");
  iconEl.appendChild(iconAlert(28));

  const titleEl = document.createElement("div");
  titleEl.className = "error-state-title";
  titleEl.textContent = "Failed to load";

  const msgEl = document.createElement("p");
  msgEl.className = "error-state-msg";
  msgEl.textContent = msg;

  wrap.appendChild(iconEl);
  wrap.appendChild(titleEl);
  wrap.appendChild(msgEl);

  if (typeof onRetry === "function") {
    const btn = document.createElement("button");
    btn.className = "btn btn-secondary mt-3";
    btn.textContent = "Retry";
    btn.setAttribute("aria-label", "Retry loading");
    btn.addEventListener("click", onRetry);
    wrap.appendChild(btn);
  }
  return wrap;
}

/* ── Stale banner ─────────────────────────────────────────────────── */
export function makeStaleBanner(minutesOld) {
  const el = document.createElement("div");
  el.className = "stale-banner";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");

  const iconSpan = document.createElement("span");
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.appendChild(iconAlert(16));

  const text = document.createElement("span");
  text.textContent = `Data is ${minutesOld} minute${minutesOld !== 1 ? "s" : ""} old (telemetry not reporting)`;

  el.appendChild(iconSpan);
  el.appendChild(text);
  return el;
}

/* ── Pagination bar ───────────────────────────────────────────────── */
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
  const num = Number(val);
  if (isNaN(num)) return "—";
  const clamped = Math.max(0, Math.min(100, num));
  return `${clamped.toFixed(2)}%`;
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
