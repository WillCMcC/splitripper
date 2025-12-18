# Changelog

Version history and recent improvements to SplitBoy.

## v1.2.4 - HD Mode

### New Features
- **HD Mode toggle** - Enable higher quality stem separation using multiple processing passes (shifts=5)
- HD Mode produces cleaner vocals with fewer artifacts and less bleed between instruments
- Processing takes ~5× longer but significantly improves separation quality

## v1.2.3 - Dropdown Fixes and Server Refactor

### Bug Fixes
- Fixed model and stem mode dropdowns losing user selection after model downloads
- Dropdowns now properly sync with server state on initial load

### Code Organization
- Extracted `server-env.js` from `server.js` for cleaner platform-specific environment handling
- Centralized Python runtime detection and PATH configuration

## v1.2.0 - Major Refactor and Bug Fixes

### Code Organization
- Split large `splits.js` (777 LoC) into three focused modules:
  - `splits.js` - Splits browser UI
  - `audio-player.js` - Audio playback controls
  - `waveform.js` - Waveform visualization
- New `state.js` module replaces global `window.__*` variables

### Bug Fixes
- Fixed Demucs segment size error for transformer models (htdemucs)
- Fixed model download status detection with fallback signatures
- Fixed UI freeze during waveform generation (async chunked processing)
- Fixed audio playback when switching tabs
- Handle disconnected DOM elements in audio player

### Backend Improvements
- O(1) queue item lookup via indexed state
- Unified AUDIO_EXTENSIONS constant across codebase
- Replaced dynamic imports with normal imports in worker/search modules
- Extracted shared playlist/channel logic

### Testing
- Added comprehensive tests for demucs and worker services

## v1.1.5 - Performance Fixes

- Fixed application lockup during intense Demucs processing
- Reduced memory usage from ~7GB to ~2GB with segmented processing
- Fixed progress bars not updating when app is unfocused
- Improved polling intervals for more responsive updates

## v1.1.1 - Splits Browser Enhancements

- Added search filter for splits by artist/title
- Added sort toggle (Recent / A-Z)
- Reordered tabs: Search now first, Local Files second

## v1.1.0 - Splits Browser with Waveform Player

- New Splits tab to browse processed stems
- Real waveform visualization using Web Audio API
- Click-to-play with scrubbing support
- Drag stems directly into DAW

## v1.0.5 - Multi-Model Support

- Added support for 7 Demucs models
- Selectable stem modes (2, 4, or 6 stems)
- New Settings UI with subtabs
- Background model downloads
