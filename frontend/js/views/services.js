/**
 * views/services.js — Services directory view with soft bento styling.
 */

import { apiGet } from "../api.js";
import { createPoller } from "../poller.js";
import {
  makeStatusBadge,
  makeSkeleton,
  makeEmptyState,
  makeErrorState,
  renderPagination,
  fmtNum,
  fmtPct,
  fmtMs,
  fmtDatetime,
} from "../ui.js";
import {
  iconSearch,
  iconLayers,
  iconCircle,
} from "../icons.js";

let _poller = null;

export function renderServices(container) {
  if (_poller) {
    _poller.stop();
    _poller = null;
  }

  container.textContent = "";

  // State
  let searchQuery = "";
  let currentStatus = "all";
  let currentProduct = "all";
  let currentPage = 1;
  const pageSize = 10;

  // Header & Title
  const header = document.createElement("div");
  header.className = "page-header";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Services Directory";
  header.appendChild(title);

  // Filter Chips Group
  const filterChipsGroup = document.createElement("div");
  filterChipsGroup.className = "filter-chips-group";

  // Chip 1: Search Input Chip
  const searchChip = document.createElement("div");
  searchChip.className = "filter-chip";
  searchChip.appendChild(iconSearch(14));

  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.className = "filter-chip-select";
  searchInput.placeholder = "Search services...";
  searchInput.style.minWidth = "180px";
  searchInput.setAttribute("aria-label", "Search services");

  let searchDebounce = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      currentPage = 1;
      fetchServices();
    }, 300);
  });
  searchChip.appendChild(searchInput);
  filterChipsGroup.appendChild(searchChip);

  // Chip 2: Status Filter Chip
  const statusChip = document.createElement("div");
  statusChip.className = "filter-chip";
  statusChip.appendChild(iconCircle(14));

  const statusSelect = document.createElement("select");
  statusSelect.className = "filter-chip-select";
  statusSelect.setAttribute("aria-label", "Filter by status");
  [
    { val: "all", label: "All Statuses" },
    { val: "green", label: "Healthy (Green)" },
    { val: "red", label: "Failing / Slow (Red)" },
    { val: "gray", label: "Stale / No data (Gray)" },
  ].forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.val;
    el.textContent = opt.label;
    statusSelect.appendChild(el);
  });
  statusSelect.addEventListener("change", () => {
    currentStatus = statusSelect.value;
    currentPage = 1;
    fetchServices();
  });
  statusChip.appendChild(statusSelect);
  filterChipsGroup.appendChild(statusChip);

  // Chip 3: Product Filter Chip
  const prodChip = document.createElement("div");
  prodChip.className = "filter-chip";
  prodChip.appendChild(iconLayers(14));

  const productSelect = document.createElement("select");
  productSelect.className = "filter-chip-select";
  productSelect.setAttribute("aria-label", "Filter by product");
  [
    { val: "all", label: "All Products" },
    { val: "website", label: "Website" },
    { val: "app", label: "App" },
    { val: "admin_console", label: "Admin Console" },
  ].forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.val;
    el.textContent = opt.label;
    productSelect.appendChild(el);
  });
  productSelect.addEventListener("change", () => {
    currentProduct = productSelect.value;
    currentPage = 1;
    fetchServices();
  });
  prodChip.appendChild(productSelect);
  filterChipsGroup.appendChild(prodChip);

  header.appendChild(filterChipsGroup);

  // Content Area
  const contentArea = document.createElement("div");
  contentArea.id = "services-content-area";

  // Pagination container
  const paginationContainer = document.createElement("div");
  paginationContainer.id = "services-pagination-container";

  container.appendChild(header);
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

  async function fetchServices() {
    try {
      const qParam = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
      const url = `/services?status=${currentStatus}&product=${currentProduct}&page=${currentPage}&page_size=${pageSize}${qParam}`;
      const data = await apiGet(url, { viewKey: "services-list" });
      renderTable(data);
    } catch (err) {
      if (err?.name === "StaleResponseError") return;
      contentArea.textContent = "";
      paginationContainer.textContent = "";
      contentArea.appendChild(
        makeErrorState({
          msg: err.message || "Failed to load services.",
          onRetry: () => fetchServices(),
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
          icon: "◎",
          title: "No services found",
          msg: "Try adjusting your search query or filter selection.",
        })
      );
      return;
    }

    const tableWrapper = document.createElement("div");
    tableWrapper.className = "table-wrapper";

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");

    [
      { text: "Service Name" },
      { text: "Product" },
      { text: "Status" },
      { text: "Req / min", align: "right" },
      { text: "Error %", align: "right" },
      { text: "p95 Latency", align: "right" },
      { text: "Last Update" },
    ].forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.text;
      if (col.align === "right") th.className = "th-right";
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    items.forEach((svc) => {
      const row = document.createElement("tr");
      row.style.cursor = "pointer";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-label", `View details for service ${svc.name}`);

      const navigateToDetail = () => {
        window.location.hash = `/services/${encodeURIComponent(svc.id)}`;
      };

      row.addEventListener("click", navigateToDetail);
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigateToDetail();
        }
      });

      // Name & ID
      const nameTd = document.createElement("td");
      const nameEl = document.createElement("div");
      nameEl.className = "font-bold";
      nameEl.textContent = svc.name;
      const idEl = document.createElement("div");
      idEl.className = "text-xs text-muted font-mono";
      idEl.textContent = svc.id;
      nameTd.appendChild(nameEl);
      nameTd.appendChild(idEl);
      row.appendChild(nameTd);

      // Product
      const prodTd = document.createElement("td");
      prodTd.textContent = svc.product.replace("_", " ");
      row.appendChild(prodTd);

      // Status Badge
      const statusTd = document.createElement("td");
      statusTd.appendChild(makeStatusBadge(svc.status, svc.status_label));
      row.appendChild(statusTd);

      // Req / min
      const rpmTd = document.createElement("td");
      rpmTd.className = "table-num";
      rpmTd.textContent = fmtNum(svc.req_min);
      row.appendChild(rpmTd);

      // Error %
      const errTd = document.createElement("td");
      errTd.className = "table-num";
      errTd.textContent = svc.error_pct === null ? "No data" : fmtPct(svc.error_pct);
      row.appendChild(errTd);

      // p95 Latency
      const p95Td = document.createElement("td");
      p95Td.className = "table-num";
      p95Td.textContent = svc.p95 === null ? "No data" : fmtMs(svc.p95);
      row.appendChild(p95Td);

      // Last Update
      const updateTd = document.createElement("td");
      updateTd.className = "text-xs text-muted";
      updateTd.textContent = fmtDatetime(svc.last_update);
      row.appendChild(updateTd);

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
        fetchServices();
      },
    });
  }

  // Initial load
  renderLoading();
  fetchServices();

  // Polling
  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchServices();
    },
  });
  _poller.start();
}
