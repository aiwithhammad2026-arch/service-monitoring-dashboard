/**
 * views/simulator.js — Simulator controls view stub (TASK 10).
 */
import { makeEmptyState } from "../ui.js";

export function renderSimulator(container) {
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Simulator Controls";

  const stub = makeEmptyState({
    icon: "⚙",
    title: "Simulator — coming in Task 10",
    msg: "Service mode, pause and reporting controls will render here.",
  });

  container.appendChild(title);
  container.appendChild(stub);
}
