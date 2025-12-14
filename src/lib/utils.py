"""
Utility functions for SplitBoy.

Contains shared helpers used across multiple modules.
"""

import re
from typing import Optional, Tuple


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


def sanitize_filename(name: str, max_length: int = 120) -> str:
    """
    Sanitize a string for use as a filename.

    Args:
        name: The string to sanitize
        max_length: Maximum length of the result (default 120)

    Returns:
        A filesystem-safe string
    """
    s = re.sub(r'[<>:"/\\|?*]', "_", name or "").strip().strip(".")
    return re.sub(r"\s+", " ", s).strip()[:max_length] or "untitled"


def parse_artist_song(
    title: Optional[str], channel: Optional[str]
) -> Tuple[Optional[str], str]:
    """
    Parse artist and song from a title string.

    Handles formats like "Artist - Song Title" and falls back to channel name.

    Args:
        title: The title string to parse (e.g., "Artist - Song Title")
        channel: Fallback channel/artist name

    Returns:
        Tuple of (artist or None, song title)
    """
    base = (title or "").strip()
    if not base:
        return (channel or None), "untitled"

    # Try to split on common separators (-, en-dash, em-dash)
    m = re.match(r"\s*([^\-\u2013\u2014]+)\s*[\-\u2013\u2014]\s*(.+)", base)
    if m:
        artist = sanitize_filename(m.group(1).strip())
        song = sanitize_filename(m.group(2).strip())
        return (artist or (channel or None)), song

    # No clear separator - use channel as artist if available
    return ((channel and sanitize_filename(channel)) or None, sanitize_filename(base))


def parse_time_to_seconds(ts: str) -> Optional[int]:
    """
    Parse a time string like HH:MM:SS or MM:SS to total seconds.

    Args:
        ts: Time string in format "HH:MM:SS" or "MM:SS"

    Returns:
        Total seconds, or None if parsing fails
    """
    try:
        parts = [int(p) for p in ts.strip().split(":")]
        if len(parts) == 3:
            h, m, s = parts
        elif len(parts) == 2:
            h, m, s = 0, parts[0], parts[1]
        else:
            return None
        return max(0, h * 3600 + m * 60 + s)
    except Exception:
        return None
