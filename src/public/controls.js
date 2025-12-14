/**
 * Queue control buttons - start, stop, clear, retry
 */

import { api, getCurrentFolder } from './api.js';
import { injectOptimisticQueue } from './queue.js';
import { showError } from './utils.js';

// Forward declarations
let _refreshQueue = null;
let _refreshProgress = null;

export function setRefreshQueue(fn) {
  _refreshQueue = fn;
}

export function setRefreshProgress(fn) {
  _refreshProgress = fn;
}

/**
 * Setup start button handler
 */
export function setupStartHandler() {
  const btnStart = document.querySelector("#btn-start");
  if (!btnStart) return;

  btnStart.addEventListener("click", async () => {
    btnStart.disabled = true;
    btnStart.textContent = "Starting...";
    try {
      await api("/api/start", { method: "POST" });
      if (_refreshQueue) await _refreshQueue();
    } catch (e) {
      console.error("Failed to start:", e);
      showError("Failed to start: " + e.message);
    } finally {
      btnStart.disabled = false;
      btnStart.textContent = "Start";
    }
  });
}

/**
 * Setup retry all button handler
 */
export function setupRetryAllHandler() {
  const btnRetryAll = document.querySelector("#btn-retry-all");
  if (!btnRetryAll) return;

  btnRetryAll.addEventListener("click", async () => {
    const btn = btnRetryAll;
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Retrying...";

    try {
      // Snapshot current queue from server
      const q = await api("/api/queue");
      const failed = (q.items || []).filter((it) => it.status === "error");
      if (failed.length === 0) {
        btn.disabled = false;
        btn.dataset.busy = "0";
        btn.textContent = originalText;
        return;
      }

      // Prepare URLs and dedupe
      const urls = Array.from(new Set(failed.map((it) => it.url).filter(Boolean)));

      // Optimistic UI for all failed items
      const optimistic = failed.map((it) => ({
        id: "temp-" + Math.random().toString(36).slice(2),
        url: it.url,
        title: it.title || it.url,
        status: "queued",
        progress: 0,
      }));
      injectOptimisticQueue(optimistic);

      // Batch POST in chunks
      const chunkSize = 20;
      for (let i = 0; i < urls.length; i += chunkSize) {
        const batch = urls.slice(i, i + chunkSize);
        await api("/api/queue", {
          method: "POST",
          body: JSON.stringify({ urls: batch, folder: getCurrentFolder() }),
        });
      }

      if (_refreshQueue) await _refreshQueue();
    } catch (e) {
      console.error("Failed to retry all:", e);
      showError("Failed to retry all: " + e.message);
      if (_refreshQueue) await _refreshQueue();
    } finally {
      btn.disabled = false;
      btn.dataset.busy = "0";
      btn.textContent = originalText;
    }
  });
}

/**
 * Setup stop button handler
 */
export function setupStopHandler() {
  const btnStop = document.querySelector("#btn-stop");
  if (!btnStop) return;

  btnStop.addEventListener("click", async () => {
    btnStop.disabled = true;
    btnStop.textContent = "Stopping...";
    try {
      await api("/api/stop", { method: "POST" });
      if (_refreshQueue) await _refreshQueue();
      if (_refreshProgress) await _refreshProgress();
    } catch (e) {
      console.error("Failed to stop:", e);
      showError("Failed to stop: " + e.message);
    } finally {
      btnStop.disabled = false;
      btnStop.textContent = "Stop";
    }
  });
}

/**
 * Setup clear button handler
 */
export function setupClearHandler() {
  const btnClear = document.querySelector("#btn-clear");
  if (!btnClear) return;

  btnClear.addEventListener("click", async () => {
    btnClear.disabled = true;
    btnClear.textContent = "Clearing...";
    try {
      await api("/api/clear", { method: "POST" });
      if (_refreshQueue) await _refreshQueue();
      if (_refreshProgress) await _refreshProgress();
    } catch (e) {
      console.error("Failed to clear:", e);
      showError("Failed to clear: " + e.message);
    } finally {
      btnClear.disabled = false;
      btnClear.textContent = "Clear";
    }
  });
}

/**
 * Setup all queue control handlers
 */
export function setupQueueControls() {
  setupStartHandler();
  setupRetryAllHandler();
  setupStopHandler();
  setupClearHandler();
}
