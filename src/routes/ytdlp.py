"""
yt-dlp endpoints for SplitBoy API.

Handles yt-dlp version status and update operations.
"""

from fastapi import APIRouter

from lib.ytdlp_updater import (
    get_update_status,
    get_current_version,
    update_ytdlp,
)

router = APIRouter()


@router.get("/ytdlp/status")
def api_ytdlp_status():
    """Get yt-dlp version and update status."""
    status = get_update_status()
    # Refresh current version if not set
    if not status.get("current_version"):
        status["current_version"] = get_current_version()
    return status


@router.post("/ytdlp/update")
def api_ytdlp_update():
    """Manually trigger yt-dlp update."""
    result = update_ytdlp(force=True)
    return result
