const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Local file storage - declare globally so it's available to all functions
let localFiles = [];

// Cache bust - no radio buttons, only + buttons

// Helper function to get current folder
function getCurrentFolder() {
  return localStorage.getItem("ytdl_directory_path") || "";
}

function fmtDuration(seconds) {
  if (!seconds) return "Unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
        .toString()
        .padStart(2, "0")}`
    : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function applyFilters(items) {
  // Filters removed: return items as-is
  return items;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Helpers for "Add all" visibility against existing queue
function getServerQueueUrlSet() {
  try {
    return window.__serverQueueUrls instanceof Set
      ? window.__serverQueueUrls
      : new Set();
  } catch {
    return new Set();
  }
}

function countPendingResults(items) {
  const server = getServerQueueUrlSet();
  const optimistic = new Set(
    (window.__optimisticQueue || []).map((x) => x.url)
  );
  const urls = (items || []).map((it) => it && it.url).filter(Boolean);
  let count = 0;
  for (const u of urls) {
    if (!server.has(u) && !optimistic.has(u)) count++;
  }
  return count;
}

function updateAddAllResultsVisibility() {
  const btn = document.querySelector("#btn-add-all");
  if (!btn) return;
  const items = window.__currentResultItems || [];
  const pending = countPendingResults(items);
  btn.style.display = pending > 0 ? "" : "none";
}

function localPathToUrl(p) {
  return typeof p === "string" ? `file://${p}` : "";
}
function countPendingLocal(files) {
  const server = getServerQueueUrlSet();
  const optimistic = new Set(
    (window.__optimisticQueue || []).map((x) => x.url)
  );
  let count = 0;
  for (const f of files || []) {
    const u = localPathToUrl(f && f.path);
    if (u && !server.has(u) && !optimistic.has(u)) count++;
  }
  return count;
}
function updateAddAllLocalVisibility(files) {
  const btn = document.querySelector("#btn-add-local-all");
  if (!btn) return;
  const pending = countPendingLocal(files || window.__currentLocalFiles || []);
  btn.style.display = pending > 0 ? "" : "none";
}

function isAudioPath(p) {
  if (typeof p !== "string") return false;
  const ext = p.toLowerCase().split(".").pop() || "";
  const audio = new Set([
    "mp3",
    "wav",
    "flac",
    "aac",
    "m4a",
    "ogg",
    "wma",
    "opus",
  ]);
  return audio.has(ext);
}

function appendLocalFilePaths(paths, label = "Loaded") {
  if (!Array.isArray(paths) || paths.length === 0) return;
  const newFiles = paths.map((p) => ({
    path: p,
    name: p.split("/").pop() || p,
  }));
  const byPath = new Map((localFiles || []).map((f) => [f.path, f]));
  for (const f of newFiles) byPath.set(f.path, f);
  localFiles = Array.from(byPath.values());
  renderLocalFiles(localFiles);
  const meta = document.querySelector("#local-files-meta");
  if (meta) meta.textContent = `${label} ${newFiles.length} file(s)`;
}

/**
 * Setup drag & drop for audio files only into the drop-zone.
 * - Only accepts individual audio file drops
 * - Updates localFiles pending list (no auto-queue), dedupes by path, re-renders list.
 */
function setupDropZone() {
  // Prevent default navigation for file drops anywhere in the window
  ["dragover", "drop"].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  const dz = document.querySelector("#drop-zone");
  if (!dz) {
    console.error("Drop zone element not found!");
    return;
  }
  console.log("Drop zone setup initialized");

  const enter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add("dragover");
  };
  const over = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add("dragover");
    // Show copy cursor
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const leave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove("dragover");
  };

  // Click to browse (Electron file picker)
  dz.addEventListener("click", async () => {
    try {
      if (window.electronAPI && window.electronAPI.selectAudioFiles) {
        const filePaths = await window.electronAPI.selectAudioFiles();
        if (Array.isArray(filePaths) && filePaths.length) {
          appendLocalFilePaths(filePaths, "Loaded");
        } else {
          // User canceled or no files selected - don't fall back to directory picker
          const meta = document.querySelector("#local-files-meta");
          if (meta) meta.textContent = "No files selected";
        }
      } else {
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Browsing requires Electron app";
      }
    } catch (err) {
      console.error("Browse failed:", err);
      const meta = document.querySelector("#local-files-meta");
      if (meta) meta.textContent = "Browse failed";
    }
  });

  dz.addEventListener("dragenter", enter);
  dz.addEventListener("dragover", over);
  dz.addEventListener("dragleave", leave);
  dz.addEventListener("drop", async (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("dragover");

      const dt = e.dataTransfer;
      if (!dt) return;

      // Only process individual audio files
      const audioFiles = [];
      let iTunesFiles = [];

      if (dt.files && dt.files.length > 0) {
        console.log("=== DRAG SOURCE DEBUG ===");

        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files[i];

          console.log(`File ${i} from drag:`, {
            name: f.name,
            path: f.path,
            type: f.type,
            size: f.size,
            webkitRelativePath: f.webkitRelativePath,
          });

          // Only accept audio files
          if (isAudioPath(f.name)) {
            // Check if we have a valid file path
            if (f.path) {
              // File from Finder or file system - has full path
              audioFiles.push(f.path);
              console.log(`Added file with path: ${f.path}`);
            } else {
              // File from iTunes or other app - no path, just filename
              console.log(
                `File from ${f.name} has no path - trying to find it...`
              );
              iTunesFiles.push({
                name: f.name,
                size: f.size,
                type: f.type,
              });
            }
          }
        }

        // Try to resolve iTunes files by searching the file system
        if (iTunesFiles.length > 0) {
          const meta = document.querySelector("#local-files-meta");
          if (meta) {
            meta.textContent = `Searching for ${iTunesFiles.length} file(s) from iTunes/Music app...`;
          }

          let resolvedCount = 0;

          for (const iTunesFile of iTunesFiles) {
            try {
              console.log(
                `Searching for: ${iTunesFile.name} (size: ${iTunesFile.size})`
              );

              // Use Electron's native file search instead of backend API
              let resp;
              if (window.electronAPI && window.electronAPI.findFile) {
                const searchSize = iTunesFile.size > 0 ? iTunesFile.size : null;
                resp = await window.electronAPI.findFile(
                  iTunesFile.name,
                  searchSize
                );
              } else {
                // Fallback to backend API if not in Electron
                if (iTunesFile.size > 0) {
                  resp = await api(
                    `/api/find-file?name=${encodeURIComponent(
                      iTunesFile.name
                    )}&size=${iTunesFile.size}`
                  );
                } else {
                  console.log(
                    `File has size 0, searching without size constraint...`
                  );
                  resp = await api(
                    `/api/find-file?name=${encodeURIComponent(iTunesFile.name)}`
                  );
                }
              }

              if (resp.files && resp.files.length > 0) {
                // Found the file! Use the first match (they should be identical if size matches)
                const foundFile = resp.files[0];
                audioFiles.push(foundFile.path);
                resolvedCount++;
                console.log(`✅ Found iTunes file: ${foundFile.path}`);
              } else {
                console.warn(
                  `❌ Could not find iTunes file: ${iTunesFile.name}`
                );
                console.log(
                  "Searched paths:",
                  resp.searched_paths || "unknown"
                );
                if (resp.debug) {
                  console.log("Search debug info:", resp.debug);
                }
              }
            } catch (searchError) {
              console.error(
                `Error searching for ${iTunesFile.name}:`,
                searchError
              );
            }
          }

          // Update the message based on results
          if (meta) {
            const totalCount = iTunesFiles.length;
            if (resolvedCount === totalCount) {
              meta.textContent = `✅ Found all ${resolvedCount} iTunes files!`;
            } else if (resolvedCount > 0) {
              meta.textContent = `Found ${resolvedCount} of ${totalCount} iTunes files`;
            } else {
              meta.textContent = `❌ Could not locate any of the ${totalCount} iTunes files on disk`;
            }
          }
        }

        console.log("Final audio files to add:", audioFiles);
        console.log("iTunes files rejected:", iTunesFiles);
      }

      if (audioFiles.length === 0) {
        // Only show this message if we didn't try to resolve iTunes files
        if (iTunesFiles.length === 0) {
          const meta = document.querySelector("#local-files-meta");
          if (meta)
            meta.textContent =
              "Please drop audio files only. Use 'Choose Folder' button for directories.";
        }
        // If we had iTunes files but couldn't resolve any, the message is already set above
        return;
      }

      appendLocalFilePaths(audioFiles, "Loaded");
    } catch (err) {
      console.error("Drop failed:", err);
      const meta = document.querySelector("#local-files-meta");
      if (meta) meta.textContent = "Drop failed: " + err.message;
    }
  });
}

function renderResults(items) {
  const list = $("#results");
  list.innerHTML = "";
  const frag = document.createDocumentFragment();

  // Store items globally for "Add all" functionality
  window.__currentResultItems = items;

  items.forEach((it, idx) => {
    const div = document.createElement("div");
    div.className = "item";

    const addButton = document.createElement("button");
    addButton.className = "add-button";
    addButton.innerHTML = "+";
    addButton.title = "Add to queue";
    addButton.addEventListener("click", async () => {
      try {
        // Optimistic UI
        const optimistic = [
          {
            id: "temp-" + Math.random().toString(36).slice(2),
            url: it.url,
            title: it.title || it.url,
            status: "queued",
            progress: 0,
          },
        ];
        injectOptimisticQueue(optimistic);

        await api("/api/queue", {
          method: "POST",
          body: JSON.stringify({
            urls: [it.url],
            folder: getCurrentFolder(),
          }),
        });
        await refreshQueue();
      } catch (e) {
        console.error("Failed to add to queue:", e);
        const meta = document.querySelector("#results-meta");
        if (meta) meta.textContent = "Error adding to queue: " + e.message;
        await refreshQueue();
      }
    });

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = it.title || it.url;

    const meta = document.createElement("div");
    meta.className = "meta";
    const dur = document.createElement("span");
    dur.className = "badge";
    dur.textContent = fmtDuration(it.duration);
    const ch = document.createElement("span");
    ch.className = "badge";
    ch.textContent = it.channel || "Unknown";

    meta.appendChild(dur);
    meta.appendChild(ch);

    body.appendChild(title);
    body.appendChild(meta);

    div.appendChild(addButton);
    div.appendChild(body);

    frag.appendChild(div);
  });

  list.appendChild(frag);

  // Toggle 'Add all' visibility based on items not already in queue
  updateAddAllResultsVisibility();
}

function statusDotClass(status) {
  switch (status) {
    case "queued":
      return "status-queued";
    case "running":
      return "status-running";
    case "done":
      return "status-done";
    case "error":
      return "status-error";
    case "canceled":
      return "status-canceled";
    default:
      return "status-queued";
  }
}

function renderQueue(queueState) {
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
      // 30% for download, 70% for processing - smooth monotonic progress
      let overallProgress = 0;

      // Track per-item progress to prevent regression
      window.__itemProgress = window.__itemProgress || {};
      const itemKey = it.id || it.url;

      if (it.status === "done") {
        overallProgress = 1.0; // 100% complete
      } else if (it.processing) {
        // Processing phase: download is complete (30%) + splitting progress (30-100%)
        // The server provides granular splitting progress in item.progress (0-0.99)
        const splitProgress = it.progress || 0;
        overallProgress = 0.3 + splitProgress * 0.7; // Scale splitting to 30-99.3%
      } else if (it.downloaded) {
        // Downloaded but not yet processing: 30% complete
        overallProgress = 0.3;
      } else {
        // Download phase: scale download_progress to first 30% of overall progress
        const dlFrac =
          typeof it.download_progress === "number"
            ? it.download_progress
            : it.progress || 0;
        overallProgress = (dlFrac || 0) * 0.3; // Download is 30% of total process
      }

      // Prevent individual item progress regression, but allow phase transitions
      if (itemKey && window.__itemProgress[itemKey] !== undefined) {
        const lastProgress = window.__itemProgress[itemKey];

        // Allow progress reset in these cases:
        // 1. Item restarted (error or queued state)
        // 2. Transitioning from download to processing phase (around 30% mark)
        // 3. Major status change that indicates restart
        if (it.status === "error" || it.status === "queued") {
          // Item restarted - allow full reset
        } else if (
          it.processing &&
          lastProgress <= 0.35 &&
          overallProgress >= 0.3
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

      // Shimmer only when starting download (no progress yet)
      if (it.status === "running" && dlPct === 0) {
        bar.style.width = "0%";
        bar.style.animation = "progress-shimmer 1.2s linear infinite";
      } else {
        // Use real progress for all other cases (download, processing, done)
        bar.style.width = `${dlPct}%`;
        bar.style.animation = "none";
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
      procText.textContent = "Splitting tracks…";
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
      }
    } else if (
      it.status !== "queued" &&
      it.downloaded &&
      it.status !== "done"
    ) {
      // Optional: show "Splitting pending…" text if downloaded but not marked processing yet
      const procPending = document.createElement("span");
      procPending.className = "phase-badge";
      procPending.textContent = "Queued for splitting…";
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
      cancel.addEventListener("click", async () => {
        try {
          await api(`/api/cancel/${encodeURIComponent(it.id)}`, {
            method: "POST",
          });
          await refreshQueue();
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

          await refreshQueue();
        } catch (e) {
          console.error("Failed to retry:", e);
          const counts = document.querySelector("#queue-counts");
          if (counts) counts.textContent = "Error retrying: " + e.message;
          await refreshQueue();
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

// Track last known progress to prevent regression
// Reset tracking to fix any stuck states
window.__lastGlobalProgress = 0;
window.__lastItemCount = 0;
window.__itemProgress = {};

async function refreshProgress() {
  try {
    // Pull both progress and queue to compute adjusted counts without backend changes
    const [p, q] = await Promise.all([api("/api/progress"), api("/api/queue")]);

    // Calculate global progress based on individual item progress using same 30/70 split
    const items = (q && q.items) || [];
    let totalProgress = 0;

    if (items.length > 0) {
      items.forEach((it) => {
        let itemProgress = 0;

        if (it.status === "done") {
          itemProgress = 1.0;
        } else if (it.processing) {
          // Processing: 30% complete + 70% * splitting progress
          const splitProgress = it.progress || 0;
          itemProgress = 0.3 + splitProgress * 0.7;
        } else if (it.downloaded) {
          // Downloaded but not processing: 30%
          itemProgress = 0.3;
        } else if (it.status === "running") {
          // Download phase: scale download_progress to first 30%
          const dlFrac =
            typeof it.download_progress === "number"
              ? it.download_progress
              : it.progress || 0;
          itemProgress = (dlFrac || 0) * 0.3;
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
    } catch {}

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
    // Ignore transient errors
  }
}

async function refreshQueue() {
  try {
    const q = await api("/api/queue");
    renderQueue(q);
  } catch (e) {
    // ignore
  }
}

async function refreshConfig() {
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
  } catch {}
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
    // Silent failure; no status UI
  }
}

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
          } catch {}
        }
      }
      // Mark as done regardless to avoid repeated prompts within the session
      localStorage.setItem("ytdl_first_run_prompt_done", "1");
    }
  } catch {}

  // Initialize concurrency UI if present
  (async () => {
    try {
      try {
        await api("/api/concurrency", {
          method: "POST",
          body: JSON.stringify({ max: 6 }),
        });
      } catch {}
      const data = await api("/api/concurrency");
      const input = document.querySelector("#concurrency-input");
      const label = document.querySelector("#concurrency-label");
      const status = document.querySelector("#concurrency-status");
      if (input) {
        const serverMax =
          typeof data.serverMax === "number" ? data.serverMax : 64;
        input.min = "1";
        input.max = String(serverMax);
        input.step = "1";
        input.value = String(data.max ?? 6);
        input.addEventListener("input", (e) => {
          if (label)
            label.textContent = `Parallel downloads: ${e.target.value}`;
        });
        let postTimer = null;
        const post = async (val) => {
          try {
            await api("/api/concurrency", {
              method: "POST",
              body: JSON.stringify({ max: Number(val) }),
            });
          } catch (e) {
            // revert to last known from server on failure
            try {
              const p = await api("/api/progress");
              const max = (p.concurrency && p.concurrency.max) || 6;
              input.value = String(max);
              if (label) label.textContent = `Parallel downloads: ${max}`;
            } catch {}
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
      if (status)
        status.textContent = `active ${data.active ?? 0} / ${data.max ?? 6}`;
    } catch {}
  })();

  // event handlers

  // Advanced: detect browser defaults (best-effort heuristic on platform)
  const detectBrowser = () => {
    const el = document.querySelector("#cfg-cookies-browser");
    if (!el || el.value) return;
    const candidates = ["chrome", "brave", "edge", "firefox", "safari"];
    el.value = candidates[0];
  };
  if (document.querySelector("#cfg-detect-browser")) {
    document
      .querySelector("#cfg-detect-browser")
      .addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        detectBrowser();
      });
  }
  if (document.querySelector("#cfg-clear-cookies")) {
    document
      .querySelector("#cfg-clear-cookies")
      .addEventListener("click", async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          const payload = { cookies_from_browser: {} };
          // Optimistically clear UI and local cache
          const b = document.querySelector("#cfg-cookies-browser");
          const p = document.querySelector("#cfg-cookies-profile");
          if (b) b.value = "";
          if (p) p.value = "";
          const cached = JSON.parse(
            localStorage.getItem("ytdl_config") || "{}"
          );
          localStorage.setItem(
            "ytdl_config",
            JSON.stringify({ ...cached, cookies_from_browser: {} })
          );
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

  const btnSearch = document.querySelector("#btn-search");
  if (btnSearch)
    btnSearch.addEventListener("click", async () => {
      const q = (document.querySelector("#search-query")?.value || "").trim();
      if (!q) return;

      // Clear previous search results
      $("#results").innerHTML = "";
      $("#results-meta").textContent = "Loading search…";
      const _addAllBtn1 = document.querySelector("#btn-add-all");
      if (_addAllBtn1) _addAllBtn1.style.display = "none";

      const requestId = `req-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      let progressTimer = null;
      const startProgressPolling = () => {
        stopProgressPolling();
        progressTimer = setInterval(async () => {
          try {
            const st = await api(
              `/api/listing-progress/${encodeURIComponent(requestId)}`
            );
            const phase = st.phase || "";
            const current = st.current || 0;
            const total = st.total || 0;
            if (phase === "listing") {
              $("#results-meta").textContent =
                total > 0
                  ? `Loading search… fetching list ${Math.min(
                      current,
                      total
                    )}/${total}`
                  : `Loading search… fetching list ${current}`;
            } else if (phase === "enriching") {
              $(
                "#results-meta"
              ).textContent = `Loading search… hydrating info ${current}/${total}`;
            } else if (phase === "error") {
              $("#results-meta").textContent = st.message || "Error";
            }
          } catch {}
        }, 300);
      };
      const stopProgressPolling = () => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };

      try {
        startProgressPolling();
        const res = await api(
          `/api/search?q=${encodeURIComponent(
            q
          )}&max=100&requestId=${encodeURIComponent(requestId)}`
        );
        stopProgressPolling();

        const items = res.items || [];
        $("#results-meta").textContent = `Showing ${items.length} results${
          res.warning ? ` • ${res.warning}` : ""
        }`;
        renderResults(items);
      } catch (e) {
        stopProgressPolling();
        $("#results-meta").textContent = `Error: ${e.message}`;
      }
    });

  const btnPlaylist = document.querySelector("#btn-playlist");
  if (btnPlaylist)
    btnPlaylist.addEventListener("click", async () => {
      const url = (document.querySelector("#playlist-url")?.value || "").trim();
      if (!url) return;

      // Clear previous search results
      $("#results").innerHTML = "";
      $("#results-meta").textContent = "Loading playlist…";
      const _addAllBtn2 = document.querySelector("#btn-add-all");
      if (_addAllBtn2) _addAllBtn2.style.display = "none";

      const requestId = `req-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;
      let progressTimer = null;
      const startProgressPolling = () => {
        stopProgressPolling();
        progressTimer = setInterval(async () => {
          try {
            const st = await api(
              `/api/listing-progress/${encodeURIComponent(requestId)}`
            );
            const phase = st.phase || "";
            const current = st.current || 0;
            const total = st.total || 0;
            if (phase === "listing") {
              $("#results-meta").textContent =
                total > 0
                  ? `Loading playlist… fetching list ${Math.min(
                      current,
                      total
                    )}/${total}`
                  : `Loading playlist… fetching list ${current}`;
            } else if (phase === "enriching") {
              $(
                "#results-meta"
              ).textContent = `Loading playlist… hydrating info ${current}/${total}`;
            } else if (phase === "error") {
              $("#results-meta").textContent = st.message || "Error";
            }
          } catch {}
        }, 300);
      };
      const stopProgressPolling = () => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };

      try {
        startProgressPolling();
        const res = await api(
          `/api/playlist?url=${encodeURIComponent(
            url
          )}&requestId=${encodeURIComponent(requestId)}`
        );
        stopProgressPolling();

        const items = res.items || [];
        $("#results-meta").textContent = `Playlist: ${items.length} items${
          res.warning ? ` • ${res.warning}` : ""
        }`;
        renderResults(items);
      } catch (e) {
        stopProgressPolling();
        $("#results-meta").textContent = `Error: ${e.message}`;
      }
    });

  const btnAddAll = document.querySelector("#btn-add-all");
  if (btnAddAll)
    btnAddAll.addEventListener("click", async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();

      // Guard against double clicks and Enter/Space keypress bubbling on the button
      const btn = $("#btn-add-all");
      if (btn.dataset.busy === "1") return;
      btn.dataset.busy = "1";
      btn.disabled = true;

      // Also guard against concurrent runs at the app level in case of multiple bindings
      if (window.__addingAll === true) {
        btn.disabled = false;
        btn.dataset.busy = "0";
        return;
      }
      window.__addingAll = true;

      try {
        const resultCards = $$("#results .item");
        // Get URLs from the current results items
        let urls = [];

        // We need to get the URLs from the rendered items - let's store them in data attributes
        // For now, we'll reconstruct from the current items array stored globally
        const currentItems = window.__currentResultItems || [];
        urls = currentItems.map((item) => item.url).filter(Boolean);

        // Use data-set-run marker to ensure we only add once per rendered result list
        const resultList = $("#results");
        const currentSetKey =
          "set-" +
          Array.from(resultCards)
            .map((n) => n.querySelector(".title")?.textContent || "")
            .join("|")
            .slice(0, 1000);
        if (resultList.dataset.lastAddAllKey === currentSetKey) {
          // We've already run Add All for this rendered set; exit
          return;
        }
        resultList.dataset.lastAddAllKey = currentSetKey;

        urls = Array.from(new Set(urls)); // per-run dedupe
        if (urls.length === 0) return;

        // Optimistic UI with dedupe vs existing optimistic entries and live queue items
        const existingOptimistic = new Set(
          (window.__optimisticQueue || []).map((x) => x.url)
        );
        // Attempt to dedupe against last-known server queue to prevent visual doubles
        let serverQueueSnapshot = [];
        try {
          const q = await api("/api/queue");
          serverQueueSnapshot = (q.items || []).map((x) => x.url);
        } catch {}
        const existingAll = new Set([
          ...existingOptimistic,
          ...serverQueueSnapshot,
        ]);

        const optimistic = urls
          .filter((u) => !existingAll.has(u))
          .map((u) => ({
            id: "temp-" + Math.random().toString(36).slice(2),
            url: u,
            title: u,
            status: "queued",
            progress: 0,
          }));
        if (optimistic.length > 0) {
          injectOptimisticQueue(optimistic);
        }

        // Batch POST in chunks to reduce server load on very large adds
        const chunkSize = 20;
        for (let i = 0; i < urls.length; i += chunkSize) {
          const batch = urls.slice(i, i + chunkSize);
          await api("/api/queue", {
            method: "POST",
            body: JSON.stringify({
              urls: batch,
              folder: getCurrentFolder(),
            }),
          });
        }
        await refreshQueue();
      } catch (e) {
        console.error("Failed to add to queue:", e);
        const meta = document.querySelector("#results-meta");
        if (meta) meta.textContent = "Error adding all: " + e.message;
        await refreshQueue();
      } finally {
        btn.disabled = false;
        btn.dataset.busy = "0";
        window.__addingAll = false;
      }
    });

  const btnStart = document.querySelector("#btn-start");
  if (btnStart)
    btnStart.addEventListener("click", async () => {
      try {
        await api("/api/start", { method: "POST" });
        await refreshQueue();
      } catch (e) {
        console.error("Failed to start:", e);
        const counts = document.querySelector("#queue-counts");
        if (counts) counts.textContent = "Failed to start: " + e.message;
      }
    });

  // Retry all failed items: re-enqueue every item currently in the queue with status === "error"
  if (document.querySelector("#btn-retry-all")) {
    document
      .querySelector("#btn-retry-all")
      .addEventListener("click", async () => {
        const btn = document.querySelector("#btn-retry-all");
        if (btn.dataset.busy === "1") return;
        btn.dataset.busy = "1";
        btn.disabled = true;
        try {
          // Snapshot current queue from server
          const q = await api("/api/queue");
          const failed = (q.items || []).filter((it) => it.status === "error");
          if (failed.length === 0) {
            btn.disabled = false;
            btn.dataset.busy = "0";
            return;
          }

          // Prepare URLs and dedupe
          const urls = Array.from(
            new Set(failed.map((it) => it.url).filter(Boolean))
          );

          // Optimistic UI for all failed items: mark as queued immediately
          const optimistic = failed.map((it) => ({
            id: "temp-" + Math.random().toString(36).slice(2),
            url: it.url,
            title: it.title || it.url,
            status: "queued",
            progress: 0,
          }));
          injectOptimisticQueue(optimistic);

          // Batch POST in chunks to avoid large payloads
          const chunkSize = 20;
          for (let i = 0; i < urls.length; i += chunkSize) {
            const batch = urls.slice(i, i + chunkSize);
            await api("/api/queue", {
              method: "POST",
              body: JSON.stringify({
                urls: batch,
                folder: getCurrentFolder(),
              }),
            });
          }

          await refreshQueue();
        } catch (e) {
          console.error("Failed to retry all:", e);
          const counts = document.querySelector("#queue-counts");
          if (counts) counts.textContent = "Failed to retry all: " + e.message;
          await refreshQueue();
        } finally {
          btn.disabled = false;
          btn.dataset.busy = "0";
        }
      });
  }

  // Stop all in-flight and pause queue
  if (document.querySelector("#btn-stop")) {
    document.querySelector("#btn-stop").addEventListener("click", async () => {
      try {
        await api("/api/stop", { method: "POST" });
        // immediate refresh to reflect canceled queued items; running will flip to canceled as workers terminate
        await refreshQueue();
        await refreshProgress();
      } catch (e) {
        console.error("Failed to stop:", e);
        const counts = document.querySelector("#queue-counts");
        if (counts) counts.textContent = "Failed to stop: " + e.message;
      }
    });
  }

  // Clear queue (if idle clears all, if running keeps in-flight only per server semantics)
  if (document.querySelector("#btn-clear")) {
    document.querySelector("#btn-clear").addEventListener("click", async () => {
      try {
        await api("/api/clear", { method: "POST" });
        await refreshQueue();
        await refreshProgress();
      } catch (e) {
        console.error("Failed to clear:", e);
        const counts = document.querySelector("#queue-counts");
        if (counts) counts.textContent = "Failed to clear: " + e.message;
      }
    });
  }

  // Adaptive polling for queue/progress:
  // - Start fast (1.5s). If three consecutive polls see empty queue and no activity, back off to 5s, then 10s.
  // - When activity resumes (queue non-empty or active>0), restore fast polling.
  (function setupAdaptivePolling() {
    let baseIntervalMs = 1500;
    let backoffStage = 0; // 0: 1.5s, 1: 5s, 2+: 10s
    let emptyStreak = 0;
    let pollTimer = null;

    const computeInterval = () => {
      if (backoffStage <= 0) return 1500;
      if (backoffStage === 1) return 5000;
      return 10000;
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
          if (emptyStreak >= 3) {
            // escalate backoff up to max stage
            if (backoffStage < 2) backoffStage += 1;
            // keep streak capped to avoid overflow
            emptyStreak = 3;
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
      } catch {
        // ignore transient errors; next tick will retry
      } finally {
        scheduleNext();
      }
    };

    // kick off
    scheduleNext();

    // progress polling remains at fast cadence but inexpensive; keep at 1.5s
    let progressTimer = null;
    const startProgressLoop = () => {
      if (progressTimer) return;
      progressTimer = setInterval(refreshProgress, 1500);
    };
    startProgressLoop();
  })();
}

// Electron directory picker implementation
function setupDirectoryPicker() {
  const outputInput = $("#cfg-output");
  const browseButton = $("#cfg-output-browse");
  const fileInput = $("#cfg-output-file-input");

  if (!outputInput || !browseButton) return;

  // Load saved path on startup, or use server default
  const savedPath = localStorage.getItem("ytdl_directory_path");
  if (savedPath) {
    outputInput.value = savedPath;
  } else {
    // No saved path - load from server config which has smart desktop default
    outputInput.placeholder = "Loading default path...";
    outputInput.value = "";
  }

  // Handle browse button click
  const handlePickDirectory = async () => {
    try {
      // Check if we're in Electron
      if (window.electronAPI && window.electronAPI.selectDirectory) {
        console.log("Using Electron directory picker...");
        const selectedPath = await window.electronAPI.selectDirectory();

        if (selectedPath) {
          outputInput.value = selectedPath;
          localStorage.setItem("ytdl_directory_path", selectedPath);
          console.log("Selected directory:", selectedPath);

          // Send to server to persist
          try {
            await api("/api/config", {
              method: "POST",
              body: JSON.stringify({ output_dir: selectedPath }),
            });
            console.log("Directory saved to server config");
          } catch (e) {
            console.error("Failed to save directory to server:", e);
          }
        }
      } else {
        console.log(
          "Electron API not available; browser directory selection cannot provide real filesystem paths."
        );
        // Fallback to web-based picker for development/browser mode
        if ("showDirectoryPicker" in window) {
          try {
            const directoryHandle = await window.showDirectoryPicker();
            // Browsers cannot expose absolute paths; reflect name only without persisting a fake path
            const dirName = directoryHandle && directoryHandle.name;
            outputInput.value = dirName ? dirName : "";
            console.log(
              "Selected directory handle (browser):",
              dirName || "unknown"
            );
          } catch (error) {
            if (error.name !== "AbortError") {
              console.error("Directory picker error:", error);
            }
          }
        } else if (fileInput) {
          // Ultimate fallback to webkitdirectory - opens a chooser but we do not persist a fake path
          fileInput.click();
        }
      }
    } catch (error) {
      console.error("Directory picker error:", error);
    }
  };

  browseButton.addEventListener("click", handlePickDirectory);
  // Remove click handler from input field to avoid confusion

  // Handle fallback webkitdirectory selection (only if fileInput exists)
  if (fileInput) {
    fileInput.addEventListener("change", (event) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        const firstFile = files[0];
        const relativePath = firstFile.webkitRelativePath;

        if (relativePath) {
          const folderName = relativePath.split("/")[0] || "";
          // In browsers we cannot know the absolute path; reflect folder name only and do not persist as output_dir
          outputInput.value = folderName;
          console.log(
            "Selected directory (webkit fallback, sandboxed):",
            folderName
          );
        }
      }
    });
  }
}

// Tab switching functionality
function setupTabs() {
  const tabButtons = $$(".tab-button");
  const tabContents = $$(".tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      const targetTab = button.dataset.tab;

      // Remove active class from all buttons and contents
      tabButtons.forEach((btn) => btn.classList.remove("active"));
      tabContents.forEach((content) => content.classList.remove("active"));

      // Add active class to clicked button and corresponding content
      button.classList.add("active");
      const targetContent = document.getElementById(`${targetTab}-tab`);
      if (targetContent) {
        targetContent.classList.add("active");
      }
    });
  });
}

// Render local files list
function renderLocalFiles(files) {
  const list = $("#local-files-list");
  list.innerHTML = "";
  const frag = document.createDocumentFragment();

  // Store files globally for reference
  window.__currentLocalFiles = files;

  files.forEach((file, idx) => {
    const div = document.createElement("div");
    div.className = "item";

    const addButton = document.createElement("button");
    addButton.className = "add-button";
    addButton.innerHTML = "+";
    addButton.title = "Add to queue";
    addButton.addEventListener("click", async () => {
      try {
        await api("/api/queue-local", {
          method: "POST",
          body: JSON.stringify({
            files: [file.path],
            folder: getCurrentFolder(),
          }),
        });
        // Remove this file from pending local list and re-render
        localFiles = (localFiles || []).filter((f) => f.path !== file.path);
        renderLocalFiles(localFiles);
        await refreshQueue();
      } catch (e) {
        console.error("Failed to add local file to queue:", e);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Failed to add file: " + e.message;
      }
    });

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = file.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    const path = document.createElement("span");
    path.className = "badge";
    path.textContent = file.path;

    meta.appendChild(path);
    body.appendChild(title);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    div.appendChild(addButton);
    div.appendChild(body);
    div.appendChild(actions);

    frag.appendChild(div);
  });

  list.appendChild(frag);

  // Update meta text
  $("#local-files-meta").textContent = `${files.length} files loaded`;

  // Toggle "Add all" button visibility based on pending-local vs queue
  updateAddAllLocalVisibility(files);
}

// Setup local file functionality
function setupLocalFiles() {
  const btnSelectFiles = $("#btn-select-files");
  const btnSelectDirectory = $("#btn-select-directory");
  const btnChooseFolder = $("#btn-choose-folder");
  const btnAddSelected = $("#btn-add-local-selected");
  const btnAddAll = $("#btn-add-local-all");

  // Choose Folder button
  if (btnChooseFolder)
    btnChooseFolder.addEventListener("click", async () => {
      try {
        if (window.electronAPI && window.electronAPI.selectAudioDirectory) {
          const directoryPath = await window.electronAPI.selectAudioDirectory();
          if (directoryPath) {
            const meta = document.querySelector("#local-files-meta");
            if (meta) meta.textContent = "Scanning folder...";

            try {
              const response = await api(
                `/api/scan-directory?path=${encodeURIComponent(directoryPath)}`
              );
              if (response && response.files) {
                const audioFiles = response.files
                  .filter((file) => isAudioPath(file.name))
                  .map((file) => file.path);

                if (audioFiles.length > 0) {
                  appendLocalFilePaths(
                    audioFiles,
                    `Found ${audioFiles.length} audio files`
                  );
                } else {
                  if (meta)
                    meta.textContent =
                      "No audio files found in selected folder";
                }
              }
            } catch (scanError) {
              console.error("Failed to scan directory:", scanError);
              if (meta)
                meta.textContent =
                  "Failed to scan folder: " + scanError.message;
            }
          }
        } else {
          console.warn("Folder selection requires Electron app");
          const meta = document.querySelector("#local-files-meta");
          if (meta) meta.textContent = "Folder selection requires Electron app";
        }
      } catch (error) {
        console.error("Folder selection error:", error);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Error selecting folder: " + error.message;
      }
    });

  // Selection button may not exist in unified UI; continue to bind remaining handlers

  // Select individual audio files
  if (btnSelectFiles)
    btnSelectFiles.addEventListener("click", async () => {
      try {
        if (window.electronAPI && window.electronAPI.selectAudioFiles) {
          const filePaths = await window.electronAPI.selectAudioFiles();
          if (filePaths && filePaths.length > 0) {
            const newFiles = filePaths.map((path) => ({
              path: path,
              name: path.split("/").pop() || path,
            }));
            // Deduplicate by path and render; do not auto-queue
            const byPath = new Map((localFiles || []).map((f) => [f.path, f]));
            for (const f of newFiles) byPath.set(f.path, f);
            localFiles = Array.from(byPath.values());
            renderLocalFiles(localFiles);
            const meta = document.querySelector("#local-files-meta");
            if (meta) meta.textContent = `Loaded ${newFiles.length} file(s)`;
          }
        } else {
          console.warn("File selection requires Electron app");
          const meta = document.querySelector("#local-files-meta");
          if (meta) meta.textContent = "File selection requires Electron app";
        }
      } catch (error) {
        console.error("File selection error:", error);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Error selecting files: " + error.message;
      }
    });

  // Select directory containing audio files
  if (btnSelectDirectory)
    btnSelectDirectory.addEventListener("click", async () => {
      try {
        if (window.electronAPI && window.electronAPI.selectAudioDirectory) {
          const directoryPath = await window.electronAPI.selectAudioDirectory();
          if (directoryPath) {
            // We'll need to implement directory scanning on the server side
            const response = await api(
              `/api/scan-directory?path=${encodeURIComponent(directoryPath)}`
            );
            if (response && response.files) {
              const newFiles = response.files.map((file) => ({
                path: file.path,
                name: file.name,
              }));
              localFiles = [...localFiles, ...newFiles];
              renderLocalFiles(localFiles);
              // Auto-queue scanned files immediately
              try {
                const filePaths = response.files.map((f) => f.path);
                if (filePaths.length) {
                  await api("/api/queue-local", {
                    method: "POST",
                    body: JSON.stringify({
                      files: filePaths,
                      folder: getCurrentFolder(),
                    }),
                  });
                  const meta = document.querySelector("#local-files-meta");
                  if (meta)
                    meta.textContent = `Queued ${filePaths.length} file(s)`;
                  await refreshQueue();
                }
              } catch (e) {
                console.error(
                  "Failed to auto-queue scanned directory files:",
                  e
                );
                const meta = document.querySelector("#local-files-meta");
                if (meta)
                  meta.textContent =
                    "Failed to queue scanned files: " + e.message;
              }
            }
          }
        } else {
          console.warn("Directory selection requires Electron app");
          const meta = document.querySelector("#local-files-meta");
          if (meta)
            meta.textContent = "Directory selection requires Electron app";
        }
      } catch (error) {
        console.error("Directory selection error:", error);
        const meta = document.querySelector("#local-files-meta");
        if (meta)
          meta.textContent = "Error selecting directory: " + error.message;
      }
    });

  // Add all local files to queue
  if (btnAddAll) {
    btnAddAll.addEventListener("click", async () => {
      if (localFiles.length === 0) return;

      const server = getServerQueueUrlSet();
      const optimistic = new Set(
        (window.__optimisticQueue || []).map((x) => x.url)
      );
      const pendingPaths = localFiles
        .map((f) => f.path)
        .filter(
          (p) => !server.has(`file://${p}`) && !optimistic.has(`file://${p}`)
        );
      if (pendingPaths.length === 0) {
        updateAddAllLocalVisibility(localFiles);
        return;
      }

      try {
        await api("/api/queue-local", {
          method: "POST",
          body: JSON.stringify({
            files: pendingPaths,
            folder: getCurrentFolder(),
          }),
        });
        // Remove just-queued files from pending and re-render
        localFiles = (localFiles || []).filter(
          (f) => !pendingPaths.includes(f.path)
        );
        renderLocalFiles(localFiles);
        await refreshQueue();
      } catch (e) {
        console.error("Failed to add local files to queue:", e);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Failed to add local files: " + e.message;
      }
    });
  }
}

// yt-dlp version and update UI
async function setupYtdlpUpdate() {
  const versionEl = $("#ytdlp-version");
  const statusEl = $("#ytdlp-update-status");
  const updateBtn = $("#btn-ytdlp-update");

  if (!versionEl || !updateBtn) return;

  // Fetch initial status
  const refreshYtdlpStatus = async () => {
    try {
      const status = await api("/api/ytdlp/status");
      if (status.current_version) {
        versionEl.textContent = `yt-dlp version: ${status.current_version}`;
      } else {
        versionEl.textContent = "yt-dlp version: unknown";
      }

      if (status.update_in_progress) {
        updateBtn.disabled = true;
        updateBtn.textContent = "Updating...";
        statusEl.textContent = "Update in progress...";
      } else {
        updateBtn.disabled = false;
        updateBtn.textContent = "Update yt-dlp";
      }

      if (status.last_check) {
        const lastCheck = new Date(status.last_check);
        const timeAgo = formatTimeAgo(lastCheck);
        if (!status.update_in_progress) {
          statusEl.textContent = `Last checked: ${timeAgo}`;
        }
      }
    } catch (e) {
      versionEl.textContent = "yt-dlp version: error fetching";
      console.error("Failed to get yt-dlp status:", e);
    }
  };

  // Format time ago helper
  const formatTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // Handle update button click
  updateBtn.addEventListener("click", async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = "Updating...";
    statusEl.textContent = "Checking for updates...";

    try {
      const result = await api("/api/ytdlp/update", { method: "POST" });

      if (result.success) {
        if (result.was_updated) {
          statusEl.textContent = result.message;
          statusEl.style.color = "#4caf50"; // green
        } else {
          statusEl.textContent = result.message;
          statusEl.style.color = ""; // default
        }
        if (result.version) {
          versionEl.textContent = `yt-dlp version: ${result.version}`;
        }
      } else {
        statusEl.textContent = `Update failed: ${result.message}`;
        statusEl.style.color = "#f44336"; // red
      }
    } catch (e) {
      statusEl.textContent = `Update error: ${e.message}`;
      statusEl.style.color = "#f44336";
      console.error("yt-dlp update failed:", e);
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = "Update yt-dlp";

      // Reset status color after a delay
      setTimeout(() => {
        statusEl.style.color = "";
      }, 5000);
    }
  });

  // Initial fetch
  await refreshYtdlpStatus();
}

document.addEventListener("DOMContentLoaded", () => {
  // Ensure we only bind boot once
  if (window.__bootBound) return;
  window.__bootBound = true;
  setupDirectoryPicker();
  setupTabs();
  setupLocalFiles();
  setupDropZone();
  setupYtdlpUpdate();
  boot();
});

// optimistic queue helpers
function injectOptimisticQueue(items) {
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
