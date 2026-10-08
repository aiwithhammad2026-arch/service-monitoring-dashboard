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

export function iconLogo(size = 20) {
  const svg = makeSvg(size, "0 0 24 24", "icon-logo");
  svg.setAttribute("fill", "none");
  const rect = makeRect(2, 2, 20, 20, 6, {
    fill: "var(--accent-blue)",
    stroke: "var(--accent-blue)",
  });
  const p = makePath("M13 3L4 14h7l-2 7 9-11h-7l2-7z", {
    fill: "#FFFFFF",
    stroke: "#FFFFFF",
    "stroke-width": "1.5",
  });
  svg.appendChild(rect);
  svg.appendChild(p);
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
