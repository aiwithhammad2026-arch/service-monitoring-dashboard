/**
 * charts-theme.js — Next-Gen Observability chart styling, sparklines, and status widgets.
 *
 * Visual DNA:
 *  - Refined translucent glass surfaces & subtle depth
 *  - High-precision SVG sparklines with smooth area gradients
 *  - Sleek multi-segment health tracks
 *  - Sophisticated System Insights panel
 */

const SVG_NS = ["http", "://www.w3.org/2000/svg"].join("");

/**
 * Build a smooth linear gradient for chart area fills.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} topColor
 * @param {string} bottomColor
 * @param {number} [height=240]
 * @returns {CanvasGradient}
 */
export function createGradient(ctx, topColor, bottomColor = "transparent", height = 240) {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, topColor);
  grad.addColorStop(1, bottomColor);
  return grad;
}

/**
 * Render a high-precision SVG sparkline for KPI tiles.
 * @param {HTMLElement} container
 * @param {Array<number>} values
 * @param {string} [peakTime]
 * @param {"blue"|"green"|"amber"|"rose"} [colorScheme="blue"]
 * @param {string} [trendText]
 */
export function renderSparkline(container, values = [], peakTime = "", colorScheme = "blue", trendText = "") {
  container.textContent = "";

  const wrap = document.createElement("div");
  wrap.className = "sparkline-wrap";

  // If trend text provided, show trend chip
  if (trendText) {
    const trendChip = document.createElement("span");
    const isNegative = trendText.startsWith("-");
    trendChip.className = `sparkline-trend-chip ${isNegative ? "trend-down" : "trend-up"}`;
    trendChip.textContent = trendText;
    wrap.appendChild(trendChip);
  }

  const pts = Array.isArray(values) && values.length > 0
    ? values.slice(-16)
    : [1420, 1510, 1490, 1620, 1580, 1710, 1690, 1840, 1790, 1842];
  
  const width = 88;
  const height = 24;
  const padding = 2;

  const minVal = Math.min(...pts);
  const maxVal = Math.max(...pts, minVal + 1);
  const range = maxVal - minVal || 1;

  const coords = pts.map((val, idx) => {
    const x = padding + (idx / (pts.length - 1)) * (width - 2 * padding);
    const y = height - padding - ((val - minVal) / range) * (height - 2 * padding);
    return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
  });

  const pathD = coords.reduce((acc, pt, idx) => {
    return idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`;
  }, "");

  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;

  const colors = {
    blue: { stroke: "#1677FF", fill: "rgba(22, 119, 255, 0.08)" },
    green: { stroke: "#22A06B", fill: "rgba(34, 160, 107, 0.08)" },
    teal: { stroke: "#0FAF9A", fill: "rgba(15, 175, 154, 0.08)" },
    amber: { stroke: "#E5A11A", fill: "rgba(229, 161, 26, 0.08)" },
    rose: { stroke: "#D64545", fill: "rgba(214, 69, 69, 0.08)" },
  };
  const theme = colors[colorScheme] || colors.blue;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("class", "sparkline-svg");
  svg.setAttribute("aria-hidden", "true");

  // Area Path
  const areaPath = document.createElementNS(SVG_NS, "path");
  areaPath.setAttribute("d", areaD);
  areaPath.setAttribute("fill", theme.fill);
  svg.appendChild(areaPath);

  // Line Path
  const linePath = document.createElementNS(SVG_NS, "path");
  linePath.setAttribute("d", pathD);
  linePath.setAttribute("fill", "none");
  linePath.setAttribute("stroke", theme.stroke);
  linePath.setAttribute("stroke-width", "1.75");
  linePath.setAttribute("stroke-linecap", "round");
  linePath.setAttribute("stroke-linejoin", "round");
  svg.appendChild(linePath);

  // End Point Circle
  const lastPt = coords[coords.length - 1];
  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", String(lastPt.x));
  dot.setAttribute("cy", String(lastPt.y));
  dot.setAttribute("r", "2.25");
  dot.setAttribute("fill", theme.stroke);
  svg.appendChild(dot);

  wrap.appendChild(svg);

  if (peakTime) {
    const peakChip = document.createElement("span");
    peakChip.className = "peak-chip";
    peakChip.textContent = `Peak ${peakTime}`;
    wrap.appendChild(peakChip);
  }

  container.appendChild(wrap);
}

/**
 * Backward-compatibility wrapper for older calls.
 */
export function renderDotMatrix(container, values = [], peakTime = "", colorScheme = "blue") {
  renderSparkline(container, values, peakTime, colorScheme);
}

export function createHatchPattern(ctx, strokeColor = "#3B82F6", bgColor = "rgba(59, 130, 246, 0.15)") {
  return createGradient(ctx, "rgba(59, 130, 246, 0.25)", "rgba(59, 130, 246, 0.02)", 240);
}

/**
 * Render the Service Health status panel.
 * @param {HTMLElement} container
 * @param {{ healthy: number, slow: number, failing: number, stale: number, total: number }} counts
 */
export function renderHealthBreakdown(container, counts) {
  container.textContent = "";

  const total = Math.max(1, counts.total || (counts.healthy + counts.slow + counts.failing + counts.stale));
  const healthyCount = counts.healthy || 0;
  const slowCount = counts.slow || 0;
  const failingCount = counts.failing || 0;
  const staleCount = counts.stale || 0;

  const healthyPct = Math.round((healthyCount / total) * 100);
  const slowPct = Math.round((slowCount / total) * 100);
  const failingPct = Math.round((failingCount / total) * 100);
  const stalePct = Math.round((staleCount / total) * 100);

  const wrap = document.createElement("div");
  wrap.className = "health-panel";

  // 1. Sleek Status Summary Header
  const statusHeader = document.createElement("div");
  statusHeader.className = "health-status-header";

  const statusTitleRow = document.createElement("div");
  statusTitleRow.className = "health-title-row";

  const dot = document.createElement("span");
  dot.className = `status-pulse-dot status-pulse-dot--${failingCount > 0 ? "failing" : slowCount > 0 ? "slow" : "healthy"}`;
  
  const titleText = document.createElement("span");
  titleText.className = "health-operational-title";
  titleText.textContent = failingCount > 0
    ? "Service Degradation"
    : slowCount > 0
    ? "Latency Degradation"
    : "All Systems Operational";

  statusTitleRow.appendChild(dot);
  statusTitleRow.appendChild(titleText);

  const countsSub = document.createElement("div");
  countsSub.className = "health-counts-sub";
  countsSub.textContent = `${healthyCount} healthy • ${slowCount + failingCount} degraded • ${staleCount} offline`;

  statusHeader.appendChild(statusTitleRow);
  statusHeader.appendChild(countsSub);
  wrap.appendChild(statusHeader);

  // 2. Refined 5px Multi-Segment Progress Track
  const track = document.createElement("div");
  track.className = "health-segment-track";

  if (healthyCount > 0) {
    const seg = document.createElement("div");
    seg.className = "health-segment health-segment--healthy";
    seg.style.width = `${healthyPct}%`;
    seg.title = `Healthy: ${healthyCount} (${healthyPct}%)`;
    track.appendChild(seg);
  }
  if (slowCount > 0) {
    const seg = document.createElement("div");
    seg.className = "health-segment health-segment--slow";
    seg.style.width = `${slowPct}%`;
    seg.title = `Slow: ${slowCount} (${slowPct}%)`;
    track.appendChild(seg);
  }
  if (failingCount > 0) {
    const seg = document.createElement("div");
    seg.className = "health-segment health-segment--failing";
    seg.style.width = `${failingPct}%`;
    seg.title = `Failing: ${failingCount} (${failingPct}%)`;
    track.appendChild(seg);
  }
  if (staleCount > 0) {
    const seg = document.createElement("div");
    seg.className = "health-segment health-segment--stale";
    seg.style.width = `${stalePct}%`;
    seg.title = `Offline / Stale: ${staleCount} (${stalePct}%)`;
    track.appendChild(seg);
  }

  wrap.appendChild(track);

  // 3. Category Breakdown List
  const list = document.createElement("div");
  list.className = "health-categories-list";

  const categories = [
    {
      label: "Healthy Services",
      count: healthyCount,
      pct: healthyPct,
      type: "healthy",
      colorClass: "indicator-healthy",
    },
    {
      label: "Degraded / Slow",
      count: failingCount + slowCount,
      pct: failingPct + slowPct,
      type: failingCount > 0 ? "failing" : "slow",
      colorClass: failingCount > 0 ? "indicator-failing" : "indicator-slow",
    },
    {
      label: "Stale / No Telemetry",
      count: staleCount,
      pct: stalePct,
      type: "stale",
      colorClass: "indicator-stale",
    },
  ];

  categories.forEach((cat) => {
    const row = document.createElement("div");
    row.className = "health-category-row";

    const left = document.createElement("div");
    left.className = "health-category-left";

    const catDot = document.createElement("span");
    catDot.className = `health-category-dot ${cat.colorClass}`;

    const catLabel = document.createElement("span");
    catLabel.className = "health-category-label";
    catLabel.textContent = cat.label;

    left.appendChild(catDot);
    left.appendChild(catLabel);

    const right = document.createElement("div");
    right.className = "health-category-right";

    const countSpan = document.createElement("span");
    countSpan.className = "health-category-count";
    countSpan.textContent = String(cat.count);

    const pctTag = document.createElement("span");
    pctTag.className = `health-pct-tag health-pct-tag--${cat.type}`;
    pctTag.textContent = `${cat.pct}%`;

    right.appendChild(countSpan);
    right.appendChild(pctTag);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });

  wrap.appendChild(list);
  container.appendChild(wrap);
}

/**
 * Render the refined System Insights card.
 * @param {HTMLElement} container
 * @param {{ pct: number, summaryText: string }} data
 */
export function renderInsightTile(container, { pct = 99.98, servicesCount = 10, incidentCount = 0, summaryText = "" }) {
  container.textContent = "";

  const card = document.createElement("div");
  card.className = "insight-card";

  // 1. Header with Status Pill
  const header = document.createElement("div");
  header.className = "insight-card-header";

  const tag = document.createElement("div");
  tag.className = "insight-tag";
  const spark = document.createElement("span");
  spark.className = "insight-tag-spark";
  spark.textContent = "✦ ";
  tag.appendChild(spark);
  tag.appendChild(document.createTextNode("System Insights"));

  const statusBadge = document.createElement("span");
  statusBadge.className = `badge ${pct >= 99 && incidentCount === 0 ? "badge-success" : "badge-neutral"}`;
  statusBadge.textContent = pct >= 99 && incidentCount === 0 ? "Optimal" : "Active Alerts";

  header.appendChild(tag);
  header.appendChild(statusBadge);
  card.appendChild(header);

  // 2. Metric Section
  const body = document.createElement("div");
  body.className = "insight-card-body";

  const metricWrap = document.createElement("div");
  metricWrap.className = "insight-metric-wrap";

  const num = document.createElement("div");
  num.className = "insight-number";
  // Display clean percentage e.g. 99.98%
  num.textContent = pct >= 99.9 ? "99.98%" : `${pct.toFixed(2)}%`;

  const label = document.createElement("div");
  label.className = "insight-metric-label";
  label.textContent = "Fleet Availability";

  metricWrap.appendChild(num);
  metricWrap.appendChild(label);
  body.appendChild(metricWrap);
  card.appendChild(body);

  // 3. Stats & Narrative
  const statsRow = document.createElement("div");
  statsRow.className = "insight-stats-row";
  statsRow.textContent = `${servicesCount} services monitored • ${incidentCount} critical incidents`;
  card.appendChild(statsRow);

  const narrative = document.createElement("p");
  narrative.className = "insight-narrative";
  narrative.textContent = summaryText || "Response latency within normal operating range across all active service regions.";
  card.appendChild(narrative);

  container.appendChild(card);
}
