# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Releases & Downloads

**Stable download link (DO NOT CHANGE):**
```
https://github.com/WillCMcC/splitripper/releases/latest/download/SplitBoy-arm64-mac.zip
```

This URL always points to the latest release. The artifact name `SplitBoy-arm64-mac.zip` must remain consistent across all releases to preserve this link.

## Project Overview

SplitBoy is an Electron desktop application that downloads audio from YouTube and separates it into vocals and instrumental tracks using Demucs. It bundles a complete Python runtime and runs a FastAPI backend server that the Electron frontend communicates with.

## Build & Development Commands

```bash
# Development
npm run electron-dev     # Run Electron with DevTools open
npm start               # Alias for npm run electron

# Production build
npm run bundle-python   # Bundle Python runtime (required before dist)
npm run dist            # Build distributable (runs bundle-python automatically via predist)

# Python server standalone (for debugging)
python src/server.py    # Runs FastAPI on http://127.0.0.1:9000

# Testing
npm test                # Run full test suite with verbose output
npm run test:quick      # Quick test run
```

## Architecture

### Two-Process Model
- **Electron Main Process** (`main.js`): Manages window lifecycle, spawns/kills the Python server, handles native dialogs (file/directory pickers) via IPC
- **Python Backend** (`src/server.py`): FastAPI server handling YouTube search/download, Demucs audio separation, and queue management

### Communication Flow
1. Electron spawns Python server on a free localhost port
2. Frontend (served by FastAPI) communicates with backend via REST API
3. Electron preload (`preload.js`) exposes IPC methods for native dialogs
4. Frontend calls `window.electronAPI.selectDirectory()` etc. for file operations

### Key Files
- `main.js` - Electron main process, server lifecycle, IPC handlers
- `preload.js` - Context bridge exposing electronAPI to renderer
- `src/server.py` - FastAPI backend with all business logic
- `src/ytdl_interactive.py` - YouTube search/info extraction helpers
- `src/lib/` - Shared Python modules (constants, config, utils, ytdlp_updater)
- `src/public/` - Frontend HTML/JS/CSS (served as static files)
- `src/public/constants.js` - Frontend constants (progress weights, intervals)
- `bundle-python.js` - Routes to platform-specific Python bundler
- `build-python-bundle-pbs.js` - macOS Python bundler using python-build-standalone

### Progress Tracking
Progress is split into two weighted phases (defined in `src/lib/constants.py` and `src/public/constants.js`):
- **Download phase**: 30% of total progress
- **Processing phase** (Demucs): 70% of total progress

### Python Runtime Bundling
The app bundles a complete Python 3.12 runtime with dependencies (demucs, yt-dlp, torch, etc.) in `python_runtime_bundle/`. On macOS, this uses python-build-standalone (PBS) for a relocatable interpreter. The bundler also includes ffmpeg and deno.

### Queue System
- Items added via `/api/queue` (YouTube URLs) or `/api/queue-local` (local files)
- Worker thread processes items with configurable concurrency
- Download phase uses yt-dlp, processing phase uses Demucs
- Progress tracked per-item with separate download/processing phases
- Output structure: `output_dir/[artist]/vocals/song.mp3` and `output_dir/[artist]/instrumental/song.mp3`

## API Endpoints (FastAPI)

Key endpoints in `src/server.py`:
- `GET /api/search?q=...` - YouTube search
- `GET /api/playlist?url=...` - Fetch playlist entries
- `GET /api/channel?channelUrl=...` - Fetch channel uploads
- `POST /api/queue` - Add URLs to download queue
- `POST /api/queue-local` - Add local files for separation
- `POST /api/start` - Start processing queue
- `POST /api/stop` - Stop queue processing
- `GET /api/queue` - Get current queue state
- `GET /api/progress` - Get global progress
- `POST /api/config` - Update config (output_dir, etc.)
- `GET /api/ytdlp/status` - Get yt-dlp version and update status
- `POST /api/ytdlp/update` - Manually trigger yt-dlp update

## yt-dlp Auto-Update

yt-dlp updates automatically to handle YouTube API changes:
- On server startup, checks if 24+ hours since last update check
- Background check runs non-blocking to avoid delaying startup
- State persisted to `src/.ytdlp_update_state`
- Manual update available via Settings tab or `/api/ytdlp/update` endpoint
- Implementation in `src/lib/ytdlp_updater.py`

## Environment Variables

- `SPLITBOY_HOST` - Backend bind host (default: 127.0.0.1)
- `SPLITBOY_PORT` - Backend port (default: 9000, auto-selected if busy)
- `SPLITBOY_LOG_LEVEL` - Uvicorn log level (default: info)
- `NODE_ENV=development` - Enables DevTools in Electron

## Configuration

Persisted to `src/config.json`:
- `output_dir` - Where stems are saved (defaults to Desktop)
- `default_folder` - Optional subfolder for staging
- `max_concurrency` - Parallel download/processing threads (1-64)
