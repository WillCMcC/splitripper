const fs = require("fs");
const path = require("path");

const { buildMacOS } = require("./build/platform-macos");
const { buildWindows } = require("./build/platform-windows");
const { buildLinux } = require("./build/platform-linux");

console.log("Building Python bundle for Electron app (PBS on macOS)...");

const projectRoot = __dirname;
const bundleDir = path.join(projectRoot, "python_runtime_bundle");

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

// Build for the appropriate platform
if (platform === "darwin") {
  buildMacOS(bundleDir, projectRoot);
} else if (platform === "win32") {
  buildWindows(bundleDir);
} else if (platform === "linux") {
  buildLinux(bundleDir);
} else {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

// Copy pretrained models if they exist
const modelsSource = path.join(projectRoot, "src", "pretrained_models");
const modelsDest = path.join(bundleDir, "pretrained_models");
if (fs.existsSync(modelsSource)) {
  console.log("Copying pretrained models...");
  fs.cpSync(modelsSource, modelsDest, { recursive: true });
}

console.log("\nPython bundle created successfully!");
console.log(
  "The bundle includes Python, required dependencies, and ffmpeg (if available)."
);
console.log("You can now run: npm run build");
