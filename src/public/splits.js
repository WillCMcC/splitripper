/**
 * Splits tab functionality
 * Displays processed splits and enables drag-and-drop to DAW with playback
 */

import { $, api } from "./api.js";
import {
  playAudio,
  stopCurrentAudio,
  getCurrentAudio,
  getCurrentPlayingPath,
  getCurrentTrackEl,
  stopProgressAnimation,
  hidePlayer,
  handlePlayerPlayPause,
  handleWaveformClick,
  handleWaveformDragStart,
} from "./audio-player.js";

let splitsData = [];
let searchQuery = "";
let sortMode = "recent"; // "recent" or "alpha"

/**
 * Fetch splits from the API
 */
async function fetchSplits() {
  try {
    const response = await api("/api/splits");
    splitsData = response.tracks || [];
    return splitsData;
  } catch (err) {
    console.error("Failed to fetch splits:", err);
    return [];
  }
}

/**
 * Filter tracks based on search query
 */
function filterTracks(tracks, query) {
  if (!query || !query.trim()) return tracks;

  const lowerQuery = query.toLowerCase().trim();
  return tracks.filter(track => {
    const artist = (track.artist || "").toLowerCase();
    const title = (track.title || "").toLowerCase();
    return artist.includes(lowerQuery) || title.includes(lowerQuery);
  });
}

/**
 * Sort tracks based on sort mode
 */
function sortTracks(tracks, mode) {
  const sorted = [...tracks];

  if (mode === "alpha") {
    // Sort alphabetically by artist, then by title
    sorted.sort((a, b) => {
      const artistA = (a.artist || "").toLowerCase();
      const artistB = (b.artist || "").toLowerCase();
      if (artistA !== artistB) return artistA.localeCompare(artistB);
      const titleA = (a.title || "").toLowerCase();
      const titleB = (b.title || "").toLowerCase();
      return titleA.localeCompare(titleB);
    });
  } else {
    // "recent" mode: sort by mtime descending (most recent first)
    sorted.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  }

  return sorted;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Render a single track with its stems
 */
function renderTrack(track) {
  const stemTypes = Object.keys(track.stems);

  // Sort stems in a logical order
  const stemOrder = ["vocals", "instrumental", "drums", "bass", "piano", "guitar", "other"];
  stemTypes.sort((a, b) => {
    const aIdx = stemOrder.indexOf(a.toLowerCase());
    const bIdx = stemOrder.indexOf(b.toLowerCase());
    if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
    if (aIdx === -1) return 1;
    if (bIdx === -1) return -1;
    return aIdx - bIdx;
  });

  let stemsHtml = "";
  for (const stemType of stemTypes) {
    const filePath = track.stems[stemType];
    stemsHtml += `
      <div class="stem-chip draggable-stem"
           data-path="${escapeHtml(filePath)}"
           data-stem="${escapeHtml(stemType)}"
           draggable="true"
           title="Click to play, drag to DAW">
        <span class="stem-drag-hint"></span>
        <span class="stem-label">${escapeHtml(stemType)}</span>
      </div>
    `;
  }

  return `
    <div class="splits-track" role="listitem" data-track-id="${escapeHtml(track.artist + '/' + track.title)}">
      <div class="splits-track-main">
        <div class="splits-track-info">
          <span class="splits-track-title">${escapeHtml(track.title)}</span>
        </div>
        <div class="splits-track-stems">
          ${stemsHtml}
        </div>
      </div>
      <div class="splits-player" style="display: none;">
        <div class="player-controls">
          <button class="player-play-btn" aria-label="Play/Pause">
            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display:none"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
          <div class="player-stem-name"></div>
          <div class="player-times">
            <span class="player-time player-current">0:00</span>
            <span class="player-time-sep">/</span>
            <span class="player-time player-duration">0:00</span>
          </div>
        </div>
        <div class="player-waveform-container">
          <canvas class="player-waveform"></canvas>
          <div class="player-waveform-progress"></div>
          <div class="player-waveform-cursor"></div>
        </div>
      </div>
    </div>
  `;
}

/**
 * Render the splits list
 */
function renderSplits(tracks) {
  const listEl = $("#splits-list");
  const emptyEl = $("#splits-empty");

  if (!listEl) return;

  // Apply filtering and sorting
  let displayTracks = filterTracks(tracks, searchQuery);
  displayTracks = sortTracks(displayTracks, sortMode);

  if (!displayTracks || displayTracks.length === 0) {
    listEl.innerHTML = "";
    if (emptyEl) {
      // Show different message if filtering resulted in no matches
      if (tracks && tracks.length > 0 && searchQuery.trim()) {
        emptyEl.innerHTML = `<p class="muted">No splits match "${escapeHtml(searchQuery)}"</p>`;
      } else {
        emptyEl.innerHTML = `<p class="muted">No splits yet. Process some tracks to see them here.</p>`;
      }
      emptyEl.style.display = "block";
    }
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";

  // Group tracks by artist
  const byArtist = {};
  for (const track of displayTracks) {
    const artist = track.artist || "Unknown Artist";
    if (!byArtist[artist]) {
      byArtist[artist] = [];
    }
    byArtist[artist].push(track);
  }

  let html = "";

  // Get artist keys and sort them if in alpha mode
  let artistKeys = Object.keys(byArtist);
  if (sortMode === "alpha") {
    artistKeys.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  }

  for (const artist of artistKeys) {
    const artistTracks = byArtist[artist];
    html += `<div class="splits-artist-group">`;
    html += `<div class="splits-artist-header">${escapeHtml(artist)}</div>`;

    for (const track of artistTracks) {
      html += renderTrack(track);
    }

    html += `</div>`;
  }

  listEl.innerHTML = html;

  // Set up event listeners
  setupEventListeners(listEl);
}

/**
 * Handle stem chip click - start playback
 */
function handleStemClick(e) {
  // Don't trigger if dragging
  if (e.defaultPrevented) return;

  const chip = e.currentTarget;
  const filePath = chip.dataset.path;
  const stemType = chip.dataset.stem;
  const trackEl = chip.closest(".splits-track");

  if (!filePath || !trackEl) return;

  const currentAudio = getCurrentAudio();
  const currentPlayingPath = getCurrentPlayingPath();
  const currentTrackEl = getCurrentTrackEl();

  // If clicking the currently playing stem, toggle pause
  if (currentPlayingPath === filePath && currentAudio) {
    if (currentAudio.paused) {
      currentAudio.play();
    } else {
      currentAudio.pause();
    }
    return;
  }

  // Check if switching stems on the same track (keep player open)
  const currentTrackId = currentTrackEl?.dataset?.trackId;
  const newTrackId = trackEl.dataset.trackId;
  const sameTrack = currentTrackId && currentTrackId === newTrackId;

  // Stop current audio but keep player visible if same track
  if (currentAudio) {
    stopProgressAnimation();
    currentAudio.pause();
    currentAudio.src = "";

    // Remove active state from previous chip
    document.querySelectorAll(".stem-chip.active").forEach(c => c.classList.remove("active"));

    // Only hide player if switching to a different track
    if (!sameTrack && currentTrackEl) {
      hidePlayer(currentTrackEl);
    }
  }

  // Start new playback
  playAudio(filePath, stemType, trackEl, chip);
}

/**
 * Handle drag start - initiate native file drag via Electron
 */
function handleDragStart(e) {
  const filePath = e.target.closest(".stem-chip")?.dataset.path;

  if (!filePath) {
    e.preventDefault();
    return;
  }

  // Set drag data for web-based drops
  e.dataTransfer.effectAllowed = "copy";
  e.dataTransfer.setData("text/plain", filePath);
  e.dataTransfer.setData("text/uri-list", `file://${filePath}`);

  // If Electron API is available, use native file drag
  if (window.electronAPI?.startDrag) {
    window.electronAPI.startDrag(filePath);
  }

  // Visual feedback
  e.target.classList.add("dragging");

  const handleDragEnd = () => {
    e.target.classList.remove("dragging");
    e.target.removeEventListener("dragend", handleDragEnd);
  };
  e.target.addEventListener("dragend", handleDragEnd);
}

/**
 * Set up all event listeners
 */
function setupEventListeners(container) {
  // Stem chip click to play
  container.querySelectorAll(".stem-chip").forEach((el) => {
    el.addEventListener("click", handleStemClick);
    el.addEventListener("dragstart", handleDragStart);
  });

  // Player controls
  container.querySelectorAll(".player-play-btn").forEach((btn) => {
    btn.addEventListener("click", handlePlayerPlayPause);
  });

  // Waveform scrubbing
  container.querySelectorAll(".player-waveform-container").forEach((waveformContainer) => {
    waveformContainer.addEventListener("click", handleWaveformClick);
    waveformContainer.addEventListener("mousedown", handleWaveformDragStart);
  });
}

/**
 * Refresh splits list
 */
export async function refreshSplits() {
  const tracks = await fetchSplits();
  renderSplits(tracks);
}

/**
 * Stop any currently playing audio (exported for use when switching tabs)
 */
export function stopPlayback() {
  stopCurrentAudio();
}

/**
 * Set up the splits tab
 */
export function setupSplits() {
  const refreshBtn = $("#btn-refresh-splits");
  const searchInput = $("#splits-search");
  const sortBtns = document.querySelectorAll(".splits-sort-toggle .sort-btn");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshSplits);
  }

  // Search input handler with debounce
  if (searchInput) {
    let debounceTimer = null;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = e.target.value;
        renderSplits(splitsData);
      }, 150);
    });
  }

  // Sort toggle handlers
  sortBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const newSort = btn.dataset.sort;
      if (newSort === sortMode) return;

      sortMode = newSort;

      // Update button states
      sortBtns.forEach((b) => {
        const isActive = b.dataset.sort === sortMode;
        b.classList.toggle("active", isActive);
        b.setAttribute("aria-pressed", isActive);
      });

      renderSplits(splitsData);
    });
  });

  // Initial load
  refreshSplits();
}
