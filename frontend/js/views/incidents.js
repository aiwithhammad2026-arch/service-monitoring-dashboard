/**
 * views/incidents.js — Incidents view stub (TASK 10).
 */
import { makeEmptyState } from "../ui.js";

export function renderIncidents(container) {
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Incidents";

  const stub = makeEmptyState({
    icon: "⚠",
    title: "Incidents — coming in Task 10",
    msg: "Incident list, timeline, ack/resolve controls will render here.",
  });

  container.appendChild(title);
  container.appendChild(stub);
}
