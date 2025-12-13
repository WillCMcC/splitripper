const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { downloadDeno, downloadFFmpeg } = require("./download-utils");

/**
 * Build Python bundle for Windows using embedded Python
 * @param {string} bundleDir - Target bundle directory
 */
function buildWindows(bundleDir) {
  console.log("Creating Python bundle for Windows...");

  try {
    // Download embedded Python for Windows
    const pythonVersion = "3.9.13";
    const pythonUrl = `https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-embed-amd64.zip`;

    console.log("Downloading embedded Python...");
    execSync(`curl -L -o python-embed.zip "${pythonUrl}"`, {
      stdio: "inherit",
    });

    console.log("Extracting Python...");
    execSync(`tar -xf python-embed.zip -C "${bundleDir}"`, {
      stdio: "inherit",
    });
    fs.unlinkSync("python-embed.zip");

    // Enable pip in embedded Python
    const pthFile = path.join(bundleDir, "python39._pth");
    let pthContent = fs.readFileSync(pthFile, "utf8");
    pthContent = pthContent.replace("#import site", "import site");
    fs.writeFileSync(pthFile, pthContent);

    // Download get-pip.py
    console.log("Installing pip...");
    execSync(`curl -L -o get-pip.py https://bootstrap.pypa.io/get-pip.py`, {
      stdio: "inherit",
    });
    execSync(`"${bundleDir}/python.exe" get-pip.py`, { stdio: "inherit" });
    fs.unlinkSync("get-pip.py");

    // Install dependencies including spleeter
    console.log("Installing Python dependencies...");
    execSync(
      `"${bundleDir}/python.exe" -m pip install fastapi uvicorn yt-dlp mutagen spleeter "protobuf>=4.21,<5.0"`,
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

    console.log("Python bundle created successfully for Windows!");
  } catch (winError) {
    console.error("Failed to create Windows Python bundle:", winError);
    process.exit(1);
  }
}

module.exports = {
  buildWindows,
};
