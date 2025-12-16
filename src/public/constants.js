/**
 * Frontend constants for SplitBoy.
 *
 * Centralizes magic numbers and configuration that were previously
 * scattered throughout app.js.
 */

// Progress tracking weights (must match server-side constants)
// Download phase takes ~30% of total time, Demucs processing takes ~70%
export const DOWNLOAD_PROGRESS_WEIGHT = 0.30;
export const PROCESSING_PROGRESS_WEIGHT = 0.70;

// Polling intervals (in milliseconds)
export const FAST_POLL_INTERVAL = 1000;   // More responsive progress updates
export const MEDIUM_POLL_INTERVAL = 3000;
export const SLOW_POLL_INTERVAL = 5000;
export const PROGRESS_UPDATE_THROTTLE = 80;

// Adaptive polling thresholds
export const EMPTY_STREAK_THRESHOLD = 3;

// Batch sizes for bulk operations
export const ADD_ALL_BATCH_SIZE = 20;

// UI debounce timers
export const CONCURRENCY_POST_DELAY = 250;

// Audio file extensions (for validation)
export const AUDIO_EXTENSIONS = new Set([
  "mp3", "wav", "flac", "aac", "m4a", "ogg", "wma", "opus"
]);

// App branding
export const APP_TITLE = "SplitBoy";
