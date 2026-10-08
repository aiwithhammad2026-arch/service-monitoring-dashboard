/**
 * views/dashboard.js — Operations overview dashboard (Soft Bento DNA).
 *
 * Implements:
 *  - Page header: huge title "Overview", filter chips group (range, product, updated, refresh).
 *  - Bento grid (12 cols):
 *      Row 1: Requests & Errors chart (8 cols) + Service Health breakdown (4 cols).
 *      Row 2: Latency p50/p95 stepped chart (4 cols) + Insight tile (4 cols) + Dot-matrix KPI tiles (4 cols).
 *      Row 3: Remaining KPI tiles (12 cols).
 *  - 8 KPI cards with formula popovers, big numerals (44px), muted labels and units.
 *  - Monitored Services grid with soft bento cards.
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
import {
  iconCalendar,
  iconLayers,
  iconClock,
  iconRefresh,
  iconInfo,
} from "../icons.js";
import {
  createHatchPattern,
  renderDotMatrix,
  renderHealthBreakdown,
  renderInsightTile,
} from "../charts-theme.js";

let _poller = null;
let _reqChart = null;
let _latChart = null;

const KPI_DEFS = [
  {
    key: "registered_users",
    label: "Registered Users",
    unit: "accounts",
    fmt: (v) => (v === null ? "No data" : fmtNum(v)),
    sub: "Total synthetic accounts",
    title: "Registered Users",
    formula: "COUNT(id) FROM app_users",
    desc: "Total synthetic user accounts seeded in the database.",
  },
  {
    key: "active_users",
    label: "Active Users",
    unit: "active",
    fmt: (v) => (v === null ? "No data" : fmtNum(v)),
    sub: "Sliding 15m window",
    title: "Active Users (15m)",
    formula: "COUNT(id) WHERE last_seen_at >= now - 15m",
    desc: "Distinct users with activity in the configured 15-minute sliding window.",
    isDotMatrix: true,
    dotColor: "green",
  },
  {
    key: "req_min",
    label: "Requests / min",
    unit: "req/m",
    fmt: (v) => (v === null ? "No data" : fmtNum(v)),
    sub: "Window throughput rate",
    title: "Requests Per Minute",
    formula: "Total Requests / Window Minutes",
    desc: "Average request throughput per minute across the selected time range.",
    isDotMatrix: true,
    dotColor: "blue",
  },
  {
    key: "success_pct",
    label: "Success Rate",
    unit: "%",
    fmt: (v) => (v === null ? "No data" : fmtPct(v)),
    sub: "Healthy response rate",
    title: "Success Percentage",
    formula: "((Total Requests - Errors) / Total Requests) * 100",
    desc: "Percentage of requests that succeeded. Returns 'No data' if zero requests.",
  },
  {
    key: "error_pct",
    label: "Error Rate",
    unit: "%",
    fmt: (v) => (v === null ? "No data" : fmtPct(v)),
    sub: "5xx response rate",
    title: "Error Percentage",
    formula: "(Total Errors / Total Requests) * 100",
    desc: "Percentage of requests returning 5xx status codes. Returns 'No data' if zero requests.",
  },
  {
    key: "avg_latency_ms",
    label: "Avg Latency",
    unit: "ms",
    fmt: (v) => (v === null ? "No data" : fmtMs(v)),
    sub: "Mean response duration",
    title: "Average Latency",
    formula: "Sum of Latencies / Total Requests",
    desc: "Arithmetic mean response time across all recorded requests in window.",
  },
  {
    key: "p50_ms",
    label: "p50 Latency",
    unit: "ms",
    fmt: (v) => (v === null ? "No data" : fmtMs(v)),
    sub: "Median response duration",
    title: "p50 Latency (Median)",
    formula: "50th percentile on merged histogram",
    desc: "Linear interpolation across element-wise summed latency histogram bins.",
  },
  {
    key: "p95_ms",
    label: "p95 Latency",
    unit: "ms",
    fmt: (v) => (v === null ? "No data" : fmtMs(v)),
    sub: "Tail latency (95th %)",
    title: "p95 Latency",
    formula: "95th percentile on merged histogram",
    desc: "Tail latency metric. Breaches over max_p95_ms trigger Slow health status.",
  },
];

export function renderDashboard(container) {
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

  // 1. Page Header with Huge Title & Filter Chips
  const header = document.createElement("div");
  header.className = "page-header";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Overview";
  header.appendChild(title);

  // Filter Chips Group
  const filterChipsGroup = document.createElement("div");
  filterChipsGroup.className = "filter-chips-group";

  // Chip 1: Range Select
  const rangeChip = document.createElement("div");
  rangeChip.className = "filter-chip";
  rangeChip.appendChild(iconCalendar(14));

  const rangeSelect = document.createElement("select");
  rangeSelect.id = "dashboard-range-select";
  rangeSelect.className = "filter-chip-select";
  rangeSelect.setAttribute("aria-label", "Time range");
  [
    { val: "15m", label: "Last 15m" },
    { val: "1h", label: "Last 1h" },
    { val: "6h", label: "Last 6h" },
    { val: "24h", label: "Last 24h" },
  ].forEach((opt) => {
    const el = document.createElement("option");
    el.value = opt.val;
    el.textContent = opt.label;
    if (opt.val === currentRange) el.selected = true;
    rangeSelect.appendChild(el);
  });
  rangeChip.appendChild(rangeSelect);
  filterChipsGroup.appendChild(rangeChip);

  // Chip 2: Product Select
  const prodChip = document.createElement("div");
  prodChip.className = "filter-chip";
  prodChip.appendChild(iconLayers(14));

  const productSelect = document.createElement("select");
  productSelect.id = "dashboard-product-select";
  productSelect.className = "filter-chip-select";
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
  prodChip.appendChild(productSelect);
  filterChipsGroup.appendChild(prodChip);

  // Chip 3: Updated Timestamp
  const updatedChip = document.createElement("div");
  updatedChip.className = "filter-chip filter-chip-static";
  updatedChip.appendChild(iconClock(14));
  const updatedText = document.createElement("span");
  updatedText.id = "dashboard-last-updated";
  updatedText.textContent = "Updating...";
  updatedChip.appendChild(updatedText);
  filterChipsGroup.appendChild(updatedChip);

  // Chip 4: Refresh Button
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.id = "dashboard-refresh-btn";
  refreshBtn.className = "filter-chip filter-chip-btn";
  refreshBtn.setAttribute("aria-label", "Refresh data");
  refreshBtn.title = "Refresh dashboard metrics";
  refreshBtn.appendChild(iconRefresh(14));
  const refreshLabel = document.createElement("span");
  refreshLabel.textContent = "Refresh";
  refreshBtn.appendChild(refreshLabel);
  refreshBtn.addEventListener("click", () => fetchAllData());
  filterChipsGroup.appendChild(refreshBtn);

  header.appendChild(filterChipsGroup);

  // Stale banner container
  const bannerContainer = document.createElement("div");
  bannerContainer.id = "dashboard-banner-container";

  // Bento Grid Container
  const bentoGrid = document.createElement("div");
  bentoGrid.className = "bento-grid";

  // ── ROW 1: Hero Requests Chart (8 cols) + Service Health (4 cols) ──
  // Hero Requests Card
  const reqCard = document.createElement("div");
  reqCard.className = "card bento-col-8";
  const reqHeader = document.createElement("div");
  reqHeader.className = "card-header";
  const reqTitle = document.createElement("h2");
  reqTitle.className = "card-title";
  reqTitle.textContent = "Requests & Errors";
  reqHeader.appendChild(reqTitle);
  reqCard.appendChild(reqHeader);

  const reqWrapper = document.createElement("div");
  reqWrapper.className = "chart-container";
  const reqCanvas = document.createElement("canvas");
  reqCanvas.id = "chart-requests";
  reqCanvas.setAttribute("role", "img");
  reqCanvas.setAttribute("aria-label", "Chart of requests with hatched fill and errors over time");
  reqWrapper.appendChild(reqCanvas);
  reqCard.appendChild(reqWrapper);

  // Service Health Breakdown Card
  const healthCard = document.createElement("div");
  healthCard.className = "card bento-col-4";
  const healthHeader = document.createElement("div");
  healthHeader.className = "card-header";
  const healthTitle = document.createElement("h2");
  healthTitle.className = "card-title";
  healthTitle.textContent = "Service Health";
  healthHeader.appendChild(healthTitle);
  healthCard.appendChild(healthHeader);

  const healthBody = document.createElement("div");
  healthBody.id = "dashboard-health-body";
  healthBody.appendChild(makeSkeleton("skeleton-text--lg mb-3"));
  healthBody.appendChild(makeSkeleton("skeleton-text--lg mb-3"));
  healthCard.appendChild(healthBody);

  bentoGrid.appendChild(reqCard);
  bentoGrid.appendChild(healthCard);

  // ── ROW 2: Latency Chart (4 cols) + Insight Tile (4 cols) + Dot-Matrix KPI Tiles (4 cols) ──
  // Latency Chart Card
  const latCard = document.createElement("div");
  latCard.className = "card bento-col-4";
  const latHeader = document.createElement("div");
  latHeader.className = "card-header";
  const latTitle = document.createElement("h2");
  latTitle.className = "card-title";
  latTitle.textContent = "Latency (p50 / p95)";
  latHeader.appendChild(latTitle);
  latCard.appendChild(latHeader);

  const latWrapper = document.createElement("div");
  latWrapper.className = "chart-container";
  const latCanvas = document.createElement("canvas");
  latCanvas.id = "chart-latency";
  latCanvas.setAttribute("role", "img");
  latCanvas.setAttribute("aria-label", "Stepped line chart of latency p50 and p95 over time");
  latWrapper.appendChild(latCanvas);
  latCard.appendChild(latWrapper);

  // Insight Tile Card
  const insightContainer = document.createElement("div");
  insightContainer.className = "bento-col-4";
  insightContainer.id = "dashboard-insight-container";
  renderInsightTile(insightContainer, {
    pct: 100,
    summaryText: "Telemetry normal across all monitored service endpoints.",
  });

  // KPI Slot for Requests/min & Active Users
  const matrixKpiCol = document.createElement("div");
  matrixKpiCol.className = "bento-col-4";
  matrixKpiCol.id = "dashboard-matrix-kpis";

  bentoGrid.appendChild(latCard);
  bentoGrid.appendChild(insightContainer);
  bentoGrid.appendChild(matrixKpiCol);

  // ── ROW 3: Remaining KPI Cards ──
  const remainingKpiContainer = document.createElement("div");
  remainingKpiContainer.className = "bento-col-12";
  const remainingKpiGrid = document.createElement("div");
  remainingKpiGrid.className = "bento-grid";
  remainingKpiGrid.id = "dashboard-remaining-kpis";
  remainingKpiContainer.appendChild(remainingKpiGrid);
  bentoGrid.appendChild(remainingKpiContainer);

  // Initial Skeletons for KPIs
  KPI_DEFS.forEach((def) => {
    const sk = document.createElement("div");
    sk.className = "kpi-tile bento-col-4";
    sk.appendChild(makeSkeleton("skeleton-text--sm"));
    sk.appendChild(makeSkeleton("skeleton-text--lg mt-2"));
    sk.appendChild(makeSkeleton("skeleton-text--sm mt-2"));
    remainingKpiGrid.appendChild(sk);
  });

  // ── Monitored Services Grid Section ──
  const servicesSection = document.createElement("div");
  servicesSection.className = "mt-6";

  const servicesHeader = document.createElement("div");
  servicesHeader.className = "page-header";
  const servicesTitle = document.createElement("h2");
  servicesTitle.className = "card-title";
  servicesTitle.style.fontSize = "var(--text-xl)";
  servicesTitle.textContent = "Monitored Services";
  const servicesSubtitle = document.createElement("span");
  servicesSubtitle.className = "text-sm text-muted";
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
  container.appendChild(bannerContainer);
  container.appendChild(bentoGrid);
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

  // Popover closer
  document.addEventListener("click", (e) => {
    if (activePopover && !activePopover.contains(e.target) && !e.target.closest(".card-info-btn")) {
      activePopover.remove();
      activePopover = null;
    }
  });

  // Main fetch function
  async function fetchAllData() {
    refreshBtn.disabled = true;
    try {
      const [overviewData, historyData, servicesData, incidentsData] = await Promise.all([
        apiGet(`/metrics/overview?range=${currentRange}&product=${currentProduct}`, { viewKey: "dash-overview" }),
        apiGet(`/metrics/history?range=${currentRange}&product=${currentProduct}`, { viewKey: "dash-history" }),
        apiGet(`/services?product=${currentProduct}&page_size=100`, { viewKey: "dash-services" }),
        apiGet(`/incidents?status=open&limit=100`, { viewKey: "dash-open-inc" }).catch(() => ({ items: [] })),
      ]);

      renderKPIs(overviewData, historyData);
      renderCharts(historyData);
      renderHealthCard(servicesData);
      renderInsight(servicesData, incidentsData);
      renderServicesList(servicesData);
      checkStaleStatus(overviewData);

      const now = new Date();
      updatedText.textContent = `Updated ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
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

  function renderKPIs(overviewData, historyData) {
    matrixKpiCol.textContent = "";
    remainingKpiGrid.textContent = "";

    const points = Array.isArray(historyData?.points) ? historyData.points : [];
    const reqValues = points.map((p) => p.requests || 0);
    const userValues = points.map((p) => p.requests || 0); // activity correlated with request points

    // Find peak time
    let maxReq = 0;
    let peakReqTime = "";
    points.forEach((p) => {
      if ((p.requests || 0) > maxReq) {
        maxReq = p.requests;
        const d = new Date(p.bucket_start);
        if (!isNaN(d)) peakReqTime = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    });

    KPI_DEFS.forEach((def) => {
      const card = document.createElement("div");
      card.className = "kpi-tile";

      const topRow = document.createElement("div");
      topRow.className = "kpi-tile-header";

      const label = document.createElement("span");
      label.className = "kpi-tile-label";
      label.textContent = def.label;

      const infoBtn = document.createElement("button");
      infoBtn.type = "button";
      infoBtn.className = "card-info-btn";
      infoBtn.setAttribute("aria-label", `Formula info for ${def.label}`);
      infoBtn.appendChild(iconInfo(14));

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

      topRow.appendChild(label);
      topRow.appendChild(infoBtn);

      const rawVal = overviewData ? overviewData[def.key] : null;
      const bodyRow = document.createElement("div");
      bodyRow.className = "kpi-tile-body";

      const valSpan = document.createElement("div");
      valSpan.className = "kpi-number";
      valSpan.textContent = def.fmt(rawVal);

      bodyRow.appendChild(valSpan);

      // If dot matrix tile (req_min or active_users)
      if (def.isDotMatrix) {
        const matrixContainer = document.createElement("div");
        const histData = def.key === "req_min" ? reqValues : userValues;
        renderDotMatrix(matrixContainer, histData, peakReqTime, def.dotColor || "blue");
        bodyRow.appendChild(matrixContainer);
      }

      const footer = document.createElement("div");
      footer.className = "kpi-tile-footer";
      const subSpan = document.createElement("span");
      subSpan.textContent = def.sub;
      footer.appendChild(subSpan);

      card.appendChild(topRow);
      card.appendChild(bodyRow);
      card.appendChild(footer);

      if (def.key === "req_min" || def.key === "active_users") {
        card.style.marginBottom = "var(--space-4)";
        matrixKpiCol.appendChild(card);
      } else {
        card.className = "kpi-tile bento-col-4";
        remainingKpiGrid.appendChild(card);
      }
    });
  }

  function renderHealthCard(servicesData) {
    const items = Array.isArray(servicesData?.items) ? servicesData.items : [];
    const counts = { healthy: 0, slow: 0, failing: 0, stale: 0, total: items.length };

    items.forEach((svc) => {
      const s = String(svc.status || "").toLowerCase();
      if (s === "healthy" || s === "green") counts.healthy++;
      else if (s === "slow") counts.slow++;
      else if (s === "failing" || s === "red") counts.failing++;
      else counts.stale++;
    });

    renderHealthBreakdown(healthBody, counts);
  }

  function renderInsight(servicesData, incidentsData) {
    const items = Array.isArray(servicesData?.items) ? servicesData.items : [];
    const openIncs = Array.isArray(incidentsData?.items) ? incidentsData.items.length : 0;
    const total = items.length;
    let healthyCount = 0;

    items.forEach((s) => {
      const st = String(s.status || "").toLowerCase();
      if (st === "healthy" || st === "green") healthyCount++;
    });

    const pct = total > 0 ? Math.round((healthyCount / total) * 100) : 100;
    const summaryText = `${pct}% of services healthy across ${total} monitored endpoints with ${openIncs} active incident${openIncs === 1 ? "" : "s"}.`;

    renderInsightTile(insightContainer, { pct, summaryText });
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
    const gridColor = isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)";
    const textColor = isDark ? "#9CA3AF" : "#575E6C";
    const accentBlue = isDark ? "#3B82F6" : "#2F54EB";
    const accentPink = isDark ? "#F472B6" : "#E5539B";

    const totalReqs = points.reduce((sum, p) => sum + (p.requests || 0), 0);
    const totalErrs = points.reduce((sum, p) => sum + (p.errors || 0), 0);
    reqCanvas.setAttribute("aria-label", `Bar and line chart of requests and errors over time. Total requests: ${totalReqs}, Total errors: ${totalErrs}.`);
    latCanvas.setAttribute("aria-label", `Stepped line chart of latency percentiles over ${points.length} minute intervals.`);

    // 1. Requests (diagonal-hatch bars) & Errors (accent line)
    const reqCtx = reqCanvas.getContext("2d");
    const hatchPattern = createHatchPattern(reqCtx, accentBlue, isDark ? "rgba(59, 130, 246, 0.12)" : "rgba(47, 84, 235, 0.08)");

    _reqChart = new window.Chart(reqCtx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Requests",
            data: points.map((p) => p.requests),
            backgroundColor: hatchPattern,
            hoverBackgroundColor: accentBlue,
            borderColor: accentBlue,
            borderWidth: 1,
            borderRadius: 4,
          },
          {
            type: "line",
            label: "Errors",
            data: points.map((p) => p.errors),
            borderColor: "#E5484D",
            backgroundColor: "rgba(229, 72, 77, 0.15)",
            borderWidth: 2,
            tension: 0.1,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor, font: { size: 12, family: "-apple-system, sans-serif" } } },
          tooltip: {
            mode: "index",
            intersect: false,
            backgroundColor: isDark ? "#17181C" : "#FFFFFF",
            titleColor: isDark ? "#F3F4F6" : "#0B0B0F",
            bodyColor: isDark ? "#D1D5DB" : "#374151",
            borderColor: isDark ? "#23242A" : "#ECECEE",
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
          },
        },
        scales: {
          x: {
            grid: { color: gridColor, drawOnChartArea: true },
            ticks: { color: textColor, maxTicksLimit: 8 },
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor },
            beginAtZero: true,
          },
        },
      },
    });

    // 2. Latency p50 / p95 stepped lines
    const latCtx = latCanvas.getContext("2d");
    _latChart = new window.Chart(latCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "p50 (ms)",
            data: points.map((p) => p.p50),
            borderColor: isDark ? "#4ADE80" : "#22B573",
            backgroundColor: "transparent",
            stepped: "before",
            borderWidth: 2,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
          {
            label: "p95 (ms)",
            data: points.map((p) => p.p95),
            borderColor: accentPink,
            backgroundColor: "transparent",
            stepped: "before",
            borderWidth: 2,
            pointRadius: labels.length > 60 ? 0 : 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor, font: { size: 12, family: "-apple-system, sans-serif" } } },
          tooltip: {
            mode: "index",
            intersect: false,
            backgroundColor: isDark ? "#17181C" : "#FFFFFF",
            titleColor: isDark ? "#F3F4F6" : "#0B0B0F",
            bodyColor: isDark ? "#D1D5DB" : "#374151",
            borderColor: isDark ? "#23242A" : "#ECECEE",
            borderWidth: 1,
            padding: 10,
            cornerRadius: 10,
          },
        },
        scales: {
          x: {
            grid: { color: gridColor, drawOnChartArea: true },
            ticks: { color: textColor, maxTicksLimit: 6 },
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor },
            beginAtZero: true,
          },
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
      errLabel.textContent = "Error Rate:";
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

  // Initial load
  fetchAllData();

  // Polling
  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchAllData();
    },
  });
  _poller.start();
}
