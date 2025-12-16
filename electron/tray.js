/**
 * System tray management for SplitBoy
 * Handles creating and updating the system tray icon
 */

const { Tray, nativeImage } = require("electron");
const path = require("path");
const { getMainWindow } = require("./window");

// Module state
let tray = null;

// Root directory (parent of electron/)
const rootDir = path.join(__dirname, "..");

/**
 * Create the system tray icon
 */
function createTray() {
  // Use the app icon for the tray, resized for system tray
  const iconPath = path.join(rootDir, "splitboy_icon.png");
  const image = nativeImage.createFromPath(iconPath);

  // Resize for tray (16x16 on most systems)
  const trayImage = image.resize({ width: 16, height: 16 });

  tray = new Tray(trayImage);
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
