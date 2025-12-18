/**
 * HD Mode quality settings management
 *
 * HD Mode uses multiple processing passes (shifts=5) to produce cleaner stems
 * with fewer artifacts. Processing takes ~5x longer but results in better
 * vocal isolation and less bleed between instruments.
 */

import { $, api } from './api.js';

/**
 * Initialize HD Mode toggle
 */
export async function setupQualitySettings() {
  const hdToggle = $("#cfg-hd-mode");

  if (hdToggle) {
    hdToggle.addEventListener("change", async () => {
      const enabled = hdToggle.checked;
      const preset = enabled ? "high" : "normal";

      try {
        await api("/api/config", {
          method: "POST",
          body: JSON.stringify({ quality_preset: preset }),
        });
      } catch (e) {
        console.error("Failed to update HD mode:", e);
        hdToggle.checked = !enabled; // Revert on error
      }
    });
  }

  // Load initial state
  await loadQualityConfig();
}

/**
 * Load quality settings from server config
 */
async function loadQualityConfig() {
  try {
    const config = await api("/api/config");

    const hdToggle = $("#cfg-hd-mode");
    if (hdToggle && config.quality_preset) {
      hdToggle.checked = config.quality_preset === "high";
    }
  } catch (e) {
    console.error("Failed to load quality config:", e);
  }
}

// No-op exports for backwards compatibility (MSG removed)
export function setupMsgDownloadButton() {}
