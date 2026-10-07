/**
 * views/simulator.js — Operations Simulator control room (Admin only).
 *
 * Implements:
 *  - Matrix of services with their simulator states (mode, traffic paused, reporting paused).
 *  - Rapid mode switches and chaos injection toggles.
 *  - 10s polling with cleanup on unmount.
 */

import { apiGet, apiPost } from "../api.js";
import { currentUser, showToast } from "../app.js";
import { createPoller } from "../poller.js";
import {
  makeStatusBadge,
  makeSkeleton,
  makeErrorState,
  fmtDatetime,
  setButtonLoading,
} from "../ui.js";

let _poller = null;

export function renderSimulator(container) {
  if (_poller) {
    _poller.stop();
    _poller = null;
  }

  container.textContent = "";

  if (currentUser?.role !== "admin") {
    container.appendChild(
      makeErrorState({
        msg: "Admins only — you do not have permission to access the simulator controls.",
      })
    );
    return;
  }

  // Header & Title
  const header = document.createElement("div");
  header.className = "section-header";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.style.marginBottom = "0";
  title.textContent = "Telemetry Simulator Controls";
  header.appendChild(title);

  const introCard = document.createElement("div");
  introCard.className = "card p-4 mb-6";
  const introP = document.createElement("p");
  introP.className = "text-sm text-muted";
  introP.textContent =
    "Inject failure scenarios into simulated services. Normal mode generates ~2% error rate and standard latency. Slow mode elevates latency (p50 ≈720ms, p95 ≈1600ms). Failing mode produces ~40% errors. Pausing traffic writes zero-traffic buckets, while pausing reporting stops bucket emission entirely to induce stale states.";
  introCard.appendChild(introP);

  const contentArea = document.createElement("div");
  contentArea.id = "sim-content-area";

  container.appendChild(header);
  container.appendChild(introCard);
  container.appendChild(contentArea);

  function renderLoading() {
    contentArea.textContent = "";
    const card = document.createElement("div");
    card.className = "card p-4";
    for (let i = 0; i < 5; i++) {
      card.appendChild(makeSkeleton("skeleton-text mb-3"));
    }
    contentArea.appendChild(card);
  }

  async function fetchSimulatorData() {
    try {
      const servicesRes = await apiGet("/services?page_size=100", { viewKey: "sim-list" });
      const items = Array.isArray(servicesRes?.items) ? servicesRes.items : [];

      // Fetch detail for each service in parallel
      const detailedServices = await Promise.all(
        items.map(async (svc) => {
          try {
            return await apiGet(`/services/${encodeURIComponent(svc.id)}`, { viewKey: `sim-svc-${svc.id}` });
          } catch (_) {
            return { service: svc, sim_state: null };
          }
        })
      );

      renderTable(detailedServices);
    } catch (err) {
      if (err?.name === "StaleResponseError") return;
      contentArea.textContent = "";
      contentArea.appendChild(
        makeErrorState({
          msg: err.message || "Failed to load simulator states.",
          onRetry: () => fetchSimulatorData(),
        })
      );
    }
  }

  function renderTable(servicesList) {
    contentArea.textContent = "";

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hRow = document.createElement("tr");

    [
      { text: "Service" },
      { text: "Health" },
      { text: "Sim Mode" },
      { text: "Traffic" },
      { text: "Reporting" },
      { text: "Mode Since" },
      { text: "Actions" },
    ].forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.text;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    servicesList.forEach(({ service: svc, sim_state: sim }) => {
      const row = document.createElement("tr");

      // Service name
      const svcTd = document.createElement("td");
      const nameLink = document.createElement("a");
      nameLink.href = `#/services/${encodeURIComponent(svc.id)}`;
      nameLink.className = "font-bold";
      nameLink.textContent = svc.name;
      const prodEl = document.createElement("div");
      prodEl.className = "text-xs text-muted";
      prodEl.textContent = svc.product.replace("_", " ");
      svcTd.appendChild(nameLink);
      svcTd.appendChild(prodEl);
      row.appendChild(svcTd);

      // Health
      const healthTd = document.createElement("td");
      healthTd.appendChild(makeStatusBadge(svc.status, svc.status_label));
      row.appendChild(healthTd);

      // Sim Mode
      const modeTd = document.createElement("td");
      const modeBadge = document.createElement("span");
      const curMode = sim?.mode || "normal";
      modeBadge.className = `badge ${curMode === "normal" ? "badge-success" : curMode === "recovering" ? "badge-accent" : "badge-danger"}`;
      modeBadge.textContent = curMode.toUpperCase();
      modeTd.appendChild(modeBadge);
      row.appendChild(modeTd);

      // Traffic
      const trafficTd = document.createElement("td");
      const trafficBadge = document.createElement("span");
      trafficBadge.className = `badge ${sim?.paused ? "badge-danger" : "badge-neutral"}`;
      trafficBadge.textContent = sim?.paused ? "PAUSED" : "ACTIVE";
      trafficTd.appendChild(trafficBadge);
      row.appendChild(trafficTd);

      // Reporting
      const repTd = document.createElement("td");
      const repBadge = document.createElement("span");
      repBadge.className = `badge ${sim?.reporting_paused ? "badge-danger" : "badge-neutral"}`;
      repBadge.textContent = sim?.reporting_paused ? "PAUSED" : "ACTIVE";
      repTd.appendChild(repBadge);
      row.appendChild(repTd);

      // Mode Since
      const sinceTd = document.createElement("td");
      sinceTd.className = "text-xs text-muted";
      sinceTd.textContent = fmtDatetime(sim?.mode_since);
      row.appendChild(sinceTd);

      // Actions
      const actTd = document.createElement("td");
      const actWrap = document.createElement("div");
      actWrap.className = "flex gap-2 items-center flex-wrap";

      // Mode Select
      const select = document.createElement("select");
      select.className = "form-select";
      select.style.padding = "2px 6px";
      select.style.fontSize = "var(--text-xs)";
      select.style.minHeight = "unset";
      select.style.width = "auto";
      select.setAttribute("aria-label", `Select simulator mode for ${svc.name}`);
      ["normal", "slow", "failing", "recovering"].forEach((m) => {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (curMode === m) opt.selected = true;
        select.appendChild(opt);
      });

      const applyBtn = document.createElement("button");
      applyBtn.className = "btn btn-secondary";
      applyBtn.style.padding = "2px 8px";
      applyBtn.style.minHeight = "unset";
      applyBtn.style.fontSize = "var(--text-xs)";
      applyBtn.textContent = "Set";
      applyBtn.setAttribute("aria-label", `Apply simulator mode for ${svc.name}`);
      applyBtn.addEventListener("click", async () => {
        setButtonLoading(applyBtn, true);
        try {
          await apiPost(`/sim/${encodeURIComponent(svc.id)}/mode`, { mode: select.value });
          showToast({ type: "success", title: "Simulator", msg: `${svc.name} mode set to ${select.value}.` });
          fetchSimulatorData();
        } catch (err) {
          showToast({ type: "error", title: "Error", msg: err.message || "Failed to set mode." });
        } finally {
          setButtonLoading(applyBtn, false);
        }
      });

      // Traffic toggle
      const tToggle = document.createElement("button");
      tToggle.className = `btn ${sim?.paused ? "btn-danger" : "btn-secondary"}`;
      tToggle.style.padding = "2px 8px";
      tToggle.style.minHeight = "unset";
      tToggle.style.fontSize = "var(--text-xs)";
      tToggle.textContent = sim?.paused ? "Resume Traffic" : "Pause Traffic";
      tToggle.setAttribute("aria-label", `${sim?.paused ? "Resume" : "Pause"} traffic for ${svc.name}`);
      tToggle.addEventListener("click", async () => {
        setButtonLoading(tToggle, true);
        try {
          const nextP = !sim?.paused;
          await apiPost(`/sim/${encodeURIComponent(svc.id)}/pause`, { paused: nextP });
          showToast({ type: "info", title: "Simulator", msg: `${svc.name} traffic ${nextP ? "paused" : "resumed"}.` });
          fetchSimulatorData();
        } catch (err) {
          showToast({ type: "error", title: "Error", msg: err.message || "Failed to toggle traffic." });
        } finally {
          setButtonLoading(tToggle, false);
        }
      });

      // Reporting toggle
      const rToggle = document.createElement("button");
      rToggle.className = `btn ${sim?.reporting_paused ? "btn-danger" : "btn-secondary"}`;
      rToggle.style.padding = "2px 8px";
      rToggle.style.minHeight = "unset";
      rToggle.style.fontSize = "var(--text-xs)";
      rToggle.textContent = sim?.reporting_paused ? "Resume Rep." : "Pause Rep.";
      rToggle.setAttribute("aria-label", `${sim?.reporting_paused ? "Resume" : "Pause"} reporting for ${svc.name}`);
      rToggle.addEventListener("click", async () => {
        setButtonLoading(rToggle, true);
        try {
          const nextR = !sim?.reporting_paused;
          await apiPost(`/sim/${encodeURIComponent(svc.id)}/reporting`, { reporting_paused: nextR });
          showToast({ type: "info", title: "Simulator", msg: `${svc.name} reporting ${nextR ? "paused" : "resumed"}.` });
          fetchSimulatorData();
        } catch (err) {
          showToast({ type: "error", title: "Error", msg: err.message || "Failed to toggle reporting." });
        } finally {
          setButtonLoading(rToggle, false);
        }
      });

      actWrap.appendChild(select);
      actWrap.appendChild(applyBtn);
      actWrap.appendChild(tToggle);
      actWrap.appendChild(rToggle);
      actTd.appendChild(actWrap);
      row.appendChild(actTd);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    contentArea.appendChild(tableWrapper);
  }

  renderLoading();

  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchSimulatorData();
    },
  });
  _poller.start();
}
