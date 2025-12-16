/**
 * System tray management for SplitBoy
 * Handles creating and updating the system tray icon
 */

const { app, Tray, nativeImage } = require("electron");
const path = require("path");
const { getMainWindow } = require("./window");

// Module state
let tray = null;

/**
 * Create the system tray icon
 */
function createTray() {
  // Use app.getAppPath() for reliable path resolution in both dev and production
  const appPath = app.getAppPath();
  const iconPath = path.join(appPath, "splitboy_icon.png");

  console.log("Creating tray icon from:", iconPath);

  const image = nativeImage.createFromPath(iconPath);

  // Check if image loaded successfully
  if (image.isEmpty()) {
    console.error("Failed to load tray icon from:", iconPath);
    return;
  }

  console.log("Original image size:", image.getSize());

  // Resize for tray (18x18 is common for macOS menu bar icons)
  const trayImage = image.resize({ width: 18, height: 18 });

  console.log("Tray image size:", trayImage.getSize(), "isEmpty:", trayImage.isEmpty());

  tray = new Tray(trayImage);
  console.log("Tray created successfully");
  tray.setToolTip("SplitBoy - 0/0 tracks");

  // Click to show/hide window
  tray.on("click", () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

/**
 * Get the tray instance
 * @returns {Tray|null}
 */
function getTray() {
  return tray;
}

/**
 * Update the tray tooltip
 * @param {string} tooltip
 */
function setTrayTooltip(tooltip) {
  if (tray) {
    tray.setToolTip(tooltip);
  }
}

module.exports = {
  createTray,
  getTray,
  setTrayTooltip,
};
