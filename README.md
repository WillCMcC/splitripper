# SplitBoy

An Electron desktop app that downloads audio from YouTube and separates it into vocal and instrumental tracks using [Demucs](https://github.com/facebookresearch/demucs).

## Features

- Download audio from YouTube videos, playlists, and channels
- Automatic vocal/instrumental separation using Demucs (AI-powered)
- Process local audio files (drag & drop or file picker)
- Queue-based processing with configurable concurrency
- Cross-platform: macOS, Windows, Linux

## Quick Start

### Development

```bash
# Install dependencies
npm install

# Run in development mode (with DevTools)
npm run electron-dev

# Or run the FastAPI server standalone for debugging
python src/server.py
```

### Production Build

```bash
# Build distributable (bundles Python runtime + dependencies)
npm run dist
```

This creates a standalone app in `dist/` that includes everything needed - no Python installation required on the target machine.

## Architecture

SplitBoy uses a two-process architecture:

1. **Electron Main Process** (`main.js`) - Window management, native dialogs, spawns/manages the Python server
2. **Python Backend** (`src/server.py`) - FastAPI server handling downloads (yt-dlp), audio separation (Demucs), and queue management

The frontend is served as static files by FastAPI and communicates via REST API. Electron's preload script (`preload.js`) bridges native OS features like file dialogs.

## Output Structure

Separated audio is saved as:
```
[output_dir]/
  └── [Artist]/
      ├── vocals/
      │   └── Song Title.mp3
      └── instrumental/
          └── Song Title.mp3
```

## Configuration

Settings are persisted to `src/config.json`:
- **Output directory**: Where stems are saved (defaults to Desktop)
- **Concurrency**: Number of parallel download/processing threads (1-64)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SPLITBOY_PORT` | 9000 | Backend server port |
| `SPLITBOY_HOST` | 127.0.0.1 | Backend bind address |
| `NODE_ENV` | production | Set to `development` to enable DevTools |

## Tech Stack

- **Frontend**: Vanilla JS, CSS
- **Backend**: FastAPI, yt-dlp, Demucs, PyTorch
- **Desktop**: Electron
- **Audio**: Demucs (Facebook Research) for stem separation
