"""
Splits endpoints for SplitBoy API.

Lists processed audio splits from the output directory for browsing and drag-drop.
"""

import os
from pathlib import Path
from typing import List, Dict, Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from lib.logging_config import get_logger
from lib.state import app_state

router = APIRouter()
logger = get_logger("routes.splits")

# Audio file extensions we care about
AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus"}


def scan_splits_directory(output_dir: str) -> List[Dict[str, Any]]:
    """
    Scan the output directory for split audio files.

    Returns a list of tracks, each with:
    - artist: folder name (artist)
    - title: track name
    - stems: dict of stem_type -> file_path
    """
    tracks = []
    output_path = Path(output_dir)

    if not output_path.exists():
        return tracks

    # The output structure is: output_dir/[artist]/[stem_type]/[track].mp3
    # e.g., output_dir/Artist Name/vocals/Song Title.mp3
    #       output_dir/Artist Name/instrumental/Song Title.mp3

    # Collect all tracks by (artist, title) -> stems
    track_map: Dict[tuple, Dict[str, str]] = {}

    try:
        # Iterate through artist folders
        for artist_dir in output_path.iterdir():
            if not artist_dir.is_dir():
                continue

            artist_name = artist_dir.name

            # Iterate through stem type folders (vocals, instrumental, drums, bass, etc.)
            for stem_dir in artist_dir.iterdir():
                if not stem_dir.is_dir():
                    continue

                stem_type = stem_dir.name

                # Iterate through audio files
                for audio_file in stem_dir.iterdir():
                    if not audio_file.is_file():
                        continue

                    if audio_file.suffix.lower() not in AUDIO_EXTENSIONS:
                        continue

                    # Track title is the filename without extension
                    title = audio_file.stem

                    key = (artist_name, title)
                    if key not in track_map:
                        track_map[key] = {}

                    track_map[key][stem_type] = str(audio_file)
    except Exception as e:
        logger.error(f"Error scanning splits directory: {e}")
        return tracks

    # Convert to list format
    for (artist, title), stems in track_map.items():
        tracks.append({
            "artist": artist,
            "title": title,
            "stems": stems,
        })

    # Sort by artist, then title
    tracks.sort(key=lambda t: (t["artist"].lower(), t["title"].lower()))

    return tracks


@router.get("/splits")
def get_splits():
    """Get all processed splits from the output directory."""
    config = app_state.get_config()
    output_dir = config.get("output_dir", "")

    if not output_dir:
        return {"tracks": [], "output_dir": ""}

    tracks = scan_splits_directory(output_dir)

    return {
        "tracks": tracks,
        "output_dir": output_dir,
    }


# MIME type mapping for audio files
MIME_TYPES = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
}


@router.get("/splits/file")
def get_split_file(path: str):
    """Serve a split file for download/preview."""
    # Security: ensure the path is within the output directory
    config = app_state.get_config()
    output_dir = config.get("output_dir", "")

    if not output_dir:
        raise HTTPException(status_code=400, detail="No output directory configured")

    file_path = Path(path).resolve()
    output_path = Path(output_dir).resolve()

    # Ensure file is within output directory (prevent path traversal)
    try:
        file_path.relative_to(output_path)
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid file path")

    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Detect MIME type from extension
    ext = file_path.suffix.lower()
    media_type = MIME_TYPES.get(ext, "audio/mpeg")

    return FileResponse(
        path=str(file_path),
        filename=file_path.name,
        media_type=media_type,
    )
