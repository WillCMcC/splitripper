/**
 * Queue rendering and management
 */

import { $, api, getCurrentFolder } from './api.js';
import {
  fmtDuration,
  statusDotClass,
  updateAddAllResultsVisibility,
  updateAddAllLocalVisibility,
} from './utils.js';
import { DOWNLOAD_PROGRESS_WEIGHT, PROCESSING_PROGRESS_WEIGHT } from './constants.js';

// Forward declaration for refreshQueue - will be set later
let _refreshQueue = null;

export function setRefreshQueue(fn) {
  _refreshQueue = fn;
}

/**
 * Inject optimistic queue items for immediate UI feedback
 * @param {Array} items - Queue items to inject
 */
export function injectOptimisticQueue(items) {
  const existing = new Set((window.__optimisticQueue || []).map((x) => x.url));
  const deduped = items.filter((x) => !existing.has(x.url));
  window.__optimisticQueue = (window.__optimisticQueue || []).concat(deduped);
  // render quickly using last known server queue snapshot shape
  renderQueue({ items: [] });
  // clear optimistic entries after server confirms on next poll
  setTimeout(() => {
    window.__optimisticQueue = [];
  }, 1500);
}

/**
 * Render the queue UI
 * @param {Object} queueState - Queue state from server
 */
export function renderQueue(queueState) {
  const wrap = $("#queue");
  wrap.innerHTML = "";
  const frag = document.createDocumentFragment();

  // include any optimistic items that haven't been confirmed yet, but
  // dedupe against server-confirmed items by URL to avoid doubles
  const serverItems = queueState.items || [];
  const serverUrls = new Set(serverItems.map((x) => x.url));
  // Expose current server queue URLs globally for UI dedupe/visibility logic
  window.__serverQueueUrls = serverUrls;
  try {
    updateAddAllResultsVisibility();
    updateAddAllLocalVisibility();
  } catch {}
  const optimistic = (window.__optimisticQueue || []).filter(
    (x) => x && x.url && !serverUrls.has(x.url)
  );
  const items = [...optimistic, ...serverItems];

  // Move done items to the bottom while preserving order within groups
  const runningFirst = items.filter((it) => it.status === "running");
  const queuedNext = items.filter((it) => it.status === "queued");
  const others = items.filter(
    (it) =>
      it.status !== "running" && it.status !== "queued" && it.status !== "done"
  );
  const doneLast = items.filter((it) => it.status === "done");
  const ordered = [...runningFirst, ...queuedNext, ...others, ...doneLast];

  ordered.forEach((it) => {
    const row = document.createElement("div");
    row.className = "queue-item";
    row.setAttribute("role", "listitem");

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = it.title || it.url;

    const status = document.createElement("div");
    status.className = "status";
    const dot = document.createElement("span");
    dot.className = `status-dot ${statusDotClass(it.status)}`;
    status.appendChild(dot);
    const stText = document.createElement("span");
    stText.textContent = it.status + (it.error ? ` (${it.error})` : "");
    status.appendChild(stText);

    // Destination path (if available), shown in small grey text
    if (it.status === "done" && it.dest_path) {
      const dest = document.createElement("div");
      dest.className = "dest-path";
      dest.textContent = it.dest_path;
      status.appendChild(dest);
    }

    // Download progress bar and labels
    // Do not render any progress bar container while queued
    let progWrap = null;
    if (it.status !== "queued") {
      progWrap = document.createElement("div");
      progWrap.className = "progress";

      const bar = document.createElement("div");
      bar.className = "bar";

      // Calculate overall progress through the entire pipeline
      // Download phase weight and processing weight defined in constants.js
      let overallProgress = 0;

      // Track per-item progress to prevent regression
      window.__itemProgress = window.__itemProgress || {};
      const itemKey = it.id || it.url;

      if (it.status === "done") {
        overallProgress = 1.0; // 100% complete
      } else if (it.processing) {
        // Processing phase: download is complete + splitting progress
        // The server provides granular splitting progress in item.progress (0-0.99)
        const splitProgress = it.progress || 0;
        overallProgress = DOWNLOAD_PROGRESS_WEIGHT + splitProgress * PROCESSING_PROGRESS_WEIGHT;
      } else if (it.downloaded) {
        // Downloaded but not yet processing: download weight complete
        overallProgress = DOWNLOAD_PROGRESS_WEIGHT;
      } else {
        // Download phase: scale download_progress to first portion of overall progress
        const dlFrac =
          typeof it.download_progress === "number"
            ? it.download_progress
            : it.progress || 0;
        overallProgress = (dlFrac || 0) * DOWNLOAD_PROGRESS_WEIGHT;
      }

      // Prevent individual item progress regression, but allow phase transitions
      if (itemKey && window.__itemProgress[itemKey] !== undefined) {
        const lastProgress = window.__itemProgress[itemKey];

        // Allow progress reset in these cases:
        // 1. Item restarted (error or queued state)
        // 2. Transitioning from download to processing phase (around download weight mark)
        // 3. Major status change that indicates restart
        if (it.status === "error" || it.status === "queued") {
          // Item restarted - allow full reset
        } else if (
          it.processing &&
          lastProgress <= DOWNLOAD_PROGRESS_WEIGHT + 0.05 &&
          overallProgress >= DOWNLOAD_PROGRESS_WEIGHT
        ) {
          // Transitioning into processing - allow the transition
        } else {
          // Normal case - only allow progress to go forward
          overallProgress = Math.max(overallProgress, lastProgress);
        }
      }

      // Update item progress tracking
      if (itemKey) {
        window.__itemProgress[itemKey] = overallProgress;
      }

      const dlPct = Math.floor(overallProgress * 100);

      // Indeterminate animation when starting download (no progress yet)
      if (it.status === "running" && dlPct === 0) {
        bar.style.width = "30%";
        bar.classList.add("indeterminate");
        progWrap.classList.add("indeterminate");
      } else {
        // Use real progress for all other cases (download, processing, done)
        bar.style.width = `${dlPct}%`;
        bar.classList.remove("indeterminate");
        progWrap.classList.remove("indeterminate");
      }
      progWrap.appendChild(bar);
    }

    // Label row under bar: Downloading/Downloaded and Processing spinner
    const phaseRow = document.createElement("div");
    phaseRow.className = "phase-row";

    // Download/phase label
    // For queued: do not render an extra label (status row already shows "queued")
    if (it.status !== "queued") {
      const dlLabel = document.createElement("span");
      dlLabel.className = "phase-badge";
      if (it.downloaded) {
        dlLabel.textContent = "Downloaded";
        dlLabel.classList.add("phase-done"); // for green/check styling
      } else if (it.status === "running") {
        dlLabel.textContent = "Downloading";
      } else {
        dlLabel.textContent = it.status;
      }
      phaseRow.appendChild(dlLabel);

      // Show ETA during download phase when available
      if (
        !it.downloaded &&
        it.status === "running" &&
        typeof it.download_eta_sec === "number" &&
        isFinite(it.download_eta_sec) &&
        it.download_eta_sec > 0
      ) {
        const eta = document.createElement("span");
        eta.className = "phase-badge eta-badge";
        eta.textContent = `~${fmtDuration(it.download_eta_sec)} left`;
        phaseRow.appendChild(eta);
      }
    }

    // Processing indicator: spinner while processing is true
    if (it.status !== "queued" && it.processing) {
      const spinner = document.createElement("span");
      spinner.className = "spinner";
      spinner.title = "Splitting audio tracks";
      phaseRow.appendChild(spinner);

      const procText = document.createElement("span");
      procText.className = "phase-badge processing-badge";

      // Show different message based on progress stage
      // When progress is at or near max (0.99), show "Finalizing..." to indicate
      // Demucs is in the separation/writing phase (no progress output)
      const splitProgress = it.progress || 0;
      if (splitProgress >= 0.95) {
        procText.textContent = "Finalizing stems...";
        procText.title = "AI separation in progress - this model may take several minutes";
      } else if (splitProgress >= 0.5) {
        procText.textContent = "Separating audio...";
      } else {
        procText.textContent = "Splitting tracks...";
      }
      phaseRow.appendChild(procText);

      // Show ETA for processing when available
      if (
        typeof it.processing_eta_sec === "number" &&
        isFinite(it.processing_eta_sec) &&
        it.processing_eta_sec > 0
      ) {
        const eta = document.createElement("span");
        eta.className = "phase-badge eta-badge";
        eta.textContent = `~${fmtDuration(it.processing_eta_sec)} left`;
        phaseRow.appendChild(eta);
      } else if (splitProgress >= 0.95) {
        // Show a "still working" indicator when at 95%+ with no ETA
        const workingNote = document.createElement("span");
        workingNote.className = "phase-badge eta-badge working-indicator";
        workingNote.textContent = "Still processing...";
        phaseRow.appendChild(workingNote);
      }
    } else if (
      it.status !== "queued" &&
      it.downloaded &&
      it.status !== "done"
    ) {
      // Optional: show "Splitting pending..." text if downloaded but not marked processing yet
      const procPending = document.createElement("span");
      procPending.className = "phase-badge";
      procPending.textContent = "Queued for splitting...";
      phaseRow.appendChild(procPending);
    }

    const progContainer = document.createElement("div");
    progContainer.className = "progress-container";
    if (progWrap) {
      progContainer.appendChild(progWrap);
    }
    progContainer.appendChild(phaseRow);

    left.appendChild(title);
    left.appendChild(status);
    left.appendChild(progContainer);

    const right = document.createElement("div");
    right.className = "actions";
    if (it.status === "queued") {
      const cancel = document.createElement("button");
      cancel.className = "secondary";
      cancel.textContent = "Cancel";
      cancel.setAttribute("aria-label", `Cancel "${it.title || it.url}"`);
      cancel.addEventListener("click", async () => {
        try {
          await api(`/api/cancel/${encodeURIComponent(it.id)}`, {
            method: "POST",
          });
          if (_refreshQueue) await _refreshQueue();
        } catch (e) {
          console.error(e);
        }
      });
      right.appendChild(cancel);
    }

    // Retry button for failed items
    if (it.status === "error") {
      const retry = document.createElement("button");
      retry.textContent = "Retry";
      retry.setAttribute("aria-label", `Retry "${it.title || it.url}"`);
      retry.addEventListener("click", async () => {
        try {
          // Re-enqueue the same URL

          // Optimistic UI entry moves it back to queued immediately
          injectOptimisticQueue([
            {
              id: "temp-" + Math.random().toString(36).slice(2),
              url: it.url,
              title: it.title || it.url,
              status: "queued",
              progress: 0,
            },
          ]);

          await api("/api/queue", {
            method: "POST",
            body: JSON.stringify({
              urls: [it.url],
              folder: getCurrentFolder(),
            }),
          });

          if (_refreshQueue) await _refreshQueue();
        } catch (e) {
          console.error("Failed to retry:", e);
          const counts = document.querySelector("#queue-counts");
          if (counts) counts.textContent = "Error retrying: " + e.message;
          if (_refreshQueue) await _refreshQueue();
        }
      });
      right.appendChild(retry);
    }

    row.appendChild(left);
    row.appendChild(right);
    frag.appendChild(row);
  });
  wrap.appendChild(frag);
}
