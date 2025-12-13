/**
 * SplitBoy - Electron Main Entry Point
 *
 * This file serves as the main entry point for the Electron application.
 * It imports functionality from modular files in the electron/ directory.
 */

const { app, BrowserWindow } = require("electron");

// Import modules from electron/
const { startServer, stopServer, getServerProcess } = require("./electron/server");
const { createWindow, getMainWindow } = require("./electron/window");
const { createTray } = require("./electron/tray");
const { registerIpcHandlers } = require("./electron/ipc-handlers");

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
  stopServer();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", async (e) => {
  try {
    e.preventDefault();
  } catch {}
  await stopServer();
  app.exit(0);
});

app.on("will-quit", () => {
  stopServer();
});

// Also handle process-level exits and signals to ensure cleanup
process.on("SIGINT", () => {
  stopServer();
  app.quit();
});

process.on("SIGTERM", () => {
  stopServer();
});

process.on("exit", () => {
  stopServer();
});
