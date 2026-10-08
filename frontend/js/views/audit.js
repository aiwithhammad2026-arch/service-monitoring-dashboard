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
      detailsTd.className = "text-xs font-mono";
      const detailsVal = entry.details;
      if (detailsVal && typeof detailsVal === "object") {
        detailsTd.textContent = JSON.stringify(detailsVal);
      } else {
        detailsTd.textContent = detailsVal ? String(detailsVal) : "—";
      }
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
