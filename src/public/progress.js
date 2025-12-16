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
 * Refresh global progress display
 */
export async function refreshProgress() {
  try {
    // Pull both progress and queue to compute adjusted counts without backend changes
    const [p, q] = await Promise.all([api("/api/progress"), api("/api/queue")]);

    // Calculate global progress based on individual item progress using download/processing weights
    const items = (q && q.items) || [];
    let totalProgress = 0;

    if (items.length > 0) {
      items.forEach((it) => {
        let itemProgress = 0;

        if (it.status === "done") {
          itemProgress = 1.0;
        } else if (it.processing) {
          // Processing: download complete + processing progress
          const splitProgress = it.progress || 0;
          itemProgress = DOWNLOAD_PROGRESS_WEIGHT + splitProgress * PROCESSING_PROGRESS_WEIGHT;
        } else if (it.downloaded) {
          // Downloaded but not processing: download weight complete
          itemProgress = DOWNLOAD_PROGRESS_WEIGHT;
        } else if (it.status === "running") {
          // Download phase: scale download_progress to download weight
          const dlFrac =
            typeof it.download_progress === "number"
              ? it.download_progress
              : it.progress || 0;
          itemProgress = (dlFrac || 0) * DOWNLOAD_PROGRESS_WEIGHT;
        }
        // queued, error states remain at 0

        totalProgress += itemProgress;
      });

      totalProgress = totalProgress / items.length; // Average progress
    }

    // Prevent progress regression unless item count changed (new items added/removed)
    if (items.length === window.__lastItemCount) {
      // Same number of items - ensure progress only goes forward
      totalProgress = Math.max(totalProgress, window.__lastGlobalProgress);
    } else {
      // Item count changed - allow progress to reset/adjust
      window.__lastItemCount = items.length;
    }

    // Update tracking
    window.__lastGlobalProgress = totalProgress;

    const pct = Math.floor(totalProgress * 100);
    $("#global-progress-bar").style.width = `${pct}%`;
    $("#global-progress-text").textContent = `${pct}%`;

    // Update ARIA attributes on progress bar container
    const progressContainer = document.querySelector(".progress[role='progressbar']");
    if (progressContainer) {
      progressContainer.setAttribute("aria-valuenow", String(pct));
    }

    // Update browser tab title with x/n where x=completed, n=queue length
    try {
      const total = items.length;
      const done = items.filter((it) => it.status === "done").length;
      const baseTitle = "SplitBoy";
      if (total > 0) {
        document.title = `(${done}/${total}) ${baseTitle}`;
      } else {
        document.title = baseTitle;
      }

      // Update taskbar/tray progress if running in Electron
      if (window.electronAPI && window.electronAPI.updateTaskbarProgress) {
        window.electronAPI.updateTaskbarProgress({
          completed: done,
          total: total,
          progress: totalProgress,
        });
      }
    } catch (e) {
      console.warn("Failed to update browser title/taskbar:", e);
    }

    // Reflect concurrency active/max in UI if elements exist
    if (p.concurrency) {
      const { active = 0, max = 6 } = p.concurrency;
      const el = document.querySelector("#concurrency-status");
      if (el) el.textContent = `active ${active} / max ${max}`;
      const input = document.querySelector("#concurrency-input");
      const label = document.querySelector("#concurrency-label");
      if (input && typeof input.value !== "undefined") {
        // keep control in sync only if user isn't currently dragging (heuristic via data-busy)
        if (input.dataset.busy !== "1") {
          input.value = String(max);
          if (label) label.textContent = `Parallel downloads: ${max}`;
        }
      }
    }

    // Adjust error count to exclude items that are already retried (same URL present with queued/running/done)
    const errored = items.filter((it) => it.status === "error");
    const urlsByStatus = items.reduce((acc, it) => {
      const u = it.url;
      if (!u) return acc;
      if (!acc[u]) acc[u] = new Set();
      acc[u].add(it.status);
      return acc;
    }, /** @type {Record<string, Set<string>>} */ ({}));

    let adjustedError = 0;
    for (const it of errored) {
      const statuses = urlsByStatus[it.url] || new Set();
      // If this URL has a non-error active entry, treat this error as superseded and don't count it
      const hasActive =
        statuses.has("queued") ||
        statuses.has("running") ||
        statuses.has("done");
      if (!hasActive) adjustedError += 1;
    }

    // Queued count stays as reported by server for simplicity; adjusted error excludes superseded errors
    const c = p.counts || {};
    $("#queue-counts").textContent = `queued ${c.queued || 0} • running ${
      c.running || 0
    } • done ${c.done || 0} • error ${adjustedError}`;
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
 * - Start fast (1.5s). If three consecutive polls see empty queue and no activity, back off to 5s, then 10s.
 * - When activity resumes (queue non-empty or active>0), restore fast polling.
 */
export function setupAdaptivePolling() {
  let backoffStage = 0; // 0: fast, 1: medium, 2+: slow
  let emptyStreak = 0;
  let pollTimer = null;

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
      // fetch server queue, then drop any optimistic entries that are now present server-side
      const [q, p] = await Promise.all([
        api("/api/queue"),
        api("/api/progress"),
      ]);
      const serverUrls = new Set((q.items || []).map((x) => x.url));
      if (
        Array.isArray(window.__optimisticQueue) &&
        window.__optimisticQueue.length
      ) {
        window.__optimisticQueue = window.__optimisticQueue.filter(
          (x) => !(x && x.url && serverUrls.has(x.url))
        );
      }
      renderQueue(q);

      // Determine activity: queue non-empty or active > 0
      const queueEmpty = !(q.items && q.items.length);
      const active =
        p && p.concurrency && typeof p.concurrency.active === "number"
          ? p.concurrency.active
          : 0;
      const activeNow = active > 0;

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
        if (backoffStage !== 0) {
          resetToFast();
        } else {
          // on fast stage keep streak cleared
          emptyStreak = 0;
        }
      }
    } catch (e) {
      console.warn("Transient polling error (will retry):", e);
    } finally {
      scheduleNext();
    }
  };

  // kick off
  scheduleNext();

  // progress polling remains at fast cadence but inexpensive
  let progressTimer = null;
  const startProgressLoop = () => {
    if (progressTimer) return;
    progressTimer = setInterval(refreshProgress, FAST_POLL_INTERVAL);
  };
  const stopProgressLoop = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  };
  startProgressLoop();

  // Note: Background throttling is disabled at the Electron level (backgroundThrottling: false
  // and disable-renderer-backgrounding command line switch), so we maintain fast polling
  // even when the window is hidden to ensure progress bars update smoothly.
  // The adaptive backoff based on queue activity still applies for idle state.
}
