/**
 * Server lifecycle management for SplitBoy
 * Handles starting, stopping, and communicating with the FastAPI backend
 */

const { app } = require("electron");
const path = require("path");
const { spawn, execSync } = require("child_process");
const http = require("http");
const kill = require("tree-kill");
const fs = require("fs");
const net = require("net");
const { buildServerEnvironment } = require("./server-env");

// Module state
let serverProcess = null;
let stoppingServer = false;
let serverPort = 9000;
let serverURL = null;
let serverLogStream = null;

// Crash recovery state
let crashCount = 0;
let lastCrashTime = 0;
const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// Root directory (parent of electron/)
const rootDir = path.join(__dirname, "..");

/**
 * Pick a free localhost port for the backend to avoid collisions.
 * @returns {Promise<number>}
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

/**
 * Start the FastAPI server (async so we can pick a free port)
 */
async function startServer() {
  console.log("Starting FastAPI server...");

  const isDev = !app.isPackaged;

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

  // Build platform-specific environment configuration
  const serverConfig = buildServerEnvironment(isDev, baseEnv);

  if (!serverConfig) {
    // Configuration failed (app.quit() already called)
    return;
  }

  const { pythonPath, serverPath, workingDir, env, args } = serverConfig;

  // Spawn the server process
  serverProcess = spawn(pythonPath, args, {
    cwd: workingDir,
    stdio: "pipe",
    env: env,
    shell: false,
    detached: false,
  });

  serverProcess.stdout.on("data", (data) => {
    try {
      if (serverLogStream) serverLogStream.write(data);
    } catch (e) {
      console.warn("Failed to write to server log stream:", e.message);
    }
    console.log(`Server: ${data}`);
  });

  serverProcess.stderr.on("data", (data) => {
    try {
      if (serverLogStream) serverLogStream.write(data);
    } catch (e) {
      console.warn("Failed to write to server log stream:", e.message);
    }
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
    } catch (e) {
      console.warn("Failed to close server log stream:", e.message);
    }

    // Check if this was an unexpected exit (crash)
    if (code !== 0 && !stoppingServer) {
      const now = Date.now();

      // Reset crash count if outside window
      if (now - lastCrashTime > CRASH_WINDOW_MS) {
        crashCount = 0;
      }

      crashCount++;
      lastCrashTime = now;

      console.error(`Server crashed (exit code ${code}). Crash count: ${crashCount}/${MAX_CRASHES}`);

      if (crashCount < MAX_CRASHES) {
        console.log("Attempting to restart server...");
        serverProcess = null;
        serverPort = null;

        // Restart after brief delay
        setTimeout(async () => {
          try {
            await startServer();
            console.log("Server restarted successfully");

            // Notify renderer if window exists
            const { getMainWindow } = require("./window");
            const mainWindow = getMainWindow();
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.loadURL(getServerURL());
            }
          } catch (err) {
            console.error("Failed to restart server:", err);
          }
        }, 1000);
      } else {
        console.error("Max crash limit reached. Server will not restart.");
        // Could show error dialog here
      }
    }

    serverProcess = null;
  });
}

/**
 * Ask the FastAPI server to shut itself down via HTTP.
 * Returns after a quick timeout to avoid blocking quit.
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<void>}
 */
function requestShutdown(timeoutMs = 400) {
  return new Promise((resolve) => {
    try {
      const req = http.request(
        {
          method: "POST",
          hostname: "127.0.0.1",
          port: serverPort ?? 9000,
          path: "/api/_shutdown",
          timeout: timeoutMs,
        },
        (res) => {
          try {
            res.resume();
          } catch (e) {
            console.warn("Failed to resume shutdown response:", e.message);
          }
          resolve();
        }
      );
      req.on("error", () => resolve());
      req.on("timeout", () => {
        try {
          req.destroy();
        } catch (e) {
          console.warn("Failed to destroy timed-out request:", e.message);
        }
        resolve();
      });
      req.end();
    } catch (e) {
      console.warn("Failed to send shutdown request:", e.message);
      resolve();
    }
  });
}

/**
 * Stop the server when app quits
 * @returns {Promise<void>}
 */
async function stopServer() {
  if (!serverProcess) {
    console.log("No server process to stop");
    return;
  }

  if (stoppingServer) {
    console.log("Already stopping server");
    return;
  }

  stoppingServer = true;
  const pid = serverProcess.pid;
  console.log(`Stopping server (PID: ${pid})...`);

  try {
    // Try graceful shutdown first
    await requestShutdown().catch(() => {});

    // Give it a moment to shut down gracefully
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 500);

      if (serverProcess) {
        serverProcess.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      } else {
        clearTimeout(timeout);
        resolve();
      }
    });

    // If still running, force kill
    if (serverProcess && !serverProcess.killed) {
      console.log("Graceful shutdown failed, force killing...");

      await new Promise((resolve) => {
        kill(pid, "SIGTERM", (err) => {
          if (err) {
            console.warn("SIGTERM failed, trying SIGKILL:", err.message);
            kill(pid, "SIGKILL", () => resolve());
          } else {
            resolve();
          }
        });
      });
    }
  } catch (err) {
    console.error("Error stopping server:", err);
  } finally {
    serverProcess = null;
    serverPort = null;
    stoppingServer = false;
  }
}

// Getters for shared state
function getServerPort() {
  return serverPort;
}

function getServerURL() {
  return serverURL;
}

function getServerProcess() {
  return serverProcess;
}

/**
 * Reset the crash count (useful for manual restart)
 */
function resetCrashCount() {
  crashCount = 0;
  lastCrashTime = 0;
}

module.exports = {
  getFreePort,
  startServer,
  requestShutdown,
  stopServer,
  getServerPort,
  getServerURL,
  getServerProcess,
  resetCrashCount,
};
