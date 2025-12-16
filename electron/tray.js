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
 * Create a monochrome template icon programmatically
 * Pure black pixels with alpha channel - proper macOS template format
 */
function createFallbackIcon() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = 6;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dist = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);

      if (dist <= radius) {
        // Pure black with full opacity (template image format)
        canvas[idx] = 0;       // R - black
        canvas[idx + 1] = 0;   // G - black
        canvas[idx + 2] = 0;   // B - black
        canvas[idx + 3] = 255; // A - opaque
      } else {
        // Fully transparent outside
        canvas[idx] = 0;
        canvas[idx + 1] = 0;
        canvas[idx + 2] = 0;
        canvas[idx + 3] = 0;
      }
    }
  }

  const image = nativeImage.createFromBuffer(canvas, { width: size, height: size });

  // Mark as template image for macOS - system will colorize appropriately
  if (process.platform === 'darwin') {
    image.setTemplateImage(true);
  }

  return image;
}

/**
 * Create the system tray icon
 */
function createTray() {
  const appPath = app.getAppPath();

  // Try Template-named icons first (Electron auto-detects these for macOS)
  // Then fall back to regular icons
  const iconPaths = [
    path.join(appPath, "trayTemplate.png"),           // Template-named for auto-detection
    path.join(appPath, "tray_icon.png"),
    path.join(process.resourcesPath || appPath, "trayTemplate.png"),
    path.join(process.resourcesPath || appPath, "tray_icon.png"),
  ];

  let trayImage = null;

  for (const iconPath of iconPaths) {
    console.log("Trying tray icon:", iconPath);
    const image = nativeImage.createFromPath(iconPath);

    if (!image.isEmpty()) {
      const size = image.getSize();
      console.log("Loaded icon:", iconPath, "size:", size);

      // Use pre-sized icon directly, or resize if too large
      if (size.width <= 32 && size.height <= 32) {
        trayImage = image;
      } else {
        trayImage = image.resize({ width: 22, height: 22 });
      }
      break;
    }
  }

  // Fallback to programmatic icon if all paths failed
  if (!trayImage || trayImage.isEmpty()) {
    console.warn("All icon paths failed, using fallback icon");
    trayImage = createFallbackIcon();
  }

  if (!trayImage || trayImage.isEmpty()) {
    console.error("Failed to create any tray icon");
    return;
  }

  console.log("Final tray image size:", trayImage.getSize(), "isEmpty:", trayImage.isEmpty());

  try {
    tray = new Tray(trayImage);
    console.log("Tray created successfully");
  } catch (err) {
    console.error("Failed to create Tray:", err);
    return;
  }
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
