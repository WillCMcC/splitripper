const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Tray,
  nativeImage,
} = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");
const kill = require("tree-kill");
const fs = require("fs");
const net = require("net");

let mainWindow;
let serverProcess;
let stoppingServer = false;
let tray = null;
let serverPort = 9000;
let serverURL = null;
let serverLogStream = null;

/**
 * Pick a free localhost port for the backend to avoid collisions — returns Promise<number>.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

// Start the FastAPI server (async so we can pick a free port)
async function startServer() {
  console.log("Starting FastAPI server...");

  const isDev = !app.isPackaged;
  let pythonPath, serverPath, workingDir;

  // Choose a free localhost port and prepare environment
  const port = await getFreePort().catch(() => 9000);
  serverPort = port;
  serverURL = `http://127.0.0.1:${serverPort}/`;

  const baseEnv = {
    ...process.env,
    SPLITBOY_HOST: "127.0.0.1",
    SPLITBOY_PORT: String(serverPort),
    SPLITBOY_LOG_LEVEL: "info",
    PYTHONNOUSERSITE: "1",
  };

  // Minimal file logging to userData/logs/server.log
  try {
    const logDir = path.join(app.getPath("userData"), "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, "server.log");
    serverLogStream = fs.createWriteStream(logPath, { flags: "a" });
  } catch (e) {
    console.warn("Could not initialize server log:", e);
  }

  if (isDev) {
    const fs = require("fs");
    const isWindows = process.platform === "win32";
    // Prefer bundled Python runtime if present for dev to avoid env issues
    serverPath = path.join(__dirname, "src", "server.py");
    workingDir = __dirname;

    console.log(`Running in development mode`);

    const bundledPython = path.join(
      __dirname,
      "python_runtime_bundle",
      isWindows ? "python.exe" : "python"
    );
    if (fs.existsSync(bundledPython)) {
      pythonPath = bundledPython;
      console.log(`Using bundled Python with server at: ${serverPath}`);
      serverProcess = spawn(pythonPath, [serverPath], {
        cwd: workingDir,
        stdio: "pipe",
        env: { ...baseEnv },
      });
    } else {
      // Fallbacks: try conda, then system python
      console.log(`Bundled Python not found, trying conda/system python`);
      pythonPath = "conda";
      serverProcess = spawn(
        pythonPath,
        ["run", "-n", "base", "python", serverPath],
        {
          cwd: workingDir,
          stdio: "pipe",
          env: { ...baseEnv },
        }
      );
      // Note: if 'conda' is not available, an 'error' event will be emitted below.
      // You can install deps into system python and run with 'python3' by adjusting this logic if needed.
    }
  } else {
    // Production: Use bundled Python runtime
    const fs = require("fs");
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";

    // Determine the correct Python executable name
    let pythonExe;
    if (isWindows) {
      pythonExe = "python.exe";
    } else {
      // On Unix-like systems (macOS/Linux), use the wrapper script
      pythonExe = "python";
    }

    // The bundled Python is in the app resources
    pythonPath = path.join(
      process.resourcesPath,
      "app",
      "python_runtime_bundle",
      pythonExe
    );
    serverPath = path.join(process.resourcesPath, "app", "src", "server.py");
    workingDir = path.join(process.resourcesPath, "app");

    console.log(`Running in production mode`);
    console.log(`Platform: ${process.platform}`);
    console.log(`Python path: ${pythonPath}`);
    console.log(`Python exists: ${fs.existsSync(pythonPath)}`);
    console.log(`Server path: ${serverPath}`);
    console.log(`Server exists: ${fs.existsSync(serverPath)}`);
    console.log(`Working directory: ${workingDir}`);

    // Check if files exist
    if (!fs.existsSync(pythonPath)) {
      console.error(`Python wrapper not found at: ${pythonPath}`);
      app.quit();
      return;
    }

    if (!fs.existsSync(serverPath)) {
      console.error(`Server script not found at: ${serverPath}`);
      app.quit();
      return;
    }

    // Simple environment for the wrapper script
    const env = { ...baseEnv };

    // Ensure PBS relocatable CPython finds its stdlib/site correctly on macOS
    const bundleDir = path.join(
      process.resourcesPath,
      "app",
      "python_runtime_bundle"
    );
    const pbsHome = path.join(bundleDir, "pbs", "python");
    const denoDir = path.join(bundleDir, "deno");
    const ffmpegDir = path.join(bundleDir, "ffmpeg");

    if (isMac) {
      env.PYTHONHOME = pbsHome;
    }

    // Add Deno and ffmpeg to PATH for EJS support
    if (fs.existsSync(denoDir)) {
      env.PATH = `${denoDir}${path.delimiter}${env.PATH || ""}`;
    }
    if (fs.existsSync(ffmpegDir)) {
      env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ""}`;
    }

    // For macOS, ensure the wrapper script is executable
    if (isMac) {
      try {
        fs.chmodSync(pythonPath, "755");
      } catch (e) {
        console.warn("Could not set executable permissions:", e);
      }
    }

    // For Windows, set up the Python environment
    if (isWindows) {
      const bundleDir = path.join(
        process.resourcesPath,
        "app",
        "python_runtime_bundle"
      );
      const denoDir = path.join(bundleDir, "deno");
      const ffmpegDir = path.join(bundleDir, "ffmpeg");

      env.PYTHONHOME = bundleDir;
      env.PATH = `${bundleDir};${bundleDir}\\Scripts`;

      // Add Deno and ffmpeg to PATH for EJS support
      if (fs.existsSync(denoDir)) {
        env.PATH = `${denoDir};${env.PATH}`;
      }
      if (fs.existsSync(ffmpegDir)) {
        env.PATH = `${ffmpegDir};${env.PATH}`;
      }

      env.PATH = `${env.PATH};${process.env.PATH || ""}`;
    }

    serverProcess = spawn(pythonPath, [serverPath], {
      cwd: workingDir,
      stdio: "pipe",
      env: env,
      shell: false, // wrapper has shebang and is executable; no shell needed
      detached: false, // Keep in same process group for easier cleanup
    });
  }

  serverProcess.stdout.on("data", (data) => {
    try {
      if (serverLogStream) serverLogStream.write(data);
    } catch {}
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    try {
      if (serverLogStream) serverLogStream.write(data);
    } catch {}
    console.error(`Server Error: ${data}`);
  });

  serverProcess.on("error", (err) => {
    console.error(
      `Server spawn error: ${err && err.message ? err.message : err}`
    );
  });

  serverProcess.on("close", (code) => {
    console.log(`Server process exited with code ${code}`);
    try {
      if (serverLogStream) {
        serverLogStream.end();
        serverLogStream = null;
      }
    } catch {}
  });
}

/**
 * Ask the FastAPI server to shut itself down via HTTP.
 * Returns after a quick timeout to avoid blocking quit.
 */
function requestShutdown(timeoutMs = 400) {
  return new Promise((resolve) => {
    try {
      const req = http.request(
        {
          method: "POST",
          hostname: "127.0.0.1",
          port: serverPort || 9000,
          path: "/api/_shutdown",
          timeout: timeoutMs,
        },
        (res) => {
          try {
            res.resume();
          } catch {}
          resolve();
        }
      );
      req.on("error", () => resolve());
      req.on("timeout", () => {
        try {
          req.destroy();
        } catch {}
        resolve();
      });
      req.end();
    } catch {
      resolve();
    }
  });
}

// Stop the server when app quits
async function stopServer() {
  if (!serverProcess || stoppingServer) {
    console.log(
      !serverProcess
        ? "No server process to stop"
        : "Server stop already in progress"
    );
    return;
  }

  stoppingServer = true;
  console.log(`Stopping FastAPI server... PID: ${serverProcess.pid}`);

  // Try graceful shutdown via HTTP first
  await requestShutdown(500);

  // Wait briefly for a clean exit, then kill if needed
  return new Promise((resolve) => {
    const graceTimer = setTimeout(() => {
      // Use tree-kill to kill the entire process tree (shell + python process)
      kill(serverProcess.pid, "SIGTERM", (err) => {
        if (err) {
          console.log("Error with SIGTERM, trying SIGKILL:", err);
          kill(serverProcess.pid, "SIGKILL", (killErr) => {
            if (killErr) {
              console.log("Error with SIGKILL:", killErr);
              // Final fallback - try system pkill
              try {
                execSync('pkill -f "server.py"', { stdio: "ignore" });
                console.log("Fallback: used system pkill");
              } catch (e) {
                console.log("All kill attempts failed");
              }
            } else {
              console.log("Server process tree killed with SIGKILL");
            }
            serverProcess = null;
            stoppingServer = false;
            resolve();
          });
        } else {
          console.log("Server process tree killed with SIGTERM");
          serverProcess = null;
          stoppingServer = false;
          resolve();
        }
      });
    }, 200);

    // If the process exits cleanly during grace period, resolve early
    try {
      serverProcess.once("close", () => {
        try {
          clearTimeout(graceTimer);
        } catch {}
        console.log("Server process exited during graceful period");
        serverProcess = null;
        stoppingServer = false;
        resolve();
      });
    } catch {
      // If attaching fails, continue with kill path
    }
  });
}

function createTray() {
  // Use the app icon for the tray, resized for system tray
  const iconPath = path.join(__dirname, "splitro.png");
  const image = nativeImage.createFromPath(iconPath);

  // Resize for tray (16x16 on most systems)
  const trayImage = image.resize({ width: 16, height: 16 });

  tray = new Tray(trayImage);
  tray.setToolTip("SplitBoy - 0/0 tracks");

  // Click to show/hide window
  tray.on("click", () => {
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

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 20, y: 20 },
    title: "SplitBoy",
    icon: path.join(__dirname, "splitro.png"),
  });

  // Ensure backend is stopped when window is closed
  mainWindow.on("close", () => {
    stopServer();
  });

  // Load splash screen while backend starts
  const iconPath = path.join(__dirname, "splitro.png");
  const splashHtml = `
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
  try {
    mainWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(splashHtml)
    );
  } catch {}

  // Wait for server to be ready, then load; show helpful fallback if it never starts
  const SERVER_URL = () =>
    serverURL || `http://127.0.0.1:${serverPort || 9000}/`;
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

  waitForServer(SERVER_URL()).then((ok) => {
    if (ok) {
      mainWindow.loadURL(SERVER_URL());
    } else {
      const msg = `
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
            <p class="muted">The FastAPI server at <code>${SERVER_URL()}</code> did not become available.</p>
            <p>If you are running from source, ensure the Python runtime is available.</p>
            <ul>
              <li>Prefer using the bundled runtime: run <code>npm run bundle-python</code> once, then <code>npm start</code>.</li>
              <li>Or install deps into your environment: <code>pip install -r requirements.txt</code>.</li>
            </ul>
            <p class="muted">See the terminal for server logs.</p>
          </body>
        </html>`;
      mainWindow.loadURL(
        "data:text/html;charset=utf-8," + encodeURIComponent(msg)
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

// Handle directory picker
ipcMain.handle("select-directory", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Output Directory",
    buttonLabel: "Select Folder",
  });

  return result.canceled ? null : result.filePaths[0];
});

// Handle audio file selection
ipcMain.handle("select-audio-files", async () => {
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
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Directory Containing Audio Files",
    buttonLabel: "Select Directory",
  });

  return result.canceled ? null : result.filePaths[0];
});

// Search for a file in common Music library locations
ipcMain.handle("find-file", async (event, name, size) => {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");

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
    if (etaStr) tip += ` • ~${etaStr} left`;
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

// Handle app events
app.whenReady().then(async () => {
  await startServer();
  createWindow();
  createTray();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (!serverProcess) {
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
