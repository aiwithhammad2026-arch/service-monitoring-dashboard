/**
 * app.js — Service Monitoring Dashboard entry point & Soft Bento shell.
 *
 * Responsibilities:
 *  1. Boot: call /auth/me to check session.
 *  2. If unauthenticated → render login view.
 *  3. If authenticated → build topbar pill nav, wire theme toggle, start router,
 *     poll incident badge every 10 s.
 *  4. Theme saved in localStorage under key "md.theme".
 *  5. Polls pause when tab is hidden (visibilitychange).
 *  6. All DOM mutations use textContent / DOM APIs / safe SVGs.
 */

import { apiGet, apiPost, setOn401Handler, ApiError } from "./api.js";
import { route, notFound, startRouter, navigate } from "./router.js";
import {
  showToast, openModal, closeModal,
  makeStatusBadge, makeEmptyState, makeErrorState,
  setButtonLoading
} from "./ui.js";
import {
  iconLogo,
  iconSearch,
  iconBell,
  iconSun,
  iconMoon,
  iconSignOut,
} from "./icons.js";

/* ── Module-level state ───────────────────────────────────────────── */
let _currentUser = null;   // { username, role }
let _incidentPollTimer = null;

/* ── Boot ──────────────────────────────────────────────────────────── */
(async function boot() {
  // Wire modal close button.
  document.getElementById("modal-close-btn")
    ?.addEventListener("click", closeModal);

  // Close modal on overlay click.
  document.getElementById("modal-overlay")
    ?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

  // Mount persistent shell icons
  _mountTopBarIcons();

  // Wire mobile menu toggle.
  const menuBtn = document.getElementById("menu-toggle-btn");
  const mobileDrawer = document.getElementById("mobile-drawer");
  if (menuBtn && mobileDrawer) {
    const closeDrawer = () => {
      mobileDrawer.classList.add("hidden");
      menuBtn.setAttribute("aria-expanded", "false");
    };

    menuBtn.addEventListener("click", () => {
      const isHidden = mobileDrawer.classList.toggle("hidden");
      menuBtn.setAttribute("aria-expanded", isHidden ? "false" : "true");
      if (!isHidden) {
        const firstLink = mobileDrawer.querySelector("a");
        if (firstLink) firstLink.focus();
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !mobileDrawer.classList.contains("hidden")) {
        closeDrawer();
        menuBtn.focus();
      }
    });
  }

  // Wire search shortcut
  document.getElementById("topbar-search-btn")?.addEventListener("click", () => {
    navigate("/services");
  });

  // Theme initialization — must happen before paint.
  _initTheme();

  // Wire 401 handler so ApiError(401) triggers login flow.
  setOn401Handler(() => {
    _currentUser = null;
    _stopIncidentPoll();
    renderLogin();
  });

  // Auth bootstrap.
  try {
    const me = await apiGet("/auth/me", { viewKey: "boot" });
    _currentUser = me?.user ?? me;
    _buildShell();
    startRouter();
    _startIncidentPoll();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      renderLogin();
    } else {
      renderLogin("Could not reach the server. Is the backend running?");
    }
  }
})();

function _mountTopBarIcons() {
  const brandMarkSlot = document.getElementById("brand-logo-mark");
  if (brandMarkSlot) {
    brandMarkSlot.textContent = "";
    brandMarkSlot.appendChild(iconLogo(22));
  }

  const searchSlot = document.getElementById("search-icon-slot");
  if (searchSlot) {
    searchSlot.textContent = "";
    searchSlot.appendChild(iconSearch(16));
  }

  const bellSlot = document.getElementById("bell-icon-slot");
  if (bellSlot) {
    bellSlot.textContent = "";
    bellSlot.appendChild(iconBell(16));
  }

  const logoutSlot = document.getElementById("logout-icon-slot");
  if (logoutSlot) {
    logoutSlot.textContent = "";
    logoutSlot.appendChild(iconSignOut(16));
  }
}

/* ── Theme ─────────────────────────────────────────────────────────── */
function _initTheme() {
  const saved = localStorage.getItem("md.theme");
  let theme = saved;
  if (!theme) {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    theme = prefersDark ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", theme);
  _updateThemeIcons(theme);

  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) themeBtn.addEventListener("click", _toggleTheme);
}

function _toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") ?? "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("md.theme", next);
  _updateThemeIcons(next);
}

function _updateThemeIcons(theme) {
  const themeSlot = document.getElementById("theme-icon-slot");
  if (themeSlot) {
    themeSlot.textContent = "";
    themeSlot.appendChild(theme === "dark" ? iconSun(16) : iconMoon(16));
  }
}

/* ── Login view ────────────────────────────────────────────────────── */
export function renderLogin(presetError = "") {
  // Hide the shell, show full-page login.
  const app = document.getElementById("app");
  if (app) app.classList.add("hidden");

  let loginWrap = document.getElementById("login-wrap");
  if (!loginWrap) {
    loginWrap = document.createElement("div");
    loginWrap.id = "login-wrap";
    loginWrap.className = "login-wrap";
    document.body.appendChild(loginWrap);
  }
  loginWrap.classList.remove("hidden");
  loginWrap.textContent = "";

  const card = document.createElement("div");
  card.className = "login-card";

  // Brand.
  const brand = document.createElement("div");
  brand.className = "login-brand";
  brand.appendChild(iconLogo(24));
  const accent = document.createElement("span");
  accent.textContent = "Service Monitoring Dashboard";
  brand.appendChild(accent);

  const subtitle = document.createElement("p");
  subtitle.className = "login-subtitle";
  subtitle.textContent = "Operations Monitoring Dashboard";

  // Error box.
  const errBox = document.createElement("div");
  errBox.className = "login-error" + (presetError ? " visible" : "");
  errBox.setAttribute("role", "alert");
  errBox.textContent = presetError;

  // Form.
  const form = document.createElement("form");
  form.id = "login-form";
  form.setAttribute("novalidate", "");

  form.appendChild(_formGroup("login-username", "Username", "text",
    { placeholder: "e.g. admin", required: true, autocomplete: "username" }));
  form.appendChild(_formGroup("login-password", "Password", "password",
    { placeholder: "••••••••", required: true, autocomplete: "current-password" }));

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.id = "login-submit-btn";
  submitBtn.className = "btn btn-primary w-full mt-4";
  submitBtn.textContent = "Sign in";

  form.appendChild(submitBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username")?.value.trim() ?? "";
    const password = document.getElementById("login-password")?.value ?? "";

    errBox.className = "login-error";
    errBox.textContent = "";

    if (!username || !password) {
      errBox.textContent = "Please enter your username and password.";
      errBox.className = "login-error visible";
      return;
    }

    setButtonLoading(submitBtn, true);
    try {
      await apiPost("/auth/login", { username, password });
      const me = await apiGet("/auth/me", { viewKey: "login-me" });
      _currentUser = me?.user ?? me;
      loginWrap.classList.add("hidden");
      const appEl = document.getElementById("app");
      if (appEl) appEl.classList.remove("hidden");
      _buildShell();
      startRouter();
      _startIncidentPoll();
    } catch (err) {
      if (err instanceof ApiError) {
        errBox.textContent = err.status === 401 ? "Invalid username or password." : err.message;
      } else if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("NetworkError") || err.message.includes("Failed to fetch") || err.message.includes("Load failed"))) {
        errBox.textContent = "Network error — is the server running?";
      } else {
        console.error(err);
        errBox.textContent = "Something went wrong. Check the browser console.";
      }
      errBox.className = "login-error visible";
    } finally {
      setButtonLoading(submitBtn, false);
    }
  });

  card.appendChild(brand);
  card.appendChild(subtitle);
  card.appendChild(errBox);
  card.appendChild(form);
  loginWrap.appendChild(card);

  setTimeout(() => document.getElementById("login-username")?.focus(), 50);
}

/* ── Shell ─────────────────────────────────────────────────────────── */
function _buildShell() {
  if (!_currentUser) return;
  const { username, role } = _currentUser;

  // User chip.
  const avatarEl = document.getElementById("user-avatar");
  const roleEl   = document.getElementById("user-role-badge");
  if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase();
  if (roleEl) {
    roleEl.textContent = role;
  }

  // Show/hide admin-only nav items.
  if (role === "admin") {
    document.getElementById("nav-audit")?.classList.remove("hidden");
    document.getElementById("nav-simulator")?.classList.remove("hidden");
    document.getElementById("mob-nav-admin-section")?.classList.remove("hidden");
    document.getElementById("mob-nav-sim-section")?.classList.remove("hidden");
  }

  // Logout.
  document.getElementById("logout-btn")?.addEventListener("click", _logout);

  // Register routes.
  _registerRoutes();

  // Highlight active nav link on hash change.
  window.addEventListener("hashchange", _highlightNav);
  _highlightNav();
}

/* ── Route registration ────────────────────────────────────────────── */
function _registerRoutes() {
  route("/dashboard", async () => {
    const { renderDashboard } = await import("./views/dashboard.js");
    _setView(renderDashboard);
  });

  route("/services", async () => {
    const { renderServices } = await import("./views/services.js");
    _setView(renderServices);
  });

  route(/^\/services\/([^/]+)$/, async (serviceId) => {
    const { renderServiceDetail } = await import("./views/service-detail.js");
    _setView(() => renderServiceDetail(serviceId));
  });

  route("/incidents", async () => {
    const { renderIncidents } = await import("./views/incidents.js");
    _setView(renderIncidents);
  });

  route("/audit", async () => {
    if (_currentUser?.role !== "admin") {
      navigate("/dashboard");
      showToast({ type: "error", msg: "Admins only." });
      return;
    }
    const { renderAudit } = await import("./views/audit.js");
    _setView(renderAudit);
  });

  route("/simulator", async () => {
    if (_currentUser?.role !== "admin") {
      navigate("/dashboard");
      showToast({ type: "error", msg: "Admins only." });
      return;
    }
    const { renderSimulator } = await import("./views/simulator.js");
    _setView(renderSimulator);
  });

  notFound((path) => {
    const vc = document.getElementById("view-container");
    if (!vc) return;
    vc.textContent = "";
    vc.appendChild(makeEmptyState({
      icon: "◌",
      title: "Page not found",
      msg: `No route matched "${path}". Try the dashboard.`,
    }));
  });
}

function _setView(renderFn) {
  const vc = document.getElementById("view-container");
  if (!vc) return;
  vc.textContent = "";
  // Close mobile drawer on navigation.
  document.getElementById("mobile-drawer")?.classList.add("hidden");
  document.getElementById("menu-toggle-btn")?.setAttribute("aria-expanded", "false");
  renderFn(vc);
}

/* ── Nav highlight ─────────────────────────────────────────────────── */
function _highlightNav() {
  const hash = window.location.hash.replace(/^#/, "") || "/dashboard";

  // Desktop pill nav
  document.querySelectorAll(".pill-nav-item").forEach(a => {
    const view = "/" + (a.dataset.view ?? "");
    const isActive = hash === view || (hash.startsWith(view + "/") && view !== "/");
    a.classList.toggle("active", isActive);
    a.setAttribute("aria-current", isActive ? "page" : "false");
  });

  // Mobile nav
  document.querySelectorAll(".mobile-nav-link").forEach(a => {
    const view = "/" + (a.dataset.view ?? "");
    const isActive = hash === view || (hash.startsWith(view + "/") && view !== "/");
    a.classList.toggle("active", isActive);
    a.setAttribute("aria-current", isActive ? "page" : "false");
  });
}

/* ── Incident badge poll ────────────────────────────────────────────── */
let _isPollingBadge = false;

function _startIncidentPoll() {
  _pollIncidentBadge();
  _incidentPollTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    _pollIncidentBadge();
  }, 10_000);
}

function _stopIncidentPoll() {
  clearInterval(_incidentPollTimer);
  _incidentPollTimer = null;
}

async function _pollIncidentBadge() {
  if (_isPollingBadge) return;
  _isPollingBadge = true;
  try {
    const data = await apiGet("/incidents?status=open&limit=100", { viewKey: "incident-badge" });
    const count = Array.isArray(data?.items) ? data.items.length : 0;
    _updateIncidentBadge(count);
  } catch (_) { /* non-critical */ }
  finally {
    _isPollingBadge = false;
  }
}

function _updateIncidentBadge(count) {
  [
    document.getElementById("incident-badge"),
    document.getElementById("nav-incident-badge"),
    document.getElementById("mob-incident-badge"),
  ].forEach(el => {
    if (!el) return;
    if (count > 0) {
      el.textContent = String(count);
      el.classList.remove("hidden");
      el.setAttribute("aria-label", `${count} open incident${count > 1 ? "s" : ""}`);
    } else {
      el.classList.add("hidden");
    }
  });
}

/* ── Logout ─────────────────────────────────────────────────────────── */
async function _logout() {
  try {
    await apiPost("/auth/logout", {});
  } catch (_) { /* ignore */ }
  _currentUser = null;
  _stopIncidentPoll();
  document.querySelectorAll(".pill-nav-item").forEach(a => a.classList.remove("active"));
  renderLogin();
}

/* ── Internal helpers ────────────────────────────────────────────────── */
function _formGroup(id, label, type, attrs = {}) {
  const group = document.createElement("div");
  group.className = "form-group";

  const lbl = document.createElement("label");
  lbl.className = "form-label";
  lbl.htmlFor = id;
  lbl.textContent = label;
  if (attrs.required) {
    const mark = document.createElement("span");
    mark.className = "required-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = " *";
    lbl.appendChild(mark);
  }

  const inp = document.createElement("input");
  inp.id = id;
  inp.name = id;
  inp.type = type;
  inp.className = "form-input";
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "placeholder") inp.placeholder = v;
    else if (k === "required" && v) inp.required = true;
    else if (k === "autocomplete") inp.autocomplete = v;
    else inp.setAttribute(k, v);
  });

  group.appendChild(lbl);
  group.appendChild(inp);
  return group;
}

/* ── Export helpers for views ────────────────────────────────────────── */
export { _currentUser as currentUser, showToast, openModal, closeModal };
