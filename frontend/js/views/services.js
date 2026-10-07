/**
 * views/services.js — Services view stub (implemented in TASK 09).
 */
import { makeEmptyState } from "../ui.js";

export function renderServices(container) {
  const title = document.createElement("h1");
  title.className = "page-title";
  title.textContent = "Services";

  const stub = makeEmptyState({
    icon: "◎",
    title: "Services — coming in Task 09",
    msg: "Service status grid with health badges will render here.",
  });

  container.appendChild(title);
  container.appendChild(stub);
}
