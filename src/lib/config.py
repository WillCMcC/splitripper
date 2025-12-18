"""
Configuration management for SplitBoy.

Handles loading, saving, and validating configuration from config.json.
"""

import json
import os
import platform
from pathlib import Path
from typing import Any, Dict, Optional

from .constants import (
    DEFAULT_CONCURRENCY,
    DEFAULT_DEMUCS_MODEL,
    DEFAULT_QUALITY_PRESET,
    DEFAULT_STEM_MODE,
)


def get_default_desktop_path() -> str:
    """Get the user's desktop path in a cross-platform way."""
    try:
        if platform.system() == "Windows":
            import winreg
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders"
            ) as key:
                return winreg.QueryValueEx(key, "Desktop")[0]

        # macOS and Linux
        desktop_path = os.path.expanduser("~/Desktop")
        if os.path.exists(desktop_path):
            return desktop_path

        # Try localized desktop folders for Linux
        alternatives = ["~/Skrivbord", "~/Bureau", "~/Escritorio", "~/デスクトップ"]
        for alt in alternatives:
            alt_path = os.path.expanduser(alt)
            if os.path.exists(alt_path):
                return alt_path

        # Fallback to home directory
        return os.path.expanduser("~")
    except Exception:
        return os.path.expanduser("~")


def is_foreign_user_path(p: Path) -> bool:
    """
    Detect macOS paths like /Users/<someone_else>/... that don't match current user.
    Only applies on Darwin; external volumes or other absolute paths are allowed.
    """
    try:
        if platform.system() == "Darwin":
            parts = p.parts
            if len(parts) >= 3 and parts[1] == "Users":
                current_user = Path.home().name
                return parts[2] != current_user
        return False
    except Exception:
        return False


class Config:
    """Configuration manager for SplitBoy."""

    DEFAULT_CONFIG = {
        "output_dir": "",  # Will be set to desktop on first access
        "default_folder": "",
        "max_concurrency": DEFAULT_CONCURRENCY,
        "demucs_model": DEFAULT_DEMUCS_MODEL,
        "stem_mode": DEFAULT_STEM_MODE,
        "quality_preset": DEFAULT_QUALITY_PRESET,
    }

    def __init__(self, config_path: Path):
        self.config_path = config_path
        self._config: Dict[str, Any] = self.DEFAULT_CONFIG.copy()
        self._load()
        self._sanitize_output_dir()

    def _load(self) -> None:
        """Load configuration from file if it exists."""
        if self.config_path.exists():
            try:
                self._config.update(json.loads(self.config_path.read_text()))
            except Exception:
                pass

    def _sanitize_output_dir(self) -> None:
        """Ensure output_dir is valid and accessible."""
        cfg_out = self._config.get("output_dir")

        if not cfg_out or not isinstance(cfg_out, str) or not cfg_out.strip():
            out_path = Path(get_default_desktop_path())
        else:
            candidate = Path(os.path.expanduser(cfg_out)).resolve()
            if is_foreign_user_path(candidate):
                out_path = Path(get_default_desktop_path())
            else:
                out_path = candidate

        # Ensure directory exists with fallbacks
        for fallback in [out_path, Path(get_default_desktop_path()), Path.home() / "SplitBoy"]:
            try:
                fallback.mkdir(parents=True, exist_ok=True)
                out_path = fallback
                break
            except Exception:
                continue

        self._config["output_dir"] = str(out_path)
        self.save()

    def save(self) -> None:
        """Persist configuration to file."""
        try:
            self.config_path.write_text(json.dumps(self._config, indent=2))
        except Exception:
            pass

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self._config.get(key, default)

    def update(self, updates: Dict[str, Any]) -> None:
        """Update configuration with new values."""
        # Filter out disabled/unsupported keys
        updates.pop("cookies_file", None)
        updates.pop("cookies_from_browser", None)
        self._config.update(updates)
        self.save()

    def as_dict(self) -> Dict[str, Any]:
        """Return configuration as dictionary."""
        return self._config.copy()

    @property
    def output_dir(self) -> str:
        return self._config.get("output_dir", "")

    @property
    def default_folder(self) -> str:
        return self._config.get("default_folder", "")

    @property
    def max_concurrency(self) -> int:
        val = self._config.get("max_concurrency", DEFAULT_CONCURRENCY)
        return int(val) if isinstance(val, int) else DEFAULT_CONCURRENCY
