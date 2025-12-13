const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const { downloadDeno, downloadFFmpeg } = require("./download-utils");
const { materializeAllSymlinks } = require("./symlink-utils");

/**
 * Extract tar archive (supports .tar.gz and .tar.zst)
 * @param {string} archive - Path to archive file
 * @param {string} dest - Destination directory
 * @returns {boolean} True if extraction succeeded
 */
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

/**
 * Find python3 binary inside a directory tree
 * @param {string} dir - Directory to search
 * @returns {string|null} Path to python3 binary or null
 */
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

/**
 * Build Python bundle for macOS using python-build-standalone
 * @param {string} bundleDir - Target bundle directory
 * @param {string} projectRoot - Project root directory (for requirements.txt)
 */
function buildMacOS(bundleDir, projectRoot) {
  console.log("Creating python-build-standalone bundle for macOS (arm64)...");

  try {
    const pbsRoot = path.join(bundleDir, "pbs");
    fs.mkdirSync(pbsRoot, { recursive: true });

    // Allow override via env PBS_URL to pin/override asset if needed
    const envUrl = process.env.PBS_URL;
    const urls = [];
    if (envUrl) urls.push(envUrl);

    // Known good PBS assets (arm64 macOS) from astral-sh. Try gzip first, then zstd.
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
    const reqPath = path.join(projectRoot, "requirements.txt");
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

    // Pre-download the default htdemucs model
    preDownloadModel(bundleDir, pbsPython);

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

    // Materialize any remaining symlinks under python_runtime_bundle
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
}

/**
 * Pre-download the default htdemucs model
 * @param {string} bundleDir - Bundle directory
 * @param {string} pbsPython - Path to Python binary
 */
function preDownloadModel(bundleDir, pbsPython) {
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
}

module.exports = {
  buildMacOS,
};
