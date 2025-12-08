/**
 * Electron-Builder afterPack hook.
 * - Ensures bundled executables are chmod +x
 * - Logs dylib dependencies for sanity checking (detects accidental Homebrew links)
 * - Prepares the app bundle for local QA (does not codesign)
 *
 * Note: This does NOT modify install names or rpaths. With python-build-standalone or a fully
 * in-bundle venv, that shouldn't be necessary. If you later need to patch dylibs,
 * do it here with install_name_tool and vtool.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

function safeChmod(p, mode) {
  try {
    if (fs.existsSync(p)) fs.chmodSync(p, mode);
  } catch (e) {
    console.warn("chmod failed:", p, e.message);
  }
}

function tryOtool(p) {
  try {
    const out = execSync(`otool -L "${p}"`, {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    return out;
  } catch (e) {
    return null;
  }
}

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName } = context;
  if (electronPlatformName !== "darwin") return;

  // Path inside the .app bundle where our app resources live
  const appResources = path.join(
    appOutDir,
    "SplitBoy.app",
    "Contents",
    "Resources",
    "app"
  );

  // Ensure python wrapper and ffmpeg binaries are executable
  const pyWrapper = path.join(appResources, "python_runtime_bundle", "python");
  const ffmpeg = path.join(
    appResources,
    "python_runtime_bundle",
    "ffmpeg",
    "ffmpeg"
  );
  const ffprobe = path.join(
    appResources,
    "python_runtime_bundle",
    "ffmpeg",
    "ffprobe"
  );
  safeChmod(pyWrapper, 0o755);
  safeChmod(ffmpeg, 0o755);
  safeChmod(ffprobe, 0o755);

  // If a venv exists, also make sure python binaries are exec
  const venvPy = path.join(
    appResources,
    "python_runtime_bundle",
    "venv",
    "bin",
    "python"
  );
  const venvPy3 = path.join(
    appResources,
    "python_runtime_bundle",
    "venv",
    "bin",
    "python3"
  );
  safeChmod(venvPy, 0o755);
  safeChmod(venvPy3, 0o755);

  // Sanity logs: detect accidental Homebrew or system-local paths
  const suspicious = [];
  const candidates = [pyWrapper, venvPy, venvPy3, ffmpeg, ffprobe].filter((p) =>
    fs.existsSync(p)
  );

  for (const bin of candidates) {
    const out = tryOtool(bin);
    if (!out) continue;
    const lines = out.split("\n").slice(1); // skip first line (binary:)
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      if (
        s.includes("/opt/homebrew/") ||
        s.includes("/usr/local/opt/") ||
        s.includes("Cellar") ||
        s.includes("@rpath/Python.framework") // unexpected framework refs
      ) {
        suspicious.push({ bin, dep: s });
      }
    }
  }

  if (suspicious.length) {
    console.warn(
      "\n[afterPack] Detected suspicious dylib references that may break on target machines:"
    );
    for (const { bin, dep } of suspicious) {
      console.warn(" -", bin, "->", dep);
    }
    console.warn(
      "[afterPack] These should be resolved before distribution (bundle runtime libs or patch with install_name_tool)."
    );
  } else {
    console.log(
      "[afterPack] No suspicious dylib references detected in python/ffmpeg candidates."
    );
  }

  // Optional: dump small diagnostic file to logs dir for local QA
  try {
    const logDir = path.join(
      appOutDir,
      "SplitBoy.app",
      "Contents",
      "Resources",
      "app",
      "logs"
    );
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(
      path.join(logDir, "afterPack.txt"),
      [
        "afterPack completed",
        `Time: ${new Date().toISOString()}`,
        `Checked: ${candidates.join(", ")}`,
      ].join("\n")
    );
  } catch (e) {
    // ignore
  }
};
