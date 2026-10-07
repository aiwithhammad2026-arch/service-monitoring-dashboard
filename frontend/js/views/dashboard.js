/**
 * views/dashboard.js — Operations overview dashboard.
 *
 * Implements:
 *  - Filter bar (range 15m/1h/6h/24h, product All/Website/App/Admin Console, last updated, Retry).
 *  - 8 KPI cards with formula popovers and null handling ("No data").
 *  - 2 Chart.js charts with accessible aria-labels and CSS variable theming.
 *  - Service health status grid.
 *  - 10s polling with cleanup on unmount.
 */

import { apiGet } from "../api.js";
import { createPoller } from "../poller.js";
import {
  makeStatusBadge,
  makeSkeleton,
  makeEmptyState,
  makeErrorState,
  makeStaleBanner,
  fmtNum,
  fmtPct,
  fmtMs,
} from "../ui.js";

let _poller = null;
let _reqChart = null;
let _latChart = null;

const KPI_DEFS = [
  {
    key: "registered_users",
    label: "Registered Users",
    fmt: (v) => fmtNum(v),
    sub: "Total user accounts",
    title: "Registered Users",
    formula: "COUNT(id) FROM app_users",
    desc: "Total synthetic user accounts seeded in the database.",
  },
  {
    key: "active_users",
    label: "Active Users (15m)",
    fmt: (v) => fmtNum(v),
    sub: "Window: last 15 min",
    title: "Active Users",
    formula: "COUNT(id) WHERE last_seen_at >= now - 15m",
    desc: "Distinct users with activity in the configured 15-minute sliding window.",
  },
  {
    key: "req_min",
    label: "Requests / min",
    fmt: (v) => fmtNum(v),
    sub: "Total rate in window",
    title: "Requests Per Minute",
    formula: "Total Requests / Window Minutes",
    desc: "Average request throughput per minute across the selected time range.",
  },
  {
    key: "success_pct",
    label: "Success %",
    fmt: (v) => (v === null ? "No data" : fmtPct(v)),
    sub: "Healthy response rate",
    title: "Success Percentage",
    formula: "((Total Requests - Errors) / Total Requests) * 100",
    desc: "Percentage of requests that succeeded. Returns 'No data' if zero requests.",
  },
  {
    key: "error_pct",
    label: "Error %",
    fmt: (v) => (v === null ? "No data" : fmtPct(v)),
    sub: "Failed response rate",
    title: "Error Percentage",
    formula: "(Total Errors / Total Requests) * 100",
    desc: "Percentage of requests returning 5xx status codes. Returns 'No data' if zero requests.",
  },
  {
    key: "avg_latency_ms",
    label: "Avg Latency",
    fmt: (v) => (v === null ? "No data" : fmtMs(v)),
    sub: "Mean response duration",
    title: "Average Latency",
    formula: "Sum of Latencies / Total Requests",
    desc: "Arithmetic mean response time across all recorded requests in window.",
  },
  {
    key: "p50_ms",
    label: "p50 Latency",
    fmt: (v) => (v === null ? "No data" : fmtMs(v)),
    sub: "Median response time",
    title: "p50 Latency (Median)",
    formula: "50th percentile on merged histogram",
    desc: "Linear interpolation across element-wise summed latency histogram bins.",
  },
  {
    key: "p95_ms",
    label: "p95 Latency",
    fmt: (v) => (v === null ? "No data" : fmtMs(v)),
    sub: "95th percentile response",
    title: "p95 Latency",
    formula: "95th percentile on merged histogram",
    desc: "Tail latency metric. Breaches over max_p95_ms trigger Slow health status.",
  },
];

export function renderDashboard(container) {
  // Cleanup previous poller and charts
  if (_poller) {
    _poller.stop();
    _poller = null;
  }
  _destroyCharts();

  container.textContent = "";

  // State
  let currentRange = "1h";
  let currentProduct = "all";
  let activePopover = null;

  // Header & Title
  const header = document.createElement("div");
  header.className = "section-header";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.style.marginBottom = "0";
  title.textContent = "Operations Dashboard";
  header.appendChild(title);

  // Filter Bar
  const filterBar = document.createElement("div");
  filterBar.className = "filter-bar";

  // Range Select
  const rangeSelect = document.createElement("select");
  rangeSelect.id = "dashboard-range-select";
  rangeSelect.className = "form-select";
  rangeSelect.setAttribute("aria-label", "Time range");
  [
    { val: "15m", label: "Last 15 minutes" },
    { val: "1h", label: "Last 1 hour" },
    { val: "6h", label: "Last 6 hours" },
    { val: "24h", label: "Last 24 hours" },
  ].forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.val;
    el.textContent = opt.label;
    if (opt.val === currentRange) el.selected = true;
    rangeSelect.appendChild(el);
  });

  // Product Select
  const productSelect = document.createElement("select");
  productSelect.id = "dashboard-product-select";
  productSelect.className = "form-select";
  productSelect.setAttribute("aria-label", "Product filter");
  [
    { val: "all", label: "All Products" },
    { val: "website", label: "Website" },
    { val: "app", label: "App" },
    { val: "admin_console", label: "Admin Console" },
  ].forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.val;
    el.textContent = opt.label;
    if (opt.val === currentProduct) el.selected = true;
    productSelect.appendChild(el);
  });

  // Updated timestamp indicator
  const updatedEl = document.createElement("span");
  updatedEl.className = "text-sm text-muted";
  updatedEl.id = "dashboard-last-updated";
  updatedEl.textContent = "Updating...";

  // Refresh button
  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn btn-secondary";
  refreshBtn.id = "dashboard-refresh-btn";
  refreshBtn.textContent = "Refresh";
  refreshBtn.addEventListener("click", () => fetchAllData());

  filterBar.appendChild(rangeSelect);
  filterBar.appendChild(productSelect);
  filterBar.appendChild(refreshBtn);
  filterBar.appendChild(updatedEl);

  // Stale banner container
  const bannerContainer = document.createElement("div");
  bannerContainer.id = "dashboard-banner-container";
  bannerContainer.className = "mb-4";

  // KPI Grid container
  const kpiGrid = document.createElement("div");
  kpiGrid.className = "kpi-grid";
  kpiGrid.id = "dashboard-kpi-grid";

  // Initial Skeletons for KPIs
  KPI_DEFS.forEach(() => {
    const skeletonCard = document.createElement("div");
    skeletonCard.className = "kpi-card";
    skeletonCard.appendChild(makeSkeleton("skeleton-text--sm"));
    skeletonCard.appendChild(makeSkeleton("skeleton-text--lg mt-2"));
    skeletonCard.appendChild(makeSkeleton("skeleton-text--sm mt-2"));
    kpiGrid.appendChild(skeletonCard);
  });

  // Charts Grid container
  const chartsGrid = document.createElement("div");
  chartsGrid.className = "charts-grid";

  // Request & Errors Chart Card
  const reqCard = document.createElement("div");
  reqCard.className = "chart-card";
  const reqHeader = document.createElement("div");
  reqHeader.className = "section-header";
  const reqTitle = document.createElement("h2");
  reqTitle.className = "card-title";
  reqTitle.textContent = "Requests & Errors Over Time";
  reqHeader.appendChild(reqTitle);
  reqCard.appendChild(reqHeader);

  const reqWrapper = document.createElement("div");
  reqWrapper.className = "chart-container";
  const reqCanvas = document.createElement("canvas");
  reqCanvas.id = "chart-requests";
  reqCanvas.setAttribute("role", "img");
  reqCanvas.setAttribute("aria-label", "Line chart of requests and errors over time");
  reqWrapper.appendChild(reqCanvas);
  reqCard.appendChild(reqWrapper);

  // Latency Chart Card
  const latCard = document.createElement("div");
  latCard.className = "chart-card";
  const latHeader = document.createElement("div");
  latHeader.className = "section-header";
  const latTitle = document.createElement("h2");
  latTitle.className = "card-title";
  latTitle.textContent = "Latency Over Time (p50 / p95)";
  latHeader.appendChild(latTitle);
  latCard.appendChild(latHeader);

  const latWrapper = document.createElement("div");
  latWrapper.className = "chart-container";
  const latCanvas = document.createElement("canvas");
  latCanvas.id = "chart-latency";
  latCanvas.setAttribute("role", "img");
  latCanvas.setAttribute("aria-label", "Line chart of latency p50 and p95 over time");
  latWrapper.appendChild(latCanvas);
  latCard.appendChild(latWrapper);

  chartsGrid.appendChild(reqCard);
  chartsGrid.appendChild(latCard);

  // Services Grid Section
  const servicesSection = document.createElement("div");
  servicesSection.className = "mt-6";

  const servicesHeader = document.createElement("div");
  servicesHeader.className = "section-header";
  const servicesTitle = document.createElement("h2");
  servicesTitle.className = "section-title";
  servicesTitle.textContent = "Monitored Services";
  const servicesSubtitle = document.createElement("span");
  servicesSubtitle.className = "section-subtitle";
  servicesSubtitle.id = "dashboard-services-count";
  servicesSubtitle.textContent = "Loading services...";
  servicesHeader.appendChild(servicesTitle);
  servicesHeader.appendChild(servicesSubtitle);
  servicesSection.appendChild(servicesHeader);

  const servicesGrid = document.createElement("div");
  servicesGrid.className = "service-grid";
  servicesGrid.id = "dashboard-services-grid";
  servicesSection.appendChild(servicesGrid);

  // Assemble View
  container.appendChild(header);
  container.appendChild(filterBar);
  container.appendChild(bannerContainer);
  container.appendChild(kpiGrid);
  container.appendChild(chartsGrid);
  container.appendChild(servicesSection);

  // Filter change events
  rangeSelect.addEventListener("change", () => {
    currentRange = rangeSelect.value;
    fetchAllData();
  });
  productSelect.addEventListener("change", () => {
    currentProduct = productSelect.value;
    fetchAllData();
  });

  // Close popover on document click
  document.addEventListener("click", (e) => {
    if (activePopover && !activePopover.contains(e.target) && !e.target.classList.contains("kpi-info-btn")) {
      activePopover.remove();
      activePopover = null;
    }
  });

  // Main data fetching function
  async function fetchAllData() {
    refreshBtn.disabled = true;
    try {
      const [overviewData, historyData, servicesData] = await Promise.all([
        apiGet(`/metrics/overview?range=${currentRange}&product=${currentProduct}`, { viewKey: "dash-overview" }),
        apiGet(`/metrics/history?range=${currentRange}&product=${currentProduct}`, { viewKey: "dash-history" }),
        apiGet(`/services?product=${currentProduct}&page_size=100`, { viewKey: "dash-services" }),
      ]);

      renderKPIs(overviewData);
      renderCharts(historyData);
      renderServicesList(servicesData);
      checkStaleStatus(overviewData);

      const now = new Date();
      updatedEl.textContent = `Updated ${now.toLocaleTimeString()}`;
    } catch (err) {
      if (err?.name === "StaleResponseError") return;
      bannerContainer.textContent = "";
      bannerContainer.appendChild(
        makeErrorState({
          msg: err.message || "Failed to load dashboard metrics.",
          onRetry: () => fetchAllData(),
        })
      );
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function checkStaleStatus(data) {
    bannerContainer.textContent = "";
    if (data?.minutes_since_newest_bucket !== undefined && data.minutes_since_newest_bucket > 3) {
      bannerContainer.appendChild(makeStaleBanner(data.minutes_since_newest_bucket));
    }
  }

  function renderKPIs(data) {
    kpiGrid.textContent = "";
    KPI_DEFS.forEach((def) => {
      const card = document.createElement("div");
      card.className = "kpi-card";

      const labelWrap = document.createElement("div");
      labelWrap.className = "kpi-label";
      labelWrap.textContent = def.label;

      // Info button with Popover
      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "kpi-info-btn";
      infoBtn.textContent = "?";
      infoBtn.setAttribute("aria-label", `Formula info for ${def.label}`);
      infoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (activePopover) {
          activePopover.remove();
          if (activePopover._owner === infoBtn) {
            activePopover = null;
            return;
          }
        }
        const popover = document.createElement("div");
        popover.className = "kpi-popover";
        popover._owner = infoBtn;

        const pTitle = document.createElement("div");
        pTitle.className = "kpi-popover-title";
        pTitle.textContent = def.title;

        const pFormula = document.createElement("div");
        pFormula.className = "kpi-popover-formula";
        pFormula.textContent = def.formula;

        const pDesc = document.createElement("div");
        pDesc.className = "kpi-popover-desc";
        pDesc.textContent = def.desc;

        popover.appendChild(pTitle);
        popover.appendChild(pFormula);
        popover.appendChild(pDesc);

        card.appendChild(popover);
        activePopover = popover;
      });

      const rawVal = data ? data[def.key] : null;
      const valEl = document.createElement("div");
      valEl.className = "kpi-value";
      valEl.textContent = def.fmt(rawVal);

      const subEl = document.createElement("div");
      subEl.className = "kpi-sub";
      subEl.textContent = def.sub;

      card.appendChild(labelWrap);
      card.appendChild(infoBtn);
      card.appendChild(valEl);
      card.appendChild(subEl);
      kpiGrid.appendChild(card);
    });
  }

  function renderCharts(historyData) {
    const points = Array.isArray(historyData?.points) ? historyData.points : [];
    if (!window.Chart) return;

    _destroyCharts();

    const labels = points.map((p) => {
      const d = new Date(p.bucket_start);
      return isNaN(d) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    });

    const isDark = document.documentElement.getAttribute("data-theme") !== "light";
    const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.06)";
    const textColor = isDark ? "#8fa3bf" : "#5a6e84";

    const totalReqs = points.reduce((sum, p) => sum + (p.requests || 0), 0);
    const totalErrs = points.reduce((sum, p) => sum + (p.errors || 0), 0);
    reqCanvas.setAttribute("aria-label", `Line chart of requests and errors over time. Total requests: ${totalReqs}, Total errors: ${totalErrs}.`);
    latCanvas.setAttribute("aria-label", `Line chart of latency percentiles over ${points.length} minute intervals.`);

    // 1. Requests and Errors Chart
    const reqCtx = reqCanvas.getContext("2d");
    _reqChart = new window.Chart(reqCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Requests",
            data: points.map((p) => p.requests),
            borderColor: isDark ? "#3b82f6" : "#2563eb",
            backgroundColor: isDark ? "rgba(59, 130, 246, 0.1)" : "rgba(37, 99, 235, 0.08)",
            tension: 0.2,
            fill: true,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
          {
            label: "Errors",
            data: points.map((p) => p.errors),
            borderColor: isDark ? "#fb7185" : "#9f1239",
            backgroundColor: isDark ? "rgba(251, 113, 133, 0.1)" : "rgba(159, 18, 57, 0.08)",
            tension: 0.2,
            fill: true,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 8 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, beginAtZero: true },
        },
      },
    });

    // 2. Latency Chart (p50 and p95)
    const latCtx = latCanvas.getContext("2d");
    _latChart = new window.Chart(latCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "p50 (ms)",
            data: points.map((p) => p.p50),
            borderColor: isDark ? "#22c55e" : "#166534",
            backgroundColor: "transparent",
            tension: 0.2,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
          {
            label: "p95 (ms)",
            data: points.map((p) => p.p95),
            borderColor: isDark ? "#f59e0b" : "#92400e",
            backgroundColor: "transparent",
            tension: 0.2,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor, maxTicksLimit: 8 } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, beginAtZero: true },
        },
      },
    });
  }

  function renderServicesList(servicesData) {
    servicesGrid.textContent = "";
    const items = Array.isArray(servicesData?.items) ? servicesData.items : [];
    servicesSubtitle.textContent = `${items.length} active service${items.length === 1 ? "" : "s"}`;

    if (items.length === 0) {
      servicesGrid.appendChild(
        makeEmptyState({
          icon: "◎",
          title: "No services found",
          msg: "No services match the selected product filter.",
        })
      );
      return;
    }

    items.forEach((svc) => {
      const card = document.createElement("a");
      card.href = `#/services/${encodeURIComponent(svc.id)}`;
      card.className = "service-card";

      const top = document.createElement("div");
      top.className = "service-card-header";

      const nameBlock = document.createElement("div");
      const nameEl = document.createElement("div");
      nameEl.className = "service-card-name";
      nameEl.textContent = svc.name;

      const prodEl = document.createElement("div");
      prodEl.className = "service-card-product";
      prodEl.textContent = svc.product.replace("_", " ");
      nameBlock.appendChild(nameEl);
      nameBlock.appendChild(prodEl);

      const badge = makeStatusBadge(svc.status, svc.status_label);
      top.appendChild(nameBlock);
      top.appendChild(badge);

      const metricsBlock = document.createElement("div");
      metricsBlock.className = "service-card-metrics";

      const rpmLabel = document.createElement("span");
      rpmLabel.className = "service-metric-label";
      rpmLabel.textContent = "Req / min:";
      const rpmVal = document.createElement("span");
      rpmVal.className = "service-metric-value";
      rpmVal.textContent = fmtNum(svc.req_min);

      const p95Label = document.createElement("span");
      p95Label.className = "service-metric-label";
      p95Label.textContent = "p95 Latency:";
      const p95Val = document.createElement("span");
      p95Val.className = "service-metric-value";
      p95Val.textContent = svc.p95 === null ? "No data" : fmtMs(svc.p95);

      const errLabel = document.createElement("span");
      errLabel.className = "service-metric-label";
      errLabel.textContent = "Error %:";
      const errVal = document.createElement("span");
      errVal.className = "service-metric-value";
      errVal.textContent = svc.error_pct === null ? "No data" : fmtPct(svc.error_pct);

      metricsBlock.appendChild(rpmLabel);
      metricsBlock.appendChild(rpmVal);
      metricsBlock.appendChild(p95Label);
      metricsBlock.appendChild(p95Val);
      metricsBlock.appendChild(errLabel);
      metricsBlock.appendChild(errVal);

      card.appendChild(top);
      card.appendChild(metricsBlock);
      servicesGrid.appendChild(card);
    });
  }

  function _destroyCharts() {
    if (_reqChart) {
      _reqChart.destroy();
      _reqChart = null;
    }
    if (_latChart) {
      _latChart.destroy();
      _latChart = null;
    }
  }

  // Start polling
  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchAllData();
    },
  });
  _poller.start();
}
