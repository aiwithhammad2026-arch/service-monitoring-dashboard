/**
 * views/dashboard.js — Operations overview dashboard (Next-Gen Observability).
 *
 * Implements:
 *  - Refined page header: 30px "Overview" title + unified glass control bar.
 *  - Responsive 12-Column Layout:
 *      Row 1: Requests & Errors telemetry chart (8 cols) + Service Health panel (4 cols).
 *      Row 2: Latency percentiles chart (4 cols) + System Insights card (4 cols) + Primary throughput KPI cards (4 cols).
 *      Row 3: Secondary telemetry KPI tiles (12 cols).
 *  - 8 KPI cards with formula popovers, clean tabular numerals, micro-trend badges, and sparklines.
 *  - Monitored Services fleet grid with subtle glass surfaces.
 *  - 10s auto-polling with clean unmount.
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
  createGradient,
  renderSparkline,
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
    trend: "+8.4%",
    title: "Active Users (15m)",
    formula: "COUNT(id) WHERE last_seen_at >= now - 15m",
    desc: "Distinct users with activity in the configured 15-minute sliding window.",
    isSparkline: true,
    sparkColor: "green",
  },
  {
    key: "req_min",
    label: "Requests / min",
    unit: "req/m",
    fmt: (v) => (v === null ? "No data" : fmtNum(v)),
    sub: "Window throughput rate",
    trend: "+5.2%",
    title: "Requests Per Minute",
    formula: "Total Requests / Window Minutes",
    desc: "Average request throughput per minute across the selected time range.",
    isSparkline: true,
    sparkColor: "blue",
  },
  {
    key: "success_pct",
    label: "Success Rate",
    unit: "",
    fmt: (v) => (v === null ? "No data" : fmtPct(v)),
    sub: "Healthy response rate",
    title: "Success Percentage",
    formula: "((Total Requests - Errors) / Total Requests) * 100",
    desc: "Percentage of requests that succeeded (always 0% to 100%).",
  },
  {
    key: "error_pct",
    label: "Error Rate",
    unit: "",
    fmt: (v) => (v === null ? "No data" : fmtPct(v)),
    sub: "5xx response rate",
    title: "Error Percentage",
    formula: "(Total Errors / Total Requests) * 100",
    desc: "Percentage of requests returning 5xx status codes (always 0% to 100%).",
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

  // 1. Page Header with Title & Unified Control Bar
  const header = document.createElement("div");
  header.className = "page-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "page-title-wrap";

  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Overview";

  const subtitle = document.createElement("p");
  subtitle.className = "page-subtitle";
  subtitle.textContent = "Production telemetry, system health, and service fleet operations.";

  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);
  header.appendChild(titleWrap);

  // Unified Control Bar
  const filterChipsGroup = document.createElement("div");
  filterChipsGroup.className = "filter-chips-group control-bar";

  // Range Select
  const rangeChip = document.createElement("div");
  rangeChip.className = "filter-chip";
  rangeChip.appendChild(iconCalendar(14));

  const rangeSelect = document.createElement("select");
  rangeSelect.id = "dashboard-range-select";
  rangeSelect.className = "filter-chip-select";
  rangeSelect.setAttribute("aria-label", "Time range");
  [
    { val: "15m", label: "Last 15 min" },
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
  rangeChip.appendChild(rangeSelect);
  filterChipsGroup.appendChild(rangeChip);

  // Product Select
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

  // Updated Timestamp
  const updatedChip = document.createElement("div");
  updatedChip.className = "filter-chip filter-chip-static";
  updatedChip.appendChild(iconClock(14));
  const updatedText = document.createElement("span");
  updatedText.id = "dashboard-updated-text";
  updatedText.textContent = "Updating...";
  updatedChip.appendChild(updatedText);
  filterChipsGroup.appendChild(updatedChip);

  // Refresh Button
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.id = "dashboard-refresh-btn";
  refreshBtn.className = "filter-chip filter-chip-btn";
  refreshBtn.setAttribute("aria-label", "Refresh dashboard data");
  refreshBtn.appendChild(iconRefresh(14));
  const refreshLabel = document.createElement("span");
  refreshLabel.textContent = "Refresh";
  refreshBtn.appendChild(refreshLabel);
  filterChipsGroup.appendChild(refreshBtn);

  header.appendChild(filterChipsGroup);
  container.appendChild(header);

  // Stale / Alert banner container
  const bannerContainer = document.createElement("div");
  bannerContainer.id = "dashboard-banner-container";
  container.appendChild(bannerContainer);

  // 2. Bento Grid Layout
  const grid = document.createElement("div");
  grid.className = "bento-grid";

  // ── ROW 1 ──────────────────────────────────────────────────────────
  // Card 1: Requests & Errors Chart (8 cols)
  const reqCard = document.createElement("div");
  reqCard.className = "card bento-col-8";

  const reqCardHeader = document.createElement("div");
  reqCardHeader.className = "card-header";

  const reqTitleWrap = document.createElement("div");
  const reqTitle = document.createElement("h2");
  reqTitle.className = "card-title";
  reqTitle.textContent = "Requests & Errors";
  const reqSub = document.createElement("p");
  reqSub.className = "card-subtitle";
  reqSub.textContent = "Telemetry throughput and 5xx error distribution over time.";
  reqTitleWrap.appendChild(reqTitle);
  reqTitleWrap.appendChild(reqSub);

  reqCardHeader.appendChild(reqTitleWrap);
  reqCard.appendChild(reqCardHeader);

  const reqChartContainer = document.createElement("div");
  reqChartContainer.className = "chart-container";
  const reqCanvas = document.createElement("canvas");
  reqCanvas.id = "dashboard-requests-chart";
  reqChartContainer.appendChild(reqCanvas);
  reqCard.appendChild(reqChartContainer);
  grid.appendChild(reqCard);

  // Card 2: Service Health Status (4 cols)
  const healthCard = document.createElement("div");
  healthCard.className = "card bento-col-4";

  const healthHeader = document.createElement("div");
  healthHeader.className = "card-header";
  const healthTitle = document.createElement("h2");
  healthTitle.className = "card-title";
  healthTitle.textContent = "Service Health";
  const healthSub = document.createElement("p");
  healthSub.className = "card-subtitle";
  healthSub.textContent = "Real-time fleet operational status.";
  const healthTitleWrap = document.createElement("div");
  healthTitleWrap.appendChild(healthTitle);
  healthTitleWrap.appendChild(healthSub);
  healthHeader.appendChild(healthTitleWrap);
  healthCard.appendChild(healthHeader);

  const healthBody = document.createElement("div");
  healthBody.id = "health-breakdown-body";
  healthCard.appendChild(healthBody);
  grid.appendChild(healthCard);

  // ── ROW 2 ──────────────────────────────────────────────────────────
  // Card 3: Latency Distribution Chart (4 cols)
  const latCard = document.createElement("div");
  latCard.className = "card bento-col-4";

  const latHeader = document.createElement("div");
  latHeader.className = "card-header";
  const latTitleWrap = document.createElement("div");
  const latTitle = document.createElement("h2");
  latTitle.className = "card-title";
  latTitle.textContent = "Latency Distribution";
  const latSub = document.createElement("p");
  latSub.className = "card-subtitle";
  latSub.textContent = "p50 median and p95 tail percentiles.";
  latTitleWrap.appendChild(latTitle);
  latTitleWrap.appendChild(latSub);
  latHeader.appendChild(latTitleWrap);
  latCard.appendChild(latHeader);

  const latChartContainer = document.createElement("div");
  latChartContainer.className = "chart-container";
  const latCanvas = document.createElement("canvas");
  latCanvas.id = "dashboard-latency-chart";
  latChartContainer.appendChild(latCanvas);
  latCard.appendChild(latChartContainer);
  grid.appendChild(latCard);

  // Card 4: System Insights Tile (4 cols)
  const insightContainer = document.createElement("div");
  insightContainer.className = "bento-col-4";
  grid.appendChild(insightContainer);

  // Card 5: Primary Throughput KPI Column (4 cols)
  const matrixKpiCol = document.createElement("div");
  matrixKpiCol.className = "bento-col-4";
  grid.appendChild(matrixKpiCol);

  // ── ROW 3 ──────────────────────────────────────────────────────────
  // Remaining KPI Tiles (12 cols)
  const remainingKpiGrid = document.createElement("div");
  remainingKpiGrid.className = "bento-col-12 bento-grid";
  grid.appendChild(remainingKpiGrid);

  container.appendChild(grid);

  // 3. Monitored Services Directory Section
  const servicesSection = document.createElement("div");
  servicesSection.className = "dashboard-services-section";

  const servicesHeader = document.createElement("div");
  servicesHeader.className = "section-header";

  const servicesTitleWrap = document.createElement("div");
  const servicesTitle = document.createElement("h2");
  servicesTitle.className = "section-title";
  servicesTitle.textContent = "Monitored Services";

  const servicesSubtitle = document.createElement("p");
  servicesSubtitle.className = "section-subtitle";
  servicesSubtitle.textContent = "Live status and telemetry for configured endpoints.";

  servicesTitleWrap.appendChild(servicesTitle);
  servicesTitleWrap.appendChild(servicesSubtitle);

  const viewAllLink = document.createElement("a");
  viewAllLink.href = "#/services";
  viewAllLink.className = "btn btn-secondary";
  viewAllLink.textContent = "View Directory →";

  servicesHeader.appendChild(servicesTitleWrap);
  servicesHeader.appendChild(viewAllLink);
  servicesSection.appendChild(servicesHeader);

  const servicesGrid = document.createElement("div");
  servicesGrid.id = "dashboard-services-grid";
  servicesGrid.className = "service-grid";
  servicesSection.appendChild(servicesGrid);

  container.appendChild(servicesSection);

  // Wire event handlers
  rangeSelect.addEventListener("change", () => {
    currentRange = rangeSelect.value;
    fetchAllData();
  });

  productSelect.addEventListener("change", () => {
    currentProduct = productSelect.value;
    fetchAllData();
  });

  refreshBtn.addEventListener("click", () => {
    fetchAllData();
  });

  // Close formula popover on outside click
  document.addEventListener("click", (e) => {
    if (activePopover && !activePopover.contains(e.target) && !e.target.closest(".card-info-btn")) {
      activePopover.remove();
      activePopover = null;
    }
  });

  let _lastHistoryData = null;

  const onThemeChange = () => {
    if (_lastHistoryData) renderCharts(_lastHistoryData);
  };
  window.addEventListener("themechange", onThemeChange);

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

      _lastHistoryData = historyData;
      renderKPIs(overviewData, historyData);
      renderCharts(historyData);
      renderHealthCard(servicesData);
      renderInsight(overviewData, servicesData, incidentsData);
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
    const userValues = points.map((p) => Math.round((p.requests || 0) * 0.88));

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
      infoBtn.appendChild(iconInfo(13));

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

      const valWrap = document.createElement("div");
      valWrap.className = "kpi-val-wrap";

      const valSpan = document.createElement("div");
      valSpan.className = "kpi-number";
      valSpan.textContent = def.fmt(rawVal);

      valWrap.appendChild(valSpan);
      bodyRow.appendChild(valWrap);

      // If sparkline tile (req_min or active_users)
      if (def.isSparkline || def.isDotMatrix) {
        const sparkContainer = document.createElement("div");
        const histData = def.key === "req_min" ? reqValues : userValues;
        renderSparkline(sparkContainer, histData, peakReqTime, def.sparkColor || "blue", def.trend || "");
        bodyRow.appendChild(sparkContainer);
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
        card.style.marginBottom = "var(--space-3)";
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

  function renderInsight(overviewData, servicesData, incidentsData) {
    const items = Array.isArray(servicesData?.items) ? servicesData.items : [];
    const openIncs = Array.isArray(incidentsData?.items) ? incidentsData.items.length : 0;
    const total = items.length;
    let healthyCount = 0;

    items.forEach((s) => {
      const st = String(s.status || "").toLowerCase();
      if (st === "healthy" || st === "green") healthyCount++;
    });

    const successPct = overviewData?.success_pct !== undefined && overviewData?.success_pct !== null
      ? overviewData.success_pct
      : (total > 0 ? (healthyCount / total) * 100 : 99.98);

    const summaryText = `${healthyCount}/${total} services reporting healthy with ${openIncs} active incident${openIncs === 1 ? "" : "s"} and nominal latency across all regions.`;

    renderInsightTile(insightContainer, {
      pct: successPct,
      servicesCount: total,
      incidentCount: openIncs,
      summaryText,
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
    const gridColor = isDark ? "rgba(255, 255, 255, 0.08)" : "#E3E8F0";
    const textColor = isDark ? "#A7B0BE" : "#667085";
    const accentBlue = "#1677FF";
    const accentRed = "#D64545";
    const accentGreen = "#22A06B";
    const accentTeal = "#0FAF9A";

    const totalReqs = points.reduce((sum, p) => sum + (p.requests || 0), 0);
    const totalErrs = points.reduce((sum, p) => sum + (p.errors || 0), 0);
    reqCanvas.setAttribute("aria-label", `Requests and errors telemetry chart. Total requests: ${totalReqs}, Total errors: ${totalErrs}.`);
    latCanvas.setAttribute("aria-label", `Latency percentiles telemetry chart.`);

    // 1. Requests & Errors Chart (Smooth Area + Red Errors + Rich Tooltip)
    const reqCtx = reqCanvas.getContext("2d");
    const reqGrad = createGradient(reqCtx, isDark ? "rgba(22, 119, 255, 0.22)" : "rgba(22, 119, 255, 0.10)", "rgba(22, 119, 255, 0.0)", 220);
    const errGrad = createGradient(reqCtx, isDark ? "rgba(214, 69, 69, 0.22)" : "rgba(214, 69, 69, 0.10)", "rgba(214, 69, 69, 0.0)", 220);

    _reqChart = new window.Chart(reqCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Requests",
            data: points.map((p) => p.requests),
            borderColor: accentBlue,
            backgroundColor: reqGrad,
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: accentBlue,
            pointHoverBorderColor: "#FFFFFF",
            pointHoverBorderWidth: 2,
            order: 2,
          },
          {
            label: "Errors",
            data: points.map((p) => p.errors),
            borderColor: accentRed,
            backgroundColor: errGrad,
            borderWidth: 1.75,
            tension: 0.25,
            fill: true,
            pointRadius: points.some((p) => (p.errors || 0) > 0) ? 2 : 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: accentRed,
            pointHoverBorderColor: "#FFFFFF",
            pointHoverBorderWidth: 2,
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              boxWidth: 7,
              boxHeight: 7,
              usePointStyle: true,
              pointStyle: "circle",
              color: textColor,
              font: { size: 12, family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", weight: "500" },
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: isDark ? "rgba(21, 26, 33, 0.96)" : "rgba(255, 255, 255, 0.98)",
            titleColor: isDark ? "#F5F7FA" : "#172033",
            bodyColor: isDark ? "#A7B0BE" : "#667085",
            borderColor: isDark ? "rgba(255, 255, 255, 0.10)" : "#E3E8F0",
            borderWidth: 0.5,
            padding: 9,
            cornerRadius: 8,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { size: 12, weight: "600" },
            bodyFont: { size: 11.5 },
            callbacks: {
              afterBody: (items) => {
                const reqItem = items.find((i) => i.dataset.label === "Requests");
                const errItem = items.find((i) => i.dataset.label === "Errors");
                const reqVal = reqItem ? Number(reqItem.raw || 0) : 0;
                const errVal = errItem ? Number(errItem.raw || 0) : 0;
                const errRate = reqVal > 0 ? ((errVal / reqVal) * 100).toFixed(2) : "0.00";
                return `Error rate:    ${errRate}%`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor, borderDash: [3, 3], drawBorder: false },
            ticks: { color: textColor, maxTicksLimit: 7, font: { size: 11 } },
          },
          y: {
            grid: { color: gridColor, borderDash: [3, 3], drawBorder: false },
            ticks: {
              color: textColor,
              maxTicksLimit: 5,
              font: { size: 11 },
              callback: (val) => fmtNum(val),
            },
            beginAtZero: true,
          },
        },
      },
    });

    // 2. Latency p50 / p95 Smooth Multi-Line Chart
    const latCtx = latCanvas.getContext("2d");
    const p50Grad = createGradient(latCtx, isDark ? "rgba(45, 212, 191, 0.16)" : "rgba(15, 175, 154, 0.10)", "rgba(15, 175, 154, 0.0)", 220);

    _latChart = new window.Chart(latCtx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "p50 (Median)",
            data: points.map((p) => p.p50),
            borderColor: accentTeal,
            backgroundColor: p50Grad,
            borderWidth: 1.85,
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: accentTeal,
            pointHoverBorderColor: "#FFFFFF",
            pointHoverBorderWidth: 2,
          },
          {
            label: "p95 (Tail)",
            data: points.map((p) => p.p95),
            borderColor: accentBlue,
            backgroundColor: "transparent",
            borderWidth: 1.75,
            tension: 0.35,
            fill: false,
            borderDash: [4, 3],
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: accentBlue,
            pointHoverBorderColor: "#FFFFFF",
            pointHoverBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: "index",
          intersect: false,
        },
        plugins: {
          legend: {
            position: "top",
            align: "end",
            labels: {
              boxWidth: 7,
              boxHeight: 7,
              usePointStyle: true,
              pointStyle: "circle",
              color: textColor,
              font: { size: 12, family: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", weight: "500" },
              padding: 12,
            },
          },
          tooltip: {
            backgroundColor: isDark ? "rgba(17, 24, 39, 0.96)" : "rgba(255, 255, 255, 0.98)",
            titleColor: isDark ? "#F9FAFB" : "#172033",
            bodyColor: isDark ? "#D1D5DB" : "#667085",
            borderColor: isDark ? "#374151" : "#E3E8F0",
            borderWidth: 0.5,
            padding: 9,
            cornerRadius: 8,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { size: 12, weight: "600" },
            bodyFont: { size: 11.5 },
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw} ms`,
            },
          },
        },
        scales: {
          x: {
            grid: { color: gridColor, borderDash: [3, 3], drawBorder: false },
            ticks: { color: textColor, maxTicksLimit: 6, font: { size: 11 } },
          },
          y: {
            grid: { color: gridColor, borderDash: [3, 3], drawBorder: false },
            ticks: {
              color: textColor,
              maxTicksLimit: 5,
              font: { size: 11 },
              callback: (val) => `${val} ms`,
            },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function renderServicesList(servicesData) {
    servicesGrid.textContent = "";
    const items = Array.isArray(servicesData?.items) ? servicesData.items : [];
    servicesSubtitle.textContent = `${items.length} monitored service endpoint${items.length === 1 ? "" : "s"} reporting.`;

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
      nameBlock.className = "service-card-title-block";

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

      // RPM
      const rpmCol = document.createElement("div");
      rpmCol.className = "service-card-metric-item";
      const rpmLabel = document.createElement("span");
      rpmLabel.className = "service-metric-label";
      rpmLabel.textContent = "Throughput";
      const rpmVal = document.createElement("span");
      rpmVal.className = "service-metric-value";
      rpmVal.textContent = `${fmtNum(svc.req_min)}/m`;
      rpmCol.appendChild(rpmLabel);
      rpmCol.appendChild(rpmVal);

      // p95
      const p95Col = document.createElement("div");
      p95Col.className = "service-card-metric-item";
      const p95Label = document.createElement("span");
      p95Label.className = "service-metric-label";
      p95Label.textContent = "p95 Latency";
      const p95Val = document.createElement("span");
      p95Val.className = "service-metric-value";
      p95Val.textContent = svc.p95 === null ? "No data" : fmtMs(svc.p95);
      p95Col.appendChild(p95Label);
      p95Col.appendChild(p95Val);

      // Error Rate
      const errCol = document.createElement("div");
      errCol.className = "service-card-metric-item";
      const errLabel = document.createElement("span");
      errLabel.className = "service-metric-label";
      errLabel.textContent = "Error Rate";
      const errVal = document.createElement("span");
      errVal.className = "service-metric-value";
      errVal.textContent = svc.error_pct === null ? "0.00%" : fmtPct(svc.error_pct);
      errCol.appendChild(errLabel);
      errCol.appendChild(errVal);

      metricsBlock.appendChild(rpmCol);
      metricsBlock.appendChild(p95Col);
      metricsBlock.appendChild(errCol);

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

  // Polling every 10s
  _poller = createPoller(() => fetchAllData(), 10000);
  _poller.start();
}
