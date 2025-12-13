const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

console.log("Building Python bundle for Electron app (PBS on macOS)...");

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

// Helper function to download and extract Deno
function downloadDeno(targetDir) {
  const denoDir = path.join(targetDir, "deno");
  fs.mkdirSync(denoDir, { recursive: true });

  console.log("Downloading Deno runtime...");

  // Deno version (minimum 2.0.0 required for EJS)
  const denoVersion = "v2.1.4";

  if (platform === "darwin") {
    // macOS - Download for Apple Silicon (arm64)
    // Most Macs are now Apple Silicon, download arm64 by default
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

// Helper function to download and extract ffmpeg
function downloadFFmpeg(targetDir) {
  const ffmpegDir = path.join(targetDir, "ffmpeg");
  fs.mkdirSync(ffmpegDir, { recursive: true });

  console.log("Downloading ffmpeg binaries...");

  if (platform === "darwin") {
    // macOS - Download ffmpeg based on architecture
    // arm64 builds from martin-riedl.de, x86_64 from evermeet.cx
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

// Replace all symlinks under a directory with real files/dirs to avoid electron-builder ensureSymlink issues
function materializeAllSymlinks(root) {
  const stack = [root];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(d, ent.name);
      try {
        const st = fs.lstatSync(p);
        if (st.isSymbolicLink()) {
          let target;
          try {
            target = fs.realpathSync(p);
          } catch (e) {
            console.warn("Broken symlink (skipping):", p, e.message);
            try {
              fs.rmSync(p, { recursive: true, force: true });
            } catch {}
            continue;
          }
          try {
            fs.rmSync(p, { recursive: true, force: true });
          } catch {}
          try {
            const tStat = fs.statSync(target);
            if (tStat.isDirectory()) {
              fs.cpSync(target, p, { recursive: true });
            } else {
              fs.copyFileSync(target, p);
            }
          } catch (e) {
            console.warn(
              "Failed to materialize symlink:",
              p,
              "->",
              target,
              e.message
            );
          }
        } else if (st.isDirectory()) {
          stack.push(p);
        }
      } catch {}
    }
  }
}

if (platform === "darwin") {
  // macOS - Use python-build-standalone (no .framework; relocatable CPython)
  console.log("Creating python-build-standalone bundle for macOS (arm64)...");

  const venvPath = path.join(bundleDir, "venv");

  try {
    const pbsRoot = path.join(bundleDir, "pbs");
    fs.mkdirSync(pbsRoot, { recursive: true });

    // Allow override via env PBS_URL to pin/override asset if needed
    const envUrl = process.env.PBS_URL;
    const urls = [];
    if (envUrl) urls.push(envUrl);

    // Known good PBS assets (arm64 macOS) from astral-sh. Try gzip first, then zstd; allow override via PBS_URL.
    urls.push(
      // gzip assets (preferred; no external tools needed)
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250902/cpython-3.12.11+20250902-aarch64-apple-darwin-install_only.tar.gz",
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250902/cpython-3.12.11+20250902-arm64-apple-darwin-install_only.tar.gz",
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250701/cpython-3.12.10+20250701-aarch64-apple-darwin-install_only.tar.gz",
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250701/cpython-3.12.10+20250701-arm64-apple-darwin-install_only.tar.gz",
      // zstd fallback assets (requires system tar with zstd support)
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250902/cpython-3.12.11+20250902-aarch64-apple-darwin-install_only.tar.zst",
      "https://github.com/astral-sh/python-build-standalone/releases/download/20250902/cpython-3.12.11+20250902-arm64-apple-darwin-install_only.tar.zst"
    );

    function extractTar(archive, dest) {
      const name = path.basename(archive);
      if (name.endsWith(".tar.gz")) {
        execSync(`tar -xzf "${archive}" -C "${dest}"`, { stdio: "inherit" });
        return true;
      }
      if (name.endsWith(".tar.zst")) {
        // Try tar with --zstd, then tar -I zstd
        try {
          execSync(`tar --zstd -xf "${archive}" -C "${dest}"`, {
            stdio: "inherit",
          });
          return true;
        } catch (e1) {
          try {
            execSync(`tar -I zstd -xf "${archive}" -C "${dest}"`, {
              stdio: "inherit",
            });
            return true;
          } catch (e2) {
            throw new Error(`tar zstd extraction failed: ${e2.message || e2}`);
          }
        }
      }
      throw new Error(`Unsupported archive format: ${name}`);
    }

    let extracted = false;
    for (const url of urls) {
      try {
        console.log("Downloading python-build-standalone:", url);
        const out = url.endsWith(".tar.zst") ? "pbs.tar.zst" : "pbs.tar.gz";
        try {
          fs.unlinkSync(out);
        } catch {}
        execSync(`curl -L -o "${out}" "${url}"`, { stdio: "inherit" });
        extractTar(out, pbsRoot);
        try {
          fs.unlinkSync(out);
        } catch {}
        extracted = true;
        break;
      } catch (e) {
        console.warn("PBS download/extract failed for", url, e.message);
        try {
          fs.unlinkSync("pbs.tar.gz");
        } catch {}
        try {
          fs.unlinkSync("pbs.tar.zst");
        } catch {}
      }
    }
    if (!extracted) {
      throw new Error(
        "Failed to download/extract python-build-standalone. Set PBS_URL env to a valid asset."
      );
    }

    // Locate python3 inside extracted directory
    function findPythonBin(dir) {
      const stack = [dir];
      while (stack.length) {
        const d = stack.pop();
        try {
          const entries = fs.readdirSync(d, { withFileTypes: true });
          for (const ent of entries) {
            const p = path.join(d, ent.name);
            if (ent.isDirectory()) {
              // prioritize bin directories
              if (ent.name === "bin") {
                try {
                  const cand = path.join(p, "python3");
                  if (fs.existsSync(cand)) return cand;
                } catch {}
              }
              stack.push(p);
            } else if (ent.isFile() && ent.name === "python3") {
              return p;
            }
          }
        } catch {}
      }
      return null;
    }

    const pbsPython = findPythonBin(pbsRoot);
    if (!pbsPython) {
      throw new Error(
        "Could not locate python3 in python-build-standalone archive"
      );
    }
    try {
      fs.chmodSync(pbsPython, "755");
    } catch {}
    console.log("Using PBS python at:", pbsPython);

    console.log("Bootstrapping pip into PBS interpreter...");
    execSync(`curl -L -o get-pip.py https://bootstrap.pypa.io/get-pip.py`, {
      stdio: "inherit",
    });
    execSync(`"${pbsPython}" get-pip.py`, { stdio: "inherit" });
    try {
      fs.unlinkSync("get-pip.py");
    } catch {}

    console.log("Upgrading pip...");
    execSync(`"${pbsPython}" -m pip install --upgrade pip`, {
      stdio: "inherit",
      env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
    });

    console.log("Installing Python dependencies from requirements.txt...");
    const reqPath = path.join(__dirname, "requirements.txt");
    execSync(`"${pbsPython}" -m pip install -r "${reqPath}"`, {
      stdio: "inherit",
      env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
    });

    // Install audio stack (prefer binary wheels)
    try {
      console.log("Installing audio stack (binary wheels)...");
      execSync(
        `"${pbsPython}" -m pip install --only-binary :all: torch torchaudio soundfile librosa`,
        {
          stdio: "inherit",
          env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
        }
      );
      // demucs may not have a universal wheel; try best-effort
      try {
        execSync(`"${pbsPython}" -m pip install demucs diffq`, {
          stdio: "inherit",
          env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
        });
      } catch (e) {
        console.warn(
          "demucs wheel not found; will attempt runtime install if needed."
        );
      }
    } catch (e) {
      console.warn("Audio stack install encountered an issue:", e.message);
    }

    // Pre-download the default htdemucs model so users don't have to wait after install
    try {
      console.log("Pre-downloading default htdemucs model (this may take a few minutes)...");

      // Create a minimal test WAV file (1 second of silence)
      const testWavDir = path.join(bundleDir, "test_audio");
      fs.mkdirSync(testWavDir, { recursive: true });
      const testWav = path.join(testWavDir, "silence.wav");

      // Use Python to create the silent WAV file
      const createWavScript = `
import wave
import struct
with wave.open('${testWav.replace(/\\/g, "\\\\")}', 'w') as wav:
    wav.setnchannels(1)
    wav.setsampwidth(2)
    wav.setframerate(44100)
    wav.writeframes(struct.pack('<' + 'h' * 44100, *([0] * 44100)))
print('Created test WAV file')
`;
      execSync(`"${pbsPython}" -c "${createWavScript}"`, { stdio: "inherit" });

      // Run demucs on the test file to trigger model download
      const testOutDir = path.join(testWavDir, "output");
      fs.mkdirSync(testOutDir, { recursive: true });

      execSync(
        `"${pbsPython}" -m demucs.separate -n htdemucs --mp3 -o "${testOutDir}" "${testWav}"`,
        {
          stdio: "inherit",
          env: { ...process.env, MACOSX_DEPLOYMENT_TARGET: "14.0" },
          timeout: 600000, // 10 minute timeout
        }
      );

      console.log("htdemucs model pre-downloaded successfully!");

      // Clean up test files
      fs.rmSync(testWavDir, { recursive: true, force: true });

      // Copy the model files into the bundle for distribution
      // htdemucs uses signature 955717e8
      const userCacheDir = path.join(
        process.env.HOME,
        ".cache/torch/hub/checkpoints"
      );
      const bundledModelsDir = path.join(bundleDir, "models");
      fs.mkdirSync(bundledModelsDir, { recursive: true });

      // Find and copy the htdemucs model file (955717e8-*.th)
      if (fs.existsSync(userCacheDir)) {
        const files = fs.readdirSync(userCacheDir);
        for (const file of files) {
          if (file.startsWith("955717e8-") && file.endsWith(".th")) {
            const src = path.join(userCacheDir, file);
            const dst = path.join(bundledModelsDir, file);
            fs.copyFileSync(src, dst);
            console.log(`Bundled model file: ${file}`);
          }
        }
      }
    } catch (e) {
      console.warn("Model pre-download failed (will download on first use):", e.message);
      // Clean up on failure
      try {
        const testWavDir = path.join(bundleDir, "test_audio");
        if (fs.existsSync(testWavDir)) {
          fs.rmSync(testWavDir, { recursive: true, force: true });
        }
      } catch {}
    }

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

    // Create wrapper script that runs PBS Python directly (no venv) and sets PYTHONHOME
    const pythonWrapper = `#!/bin/bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
# Clean environment and set relocatable prefixes
unset __PYVENV_LAUNCHER__
export PYTHONHOME="$DIR/pbs/python"
export PATH="$DIR/deno:$DIR/ffmpeg:$PATH"
export FFMPEG_LOCATION="$DIR/ffmpeg"
exec "$DIR/pbs/python/bin/python3" "$@"
`;
    fs.writeFileSync(path.join(bundleDir, "python"), pythonWrapper);
    fs.chmodSync(path.join(bundleDir, "python"), "755");

    // Materialize any remaining symlinks under python_runtime_bundle (e.g., venv/bin/python3)
    try {
      materializeAllSymlinks(bundleDir);
      console.log("Symlinks materialized under python_runtime_bundle");
    } catch (e) {
      console.warn("Symlink materialization warning:", e.message);
    }

    console.log("PBS macOS bundle created successfully!");
  } catch (macError) {
    console.error("Failed to create macOS PBS bundle:", macError.message);
    console.error(
      "\nTip: Set PBS_URL env var to a valid asset from indygreg/python-build-standalone releases and retry."
    );
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
