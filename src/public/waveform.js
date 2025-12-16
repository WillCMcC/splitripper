/**
 * Waveform generation and rendering utilities
 */

// Cached waveforms by file path
const waveformCache = new Map();

// Shared AudioContext instance
let audioContext = null;

/**
 * Get or create the shared AudioContext
 * @returns {AudioContext}
 */
export function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || /** @type {typeof AudioContext} */ (window["webkitAudioContext"]);
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

/**
 * Check if waveform is cached for a file path
 * @param {string} filePath - Path to the audio file
 * @returns {boolean}
 */
export function hasWaveformCached(filePath) {
  return waveformCache.has(filePath);
}

/**
 * Get cached waveform data
 * @param {string} filePath - Path to the audio file
 * @returns {number[]|undefined}
 */
export function getCachedWaveform(filePath) {
  return waveformCache.get(filePath);
}

/**
 * Cache waveform data
 * @param {string} filePath - Path to the audio file
 * @param {number[]} data - Waveform data
 */
export function cacheWaveform(filePath, data) {
  waveformCache.set(filePath, data);
}

/**
 * Generate waveform data from audio buffer
 * Uses chunked processing to avoid blocking the UI
 * @param {AudioBuffer} audioBuffer - Decoded audio buffer
 * @param {number} numSamples - Number of samples to generate
 * @returns {Promise<number[]>} Normalized waveform data (0-1)
 */
export async function generateWaveformData(audioBuffer, numSamples) {
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  const samples = [];
  const blockSize = Math.floor(channelData.length / numSamples);
  
  // Process in chunks to avoid blocking the UI
  const CHUNK_SIZE = 50; // Process 50 waveform samples per frame
  
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
    
    // Yield to the main thread periodically
    if (i > 0 && i % CHUNK_SIZE === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Normalize
  const maxVal = Math.max(...samples, 0.01);
  return samples.map(s => s / maxVal);
}

/**
 * Draw waveform on canvas
 * @param {HTMLCanvasElement} canvas - Canvas element
 * @param {number[]} data - Waveform data
 */
export function drawWaveform(canvas, data) {
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
 * Draw loading placeholder on canvas
 * @param {HTMLCanvasElement} canvas - Canvas element
 */
export function drawLoadingPlaceholder(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "rgba(124, 143, 170, 0.2)";
  ctx.fillRect(0, 0, rect.width, rect.height);
}

/**
 * Draw fallback random waveform (for errors)
 * @param {HTMLCanvasElement} canvas - Canvas element
 */
export function drawFallbackWaveform(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.fillStyle = "rgba(124, 143, 170, 0.3)";
  for (let i = 0; i < rect.width; i += 3) {
    const h = Math.random() * rect.height * 0.6 + rect.height * 0.2;
    ctx.fillRect(i, (rect.height - h) / 2, 2, h);
  }
}

/**
 * Load audio and generate waveform for a file
 * @param {string} filePath - Path to audio file
 * @param {HTMLCanvasElement} canvas - Canvas to draw on
 * @returns {Promise<void>}
 */
export async function loadAndDrawWaveform(filePath, canvas) {
  if (!canvas) return;

  // Check cache first
  if (hasWaveformCached(filePath)) {
    drawWaveform(canvas, getCachedWaveform(filePath));
    return;
  }

  // Show loading state
  drawLoadingPlaceholder(canvas);

  try {
    const audioCtx = getAudioContext();
    const rect = canvas.getBoundingClientRect();

    // Fetch the audio file
    const audioUrl = `/api/splits/file?path=${encodeURIComponent(filePath)}`;
    const response = await fetch(audioUrl);
    const arrayBuffer = await response.arrayBuffer();

    // Decode audio data
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    // Generate waveform data (async to avoid blocking UI)
    const waveformData = await generateWaveformData(audioBuffer, Math.floor(rect.width));

    // Cache it
    cacheWaveform(filePath, waveformData);

    // Draw waveform
    drawWaveform(canvas, waveformData);
  } catch (err) {
    console.error("Failed to generate waveform:", err);
    drawFallbackWaveform(canvas);
  }
}
