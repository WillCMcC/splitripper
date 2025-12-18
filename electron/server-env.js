/**
 * Platform-specific environment setup for the FastAPI server
 * Handles development vs production paths, Python runtime configuration, and PATH setup
 */

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

/**
 * Build the server environment object with platform-specific configuration
 * @param {boolean} isDev - Whether running in development mode
 * @param {Object} baseEnv - Base environment variables to extend
 * @returns {Object} Environment configuration with pythonPath, serverPath, workingDir, and env
 */
function buildServerEnvironment(isDev, baseEnv) {
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const rootDir = path.join(__dirname, "..");

  if (isDev) {
    return buildDevelopmentEnvironment(rootDir, baseEnv, isWindows);
  } else {
    return buildProductionEnvironment(baseEnv, isWindows, isMac);
  }
}

/**
 * Build development environment configuration
 * @param {string} rootDir - Root directory of the project
 * @param {Object} baseEnv - Base environment variables
 * @param {boolean} isWindows - Whether running on Windows
 * @returns {Object} Development environment configuration
 */
function buildDevelopmentEnvironment(rootDir, baseEnv, isWindows) {
  const serverPath = path.join(rootDir, "src", "server.py");
  const workingDir = rootDir;

  console.log("Running in development mode");

  const bundledPython = path.join(
    rootDir,
    "python_runtime_bundle",
    isWindows ? "python.exe" : "python"
  );

  if (fs.existsSync(bundledPython)) {
    console.log(`Using bundled Python with server at: ${serverPath}`);
    return {
      pythonPath: bundledPython,
      serverPath,
      workingDir,
      env: { ...baseEnv },
      args: [serverPath],
    };
  } else {
    // Fallback: use conda
    console.log("Bundled Python not found, trying conda/system python");
    return {
      pythonPath: "conda",
      serverPath,
      workingDir,
      env: { ...baseEnv },
      args: ["run", "-n", "base", "python", serverPath],
    };
  }
}

/**
 * Build production environment configuration
 * @param {Object} baseEnv - Base environment variables
 * @param {boolean} isWindows - Whether running on Windows
 * @param {boolean} isMac - Whether running on macOS
 * @returns {Object} Production environment configuration
 */
function buildProductionEnvironment(baseEnv, isWindows, isMac) {
  // Determine the correct Python executable name
  let pythonExe;
  if (isWindows) {
    pythonExe = "python.exe";
  } else {
    // On Unix-like systems (macOS/Linux), use the wrapper script
    pythonExe = "python";
  }

  // The bundled Python is in the app resources
  const pythonPath = path.join(
    process.resourcesPath,
    "app",
    "python_runtime_bundle",
    pythonExe
  );
  const serverPath = path.join(process.resourcesPath, "app", "src", "server.py");
  const workingDir = path.join(process.resourcesPath, "app");

  console.log("Running in production mode");
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
    return null;
  }

  if (!fs.existsSync(serverPath)) {
    console.error(`Server script not found at: ${serverPath}`);
    app.quit();
    return null;
  }

  // Build environment based on platform
  const env = buildPlatformEnvironment(baseEnv, isWindows, isMac);

  // For macOS, ensure the wrapper script is executable
  if (isMac) {
    try {
      fs.chmodSync(pythonPath, "755");
    } catch (e) {
      console.warn("Could not set executable permissions:", e);
    }
  }

  return {
    pythonPath,
    serverPath,
    workingDir,
    env,
    args: [serverPath],
  };
}

/**
 * Build platform-specific environment variables
 * @param {Object} baseEnv - Base environment variables
 * @param {boolean} isWindows - Whether running on Windows
 * @param {boolean} isMac - Whether running on macOS
 * @returns {Object} Platform-specific environment variables
 */
function buildPlatformEnvironment(baseEnv, isWindows, isMac) {
  const env = { ...baseEnv };
  const bundleDir = path.join(
    process.resourcesPath,
    "app",
    "python_runtime_bundle"
  );
  const pbsHome = path.join(bundleDir, "pbs", "python");
  const denoDir = path.join(bundleDir, "deno");
  const ffmpegDir = path.join(bundleDir, "ffmpeg");

  if (isMac) {
    // macOS-specific configuration
    env.PYTHONHOME = pbsHome;

    // Add Deno and ffmpeg to PATH for EJS support
    if (fs.existsSync(denoDir)) {
      env.PATH = `${denoDir}${path.delimiter}${env.PATH || ""}`;
    }
    if (fs.existsSync(ffmpegDir)) {
      env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ""}`;
    }
  } else if (isWindows) {
    // Windows-specific configuration
    const winBundleDir = path.join(
      process.resourcesPath,
      "app",
      "python_runtime_bundle"
    );
    const winDenoDir = path.join(winBundleDir, "deno");
    const winFfmpegDir = path.join(winBundleDir, "ffmpeg");

    env.PYTHONHOME = winBundleDir;
    env.PATH = `${winBundleDir};${winBundleDir}\\Scripts`;

    // Add Deno and ffmpeg to PATH for EJS support
    if (fs.existsSync(winDenoDir)) {
      env.PATH = `${winDenoDir};${env.PATH}`;
    }
    if (fs.existsSync(winFfmpegDir)) {
      env.PATH = `${winFfmpegDir};${env.PATH}`;
    }

    env.PATH = `${env.PATH};${process.env.PATH || ""}`;
  } else {
    // Linux or other Unix-like systems
    if (fs.existsSync(denoDir)) {
      env.PATH = `${denoDir}${path.delimiter}${env.PATH || ""}`;
    }
    if (fs.existsSync(ffmpegDir)) {
      env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ""}`;
    }
  }

  return env;
}

module.exports = {
  buildServerEnvironment,
};
