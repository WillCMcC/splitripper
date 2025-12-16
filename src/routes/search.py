"""
Search endpoints for SplitBoy API.

Handles YouTube search, related videos, video info, playlist, and channel listing.
"""

import re
from typing import Optional, List, Dict, Any

from fastapi import APIRouter, HTTPException

from lib.constants import PLAYLIST_HARD_CAP
from lib.logging_config import get_logger
from lib.state import app_state

# Import ytdl helpers using normal imports
from ytdl_interactive import (
    extract_video_id,
    get_video_info,
    get_related_videos,
    search_youtube,
)

router = APIRouter()
logger = get_logger("routes.search")


def _fetch_listing(
    url: str, limit: int, request_id: Optional[str], listing_type: str
) -> Dict[str, Any]:
    """
    Shared logic for fetching playlist or channel listings.

    Args:
        url: The URL to fetch from
        limit: Maximum number of items to return
        request_id: Optional request ID for progress tracking
        listing_type: Type of listing ("playlist" or "channel") for logging

    Returns:
        Dict with "items" list

    Raises:
        HTTPException on error
    """
    if request_id:
        app_state.set_progress(
            request_id, "listing", message=f"Listing {listing_type}..."
        )

    try:
        import yt_dlp

        ydl_opts = {
            "quiet": True,
            "noplaylist": False,
            "extract_flat": "in_playlist",
        }

        items: List[Dict[str, Any]] = []
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            entries = info.get("entries") or []

            for e in entries:
                vid = e.get("id", "")
                items.append(
                    {
                        "title": e.get("title", "Unknown"),
                        "duration": e.get("duration") or 0,
                        "url": e.get("url") or f"https://www.youtube.com/watch?v={vid}",
                        "id": vid,
                        "channel": e.get("channel") or e.get("uploader") or "Unknown",
                    }
                )
                if len(items) >= limit:
                    break

                if request_id:
                    app_state.update_progress(
                        request_id,
                        current=len(items),
                        total=len(entries),
                        message=f"Fetching list {len(items)}/{len(entries)}",
                    )

        if request_id:
            app_state.finish_progress(request_id)
        return {"items": items}

    except Exception as e:
        logger.exception(f"Error fetching {listing_type}")
        if request_id:
            app_state.finish_progress(request_id, error=str(e))
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/search")
def api_search(q: str, max: int = 100, requestId: Optional[str] = None):
    """Search YouTube for videos."""
    if requestId:
        app_state.set_progress(requestId, "listing", message="Searching...")
    max = max if 1 <= max <= 500 else 100
    results = search_youtube(q, max_results=max)
    if requestId:
        app_state.update_progress(
            requestId,
            current=len(results),
            total=len(results),
            message=f"Found {len(results)} results",
        )
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
        app_state.update_progress(
            requestId,
            current=len(results),
            total=len(results),
            message=f"Found {len(results)} related",
        )
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
    return _fetch_listing(url, limit, requestId, "playlist")


@router.get("/channel")
def api_channel(
    channelUrl: Optional[str] = None,
    channelId: Optional[str] = None,
    max: Optional[int] = None,
    requestId: Optional[str] = None,
):
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
    return _fetch_listing(target, limit, requestId, "channel")
