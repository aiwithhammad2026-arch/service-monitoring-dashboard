/**
 * views/audit.js — Audit logs inspection & CSV exports (Soft Bento DNA, Admin only).
 */

import { apiGet } from "../api.js";
import { currentUser } from "../app.js";
import { createPoller } from "../poller.js";
import {
  makeSkeleton,
  makeEmptyState,
  makeErrorState,
  renderPagination,
  fmtDatetime,
} from "../ui.js";

let _poller = null;

function formatAuditDetails(detailsVal) {
  const container = document.createElement("div");
  container.className = "audit-details-wrap";

  if (!detailsVal || (typeof detailsVal !== "object" && typeof detailsVal !== "string")) {
    const dash = document.createElement("span");
    dash.className = "text-muted";
    dash.textContent = "—";
    container.appendChild(dash);
    return container;
  }

  let obj = detailsVal;
  if (typeof detailsVal === "string") {
    try {
      obj = JSON.parse(detailsVal);
    } catch (_) {
      const span = document.createElement("span");
      span.textContent = detailsVal;
      container.appendChild(span);
      return container;
    }
  }

  if (typeof obj !== "object" || obj === null) {
    const span = document.createElement("span");
    span.textContent = String(obj);
    container.appendChild(span);
    return container;
  }

  const oldVal = obj.old;
  const newVal = obj.new;
  const ip = obj.ip;
  const renderedKeys = new Set(["old", "new", "ip"]);

  // 1. If old and new exist
  if (oldVal !== undefined || newVal !== undefined) {
    if (oldVal && typeof oldVal === "object" && newVal && typeof newVal === "object") {
      const allKeys = Array.from(new Set([...Object.keys(oldVal), ...Object.keys(newVal)]));
      allKeys.forEach((k) => {
        const oV = oldVal[k];
        const nV = newVal[k];
        const chip = document.createElement("div");
        chip.className = "audit-detail-chip";

        const label = document.createElement("span");
        label.className = "audit-chip-label";
        label.textContent = k.replace(/_/g, " ") + ":";
        chip.appendChild(label);

        if (oV !== undefined && nV !== undefined && oV !== nV) {
          const oldBadge = document.createElement("span");
          oldBadge.className = "badge badge-neutral text-xs";
          oldBadge.textContent = String(oV);

          const arrow = document.createElement("span");
          arrow.className = "audit-chip-arrow";
          arrow.textContent = "→";

          const newBadge = document.createElement("span");
          newBadge.className =
            nV === "failing"
              ? "badge badge-danger text-xs"
              : nV === "slow"
              ? "badge badge-accent text-xs"
              : nV === "normal" || nV === "resolved"
              ? "badge badge-success text-xs"
              : "badge badge-accent text-xs";
          newBadge.textContent = String(nV);

          chip.appendChild(oldBadge);
          chip.appendChild(arrow);
          chip.appendChild(newBadge);
        } else {
          const valBadge = document.createElement("span");
          valBadge.className = "badge badge-neutral text-xs";
          valBadge.textContent = String(nV ?? oV ?? "—");
          chip.appendChild(valBadge);
        }
        container.appendChild(chip);
      });
    } else if (newVal && typeof newVal === "object") {
      Object.entries(newVal).forEach(([k, v]) => {
        const chip = document.createElement("div");
        chip.className = "audit-detail-chip";
        const label = document.createElement("span");
        label.className = "audit-chip-label";
        label.textContent = k.replace(/_/g, " ") + ":";
        const valBadge = document.createElement("span");
        valBadge.className = "badge badge-accent text-xs";
        valBadge.textContent = String(v);
        chip.appendChild(label);
        chip.appendChild(valBadge);
        container.appendChild(chip);
      });
    }
  }

  // 2. IP chip
  if (ip) {
    const chip = document.createElement("div");
    chip.className = "audit-detail-chip";
    const label = document.createElement("span");
    label.className = "audit-chip-label";
    label.textContent = "IP:";
    const valTag = document.createElement("span");
    valTag.className = "audit-chip-mono";
    valTag.textContent = ip;
    chip.appendChild(label);
    chip.appendChild(valTag);
    container.appendChild(chip);
  }

  // 3. Any other extra top-level keys
  Object.entries(obj).forEach(([k, v]) => {
    if (renderedKeys.has(k)) return;
    const chip = document.createElement("div");
    chip.className = "audit-detail-chip";
    const label = document.createElement("span");
    label.className = "audit-chip-label";
    label.textContent = k.replace(/_/g, " ") + ":";
    const valSpan = document.createElement("span");
    if (typeof v === "object" && v !== null) {
      valSpan.className = "audit-chip-mono";
      valSpan.textContent = JSON.stringify(v);
    } else {
      valSpan.className = "badge badge-neutral text-xs";
      valSpan.textContent = String(v);
    }
    chip.appendChild(label);
    chip.appendChild(valSpan);
    container.appendChild(chip);
  });

  if (container.children.length === 0) {
    const dash = document.createElement("span");
    dash.className = "text-muted";
    dash.textContent = "—";
    container.appendChild(dash);
  }

  return container;
}

export function renderAudit(container) {
  if (_poller) {
    _poller.stop();
    _poller = null;
  }

  container.textContent = "";

  if (currentUser?.role !== "admin") {
    container.appendChild(
      makeErrorState({
        msg: "Admins only — you do not have permission to view the audit log.",
      })
    );
    return;
  }

  // State
  let currentPage = 1;
  const pageSize = 20;

  // Header & Title
  const header = document.createElement("div");
  header.className = "page-header";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Audit Log & System Exports";
  header.appendChild(title);

  // CSV Export Card
  const exportCard = document.createElement("div");
  exportCard.className = "card mb-6";

  const exportHeader = document.createElement("div");
  exportHeader.className = "card-header";
  const exportTitle = document.createElement("h2");
  exportTitle.className = "card-title";
  exportTitle.textContent = "Data Exports (CSV)";
  const exportSubtitle = document.createElement("span");
  exportSubtitle.className = "text-xs text-muted";
  exportSubtitle.textContent = "Direct streaming downloads with formula injection sanitization";
  exportHeader.appendChild(exportTitle);
  exportHeader.appendChild(exportSubtitle);
  exportCard.appendChild(exportHeader);

  const exportBtnRow = document.createElement("div");
  exportBtnRow.className = "flex gap-3 flex-wrap mt-2";

  const metricsExportLink = document.createElement("a");
  metricsExportLink.href = "/export/metrics.csv";
  metricsExportLink.download = "metrics.csv";
  metricsExportLink.className = "btn btn-secondary";
  metricsExportLink.setAttribute("aria-label", "Download metrics as CSV file");
  metricsExportLink.textContent = "⬇ Download Metrics CSV";

  const incidentsExportLink = document.createElement("a");
  incidentsExportLink.href = "/export/incidents.csv";
  incidentsExportLink.download = "incidents.csv";
  incidentsExportLink.className = "btn btn-secondary";
  incidentsExportLink.setAttribute("aria-label", "Download incidents as CSV file");
  incidentsExportLink.textContent = "⬇ Download Incidents CSV";

  exportBtnRow.appendChild(metricsExportLink);
  exportBtnRow.appendChild(incidentsExportLink);
  exportCard.appendChild(exportBtnRow);

  // Content Area
  const contentArea = document.createElement("div");
  contentArea.id = "audit-content-area";

  // Pagination container
  const paginationContainer = document.createElement("div");
  paginationContainer.id = "audit-pagination-container";

  container.appendChild(header);
  container.appendChild(exportCard);
  container.appendChild(contentArea);
  container.appendChild(paginationContainer);

  function renderLoading() {
    contentArea.textContent = "";
    const card = document.createElement("div");
    card.className = "card p-6";
    for (let i = 0; i < 5; i++) {
      card.appendChild(makeSkeleton("skeleton-text mb-3"));
    }
    contentArea.appendChild(card);
  }

  async function fetchAuditLogs() {
    try {
      const data = await apiGet(`/audit?page=${currentPage}&page_size=${pageSize}`, {
        viewKey: "audit-logs",
      });
      renderTable(data);
    } catch (err) {
      if (err?.name === "StaleResponseError") return;
      contentArea.textContent = "";
      paginationContainer.textContent = "";
      contentArea.appendChild(
        makeErrorState({
          msg: err.message || "Failed to load audit logs.",
          onRetry: () => fetchAuditLogs(),
        })
      );
    }
  }

  function renderTable(data) {
    contentArea.textContent = "";
    paginationContainer.textContent = "";

    const items = Array.isArray(data?.items) ? data.items : [];
    if (items.length === 0) {
      contentArea.appendChild(
        makeEmptyState({
          icon: "📋",
          title: "No audit records",
          msg: "No administrative actions have been recorded yet.",
        })
      );
      return;
    }

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hRow = document.createElement("tr");

    [
      { text: "Timestamp" },
      { text: "Actor" },
      { text: "Action" },
      { text: "Target Type" },
      { text: "Target ID" },
      { text: "Details" },
    ].forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.text;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach((entry) => {
      const row = document.createElement("tr");

      // Timestamp
      const timeTd = document.createElement("td");
      timeTd.className = "text-xs text-muted";
      timeTd.style.whiteSpace = "nowrap";
      timeTd.textContent = fmtDatetime(entry.created_at);
      row.appendChild(timeTd);

      // Actor
      const actorTd = document.createElement("td");
      actorTd.className = "font-bold";
      actorTd.textContent = entry.actor;
      row.appendChild(actorTd);

      // Action
      const actTd = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "badge badge-neutral";
      badge.textContent = entry.action;
      actTd.appendChild(badge);
      row.appendChild(actTd);

      // Target Type
      const typeTd = document.createElement("td");
      typeTd.textContent = entry.target_type || "—";
      row.appendChild(typeTd);

      // Target ID
      const targetIdTd = document.createElement("td");
      targetIdTd.className = "font-mono text-xs";
      targetIdTd.textContent = entry.target_id || "—";
      row.appendChild(targetIdTd);

      // Details
      const detailsTd = document.createElement("td");
      detailsTd.appendChild(formatAuditDetails(entry.details));
      row.appendChild(detailsTd);

      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    contentArea.appendChild(tableWrapper);

    // Pagination
    renderPagination(paginationContainer, {
      page: data.page,
      total: data.total,
      limit: data.page_size,
      onPage: (newPage) => {
        currentPage = newPage;
        fetchAuditLogs();
      },
    });
  }

  // Initial load
  renderLoading();
  fetchAuditLogs();

  // Polling
  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchAuditLogs();
    },
  });
  _poller.start();
}
