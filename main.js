/**
 * SplitBoy - Electron Main Entry Point
 *
 * This file serves as the main entry point for the Electron application.
 * It imports functionality from modular files in the electron/ directory.
 */

const { app, BrowserWindow } = require("electron");

// Import modules from electron/
const { startServer, stopServer, getServerProcess } = require("./electron/server");
const { createWindow } = require("./electron/window");
const { createTray } = require("./electron/tray");
const { registerIpcHandlers } = require("./electron/ipc-handlers");

// Track if we're already quitting to prevent multiple shutdown attempts
let isQuitting = false;

/**
 * Gracefully shutdown the application
 * Ensures server is stopped before exiting
 */
async function gracefulShutdown() {
  if (isQuitting) return;
  isQuitting = true;

  console.log("Initiating graceful shutdown...");

  try {
    await stopServer();
  } catch (err) {
    console.error("Error during shutdown:", err);
  }

  app.exit(0);
}

// Handle app events
app.whenReady().then(async () => {
  // Register IPC handlers before creating windows
  registerIpcHandlers();

  await startServer();
  createWindow();
  createTray();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!getServerProcess()) {
        await startServer();
      }
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    gracefulShutdown();
  }
});

app.on("before-quit", (e) => {
  if (!isQuitting) {
    e.preventDefault();
    gracefulShutdown();
  }
});

// Handle process-level signals to ensure cleanup
process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);
