"""
Application state management for SplitBoy.

Provides a thread-safe state manager that encapsulates all mutable global state.
"""

import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .constants import DEFAULT_CONCURRENCY, DEFAULT_STEM_MODE
from .logging_config import get_logger

logger = get_logger("state")


@dataclass
class QueueItem:
    """Represents an item in the processing queue."""
    id: str
    url: str
    title: Optional[str] = None
    duration: Optional[int] = None
    channel: Optional[str] = None
    folder: str = ""
    status: str = "queued"  # queued, running, done, error, canceled
    progress: float = 0.0
    download_progress: float = 0.0
    processing: bool = False
    downloaded: bool = False
    error: Optional[str] = None
    local_file: bool = False
    local_path: Optional[str] = None
    download_eta_sec: Optional[int] = None
    processing_eta_sec: Optional[int] = None
    dest_path: Optional[str] = None
    has_artist_metadata: bool = False
    stem_mode: Optional[str] = None  # Per-job stem mode override (2, 4, or 6)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "id": self.id,
            "url": self.url,
            "title": self.title,
            "duration": self.duration,
            "channel": self.channel,
            "folder": self.folder,
            "status": self.status,
            "progress": self.progress,
            "download_progress": self.download_progress,
            "processing": self.processing,
            "downloaded": self.downloaded,
            "error": self.error,
            "local_file": self.local_file,
            "local_path": self.local_path,
            "download_eta_sec": self.download_eta_sec,
            "processing_eta_sec": self.processing_eta_sec,
            "dest_path": self.dest_path,
            "stem_mode": self.stem_mode,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "QueueItem":
        """Create from dictionary."""
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            url=data.get("url", ""),
            title=data.get("title"),
            duration=data.get("duration"),
            channel=data.get("channel"),
            folder=data.get("folder", ""),
            status=data.get("status", "queued"),
            progress=data.get("progress", 0.0),
            download_progress=data.get("download_progress", 0.0),
            processing=data.get("processing", False),
            downloaded=data.get("downloaded", False),
            error=data.get("error"),
            local_file=data.get("local_file", False),
            local_path=data.get("local_path"),
            download_eta_sec=data.get("download_eta_sec"),
            processing_eta_sec=data.get("processing_eta_sec"),
            dest_path=data.get("dest_path"),
            has_artist_metadata=data.get("has_artist_metadata", False),
            stem_mode=data.get("stem_mode"),
        )


class AppState:
    """
    Thread-safe application state manager.

    Encapsulates all mutable state and provides methods for safe access.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._download_lock = threading.Lock()
        self._progress_lock = threading.Lock()

        # Core state
        self._config: Dict[str, Any] = {}
        self._queue: List[QueueItem] = []
        self._running: bool = False
        self._worker_thread: Optional[threading.Thread] = None
        self._max_concurrency: int = DEFAULT_CONCURRENCY
        self._active: int = 0

        # Progress tracking for long operations (playlist listing, enrichment)
        self._progress_map: Dict[str, Dict[str, Any]] = {}

        # Stop event for graceful shutdown
        self._stop_event = threading.Event()

        # Active subprocesses for termination
        self._active_procs: Dict[str, Any] = {}

    @property
    def lock(self) -> threading.Lock:
        """Main state lock."""
        return self._lock

    @property
    def download_lock(self) -> threading.Lock:
        """Lock for download operations."""
        return self._download_lock

    @property
    def stop_event(self) -> threading.Event:
        """Event to signal graceful stop."""
        return self._stop_event

    # Config operations
    def get_config(self) -> Dict[str, Any]:
        with self._lock:
            return self._config.copy()

    def update_config(self, updates: Dict[str, Any]) -> None:
        with self._lock:
            self._config.update(updates)

    def set_config(self, config: Dict[str, Any]) -> None:
        with self._lock:
            self._config = config.copy()

    def get_config_value(self, key: str, default: Any = None) -> Any:
        with self._lock:
            return self._config.get(key, default)

    # Queue operations
    def get_queue(self) -> List[Dict[str, Any]]:
        """Get queue as list of dicts for JSON serialization."""
        with self._lock:
            return [item.to_dict() for item in self._queue]

    def get_queue_items(self) -> List[QueueItem]:
        """Get queue as list of QueueItem objects."""
        with self._lock:
            return list(self._queue)

    def add_to_queue(self, item: QueueItem) -> None:
        with self._lock:
            self._queue.append(item)

    def get_queue_item(self, item_id: str) -> Optional[QueueItem]:
        with self._lock:
            for item in self._queue:
                if item.id == item_id:
                    return item
            return None

    def clear_queue(self, running_only: bool = False) -> None:
        with self._lock:
            if running_only:
                self._queue = [it for it in self._queue if it.status == "running"]
            else:
                self._queue = []

    def get_queued_items(self) -> List[QueueItem]:
        """Get items with status 'queued'."""
        with self._lock:
            return [it for it in self._queue if it.status == "queued"]

    # Running state
    @property
    def running(self) -> bool:
        with self._lock:
            return self._running

    @running.setter
    def running(self, value: bool) -> None:
        with self._lock:
            self._running = value

    # Concurrency
    @property
    def max_concurrency(self) -> int:
        with self._lock:
            return self._max_concurrency

    @max_concurrency.setter
    def max_concurrency(self, value: int) -> None:
        with self._lock:
            self._max_concurrency = max(1, min(64, value))

    @property
    def active(self) -> int:
        with self._lock:
            return self._active

    @active.setter
    def active(self, value: int) -> None:
        with self._lock:
            self._active = value

    def increment_active(self) -> None:
        with self._lock:
            self._active += 1

    def decrement_active(self) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)

    # Worker thread
    @property
    def worker_thread(self) -> Optional[threading.Thread]:
        with self._lock:
            return self._worker_thread

    @worker_thread.setter
    def worker_thread(self, thread: Optional[threading.Thread]) -> None:
        with self._lock:
            self._worker_thread = thread

    # Progress tracking for long operations
    def set_progress(self, request_id: str, phase: str, current: int = 0,
                     total: int = 0, message: str = "") -> None:
        import time
        with self._progress_lock:
            self._progress_map[request_id] = {
                "phase": phase,
                "current": current,
                "total": total,
                "message": message,
                "_timestamp": time.time(),
            }

    def update_progress(self, request_id: str, **kwargs) -> None:
        import time
        with self._progress_lock:
            if request_id in self._progress_map:
                self._progress_map[request_id].update(kwargs)
                self._progress_map[request_id]["_timestamp"] = time.time()
            else:
                self._progress_map[request_id] = {
                    "phase": kwargs.get("phase", "idle"),
                    "current": kwargs.get("current", 0),
                    "total": kwargs.get("total", 0),
                    "message": kwargs.get("message", ""),
                    "_timestamp": time.time(),
                }

    def get_progress(self, request_id: str) -> Dict[str, Any]:
        with self._progress_lock:
            return self._progress_map.get(request_id, {
                "phase": "listing",
                "current": 0,
                "total": 0,
                "message": "Starting…"
            })

    def finish_progress(self, request_id: str, error: Optional[str] = None) -> None:
        import time
        with self._progress_lock:
            if error:
                self._progress_map[request_id] = {
                    "phase": "error",
                    "current": 0,
                    "total": 0,
                    "message": error,
                    "_timestamp": time.time(),
                }
            else:
                self._progress_map[request_id] = {
                    "phase": "done",
                    "current": 1,
                    "total": 1,
                    "message": "Done",
                    "_timestamp": time.time(),
                }

    def cleanup_old_progress(self, max_age_seconds: float = 300) -> int:
        """Remove progress entries older than max_age_seconds. Returns count removed."""
        import time
        now = time.time()
        removed = 0
        with self._progress_lock:
            to_remove = []
            for request_id, progress in self._progress_map.items():
                # Check if entry has a timestamp and is old
                if progress.get("_timestamp", now) < now - max_age_seconds:
                    to_remove.append(request_id)
                # Also remove completed entries after shorter time
                elif progress.get("phase") == "done" and progress.get("_timestamp", now) < now - 60:
                    to_remove.append(request_id)
            for request_id in to_remove:
                del self._progress_map[request_id]
                removed += 1
        return removed

    # Active processes tracking
    def register_process(self, item_id: str, proc: Any) -> None:
        with self._lock:
            self._active_procs[item_id] = proc

    def unregister_process(self, item_id: str) -> None:
        with self._lock:
            self._active_procs.pop(item_id, None)

    def get_active_processes(self) -> List[Any]:
        with self._lock:
            return list(self._active_procs.values())

    # Global progress calculation
    def global_progress(self) -> Dict[str, Any]:
        with self._lock:
            items = self._queue
            if not items:
                return {
                    "progress": 0.0,
                    "counts": {"queued": 0, "running": 0, "done": 0, "error": 0, "canceled": 0}
                }

            counts = {"queued": 0, "running": 0, "done": 0, "error": 0, "canceled": 0}
            total = 0.0
            n = 0

            for item in items:
                counts[item.status] = counts.get(item.status, 0) + 1
                if item.status in ("queued", "running", "done"):
                    total += item.progress if item.status != "done" else 1.0
                    n += 1

            prog = (total / n) if n else 0.0
            return {"progress": prog, "counts": counts}


# Singleton instance
app_state = AppState()
