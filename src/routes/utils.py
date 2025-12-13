"""
Utility endpoints for SplitBoy API.

Handles directory scanning, file existence checking, and shutdown.
"""

import os
import re
import threading
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException

from lib.config import get_default_desktop_path
from lib.state import app_state

router = APIRouter()


@router.get("/scan-directory")
async def api_scan_directory(path: str):
    """Scan a directory for audio files."""
    if not path or not os.path.exists(path) or not os.path.isdir(path):
        raise HTTPException(400, "Invalid directory path")

    audio_extensions = {'.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma', '.opus'}
    files = []

    try:
        for root, dirs, filenames in os.walk(path):
            for filename in filenames:
                ext = os.path.splitext(filename)[1].lower()
                if ext in audio_extensions:
                    files.append({
                        "name": filename,
                        "path": os.path.join(root, filename)
                    })
    except Exception as e:
        raise HTTPException(500, f"Error scanning directory: {str(e)}")

    return {"files": files}


@router.get("/check-exists")
def api_check_exists(title: str, folder: str = ""):
    """Check for existing files with similar names."""
    try:
        base = Path(app_state.get_config_value("output_dir") or get_default_desktop_path())
    except Exception:
        base = Path(get_default_desktop_path())

    safe_title = re.sub(r'[<>:"/\\|?*]', "_", (title or "").strip()).strip(". ")
    needle = safe_title.lower()
    matches = []

    try:
        for p in base.rglob("*.wav"):
            parts = {s.lower() for s in p.parts}
            if not (("vocals" in parts) or ("instrumental" in parts)):
                continue
            if needle and needle in p.stem.lower():
                matches.append({"type": "similar_file", "name": p.name, "similarity": "partial"})
                if len(matches) >= 5:
                    break
    except Exception:
        pass

    return {"matches": matches}


@router.post("/_shutdown")
def api_shutdown():
    """Shutdown endpoint for Electron to terminate server cleanly."""
    def _do_exit():
        time.sleep(0.1)
        os._exit(0)
    threading.Thread(target=_do_exit, daemon=True).start()
    return {"shutting_down": True}
