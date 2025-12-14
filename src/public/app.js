/**
 * SplitBoy - Main Application Entry Point
 *
 * This is the main entry point that imports and wires up all modules.
 */

// Core API and utilities
import { $, api } from './api.js';

// Queue management
import { setRefreshQueue as setQueueRefreshQueue } from './queue.js';

// Search results
import { setRefreshQueue as setResultsRefreshQueue } from './results.js';

// Local file handling
import { setupDropZone, setupLocalFiles, setRefreshQueue as setLocalFilesRefreshQueue } from './local-files.js';

// Progress tracking
import { refreshProgress, refreshQueue, refreshConfig, setupAdaptivePolling } from './progress.js';

// Settings and tabs
import { setupDirectoryPicker, setupTabs, setupSettingsSubtabs, setupYtdlpUpdate } from './settings.js';

// Model management
import { loadModelsConfig, setupQuickDownload, setupDownloadAll } from './models.js';

// Search handlers
import { setupSearchHandlers, setRefreshQueue as setSearchRefreshQueue } from './search.js';

// Queue control handlers
import { setupQueueControls, setRefreshQueue as setControlsRefreshQueue, setRefreshProgress as setControlsRefreshProgress } from './controls.js';

// Wire up refreshQueue/refreshProgress to modules that need it
setQueueRefreshQueue(refreshQueue);
setResultsRefreshQueue(refreshQueue);
setLocalFilesRefreshQueue(refreshQueue);
setSearchRefreshQueue(refreshQueue);
setControlsRefreshQueue(refreshQueue);
setControlsRefreshProgress(refreshProgress);

/**
 * Main boot function - initializes the application
 */
async function boot() {
  // initial config
  await refreshConfig();

  // First-run: prompt for output folder in Electron if not already set
  try {
    const savedDir = localStorage.getItem("ytdl_directory_path");
    if (!localStorage.getItem("ytdl_first_run_prompt_done") && !savedDir) {
      if (window.electronAPI && window.electronAPI.selectDirectory) {
        const selectedPath = await window.electronAPI.selectDirectory();
        if (selectedPath) {
          localStorage.setItem("ytdl_directory_path", selectedPath);
          const el = document.querySelector("#cfg-output");
          if (el) el.value = selectedPath;
          try {
            await api("/api/config", {
              method: "POST",
              body: JSON.stringify({ output_dir: selectedPath }),
            });
          } catch (e) {
            console.warn("Failed to save initial output directory to server:", e);
          }
        }
      }
      localStorage.setItem("ytdl_first_run_prompt_done", "1");
    }
  } catch (e) {
    console.warn("First-run prompt failed:", e);
  }

  // Initialize concurrency UI if present
  setupConcurrencyUI();

  // Setup cookie-related event handlers
  setupCookieHandlers();

  // Setup search/playlist handlers
  setupSearchHandlers();

  // Setup queue control handlers
  setupQueueControls();

  // Setup adaptive polling for queue/progress
  setupAdaptivePolling();
}

/**
 * Initialize concurrency UI controls
 */
async function setupConcurrencyUI() {
  try {
    try {
      await api("/api/concurrency", {
        method: "POST",
        body: JSON.stringify({ max: 6 }),
      });
    } catch (e) {
      console.warn("Failed to set initial concurrency:", e);
    }

    const data = await api("/api/concurrency");
    const input = document.querySelector("#concurrency-input");
    const label = document.querySelector("#concurrency-label");
    const status = document.querySelector("#concurrency-status");

    if (input) {
      const serverMax = typeof data.serverMax === "number" ? data.serverMax : 64;
      input.min = "1";
      input.max = String(serverMax);
      input.step = "1";
      input.value = String(data.max ?? 6);

      input.addEventListener("input", (e) => {
        if (label) label.textContent = `Parallel downloads: ${e.target.value}`;
      });

      let postTimer = null;
      const post = async (val) => {
        try {
          await api("/api/concurrency", {
            method: "POST",
            body: JSON.stringify({ max: Number(val) }),
          });
        } catch (e) {
          try {
            const p = await api("/api/progress");
            const max = (p.concurrency && p.concurrency.max) || 6;
            input.value = String(max);
            if (label) label.textContent = `Parallel downloads: ${max}`;
          } catch (refreshErr) {
            console.warn("Failed to refresh concurrency value:", refreshErr);
          }
          console.error("Failed to set concurrency:", e);
          const status = document.querySelector("#concurrency-status");
          if (status) status.textContent = "Failed to set concurrency";
        } finally {
          input.dataset.busy = "0";
        }
      };

      input.addEventListener("change", (e) => {
        input.dataset.busy = "1";
        if (postTimer) clearTimeout(postTimer);
        postTimer = setTimeout(() => post(e.target.value), 250);
      });
    }

    if (label) label.textContent = `Parallel downloads: ${data.max ?? 6}`;
    if (status) status.textContent = `active ${data.active ?? 0} / ${data.max ?? 6}`;
  } catch (e) {
    console.warn("Failed to initialize concurrency UI:", e);
  }
}

/**
 * Setup cookie-related UI handlers
 */
function setupCookieHandlers() {
  const detectBrowser = () => {
    const el = document.querySelector("#cfg-cookies-browser");
    if (!el || el.value) return;
    const candidates = ["chrome", "brave", "edge", "firefox", "safari"];
    el.value = candidates[0];
  };

  const btnDetect = document.querySelector("#cfg-detect-browser");
  if (btnDetect) {
    btnDetect.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      detectBrowser();
    });
  }

  const btnClear = document.querySelector("#cfg-clear-cookies");
  if (btnClear) {
    btnClear.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      try {
        const payload = { cookies_from_browser: {} };
        const b = document.querySelector("#cfg-cookies-browser");
        const p = document.querySelector("#cfg-cookies-profile");
        if (b) b.value = "";
        if (p) p.value = "";
        const cached = JSON.parse(localStorage.getItem("ytdl_config") || "{}");
        localStorage.setItem("ytdl_config", JSON.stringify({ ...cached, cookies_from_browser: {} }));
        $("#config-status").textContent = "Clearing cookies config...";
        await api("/api/config", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        $("#config-status").textContent = "Cookies config cleared";
      } catch (e) {
        console.error("Failed to clear cookies config:", e);
        const statusEl = document.querySelector("#config-status");
        if (statusEl) statusEl.textContent = "Failed to clear cookies config";
      }
    });
  }
}

// DOMContentLoaded handler
document.addEventListener("DOMContentLoaded", () => {
  // Ensure we only bind boot once
  if (window.__bootBound) return;
  window.__bootBound = true;

  setupDirectoryPicker();
  setupTabs();
  setupSettingsSubtabs();
  setupLocalFiles();
  setupDropZone();
  setupYtdlpUpdate();
  setupQuickDownload();
  setupDownloadAll();
  loadModelsConfig();
  boot();
});
