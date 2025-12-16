/**
 * Settings, tabs, and yt-dlp update functionality
 */

import { $, $$, api } from './api.js';
import { stopPlayback } from './splits.js';

/**
 * Setup directory picker for output folder
 */
export function setupDirectoryPicker() {
  const outputInput = $("#cfg-output");
  const browseButton = $("#cfg-output-browse");
  const fileInput = $("#cfg-output-file-input");

  if (!outputInput || !browseButton) return;

  // Load saved path on startup, or use server default
  const savedPath = localStorage.getItem("ytdl_directory_path");
  if (savedPath) {
    outputInput.value = savedPath;
  } else {
    // No saved path - load from server config which has smart desktop default
    outputInput.placeholder = "Loading default path...";
    outputInput.value = "";
  }

  // Handle browse button click
  const handlePickDirectory = async () => {
    try {
      // Check if we're in Electron
      if (window.electronAPI && window.electronAPI.selectDirectory) {
        console.log("Using Electron directory picker...");
        const selectedPath = await window.electronAPI.selectDirectory();

        if (selectedPath) {
          outputInput.value = selectedPath;
          localStorage.setItem("ytdl_directory_path", selectedPath);
          console.log("Selected directory:", selectedPath);

          // Send to server to persist
          try {
            await api("/api/config", {
              method: "POST",
              body: JSON.stringify({ output_dir: selectedPath }),
            });
            console.log("Directory saved to server config");
          } catch (e) {
            console.warn("Failed to save directory to server:", e);
          }
        }
      } else {
        console.log(
          "Electron API not available; browser directory selection cannot provide real filesystem paths."
        );
        // Fallback to web-based picker for development/browser mode
        if ("showDirectoryPicker" in window) {
          try {
            const directoryHandle = await window.showDirectoryPicker();
            // Browsers cannot expose absolute paths; reflect name only without persisting a fake path
            const dirName = directoryHandle && directoryHandle.name;
            outputInput.value = dirName ? dirName : "";
            console.log(
              "Selected directory handle (browser):",
              dirName || "unknown"
            );
          } catch (error) {
            if (error.name !== "AbortError") {
              console.error("Directory picker error:", error);
            }
          }
        } else if (fileInput) {
          // Ultimate fallback to webkitdirectory - opens a chooser but we do not persist a fake path
          fileInput.click();
        }
      }
    } catch (error) {
      console.error("Directory picker error:", error);
    }
  };

  browseButton.addEventListener("click", handlePickDirectory);
  // Remove click handler from input field to avoid confusion

  // Handle fallback webkitdirectory selection (only if fileInput exists)
  if (fileInput) {
    fileInput.addEventListener("change", (event) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        const firstFile = files[0];
        const relativePath = firstFile.webkitRelativePath;

        if (relativePath) {
          const folderName = relativePath.split("/")[0] || "";
          // In browsers we cannot know the absolute path; reflect folder name only and do not persist as output_dir
          outputInput.value = folderName;
          console.log(
            "Selected directory (webkit fallback, sandboxed):",
            folderName
          );
        }
      }
    });
  }
}

/**
 * Setup main tab switching functionality
 */
export function setupTabs() {
  const tabButtons = $$(".tab-button");
  const tabContents = $$(".tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", (e) => {
      const targetTab = button.dataset.tab;
      const currentTab = document.querySelector(".tab-button.active")?.dataset.tab;

      // Stop audio playback when leaving splits tab
      if (currentTab === "splits" && targetTab !== "splits") {
        try {
          stopPlayback();
        } catch (err) {
          console.warn("Failed to stop playback on tab switch:", err);
        }
      }

      // Remove active class from all buttons and contents
      tabButtons.forEach((btn) => {
        btn.classList.remove("active");
        btn.setAttribute("aria-selected", "false");
      });
      tabContents.forEach((content) => content.classList.remove("active"));

      // Add active class to clicked button and corresponding content
      button.classList.add("active");
      button.setAttribute("aria-selected", "true");
      const targetContent = document.getElementById(`${targetTab}-tab`);
      if (targetContent) {
        targetContent.classList.add("active");
      }
    });
  });
}

/**
 * Setup settings subtab switching
 */
export function setupSettingsSubtabs() {
  const subtabBtns = document.querySelectorAll(".subtab-btn");
  const subtabContents = document.querySelectorAll(".subtab-content");

  subtabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.subtab;

      subtabBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      subtabContents.forEach((c) => c.classList.remove("active"));

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      const content = document.getElementById(`subtab-${target}`);
      if (content) content.classList.add("active");
    });
  });
}

/**
 * Format time ago helper
 * @param {Date} date
 * @returns {string}
 */
function formatTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Setup yt-dlp version display and update UI
 */
export async function setupYtdlpUpdate() {
  const versionEl = $("#ytdlp-version");
  const statusEl = $("#ytdlp-update-status");
  const updateBtn = $("#btn-ytdlp-update");

  if (!versionEl || !updateBtn) return;

  // Fetch initial status
  const refreshYtdlpStatus = async () => {
    try {
      const status = await api("/api/ytdlp/status");
      if (status.current_version) {
        versionEl.textContent = `yt-dlp version: ${status.current_version}`;
      } else {
        versionEl.textContent = "yt-dlp version: unknown";
      }

      if (status.update_in_progress) {
        updateBtn.disabled = true;
        updateBtn.textContent = "Updating...";
        statusEl.textContent = "Update in progress...";
      } else {
        updateBtn.disabled = false;
        updateBtn.textContent = "Update yt-dlp";
      }

      if (status.last_check) {
        const lastCheck = new Date(status.last_check);
        const timeAgo = formatTimeAgo(lastCheck);
        if (!status.update_in_progress) {
          statusEl.textContent = `Last checked: ${timeAgo}`;
        }
      }
    } catch (e) {
      versionEl.textContent = "yt-dlp version: error fetching";
      console.error("Failed to get yt-dlp status:", e);
    }
  };

  // Handle update button click
  updateBtn.addEventListener("click", async () => {
    updateBtn.disabled = true;
    updateBtn.textContent = "Updating...";
    statusEl.textContent = "Checking for updates...";

    try {
      const result = await api("/api/ytdlp/update", { method: "POST" });

      if (result.success) {
        if (result.was_updated) {
          statusEl.textContent = result.message;
          statusEl.style.color = "#4caf50"; // green
        } else {
          statusEl.textContent = result.message;
          statusEl.style.color = ""; // default
        }
        if (result.version) {
          versionEl.textContent = `yt-dlp version: ${result.version}`;
        }
      } else {
        statusEl.textContent = `Update failed: ${result.message}`;
        statusEl.style.color = "#f44336"; // red
      }
    } catch (e) {
      statusEl.textContent = `Update error: ${e.message}`;
      statusEl.style.color = "#f44336";
      console.error("yt-dlp update failed:", e);
    } finally {
      updateBtn.disabled = false;
      updateBtn.textContent = "Update yt-dlp";

      // Reset status color after a delay
      setTimeout(() => {
        statusEl.style.color = "";
      }, 5000);
    }
  });

  // Initial fetch
  await refreshYtdlpStatus();
}
