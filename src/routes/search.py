"""
Search endpoints for SplitBoy API.

Handles YouTube search, related videos, video info, playlist, and channel listing.
"""

import re
from typing import Optional
from pathlib import Path

from fastapi import APIRouter, HTTPException

from lib.constants import PLAYLIST_HARD_CAP
from lib.logging_config import get_logger
from lib.state import app_state

router = APIRouter()
logger = get_logger("routes.search")

# Load ytdl helpers
import importlib.util

BASE_DIR = Path(__file__).parent.parent.resolve()
_spec = importlib.util.spec_from_file_location(
    "ytdl_interactive_mod", str(BASE_DIR / "ytdl_interactive.py")
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

extract_video_id = getattr(_mod, "extract_video_id")
get_video_info = getattr(_mod, "get_video_info")
get_related_videos = getattr(_mod, "get_related_videos")
search_youtube = getattr(_mod, "search_youtube")


@router.get("/search")
def api_search(q: str, max: int = 100, requestId: Optional[str] = None):
    """Search YouTube for videos."""
    if requestId:
        app_state.set_progress(requestId, "listing", message="Searching...")
    max = max if 1 <= max <= 500 else 100
    results = search_youtube(q, max_results=max)
    if requestId:
        app_state.update_progress(requestId, current=len(results), total=len(results),
                                   message=f"Found {len(results)} results")
        app_state.finish_progress(requestId)
    return {"items": results}


@router.get("/related")
def api_related(id: str, max: int = 50, requestId: Optional[str] = None):
    """Get related videos for a given video ID."""
    if requestId:
        app_state.set_progress(requestId, "listing", message="Fetching related...")
    max = max if 1 <= max <= 100 else 50
    results = get_related_videos(id, max_results=max)
    if requestId:
        app_state.update_progress(requestId, current=len(results), total=len(results),
                                   message=f"Found {len(results)} related")
        app_state.finish_progress(requestId)
    return {"items": results}


@router.get("/video-info")
def api_video_info(url: str):
    """Get video information for a URL."""
    info = get_video_info(url)
    if not info:
        raise HTTPException(404, "Video info not found")
    return info


@router.get("/playlist")
def api_playlist(url: str, max: Optional[int] = None, requestId: Optional[str] = None):
    """Fetch playlist entries."""
    limit = min(max or PLAYLIST_HARD_CAP, PLAYLIST_HARD_CAP)

    if requestId:
        app_state.set_progress(requestId, "listing", message="Listing playlist...")

    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "noplaylist": False,
            "extract_flat": "in_playlist",
        }

        items = []
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            entries = info.get("entries") or []

            for e in entries:
                vid = e.get("id", "")
                items.append({
                    "title": e.get("title", "Unknown"),
                    "duration": e.get("duration") or 0,
                    "url": e.get("url") or f"https://www.youtube.com/watch?v={vid}",
                    "id": vid,
                    "channel": e.get("channel") or e.get("uploader") or "Unknown",
                })
                if len(items) >= limit:
                    break

                if requestId:
                    app_state.update_progress(requestId, current=len(items), total=len(entries),
                                               message=f"Fetching list {len(items)}/{len(entries)}")

        if requestId:
            app_state.finish_progress(requestId)
        return {"items": items}

    except Exception as e:
        logger.exception("Error fetching playlist")
        if requestId:
            app_state.finish_progress(requestId, error=str(e))
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/channel")
def api_channel(channelUrl: Optional[str] = None, channelId: Optional[str] = None,
                max: Optional[int] = None, requestId: Optional[str] = None):
    """Fetch channel uploads."""
    # Normalize URL
    target = None
    if channelUrl:
        target = channelUrl
        if not re.search(r"/videos($|[/?])", target):
            if re.search(r"youtube\.com/(?:@|channel/)", target):
                target = re.sub(r"/+$", "", target) + "/videos"
    elif channelId:
        target = f"https://www.youtube.com/channel/{channelId}/videos"
    else:
        raise HTTPException(400, "channelUrl or channelId required")

    limit = min(max or PLAYLIST_HARD_CAP, PLAYLIST_HARD_CAP)

    if requestId:
        app_state.set_progress(requestId, "listing", message="Listing channel...")

    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "noplaylist": False,
            "extract_flat": "in_playlist",
        }

        items = []
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(target, download=False)
            entries = info.get("entries") or []

            for e in entries:
                vid = e.get("id", "")
                items.append({
                    "title": e.get("title", "Unknown"),
                    "duration": e.get("duration") or 0,
                    "url": e.get("url") or f"https://www.youtube.com/watch?v={vid}",
                    "id": vid,
                    "channel": e.get("channel") or e.get("uploader") or "Unknown",
                })
                if len(items) >= limit:
                    break

                if requestId:
                    app_state.update_progress(requestId, current=len(items), total=len(entries),
                                               message=f"Fetching list {len(items)}/{len(entries)}")

        if requestId:
            app_state.finish_progress(requestId)
        return {"items": items}

    except Exception as e:
        logger.exception("Error fetching channel")
        if requestId:
            app_state.finish_progress(requestId, error=str(e))
        raise HTTPException(status_code=400, detail=str(e))
