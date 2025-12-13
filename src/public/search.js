/**
 * Search and playlist functionality
 */

import { $, $$, api, getCurrentFolder } from './api.js';
import { renderResults } from './results.js';
import { injectOptimisticQueue } from './queue.js';

// Forward declaration for refreshQueue - will be set later
let _refreshQueue = null;

export function setRefreshQueue(fn) {
  _refreshQueue = fn;
}

/**
 * Create progress polling functions for search/playlist loading
 * @param {string} requestId - Request ID for progress tracking
 * @param {string} loadingPrefix - Text prefix for loading messages
 * @returns {Object} - Object with start and stop functions
 */
function createProgressPolling(requestId, loadingPrefix) {
  let progressTimer = null;

  const start = () => {
    stop();
    progressTimer = setInterval(async () => {
      try {
        const st = await api(`/api/listing-progress/${encodeURIComponent(requestId)}`);
        const phase = st.phase || "";
        const current = st.current || 0;
        const total = st.total || 0;
        if (phase === "listing") {
          $("#results-meta").textContent = total > 0
            ? `${loadingPrefix} fetching list ${Math.min(current, total)}/${total}`
            : `${loadingPrefix} fetching list ${current}`;
        } else if (phase === "enriching") {
          $("#results-meta").textContent = `${loadingPrefix} hydrating info ${current}/${total}`;
        } else if (phase === "error") {
          $("#results-meta").textContent = st.message || "Error";
        }
      } catch {}
    }, 300);
  };

  const stop = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  };

  return { start, stop };
}

/**
 * Setup search button handler
 */
export function setupSearchHandler() {
  const btnSearch = document.querySelector("#btn-search");
  if (!btnSearch) return;

  btnSearch.addEventListener("click", async () => {
    const q = (document.querySelector("#search-query")?.value || "").trim();
    if (!q) return;

    // Clear previous search results
    $("#results").innerHTML = "";
    $("#results-meta").textContent = "Loading search...";
    const addAllBtn = document.querySelector("#btn-add-all");
    if (addAllBtn) addAllBtn.style.display = "none";

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const polling = createProgressPolling(requestId, "Loading search...");

    try {
      polling.start();
      const res = await api(`/api/search?q=${encodeURIComponent(q)}&max=100&requestId=${encodeURIComponent(requestId)}`);
      polling.stop();

      const items = res.items || [];
      $("#results-meta").textContent = `Showing ${items.length} results${res.warning ? ` - ${res.warning}` : ""}`;
      renderResults(items);
    } catch (e) {
      polling.stop();
      $("#results-meta").textContent = `Error: ${e.message}`;
    }
  });
}

/**
 * Setup playlist button handler
 */
export function setupPlaylistHandler() {
  const btnPlaylist = document.querySelector("#btn-playlist");
  if (!btnPlaylist) return;

  btnPlaylist.addEventListener("click", async () => {
    const url = (document.querySelector("#playlist-url")?.value || "").trim();
    if (!url) return;

    // Clear previous search results
    $("#results").innerHTML = "";
    $("#results-meta").textContent = "Loading playlist...";
    const addAllBtn = document.querySelector("#btn-add-all");
    if (addAllBtn) addAllBtn.style.display = "none";

    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const polling = createProgressPolling(requestId, "Loading playlist...");

    try {
      polling.start();
      const res = await api(`/api/playlist?url=${encodeURIComponent(url)}&requestId=${encodeURIComponent(requestId)}`);
      polling.stop();

      const items = res.items || [];
      $("#results-meta").textContent = `Playlist: ${items.length} items${res.warning ? ` - ${res.warning}` : ""}`;
      renderResults(items);
    } catch (e) {
      polling.stop();
      $("#results-meta").textContent = `Error: ${e.message}`;
    }
  });
}

/**
 * Setup add all results button handler
 */
export function setupAddAllHandler() {
  const btnAddAll = document.querySelector("#btn-add-all");
  if (!btnAddAll) return;

  btnAddAll.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();

    // Guard against double clicks
    const btn = $("#btn-add-all");
    if (btn.dataset.busy === "1") return;
    btn.dataset.busy = "1";
    btn.disabled = true;

    // Guard against concurrent runs
    if (window.__addingAll === true) {
      btn.disabled = false;
      btn.dataset.busy = "0";
      return;
    }
    window.__addingAll = true;

    try {
      const resultCards = $$("#results .item");
      const currentItems = window.__currentResultItems || [];
      let urls = currentItems.map((item) => item.url).filter(Boolean);

      // Dedupe marker to ensure we only add once per rendered result list
      const resultList = $("#results");
      const currentSetKey = "set-" + Array.from(resultCards)
        .map((n) => n.querySelector(".title")?.textContent || "")
        .join("|").slice(0, 1000);
      if (resultList.dataset.lastAddAllKey === currentSetKey) return;
      resultList.dataset.lastAddAllKey = currentSetKey;

      urls = Array.from(new Set(urls));
      if (urls.length === 0) return;

      // Optimistic UI with dedupe
      const existingOptimistic = new Set((window.__optimisticQueue || []).map((x) => x.url));
      let serverQueueSnapshot = [];
      try {
        const q = await api("/api/queue");
        serverQueueSnapshot = (q.items || []).map((x) => x.url);
      } catch {}
      const existingAll = new Set([...existingOptimistic, ...serverQueueSnapshot]);

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
      console.error("Failed to add to queue:", e);
      const meta = document.querySelector("#results-meta");
      if (meta) meta.textContent = "Error adding all: " + e.message;
      if (_refreshQueue) await _refreshQueue();
    } finally {
      btn.disabled = false;
      btn.dataset.busy = "0";
      window.__addingAll = false;
    }
  });
}

/**
 * Setup all search-related handlers
 */
export function setupSearchHandlers() {
  setupSearchHandler();
  setupPlaylistHandler();
  setupAddAllHandler();
}
