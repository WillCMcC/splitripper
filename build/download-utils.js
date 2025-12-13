const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const platform = process.platform;
const arch = process.arch;

/**
 * Download and extract Deno runtime
 * @param {string} targetDir - Directory to install Deno into
 */
function downloadDeno(targetDir) {
  const denoDir = path.join(targetDir, "deno");
  fs.mkdirSync(denoDir, { recursive: true });

  console.log("Downloading Deno runtime...");

  // Deno version (minimum 2.0.0 required for EJS)
  const denoVersion = "v2.1.4";

  if (platform === "darwin") {
    // macOS - Download for Apple Silicon (arm64)
    try {
      const denoUrl = `https://github.com/denoland/deno/releases/download/${denoVersion}/deno-aarch64-apple-darwin.zip`;

      console.log(
        `Downloading Deno ${denoVersion} for macOS (Apple Silicon)...`
      );
      execSync(`curl -L -o deno.zip "${denoUrl}"`, { stdio: "inherit" });
      execSync(`unzip -o deno.zip -d "${denoDir}"`, { stdio: "inherit" });
      fs.unlinkSync("deno.zip");

      // Make it executable
      fs.chmodSync(path.join(denoDir, "deno"), "755");
      console.log("Deno downloaded successfully for macOS");
    } catch (e) {
      console.warn(
        "Warning: Could not download Deno for macOS; yt-dlp EJS features may not work."
      );
    }
  } else if (platform === "win32") {
    // Windows
    try {
      const denoUrl = `https://github.com/denoland/deno/releases/download/${denoVersion}/deno-x86_64-pc-windows-msvc.zip`;

      console.log(`Downloading Deno ${denoVersion} for Windows...`);
      execSync(`curl -L -o deno.zip "${denoUrl}"`, { stdio: "inherit" });
      execSync(`tar -xf deno.zip -C "${denoDir}"`, { stdio: "inherit" });
      fs.unlinkSync("deno.zip");
      console.log("Deno downloaded successfully for Windows");
    } catch (e) {
      console.warn("Warning: Could not download Deno for Windows.");
    }
  } else if (platform === "linux") {
    // Linux
    try {
      const denoUrl = `https://github.com/denoland/deno/releases/download/${denoVersion}/deno-x86_64-unknown-linux-gnu.zip`;

      console.log(`Downloading Deno ${denoVersion} for Linux...`);
      execSync(`curl -L -o deno.zip "${denoUrl}"`, { stdio: "inherit" });
      execSync(`unzip -o deno.zip -d "${denoDir}"`, { stdio: "inherit" });
      fs.unlinkSync("deno.zip");

      // Make it executable
      fs.chmodSync(path.join(denoDir, "deno"), "755");
      console.log("Deno downloaded successfully for Linux");
    } catch (e) {
      console.warn("Warning: Could not download Deno for Linux.");
    }
  }
}

/**
 * Download and extract FFmpeg binaries
 * @param {string} targetDir - Directory to install FFmpeg into
 */
function downloadFFmpeg(targetDir) {
  const ffmpegDir = path.join(targetDir, "ffmpeg");
  fs.mkdirSync(ffmpegDir, { recursive: true });

  console.log("Downloading ffmpeg binaries...");

  if (platform === "darwin") {
    // macOS - Download ffmpeg based on architecture
    try {
      if (arch === "arm64") {
        // Apple Silicon - use martin-riedl.de builds
        const ffmpegUrl = "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffmpeg.zip";
        const ffprobeUrl = "https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/ffprobe.zip";

        console.log("Downloading ffmpeg for macOS (arm64)...");
        execSync(`curl -L -o ffmpeg.zip "${ffmpegUrl}"`, { stdio: "inherit" });
        execSync(`unzip -o ffmpeg.zip -d "${ffmpegDir}"`, { stdio: "inherit" });
        fs.unlinkSync("ffmpeg.zip");

        console.log("Downloading ffprobe for macOS (arm64)...");
        execSync(`curl -L -o ffprobe.zip "${ffprobeUrl}"`, { stdio: "inherit" });
        execSync(`unzip -o ffprobe.zip -d "${ffmpegDir}"`, { stdio: "inherit" });
        fs.unlinkSync("ffprobe.zip");
      } else {
        // Intel Mac - use evermeet.cx builds
        const ffmpegUrl = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
        const ffprobeUrl = "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip";

        console.log("Downloading ffmpeg for macOS (x86_64)...");
        execSync(`curl -L -o ffmpeg.zip "${ffmpegUrl}"`, { stdio: "inherit" });
        execSync(`unzip -o ffmpeg.zip -d "${ffmpegDir}"`, { stdio: "inherit" });
        fs.unlinkSync("ffmpeg.zip");

        console.log("Downloading ffprobe for macOS (x86_64)...");
        execSync(`curl -L -o ffprobe.zip "${ffprobeUrl}"`, { stdio: "inherit" });
        execSync(`unzip -o ffprobe.zip -d "${ffmpegDir}"`, { stdio: "inherit" });
        fs.unlinkSync("ffprobe.zip");
      }

      // Make them executable
      fs.chmodSync(path.join(ffmpegDir, "ffmpeg"), "755");
      fs.chmodSync(path.join(ffmpegDir, "ffprobe"), "755");
    } catch (e) {
      console.warn(
        "Warning: Could not download static ffmpeg for macOS; proceeding without bundling ffmpeg."
      );
    }
  } else if (platform === "win32") {
    // Windows - Download from gyan.dev
    try {
      const ffmpegUrl =
        "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
      console.log("Downloading ffmpeg for Windows...");
      execSync(`curl -L -o ffmpeg-win.zip "${ffmpegUrl}"`, {
        stdio: "inherit",
      });
      execSync(`tar -xf ffmpeg-win.zip`, { stdio: "inherit" });

      // Find the extracted folder (it has a version number)
      const dirs = fs
        .readdirSync(".")
        .filter((f) => f.startsWith("ffmpeg-") && fs.statSync(f).isDirectory());
      if (dirs.length > 0) {
        const ffmpegExtractDir = dirs[0];
        fs.copyFileSync(
          path.join(ffmpegExtractDir, "bin", "ffmpeg.exe"),
          path.join(ffmpegDir, "ffmpeg.exe")
        );
        fs.copyFileSync(
          path.join(ffmpegExtractDir, "bin", "ffprobe.exe"),
          path.join(ffmpegDir, "ffprobe.exe")
        );
        fs.rmSync(ffmpegExtractDir, { recursive: true, force: true });
      }
      fs.unlinkSync("ffmpeg-win.zip");
    } catch (e) {
      console.warn("Warning: Could not bundle ffmpeg for Windows.");
    }
  } else if (platform === "linux") {
    // Linux - Try to copy system ffmpeg if available
    try {
      const ffmpegPath = execSync("which ffmpeg", { encoding: "utf8" }).trim();
      const ffprobePath = execSync("which ffprobe", {
        encoding: "utf8",
      }).trim();

      if (ffmpegPath && ffprobePath) {
        console.log("Copying system ffmpeg binaries...");
        fs.copyFileSync(ffmpegPath, path.join(ffmpegDir, "ffmpeg"));
        fs.copyFileSync(ffprobePath, path.join(ffmpegDir, "ffprobe"));
        fs.chmodSync(path.join(ffmpegDir, "ffmpeg"), "755");
        fs.chmodSync(path.join(ffmpegDir, "ffprobe"), "755");
      }
    } catch (e) {
      console.warn("Warning: Could not bundle ffmpeg for Linux.");
    }
  }
}

module.exports = {
  downloadDeno,
  downloadFFmpeg,
};
