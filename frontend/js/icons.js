/**
 * icons.js — Safe SVG icon generator for Service Monitoring Dashboard.
 */

const SVG_NS = ["http", "://www.w3.org/2000/svg"].join("");

function makeSvg(size = 16, viewBox = "0 0 24 24", extraClass = "") {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (extraClass) svg.setAttribute("class", extraClass);
  return svg;
}

function makePath(d, attrs = {}) {
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  Object.entries(attrs).forEach(([k, v]) => path.setAttribute(k, v));
  return path;
}

function makeCircle(cx, cy, r, attrs = {}) {
  const circle = document.createElementNS(SVG_NS, "circle");
  circle.setAttribute("cx", String(cx));
  circle.setAttribute("cy", String(cy));
  circle.setAttribute("r", String(r));
  Object.entries(attrs).forEach(([k, v]) => circle.setAttribute(k, v));
  return circle;
}

function makeRect(x, y, w, h, rx = 0, attrs = {}) {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(w));
  rect.setAttribute("height", String(h));
  if (rx) rect.setAttribute("rx", String(rx));
  Object.entries(attrs).forEach(([k, v]) => rect.setAttribute(k, v));
  return rect;
}

let _logoIdCounter = 0;

export function iconLogo(size = 24) {
  _logoIdCounter++;
  const idPrefix = `smd-logo-${_logoIdCounter}`;
  const gradId = `${idPrefix}-grad`;
  const bgGradId = `${idPrefix}-bg`;
  const filterId = `${idPrefix}-glow`;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 32 32");
  svg.setAttribute("fill", "none");
  svg.setAttribute("class", "brand-logo-svg");
  svg.setAttribute("aria-hidden", "true");

  const defs = document.createElementNS(SVG_NS, "defs");

  // Linear gradient: Electric Cyan -> Telemetry Teal -> Glowing Emerald Green
  const grad = document.createElementNS(SVG_NS, "linearGradient");
  grad.setAttribute("id", gradId);
  grad.setAttribute("x1", "0%");
  grad.setAttribute("y1", "50%");
  grad.setAttribute("x2", "100%");
  grad.setAttribute("y2", "50%");

  const stop1 = document.createElementNS(SVG_NS, "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", "#00D2FF");

  const stop2 = document.createElementNS(SVG_NS, "stop");
  stop2.setAttribute("offset", "55%");
  stop2.setAttribute("stop-color", "#00E5C9");

  const stop3 = document.createElementNS(SVG_NS, "stop");
  stop3.setAttribute("offset", "100%");
  stop3.setAttribute("stop-color", "#10E599");

  grad.appendChild(stop1);
  grad.appendChild(stop2);
  grad.appendChild(stop3);
  defs.appendChild(grad);

  // Background deep navy-charcoal squircle gradient
  const bgGrad = document.createElementNS(SVG_NS, "linearGradient");
  bgGrad.setAttribute("id", bgGradId);
  bgGrad.setAttribute("x1", "0%");
  bgGrad.setAttribute("y1", "0%");
  bgGrad.setAttribute("x2", "100%");
  bgGrad.setAttribute("y2", "100%");

  const bgStop1 = document.createElementNS(SVG_NS, "stop");
  bgStop1.setAttribute("offset", "0%");
  bgStop1.setAttribute("stop-color", "#131927");

  const bgStop2 = document.createElementNS(SVG_NS, "stop");
  bgStop2.setAttribute("offset", "100%");
  bgStop2.setAttribute("stop-color", "#090D15");

  bgGrad.appendChild(bgStop1);
  bgGrad.appendChild(bgStop2);
  defs.appendChild(bgGrad);

  // Gaussian Blur Glow Filter
  const filter = document.createElementNS(SVG_NS, "filter");
  filter.setAttribute("id", filterId);
  filter.setAttribute("x", "-30%");
  filter.setAttribute("y", "-30%");
  filter.setAttribute("width", "160%");
  filter.setAttribute("height", "160%");

  const feBlur = document.createElementNS(SVG_NS, "feGaussianBlur");
  feBlur.setAttribute("stdDeviation", "1.6");
  feBlur.setAttribute("result", "blur");
  filter.appendChild(feBlur);
  defs.appendChild(filter);

  svg.appendChild(defs);

  // 1. Dark App Icon Squircle Container
  const bgRect = document.createElementNS(SVG_NS, "rect");
  bgRect.setAttribute("x", "0.75");
  bgRect.setAttribute("y", "0.75");
  bgRect.setAttribute("width", "30.5");
  bgRect.setAttribute("height", "30.5");
  bgRect.setAttribute("rx", "8.5");
  bgRect.setAttribute("fill", `url(#${bgGradId})`);
  bgRect.setAttribute("stroke", "rgba(255, 255, 255, 0.12)");
  bgRect.setAttribute("stroke-width", "0.75");
  svg.appendChild(bgRect);

  // Telemetry Waveform Path Definition
  const pulseD = "M 3.5 16.5 L 8 16.5 L 11.5 10 L 15.5 23.5 L 19.5 7.5 L 23.5 16.5 L 28.5 16.5";

  // 2. Soft Ambient Cyan/Teal Glow Aura Layer
  const glowLine = document.createElementNS(SVG_NS, "path");
  glowLine.setAttribute("d", pulseD);
  glowLine.setAttribute("fill", "none");
  glowLine.setAttribute("stroke", `url(#${gradId})`);
  glowLine.setAttribute("stroke-width", "4.2");
  glowLine.setAttribute("stroke-linecap", "round");
  glowLine.setAttribute("stroke-linejoin", "round");
  glowLine.setAttribute("opacity", "0.45");
  glowLine.setAttribute("filter", `url(#${filterId})`);
  svg.appendChild(glowLine);

  // 3. Crisp Foreground Pulse Waveform
  const pulseLine = document.createElementNS(SVG_NS, "path");
  pulseLine.setAttribute("d", pulseD);
  pulseLine.setAttribute("fill", "none");
  pulseLine.setAttribute("stroke", `url(#${gradId})`);
  pulseLine.setAttribute("stroke-width", "2.35");
  pulseLine.setAttribute("stroke-linecap", "round");
  pulseLine.setAttribute("stroke-linejoin", "round");
  svg.appendChild(pulseLine);

  // 4. Luminous Apex Bead / Node at Highest Peak
  const apexGlow = document.createElementNS(SVG_NS, "circle");
  apexGlow.setAttribute("cx", "19.5");
  apexGlow.setAttribute("cy", "7.5");
  apexGlow.setAttribute("r", "3.2");
  apexGlow.setAttribute("fill", "#10E599");
  apexGlow.setAttribute("opacity", "0.4");
  apexGlow.setAttribute("filter", `url(#${filterId})`);
  svg.appendChild(apexGlow);

  const apexDot = document.createElementNS(SVG_NS, "circle");
  apexDot.setAttribute("cx", "19.5");
  apexDot.setAttribute("cy", "7.5");
  apexDot.setAttribute("r", "2.1");
  apexDot.setAttribute("fill", "#10E599");
  svg.appendChild(apexDot);

  return svg;
}

export function iconDashboard(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeRect(3, 3, 7, 7, 1));
  svg.appendChild(makeRect(14, 3, 7, 7, 1));
  svg.appendChild(makeRect(14, 14, 7, 7, 1));
  svg.appendChild(makeRect(3, 14, 7, 7, 1));
  return svg;
}

export function iconServices(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeRect(2, 2, 20, 8, 2));
  svg.appendChild(makeRect(2, 14, 20, 8, 2));
  svg.appendChild(makePath("M6 6h.01M6 18h.01"));
  return svg;
}

export function iconIncidents(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"));
  svg.appendChild(makePath("M12 9v4M12 17h.01"));
  return svg;
}

export function iconAudit(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"));
  svg.appendChild(makePath("M14 2v6h6M16 13H8M16 17H8M10 9H8"));
  return svg;
}

export function iconSimulator(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"));
  return svg;
}

export function iconSearch(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeCircle(11, 11, 8));
  svg.appendChild(makePath("M21 21l-4.35-4.35"));
  return svg;
}

export function iconBell(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"));
  return svg;
}

export function iconRefresh(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M23 4v6h-6M1 20v-6h6"));
  svg.appendChild(makePath("M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"));
  return svg;
}

export function iconCalendar(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeRect(3, 4, 18, 18, 2));
  svg.appendChild(makePath("M16 2v4M8 2v4M3 10h18"));
  return svg;
}

export function iconLayers(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"));
  return svg;
}

export function iconClock(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeCircle(12, 12, 10));
  svg.appendChild(makePath("M12 6v6l4 2"));
  return svg;
}

export function iconInfo(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeCircle(12, 12, 10));
  svg.appendChild(makePath("M12 16v-4M12 8h.01"));
  return svg;
}

export function iconSun(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeCircle(12, 12, 5));
  svg.appendChild(makePath("M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"));
  return svg;
}

export function iconMoon(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"));
  return svg;
}

export function iconSignOut(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"));
  return svg;
}

export function iconCheck(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M20 6L9 17l-5-5"));
  return svg;
}

export function iconCross(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M18 6L6 18M6 6l12 12"));
  return svg;
}

export function iconAlert(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"));
  svg.appendChild(makePath("M12 9v4M12 17h.01"));
  return svg;
}

export function iconCircle(size = 14) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makeCircle(12, 12, 8));
  return svg;
}

export function iconSparkle(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M12 2l2.4 7.2L21.6 12l-7.2 2.8L12 22l-2.4-7.2L2.4 12l7.2-2.8z"));
  return svg;
}

export function iconChevronDown(size = 12) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M6 9l6 6 6-6"));
  return svg;
}

export function iconEye(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"));
  svg.appendChild(makeCircle(12, 12, 3));
  return svg;
}

export function iconEyeOff(size = 16) {
  const svg = makeSvg(size, "0 0 24 24");
  svg.appendChild(makePath("M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22"));
  return svg;
}
