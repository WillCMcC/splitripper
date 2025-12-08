# SplitBoy Architecture

## Two-Process Model

SplitBoy uses Electron + Python FastAPI:

1. **Electron Main** (`main.js:40-249`): Spawns Python server, manages window lifecycle, handles native dialogs via IPC
2. **Python Backend** (`src/server.py`): FastAPI server with all business logic

## Communication Flow

```
Electron Main Process
        |
        | spawns on random free port
        v
Python FastAPI Server (127.0.0.1:<port>)
        ^
        | REST API calls
        |
Frontend (served as static files from src/public/)
        ^
        | IPC bridge (preload.js)
        |
Native Dialogs (file/directory pickers)
```

## Key Files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process, server lifecycle |
| `preload.js` | Context bridge exposing `window.electronAPI` |
| `src/server.py` | FastAPI backend, all business logic |
| `src/ytdl_interactive.py` | YouTube search/info extraction |
| `src/lib/state.py` | Thread-safe singleton state manager |
| `src/lib/config.py` | Persisted config (`src/config.json`) |
| `src/lib/constants.py` | All magic numbers and defaults |
| `src/public/` | Frontend static files |

## State Management

All mutable state is in `src/lib/state.py:88-321`:
- `app_state` singleton with thread-safe locks
- `QueueItem` dataclass for queue entries
- Progress tracking for async operations

## IPC Handlers (main.js)

- `select-directory` - Output folder picker
- `select-audio-files` - Local file picker (multi-select)
- `select-audio-directory` - Batch folder picker
- `find-file` - Search Music library locations
- `update-taskbar-progress` - Dock/taskbar progress bar
