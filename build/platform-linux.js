const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { downloadDeno, downloadFFmpeg } = require("./download-utils");

/**
 * Build Python bundle for Linux using system Python venv
 * @param {string} bundleDir - Target bundle directory
 */
function buildLinux(bundleDir) {
  console.log("Creating Python bundle for Linux...");

  const venvPath = path.join(bundleDir, "venv");

  try {
    console.log("Creating Python virtual environment...");
    execSync(`python3 -m venv "${venvPath}"`, { stdio: "inherit" });

    console.log("Installing Python dependencies...");
    execSync(`"${venvPath}/bin/pip" install --upgrade pip`, {
      stdio: "inherit",
    });

    // Install dependencies
    console.log("Installing FastAPI, yt-dlp, and audio processing tools...");
    execSync(
      `"${venvPath}/bin/pip" install fastapi uvicorn yt-dlp mutagen demucs torch torchaudio`,
      { stdio: "inherit" }
    );

    // Download ffmpeg binaries
    try {
      downloadFFmpeg(bundleDir);
      console.log("FFmpeg binaries downloaded");
    } catch (e) {
      console.warn("FFmpeg download failed:", e.message);
    }

    // Download Deno for EJS support
    try {
      downloadDeno(bundleDir);
      console.log("Deno runtime downloaded");
    } catch (e) {
      console.warn("Deno download failed:", e.message);
    }

    // Create simple wrapper script
    const pythonWrapper = `#!/bin/bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
export PATH="$DIR/deno:$DIR/ffmpeg:$PATH"
export FFMPEG_LOCATION="$DIR/ffmpeg"
"$DIR/venv/bin/python" "$@"
`;

    fs.writeFileSync(path.join(bundleDir, "python"), pythonWrapper);
    fs.chmodSync(path.join(bundleDir, "python"), "755");

    // Ensure Python binary is executable
    try {
      fs.chmodSync(path.join(venvPath, "bin", "python"), "755");
      fs.chmodSync(path.join(venvPath, "bin", "python3"), "755");
    } catch (e) {
      console.log("Note: Could not set Python binary permissions:", e.message);
    }

    console.log("Python bundle created successfully for Linux!");
  } catch (linuxError) {
    console.error("Failed to create Linux Python bundle:", linuxError.message);
    console.error("\nPlease ensure you have Python 3.9+ installed:");
    console.error("  sudo apt install python3 python3-pip python3-venv");
    console.error("or equivalent for your distribution.");
    process.exit(1);
  }
}

module.exports = {
  buildLinux,
};
