/**
 * Progress tracking and polling
 */

import { $, api } from './api.js';
import { renderQueue } from './queue.js';
import {
  DOWNLOAD_PROGRESS_WEIGHT,
  PROCESSING_PROGRESS_WEIGHT,
  FAST_POLL_INTERVAL,
  MEDIUM_POLL_INTERVAL,
  SLOW_POLL_INTERVAL,
  EMPTY_STREAK_THRESHOLD,
} from './constants.js';

// Track last known progress to prevent regression
window.__lastGlobalProgress = 0;
window.__lastItemCount = 0;
window.__itemProgress = {};

/**
 * Refresh global progress display (manual trigger)
 * Note: This is now a simplified version - the main polling happens in setupAdaptivePolling
 */
export async function refreshProgress() {
  try {
    const [p, q] = await Promise.all([api("/api/progress"), api("/api/queue")]);
    renderQueue(q);
    updateGlobalProgressDisplay(q, p);
  } catch (e) {
    console.warn("Transient error refreshing progress:", e);
  }
}

/**
 * Refresh queue from server
 */
export async function refreshQueue() {
  try {
    const q = await api("/api/queue");
    renderQueue(q);
  } catch (e) {
    console.warn("Failed to refresh queue:", e);
  }
}

/**
 * Refresh config from server and update UI
 */
export async function refreshConfig() {
  // Read cached config first for instant UI
  try {
    const cachedCfg = JSON.parse(localStorage.getItem("ytdl_config") || "{}");
    const savedPath = localStorage.getItem("ytdl_directory_path");
    if (cachedCfg) {
      if (
        document.querySelector("#cfg-output") &&
        document.querySelector("#cfg-output").value === ""
      ) {
        // Prioritize the saved directory path over cached config
        document.querySelector("#cfg-output").value =
          savedPath || cachedCfg.output_dir || "";
      }
    }
  } catch (e) {
    console.warn("Failed to load cached config:", e);
  }
  // Load from server (silent; no status UI)
  try {
    const cfg = await api("/api/config");
    const savedPath = localStorage.getItem("ytdl_directory_path");
    if (document.querySelector("#cfg-output")) {
      const el = document.querySelector("#cfg-output");
      // Use saved path first, then server config, then empty
      const defaultPath = savedPath || cfg.output_dir || "";
      if (!el.value && defaultPath) {
        el.value = defaultPath;
        // If we're using the server default, save it locally too
        if (!savedPath && cfg.output_dir) {
          localStorage.setItem("ytdl_directory_path", cfg.output_dir);
        }
      }
    }
    // Persist verified config for next load (only keys we show)
    localStorage.setItem(
      "ytdl_config",
      JSON.stringify({
        output_dir: cfg.output_dir || "",
        cookies_from_browser: cfg.cookies_from_browser || {},
      })
    );
  } catch (e) {
    console.warn("Failed to load config from server:", e);
  }
}

/**
 * Setup adaptive polling for queue/progress
 * - Start fast (500ms). If three consecutive polls see empty queue and no activity, back off to 2s, then 5s.
 * - When activity resumes (queue non-empty or active>0), restore fast polling.
 */
export function setupAdaptivePolling() {
  let backoffStage = 0; // 0: fast, 1: medium, 2+: slow
  let emptyStreak = 0;
  let pollTimer = null;
  let lastActiveState = false;

  const computeInterval = () => {
    if (backoffStage <= 0) return FAST_POLL_INTERVAL;
    if (backoffStage === 1) return MEDIUM_POLL_INTERVAL;
    return SLOW_POLL_INTERVAL;
  };

  const stopTimer = () => {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const scheduleNext = () => {
    stopTimer();
    pollTimer = setTimeout(tick, computeInterval());
  };

  const resetToFast = () => {
    backoffStage = 0;
    emptyStreak = 0;
  };

  const tick = async () => {
    try {
      // fetch server queue and progress
      const [q, p] = await Promise.all([
        api("/api/queue"),
        api("/api/progress"),
      ]);
      
      // Clean up optimistic queue entries that are now confirmed by server
      const serverUrls = new Set((q.items || []).map((x) => x.url));
      if (
        Array.isArray(window.__optimisticQueue) &&
        window.__optimisticQueue.length
      ) {
        window.__optimisticQueue = window.__optimisticQueue.filter(
          (x) => !(x && x.url && serverUrls.has(x.url))
        );
      }
      
      // Render queue with current progress data
      renderQueue(q);
      
      // Update global progress display
      updateGlobalProgressDisplay(q, p);

      // Determine activity: queue non-empty or active > 0
      const queueEmpty = !(q.items && q.items.length);
      const active =
        p && p.concurrency && typeof p.concurrency.active === "number"
          ? p.concurrency.active
          : 0;
      const activeNow = active > 0 || q.items?.some(it => it.status === "running");

      if (queueEmpty && !activeNow) {
        emptyStreak += 1;
        if (emptyStreak >= EMPTY_STREAK_THRESHOLD) {
          // escalate backoff up to max stage
          if (backoffStage < 2) backoffStage += 1;
          // keep streak capped to avoid overflow
          emptyStreak = EMPTY_STREAK_THRESHOLD;
        }
      } else {
        // activity resumed
        if (backoffStage !== 0 || !lastActiveState) {
          resetToFast();
        } else {
          // on fast stage keep streak cleared
          emptyStreak = 0;
        }
      }
      lastActiveState = activeNow;
    } catch (e) {
      console.warn("Transient polling error (will retry):", e);
    } finally {
      scheduleNext();
    }
  };

  // kick off immediately
  tick();

  // Note: Background throttling is disabled at the Electron level (backgroundThrottling: false
  // and disable-renderer-backgrounding command line switch), so we maintain fast polling
  // even when the window is hidden to ensure progress bars update smoothly.
  // The adaptive backoff based on queue activity still applies for idle state.
}

/**
 * Update global progress bar and related UI elements
 */
function updateGlobalProgressDisplay(q, p) {
  const items = (q && q.items) || [];
  let totalProgress = 0;

  // Check if there's active work (items that are not done/error)
  const hasActiveWork = items.some(it => it.status !== "done" && it.status !== "error");

  if (items.length > 0) {
    items.forEach((it) => {
      let itemProgress = 0;

      if (it.status === "done") {
        itemProgress = 1.0;
      } else if (it.processing) {
        const splitProgress = it.progress || 0;
        itemProgress = DOWNLOAD_PROGRESS_WEIGHT + splitProgress * PROCESSING_PROGRESS_WEIGHT;
      } else if (it.downloaded) {
        itemProgress = DOWNLOAD_PROGRESS_WEIGHT;
      } else if (it.status === "running") {
        const dlFrac =
          typeof it.download_progress === "number"
            ? it.download_progress
            : it.progress || 0;
        itemProgress = (dlFrac || 0) * DOWNLOAD_PROGRESS_WEIGHT;
      }

      totalProgress += itemProgress;
    });

    totalProgress = totalProgress / items.length;
  }

  // Prevent progress regression unless item count changed
  if (items.length === window.__lastItemCount) {
    totalProgress = Math.max(totalProgress, window.__lastGlobalProgress);
  } else {
    window.__lastItemCount = items.length;
  }

  window.__lastGlobalProgress = totalProgress;

  const pct = Math.floor(totalProgress * 100);
  const globalBar = $("#global-progress-bar");
  const globalText = $("#global-progress-text");
  const progressRow = globalBar?.closest(".row");

  // Hide progress bar when queue is empty or all work is complete
  if (items.length === 0 || !hasActiveWork) {
    if (progressRow) progressRow.style.display = "none";
    // Reset progress state for next batch
    window.__lastGlobalProgress = 0;
    window.__lastItemCount = 0;
  } else {
    if (progressRow) progressRow.style.display = "";
    if (globalBar) globalBar.style.width = `${pct}%`;
    if (globalText) globalText.textContent = `${pct}%`;
  }

  // Update ARIA
  const progressContainer = document.querySelector(".progress[role='progressbar']");
  if (progressContainer) {
    progressContainer.setAttribute("aria-valuenow", String(pct));
  }

  // Update browser tab title
  try {
    const total = items.length;
    const done = items.filter((it) => it.status === "done").length;
    const baseTitle = "SplitBoy";
    if (total > 0) {
      document.title = `(${done}/${total}) ${baseTitle}`;
    } else {
      document.title = baseTitle;
    }

    if (window.electronAPI && window.electronAPI.updateTaskbarProgress) {
      // Pass total: 0 when no active work to clear the taskbar progress
      window.electronAPI.updateTaskbarProgress({
        completed: done,
        total: hasActiveWork ? total : 0,
        progress: hasActiveWork ? totalProgress : 0,
      });
    }
  } catch (e) {
    console.warn("Failed to update browser title/taskbar:", e);
  }

  // Update concurrency status
  if (p && p.concurrency) {
    const { active = 0, max = 6 } = p.concurrency;
    const el = document.querySelector("#concurrency-status");
    if (el) el.textContent = `active ${active} / max ${max}`;
    const input = document.querySelector("#concurrency-input");
    const label = document.querySelector("#concurrency-label");
    if (input && typeof input.value !== "undefined") {
      if (input.dataset.busy !== "1") {
        input.value = String(max);
        if (label) label.textContent = `Parallel downloads: ${max}`;
      }
    }
  }

  // Update queue counts with adjusted error count
  const errored = items.filter((it) => it.status === "error");
  const urlsByStatus = items.reduce((acc, it) => {
    const u = it.url;
    if (!u) return acc;
    if (!acc[u]) acc[u] = new Set();
    acc[u].add(it.status);
    return acc;
  }, {});

  let adjustedError = 0;
  for (const it of errored) {
    const statuses = urlsByStatus[it.url] || new Set();
    const hasActive =
      statuses.has("queued") ||
      statuses.has("running") ||
      statuses.has("done");
    if (!hasActive) adjustedError += 1;
  }

  const c = (p && p.counts) || {};
  const countsEl = $("#queue-counts");
  if (countsEl) {
    countsEl.textContent = `queued ${c.queued || 0} • running ${c.running || 0} • done ${c.done || 0} • error ${adjustedError}`;
  }
}
