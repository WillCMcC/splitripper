/**
 * Window management for SplitBoy
 * Handles creating the main window, splash screen, and waiting for server
 */

const { BrowserWindow, shell } = require("electron");
const path = require("path");
const http = require("http");
const { getServerURL, getServerPort, stopServer } = require("./server");

// Module state
let mainWindow = null;

// Root directory (parent of electron/)
const rootDir = path.join(__dirname, "..");

/**
 * Generate splash screen HTML
 * @returns {string}
 */
function getSplashHtml() {
  return `
    <html>
      <head>
        <meta charset="utf-8">
        <title>SplitBoy</title>
        <style>
          html, body { height: 100%; margin: 0; }
          body {
            display: grid;
            place-items: center;
            background:
              radial-gradient(1200px 600px at 10% -10%, rgba(59,130,246,0.18), transparent),
              radial-gradient(900px 500px at 100% 10%, rgba(168,85,247,0.18), transparent),
              radial-gradient(900px 900px at 50% 120%, rgba(34,197,94,0.12), transparent),
              linear-gradient(180deg, #0b1220, #0b0f14);
            color: #e6edf3;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, Arial, sans-serif;
          }
          .logo {
            width: 140px;
            height: 140px;
            border-radius: 28px;
            box-shadow: 0 10px 35px rgba(59,130,246,0.18);
          }
        </style>
      </head>
      <body>
      <h1> Splitboy - getting ready to split, boy!</h1>
      </body>
    </html>
  `;
}

/**
 * Generate error screen HTML when backend fails to start
 * @param {string} serverUrl - The server URL that failed
 * @returns {string}
 */
function getErrorHtml(serverUrl) {
  return `
    <html>
      <head>
        <meta charset="utf-8">
        <title>SplitBoy</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, Arial, sans-serif; margin: 40px; color: #111; }
          .muted { color: #666; }
          code, pre { background:#f5f5f7; padding: 2px 6px; border-radius: 4px; }
          pre { padding: 12px; overflow:auto; }
        </style>
      </head>
      <body>
        <h2>Backend did not start</h2>
        <p class="muted">The FastAPI server at <code>${serverUrl}</code> did not become available.</p>
        <p>If you are running from source, ensure the Python runtime is available.</p>
        <ul>
          <li>Prefer using the bundled runtime: run <code>npm run bundle-python</code> once, then <code>npm start</code>.</li>
          <li>Or install deps into your environment: <code>pip install -r requirements.txt</code>.</li>
        </ul>
        <p class="muted">See the terminal for server logs.</p>
      </body>
    </html>`;
}

/**
 * Wait for server to be ready
 * @param {string} url - Server URL to check
 * @param {number} attempts - Number of attempts
 * @param {number} delay - Delay between attempts in ms
 * @returns {Promise<boolean>}
 */
function waitForServer(url, attempts = 40, delay = 500) {
  return new Promise((resolve) => {
    const tryOnce = (left) => {
      const req = http.get(url, (res) => {
        try {
          res.destroy();
        } catch {}
        resolve(true);
      });
      req.on("error", () => {
        if (left <= 1) return resolve(false);
        setTimeout(() => tryOnce(left - 1), delay);
      });
      req.setTimeout(800, () => {
        try {
          req.destroy();
        } catch {}
        if (left <= 1) return resolve(false);
        setTimeout(() => tryOnce(left - 1), delay);
      });
    };
    tryOnce(attempts);
  });
}

/**
 * Create the main browser window
 */
function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(rootDir, "preload.js"),
    },
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 20, y: 20 },
    title: "SplitBoy",
    icon: path.join(rootDir, "splitro.png"),
  });

  // Ensure backend is stopped when window is closed
  mainWindow.on("close", () => {
    stopServer();
  });

  // Load splash screen while backend starts
  const splashHtml = getSplashHtml();
  try {
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(splashHtml)
    );
  } catch {}

  // Wait for server to be ready, then load; show helpful fallback if it never starts
  const serverUrl = () =>
    getServerURL() || `http://127.0.0.1:${getServerPort() || 9000}/`;

  waitForServer(serverUrl()).then((ok) => {
    if (ok) {
      mainWindow.loadURL(serverUrl());
    } else {
      const errorHtml = getErrorHtml(serverUrl());
      mainWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(errorHtml)
      );
    }
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Open DevTools in development
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }
}

/**
 * Get the main window instance
 * @returns {BrowserWindow|null}
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * Set the main window instance (for use by other modules)
 * @param {BrowserWindow|null} window
 */
function setMainWindow(window) {
  mainWindow = window;
}

module.exports = {
  createWindow,
  waitForServer,
  getMainWindow,
  setMainWindow,
  getSplashHtml,
  getErrorHtml,
};
