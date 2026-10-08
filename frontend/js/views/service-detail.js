/**
 * views/service-detail.js — Service details view (Soft Bento DNA).
 */

import { apiGet, apiPut, apiPost } from "../api.js";
import { currentUser, showToast } from "../app.js";
import { createPoller } from "../poller.js";
import {
  makeStatusBadge,
  makeSkeleton,
  makeErrorState,
  fmtNum,
  fmtPct,
  fmtMs,
  fmtDatetime,
  setButtonLoading,
} from "../ui.js";
import { createGradient, createHatchPattern } from "../charts-theme.js";

let _poller = null;
let _reqChart = null;
let _latChart = null;

export function renderServiceDetail(serviceId, container) {
  if (_poller) {
    _poller.stop();
    _poller = null;
  }
  _destroyCharts();

  const target = container ?? document.getElementById("view-container");
  if (!target) return;
  target.textContent = "";

  // Back Link
  const backNav = document.createElement("div");
  backNav.className = "mb-4";
  const backLink = document.createElement("a");
  backLink.href = "#/services";
  backLink.className = "btn btn-secondary";
  backLink.textContent = "← Back to Services";
  backNav.appendChild(backLink);
  target.appendChild(backNav);

  // Content Layout
  const contentArea = document.createElement("div");
  contentArea.id = "service-detail-content";
  target.appendChild(contentArea);

  function renderLoading() {
    contentArea.textContent = "";
    const card = document.createElement("div");
    card.className = "card p-6";
    card.appendChild(makeSkeleton("skeleton-text--lg mb-4"));
    card.appendChild(makeSkeleton("skeleton-text mb-3"));
    card.appendChild(makeSkeleton("skeleton-text mb-3"));
    contentArea.appendChild(card);
  }

  async function fetchServiceData() {
    try {
      const [serviceRes, historyRes] = await Promise.all([
        apiGet(`/services/${encodeURIComponent(serviceId)}`, { viewKey: `svc-${serviceId}` }),
        apiGet(`/metrics/history?service_id=${encodeURIComponent(serviceId)}&range=1h`, { viewKey: `svc-hist-${serviceId}` }),
      ]);

      renderServiceView(serviceRes, historyRes);
    } catch (err) {
      if (err?.name === "StaleResponseError") return;
      contentArea.textContent = "";
      contentArea.appendChild(
        makeErrorState({
          msg: err.message || `Failed to load details for service "${serviceId}".`,
          onRetry: () => fetchServiceData(),
        })
      );
    }
  }

  function renderServiceView(serviceRes, historyRes) {
    const svc = serviceRes?.service;
    const thresholds = serviceRes?.thresholds;
    const simState = serviceRes?.sim_state;
    const incidents = serviceRes?.recent_incidents ?? [];

    contentArea.textContent = "";

    // 1. Service Header Card
    const headerCard = document.createElement("div");
    headerCard.className = "card mb-6";

    const topRow = document.createElement("div");
    topRow.className = "flex justify-between items-center flex-wrap gap-3";

    const titleBlock = document.createElement("div");
    const h1 = document.createElement("h1");
    h1.className = "page-title";
    h1.textContent = svc.name;

    const meta = document.createElement("div");
    meta.className = "text-sm text-muted flex gap-3";
    const prodSpan = document.createElement("span");
    prodSpan.textContent = `Product: ${svc.product.replace("_", " ")}`;
    const idSpan = document.createElement("span");
    idSpan.className = "font-mono";
    idSpan.textContent = `ID: ${svc.id}`;
    meta.appendChild(prodSpan);
    meta.appendChild(idSpan);

    titleBlock.appendChild(h1);
    titleBlock.appendChild(meta);

    const badge = makeStatusBadge(svc.status, svc.status_label);
    topRow.appendChild(titleBlock);
    topRow.appendChild(badge);
    headerCard.appendChild(topRow);

    if (svc.description) {
      const desc = document.createElement("p");
      desc.className = "text-sm text-muted mt-4";
      desc.textContent = svc.description;
      headerCard.appendChild(desc);
    }

    // Health explanation banner
    const explanation = document.createElement("div");
    explanation.className = "mt-4 p-3 rounded text-sm";
    explanation.style.background = "var(--sheet-bg)";
    explanation.style.border = "1px solid var(--border)";
    explanation.style.borderRadius = "var(--radius-chip)";
    explanation.setAttribute("role", "status");

    const expText = document.createElement("span");
    expText.className = "font-bold";
    expText.textContent = `Status: ${svc.status_label}. `;
    const reasonText = document.createElement("span");
    reasonText.textContent = svc.reason || "Operating normally within configured thresholds.";
    explanation.appendChild(expText);
    explanation.appendChild(reasonText);
    headerCard.appendChild(explanation);

    contentArea.appendChild(headerCard);

    // 2. KPI Tiles
    const kpiGrid = document.createElement("div");
    kpiGrid.className = "bento-grid mb-6";

    const kpis = [
      { label: "Req / min", val: fmtNum(svc.req_min), sub: "3-minute window average" },
      { label: "Error %", val: svc.error_pct === null ? "No data" : fmtPct(svc.error_pct), sub: `Threshold: ${thresholds?.max_error_pct}%` },
      { label: "p95 Latency", val: svc.p95 === null ? "No data" : fmtMs(svc.p95), sub: `Threshold: ${thresholds?.max_p95_ms}ms` },
      { label: "Last Bucket", val: fmtDatetime(svc.last_update), sub: `Stale after: ${thresholds?.stale_after_s}s` },
    ];

    kpis.forEach((kpi) => {
      const card = document.createElement("div");
      card.className = "kpi-tile bento-col-3";
      const lbl = document.createElement("div");
      lbl.className = "kpi-tile-label";
      lbl.textContent = kpi.label;
      const v = document.createElement("div");
      v.className = "kpi-number";
      v.textContent = kpi.val;
      const s = document.createElement("div");
      s.className = "kpi-tile-footer";
      s.textContent = kpi.sub;
      card.appendChild(lbl);
      card.appendChild(v);
      card.appendChild(s);
      kpiGrid.appendChild(card);
    });
    contentArea.appendChild(kpiGrid);

    // 3. Charts Section
    const chartsGrid = document.createElement("div");
    chartsGrid.className = "bento-grid mb-6";

    // Chart 1: Requests & Errors
    const reqCard = document.createElement("div");
    reqCard.className = "chart-card bento-col-6";
    const reqTitle = document.createElement("h2");
    reqTitle.className = "card-title";
    reqTitle.textContent = "Requests & Errors (Last 1 Hour)";
    reqCard.appendChild(reqTitle);
    const reqWrapper = document.createElement("div");
    reqWrapper.className = "chart-container";
    const reqCanvas = document.createElement("canvas");
    reqCanvas.id = `chart-svc-req-${serviceId}`;
    reqCanvas.setAttribute("role", "img");
    reqCanvas.setAttribute("aria-label", "Requests and errors timeseries for this service");
    reqWrapper.appendChild(reqCanvas);
    reqCard.appendChild(reqWrapper);

    // Chart 2: Latency
    const latCard = document.createElement("div");
    latCard.className = "chart-card bento-col-6";
    const latTitle = document.createElement("h2");
    latTitle.className = "card-title";
    latTitle.textContent = "Latency p50 & p95 (Last 1 Hour)";
    latCard.appendChild(latTitle);
    const latWrapper = document.createElement("div");
    latWrapper.className = "chart-container";
    const latCanvas = document.createElement("canvas");
    latCanvas.id = `chart-svc-lat-${serviceId}`;
    latCanvas.setAttribute("role", "img");
    latCanvas.setAttribute("aria-label", "Latency percentiles timeseries for this service");
    latWrapper.appendChild(latCanvas);
    latCard.appendChild(latWrapper);

    chartsGrid.appendChild(reqCard);
    chartsGrid.appendChild(latCard);
    contentArea.appendChild(chartsGrid);

    renderCharts(historyRes, reqCanvas, latCanvas);

    const onThemeChange = () => {
      if (document.body.contains(reqCanvas) && document.body.contains(latCanvas)) {
        renderCharts(historyRes, reqCanvas, latCanvas);
      }
    };
    window.addEventListener("themechange", onThemeChange);

    // 4. Recent Incidents Card
    const incCard = document.createElement("div");
    incCard.className = "card mb-6";
    const incHeader = document.createElement("div");
    incHeader.className = "card-header";
    const incTitle = document.createElement("h2");
    incTitle.className = "card-title";
    incTitle.textContent = "Recent Incidents";
    incHeader.appendChild(incTitle);
    incCard.appendChild(incHeader);

    if (incidents.length === 0) {
      const emptyInc = document.createElement("p");
      emptyInc.className = "text-sm text-muted";
      emptyInc.textContent = "No incidents recorded for this service.";
      incCard.appendChild(emptyInc);
    } else {
      const tableWrapper = document.createElement("div");
      tableWrapper.className = "table-wrapper";
      const table = document.createElement("table");
      const thead = document.createElement("thead");
      const hRow = document.createElement("tr");
      ["ID", "Type", "Status", "Opened At", "Resolved At", "Summary"].forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col;
        hRow.appendChild(th);
      });
      thead.appendChild(hRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      incidents.forEach((inc) => {
        const tr = document.createElement("tr");
        const idTd = document.createElement("td");
        idTd.className = "font-mono text-xs";
        idTd.textContent = `#${inc.id}`;
        const typeTd = document.createElement("td");
        typeTd.textContent = inc.type.replace("_", " ");
        const statusTd = document.createElement("td");
        statusTd.appendChild(makeStatusBadge(inc.status === "open" ? "failing" : inc.status === "recovered" ? "slow" : "healthy"));
        const openTd = document.createElement("td");
        openTd.className = "text-xs text-muted";
        openTd.textContent = fmtDatetime(inc.opened_at);
        const resTd = document.createElement("td");
        resTd.className = "text-xs text-muted";
        resTd.textContent = fmtDatetime(inc.resolved_at);
        const sumTd = document.createElement("td");
        sumTd.className = "text-sm";
        sumTd.textContent = inc.summary || "—";

        tr.appendChild(idTd);
        tr.appendChild(typeTd);
        tr.appendChild(statusTd);
        tr.appendChild(openTd);
        tr.appendChild(resTd);
        tr.appendChild(sumTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrapper.appendChild(table);
      incCard.appendChild(tableWrapper);
    }
    contentArea.appendChild(incCard);

    // 5. Admin Control Panel
    if (currentUser?.role === "admin") {
      renderAdminPanel(contentArea, thresholds, simState);
    }
  }

  function renderCharts(historyRes, reqCanvas, latCanvas) {
    const points = Array.isArray(historyRes?.points) ? historyRes.points : [];
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

    // 1. Requests & Errors Chart
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
            label: "Errors (5xx)",
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
        interaction: { mode: "index", intersect: false },
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
          },
        },
        scales: {
          x: { grid: { color: gridColor, borderDash: [3, 3], drawBorder: false }, ticks: { color: textColor, maxTicksLimit: 7, font: { size: 11 } } },
          y: { grid: { color: gridColor, borderDash: [3, 3], drawBorder: false }, ticks: { color: textColor, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => fmtNum(v) }, beginAtZero: true },
        },
      },
    });

    // 2. Latency Chart
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
        interaction: { mode: "index", intersect: false },
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
          x: { grid: { color: gridColor, borderDash: [3, 3], drawBorder: false }, ticks: { color: textColor, maxTicksLimit: 6, font: { size: 11 } } },
          y: { grid: { color: gridColor, borderDash: [3, 3], drawBorder: false }, ticks: { color: textColor, maxTicksLimit: 5, font: { size: 11 }, callback: (v) => `${v} ms` }, beginAtZero: true },
        },
      },
    });
  }

  function renderAdminPanel(parent, thresholds, simState) {
    const adminCard = document.createElement("div");
    adminCard.className = "card mb-6";
    adminCard.style.borderColor = "var(--border-strong)";

    const aHeader = document.createElement("div");
    aHeader.className = "card-header";
    const aTitle = document.createElement("h2");
    aTitle.className = "card-title";
    aTitle.textContent = "Admin Service Controls";
    const aBadge = document.createElement("span");
    aBadge.className = "badge badge-accent";
    aBadge.textContent = "Admin Only";
    aHeader.appendChild(aTitle);
    aHeader.appendChild(aBadge);
    adminCard.appendChild(aHeader);

    // Thresholds Form
    const threshForm = document.createElement("form");
    threshForm.className = "mb-6";

    const fGrid = document.createElement("div");
    fGrid.className = "bento-grid mb-4";

    // Max Error %
    const errGroup = document.createElement("div");
    errGroup.className = "form-group bento-col-4";
    const errLabel = document.createElement("label");
    errLabel.className = "form-label";
    errLabel.textContent = "Max Error % (0 - 100)";
    const errInput = document.createElement("input");
    errInput.type = "number";
    errInput.step = "0.1";
    errInput.min = "0";
    errInput.max = "100";
    errInput.required = true;
    errInput.className = "form-input";
    errInput.value = String(thresholds?.max_error_pct ?? 5.0);
    errGroup.appendChild(errLabel);
    errGroup.appendChild(errInput);

    // Max p95 ms
    const p95Group = document.createElement("div");
    p95Group.className = "form-group bento-col-4";
    const p95Label = document.createElement("label");
    p95Label.className = "form-label";
    p95Label.textContent = "Max p95 Latency (1 - 60000 ms)";
    const p95Input = document.createElement("input");
    p95Input.type = "number";
    p95Input.step = "10";
    p95Input.min = "1";
    p95Input.max = "60000";
    p95Input.required = true;
    p95Input.className = "form-input";
    p95Input.value = String(thresholds?.max_p95_ms ?? 800.0);
    p95Group.appendChild(p95Label);
    p95Group.appendChild(p95Input);

    // Stale after s
    const staleGroup = document.createElement("div");
    staleGroup.className = "form-group bento-col-4";
    const staleLabel = document.createElement("label");
    staleLabel.className = "form-label";
    staleLabel.textContent = "Stale After (30 - 3600 s)";
    const staleInput = document.createElement("input");
    staleInput.type = "number";
    staleInput.min = "30";
    staleInput.max = "3600";
    staleInput.required = true;
    staleInput.className = "form-input";
    staleInput.value = String(thresholds?.stale_after_s ?? 180);
    staleGroup.appendChild(staleLabel);
    staleGroup.appendChild(staleInput);

    fGrid.appendChild(errGroup);
    fGrid.appendChild(p95Group);
    fGrid.appendChild(staleGroup);
    threshForm.appendChild(fGrid);

    const saveThreshBtn = document.createElement("button");
    saveThreshBtn.type = "submit";
    saveThreshBtn.className = "btn btn-primary";
    saveThreshBtn.textContent = "Update Thresholds";
    threshForm.appendChild(saveThreshBtn);

    threshForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      setButtonLoading(saveThreshBtn, true);
      try {
        await apiPut(`/services/${encodeURIComponent(serviceId)}/thresholds`, {
          max_error_pct: parseFloat(errInput.value),
          max_p95_ms: parseFloat(p95Input.value),
          stale_after_s: parseInt(staleInput.value, 10),
        });
        showToast({ type: "success", title: "Success", msg: "Thresholds updated." });
        fetchServiceData();
      } catch (err) {
        showToast({ type: "error", title: "Error", msg: err.message || "Failed to update thresholds." });
      } finally {
        setButtonLoading(saveThreshBtn, false);
      }
    });

    adminCard.appendChild(threshForm);

    // Simulator Controls
    const simSection = document.createElement("div");
    simSection.style.borderTop = "1px solid var(--border)";
    simSection.className = "pt-4";

    const simTitle = document.createElement("h3");
    simTitle.className = "card-title mb-4";
    simTitle.textContent = "Simulator Injection Controls";
    simSection.appendChild(simTitle);

    const simControls = document.createElement("div");
    simControls.className = "flex gap-3 flex-wrap items-center";

    // Mode Selector
    const modeSelect = document.createElement("select");
    modeSelect.className = "form-select";
    modeSelect.style.width = "auto";
    ["normal", "slow", "failing", "recovering"].forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = `Mode: ${m}`;
      if (simState?.mode === m) opt.selected = true;
      modeSelect.appendChild(opt);
    });

    const setModeBtn = document.createElement("button");
    setModeBtn.type = "button";
    setModeBtn.className = "btn btn-secondary";
    setModeBtn.textContent = "Apply Mode";
    setModeBtn.addEventListener("click", async () => {
      setButtonLoading(setModeBtn, true);
      try {
        await apiPost(`/sim/${encodeURIComponent(serviceId)}/mode`, { mode: modeSelect.value });
        showToast({ type: "success", title: "Simulator Updated", msg: `Mode set to ${modeSelect.value}.` });
        fetchServiceData();
      } catch (err) {
        showToast({ type: "error", title: "Error", msg: err.message || "Failed to set simulator mode." });
      } finally {
        setButtonLoading(setModeBtn, false);
      }
    });

    // Traffic Pause Toggle
    const pauseTrafficBtn = document.createElement("button");
    pauseTrafficBtn.type = "button";
    pauseTrafficBtn.className = `btn ${simState?.paused ? "btn-danger" : "btn-secondary"}`;
    pauseTrafficBtn.textContent = simState?.paused ? "Resume Traffic" : "Pause Traffic (Zero Requests)";
    pauseTrafficBtn.addEventListener("click", async () => {
      setButtonLoading(pauseTrafficBtn, true);
      try {
        const nextPaused = !simState?.paused;
        await apiPost(`/sim/${encodeURIComponent(serviceId)}/pause`, { paused: nextPaused });
        showToast({ type: "info", title: "Simulator Updated", msg: nextPaused ? "Traffic paused." : "Traffic resumed." });
        fetchServiceData();
      } catch (err) {
        showToast({ type: "error", title: "Error", msg: err.message || "Failed to toggle traffic pause." });
      } finally {
        setButtonLoading(pauseTrafficBtn, false);
      }
    });

    // Reporting Pause Toggle
    const pauseReportingBtn = document.createElement("button");
    pauseReportingBtn.type = "button";
    pauseReportingBtn.className = `btn ${simState?.reporting_paused ? "btn-danger" : "btn-secondary"}`;
    pauseReportingBtn.textContent = simState?.reporting_paused ? "Resume Reporting" : "Pause Reporting (Induce Stale)";
    pauseReportingBtn.addEventListener("click", async () => {
      setButtonLoading(pauseReportingBtn, true);
      try {
        const nextRep = !simState?.reporting_paused;
        await apiPost(`/sim/${encodeURIComponent(serviceId)}/reporting`, { reporting_paused: nextRep });
        showToast({ type: "info", title: "Simulator Updated", msg: nextRep ? "Reporting paused." : "Reporting resumed." });
        fetchServiceData();
      } catch (err) {
        showToast({ type: "error", title: "Error", msg: err.message || "Failed to toggle reporting pause." });
      } finally {
        setButtonLoading(pauseReportingBtn, false);
      }
    });

    simControls.appendChild(modeSelect);
    simControls.appendChild(setModeBtn);
    simControls.appendChild(pauseTrafficBtn);
    simControls.appendChild(pauseReportingBtn);
    simSection.appendChild(simControls);

    adminCard.appendChild(simSection);
    parent.appendChild(adminCard);
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
  renderLoading();
  fetchServiceData();

  // Polling
  _poller = createPoller({
    intervalMs: 10000,
    onTick: async () => {
      await fetchServiceData();
    },
  });
  _poller.start();
}
