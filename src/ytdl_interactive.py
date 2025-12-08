#!/usr/bin/env python3
"""
Helper functions for YouTube metadata and search.

This module provides stateless helpers used by the FastAPI server:
  - extract_video_id
  - get_video_info
  - get_related_videos
  - search_youtube
  - format_duration
"""

import re
from urllib.parse import urlparse, parse_qs
from typing import Any, Dict, List, Optional

# Import yt-dlp as a module instead of using subprocess
try:
    import yt_dlp
except ImportError:
    # Fallback for development environments where yt-dlp might not be installed
    yt_dlp = None
    import subprocess
    import json


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


def extract_video_id(url_or_id: str) -> Optional[str]:
    """
    Extract video ID from YouTube URL or return the ID if it's already just an ID.

    Handles various YouTube URL formats:
      - youtube.com/watch?v=VIDEO_ID
      - youtu.be/VIDEO_ID
      - youtube.com/embed/VIDEO_ID
      - youtube.com/v/VIDEO_ID
    """
    if not isinstance(url_or_id, str):
        return None

    # If it's already just a video ID (11 characters, alphanumeric + - and _)
    if re.match(r"^[a-zA-Z0-9_-]{11}$", url_or_id.strip()):
        return url_or_id.strip()

    url = url_or_id.strip()

    # Add https:// if no protocol is specified
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        parsed = urlparse(url)
        netloc = parsed.netloc.lower()

        # youtube.com/watch?v=VIDEO_ID
        if "youtube.com" in netloc and parsed.path == "/watch":
            query_params = parse_qs(parsed.query)
            if "v" in query_params:
                return query_params["v"][0]

        # youtu.be/VIDEO_ID
        elif "youtu.be" in netloc:
            return parsed.path.lstrip("/").split("?")[0]

        # youtube.com/embed/VIDEO_ID
        elif "youtube.com" in netloc and parsed.path.startswith("/embed/"):
            return parsed.path.split("/embed/")[1].split("?")[0]

        # youtube.com/v/VIDEO_ID
        elif "youtube.com" in netloc and parsed.path.startswith("/v/"):
            return parsed.path.split("/v/")[1].split("?")[0]
    except Exception:
        pass

    return None


def get_video_info(url: str) -> Optional[Dict[str, Any]]:
    """
    Get video information using yt-dlp (no download).

    Returns dict with: title, duration, duration_str, video_id, channel
    """
    try:
        if yt_dlp:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': False,
                'skip_download': True,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                return _extract_video_metadata(info, url)
        else:
            # Fallback to subprocess for development
            import subprocess
            import json
            result = subprocess.run(
                ["yt-dlp", "--dump-json", "--no-playlist", url],
                capture_output=True, text=True, check=True
            )
            info = json.loads(result.stdout)
            return _extract_video_metadata(info, url)
    except Exception as e:
        print(f"Error getting video info: {e}")
        return None


def _extract_video_metadata(info: Dict[str, Any], url: str) -> Dict[str, Any]:
    """Extract standardized metadata from yt-dlp info dict."""
    title = info.get("title", "Unknown")
    duration = info.get("duration", 0)
    channel = info.get("channel", info.get("uploader", "Unknown"))

    return {
        "title": title,
        "duration": duration,
        "duration_str": format_duration(duration),
        "video_id": info.get("id", extract_video_id(url)),
        "channel": channel,
    }


def _entry_to_video_dict(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a yt-dlp entry to our standardized video dict format."""
    vid_id = entry.get("id", "")
    return {
        "title": entry.get("title", "Unknown"),
        "duration": entry.get("duration", 0),
        "url": entry.get("url", f"https://www.youtube.com/watch?v={vid_id}"),
        "id": vid_id,
        "channel": entry.get("channel", entry.get("uploader", "Unknown")),
    }


def get_related_videos(video_id: str, max_results: int = 50) -> List[Dict[str, Any]]:
    """
    Get related videos via the YouTube mix playlist technique.

    Args:
        video_id: YouTube video ID to get related videos for
        max_results: Maximum number of results (capped at 200)

    Returns:
        List of video dicts with: title, duration, url, id, channel
    """
    if not video_id or not isinstance(video_id, str):
        return []

    max_results = max(1, min(max_results, 200))
    mix_url = f"https://www.youtube.com/watch?v={video_id}&list=RD{video_id}"

    try:
        if yt_dlp:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': 'in_playlist',
                'playlistend': max_results,
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                playlist_info = ydl.extract_info(mix_url, download=False)
                entries = playlist_info.get('entries', [])
        else:
            import subprocess
            import json
            result = subprocess.run(
                ["yt-dlp", "--dump-json", "--flat-playlist",
                 "--playlist-items", f"1-{max_results}", mix_url],
                capture_output=True, text=True, check=True
            )
            entries = [json.loads(line) for line in result.stdout.strip().split("\n") if line]

        # Dedupe and exclude original video
        videos: List[Dict[str, Any]] = []
        seen_ids = {video_id}

        for entry in entries:
            if not entry:
                continue
            vid_id = entry.get("id", "")
            if vid_id and vid_id not in seen_ids:
                seen_ids.add(vid_id)
                videos.append(_entry_to_video_dict(entry))
                if len(videos) >= max_results:
                    break

        return videos
    except Exception as e:
        print(f"Error getting related videos: {e}")
        return []


def search_youtube(query: str, max_results: int = 100) -> List[Dict[str, Any]]:
    """
    Search YouTube and return results.

    Args:
        query: Search query string
        max_results: Maximum number of results (capped at 500)

    Returns:
        List of video dicts with: title, duration, url, id, channel
    """
    max_results = max(1, min(max_results, 500))
    search_query = f"ytsearch{max_results}:{query}"

    try:
        if yt_dlp:
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': 'in_playlist',
                'playlistend': max_results,
                'default_search': 'ytsearch',
            }

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                search_results = ydl.extract_info(search_query, download=False)
                entries = search_results.get('entries', [])
        else:
            import subprocess
            import json
            result = subprocess.run(
                ["yt-dlp", "--dump-json", "--flat-playlist",
                 "--playlist-items", f"1-{max_results}", search_query],
                capture_output=True, text=True, check=True
            )
            entries = [json.loads(line) for line in result.stdout.strip().split("\n") if line]

        return [_entry_to_video_dict(entry) for entry in entries if entry]
    except Exception as e:
        print(f"Error searching YouTube: {e}")
        return []
