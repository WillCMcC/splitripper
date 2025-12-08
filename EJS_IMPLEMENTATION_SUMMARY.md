# EJS Implementation Summary

## Overview

This document summarizes the changes made to support yt-dlp's new EJS (External JavaScript Scripts) requirements for downloading from YouTube.

## Background

As of recent yt-dlp versions, YouTube downloads require solving JavaScript challenges using an external JavaScript runtime. This replaces the previous JSInterp and PhantomJS-based approaches.

**Reference:** [yt-dlp EJS Documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

## Requirements

yt-dlp's EJS feature requires two components:

1. **JavaScript Runtime** - Deno (recommended, v2.0.0+)
2. **EJS Challenge Solver Scripts** - yt-dlp-ejs package

## Changes Made

### 1. Updated Python Dependencies (`requirements.txt`)

**Changed:**

```diff
-yt-dlp
+yt-dlp[default]
```

**Reason:** The `[default]` dependency group automatically includes the `yt-dlp-ejs` package, which contains the JavaScript challenge solver scripts. This ensures they're always bundled with yt-dlp.

### 2. Added Deno Runtime Bundling (`build-python-bundle-pbs.js`)

**Added:** New `downloadDeno()` function that:

- Downloads Deno v2.1.4 binaries for each platform:
  - **macOS:** `deno-aarch64-apple-darwin.zip` (Apple Silicon)
  - **Windows:** `deno-x86_64-pc-windows-msvc.zip`
  - **Linux:** `deno-x86_64-unknown-linux-gnu.zip`
- Extracts to `python_runtime_bundle/deno/` directory
- Sets executable permissions on Unix-like systems

**Integration:** Called during bundle creation for all platforms alongside ffmpeg downloads.

### 3. Updated Bundle Wrapper Scripts

**macOS & Linux:** Updated bash wrapper scripts to include Deno in PATH:

```bash
export PATH="$DIR/deno:$DIR/ffmpeg:$PATH"
```

This ensures yt-dlp can find the Deno runtime when executing challenge solver scripts.

### 4. Updated Electron Runtime Configuration (`main.js`)

**Production Mode Changes:**

**macOS/Linux:**

```javascript
const denoDir = path.join(bundleDir, "deno");
const ffmpegDir = path.join(bundleDir, "ffmpeg");

if (fs.existsSync(denoDir)) {
  env.PATH = `${denoDir}${path.delimiter}${env.PATH || ""}`;
}
if (fs.existsSync(ffmpegDir)) {
  env.PATH = `${ffmpegDir}${path.delimiter}${env.PATH || ""}`;
}
```

**Windows:**

```javascript
const denoDir = path.join(bundleDir, "deno");
const ffmpegDir = path.join(bundleDir, "ffmpeg");

env.PATH = `${bundleDir};${bundleDir}\\Scripts`;

if (fs.existsSync(denoDir)) {
  env.PATH = `${denoDir};${env.PATH}`;
}
if (fs.existsSync(ffmpegDir)) {
  env.PATH = `${ffmpegDir};${env.PATH}`;
}

env.PATH = `${env.PATH};${process.env.PATH || ""}`;
```

## How It Works

1. **Build Time:**

   - `npm run bundle-python` downloads Python, dependencies (including yt-dlp[default]), Deno, and ffmpeg
   - Everything is placed in `python_runtime_bundle/`
   - Wrapper scripts are created with proper PATH configuration

2. **Runtime:**
   - Electron app launches the Python server with environment that includes Deno in PATH
   - When yt-dlp needs to download from YouTube:
     - It detects Deno is available (enabled by default)
     - Uses yt-dlp-ejs scripts to solve JavaScript challenges
     - Runs challenge code in Deno with restricted permissions
     - Proceeds with download

## Benefits

- **No Manual Configuration:** Deno is enabled by default when detected
- **Secure:** Deno runs with restricted permissions (no file system or network access for challenge scripts)
- **Reliable:** Uses yt-dlp[default] which bundles EJS scripts, avoiding network dependencies
- **Cross-Platform:** Works on macOS, Windows, and Linux

## Testing

To verify the implementation works:

1. Rebuild the Python bundle:

   ```bash
   npm run bundle-python
   ```

2. Run the application:

   ```bash
   npm start
   ```

3. Try downloading a YouTube video/audio
   - The download should succeed without JavaScript challenge errors
   - Check console logs for any Deno-related messages if issues occur

## Troubleshooting

If YouTube downloads still fail:

1. **Check Deno is bundled:**

   - Look for `python_runtime_bundle/deno/deno` (or `deno.exe` on Windows)

2. **Check yt-dlp-ejs is installed:**

   ```bash
   ./python_runtime_bundle/python -m pip list | grep yt-dlp-ejs
   ```

3. **Check server logs:**

   - Look in Electron's Developer Tools console
   - Check `~/Library/Application Support/SplitBoy/logs/server.log` (macOS)

4. **Manual verification:**

   ```bash
   # Verify Deno works
   ./python_runtime_bundle/deno/deno --version

   # Verify yt-dlp can use it
   ./python_runtime_bundle/python -m yt_dlp --print "JS runtime: %(js_runtime)s" "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
   ```

## Future Considerations

- **Deno Updates:** May need to update Deno version periodically for performance/security
- **Intel Macs:** Currently downloads ARM64 Deno for macOS; Intel Macs would need x86_64 version
- **Alternative Runtimes:** Could add support for Node.js or Bun if needed, though Deno is recommended

## References

- [yt-dlp EJS Documentation](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [Deno Installation Guide](https://docs.deno.com/runtime/getting_started/installation/)
- [yt-dlp-ejs Package](https://github.com/yt-dlp/yt-dlp-ejs)
