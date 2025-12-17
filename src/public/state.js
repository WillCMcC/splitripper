/**
 * Centralized frontend state management
 * 
 * Replaces scattered window.__* globals with a clean state module.
 */

// Queue state
let optimisticQueue = [];
let serverQueueUrls = new Set();

// Progress tracking
let lastGlobalProgress = 0;
let lastItemCount = 0;
const itemProgress = {};

// Results state
let currentResultItems = [];
let currentLocalFiles = [];

// Models state
let modelsData = null;

// UI state
let addingAll = false;
let bootBound = false;

// =============================================================================
// Queue State
// =============================================================================

/**
 * Get the optimistic queue items
 * @returns {Array}
 */
export function getOptimisticQueue() {
  return optimisticQueue;
}

/**
 * Set the optimistic queue items
 * @param {Array} items
 */
export function setOptimisticQueue(items) {
  optimisticQueue = items;
}

/**
 * Add items to the optimistic queue
 * @param {Array} items
 */
export function addToOptimisticQueue(items) {
  const existing = new Set(optimisticQueue.map((x) => x.url));
  const deduped = items.filter((x) => !existing.has(x.url));
  optimisticQueue = optimisticQueue.concat(deduped);
}

/**
 * Clear optimistic queue
 */
export function clearOptimisticQueue() {
  optimisticQueue = [];
}

/**
 * Filter optimistic queue by predicate
 * @param {Function} predicate
 */
export function filterOptimisticQueue(predicate) {
  optimisticQueue = optimisticQueue.filter(predicate);
}

/**
 * Get server queue URLs
 * @returns {Set}
 */
export function getServerQueueUrls() {
  return serverQueueUrls;
}

/**
 * Set server queue URLs
 * @param {Set|Array} urls
 */
export function setServerQueueUrls(urls) {
  serverQueueUrls = urls instanceof Set ? urls : new Set(urls);
}

// =============================================================================
// Progress State
// =============================================================================

/**
 * Get last global progress value
 * @returns {number}
 */
export function getLastGlobalProgress() {
  return lastGlobalProgress;
}

/**
 * Set last global progress value
 * @param {number} value
 */
export function setLastGlobalProgress(value) {
  lastGlobalProgress = value;
}

/**
 * Get last item count
 * @returns {number}
 */
export function getLastItemCount() {
  return lastItemCount;
}

/**
 * Set last item count
 * @param {number} value
 */
export function setLastItemCount(value) {
  lastItemCount = value;
}

/**
 * Get item progress for a specific item
 * @param {string} itemKey
 * @returns {number|undefined}
 */
export function getItemProgress(itemKey) {
  return itemProgress[itemKey];
}

/**
 * Set item progress for a specific item
 * @param {string} itemKey
 * @param {number} value
 */
export function setItemProgress(itemKey, value) {
  itemProgress[itemKey] = value;
}

/**
 * Check if item has progress
 * @param {string} itemKey
 * @returns {boolean}
 */
export function hasItemProgress(itemKey) {
  return itemKey in itemProgress;
}

// =============================================================================
// Results State
// =============================================================================

/**
 * Get current result items (search results)
 * @returns {Array}
 */
export function getCurrentResultItems() {
  return currentResultItems;
}

/**
 * Set current result items
 * @param {Array} items
 */
export function setCurrentResultItems(items) {
  currentResultItems = items;
}

/**
 * Get current local files
 * @returns {Array}
 */
export function getCurrentLocalFiles() {
  return currentLocalFiles;
}

/**
 * Set current local files
 * @param {Array} files
 */
export function setCurrentLocalFiles(files) {
  currentLocalFiles = files;
}

// =============================================================================
// Models State
// =============================================================================

/**
 * Get models data
 * @returns {Object|null}
 */
export function getModelsData() {
  return modelsData;
}

/**
 * Set models data
 * @param {Object} data
 */
export function setModelsData(data) {
  modelsData = data;
}


// =============================================================================
// UI State
// =============================================================================

/**
 * Check if "Add All" is in progress
 * @returns {boolean}
 */
export function isAddingAll() {
  return addingAll;
}

/**
 * Set "Add All" state
 * @param {boolean} value
 */
export function setAddingAll(value) {
  addingAll = value;
}

/**
 * Check if boot is bound
 * @returns {boolean}
 */
export function isBootBound() {
  return bootBound;
}

/**
 * Set boot bound state
 * @param {boolean} value
 */
export function setBootBound(value) {
  bootBound = value;
}

// =============================================================================
// Legacy window.__ compatibility layer (for gradual migration)
// =============================================================================

// Install getters/setters on window for backward compatibility
// This allows existing code to continue working while we migrate
if (typeof window !== 'undefined') {
  Object.defineProperties(window, {
    __optimisticQueue: {
      get: () => optimisticQueue,
      set: (v) => { optimisticQueue = v; },
      configurable: true,
    },
    __serverQueueUrls: {
      get: () => serverQueueUrls,
      set: (v) => { serverQueueUrls = v instanceof Set ? v : new Set(v); },
      configurable: true,
    },
    __lastGlobalProgress: {
      get: () => lastGlobalProgress,
      set: (v) => { lastGlobalProgress = v; },
      configurable: true,
    },
    __lastItemCount: {
      get: () => lastItemCount,
      set: (v) => { lastItemCount = v; },
      configurable: true,
    },
    __itemProgress: {
      get: () => itemProgress,
      set: (v) => { Object.assign(itemProgress, v); },
      configurable: true,
    },
    __currentResultItems: {
      get: () => currentResultItems,
      set: (v) => { currentResultItems = v; },
      configurable: true,
    },
    __currentLocalFiles: {
      get: () => currentLocalFiles,
      set: (v) => { currentLocalFiles = v; },
      configurable: true,
    },
    __modelsData: {
      get: () => modelsData,
      set: (v) => { modelsData = v; },
      configurable: true,
    },
    __addingAll: {
      get: () => addingAll,
      set: (v) => { addingAll = v; },
      configurable: true,
    },
    __bootBound: {
      get: () => bootBound,
      set: (v) => { bootBound = v; },
      configurable: true,
    },
  });
}
