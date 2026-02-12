"""
yt-dlp update management for SplitBoy.

Handles automatic and manual updates of yt-dlp to keep up with YouTube changes.
Supports both pip-based updates (dev) and direct PyPI wheel downloads (production
where pip is stripped from the bundle).
"""

import json as _json
import os
import shutil
import subprocess
import sys
import threading
import time
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.request import urlopen
from urllib.error import URLError

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


def _get_packages_dir() -> Path:
    """Get user-writable directory for yt-dlp updates outside the app bundle."""
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support" / "SplitBoy"
    elif sys.platform == "win32":
        base = Path(os.environ.get(
            "APPDATA", Path.home() / "AppData" / "Roaming"
        )) / "SplitBoy"
    else:
        base = Path.home() / ".local" / "share" / "SplitBoy"
    packages_dir = base / "packages"
    packages_dir.mkdir(parents=True, exist_ok=True)
    return packages_dir


def setup_packages_path() -> None:
    """Prepend user packages directory to sys.path so updated yt-dlp is found first."""
    packages_dir = _get_packages_dir()
    path_str = str(packages_dir)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)
        logger.debug(f"Added user packages dir to sys.path: {path_str}")


def init_updater(state_dir: Path) -> None:
    """Initialize the updater with a state directory."""
    global _state_file
    _state_file = state_dir / ".ytdlp_update_state"
    setup_packages_path()
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
        env = {**os.environ, "PYTHONPATH": str(_get_packages_dir())}
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
            env=env,
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


def _try_pip_update(packages_dir: Path) -> bool:
    """Try updating yt-dlp via pip install --target. Returns True on success."""
    try:
        env = {**os.environ, "PYTHONPATH": str(packages_dir)}
        result = subprocess.run(
            [
                sys.executable, "-m", "pip", "install",
                "--upgrade", "--target", str(packages_dir), "yt-dlp",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
        if result.returncode == 0:
            logger.info("yt-dlp updated via pip")
            return True
        logger.debug(f"pip update failed (rc={result.returncode}): {result.stderr[:200]}")
    except FileNotFoundError:
        logger.debug("pip not available")
    except subprocess.TimeoutExpired:
        logger.debug("pip update timed out")
    except Exception as e:
        logger.debug(f"pip update error: {e}")
    return False


def _try_direct_download(packages_dir: Path) -> bool:
    """Download yt-dlp wheel directly from PyPI (no pip required)."""
    try:
        logger.info("Downloading yt-dlp directly from PyPI...")
        with urlopen("https://pypi.org/pypi/yt-dlp/json", timeout=30) as resp:
            data = _json.loads(resp.read())

        wheel_url = None
        for file_info in data.get("urls", []):
            if file_info["filename"].endswith("-none-any.whl"):
                wheel_url = file_info["url"]
                break

        if not wheel_url:
            logger.warning("No compatible yt-dlp wheel found on PyPI")
            return False

        # Download wheel
        with urlopen(wheel_url, timeout=120) as resp:
            wheel_bytes = resp.read()

        # Remove old yt_dlp package from user dir before extracting
        old_ytdlp = packages_dir / "yt_dlp"
        if old_ytdlp.exists():
            shutil.rmtree(old_ytdlp)
        # Also clean old dist-info
        for p in packages_dir.glob("yt_dlp-*.dist-info"):
            shutil.rmtree(p)

        # Extract wheel (it's a zip)
        wheel_path = packages_dir / "yt_dlp_download.whl"
        wheel_path.write_bytes(wheel_bytes)
        with zipfile.ZipFile(wheel_path) as zf:
            zf.extractall(packages_dir)
        wheel_path.unlink()

        logger.info("yt-dlp installed directly from PyPI wheel")
        return True

    except (URLError, OSError) as e:
        logger.warning(f"Direct download failed: {e}")
    except Exception as e:
        logger.warning(f"Direct download error: {e}")
    return False


def update_ytdlp(force: bool = False) -> Dict[str, Any]:
    """
    Update yt-dlp to the latest version.

    Tries pip first, then falls back to downloading the wheel directly from PyPI.
    Installs to a user-writable directory so it works even when the app bundle
    is read-only or pip has been stripped.

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

        old_version = get_current_version()
        packages_dir = _get_packages_dir()

        updated = _try_pip_update(packages_dir)
        if not updated:
            updated = _try_direct_download(packages_dir)

        new_version = get_current_version()

        with _state_lock:
            _update_state["last_check"] = datetime.now().isoformat()
            _update_state["update_in_progress"] = False

        if updated:
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
            error_msg = "Both pip and direct download methods failed"
            logger.warning(f"yt-dlp update failed: {error_msg}")
            with _state_lock:
                _update_state["last_error"] = error_msg
            _save_state()
            return {
                "success": False,
                "message": f"Update failed: {error_msg}",
                "version": old_version
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
