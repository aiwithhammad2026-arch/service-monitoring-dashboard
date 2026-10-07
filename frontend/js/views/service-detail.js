/**
 * views/service-detail.js — Service detail view stub (TASK 09/10).
 */
import { makeEmptyState } from "../ui.js";

export function renderServiceDetail(serviceId, container) {
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = `Service: ${serviceId}`;

  const stub = makeEmptyState({
    icon: "◎",
    title: "Service detail — coming in Task 10",
    msg: `Detail view for service "${serviceId}" will render here.`,
  });

  container.appendChild(title);
  container.appendChild(stub);
}
