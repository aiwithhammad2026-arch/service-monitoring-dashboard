/**
 * PulseOps - Operations Monitoring Dashboard frontend entry point
 */

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/health");
    if (res.ok) {
      const data = await res.json();
      const statusIndicator = document.getElementById("system-status-indicator");
      if (statusIndicator) {
        const label = statusIndicator.querySelector(".status-label");
        if (label) {
          label.textContent = `Online (v${data.version || "0.1.0"})`;
        }
      }
    }
  } catch (err) {
    console.error("Health check error:", err);
  }
});
