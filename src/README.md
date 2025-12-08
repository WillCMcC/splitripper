# SplitRipper

A local web app to search YouTube, queue downloads, extract high-quality audio with yt-dlp, split stems with Spleeter (vocals/instrumental), and save results into a single configurable output directory on your machine.

NAS support and SMB mounting have been removed. The app only ever writes inside the configured output directory.

## Overview

- Search YouTube, playlists, or channels from the UI
- Queue multiple downloads
- Downloads best available audio and converts to mp3
- Splits each track into vocals.wav and accompaniment.wav using Spleeter
- Final outputs are saved as:
  - output_dir/Artist/vocals/Song.wav
  - output_dir/Artist/instrumental/Song.wav
- Per-download progress and processing indicators
- Configurable concurrency

## Output Directory

The application writes exclusively within a single output directory:

- Default: /output at the repository root (i.e. /Users/will/Code/splitripper/output)
- You can change this directory in the UI (Settings → Output folder)
- All intermediate downloads are staged under: output_dir/\_downloads
- Final stems are saved under artist subfolders in output_dir

No files are written to any NAS or remote share.

## Requirements

- Python 3
- yt-dlp
- ffmpeg
- Spleeter (via conda env or installed module). The app will try the following in order:
  - spleeter (if found on PATH)
  - python -m spleeter (current venv/interpreter)
  - conda run -n spleeter-x86 spleeter
  - conda run -n spleeter-x86 python -m spleeter
  - conda run -n spleeter-env spleeter

Optionally place pretrained Spleeter models at:

- spleeterpad/spleeter-pad/pretrained_models
  The app will set SPLEETER_MODEL_PATH to that folder if present.

## Setup

1. Install dependencies (example for macOS):

   - ffmpeg (Homebrew)
     - brew install ffmpeg
   - yt-dlp (pip)
     - pip3 install yt-dlp
   - Create a conda env for Spleeter (recommended if native install fails)
     - conda create -n spleeter-x86 python=3.9
     - conda activate spleeter-x86
     - pip install spleeter

2. Start the server:

   - cd setripper/setripper
   - python server.py
   - Server runs at http://127.0.0.1:9000

3. Open the UI at http://127.0.0.1:9000
   - In the Settings card on the right, set Output folder if you want a custom location
   - Category and Default Folder apply to staging layout only; final stems always go inside Output folder

## Usage

- Search tab:
  - Search terms, load Playlist URL, or Channel URL/ID
  - Filter results by minimum duration, channel name, and optionally min view count
  - Add selected / all items to the queue
- Queue tab:
  - Start, Stop, Clear buttons
  - Retry all failed
  - Progress bar per item with download/processing phases
  - Shows final destination path on completion

## Configuration (persisted)

Settings are persisted to setripper/setripper/config.json. Keys used:

- output_dir: absolute path to the output folder (default is repo_root/output)
- category: logical category used for staging (default: "sets")
- default_folder: optional subfolder used for staging
- max_concurrency: parallel download threads (1-64)

Example:
{
"output_dir": "/Users/will/Code/splitripper/output",
"category": "sets",
"default_folder": "",
"max_concurrency": 16
}

## Notes

- The existence check (to avoid duplicates) now scans only the configured output_dir for .wav files inside vocals/ or instrumental/ subfolders.
- NAS indexing, SMB mounting, and legacy NAS scripts are deprecated and removed from the app flow.

## Deprecated Scripts

The following legacy scripts previously handled NAS mounting and direct NAS writes:

- download_to_nas.py
- populate_thumbnails.py
- organize.py
- thumbnail_ids.py

They are no longer used. The server+UI flow described above supersedes them entirely.
