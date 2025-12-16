# Features

Detailed feature descriptions for SplitBoy.

## Multi-Model Stem Separation

SplitBoy supports multiple Demucs models with different capabilities:

**Available Models:**
- `htdemucs` - High-quality transformer-based model (bundled with app)
- `htdemucs_ft` - Fine-tuned variant
- `htdemucs_6s` - 6-stem variant (includes guitar and piano)
- `mdx` - MDX architecture model
- `mdx_extra` - Extended MDX model
- `mdx_q` - Quantized MDX model (smaller download)
- `mdx_extra_q` - Quantized extended MDX model

**Stem Modes:**
- **2-stem**: vocals + instrumental
- **4-stem**: vocals + drums + bass + other
- **6-stem**: vocals + drums + bass + guitar + piano + other (htdemucs_6s only)

**Model Management:**
- htdemucs model bundled for instant use after installation
- Other models download in background without freezing the app
- Quantized model support (diffq) for smaller downloads
- Model download status tracking in Settings tab

## Splits Browser

Browse and play your processed stems:

**Features:**
- Browse processed stems by artist and track
- Real-time waveform visualization using Web Audio API
- Click-to-play with scrubbing support
- Search filter by artist or title
- Sort toggle (Recent / A-Z)
- Native file drag support for dragging stems directly into DAW
- Playback controls with play/pause and time display
- Tab switching automatically stops playback

**Implementation:**
- `src/public/splits.js` - Browser UI
- `src/public/audio-player.js` - Playback controls
- `src/public/waveform.js` - Waveform visualization

## System Tray Integration

Persistent tray icon for easy access:

- Persistent tray icon with fallback chain (multiple icon paths, programmatic fallback)
- Shows app even when window is closed
- Pre-sized 22x22 tray_icon.png for macOS menu bar
- Implementation in `electron/tray.js`

## Performance Optimizations

Optimizations for smooth operation:

**Demucs Processing:**
- Segmented processing (--segment 10) reduces memory from ~7GB to ~2GB
- Limited PyTorch threads (OMP_NUM_THREADS=4, MKL_NUM_THREADS=4) to prevent CPU thrashing
- See `src/services/demucs.py` for implementation

**UI Responsiveness:**
- Background progress updates enabled (backgroundThrottling: false)
- Improved polling intervals: 1s queue, 3s progress, 5s splits
- Async chunked waveform generation prevents UI freezing
- O(1) queue item lookup via indexed state management

## Progress Tracking

Progress is split into two weighted phases (see `src/lib/constants.py` and `src/public/constants.js`):

- **Download phase**: 30% of total progress
- **Processing phase** (Demucs): 70% of total progress

This provides accurate progress reporting throughout the separation process.

## yt-dlp Auto-Update

Automatic updates to handle YouTube API changes:

- On server startup, checks if 24+ hours since last update check
- Background check runs non-blocking to avoid delaying startup
- State persisted to `src/.ytdlp_update_state`
- Manual update available via Settings tab or `/api/ytdlp/update` endpoint
- Implementation in `src/lib/ytdlp_updater.py`

## Output Structure

Stems are organized by artist and type:

```
output_dir/
  [Artist Name]/
    vocals/
      Song Title.mp3
    instrumental/
      Song Title.mp3
```

For 4-stem or 6-stem separation, additional folders (drums, bass, other, guitar, piano) are created.
