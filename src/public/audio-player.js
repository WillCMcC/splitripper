/**
 * Audio player functionality for splits playback
 */

import { loadAndDrawWaveform } from './waveform.js';

// Player state
let currentAudio = null;
let currentPlayingPath = null;
let currentTrackEl = null;
let animationFrameId = null;

/**
 * Get current audio element
 * @returns {HTMLAudioElement|null}
 */
export function getCurrentAudio() {
  return currentAudio;
}

/**
 * Get current playing path
 * @returns {string|null}
 */
export function getCurrentPlayingPath() {
  return currentPlayingPath;
}

/**
 * Get current track element
 * @returns {HTMLElement|null}
 */
export function getCurrentTrackEl() {
  return currentTrackEl;
}

/**
 * Format time in M:SS
 * @param {number} seconds 
 * @returns {string}
 */
export function formatTime(seconds) {
  if (!isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Update play button visual state
 * @param {HTMLElement} trackEl - Track element
 * @param {boolean} isPlaying - Whether audio is playing
 */
export function updatePlayButtonState(trackEl, isPlaying) {
  const playIcon = trackEl.querySelector(".player-play-btn .play-icon");
  const pauseIcon = trackEl.querySelector(".player-play-btn .pause-icon");

  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? "none" : "block";
    pauseIcon.style.display = isPlaying ? "block" : "none";
  }
}

/**
 * Update progress bar (waveform overlay)
 * @param {HTMLElement} trackEl - Track element
 * @param {number} ratio - Progress ratio (0-1)
 */
export function updateProgress(trackEl, ratio) {
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
 * @param {HTMLElement} trackEl - Track element
 */
export function updateCurrentTime(trackEl) {
  const timeEl = trackEl.querySelector(".player-current");
  if (timeEl && currentAudio) {
    timeEl.textContent = formatTime(currentAudio.currentTime);
  }
}

/**
 * Update duration display
 * @param {HTMLElement} trackEl - Track element
 */
export function updateDuration(trackEl) {
  const durationEl = trackEl.querySelector(".player-duration");
  if (durationEl && currentAudio) {
    durationEl.textContent = formatTime(currentAudio.duration);
  }
}

/**
 * Start progress animation
 */
export function startProgressAnimation() {
  stopProgressAnimation();

  const animate = () => {
    // Check that audio is still playing and track element is still in DOM
    if (currentAudio && currentTrackEl && !currentAudio.paused) {
      // Verify element is still connected to DOM (not removed by re-render)
      if (!currentTrackEl.isConnected) {
        console.warn("[AUDIO] Track element disconnected from DOM, stopping animation");
        stopProgressAnimation();
        return;
      }
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
export function stopProgressAnimation() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

/**
 * Hide player UI for a track
 * @param {HTMLElement} trackEl - Track element
 */
export function hidePlayer(trackEl) {
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
 * Stop current audio playback
 * @param {boolean} keepPlayerVisible - If true, don't hide the player UI (for stem switching)
 */
export function stopCurrentAudio(keepPlayerVisible = false) {
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
 * Play audio file with player UI
 * @param {string} filePath - Path to audio file
 * @param {string} stemType - Stem type name
 * @param {HTMLElement} trackEl - Track element
 * @param {HTMLElement} chip - Stem chip element
 */
export function playAudio(filePath, stemType, trackEl, chip) {
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
  const canvas = trackEl.querySelector(".player-waveform");
  if (canvas) {
    loadAndDrawWaveform(filePath, canvas);
  }

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
    const audio = /** @type {HTMLAudioElement} */ (e.target);
    const error = audio?.error;
    console.warn("[AUDIO] Audio error (non-fatal):", {
      code: error?.code,
      message: error?.message,
      networkState: audio?.networkState,
      readyState: audio?.readyState
    });
  });

  currentAudio.addEventListener("timeupdate", () => {
    if (currentAudio && currentTrackEl && currentTrackEl.isConnected) {
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
 * Handle player play/pause button click
 * @param {MouseEvent} e - Click event
 */
export function handlePlayerPlayPause(e) {
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
 * @param {MouseEvent} e - Click event
 */
export function handleWaveformClick(e) {
  if (!currentAudio) return;

  const container = /** @type {HTMLElement} */ (e.currentTarget);
  const rect = container.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

  currentAudio.currentTime = ratio * currentAudio.duration;
}

/**
 * Handle waveform drag to scrub
 * @param {MouseEvent} e - Mouse event
 */
export function handleWaveformDragStart(e) {
  if (!currentAudio) return;

  e.preventDefault();
  const container = /** @type {HTMLElement} */ (e.currentTarget);
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
