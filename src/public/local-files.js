/**
 * Local file handling - drop zone, file selection, rendering
 */

import { $, api, getCurrentFolder } from './api.js';
import {
  isAudioPath,
  appendLocalFilePaths,
  updateAddAllLocalVisibility,
  getServerQueueUrlSet,
  localFiles,
  setLocalFiles,
  setRenderLocalFiles,
} from './utils.js';
import { resolveITunesFiles } from './file-resolver.js';

// Forward declaration for refreshQueue - will be set later
let _refreshQueue = null;

export function setRefreshQueue(fn) {
  _refreshQueue = fn;
}

/**
 * Render local files list
 * @param {Array} files - Array of file objects with path and name
 */
export function renderLocalFiles(files) {
  const list = $("#local-files-list");
  list.innerHTML = "";
  const frag = document.createDocumentFragment();

  // Store files globally for reference
  window.__currentLocalFiles = files;

  files.forEach((file, idx) => {
    const div = document.createElement("div");
    div.className = "item";

    const addButton = document.createElement("button");
    addButton.className = "add-button";
    addButton.innerHTML = "+";
    addButton.title = "Add to queue";
    addButton.addEventListener("click", async () => {
      try {
        await api("/api/queue-local", {
          method: "POST",
          body: JSON.stringify({
            files: [file.path],
            folder: getCurrentFolder(),
          }),
        });
        // Remove this file from pending local list and re-render
        const updatedFiles = (localFiles || []).filter((f) => f.path !== file.path);
        setLocalFiles(updatedFiles);
        renderLocalFiles(updatedFiles);
        if (_refreshQueue) await _refreshQueue();
      } catch (e) {
        console.error("Failed to add local file to queue:", e);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Failed to add file: " + e.message;
      }
    });

    const body = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    title.textContent = file.name;

    const meta = document.createElement("div");
    meta.className = "meta";
    const path = document.createElement("span");
    path.className = "badge";
    path.textContent = file.path;

    meta.appendChild(path);
    body.appendChild(title);
    body.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";

    div.appendChild(addButton);
    div.appendChild(body);
    div.appendChild(actions);

    frag.appendChild(div);
  });

  list.appendChild(frag);

  // Update meta text
  $("#local-files-meta").textContent = `${files.length} files loaded`;

  // Toggle "Add all" button visibility based on pending-local vs queue
  updateAddAllLocalVisibility(files);
}

// Register renderLocalFiles with utils so appendLocalFilePaths can call it
setRenderLocalFiles(renderLocalFiles);

/**
 * Setup drag & drop for audio files only into the drop-zone.
 * - Only accepts individual audio file drops
 * - Updates localFiles pending list (no auto-queue), dedupes by path, re-renders list.
 */
export function setupDropZone() {
  // Prevent default navigation for file drops anywhere in the window
  ["dragover", "drop"].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  const dz = document.querySelector("#drop-zone");
  if (!dz) {
    console.error("Drop zone element not found!");
    return;
  }
  console.log("Drop zone setup initialized");

  const enter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add("dragover");
  };
  const over = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.add("dragover");
    // Show copy cursor
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  const leave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dz.classList.remove("dragover");
  };

  // Click to browse (Electron file picker)
  dz.addEventListener("click", async () => {
    try {
      if (window.electronAPI && window.electronAPI.selectAudioFiles) {
        const filePaths = await window.electronAPI.selectAudioFiles();
        if (Array.isArray(filePaths) && filePaths.length) {
          appendLocalFilePaths(filePaths, "Loaded");
        } else {
          // User canceled or no files selected - don't fall back to directory picker
          const meta = document.querySelector("#local-files-meta");
          if (meta) meta.textContent = "No files selected";
        }
      } else {
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Browsing requires Electron app";
      }
    } catch (err) {
      console.error("Browse failed:", err);
      const meta = document.querySelector("#local-files-meta");
      if (meta) meta.textContent = "Browse failed";
    }
  });

  dz.addEventListener("dragenter", enter);
  dz.addEventListener("dragover", over);
  dz.addEventListener("dragleave", leave);
  dz.addEventListener("drop", async (e) => {
    try {
      e.preventDefault();
      e.stopPropagation();
      dz.classList.remove("dragover");

      const dt = e.dataTransfer;
      if (!dt) return;

      // Only process individual audio files
      const audioFiles = [];
      let iTunesFiles = [];

      if (dt.files && dt.files.length > 0) {
        console.log("=== DRAG SOURCE DEBUG ===");

        for (let i = 0; i < dt.files.length; i++) {
          const f = dt.files[i];

          console.log(`File ${i} from drag:`, {
            name: f.name,
            path: f.path,
            type: f.type,
            size: f.size,
            webkitRelativePath: f.webkitRelativePath,
          });

          // Only accept audio files
          if (isAudioPath(f.name)) {
            // Check if we have a valid file path
            if (f.path) {
              // File from Finder or file system - has full path
              audioFiles.push(f.path);
              console.log(`Added file with path: ${f.path}`);
            } else {
              // File from iTunes or other app - no path, just filename
              console.log(
                `File from ${f.name} has no path - trying to find it...`
              );
              iTunesFiles.push({
                name: f.name,
                size: f.size,
                type: f.type,
              });
            }
          }
        }

        // Try to resolve iTunes files by searching the file system
        if (iTunesFiles.length > 0) {
          const meta = document.querySelector("#local-files-meta");
          const { resolved } = await resolveITunesFiles(
            iTunesFiles,
            (msg) => { if (meta) meta.textContent = msg; }
          );
          audioFiles.push(...resolved);
        }

        console.log("Final audio files to add:", audioFiles);
        console.log("iTunes files rejected:", iTunesFiles);
      }

      if (audioFiles.length === 0) {
        // Only show this message if we didn't try to resolve iTunes files
        if (iTunesFiles.length === 0) {
          const meta = document.querySelector("#local-files-meta");
          if (meta)
            meta.textContent =
              "Please drop audio files only. Use 'Choose Folder' button for directories.";
        }
        // If we had iTunes files but couldn't resolve any, the message is already set above
        return;
      }

      appendLocalFilePaths(audioFiles, "Loaded");
    } catch (err) {
      console.error("Drop failed:", err);
      const meta = document.querySelector("#local-files-meta");
      if (meta) meta.textContent = "Drop failed: " + err.message;
    }
  });
}

/**
 * Setup local file functionality - buttons and handlers
 */
export function setupLocalFiles() {
  const btnSelectFiles = $("#btn-select-files");
  const btnSelectDirectory = $("#btn-select-directory");
  const btnChooseFolder = $("#btn-choose-folder");
  const btnAddSelected = $("#btn-add-local-selected");
  const btnAddAll = $("#btn-add-local-all");

  // Choose Folder button
  if (btnChooseFolder)
    btnChooseFolder.addEventListener("click", async () => {
      try {
        if (window.electronAPI && window.electronAPI.selectAudioDirectory) {
          const directoryPath = await window.electronAPI.selectAudioDirectory();
          if (directoryPath) {
            const meta = document.querySelector("#local-files-meta");
            if (meta) meta.textContent = "Scanning folder...";

            try {
              const response = await api(
                `/api/scan-directory?path=${encodeURIComponent(directoryPath)}`
              );
              if (response && response.files) {
                const audioFiles = response.files
                  .filter((file) => isAudioPath(file.name))
                  .map((file) => file.path);

                if (audioFiles.length > 0) {
                  appendLocalFilePaths(
                    audioFiles,
                    `Found ${audioFiles.length} audio files`
                  );
                } else {
                  if (meta)
                    meta.textContent =
                      "No audio files found in selected folder";
                }
              }
            } catch (scanError) {
              console.error("Failed to scan directory:", scanError);
              if (meta)
                meta.textContent =
                  "Failed to scan folder: " + scanError.message;
            }
          }
        } else {
          console.warn("Folder selection requires Electron app");
          const meta = document.querySelector("#local-files-meta");
          if (meta) meta.textContent = "Folder selection requires Electron app";
        }
      } catch (error) {
        console.error("Folder selection error:", error);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Error selecting folder: " + error.message;
      }
    });

  // Selection button may not exist in unified UI; continue to bind remaining handlers

  // Select individual audio files
  if (btnSelectFiles)
    btnSelectFiles.addEventListener("click", async () => {
      try {
        if (window.electronAPI && window.electronAPI.selectAudioFiles) {
          const filePaths = await window.electronAPI.selectAudioFiles();
          if (filePaths && filePaths.length > 0) {
            const newFiles = filePaths.map((path) => ({
              path: path,
              name: path.split("/").pop() || path,
            }));
            // Deduplicate by path and render; do not auto-queue
            const byPath = new Map((localFiles || []).map((f) => [f.path, f]));
            for (const f of newFiles) byPath.set(f.path, f);
            setLocalFiles(Array.from(byPath.values()));
            renderLocalFiles(localFiles);
            const meta = document.querySelector("#local-files-meta");
            if (meta) meta.textContent = `Loaded ${newFiles.length} file(s)`;
          }
        } else {
          console.warn("File selection requires Electron app");
          const meta = document.querySelector("#local-files-meta");
          if (meta) meta.textContent = "File selection requires Electron app";
        }
      } catch (error) {
        console.error("File selection error:", error);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Error selecting files: " + error.message;
      }
    });

  // Select directory containing audio files
  if (btnSelectDirectory)
    btnSelectDirectory.addEventListener("click", async () => {
      try {
        if (window.electronAPI && window.electronAPI.selectAudioDirectory) {
          const directoryPath = await window.electronAPI.selectAudioDirectory();
          if (directoryPath) {
            // We'll need to implement directory scanning on the server side
            const response = await api(
              `/api/scan-directory?path=${encodeURIComponent(directoryPath)}`
            );
            if (response && response.files) {
              const newFiles = response.files.map((file) => ({
                path: file.path,
                name: file.name,
              }));
              setLocalFiles([...localFiles, ...newFiles]);
              renderLocalFiles(localFiles);
              // Auto-queue scanned files immediately
              try {
                const filePaths = response.files.map((f) => f.path);
                if (filePaths.length) {
                  await api("/api/queue-local", {
                    method: "POST",
                    body: JSON.stringify({
                      files: filePaths,
                      folder: getCurrentFolder(),
                    }),
                  });
                  const meta = document.querySelector("#local-files-meta");
                  if (meta)
                    meta.textContent = `Queued ${filePaths.length} file(s)`;
                  if (_refreshQueue) await _refreshQueue();
                }
              } catch (e) {
                console.error(
                  "Failed to auto-queue scanned directory files:",
                  e
                );
                const meta = document.querySelector("#local-files-meta");
                if (meta)
                  meta.textContent =
                    "Failed to queue scanned files: " + e.message;
              }
            }
          }
        } else {
          console.warn("Directory selection requires Electron app");
          const meta = document.querySelector("#local-files-meta");
          if (meta)
            meta.textContent = "Directory selection requires Electron app";
        }
      } catch (error) {
        console.error("Directory selection error:", error);
        const meta = document.querySelector("#local-files-meta");
        if (meta)
          meta.textContent = "Error selecting directory: " + error.message;
      }
    });

  // Add all local files to queue
  if (btnAddAll) {
    btnAddAll.addEventListener("click", async () => {
      if (localFiles.length === 0) return;

      const server = getServerQueueUrlSet();
      const optimistic = new Set(
        (window.__optimisticQueue || []).map((x) => x.url)
      );
      const pendingPaths = localFiles
        .map((f) => f.path)
        .filter(
          (p) => !server.has(`file://${p}`) && !optimistic.has(`file://${p}`)
        );
      if (pendingPaths.length === 0) {
        updateAddAllLocalVisibility(localFiles);
        return;
      }

      try {
        await api("/api/queue-local", {
          method: "POST",
          body: JSON.stringify({
            files: pendingPaths,
            folder: getCurrentFolder(),
          }),
        });
        // Remove just-queued files from pending and re-render
        const updatedFiles = (localFiles || []).filter(
          (f) => !pendingPaths.includes(f.path)
        );
        setLocalFiles(updatedFiles);
        renderLocalFiles(updatedFiles);
        if (_refreshQueue) await _refreshQueue();
      } catch (e) {
        console.error("Failed to add local files to queue:", e);
        const meta = document.querySelector("#local-files-meta");
        if (meta) meta.textContent = "Failed to add local files: " + e.message;
      }
    });
  }
}
