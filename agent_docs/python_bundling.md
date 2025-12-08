# Python Runtime Bundling

## Overview

SplitBoy bundles a complete Python 3.12 runtime for distribution. This avoids requiring users to install Python or dependencies.

## Bundle Structure

```
python_runtime_bundle/
  python             # Wrapper script (Unix) or python.exe (Windows)
  pbs/python/        # Python-build-standalone runtime (macOS)
    bin/python3
    lib/python3.12/
      site-packages/ # demucs, yt-dlp, torch, etc.
  ffmpeg/            # Bundled ffmpeg binary
  deno/              # Bundled deno (for EJS support)
```

## Build Process

1. `npm run bundle-python` or `npm run dist` (runs automatically via `predist`)
2. Routes through `bundle-python.js` to platform-specific bundler
3. macOS: `build-python-bundle-pbs.js` uses python-build-standalone

## Key Bundler Files

| File | Purpose |
|------|---------|
| `bundle-python.js` | Platform router |
| `build-python-bundle-pbs.js` | macOS PBS bundler |
| `cleanup-bundle.js` | Remove unnecessary files from bundle |

## Environment Setup

Production mode (`main.js:107-217`):
- Sets `PYTHONHOME` to PBS location (macOS)
- Adds ffmpeg and deno to `PATH`
- Uses wrapper script with shebang

Development mode (`main.js:69-106`):
- Prefers bundled Python if present
- Falls back to conda, then system Python

## Dependencies

Core Python packages (installed in bundle):
- `demucs` - Audio source separation
- `yt-dlp` - YouTube downloading
- `torch` - PyTorch for Demucs
- `fastapi` + `uvicorn` - Web server
- `mutagen` - Audio metadata extraction
