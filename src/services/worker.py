"""
Queue worker service for SplitBoy.

Handles downloading and processing of queue items.
"""

import os
import re
import shutil
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from lib.config import get_default_desktop_path
from lib.constants import STEM_MODES, DEFAULT_STEM_MODE
from lib.logging_config import get_logger
from lib.metadata import extract_audio_metadata, get_title_from_path
from lib.state import app_state, QueueItem
from lib.utils import sanitize_filename, parse_artist_song

from services.demucs import run_demucs_separation

logger = get_logger("services.worker")

BASE_DIR = Path(__file__).parent.parent.resolve()

# Note: Demucs operations now run in parallel based on max_concurrency setting.
# Previously had a Semaphore(1) but the "hangs" were actually just slow htdemucs_ft processing.

# Import ytdl helpers using normal imports
from ytdl_interactive import get_video_info


def _split_and_stage(
    audio_file: Path, item: QueueItem
) -> Tuple[bool, Optional[str], Optional[Path]]:
    """
    Run Demucs on audio_file and move results to final destination.

    Returns:
        Tuple of (success, error_message, destination_directory)
    """
    try:
        folder_path = item.folder.strip() if item.folder else ""
        if folder_path:
            out_root = Path(folder_path)
        else:
            out_root = Path(
                app_state.get_config_value("output_dir") or get_default_desktop_path()
            )
        out_root.mkdir(parents=True, exist_ok=True)

        # Determine artist and song names
        if item.local_file:
            artist = sanitize_filename(item.channel) if item.channel else None
            song = sanitize_filename(item.title or "untitled")
            if not artist:
                artist, song = parse_artist_song(item.title, None)
        else:
            artist, song = parse_artist_song(item.title, item.channel)

        dest_dir_base = out_root / (artist if artist else "")

        # Temp directory for Demucs output
        tmp_root = Path(tempfile.gettempdir()) / "splitboy_stems"
        tmp_root.mkdir(parents=True, exist_ok=True)

        with app_state.lock:
            item.processing = True
            item.downloaded = True

        # Get stem mode for this item
        stem_mode = item.stem_mode or app_state.get_config_value(
            "stem_mode", DEFAULT_STEM_MODE
        )
        stem_config = STEM_MODES.get(stem_mode, STEM_MODES[DEFAULT_STEM_MODE])

        # Run Demucs (parallel operations allowed based on max_concurrency)
        logger.info(f"Starting Demucs for: {item.title or item.id}")
        stems, err = run_demucs_separation(audio_file, tmp_root, item)
        logger.info(
            f"Demucs returned for {item.title or item.id}: stems={bool(stems)}, err={err}"
        )

        if stems:
            # Move stems to final destinations
            file_ext = None
            for stem_name, stem_path in stems.items():
                if file_ext is None:
                    file_ext = stem_path.suffix

                # Map stem name to output directory
                # For 2-stem mode: vocals -> vocals, no_vocals -> instrumental
                if stem_mode == "2":
                    if stem_name == "vocals":
                        out_dir_name = "vocals"
                    else:  # no_vocals, accompaniment, other
                        out_dir_name = "instrumental"
                else:
                    # For 4/6 stem modes, use stem name as directory
                    out_dir_name = stem_name

                stem_out_dir = dest_dir_base / out_dir_name
                stem_out_dir.mkdir(parents=True, exist_ok=True)

                stem_out_path = stem_out_dir / f"{song}{file_ext}"

                try:
                    shutil.move(str(stem_path), str(stem_out_path))
                except Exception:
                    shutil.copy2(str(stem_path), str(stem_out_path))

            return True, None, dest_dir_base
        else:
            return False, err or "demucs separation failed", None

    except Exception as e:
        return False, str(e)[:300], None


def _process_local_item(item: QueueItem) -> None:
    """Process a local audio file through Demucs."""
    try:
        if not item.local_path or not os.path.exists(item.local_path):
            with app_state.lock:
                item.status = "error"
                item.error = "Local file not found"
            app_state.decrement_active()
            return

        # Extract metadata
        artist, title = extract_audio_metadata(item.local_path)
        with app_state.lock:
            if artist:
                item.channel = artist
                item.has_artist_metadata = True
            if title:
                item.title = title
            elif not item.title:
                item.title = get_title_from_path(item.local_path)

            # Mark as downloaded (skip download phase for local files)
            item.download_progress = 1.0
            item.downloaded = True
            item.processing = True
            item.progress = 0.0

        # Run Demucs
        audio_file = Path(item.local_path)
        ok, err, dest_dir = _split_and_stage(audio_file, item)

        with app_state.lock:
            if ok:
                item.processing = False
                item.progress = 1.0
                item.status = "done"
                item.dest_path = str(dest_dir) if dest_dir else ""
            else:
                item.processing = False
                item.status = "error"
                item.error = err or "demucs separation error"
        app_state.decrement_active()

    except Exception as e:
        with app_state.lock:
            item.processing = False
            item.status = "error"
            item.error = str(e)[:300]
        app_state.decrement_active()


def _process_youtube_item(item: QueueItem) -> None:
    """Download and process a YouTube video."""
    try:
        import yt_dlp
    except ImportError as e:
        with app_state.lock:
            item.status = "error"
            item.error = f"yt_dlp not available: {e}"
        app_state.decrement_active()
        return

    try:
        # Fetch metadata if not present
        if not item.title:
            try:
                info = get_video_info(item.url)
                if info:
                    with app_state.lock:
                        item.title = info.get("title")
                        item.duration = info.get("duration")
                        item.channel = info.get("channel")
            except Exception:
                pass

        # Create temp directory for download
        safe_title = re.sub(r'[<>:"/\\|?*]', "_", (item.title or "download")).strip(
            ". "
        )[:100]
        temp_dir = Path(tempfile.gettempdir()) / "splitboy_downloads" / safe_title
        temp_dir.mkdir(parents=True, exist_ok=True)

        # Progress hook
        last_emit = {"t": 0.0}

        def progress_hook(d: Dict[str, Any]):
            status = d.get("status")
            now = time.time()

            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes") or 0
                if total > 0:
                    dp = max(0.0, min(0.999, float(downloaded) / float(total)))
                else:
                    dp = 0.01

                # Always emit the first progress update immediately, then throttle
                is_first_update = last_emit["t"] == 0.0
                if is_first_update or (now - last_emit["t"]) >= 0.08:
                    with app_state.lock:
                        item.download_progress = dp
                        item.progress = dp
                        item.processing = False
                        item.downloaded = False
                        eta = d.get("eta")
                        if isinstance(eta, (int, float)) and eta >= 0:
                            item.download_eta_sec = int(eta)
                    last_emit["t"] = now

            elif status == "finished":
                with app_state.lock:
                    item.download_progress = 1.0
                    item.downloaded = True
                    item.processing = True
                    item.progress = 0.0
                    item.download_eta_sec = 0

        # yt-dlp options
        ydl_opts = {
            "format": "bestaudio/best",
            "quiet": True,
            "noprogress": False,
            "outtmpl": str(temp_dir / "%(title)s.%(ext)s"),
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "192",
                }
            ],
            "progress_hooks": [progress_hook],
            "noplaylist": True,
        }

        # Add ffmpeg location if bundled
        ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
        logger.info(
            f"yt-dlp ffmpeg_dir check: {ffmpeg_dir} exists={ffmpeg_dir.exists()}"
        )
        if ffmpeg_dir.exists():
            ydl_opts["ffmpeg_location"] = str(ffmpeg_dir)
            logger.info(f"yt-dlp ffmpeg_location set to: {ffmpeg_dir}")
        else:
            logger.warning(f"ffmpeg_dir not found, yt-dlp will use system ffmpeg")

        # Download
        rc_ok = True
        tail_error = ""
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([item.url])
        except Exception as e:
            tail_error = str(e)[:500]
            rc_ok = False

        # Check for stop
        if app_state.stop_event.is_set():
            with app_state.lock:
                item.status = "canceled"
            app_state.decrement_active()
            return

        if rc_ok:
            # Find downloaded file
            audio_file = None
            for ext in ["mp3", "m4a", "webm", "wav", "opus"]:
                candidates = list(temp_dir.glob(f"*.{ext}"))
                if candidates:
                    audio_file = candidates[0]
                    break

            if audio_file:
                ok, err, dest_dir = _split_and_stage(audio_file, item)

                # Cleanup temp
                try:
                    shutil.rmtree(temp_dir, ignore_errors=True)
                except Exception:
                    pass

                with app_state.lock:
                    if ok:
                        item.processing = False
                        item.progress = 1.0
                        item.status = "done"
                        item.dest_path = str(dest_dir) if dest_dir else ""
                    else:
                        item.processing = False
                        item.status = "error"
                        item.error = err or "demucs separation error"
            else:
                with app_state.lock:
                    item.status = "error"
                    item.error = "No audio file found after download"
        else:
            with app_state.lock:
                item.processing = False
                item.status = "error"
                item.error = tail_error or "yt_dlp error"

        app_state.decrement_active()

    except Exception as e:
        with app_state.lock:
            item.processing = False
            item.status = "error"
            item.error = str(e)[:300]
        app_state.decrement_active()


def _process_item(item: QueueItem) -> None:
    """Process a single queue item (local or YouTube)."""
    if item.local_file and item.local_path:
        _process_local_item(item)
    else:
        _process_youtube_item(item)


def download_worker():
    """Main worker loop for processing the queue."""
    with app_state.download_lock:
        app_state.stop_event.clear()
        app_state.running = True

        try:
            threads: List[threading.Thread] = []

            while True:
                if app_state.stop_event.is_set():
                    # Cancel all queued items
                    for item in app_state.get_queue_items():
                        if item.status == "queued":
                            item.status = "canceled"
                    break

                # Cleanup completed threads to prevent memory leak
                threads = [t for t in threads if t.is_alive()]

                # Launch new items up to max_concurrency
                can_launch = max(0, app_state.max_concurrency - app_state.active)
                queued_items = [
                    it for it in app_state.get_queue_items() if it.status == "queued"
                ]

                if can_launch > 0 and queued_items:
                    to_start = queued_items[:can_launch]
                    for item in to_start:
                        with app_state.lock:
                            item.status = "running"
                            item.progress = 0.0
                            item.download_progress = 0.0
                            item.processing = False
                            item.downloaded = False
                        app_state.increment_active()

                        t = threading.Thread(
                            target=_process_item, args=(item,), daemon=True
                        )
                        threads.append(t)
                        t.start()

                # Check if all work is done
                items = app_state.get_queue_items()
                still_running = any(it.status in ("queued", "running") for it in items)
                if not still_running and app_state.active == 0:
                    break

                time.sleep(0.3)

        finally:
            app_state.running = False
