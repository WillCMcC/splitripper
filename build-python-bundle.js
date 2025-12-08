const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("Building Python bundle for Electron app...");

const bundleDir = path.join(__dirname, "python_runtime_bundle");

// Clean up existing bundle
if (fs.existsSync(bundleDir)) {
  console.log("Removing existing bundle...");
  fs.rmSync(bundleDir, { recursive: true, force: true });
}

// Create bundle directory
fs.mkdirSync(bundleDir, { recursive: true });

// Determine the platform
const platform = process.platform;
const arch = process.arch;

console.log(`Building for platform: ${platform}, arch: ${arch}`);

// Helper function to download and extract ffmpeg
function downloadFFmpeg(targetDir) {
  const ffmpegDir = path.join(targetDir, "ffmpeg");
  fs.mkdirSync(ffmpegDir, { recursive: true });

  console.log("Downloading ffmpeg binaries...");

  if (platform === "darwin") {
    // macOS - Download ffmpeg from evermeet.cx (static builds)
    try {
      const ffmpegUrl = "https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip";
      const ffprobeUrl = "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip";

      console.log("Downloading ffmpeg for macOS...");
      execSync(`curl -L -o ffmpeg.zip "${ffmpegUrl}"`, { stdio: "inherit" });
      execSync(`unzip -o ffmpeg.zip -d "${ffmpegDir}"`, { stdio: "inherit" });
      fs.unlinkSync("ffmpeg.zip");

      console.log("Downloading ffprobe for macOS...");
      execSync(`curl -L -o ffprobe.zip "${ffprobeUrl}"`, { stdio: "inherit" });
      execSync(`unzip -o ffprobe.zip -d "${ffmpegDir}"`, {
        stdio: "inherit",
      });
      fs.unlinkSync("ffprobe.zip");

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

if (platform === "darwin") {
  // macOS - Bundle python.org Python.framework inside app resources (self-contained, no Homebrew)
  console.log("Creating Python.framework-based bundle for macOS...");

  const PY_VERSIONS = ["3.12", "3.11", "3.10", "3.9"];
  const sysFrameworkRoot = "/Library/Frameworks/Python.framework";
  let foundVersion = null;

  try {
    for (const v of PY_VERSIONS) {
      const verDir = path.join(sysFrameworkRoot, "Versions", v);
      if (fs.existsSync(verDir)) {
        foundVersion = v;
        break;
      }
    }
  } catch {}

  if (!foundVersion) {
    console.error(
      "Failed to locate python.org Python.framework at /Library/Frameworks. Please install from https://www.python.org/downloads/macos/ (prefer 3.12)."
    );
    process.exit(1);
  }

  console.log(`Using Python.framework version ${foundVersion}`);

  // Copy entire framework tree into the bundle
  const targetFramework = path.join(bundleDir, "Python.framework");
  console.log("Copying Python.framework into bundle...");
  fs.cpSync(sysFrameworkRoot, targetFramework, {
    recursive: true,
    errorOnExist: false,
    force: true,
    dereference: false,
  });

  // Prune headers and Tk.framework that can include absolute/broken symlinks outside the bundle.
  // This avoids ENOENT like .../Tk.framework/.../PrivateHeaders during electron-builder packaging.
  try {
    const verRoot = path.join(targetFramework, "Versions", foundVersion);
    const maybeRemove = (p) => {
      try {
        // lstatSync throws if missing; wrap to ignore
        fs.lstatSync(p);
        fs.rmSync(p, { recursive: true, force: true });
      } catch {}
    };
    // Top-level and versioned headers
    maybeRemove(path.join(targetFramework, "Headers"));
    maybeRemove(path.join(targetFramework, "PrivateHeaders"));
    maybeRemove(path.join(verRoot, "Headers"));
    maybeRemove(path.join(verRoot, "PrivateHeaders"));
    // Ensure top-level framework symlinks exist and point to Versions/Current/*
    try {
      fs.rmSync(path.join(targetFramework, "Python"), { force: true });
    } catch {}
    try {
      fs.rmSync(path.join(targetFramework, "Resources"), {
        recursive: true,
        force: true,
      });
    } catch {}
    // Materialize top-level links as real files/dirs to avoid electron-builder ensureSymlink issues
    try {
      const srcPy = path.join(targetFramework, "Versions", "Current", "Python");
      const dstPy = path.join(targetFramework, "Python");
      fs.copyFileSync(srcPy, dstPy);
    } catch (e) {
      console.warn("Failed to materialize top-level Python:", e.message);
    }
    try {
      const srcRes = path.join(
        targetFramework,
        "Versions",
        "Current",
        "Resources"
      );
      const dstRes = path.join(targetFramework, "Resources");
      fs.cpSync(srcRes, dstRes, { recursive: true });
    } catch (e) {
      console.warn("Failed to materialize top-level Resources:", e.message);
    }
    // Remove Tk.framework (not needed for headless FastAPI server; often contains problematic symlinks)
    maybeRemove(path.join(verRoot, "Frameworks", "Tk.framework"));
    // Remove entire Frameworks folders to avoid symlinks pointing to system /Library/Frameworks (e.g. Python 3.13 Tk)
    maybeRemove(path.join(verRoot, "Frameworks"));
    maybeRemove(path.join(targetFramework, "Frameworks"));
    // Optional docs cleanup
    maybeRemove(path.join(verRoot, "Documentation"));

    // Prune other Python.framework versions; keep only foundVersion, and reset Versions/Current -> foundVersion
    try {
      const versionsDir = path.join(targetFramework, "Versions");
      const entries = fs.readdirSync(versionsDir, { withFileTypes: true });
      for (const ent of entries) {
        const name = ent.name;
        if (name === "Current" || name === foundVersion) continue;
        try {
          fs.rmSync(path.join(versionsDir, name), {
            recursive: true,
            force: true,
          });
        } catch {}
      }
      // Replace Current symlink/directory with a symlink to foundVersion
      try {
        fs.rmSync(path.join(versionsDir, "Current"), {
          recursive: true,
          force: true,
        });
      } catch {}
      try {
        fs.symlinkSync(foundVersion, path.join(versionsDir, "Current"));
      } catch (e2) {
        // If symlink fails (e.g., permissions), copy minimal structure as a fallback
        try {
          const curPath = path.join(versionsDir, "Current");
          fs.mkdirSync(curPath, { recursive: true });
        } catch {}
      }
    } catch (e2) {
      console.warn("Version prune warning:", e2.message);
    }
  } catch (e) {
    console.warn("Prune step warning:", e.message);
  }

  // Interpreter path inside the copied framework
  const frameworkPython = path.join(
    targetFramework,
    "Versions",
    foundVersion,
    "Resources",
    "Python.app",
    "Contents",
    "MacOS",
    "Python"
  );

  if (!fs.existsSync(frameworkPython)) {
    console.error(
      `Copied framework does not contain interpreter at: ${frameworkPython}`
    );
    process.exit(1);
  }

  const venvPath = path.join(bundleDir, "venv");

  try {
    console.log("Creating virtual environment inside bundle...");
    execSync(`"${frameworkPython}" -m venv "${venvPath}"`, {
      stdio: "inherit",
    });

    console.log("Upgrading pip...");
    execSync(`"${venvPath}/bin/pip" install --upgrade pip`, {
      stdio: "inherit",
      env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
    });

    console.log("Installing Python dependencies from requirements.txt...");
    const reqPath = path.join(__dirname, "requirements.txt");
    execSync(`"${venvPath}/bin/pip" install -r "${reqPath}"`, {
      stdio: "inherit",
      env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
    });

    // Install audio stack (Demucs + PyTorch) with wheels for arm64/macOS 14+
    // Use only binary wheels to avoid local compilation and ensure portability.
    try {
      console.log("Installing Demucs/PyTorch audio stack...");
      execSync(
        `"${venvPath}/bin/pip" install --only-binary :all: torch torchaudio soundfile librosa demucs`,
        {
          stdio: "inherit",
          env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
        }
      );
    } catch (e) {
      console.warn("Audio stack installation encountered an issue:", e.message);
      console.warn(
        "Continuing; runtime may attempt to install missing packages if needed."
      );
    }

    // Download ffmpeg binaries
    try {
      downloadFFmpeg(bundleDir);
      console.log("FFmpeg binaries downloaded");
    } catch (e) {
      console.warn("FFmpeg download failed:", e.message);
    }

    // Create wrapper script that uses the in-bundle venv and ffmpeg
    const pythonWrapper = `#!/bin/bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
export PATH="$DIR/ffmpeg:$PATH"
export FFMPEG_LOCATION="$DIR/ffmpeg"
exec "$DIR/venv/bin/python" "$@"
`;
    fs.writeFileSync(path.join(bundleDir, "python"), pythonWrapper);
    fs.chmodSync(path.join(bundleDir, "python"), "755");

    // Ensure Python binaries are executable
    try {
      fs.chmodSync(path.join(venvPath, "bin", "python"), "755");
      fs.chmodSync(path.join(venvPath, "bin", "python3"), "755");
      fs.chmodSync(frameworkPython, "755");
    } catch (e) {
      console.log("Note: Could not set Python binary permissions:", e.message);
    }

    console.log("Python.framework bundle created successfully!");
  } catch (macError) {
    console.error("Failed to create macOS Python bundle:", macError.message);
    console.error("\nPlease ensure python.org Python is installed:");
    console.error("  https://www.python.org/downloads/macos/");
    process.exit(1);
  }
} else if (platform === "win32") {
  // Windows
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

    console.log("Python bundle created successfully for Windows!");
  } catch (winError) {
    console.error("Failed to create Windows Python bundle:", winError);
    process.exit(1);
  }
} else if (platform === "linux") {
  // Linux - Use same simplified venv approach
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

    // Create simple wrapper script
    const pythonWrapper = `#!/bin/bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
export PATH="$DIR/ffmpeg:$PATH"
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

// Copy pretrained models if they exist
const modelsSource = path.join(__dirname, "src", "pretrained_models");
const modelsDest = path.join(bundleDir, "pretrained_models");
if (fs.existsSync(modelsSource)) {
  console.log("Copying pretrained models...");
  fs.cpSync(modelsSource, modelsDest, { recursive: true });
}

console.log("\n✅ Python bundle created successfully!");
console.log(
  "The bundle includes Python, required dependencies, and ffmpeg (if available)."
);
console.log("You can now run: npm run build");
