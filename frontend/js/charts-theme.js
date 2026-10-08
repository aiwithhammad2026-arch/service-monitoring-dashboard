/**
 * charts-theme.js — Chart.js styling, patterns, dot-matrix tiles, and health bars.
 *
 * All visualization complies with the soft bento design DNA:
 *  - Diagonal-hatch canvas patterns for request bars
 *  - Stepped lines for latency p50 / p95
 *  - Dot-matrix mini histograms for KPI tiles
 *  - Hatched pill bars for service health breakdown
 *  - Gradient insight tile with dark scrim for contrast >= 4.5:1
 */

/**
 * Build a diagonal-hatch CanvasPattern.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} strokeColor
 * @param {string} [bgColor]
 * @returns {CanvasPattern|string}
 */
export function createHatchPattern(ctx, strokeColor = "#2F54EB", bgColor = "rgba(47, 84, 235, 0.08)") {
  const patternCanvas = document.createElement("canvas");
  patternCanvas.width = 10;
  patternCanvas.height = 10;
  const pctx = patternCanvas.getContext("2d");
  if (!pctx) return strokeColor;

  if (bgColor) {
    pctx.fillStyle = bgColor;
    pctx.fillRect(0, 0, 10, 10);
  }

  pctx.strokeStyle = strokeColor;
  pctx.lineWidth = 1.5;
  pctx.beginPath();
  pctx.moveTo(0, 10);
  pctx.lineTo(10, 0);
  pctx.moveTo(-2, 2);
  pctx.lineTo(2, -2);
  pctx.moveTo(8, 12);
  pctx.lineTo(12, 8);
  pctx.stroke();

  return ctx.createPattern(patternCanvas, "repeat") || strokeColor;
}

/**
 * Render a dot-matrix mini histogram (columns of dots) for KPI tiles.
 * @param {HTMLElement} container
 * @param {Array<number>} values
 * @param {string} [peakTime]
 * @param {"blue"|"green"} [colorScheme]
 */
export function renderDotMatrix(container, values = [], peakTime = "", colorScheme = "blue") {
  container.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "dot-matrix-wrap";

  const matrix = document.createElement("div");
  matrix.className = `dot-matrix dot-matrix--${colorScheme}`;

  // Take the most recent 12 to 16 buckets
  const subset = values.slice(-14);
  const maxVal = Math.max(...subset, 1);
  const maxRows = 4;

  subset.forEach((val) => {
    const col = document.createElement("div");
    col.className = "dot-col";
    const activeCount = Math.max(1, Math.min(maxRows, Math.round((val / maxVal) * maxRows)));

    for (let r = maxRows; r >= 1; r--) {
      const dot = document.createElement("span");
      dot.className = `dot ${r <= activeCount ? "dot--active" : "dot--inactive"}`;
      col.appendChild(dot);
    }
    matrix.appendChild(col);
  });

  wrap.appendChild(matrix);

  if (peakTime) {
    const peakChip = document.createElement("span");
    peakChip.className = "peak-chip";
    peakChip.textContent = `Peak: ${peakTime}`;
    wrap.appendChild(peakChip);
  }

  container.appendChild(wrap);
}

/**
 * Render the Service Health breakdown card contents.
 * @param {HTMLElement} container
 * @param {{ healthy: number, slow: number, failing: number, stale: number, total: number }} counts
 */
export function renderHealthBreakdown(container, counts) {
  container.textContent = "";

  const total = Math.max(1, counts.total || (counts.healthy + counts.slow + counts.failing + counts.stale));

  const items = [
    {
      label: "Healthy",
      count: counts.healthy || 0,
      pct: Math.round(((counts.healthy || 0) / total) * 100),
      type: "healthy",
    },
    {
      label: "Failing / Slow",
      count: (counts.failing || 0) + (counts.slow || 0),
      pct: Math.round((((counts.failing || 0) + (counts.slow || 0)) / total) * 100),
      type: "failing",
    },
    {
      label: "Stale / No data",
      count: counts.stale || 0,
      pct: Math.round(((counts.stale || 0) / total) * 100),
      type: "stale",
    },
  ];

  const list = document.createElement("div");
  list.className = "health-bar-list";

  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "health-bar-row";

    const topInfo = document.createElement("div");
    topInfo.className = "health-bar-info";

    const labelSpan = document.createElement("span");
    labelSpan.className = "health-bar-label";
    labelSpan.textContent = item.label;

    const countSpan = document.createElement("span");
    countSpan.className = "health-bar-count";
    countSpan.textContent = `${item.count} (${item.pct}%)`;

    topInfo.appendChild(labelSpan);
    topInfo.appendChild(countSpan);

    const track = document.createElement("div");
    track.className = "health-pill-track";

    const fill = document.createElement("div");
    fill.className = `health-pill-fill health-pill-fill--${item.type}`;
    fill.style.width = `${Math.max(item.count > 0 ? 4 : 0, item.pct)}%`;

    track.appendChild(fill);
    row.appendChild(topInfo);
    row.appendChild(track);
    list.appendChild(row);
  });

  container.appendChild(list);
}

/**
 * Render the Gradient Insight Tile.
 * @param {HTMLElement} container
 * @param {{ pct: number, summaryText: string }} data
 */
export function renderInsightTile(container, { pct = 100, summaryText = "" }) {
  container.textContent = "";

  const tile = document.createElement("div");
  tile.className = "insight-tile";

  const scrim = document.createElement("div");
  scrim.className = "insight-scrim";

  const header = document.createElement("div");
  header.className = "insight-header";

  const tag = document.createElement("span");
  tag.className = "insight-tag";
  tag.textContent = "✦ Insights";

  header.appendChild(tag);

  const bigNum = document.createElement("div");
  bigNum.className = "insight-percentage";
  bigNum.textContent = `${pct}%`;

  const desc = document.createElement("p");
  desc.className = "insight-text";
  desc.textContent = summaryText;

  scrim.appendChild(header);
  scrim.appendChild(bigNum);
  scrim.appendChild(desc);
  tile.appendChild(scrim);

  container.appendChild(tile);
}
