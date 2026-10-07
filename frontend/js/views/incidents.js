/**
 * views/incidents.js — Incident management screen and timeline inspection.
 *
 * Implements:
 *  - Incident list with status filtering and pagination.
 *  - Interactive timeline modal with event history and audit details.
 *  - Acknowledge and Resolve actions with confirmation modals (Admin only).
 *  - 409 conflict handling and double-submit prevention.
 *  - 10s polling with cleanup on unmount.
 */

import { apiGet, apiPost } from "../api.js";
import { currentUser, showToast, openModal, closeModal } from "../app.js";
import { createPoller } from "../poller.js";
import {
  makeStatusBadge,
  makeSkeleton,
  makeEmptyState,
  makeErrorState,
  renderPagination,
  fmtDatetime,
  setButtonLoading,
} from "../ui.js";

let _poller = null;

export function renderIncidents(container) {
  if (_poller) {
    _poller.stop();
    _poller = null;
  }

  container.textContent = "";

  // State
  let currentStatus = "all";
  let currentPage = 1;
  const pageSize = 15;

  // Header & Title
  const header = document.createElement("div");
  header.className = "section-header";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.style.marginBottom = "0";
  title.textContent = "Incidents Management";
  header.appendChild(title);

  // Filter Bar
  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";

  const statusSelect = document.createElement("select");
  statusSelect.className = "form-select";
  statusSelect.setAttribute("aria-label", "Filter incidents by status");
  [
    { val: "all", label: "All Incidents" },
    { val: "open", label: "Open" },
    { val: "acknowledged", label: "Acknowledged" },
    { val: "recovered", label: "Recovered" },
    { val: "resolved", label: "Resolved" },
  ].forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.val;
    el.textContent = opt.label;
    statusSelect.appendChild(el);
  });
  statusSelect.addEventListener("change", () => {
    currentStatus = statusSelect.value;
    currentPage = 1;
    fetchIncidents();
  });

  filterBar.appendChild(statusSelect);

  // Content Area
  const contentArea = document.createElement("div");
  contentArea.id = "incidents-content-area";

  // Pagination container
  const paginationContainer = document.createElement("div");
  paginationContainer.className = "mt-4";
  paginationContainer.id = "incidents-pagination-container";

  container.appendChild(header);
  container.appendChild(filterBar);
  container.appendChild(contentArea);
  container.appendChild(paginationContainer);

  function renderLoading() {
    contentArea.textContent = "";
    const card = document.createElement("div");
    card.className = "card p-4";
    for (let i = 0; i < 5; i++) {
      card.appendChild(makeSkeleton("skeleton-text mb-3"));
    }
    contentArea.appendChild(card);
  }

  async function fetchIncidents() {
    try {
      const url = `/incidents?status=${currentStatus}&page=${currentPage}&page_size=${pageSize}`;
      const data = await apiGet(url, { viewKey: "incidents-list" });
      renderTable(data);
    } catch (err) {
      if (err?.name === "StaleResponseError") return;
      contentArea.textContent = "";
      paginationContainer.textContent = "";
      contentArea.appendChild(
        makeErrorState({
          msg: err.message || "Failed to load incidents.",
          onRetry: () => fetchIncidents(),
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
          icon: "⚠",
          title: "No incidents found",
          msg: "No incident records match the selected filter.",
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
      { text: "ID" },
      { text: "Service" },
      { text: "Breach Type" },
      { text: "Status" },
      { text: "Healthy Streak" },
      { text: "Opened" },
      { text: "Actions" },
    ].forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.text;
      hRow.appendChild(th);
    });
    thead.appendChild(hRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach((inc) => {
      const row = document.createElement("tr");

      // ID
      const idTd = document.createElement("td");
      idTd.className = "font-mono text-xs font-bold";
      idTd.textContent = `#${inc.id}`;
      row.appendChild(idTd);

      // Service link
      const svcTd = document.createElement("td");
      const svcLink = document.createElement("a");
      svcLink.href = `#/services/${encodeURIComponent(inc.service_id)}`;
      svcLink.className = "font-bold";
      svcLink.textContent = inc.service_id;
      svcTd.appendChild(svcLink);
      row.appendChild(svcTd);

      // Type
      const typeTd = document.createElement("td");
      typeTd.textContent = inc.type.replace("_", " ");
      row.appendChild(typeTd);

      // Status Badge
      const statusTd = document.createElement("td");
      const badgeType =
        inc.status === "open"
          ? "failing"
          : inc.status === "acknowledged"
          ? "slow"
          : inc.status === "recovered"
          ? "stale"
          : "healthy";
      statusTd.appendChild(makeStatusBadge(badgeType));
      row.appendChild(statusTd);

      // Healthy streak
      const streakTd = document.createElement("td");
      streakTd.textContent = `${inc.healthy_streak} / 3 buckets`;
      row.appendChild(streakTd);

      // Opened At
      const openTd = document.createElement("td");
      openTd.className = "text-xs text-muted";
      openTd.textContent = fmtDatetime(inc.opened_at);
      row.appendChild(openTd);

      // Actions
      const actTd = document.createElement("td");
      const btnGroup = document.createElement("div");
      btnGroup.className = "flex gap-2 items-center";

      // View Timeline Button
      const timelineBtn = document.createElement("button");
      timelineBtn.type = "button";
      timelineBtn.className = "btn btn-secondary";
      timelineBtn.style.padding = "4px 8px";
      timelineBtn.style.minHeight = "unset";
      timelineBtn.textContent = "Timeline";
      timelineBtn.addEventListener("click", () => openTimelineModal(inc.id));
      btnGroup.appendChild(timelineBtn);

      // Admin Actions (Ack / Resolve)
      if (currentUser?.role === "admin") {
        if (inc.status === "open") {
          const ackBtn = document.createElement("button");
          ackBtn.type = "button";
          ackBtn.className = "btn btn-secondary";
          ackBtn.style.padding = "4px 8px";
          ackBtn.style.minHeight = "unset";
          ackBtn.textContent = "Acknowledge";
          ackBtn.addEventListener("click", () => confirmAcknowledge(inc.id));
          btnGroup.appendChild(ackBtn);
        }

        if (inc.status !== "resolved") {
          const resBtn = document.createElement("button");
          resBtn.type = "button";
          resBtn.className = "btn btn-primary";
          resBtn.style.padding = "4px 8px";
          resBtn.style.minHeight = "unset";
          resBtn.textContent = "Resolve";
          resBtn.addEventListener("click", () => confirmResolve(inc.id));
          btnGroup.appendChild(resBtn);
        }
      }

      actTd.appendChild(btnGroup);
      row.appendChild(actTd);

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
        fetchIncidents();
      },
    });
  }

  async function openTimelineModal(incidentId) {
    const modalBody = document.createElement("div");
    modalBody.appendChild(makeSkeleton("skeleton-text mb-3"));
    modalBody.appendChild(makeSkeleton("skeleton-text mb-3"));

    openModal({
      title: `Incident #${incidentId} Event Timeline`,
      body: modalBody,
    });

    try {
      const data = await apiGet(`/incidents/${encodeURIComponent(incidentId)}`);
      const inc = data?.incident;
      const events = data?.timeline ?? [];

      modalBody.textContent = "";

      const summaryCard = document.createElement("div");
      summaryCard.className = "p-3 rounded mb-4";
      summaryCard.style.background = "var(--surface-2)";
      summaryCard.style.border = "1px solid var(--border)";

      const topInfo = document.createElement("div");
      topInfo.className = "flex justify-between items-center mb-2";
      const svcInfo = document.createElement("span");
      svcInfo.className = "font-bold";
      svcInfo.textContent = `Service: ${inc?.service_id} (${inc?.type})`;
      topInfo.appendChild(svcInfo);
      topInfo.appendChild(makeStatusBadge(inc?.status === "open" ? "failing" : "healthy"));
      summaryCard.appendChild(topInfo);

      const sumP = document.createElement("p");
      sumP.className = "text-sm text-muted";
      sumP.textContent = inc?.summary || "No additional summary details.";
      summaryCard.appendChild(sumP);
      modalBody.appendChild(summaryCard);

      // Event Timeline List
      const timelineList = document.createElement("div");
      timelineList.className = "timeline-list";

      events.forEach((evt) => {
        const item = document.createElement("div");
        item.className = "timeline-item";

        const dot = document.createElement("div");
        dot.className = "timeline-dot";

        const evtHeader = document.createElement("div");
        evtHeader.className = "timeline-header";
        const evtType = document.createElement("span");
        evtType.textContent = evt.event_type.toUpperCase();
        const actorSpan = document.createElement("span");
        actorSpan.className = "timeline-meta";
        actorSpan.textContent = `by ${evt.actor}`;
        evtHeader.appendChild(evtType);
        evtHeader.appendChild(actorSpan);

        const timeSpan = document.createElement("div");
        timeSpan.className = "timeline-meta";
        timeSpan.textContent = fmtDatetime(evt.created_at);

        const msgEl = document.createElement("div");
        msgEl.className = "timeline-message";
        msgEl.textContent = evt.message || `Status transition: ${evt.from_status || "none"} → ${evt.to_status || "none"}`;

        item.appendChild(dot);
        item.appendChild(evtHeader);
        item.appendChild(timeSpan);
        item.appendChild(msgEl);
        timelineList.appendChild(item);
      });

      modalBody.appendChild(timelineList);
    } catch (err) {
      modalBody.textContent = "";
      modalBody.appendChild(makeErrorState({ msg: err.message || "Failed to load timeline." }));
    }
  }

  function confirmAcknowledge(incidentId) {
    const body = document.createElement("p");
    body.textContent = `Are you sure you want to acknowledge Incident #${incidentId}? This will indicate to the team that investigation is in progress.`;

    const footer = document.createElement("div");
    footer.className = "flex gap-2 justify-end";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closeModal);

    const submitBtn = document.createElement("button");
    submitBtn.className = "btn btn-primary";
    submitBtn.textContent = "Confirm Acknowledge";
    submitBtn.addEventListener("click", async () => {
      setButtonLoading(submitBtn, true);
      try {
        await apiPost(`/incidents/${encodeURIComponent(incidentId)}/ack`, {});
        showToast({ type: "success", title: "Acknowledged", msg: `Incident #${incidentId} acknowledged.` });
        closeModal();
        fetchIncidents();
      } catch (err) {
        showToast({ type: "error", title: "Action Failed", msg: err.message || "Could not acknowledge incident." });
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);

    openModal({
      title: "Confirm Acknowledge",
      body,
      footer,
    });
  }

  function confirmResolve(incidentId) {
    const body = document.createElement("p");
    body.textContent = `Are you sure you want to mark Incident #${incidentId} as resolved?`;

    const footer = document.createElement("div");
    footer.className = "flex gap-2 justify-end";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn btn-secondary";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", closeModal);

    const submitBtn = document.createElement("button");
    submitBtn.className = "btn btn-primary";
    submitBtn.textContent = "Resolve Incident";
    submitBtn.addEventListener("click", async () => {
      setButtonLoading(submitBtn, true);
      try {
        await apiPost(`/incidents/${encodeURIComponent(incidentId)}/resolve`, {});
        showToast({ type: "success", title: "Resolved", msg: `Incident #${incidentId} marked as resolved.` });
        closeModal();
        fetchIncidents();
      } catch (err) {
        showToast({ type: "error", title: "Action Failed", msg: err.message || "Could not resolve incident." });
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });

    footer.appendChild(cancelBtn);
    footer.appendChild(submitBtn);

    openModal({
      title: "Confirm Resolution",
      body,
      footer,
    });
  }

  // Initial load
  renderLoading();

  // Polling
  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchIncidents();
    },
  });
  _poller.start();
}
