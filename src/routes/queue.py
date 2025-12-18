"""
Queue endpoints for SplitBoy API.

Handles queue management, starting/stopping processing, and concurrency settings.
"""

import os
import threading
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException

from lib.constants import STEM_MODES, AUDIO_EXTENSIONS
from lib.logging_config import get_logger
from lib.metadata import get_title_from_path
from lib.models import AddQueueRequest, AddQueueLocalRequest, ConcurrencyRequest
from lib.state import app_state, QueueItem

router = APIRouter()
logger = get_logger("routes.queue")


def validate_local_file_path(file_path: str) -> tuple[bool, str]:
    """
    Validate that a file path is safe to process.

    Returns:
        Tuple of (is_valid, error_message)
    """
    # Check for path traversal attempts
    if ".." in file_path:
        return False, "Path traversal not allowed"

    # Resolve to absolute path
    try:
        resolved = Path(file_path).resolve()
    except (ValueError, OSError):
        return False, "Invalid path"

    # Check file exists and is a regular file (not directory, symlink to bad places, etc.)
    if not resolved.exists():
        return False, "File does not exist"

    if not resolved.is_file():
        return False, "Path is not a regular file"

    # Check extension is a valid audio extension
    ext = resolved.suffix.lower().lstrip(".")
    if ext not in AUDIO_EXTENSIONS:
        return False, f"Invalid audio extension: {ext}"

    # Check path is within reasonable locations (user's home or common media directories)
    home_dir = Path.home()
    allowed_roots = [
        home_dir,  # User's home directory
        Path("/tmp"),  # Temporary files
        Path("/var/folders"),  # macOS temp folders
    ]

    # On macOS, also allow /Volumes for external drives
    if os.path.exists("/Volumes"):
        allowed_roots.append(Path("/Volumes"))

    # Check if path is under an allowed root
    path_allowed = False
    for allowed_root in allowed_roots:
        try:
            resolved.relative_to(allowed_root)
            path_allowed = True
            break
        except ValueError:
            continue

    if not path_allowed:
        return False, "File path not in allowed directory"

    # Block sensitive directories even within home
    sensitive_dirs = [
        ".ssh", ".gnupg", ".config", ".aws", ".azure", ".kube",
        "Library/Keychains", "Library/Cookies", ".password-store"
    ]

    path_str = str(resolved)
    for sensitive in sensitive_dirs:
        if f"/{sensitive}/" in path_str or path_str.endswith(f"/{sensitive}"):
            return False, "Access to sensitive directory not allowed"

    return True, ""

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
def api_add_queue(req: AddQueueRequest):
    """Add YouTube URLs to the queue."""
    urls = req.urls
    folder = req.folder
    stem_mode = req.stem_mode

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

    logger.info(f"Added {len(added)} items to queue")
    return {"added": added}


@router.post("/queue-local")
def api_add_queue_local(req: AddQueueLocalRequest):
    """Add local audio files to the queue."""
    files = req.files
    folder = req.folder
    stem_mode = req.stem_mode

    added = []
    rejected = []
    default_folder = app_state.get_config_value("default_folder", "")

    for file_path in files:
        # Validate the file path for security
        is_valid, error_msg = validate_local_file_path(file_path)
        if not is_valid:
            logger.warning(f"Rejected local file: {file_path} - {error_msg}")
            rejected.append({"path": file_path, "error": error_msg})
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

    logger.info(f"Added {len(added)} local files to queue, rejected {len(rejected)}")
    return {"added": added, "rejected": rejected}


@router.post("/start")
def api_start():
    """Start queue processing."""
    # Hold lock for entire operation to prevent race condition
    # where two simultaneous requests could both start workers
    with app_state.lock:
        if app_state._running:
            return {"started": False, "message": "Already running"}

        if _download_worker_func is None:
            raise HTTPException(500, "Worker function not initialized")

        t = threading.Thread(target=_download_worker_func, daemon=True)
        app_state._worker_thread = t
        app_state._running = True
        app_state._active = 0
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
        except Exception as e:
            logger.warning(f"Failed to terminate process: {e}")

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
def api_set_concurrency(req: ConcurrencyRequest):
    """Set concurrency limit."""
    from lib.config import Config

    BASE_DIR = Path(__file__).parent.parent.resolve()
    CONFIG_PATH = BASE_DIR / "config.json"
    config = Config(CONFIG_PATH)

    new_max = req.max
    app_state.max_concurrency = new_max
    app_state.update_config({"max_concurrency": new_max})
    config.update({"max_concurrency": new_max})

    logger.info(f"Concurrency set to {new_max}")
    return {"active": app_state.active, "max": new_max, "serverMax": 64}
