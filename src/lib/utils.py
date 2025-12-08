"""
Utility functions for SplitBoy.

Contains shared helpers used across multiple modules.
"""

from typing import Optional


def format_duration(seconds: Optional[int]) -> str:
    """
    Format seconds as HH:MM:SS or MM:SS string.

    Args:
        seconds: Duration in seconds, or None/0 for unknown

    Returns:
        Formatted duration string like "05:23" or "01:45:30"
    """
    if not seconds:
        return "Unknown"

    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60

    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def is_audio_file(filename: str) -> bool:
    """Check if a filename has an audio extension."""
    from .constants import AUDIO_EXTENSIONS

    if not isinstance(filename, str):
        return False
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    return ext in AUDIO_EXTENSIONS


def clamp(value: int, min_val: int, max_val: int) -> int:
    """Clamp a value between min and max."""
    return max(min_val, min(max_val, value))


def truncate_string(s: str, max_length: int, suffix: str = "...") -> str:
    """Truncate a string to max_length, adding suffix if truncated."""
    if len(s) <= max_length:
        return s
    return s[:max_length - len(suffix)] + suffix
