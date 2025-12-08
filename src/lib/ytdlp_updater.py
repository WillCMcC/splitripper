"""
yt-dlp update management for SplitBoy.

Handles automatic and manual updates of yt-dlp to keep up with YouTube changes.
"""

import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from .logging_config import get_logger

logger = get_logger("ytdlp_updater")

# Update check interval (default: 24 hours)
UPDATE_CHECK_INTERVAL_HOURS = 24

# State file to track last update check
_state_file: Optional[Path] = None
_update_state: Dict[str, Any] = {
    "last_check": None,
    "last_update": None,
    "current_version": None,
    "update_in_progress": False,
    "last_error": None,
}
_state_lock = threading.Lock()


def init_updater(state_dir: Path) -> None:
    """Initialize the updater with a state directory."""
    global _state_file
    _state_file = state_dir / ".ytdlp_update_state"
    _load_state()


def _load_state() -> None:
    """Load update state from file."""
    global _update_state
    if _state_file and _state_file.exists():
        try:
            import json
            data = json.loads(_state_file.read_text())
            with _state_lock:
                _update_state.update(data)
        except Exception as e:
            logger.debug(f"Could not load update state: {e}")


def _save_state() -> None:
    """Save update state to file."""
    if _state_file:
        try:
            import json
            with _state_lock:
                _state_file.write_text(json.dumps(_update_state, default=str))
        except Exception as e:
            logger.debug(f"Could not save update state: {e}")


def get_current_version() -> Optional[str]:
    """Get the currently installed yt-dlp version."""
    try:
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            capture_output=True,
            text=True,
            timeout=10
        )
        if result.returncode == 0:
            version = result.stdout.strip()
            with _state_lock:
                _update_state["current_version"] = version
            return version
    except Exception as e:
        logger.debug(f"Could not get yt-dlp version: {e}")
    return None


def get_update_status() -> Dict[str, Any]:
    """Get current update status."""
    with _state_lock:
        return {
            "current_version": _update_state.get("current_version"),
            "last_check": _update_state.get("last_check"),
            "last_update": _update_state.get("last_update"),
            "update_in_progress": _update_state.get("update_in_progress", False),
            "last_error": _update_state.get("last_error"),
        }


def needs_update_check() -> bool:
    """Check if enough time has passed since last update check."""
    with _state_lock:
        last_check = _update_state.get("last_check")

    if not last_check:
        return True

    try:
        if isinstance(last_check, str):
            last_check = datetime.fromisoformat(last_check)
        threshold = datetime.now() - timedelta(hours=UPDATE_CHECK_INTERVAL_HOURS)
        return last_check < threshold
    except Exception:
        return True


def update_ytdlp(force: bool = False) -> Dict[str, Any]:
    """
    Update yt-dlp to the latest version.

    Args:
        force: If True, update even if recently checked

    Returns:
        Dict with update result: {"success": bool, "message": str, "version": str}
    """
    with _state_lock:
        if _update_state.get("update_in_progress"):
            return {
                "success": False,
                "message": "Update already in progress",
                "version": _update_state.get("current_version")
            }
        _update_state["update_in_progress"] = True
        _update_state["last_error"] = None

    try:
        logger.info("Checking for yt-dlp updates...")

        # Get current version before update
        old_version = get_current_version()

        # Run pip upgrade
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"],
            capture_output=True,
            text=True,
            timeout=120  # 2 minute timeout
        )

        # Get new version after update
        new_version = get_current_version()

        with _state_lock:
            _update_state["last_check"] = datetime.now().isoformat()
            _update_state["update_in_progress"] = False

        if result.returncode == 0:
            if old_version != new_version:
                logger.info(f"yt-dlp updated: {old_version} -> {new_version}")
                with _state_lock:
                    _update_state["last_update"] = datetime.now().isoformat()
                _save_state()
                return {
                    "success": True,
                    "message": f"Updated from {old_version} to {new_version}",
                    "version": new_version,
                    "was_updated": True
                }
            else:
                logger.info(f"yt-dlp is already up to date ({new_version})")
                _save_state()
                return {
                    "success": True,
                    "message": f"Already up to date ({new_version})",
                    "version": new_version,
                    "was_updated": False
                }
        else:
            error_msg = result.stderr[:500] if result.stderr else "Unknown error"
            logger.warning(f"yt-dlp update failed: {error_msg}")
            with _state_lock:
                _update_state["last_error"] = error_msg
            _save_state()
            return {
                "success": False,
                "message": f"Update failed: {error_msg}",
                "version": old_version
            }

    except subprocess.TimeoutExpired:
        error_msg = "Update timed out after 2 minutes"
        logger.warning(error_msg)
        with _state_lock:
            _update_state["update_in_progress"] = False
            _update_state["last_error"] = error_msg
        _save_state()
        return {
            "success": False,
            "message": error_msg,
            "version": _update_state.get("current_version")
        }
    except Exception as e:
        error_msg = str(e)[:500]
        logger.warning(f"yt-dlp update error: {error_msg}")
        with _state_lock:
            _update_state["update_in_progress"] = False
            _update_state["last_error"] = error_msg
        _save_state()
        return {
            "success": False,
            "message": f"Update error: {error_msg}",
            "version": _update_state.get("current_version")
        }


def update_ytdlp_async(callback: Optional[callable] = None) -> None:
    """
    Update yt-dlp in a background thread.

    Args:
        callback: Optional function to call with result dict when complete
    """
    def _do_update():
        result = update_ytdlp()
        if callback:
            try:
                callback(result)
            except Exception as e:
                logger.debug(f"Update callback error: {e}")

    thread = threading.Thread(target=_do_update, daemon=True)
    thread.start()


def check_and_update_on_startup() -> None:
    """
    Check for updates on startup if enough time has passed.
    Runs asynchronously to not block server startup.
    """
    def _startup_check():
        # Small delay to let server finish initializing
        time.sleep(2)

        if needs_update_check():
            logger.info("Checking for yt-dlp updates (periodic check)...")
            result = update_ytdlp()
            if result.get("was_updated"):
                logger.info(f"yt-dlp auto-updated to {result.get('version')}")
        else:
            # Just get current version for status
            version = get_current_version()
            logger.debug(f"yt-dlp version: {version} (skipping update check)")

    thread = threading.Thread(target=_startup_check, daemon=True)
    thread.start()
