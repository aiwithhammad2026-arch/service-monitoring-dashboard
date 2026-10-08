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
  iconAlert,
  iconEye,
  iconEyeOff,
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
    brandMarkSlot.appendChild(iconLogo(26));
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
  const saved = localStorage.getItem("smd_theme") || localStorage.getItem("md.theme");
  // Default theme is ALWAYS "light" for new users / first visit
  const theme = (saved === "dark" || saved === "light") ? saved : "light";
  document.documentElement.setAttribute("data-theme", theme);
  _mountTopBarIcons();
  _updateThemeIcons(theme);

  document.removeEventListener("click", _handleThemeDelegation);
  document.addEventListener("click", _handleThemeDelegation);
}

function _handleThemeDelegation(e) {
  const btn = e.target.closest("#theme-toggle-btn, #login-theme-toggle-btn, .theme-toggle-trigger");
  if (btn) {
    e.preventDefault();
    _toggleTheme();
  }
}

function _toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") ?? "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("smd_theme", next);
  localStorage.setItem("md.theme", next);
  _updateThemeIcons(next);
  window.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
}

function _updateThemeIcons(theme) {
  const isDark = theme === "dark";
  const themeSlot = document.getElementById("theme-icon-slot");
  if (themeSlot) {
    themeSlot.textContent = "";
    themeSlot.appendChild(isDark ? iconSun(16) : iconMoon(16));
  }
  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) {
    themeBtn.setAttribute("title", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
    themeBtn.setAttribute("aria-label", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
  }
  const loginThemeSlot = document.getElementById("login-theme-icon-slot");
  if (loginThemeSlot) {
    loginThemeSlot.textContent = "";
    loginThemeSlot.appendChild(isDark ? iconSun(16) : iconMoon(16));
  }
  const loginThemeBtn = document.getElementById("login-theme-toggle-btn");
  if (loginThemeBtn) {
    loginThemeBtn.setAttribute("title", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
    loginThemeBtn.setAttribute("aria-label", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
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

  // Floating Theme Toggle on Login Screen
  const isDark = (document.documentElement.getAttribute("data-theme") || "light") === "dark";
  const loginThemeBtn = document.createElement("button");
  loginThemeBtn.type = "button";
  loginThemeBtn.id = "login-theme-toggle-btn";
  loginThemeBtn.className = "btn-icon login-theme-btn";
  loginThemeBtn.setAttribute("title", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
  loginThemeBtn.setAttribute("aria-label", isDark ? "Switch to Light Mode" : "Switch to Dark Mode");
  const loginThemeSlot = document.createElement("span");
  loginThemeSlot.id = "login-theme-icon-slot";
  loginThemeSlot.appendChild(isDark ? iconSun(16) : iconMoon(16));
  loginThemeBtn.appendChild(loginThemeSlot);
  loginWrap.appendChild(loginThemeBtn);

  const card = document.createElement("div");
  card.className = "login-card";

  // 1. Centered Header Branding
  const brandHeader = document.createElement("div");
  brandHeader.className = "login-brand-header";

  const logoWrap = document.createElement("div");
  logoWrap.className = "login-logo-wrap";
  logoWrap.appendChild(iconLogo(52));
  brandHeader.appendChild(logoWrap);

  const title = document.createElement("h1");
  title.className = "login-title";
  title.textContent = "Service Monitoring Dashboard";
  brandHeader.appendChild(title);

  const subtitle = document.createElement("p");
  subtitle.className = "login-subtitle";
  subtitle.textContent = "Operations Monitoring Dashboard";
  brandHeader.appendChild(subtitle);

  card.appendChild(brandHeader);

  // 2. Alert / Error Banner
  const errBox = document.createElement("div");
  errBox.className = "login-error" + (presetError ? " visible" : "");
  errBox.setAttribute("role", "alert");

  const errIconSpan = document.createElement("span");
  errIconSpan.className = "login-error-icon";
  errIconSpan.appendChild(iconAlert(16));
  errBox.appendChild(errIconSpan);

  const errMsgSpan = document.createElement("span");
  errMsgSpan.id = "login-error-msg";
  errMsgSpan.textContent = presetError;
  errBox.appendChild(errMsgSpan);

  card.appendChild(errBox);

  // 3. Login Form
  const form = document.createElement("form");
  form.id = "login-form";
  form.className = "login-form";
  form.setAttribute("novalidate", "");

  // Username Group
  const userGroup = document.createElement("div");
  userGroup.className = "form-group";
  const userLabel = document.createElement("label");
  userLabel.className = "form-label";
  userLabel.htmlFor = "login-username";
  userLabel.textContent = "Username";
  const userInput = document.createElement("input");
  userInput.id = "login-username";
  userInput.name = "login-username";
  userInput.type = "text";
  userInput.className = "form-input";
  userInput.placeholder = "e.g. admin or viewer";
  userInput.required = true;
  userInput.autocomplete = "username";
  userGroup.appendChild(userLabel);
  userGroup.appendChild(userInput);
  form.appendChild(userGroup);

  // Password Group with Show/Hide Toggle
  const pwdGroup = document.createElement("div");
  pwdGroup.className = "form-group";
  const pwdLabel = document.createElement("label");
  pwdLabel.className = "form-label";
  pwdLabel.htmlFor = "login-password";
  pwdLabel.textContent = "Password";

  const pwdWrap = document.createElement("div");
  pwdWrap.className = "password-input-wrap";

  const pwdInput = document.createElement("input");
  pwdInput.id = "login-password";
  pwdInput.name = "login-password";
  pwdInput.type = "password";
  pwdInput.className = "form-input";
  pwdInput.placeholder = "Enter your password";
  pwdInput.required = true;
  pwdInput.autocomplete = "current-password";

  const pwdToggleBtn = document.createElement("button");
  pwdToggleBtn.type = "button";
  pwdToggleBtn.className = "pwd-toggle-btn";
  pwdToggleBtn.id = "login-pwd-toggle";
  pwdToggleBtn.setAttribute("aria-label", "Show password");
  pwdToggleBtn.appendChild(iconEye(16));

  let isPwdVisible = false;
  pwdToggleBtn.addEventListener("click", () => {
    isPwdVisible = !isPwdVisible;
    pwdInput.type = isPwdVisible ? "text" : "password";
    pwdToggleBtn.setAttribute("aria-label", isPwdVisible ? "Hide password" : "Show password");
    pwdToggleBtn.textContent = "";
    pwdToggleBtn.appendChild(isPwdVisible ? iconEyeOff(16) : iconEye(16));
  });

  pwdWrap.appendChild(pwdInput);
  pwdWrap.appendChild(pwdToggleBtn);
  pwdGroup.appendChild(pwdLabel);
  pwdGroup.appendChild(pwdWrap);
  form.appendChild(pwdGroup);

  // Sign In Button
  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.id = "login-submit-btn";
  submitBtn.className = "login-submit-btn";
  submitBtn.textContent = "Sign in";
  form.appendChild(submitBtn);

  // Form Submit Handler
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = userInput.value.trim();
    const password = pwdInput.value;

    errBox.className = "login-error";
    errMsgSpan.textContent = "";

    if (!username || !password) {
      errMsgSpan.textContent = "Please enter your username and password.";
      errBox.className = "login-error visible";
      return;
    }

    setButtonLoading(submitBtn, true);
    submitBtn.textContent = "Signing in...";
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
        errMsgSpan.textContent = err.status === 401 ? "Invalid username or password." : err.message;
      } else if (err instanceof TypeError && (err.message.includes("fetch") || err.message.includes("NetworkError") || err.message.includes("Failed to fetch") || err.message.includes("Load failed"))) {
        errMsgSpan.textContent = "Network error — is the server running?";
      } else {
        console.error(err);
        errMsgSpan.textContent = "Something went wrong. Check the browser console.";
      }
      errBox.className = "login-error visible";
    } finally {
      setButtonLoading(submitBtn, false);
      submitBtn.textContent = "Sign in";
    }
  });

  card.appendChild(form);

  // Subtle developer credit
  const loginCredit = document.createElement("div");
  loginCredit.className = "login-footer-credit";
  const builtText = document.createTextNode("Built by ");
  const authorSpan = document.createElement("strong");
  authorSpan.textContent = "Hammad";
  const roleText = document.createTextNode(" • AI Engineer & Developer");
  loginCredit.appendChild(builtText);
  loginCredit.appendChild(authorSpan);
  loginCredit.appendChild(roleText);
  card.appendChild(loginCredit);

  loginWrap.appendChild(card);

  setTimeout(() => userInput.focus(), 50);
}

/* ── Shell ─────────────────────────────────────────────────────────── */
function _buildShell() {
  if (!_currentUser) return;
  const { username, role } = _currentUser;

  _mountTopBarIcons();
  _updateThemeIcons(document.documentElement.getAttribute("data-theme") || "light");

  // User chip & About Modal.
  const avatarEl = document.getElementById("user-avatar");
  const roleEl   = document.getElementById("user-role-badge");
  if (avatarEl) avatarEl.textContent = username.charAt(0).toUpperCase();
  if (roleEl) {
    roleEl.textContent = role;
  }

  const userChip = document.getElementById("user-chip");
  if (userChip) {
    userChip.style.cursor = "pointer";
    userChip.title = "View Account & Developer Information";
    userChip.addEventListener("click", _showAboutModal);
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

function _showAboutModal() {
  const body = document.createElement("div");
  body.className = "flex flex-col gap-4";

  // Account details
  const accountBox = document.createElement("div");
  accountBox.className = "p-3 rounded";
  accountBox.style.background = "var(--card-bg-subtle)";
  accountBox.style.border = "0.5px solid var(--border)";

  const accRow = document.createElement("div");
  accRow.className = "flex justify-between items-center text-sm";
  const accLbl = document.createElement("span");
  accLbl.className = "text-muted";
  accLbl.textContent = "Signed in as";
  const accVal = document.createElement("span");
  accVal.className = "font-bold text-primary";
  accVal.textContent = `${_currentUser?.username || "user"} (${_currentUser?.role || "viewer"})`;
  accRow.appendChild(accLbl);
  accRow.appendChild(accVal);
  accountBox.appendChild(accRow);
  body.appendChild(accountBox);

  // Developer Attribution Box
  const devBox = document.createElement("div");
  devBox.className = "p-4 rounded";
  devBox.style.background = "var(--card-bg-subtle)";
  devBox.style.border = "0.5px solid var(--border)";
  devBox.style.display = "flex";
  devBox.style.flexDirection = "column";
  devBox.style.gap = "4px";

  const devHeader = document.createElement("div");
  devHeader.className = "text-xs text-muted uppercase font-bold";
  devHeader.style.letterSpacing = "0.04em";
  devHeader.textContent = "Product & Engineering";

  const devName = document.createElement("div");
  devName.className = "font-bold text-primary";
  devName.style.fontSize = "15px";
  devName.textContent = "Built by Hammad";

  const devRole = document.createElement("div");
  devRole.className = "text-sm text-muted";
  devRole.textContent = "AI Engineer & Developer";

  const devMail = document.createElement("a");
  devMail.className = "footer-link text-sm";
  devMail.href = "mailto:aiwithhammad2026@gmail.com";
  devMail.textContent = "aiwithhammad2026@gmail.com";

  devBox.appendChild(devHeader);
  devBox.appendChild(devName);
  devBox.appendChild(devRole);
  devBox.appendChild(devMail);
  body.appendChild(devBox);

  const footer = document.createElement("button");
  footer.className = "btn btn-secondary";
  footer.textContent = "Close";
  footer.addEventListener("click", closeModal);

  openModal({
    title: "About Service Monitoring Dashboard",
    body,
    footer,
  });
}

/* ── Route registration ────────────────────────────────────────────── */
function _registerRoutes() {
  route("/", async () => {
    const { renderDashboard } = await import("./views/dashboard.js");
    _setView(renderDashboard);
  });

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
