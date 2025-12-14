/**
 * Utility functions
 */

import { $ } from './api.js';

// Local files storage - shared state
export let localFiles = [];

// Setter for localFiles (since we can't reassign the import directly)
export function setLocalFiles(files) {
  localFiles = files;
}

/**
 * Format duration in seconds to HH:MM:SS or MM:SS
 * @param {number} seconds
 * @returns {string}
 */
export function fmtDuration(seconds) {
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

/**
 * Apply filters to items (currently returns as-is)
 * @param {Array} items
 * @returns {Array}
 */
export function applyFilters(items) {
  // Filters removed: return items as-is
  return items;
}

/**
 * Get current server queue URLs as a Set
 * @returns {Set<string>}
 */
export function getServerQueueUrlSet() {
  try {
    return window.__serverQueueUrls instanceof Set
      ? window.__serverQueueUrls
      : new Set();
  } catch (e) {
    console.warn("Error getting server queue URLs:", e);
    return new Set();
  }
}

/**
 * Display an error message to the user.
 * @param {string} message - The error message
 * @param {string} [targetSelector] - Optional CSS selector for where to show error
 */
export function showError(message, targetSelector = "#queue-counts") {
  const target = document.querySelector(targetSelector);
  if (target) {
    target.textContent = `Error: ${message}`;
    target.classList.add("error");
    // Remove error class after 5 seconds
    setTimeout(() => target.classList.remove("error"), 5000);
  }
  console.error(message);
}

/**
 * Count pending items in results that are not in queue
 * @param {Array} items
 * @returns {number}
 */
export function countPendingResults(items) {
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

/**
 * Update visibility of "Add all" button for results
 */
export function updateAddAllResultsVisibility() {
  const btn = document.querySelector("#btn-add-all");
  if (!btn) return;
  const items = window.__currentResultItems || [];
  const pending = countPendingResults(items);
  btn.style.display = pending > 0 ? "" : "none";
}

/**
 * Convert local path to file:// URL
 * @param {string} p
 * @returns {string}
 */
export function localPathToUrl(p) {
  return typeof p === "string" ? `file://${p}` : "";
}

/**
 * Count pending local files not in queue
 * @param {Array} files
 * @returns {number}
 */
export function countPendingLocal(files) {
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

/**
 * Update visibility of "Add all" button for local files
 * @param {Array} files
 */
export function updateAddAllLocalVisibility(files) {
  const btn = document.querySelector("#btn-add-local-all");
  if (!btn) return;
  const pending = countPendingLocal(files || window.__currentLocalFiles || []);
  btn.style.display = pending > 0 ? "" : "none";
}

/**
 * Check if path is an audio file
 * @param {string} p
 * @returns {boolean}
 */
export function isAudioPath(p) {
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

/**
 * Get CSS class for status dot
 * @param {string} status
 * @returns {string}
 */
export function statusDotClass(status) {
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

// Forward declaration for renderLocalFiles - will be set by local-files.js
let _renderLocalFiles = null;

export function setRenderLocalFiles(fn) {
  _renderLocalFiles = fn;
}

/**
 * Append local file paths, dedupe, and re-render
 * @param {string[]} paths
 * @param {string} label
 */
export function appendLocalFilePaths(paths, label = "Loaded") {
  if (!Array.isArray(paths) || paths.length === 0) return;
  const newFiles = paths.map((p) => ({
    path: p,
    name: p.split("/").pop() || p,
  }));
  const byPath = new Map((localFiles || []).map((f) => [f.path, f]));
  for (const f of newFiles) byPath.set(f.path, f);
  localFiles = Array.from(byPath.values());
  if (_renderLocalFiles) {
    _renderLocalFiles(localFiles);
  }
  const meta = document.querySelector("#local-files-meta");
  if (meta) meta.textContent = `${label} ${newFiles.length} file(s)`;
}
