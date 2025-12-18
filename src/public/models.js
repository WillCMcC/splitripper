/**
 * Demucs model management - selection, download, and UI
 */

import { $, api } from './api.js';

// Global state for models
window.__modelsData = null;
window.__isDownloading = false;

// Stem configuration mapping
export const STEM_CONFIGS = {
  "2": { stems: ["vocals", "instrumental"], label: "2 Stems" },
  "4": { stems: ["vocals", "drums", "bass", "other"], label: "4 Stems" },
  "6": { stems: ["vocals", "drums", "bass", "other", "piano", "guitar"], label: "6 Stems" },
};

/**
 * Load models configuration from server
 */
export async function loadModelsConfig() {
  try {
    const data = await api("/api/models");
    window.__modelsData = data;
    renderModelSelector(data);
    renderStemModeSelector(data);
    updateModelStatusBar();
    updateStemChips();
    renderModelDownloads(data);
  } catch (e) {
    console.error("Failed to load models config:", e);
  }
}

/**
 * Render model selector dropdown
 * @param {Object} data - Models data from server
 */
export function renderModelSelector(data) {
  const select = $("#cfg-demucs-model");
  if (!select) return;

  // Track if this is initial load using a data attribute marker
  // On initial load, we trust the server's is_selected flags
  // On subsequent renders (e.g., after model download), we preserve user's selection
  const isInitialLoad = !select.dataset.serverLoaded;
  const currentValue = isInitialLoad ? null : select.value;

  select.innerHTML = "";

  for (const model of data.models) {
    const opt = document.createElement("option");
    opt.value = model.name;
    let label = model.name;
    if (model.is_default) label += " *";
    opt.textContent = label;
    if (model.is_selected) opt.selected = true;
    select.appendChild(opt);
  }

  // Only restore previous selection if NOT initial load (user already interacted)
  if (currentValue && !isInitialLoad && [...select.options].some(o => o.value === currentValue)) {
    select.value = currentValue;
    // Sync current_model to match the restored dropdown value
    if (window.__modelsData) {
      window.__modelsData.current_model = currentValue;
      window.__modelsData.models.forEach(m => m.is_selected = m.name === currentValue);
    }
  }

  // Mark that we've loaded from server (for next render)
  select.dataset.serverLoaded = "true";

  // Remove old listener, add new
  const newSelect = select.cloneNode(true);
  select.parentNode.replaceChild(newSelect, select);

  // Explicitly set the value after cloning - cloneNode doesn't reliably preserve
  // the selected state set via JavaScript property assignment
  const selectedModel = data.models.find(m => m.is_selected);
  if (selectedModel) {
    newSelect.value = selectedModel.name;
  }

  newSelect.addEventListener("change", async () => {
    await handleModelChange(newSelect.value);
  });
}

/**
 * Handle model selection change - updates state and triggers download if needed
 * @param {string} model - Name of selected model
 */
export async function handleModelChange(model) {
  // Update local state immediately (optimistic update)
  if (window.__modelsData) {
    window.__modelsData.models.forEach(m => m.is_selected = m.name === model);
    window.__modelsData.current_model = model;
  }

  // If switching away from htdemucs_6s while stem mode is "6", drop to "4"
  // (only htdemucs_6s supports 6 stems)
  if (model !== "htdemucs_6s") {
    const stemSelect = $("#cfg-stem-mode");
    if (stemSelect && stemSelect.value === "6") {
      stemSelect.value = "4";
      // Update local state
      if (window.__modelsData) {
        window.__modelsData.stem_modes.forEach(m => m.is_selected = m.id === "4");
        window.__modelsData.current_stem_mode = "4";
      }
      // Update UI
      updateStemChips();
      // Persist stem mode change
      api("/api/config", {
        method: "POST",
        body: JSON.stringify({ stem_mode: "4" }),
      }).catch(e => console.error("Failed to update stem mode config:", e));
    }
  }

  // Check if model needs download
  const modelData = window.__modelsData?.models.find(m => m.name === model);
  const needsDownload = modelData && !modelData.downloaded;

  // If needs download, show downloading state immediately and start download
  if (needsDownload) {
    window.__isDownloading = true;
    updateModelStatusBar();

    // Save config in background
    api("/api/config", {
      method: "POST",
      body: JSON.stringify({ demucs_model: model }),
    }).catch(e => console.error("Failed to update model config:", e));

    // Start download immediately (auto-download)
    await autoDownloadModel(model);
  } else {
    // Model already downloaded - just update UI and save config
    updateModelStatusBar();

    api("/api/config", {
      method: "POST",
      body: JSON.stringify({ demucs_model: model }),
    }).catch(e => console.error("Failed to update model config:", e));
  }
}

/**
 * Render stem mode selector dropdown
 * @param {Object} data - Models data from server
 */
export function renderStemModeSelector(data) {
  const select = $("#cfg-stem-mode");
  if (!select) return;

  // Track if this is initial load using a data attribute marker
  // HTML has hardcoded options (2/4/6), so we can't rely on options.length
  // On initial load, we trust the server's is_selected flags
  // On subsequent renders (e.g., after model download), we preserve user's selection
  const isInitialLoad = !select.dataset.serverLoaded;
  const currentValue = isInitialLoad ? null : select.value;

  select.innerHTML = "";

  for (const mode of data.stem_modes) {
    const opt = document.createElement("option");
    opt.value = mode.id;
    opt.textContent = STEM_CONFIGS[mode.id]?.label || mode.label;
    if (mode.is_selected) opt.selected = true;
    select.appendChild(opt);
  }

  // Only restore previous selection if NOT initial load (user already interacted)
  if (currentValue && !isInitialLoad && [...select.options].some(o => o.value === currentValue)) {
    select.value = currentValue;
    if (window.__modelsData) {
      window.__modelsData.current_stem_mode = currentValue;
      window.__modelsData.stem_modes.forEach(m => m.is_selected = m.id === currentValue);
    }
  }

  // Mark that we've loaded from server (for next render)
  select.dataset.serverLoaded = "true";

  const newSelect = select.cloneNode(true);
  select.parentNode.replaceChild(newSelect, select);

  // Explicitly set the value after cloning - cloneNode doesn't reliably preserve
  // the selected state set via JavaScript property assignment
  const selectedMode = data.stem_modes.find(m => m.is_selected);
  if (selectedMode) {
    newSelect.value = selectedMode.id;
  }

  newSelect.addEventListener("change", async () => {
    const stemMode = newSelect.value;
    let updates = { stem_mode: stemMode };

    // Update local state immediately (optimistic update)
    if (window.__modelsData) {
      window.__modelsData.stem_modes.forEach(m => m.is_selected = m.id === stemMode);
      window.__modelsData.current_stem_mode = stemMode;
    }

    // Update stem chips immediately
    updateStemChips();

    // 6-stem requires htdemucs_6s - auto-switch and download if needed
    if (stemMode === "6") {
      updates.demucs_model = "htdemucs_6s";
      const modelSelect = $("#cfg-demucs-model");
      if (modelSelect) modelSelect.value = "htdemucs_6s";

      // Save config first
      api("/api/config", {
        method: "POST",
        body: JSON.stringify(updates),
      }).catch(e => console.error("Failed to update stem mode config:", e));

      // Use handleModelChange for consistent behavior (includes auto-download)
      await handleModelChange("htdemucs_6s");
    } else {
      // Just update UI and save config
      updateModelStatusBar();
      api("/api/config", {
        method: "POST",
        body: JSON.stringify(updates),
      }).catch(e => console.error("Failed to update stem mode config:", e));
    }
  });
}

/**
 * Update model status bar UI
 */
export function updateModelStatusBar() {
  const statusBar = $("#model-status-bar");
  const downloadBtn = $("#btn-quick-download");
  if (!statusBar || !window.__modelsData) return;

  // Use the data model as source of truth to avoid DOM sync issues
  const selectedModelName = window.__modelsData.current_model;
  const selectedModel = window.__modelsData.models.find(m => m.name === selectedModelName);

  // Ensure dropdown matches our state
  const modelSelect = $("#cfg-demucs-model");
  if (modelSelect && modelSelect.value !== selectedModelName) {
    modelSelect.value = selectedModelName;
  }

  statusBar.classList.remove("ready", "missing", "downloading");

  // Clear existing content after the indicator
  const indicator = statusBar.querySelector(".status-indicator");
  statusBar.innerHTML = "";
  statusBar.appendChild(indicator);

  // Always hide manual download button - we auto-download
  if (downloadBtn) downloadBtn.style.display = "none";

  if (window.__isDownloading) {
    statusBar.classList.add("downloading");

    const progressContainer = document.createElement("div");
    progressContainer.className = "download-progress-container";

    const textRow = document.createElement("div");
    textRow.className = "download-progress-text";
    textRow.innerHTML = `<span class="spinner"></span> Downloading ${selectedModelName}...`;

    const progressBar = document.createElement("div");
    progressBar.className = "download-progress-bar";
    progressBar.innerHTML = `<div class="progress-fill indeterminate"></div>`;

    progressContainer.appendChild(textRow);
    progressContainer.appendChild(progressBar);
    statusBar.appendChild(progressContainer);
  } else if (selectedModel?.downloaded) {
    statusBar.classList.add("ready");
    const text = document.createElement("span");
    text.className = "status-text";
    text.textContent = `${selectedModelName} ready`;
    statusBar.appendChild(text);
  } else {
    // Model not downloaded - show preparing state (download will start automatically)
    statusBar.classList.add("downloading");

    const progressContainer = document.createElement("div");
    progressContainer.className = "download-progress-container";

    const textRow = document.createElement("div");
    textRow.className = "download-progress-text";
    textRow.innerHTML = `<span class="spinner"></span> Preparing to download ${selectedModelName} (~${selectedModel?.size_mb || "?"}MB)...`;

    const progressBar = document.createElement("div");
    progressBar.className = "download-progress-bar";
    progressBar.innerHTML = `<div class="progress-fill indeterminate"></div>`;

    progressContainer.appendChild(textRow);
    progressContainer.appendChild(progressBar);
    statusBar.appendChild(progressContainer);
  }
}

/**
 * Update stem chips display
 */
export function updateStemChips() {
  const container = $("#stem-chips");
  if (!container) return;

  const stemSelect = $("#cfg-stem-mode");
  const stemMode = stemSelect?.value || "2";
  const config = STEM_CONFIGS[stemMode];

  container.innerHTML = "";

  if (config) {
    config.stems.forEach((stem) => {
      const chip = document.createElement("span");
      chip.className = `stem-chip ${stem}`;
      chip.textContent = stem;
      container.appendChild(chip);
    });
  }
}

/**
 * Auto-download a model
 * @param {string} modelName - Name of model to download
 */
export async function autoDownloadModel(modelName) {
  if (!modelName) return;

  // Set downloading state if not already set
  if (!window.__isDownloading) {
    window.__isDownloading = true;
    updateModelStatusBar();
  }

  try {
    const result = await api("/api/models/download", {
      method: "POST",
      body: JSON.stringify({ model: modelName }),
    });

    window.__isDownloading = false;

    if (result.success) {
      await loadModelsConfig();
    } else {
      console.error(`Download failed: ${result.message}`);
      updateModelStatusBar();
    }
  } catch (e) {
    window.__isDownloading = false;
    console.error(`Download error: ${e.message || e}`);
    updateModelStatusBar();
  }
}

/**
 * Setup quick download button
 */
export function setupQuickDownload() {
  const btn = $("#btn-quick-download");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const modelName = window.__modelsData?.current_model;
    if (!modelName) return;

    await autoDownloadModel(modelName);
  });
}

/**
 * Setup download all models button
 */
export function setupDownloadAll() {
  const btn = $("#btn-download-all");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    if (!window.__modelsData) return;

    const missing = window.__modelsData.models.filter(m => !m.downloaded);
    if (missing.length === 0) {
      alert("All models are already downloaded!");
      return;
    }

    if (!confirm(`Download ${missing.length} models (~${missing.reduce((sum, m) => sum + m.size_mb, 0)}MB total)? This may take several minutes.`)) {
      return;
    }

    btn.disabled = true;
    const originalText = btn.textContent;

    for (let i = 0; i < missing.length; i++) {
      const model = missing[i];
      btn.textContent = `Downloading ${i + 1}/${missing.length}...`;

      try {
        await api("/api/models/download", {
          method: "POST",
          body: JSON.stringify({ model: model.name }),
        });
        // Refresh UI after each download to show progress
        await loadModelsConfig();
      } catch (e) {
        console.error(`Failed to download ${model.name}:`, e);
      }
    }

    btn.disabled = false;
    btn.textContent = originalText;
  });
}

/**
 * Render model downloads list in settings
 * @param {Object} data - Models data from server
 */
export function renderModelDownloads(data) {
  const container = $("#model-downloads");
  if (!container) return;

  container.innerHTML = "";

  for (const model of data.models) {
    const item = document.createElement("div");
    item.className = "model-download-item";
    if (model.is_default) item.classList.add("is-default");

    const info = document.createElement("div");
    info.className = "model-info";

    const name = document.createElement("div");
    name.className = "model-name";
    name.textContent = model.name;

    if (model.is_default) {
      const tag = document.createElement("span");
      tag.className = "default-tag";
      tag.textContent = "Bundled";
      name.appendChild(tag);
    }

    const desc = document.createElement("div");
    desc.className = "model-desc";
    desc.textContent = `${model.description} - ${model.stems} stems - ~${model.size_mb}MB`;

    info.appendChild(name);
    info.appendChild(desc);

    const actions = document.createElement("div");
    actions.className = "model-actions";

    const status = document.createElement("span");
    status.className = `status-badge ${model.downloaded ? "downloaded" : "not-downloaded"}`;
    status.textContent = model.downloaded ? "Ready" : "Not Downloaded";

    actions.appendChild(status);

    if (!model.downloaded) {
      const downloadBtn = document.createElement("button");
      downloadBtn.className = "secondary download-btn";
      downloadBtn.textContent = "Download";
      downloadBtn.addEventListener("click", async () => {
        downloadBtn.disabled = true;
        downloadBtn.style.display = "none";
        status.className = "status-badge downloading";
        status.innerHTML = `<span class="mini-spinner"></span> Downloading`;

        // Add progress bar to the item
        const progressBar = document.createElement("div");
        progressBar.className = "item-progress";
        progressBar.innerHTML = `<div class="bar"></div>`;
        info.appendChild(progressBar);

        try {
          const result = await api("/api/models/download", {
            method: "POST",
            body: JSON.stringify({ model: model.name }),
          });

          if (result.success) {
            await loadModelsConfig();
          } else {
            status.className = "status-badge not-downloaded";
            status.textContent = "Failed";
            downloadBtn.style.display = "";
            downloadBtn.disabled = false;
            downloadBtn.textContent = "Retry";
            progressBar.remove();
          }
        } catch (e) {
          status.className = "status-badge not-downloaded";
          status.textContent = "Error";
          downloadBtn.style.display = "";
          downloadBtn.disabled = false;
          downloadBtn.textContent = "Retry";
          progressBar.remove();
        }
      });
      actions.appendChild(downloadBtn);
    } else if (!model.is_default) {
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "secondary delete-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", async () => {
        if (!confirm(`Delete ${model.name}?`)) return;
        deleteBtn.disabled = true;
        try {
          await api(`/api/models/${model.name}`, { method: "DELETE" });
          await loadModelsConfig();
        } catch (e) {
          deleteBtn.disabled = false;
        }
      });
      actions.appendChild(deleteBtn);
    }

    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  }
}

/**
 * Get current stem mode
 * @returns {string|null}
 */
export function getCurrentStemMode() {
  const select = $("#cfg-stem-mode");
  return select ? select.value : null;
}
