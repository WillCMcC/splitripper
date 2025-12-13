/**
 * IPC handlers for SplitBoy
 * Handles inter-process communication between renderer and main process
 */

const { dialog, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { getMainWindow } = require("./window");
const { getTray } = require("./tray");

/**
 * Register all IPC handlers
 */
function registerIpcHandlers() {
  // Handle directory picker
  ipcMain.handle("select-directory", async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Output Directory",
      buttonLabel: "Select Folder",
    });

    return result.canceled ? null : result.filePaths[0];
  });

  // Handle audio file selection
  ipcMain.handle("select-audio-files", async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "Select Audio Files",
      buttonLabel: "Select Files",
      filters: [
        {
          name: "Audio Files",
          extensions: ["mp3", "wav", "flac", "aac", "m4a", "ogg", "wma", "opus"],
        },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    return result.canceled ? [] : result.filePaths;
  });

  // Handle audio directory selection
  ipcMain.handle("select-audio-directory", async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Directory Containing Audio Files",
      buttonLabel: "Select Directory",
    });

    return result.canceled ? null : result.filePaths[0];
  });

  // Search for a file in common Music library locations
  ipcMain.handle("find-file", async (event, name, size) => {
    const searchPaths = [
      path.join(os.homedir(), "Music", "Music", "Media"),
      path.join(os.homedir(), "Music", "Music", "Media.localized"),
      path.join(os.homedir(), "Music", "Music", "Media.localized", "Music"),
      path.join(os.homedir(), "Music", "iTunes", "iTunes Media"),
      path.join(os.homedir(), "Music", "iTunes", "iTunes Media.localized"),
      path.join(os.homedir(), "Music"),
      path.join(os.homedir(), "Downloads"),
      path.join(os.homedir(), "Desktop"),
    ];

    const foundFiles = [];
    const debug = [];

    for (const searchPath of searchPaths) {
      try {
        if (!fs.existsSync(searchPath)) {
          debug.push(`Path does not exist: ${searchPath}`);
          continue;
        }

        debug.push(`Searching in: ${searchPath}`);
        let fileCount = 0;
        let dirCount = 0;

        // Recursive walk function
        function walkDir(dir) {
          try {
            const files = fs.readdirSync(dir);
            dirCount++;

            for (const file of files) {
              const filePath = path.join(dir, file);
              try {
                const stat = fs.statSync(filePath);

                if (stat.isDirectory()) {
                  walkDir(filePath); // Recurse into subdirectory
                } else if (stat.isFile()) {
                  fileCount++;
                  if (file === name) {
                    debug.push(
                      `Found exact match: ${filePath} (size: ${stat.size})`
                    );

                    // Check size if provided
                    if (size && stat.size !== size) {
                      debug.push(
                        `Size mismatch: expected ${size}, got ${stat.size}`
                      );
                      continue;
                    }

                    foundFiles.push({
                      name: file,
                      path: filePath,
                      size: stat.size,
                    });
                  }
                }
              } catch (fileErr) {
                // Skip files we can't access
              }
            }
          } catch (dirErr) {
            debug.push(`Error reading directory ${dir}: ${dirErr.message}`);
          }
        }

        walkDir(searchPath);
        debug.push(
          `Scanned ${fileCount} files in ${dirCount} directories within ${searchPath}`
        );
      } catch (err) {
        debug.push(`Error accessing ${searchPath}: ${err.message}`);
      }
    }

    return { files: foundFiles, debug };
  });

  // Handle taskbar progress updates
  ipcMain.on("update-taskbar-progress", (event, data) => {
    const { completed, total, progress, etaSeconds } = data;
    const mainWindow = getMainWindow();
    const tray = getTray();

    const formatEta = (s) => {
      if (typeof s !== "number" || !isFinite(s) || s <= 0) return null;
      const sec = Math.max(0, Math.floor(s));
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const ss = sec % 60;
      return h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
        : `${m}:${String(ss).padStart(2, "0")}`;
    };

    const etaStr = formatEta(etaSeconds);
    console.log(
      `Taskbar progress update: ${completed}/${total} (${(
        (progress || 0) * 100
      ).toFixed(1)}%)` + (etaStr ? ` ~${etaStr} remaining` : "")
    );

    // Update system tray tooltip with both completion, progress, and ETA (if available)
    if (tray) {
      const progressPct = Math.floor((progress || 0) * 100);
      let tip =
        total > 0
          ? `SplitBoy - ${completed}/${total} tracks (${progressPct}%)`
          : `SplitBoy - 0/0 tracks`;
      if (etaStr) tip += ` * ~${etaStr} left`;
      tray.setToolTip(tip);
    }

    if (mainWindow) {
      if (total === 0) {
        // No items in queue, remove progress bar
        console.log("Removing progress bar (no items)");
        mainWindow.setProgressBar(-1);
      } else {
        // Use the global progress percentage for smooth dock/taskbar progress
        const globalProgress = progress || 0;
        console.log(
          `Setting progress bar to: ${globalProgress} (${(
            globalProgress * 100
          ).toFixed(1)}%)`
        );
        mainWindow.setProgressBar(globalProgress);
      }
    }
  });
}

module.exports = {
  registerIpcHandlers,
};
