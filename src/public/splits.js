/**
 * Splits tab functionality
 * Displays processed splits and enables drag-and-drop to DAW with playback
 */

import { $, api } from "./api.js";

let splitsData = [];
let currentAudio = null;
let currentPlayingPath = null;
let currentTrackEl = null;
let animationFrameId = null;
let audioContext = null;
let waveformCache = new Map(); // Cache waveforms by file path
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
  container.querySelectorAll(".player-waveform-container").forEach((container) => {
    container.addEventListener("click", handleWaveformClick);
    container.addEventListener("mousedown", handleWaveformDragStart);
  });
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
    currentAudio = null;
    currentPlayingPath = null;

    // Remove active state from previous chip
    document.querySelectorAll(".stem-chip.active").forEach(c => c.classList.remove("active"));

    // Only hide player if switching to a different track
    if (!sameTrack && currentTrackEl) {
      hidePlayer(currentTrackEl);
      currentTrackEl = null;
    }
  }

  // Start new playback
  playAudio(filePath, stemType, trackEl, chip);
}

/**
 * Play audio file with player UI
 */
function playAudio(filePath, stemType, trackEl, chip) {
  const audioUrl = `/api/splits/file?path=${encodeURIComponent(filePath)}`;

  currentAudio = new Audio(audioUrl);
  currentPlayingPath = filePath;
  currentTrackEl = trackEl;

  // Show player UI
  const playerEl = trackEl.querySelector(".splits-player");
  const stemNameEl = trackEl.querySelector(".player-stem-name");

  if (playerEl) {
    playerEl.style.display = "flex";
    playerEl.classList.add("visible");
  }

  if (stemNameEl) {
    stemNameEl.textContent = stemType;
  }

  // Mark chip as active
  document.querySelectorAll(".stem-chip.active").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");

  // Load waveform (async, doesn't block playback)
  loadAndDrawWaveform(filePath, trackEl);

  // Set up audio events
  currentAudio.addEventListener("loadedmetadata", () => {
    updateDuration(trackEl);
  });

  currentAudio.addEventListener("play", () => {
    updatePlayButtonState(trackEl, true);
    startProgressAnimation();
  });

  currentAudio.addEventListener("pause", () => {
    updatePlayButtonState(trackEl, false);
    stopProgressAnimation();
  });

  currentAudio.addEventListener("ended", () => {
    updatePlayButtonState(trackEl, false);
    stopProgressAnimation();
    updateProgress(trackEl, 0);
  });

  currentAudio.addEventListener("error", (e) => {
    // Log error but don't hide player - transient errors are common when switching tracks
    // If audio truly fails, user will notice it's not playing
    const audio = e.target;
    const error = audio?.error;
    console.warn("[AUDIO] Audio error (non-fatal):", {
      code: error?.code,
      message: error?.message,
      networkState: audio?.networkState,
      readyState: audio?.readyState
    });
  });

  currentAudio.addEventListener("timeupdate", () => {
    if (currentAudio && currentTrackEl) {
      updateProgress(currentTrackEl, currentAudio.currentTime / currentAudio.duration);
      updateCurrentTime(currentTrackEl);
    }
  });

  currentAudio.play().catch((err) => {
    // Only hide on actual play failure (not AbortError from switching tracks)
    if (err.name !== "AbortError") {
      console.error("Failed to play audio:", err);
      hidePlayer(trackEl);
      chip.classList.remove("active");
    }
  });
}

/**
 * Load audio and generate/draw waveform
 */
async function loadAndDrawWaveform(filePath, trackEl) {
  const canvas = trackEl.querySelector(".player-waveform");
  if (!canvas) return;

  // Check cache first
  if (waveformCache.has(filePath)) {
    drawWaveform(canvas, waveformCache.get(filePath));
    return;
  }

  // Show loading state
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  // Draw loading placeholder
  ctx.fillStyle = "rgba(124, 143, 170, 0.2)";
  ctx.fillRect(0, 0, rect.width, rect.height);

  try {
    // Initialize audio context if needed
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Fetch the audio file
    const audioUrl = `/api/splits/file?path=${encodeURIComponent(filePath)}`;
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();

    // Decode audio data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    // Generate waveform data
    const waveformData = generateWaveformData(audioBuffer, Math.floor(rect.width));

    // Cache it
    waveformCache.set(filePath, waveformData);

    // Draw waveform
    drawWaveform(canvas, waveformData);
  } catch (err) {
    console.error("Failed to generate waveform:", err);
    // Draw fallback
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "rgba(124, 143, 170, 0.3)";
    for (let i = 0; i < rect.width; i += 3) {
      const h = Math.random() * rect.height * 0.6 + rect.height * 0.2;
      ctx.fillRect(i, (rect.height - h) / 2, 2, h);
    }
  }
}

/**
 * Generate waveform data from audio buffer
 */
function generateWaveformData(audioBuffer, numSamples) {
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  const samples = [];
  const blockSize = Math.floor(channelData.length / numSamples);

  for (let i = 0; i < numSamples; i++) {
    const start = i * blockSize;
    let sum = 0;
    let max = 0;

    for (let j = 0; j < blockSize; j++) {
      const val = Math.abs(channelData[start + j] || 0);
      sum += val;
      if (val > max) max = val;
    }

    // Use a mix of average and peak for better visual
    const avg = sum / blockSize;
    samples.push(avg * 0.7 + max * 0.3);
  }

  // Normalize
  const maxVal = Math.max(...samples, 0.01);
  return samples.map(s => s / maxVal);
}

/**
 * Draw waveform on canvas
 */
function drawWaveform(canvas, data) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  // Set canvas size accounting for device pixel ratio
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const barWidth = Math.max(2, width / data.length - 1);
  const gap = 1;

  ctx.clearRect(0, 0, width, height);

  // Draw bars
  ctx.fillStyle = "rgba(124, 143, 170, 0.4)";

  for (let i = 0; i < data.length; i++) {
    const x = (i / data.length) * width;
    const barHeight = Math.max(2, data[i] * height * 0.9);
    const y = (height - barHeight) / 2;

    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, 1);
    ctx.fill();
  }
}

/**
 * Stop current audio playback
 * @param {boolean} keepPlayerVisible - If true, don't hide the player UI (for stem switching)
 */
function stopCurrentAudio(keepPlayerVisible = false) {
  stopProgressAnimation();

  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio = null;
  }

  // Hide current player (unless switching stems on same track)
  if (currentTrackEl && !keepPlayerVisible) {
    hidePlayer(currentTrackEl);
  }

  // Remove active state from all chips
  document.querySelectorAll(".stem-chip.active").forEach(c => c.classList.remove("active"));

  currentPlayingPath = null;
  // Don't clear currentTrackEl if keeping player visible - playAudio will update it
  if (!keepPlayerVisible) {
    currentTrackEl = null;
  }
}

/**
 * Hide player UI for a track
 */
function hidePlayer(trackEl) {
  const playerEl = trackEl?.querySelector(".splits-player");
  if (playerEl) {
    playerEl.classList.remove("visible");
    setTimeout(() => {
      if (!playerEl.classList.contains("visible")) {
        playerEl.style.display = "none";
      }
    }, 200);
  }
}

/**
 * Update play button visual state
 */
function updatePlayButtonState(trackEl, isPlaying) {
  const playIcon = trackEl.querySelector(".player-play-btn .play-icon");
  const pauseIcon = trackEl.querySelector(".player-play-btn .pause-icon");

  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? "none" : "block";
    pauseIcon.style.display = isPlaying ? "block" : "none";
  }
}

/**
 * Update progress bar (waveform overlay)
 */
function updateProgress(trackEl, ratio) {
  const progressOverlay = trackEl.querySelector(".player-waveform-progress");
  const cursor = trackEl.querySelector(".player-waveform-cursor");

  if (progressOverlay) {
    progressOverlay.style.width = `${ratio * 100}%`;
  }
  if (cursor) {
    cursor.style.left = `${ratio * 100}%`;
  }
}

/**
 * Update current time display
 */
function updateCurrentTime(trackEl) {
  const timeEl = trackEl.querySelector(".player-current");
  if (timeEl && currentAudio) {
    timeEl.textContent = formatTime(currentAudio.currentTime);
  }
}

/**
 * Update duration display
 */
function updateDuration(trackEl) {
  const durationEl = trackEl.querySelector(".player-duration");
  if (durationEl && currentAudio) {
    durationEl.textContent = formatTime(currentAudio.duration);
  }
}

/**
 * Format time in M:SS
 */
function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Start progress animation
 */
function startProgressAnimation() {
  stopProgressAnimation();

  const animate = () => {
    if (currentAudio && currentTrackEl && !currentAudio.paused) {
      updateProgress(currentTrackEl, currentAudio.currentTime / currentAudio.duration);
      updateCurrentTime(currentTrackEl);
      animationFrameId = requestAnimationFrame(animate);
    }
  };

  animationFrameId = requestAnimationFrame(animate);
}

/**
 * Stop progress animation
 */
function stopProgressAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

/**
 * Handle player play/pause button click
 */
function handlePlayerPlayPause(e) {
  e.stopPropagation();

  if (currentAudio) {
    if (currentAudio.paused) {
      currentAudio.play();
    } else {
      currentAudio.pause();
    }
  }
}

/**
 * Handle waveform click to seek
 */
function handleWaveformClick(e) {
  if (!currentAudio) return;

  const container = e.currentTarget;
  const rect = container.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  currentAudio.currentTime = ratio * currentAudio.duration;
}

/**
 * Handle waveform drag to scrub
 */
function handleWaveformDragStart(e) {
  if (!currentAudio) return;

  e.preventDefault();
  const container = e.currentTarget;
  const wasPlaying = !currentAudio.paused;

  if (wasPlaying) {
    currentAudio.pause();
  }

  // Add scrubbing class for visual feedback
  container.classList.add("scrubbing");

  const onMove = (moveEvent) => {
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
    currentAudio.currentTime = ratio * currentAudio.duration;
    if (currentTrackEl) {
      updateProgress(currentTrackEl, ratio);
      updateCurrentTime(currentTrackEl);
    }
  };

  const onUp = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
    container.classList.remove("scrubbing");
    if (wasPlaying) {
      currentAudio.play();
    }
  };

  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
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
