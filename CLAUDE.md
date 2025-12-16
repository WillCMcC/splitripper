# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SplitBoy is an Electron desktop application that downloads audio from YouTube and separates it into vocals and instrumental tracks using Demucs. It bundles a complete Python runtime and runs a FastAPI backend server that the Electron frontend communicates with.

**Tech Stack:**
- Electron + Node.js (main/renderer processes)
- Python 3.12 + FastAPI (backend server)
- Demucs (audio separation)
- yt-dlp (YouTube downloads)

## Essential Commands

```bash
# Development
npm run electron-dev     # Run with DevTools open
npm start               # Alias for npm run electron

# Production build
npm run bundle-python   # Bundle Python runtime (required before dist)
npm run build           # Build distributable with electron-builder
npm run dist            # Build without publishing (runs predist hook)

# Python server standalone
python src/server.py    # FastAPI on http://127.0.0.1:9000

# Testing
npm test                # Full test suite (pytest -v)
npm run test:quick      # Quick test with early exit on failure
npm run test:cov        # Run with coverage reports
```

## Architecture

### Two-Process Model
- **Electron Main** (`main.js`): Window lifecycle, spawns Python server, handles native dialogs via IPC
- **Python Backend** (`src/server.py`): FastAPI server with all business logic (YouTube, Demucs, queue)

### Communication
1. Electron spawns Python server on a free localhost port
2. Frontend (served by FastAPI) calls REST API
3. Electron preload (`preload.js`) exposes `window.electronAPI` for native dialogs

### Key Directories
- `electron/` - Electron modules (server, window, tray, IPC handlers)
- `src/` - Python backend (server.py, routes/, services/, lib/)
- `src/public/` - Frontend static files (HTML, JS, CSS)
- `build/` - Build scripts (platform-specific bundlers)
- `tests/` - Python test suite

## Build Process

1. `npm run predist` automatically invokes `bundle-python.js`
2. Platform bundler (e.g., `build/platform-macos.js`) downloads Python runtime, dependencies, ffmpeg, deno
3. `electron-builder` packages app with bundled runtime
4. `scripts/afterPack.js` runs post-build fixups
5. Output in `dist/` (e.g., `dist/mac-arm64/SplitBoy.app`)

**Important:** The release artifact name `SplitBoy-arm64-mac.zip` must remain consistent to preserve the stable download link:
```
https://github.com/WillCMcC/splitripper/releases/latest/download/SplitBoy-arm64-mac.zip
```

## Configuration & State

**Config** (`src/config.json`):
- `output_dir` - Where stems are saved
- `default_folder` - Optional subfolder
- `max_concurrency` - Parallel threads (1-64)

**State** (`src/lib/state.py`):
- Thread-safe singleton managing queue, progress, workers
- `QueueItem` dataclass for queue entries

**Environment Variables:**
- `SPLITBOY_HOST` - Backend host (default: 127.0.0.1)
- `SPLITBOY_PORT` - Backend port (default: 9000)
- `NODE_ENV=development` - Enables DevTools

## Queue System

- Add items via `/api/queue` (YouTube) or `/api/queue-local` (local files)
- Worker processes with configurable concurrency
- Two-phase progress: 30% download, 70% processing
- Output: `output_dir/[artist]/vocals/song.mp3` and `output_dir/[artist]/instrumental/song.mp3`

## Features Overview

- **Multi-model support**: 7 Demucs models (htdemucs, mdx, etc.) with 2/4/6-stem modes
- **Splits browser**: Browse/play stems with waveform visualization
- **System tray**: Persistent icon for easy access
- **Auto-updates**: yt-dlp updates automatically every 24 hours
- **Performance**: Segmented processing reduces memory from 7GB to 2GB

See `agent_docs/features.md` for detailed feature descriptions.

## Detailed Documentation

For in-depth information, see the `agent_docs/` directory:

- **`agent_docs/architecture.md`** - Detailed architecture, file structure, IPC handlers
- **`agent_docs/api_reference.md`** - Complete FastAPI endpoint reference
- **`agent_docs/features.md`** - Detailed feature descriptions and implementations
- **`agent_docs/python_bundling.md`** - Python runtime bundling details
- **`agent_docs/queue_system.md`** - Queue system architecture and flow
- **`agent_docs/testing.md`** - Test suite information and patterns
- **`agent_docs/changelog.md`** - Version history and recent improvements
