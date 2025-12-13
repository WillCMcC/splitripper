"""
Queue endpoints for SplitBoy API.

Handles queue management, starting/stopping processing, and concurrency settings.
"""

import os
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from lib.constants import STEM_MODES
from lib.metadata import get_title_from_path
from lib.state import app_state, QueueItem

router = APIRouter()

# Reference to worker function - will be set by server.py to avoid circular imports
_download_worker_func = None


def set_download_worker(func):
    """Set the download worker function (called from server.py)."""
    global _download_worker_func
    _download_worker_func = func


@router.get("/queue")
def api_get_queue():
    """Get current queue state."""
    return {"running": app_state.running, "items": app_state.get_queue()}


@router.post("/queue")
async def api_add_queue(req: Request):
    """Add YouTube URLs to the queue."""
    data = await req.json()
    urls = data.get("urls") or []
    folder = data.get("folder")
    stem_mode = data.get("stem_mode")  # Optional per-job stem mode

    if not isinstance(urls, list) or not urls:
        raise HTTPException(400, "urls must be a non-empty array")

    # Validate stem_mode if provided
    if stem_mode and stem_mode not in STEM_MODES:
        stem_mode = None

    added = []
    default_folder = app_state.get_config_value("default_folder", "")

    for url in urls:
        item = QueueItem(
            id=str(uuid.uuid4()),
            url=url,
            folder=folder or default_folder,
            stem_mode=stem_mode,
        )
        app_state.add_to_queue(item)
        added.append(item.to_dict())

    return {"added": added}


@router.post("/queue-local")
async def api_add_queue_local(req: Request):
    """Add local audio files to the queue."""
    data = await req.json()
    files = data.get("files") or []
    folder = data.get("folder")
    stem_mode = data.get("stem_mode")  # Optional per-job stem mode

    if not isinstance(files, list) or not files:
        raise HTTPException(400, "files must be a non-empty array")

    # Validate stem_mode if provided
    if stem_mode and stem_mode not in STEM_MODES:
        stem_mode = None

    added = []
    default_folder = app_state.get_config_value("default_folder", "")

    for file_path in files:
        if not os.path.exists(file_path):
            continue

        item = QueueItem(
            id=str(uuid.uuid4()),
            url=f"file://{file_path}",
            title=get_title_from_path(file_path),
            folder=folder or default_folder,
            local_file=True,
            local_path=file_path,
            stem_mode=stem_mode,
        )
        app_state.add_to_queue(item)
        added.append(item.to_dict())

    return {"added": added}


@router.post("/start")
def api_start():
    """Start queue processing."""
    if app_state.running:
        return {"started": False, "message": "Already running"}

    if _download_worker_func is None:
        raise HTTPException(500, "Worker function not initialized")

    t = threading.Thread(target=_download_worker_func, daemon=True)
    app_state.worker_thread = t
    app_state.running = True
    app_state.active = 0
    t.start()
    return {"started": True}


@router.post("/stop")
def api_stop():
    """Stop queue processing."""
    app_state.stop_event.set()

    # Cancel queued items
    for item in app_state.get_queue_items():
        if item.status == "queued":
            item.status = "canceled"

    # Terminate active processes
    for proc in app_state.get_active_processes():
        try:
            proc.terminate()
        except Exception:
            pass

    return {"stopping": True}


@router.post("/clear")
def api_clear():
    """Clear the queue."""
    if app_state.running:
        app_state.clear_queue(running_only=True)
    else:
        app_state.clear_queue()
    return {"cleared": True}


@router.post("/cancel/{item_id}")
def api_cancel(item_id: str):
    """Cancel a specific queue item."""
    item = app_state.get_queue_item(item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    if item.status == "queued":
        item.status = "canceled"
        return {"canceled": True}
    return {"canceled": False, "message": "Only queued items can be canceled"}


@router.get("/progress")
def api_progress():
    """Get global progress information."""
    out = app_state.global_progress()
    out["concurrency"] = {
        "active": app_state.active,
        "max": app_state.max_concurrency
    }
    return out


@router.get("/listing-progress/{request_id}")
def api_listing_progress(request_id: str):
    """Get progress for a listing operation."""
    return app_state.get_progress(request_id)


@router.get("/concurrency")
def api_get_concurrency():
    """Get current concurrency settings."""
    return {"active": app_state.active, "max": app_state.max_concurrency}


@router.post("/concurrency")
async def api_set_concurrency(req: Request):
    """Set concurrency limit."""
    from lib.config import Config

    BASE_DIR = Path(__file__).parent.parent.resolve()
    CONFIG_PATH = BASE_DIR / "config.json"
    config = Config(CONFIG_PATH)

    data = await req.json()
    if "max" not in data:
        raise HTTPException(400, "Body must contain 'max'")

    try:
        new_max = int(data["max"])
    except Exception:
        raise HTTPException(400, "'max' must be an integer")

    new_max = max(1, min(64, new_max))
    app_state.max_concurrency = new_max
    app_state.update_config({"max_concurrency": new_max})
    config.update({"max_concurrency": new_max})

    return {"active": app_state.active, "max": new_max, "serverMax": 64}
