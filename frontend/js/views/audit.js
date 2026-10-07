/**
 * views/audit.js — Audit log view stub (TASK 10).
 */
import { makeEmptyState } from "../ui.js";

export function renderAudit(container) {
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Audit Log";

  const stub = makeEmptyState({
    icon: "📋",
    title: "Audit Log — coming in Task 10",
    msg: "Paginated admin audit log will render here.",
  });

  container.appendChild(title);
  container.appendChild(stub);
}
