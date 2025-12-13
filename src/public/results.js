/**
 * Search results rendering
 */

import { $, api, getCurrentFolder } from './api.js';
import { fmtDuration, updateAddAllResultsVisibility } from './utils.js';
import { injectOptimisticQueue } from './queue.js';

// Forward declaration for refreshQueue - will be set later
let _refreshQueue = null;

export function setRefreshQueue(fn) {
  _refreshQueue = fn;
}

/**
 * Render search results
 * @param {Array} items - Search result items
 */
export function renderResults(items) {
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
        if (_refreshQueue) await _refreshQueue();
      } catch (e) {
        console.error("Failed to add to queue:", e);
        const meta = document.querySelector("#results-meta");
        if (meta) meta.textContent = "Error adding to queue: " + e.message;
        if (_refreshQueue) await _refreshQueue();
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
