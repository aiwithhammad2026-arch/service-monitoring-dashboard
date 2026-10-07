/**
 * views/dashboard.js — Dashboard view stub (implemented in TASK 09).
 */
import { makeEmptyState } from "../ui.js";

export function renderDashboard(container) {
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Dashboard";

  const stub = makeEmptyState({
    icon: "◈",
    title: "Dashboard — coming in Task 09",
    msg: "KPI cards, charts and service grid will render here.",
  });

  container.appendChild(title);
  container.appendChild(stub);
}
