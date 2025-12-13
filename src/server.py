"""
SplitBoy FastAPI Server.

This is the main entry point for the backend server. It provides:
- YouTube search, playlist, and channel listing
- Queue management for downloads and audio separation
- Configuration management
- Progress tracking

Architecture:
- Uses FastAPI for REST API
- Delegates to lib/ modules for business logic
- State managed via lib/state.py singleton
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# Local imports
from lib.constants import (
    DEFAULT_CONCURRENCY,
    DEFAULT_HOST,
    DEFAULT_PORT,
    DOWNLOAD_PROGRESS_WEIGHT,
    PLAYLIST_HARD_CAP,
    ENRICHMENT_CAP,
    PROCESSING_PROGRESS_WEIGHT,
    DEMUCS_MODELS,
    DEFAULT_DEMUCS_MODEL,
    STEM_MODES,
    DEFAULT_STEM_MODE,
)
from lib.config import Config, get_default_desktop_path
from lib.logging_config import get_logger
from lib.metadata import extract_audio_metadata, get_title_from_path
from lib.state import AppState, QueueItem, app_state
from lib.ytdlp_updater import (
    init_updater,
    check_and_update_on_startup,
    update_ytdlp,
    get_update_status,
    get_current_version,
)

logger = get_logger("server")

# Paths
BASE_DIR = Path(__file__).parent.resolve()
PUBLIC_DIR = BASE_DIR / "public"
CONFIG_PATH = BASE_DIR / "config.json"

# Log ffmpeg path resolution for debugging
_ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
_ffmpeg_bin = _ffmpeg_dir / "ffmpeg"
logger.info(f"BASE_DIR: {BASE_DIR}")
logger.info(f"ffmpeg_dir: {_ffmpeg_dir}")
logger.info(f"ffmpeg_dir exists: {_ffmpeg_dir.exists()}")
logger.info(f"ffmpeg binary exists: {_ffmpeg_bin.exists()}")
if _ffmpeg_bin.exists():
    try:
        result = subprocess.run([str(_ffmpeg_bin), "-version"], capture_output=True, text=True, timeout=5)
        logger.info(f"ffmpeg executable: {result.returncode == 0}")
        if result.returncode != 0:
            logger.error(f"ffmpeg stderr: {result.stderr[:200]}")
    except Exception as e:
        logger.error(f"ffmpeg execution test failed: {e}")


def _seed_bundled_models():
    """Copy bundled model files to user's torch cache for instant availability.

    This allows users to start splitting immediately after install without
    waiting for model downloads.
    """
    bundled_models_dir = BASE_DIR.parent / "python_runtime_bundle" / "models"
    if not bundled_models_dir.exists():
        return

    # Get user's torch cache directory
    cache_home = os.environ.get("TORCH_HOME") or os.environ.get("XDG_CACHE_HOME")
    if cache_home:
        user_cache = Path(cache_home) / "torch" / "hub" / "checkpoints"
    else:
        user_cache = Path.home() / ".cache" / "torch" / "hub" / "checkpoints"

    user_cache.mkdir(parents=True, exist_ok=True)

    # Copy any bundled model files that don't already exist in user cache
    for model_file in bundled_models_dir.glob("*.th"):
        dest = user_cache / model_file.name
        if not dest.exists():
            try:
                shutil.copy2(model_file, dest)
                logger.info(f"Seeded bundled model: {model_file.name}")
            except Exception as e:
                logger.warning(f"Failed to seed model {model_file.name}: {e}")


# Seed bundled models on startup
_seed_bundled_models()

# Initialize configuration
config = Config(CONFIG_PATH)
app_state.set_config(config.as_dict())

# Initialize yt-dlp updater (uses same directory as config for state)
init_updater(BASE_DIR)

# Load ytdl helpers
import importlib.util
_spec = importlib.util.spec_from_file_location(
    "ytdl_interactive_mod", str(BASE_DIR / "ytdl_interactive.py")
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)

extract_video_id = getattr(_mod, "extract_video_id")
get_video_info = getattr(_mod, "get_video_info")
get_related_videos = getattr(_mod, "get_related_videos")
search_youtube = getattr(_mod, "search_youtube")

# Semaphore to limit parallel Demucs operations (resource-intensive)
split_semaphore = threading.Semaphore(1)


# =============================================================================
# Demucs Integration
# =============================================================================

def parse_demucs_progress(line: str) -> Tuple[Optional[float], Optional[int]]:
    """
    Parse Demucs tqdm line for progress and ETA.

    Returns:
        Tuple of (progress 0..0.99, eta_seconds or None)
    """
    try:
        s = line.strip()
        prog = None

        # Try percentage prefix like "61%|..."
        m = re.match(r"\s*(\d+)%", s)
        if m:
            pct = int(m.group(1))
            prog = min(0.99, max(0.0, pct / 100.0))
        else:
            # Try fraction format like "146.25/239.85"
            m2 = re.search(r"(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)", s)
            if m2:
                cur = float(m2.group(1))
                tot = float(m2.group(2))
                if tot > 0:
                    prog = min(0.99, max(0.0, cur / tot))

        # Extract remaining time from "[elapsed<remaining,"
        eta_sec = None
        m3 = re.search(r"\[(?:[0-9:]+)\s*<\s*([0-9:]+)\s*,", s)
        if m3:
            eta_sec = _parse_time_to_seconds(m3.group(1))

        return prog, eta_sec
    except Exception:
        return None, None


def _parse_time_to_seconds(ts: str) -> Optional[int]:
    """Parse HH:MM:SS or MM:SS to seconds."""
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


def run_demucs_separation(
    audio_file: Path,
    output_dir: Path,
    item: QueueItem,
    model: Optional[str] = None,
    stem_mode: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Path]], Optional[str]]:
    """
    Run Demucs separation with configurable model and stem mode.

    Args:
        audio_file: Path to input audio file
        output_dir: Directory for Demucs output
        item: QueueItem for progress tracking
        model: Demucs model name (defaults to config setting)
        stem_mode: "2", "4", or "6" stem separation (defaults to config setting)

    Returns:
        Tuple of (dict mapping stem names to paths, error_message_if_any)
    """
    python_exe = sys.executable
    env = os.environ.copy()

    # Get model and stem mode from config if not specified
    if model is None:
        model = app_state.get_config_value("demucs_model", DEFAULT_DEMUCS_MODEL)
    if stem_mode is None:
        stem_mode = item.stem_mode or app_state.get_config_value("stem_mode", DEFAULT_STEM_MODE)

    # Validate model and stem_mode
    if model not in DEMUCS_MODELS:
        model = DEFAULT_DEMUCS_MODEL
    if stem_mode not in STEM_MODES:
        stem_mode = DEFAULT_STEM_MODE

    # 6-stem mode requires htdemucs_6s
    stem_config = STEM_MODES[stem_mode]
    if stem_config.get("requires_model"):
        model = stem_config["requires_model"]

    logger.info(f"Demucs separation: model={model}, stem_mode={stem_mode}")

    # Add ffmpeg to path if bundled
    ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")
        env["FFMPEG_LOCATION"] = str(ffmpeg_dir)

    try:
        # Check if demucs is available
        chk = subprocess.run(
            [python_exe, "-m", "demucs", "--help"],
            capture_output=True, text=True, env=env
        )
        if chk.returncode != 0:
            logger.info("Installing demucs (this may take several minutes)...")
            subprocess.run(
                [python_exe, "-m", "pip", "install", "--upgrade", "demucs"],
                check=True
            )

        output_dir.mkdir(parents=True, exist_ok=True)

        # Build command
        cmd = [
            python_exe, "-m", "demucs.separate",
            "-n", model,
            "--mp3",
            "-o", str(output_dir),
        ]

        # Add two-stems flag for 2-stem mode
        if stem_mode == "2":
            cmd.extend(["--two-stems", "vocals"])

        cmd.append(str(audio_file))
        logger.debug(f"Running: {' '.join(cmd)}")

        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            bufsize=1,
            universal_newlines=True
        )

        last_progress = 0.0
        error_lines = []

        for line in iter(proc.stdout.readline, ''):
            if not line:
                break
            line = line.strip()
            if line:
                logger.debug(f"[DEMUCS] {line}")
                error_lines.append(line)

                # Update progress
                prog, eta_sec = parse_demucs_progress(line)
                if prog is not None and prog > last_progress:
                    last_progress = prog
                    with app_state.lock:
                        item.progress = prog
                        item.processing = True
                        item.downloaded = True
                        if eta_sec is not None:
                            item.processing_eta_sec = int(eta_sec)

        proc.wait()

        if proc.returncode != 0:
            error_msg = '\n'.join(error_lines[-5:]) if error_lines else "demucs failed"
            return None, error_msg[:300]

        # Find output files based on stem mode
        stems = _find_demucs_outputs(output_dir, stem_mode, model)
        if stems:
            return stems, None
        return None, "demucs outputs not found"

    except Exception as e:
        return None, str(e)[:300]


def _find_demucs_outputs(output_dir: Path, stem_mode: str, model: str) -> Optional[Dict[str, Path]]:
    """
    Find Demucs output files based on stem mode.

    Returns:
        Dict mapping stem type to file path, or None if outputs not found
    """
    stem_config = STEM_MODES.get(stem_mode, STEM_MODES[DEFAULT_STEM_MODE])
    expected_stems = stem_config["stems"]

    # Demucs outputs to: output_dir/model_name/track_name/stem.mp3
    # We need to find the model output directory
    results = {}

    for ext in ["mp3", "wav"]:
        # Search for the first expected stem to locate the output directory
        first_stem = expected_stems[0]  # Usually "vocals"
        for stem_file in output_dir.rglob(f"{first_stem}.{ext}"):
            stem_dir = stem_file.parent

            # Check if all expected stems exist in this directory
            all_found = True
            for stem_name in expected_stems:
                stem_path = stem_dir / f"{stem_name}.{ext}"
                if stem_path.exists():
                    results[stem_name] = stem_path
                else:
                    all_found = False
                    break

            if all_found:
                return results
            else:
                results = {}

    # For 2-stem mode, also check for "no_vocals" or "accompaniment"
    if stem_mode == "2":
        for ext in ["mp3", "wav"]:
            for vocals_file in output_dir.rglob(f"vocals.{ext}"):
                stem_dir = vocals_file.parent
                results["vocals"] = vocals_file

                # Check for accompaniment variants
                for accomp_name in ["no_vocals", "accompaniment", "other"]:
                    accomp_path = stem_dir / f"{accomp_name}.{ext}"
                    if accomp_path.exists():
                        results["no_vocals"] = accomp_path
                        return results

    return None if not results else results


# =============================================================================
# Queue Worker
# =============================================================================

def _sanitize_name(name: str, max_length: int = 120) -> str:
    """Sanitize a string for use as a filename."""
    s = re.sub(r'[<>:"/\\|?*]', "_", name or "").strip().strip(".")
    return re.sub(r"\s+", " ", s).strip()[:max_length] or "untitled"


def _parse_artist_song(title: Optional[str], channel: Optional[str]) -> Tuple[Optional[str], str]:
    """Parse artist and song from title string."""
    base = (title or "").strip()
    if not base:
        return (channel or None), "untitled"

    m = re.match(r"\s*([^\-–—]+)\s*[\-–—]\s*(.+)", base)
    if m:
        artist = _sanitize_name(m.group(1).strip())
        song = _sanitize_name(m.group(2).strip())
        return (artist or (channel or None)), song

    return ((channel and _sanitize_name(channel)) or None, _sanitize_name(base))


def _split_and_stage(audio_file: Path, item: QueueItem) -> Tuple[bool, Optional[str], Optional[Path]]:
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
            out_root = Path(app_state.get_config_value("output_dir") or get_default_desktop_path())
        out_root.mkdir(parents=True, exist_ok=True)

        # Determine artist and song names
        if item.local_file:
            artist = _sanitize_name(item.channel) if item.channel else None
            song = _sanitize_name(item.title or "untitled")
            if not artist:
                artist, song = _parse_artist_song(item.title, None)
        else:
            artist, song = _parse_artist_song(item.title, item.channel)

        dest_dir_base = out_root / (artist if artist else "")

        # Temp directory for Demucs output
        tmp_root = Path(tempfile.gettempdir()) / "splitboy_stems"
        tmp_root.mkdir(parents=True, exist_ok=True)

        with app_state.lock:
            item.processing = True
            item.downloaded = True

        # Get stem mode for this item
        stem_mode = item.stem_mode or app_state.get_config_value("stem_mode", DEFAULT_STEM_MODE)
        stem_config = STEM_MODES.get(stem_mode, STEM_MODES[DEFAULT_STEM_MODE])

        # Run Demucs
        stems, err = run_demucs_separation(audio_file, tmp_root, item)

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
        safe_title = re.sub(r'[<>:"/\\|?*]', "_", (item.title or "download")).strip(". ")[:100]
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
            "postprocessors": [{
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": "192",
            }],
            "progress_hooks": [progress_hook],
            "noplaylist": True,
        }

        # Add ffmpeg location if bundled
        ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
        logger.info(f"yt-dlp ffmpeg_dir check: {ffmpeg_dir} exists={ffmpeg_dir.exists()}")
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

                # Launch new items up to max_concurrency
                can_launch = max(0, app_state.max_concurrency - app_state.active)
                queued_items = [it for it in app_state.get_queue_items() if it.status == "queued"]

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

                        t = threading.Thread(target=_process_item, args=(item,), daemon=True)
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


# =============================================================================
# FastAPI Application
# =============================================================================

app = FastAPI(title="SplitBoy API")

# CORS middleware
try:
    from fastapi.middleware.cors import CORSMiddleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
        allow_credentials=False,
    )
except Exception:
    pass

# Static files
if not PUBLIC_DIR.exists():
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def index():
    """Serve the frontend."""
    index_path = PUBLIC_DIR / "index.html"
    if index_path.exists():
        return index_path.read_text()
    return HTMLResponse("<html><body>Frontend not built yet.</body></html>")


@app.post("/api/_shutdown")
def api_shutdown():
    """Shutdown endpoint for Electron to terminate server cleanly."""
    def _do_exit():
        time.sleep(0.1)
        os._exit(0)
    threading.Thread(target=_do_exit, daemon=True).start()
    return {"shutting_down": True}


# -----------------------------------------------------------------------------
# Config Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/config")
def get_cfg():
    return app_state.get_config()


@app.post("/api/config")
async def set_cfg(req: Request):
    data = await req.json()
    allowed = {}
    if "output_dir" in data and isinstance(data["output_dir"], str):
        allowed["output_dir"] = data["output_dir"]
    if "default_folder" in data and isinstance(data["default_folder"], str):
        allowed["default_folder"] = data["default_folder"]
    if "demucs_model" in data and isinstance(data["demucs_model"], str):
        if data["demucs_model"] in DEMUCS_MODELS:
            allowed["demucs_model"] = data["demucs_model"]
    if "stem_mode" in data and isinstance(data["stem_mode"], str):
        if data["stem_mode"] in STEM_MODES:
            allowed["stem_mode"] = data["stem_mode"]
    if allowed:
        app_state.update_config(allowed)
        config.update(allowed)
    return app_state.get_config()


# -----------------------------------------------------------------------------
# Model Management Endpoints
# -----------------------------------------------------------------------------

def _get_demucs_cache_dir() -> Path:
    """Get the Demucs model cache directory (follows torch hub conventions)."""
    # Demucs uses torch.hub.load which caches to ~/.cache/torch/hub/checkpoints/
    cache_home = os.environ.get("TORCH_HOME") or os.environ.get("XDG_CACHE_HOME")
    if cache_home:
        return Path(cache_home) / "torch" / "hub" / "checkpoints"
    return Path.home() / ".cache" / "torch" / "hub" / "checkpoints"


def _get_demucs_remote_dir() -> Path:
    """Get the demucs remote config directory containing YAML model definitions."""
    try:
        import demucs
        return Path(demucs.__file__).parent / "remote"
    except ImportError:
        return Path("/nonexistent")


def _get_model_signatures(model_name: str) -> list[str]:
    """Get the model file signatures required for a given model name.

    Demucs models are defined in YAML files that reference signatures.
    These signatures map to files like '{sig}-{checksum}.th' in the cache.
    """
    remote_dir = _get_demucs_remote_dir()
    yaml_file = remote_dir / f"{model_name}.yaml"

    if not yaml_file.exists():
        return []

    try:
        import yaml
        with open(yaml_file) as f:
            data = yaml.safe_load(f)
        # YAML contains {"models": ["sig1", "sig2", ...]}
        return data.get("models", [])
    except Exception:
        return []


def _is_model_downloaded(model_name: str) -> bool:
    """Check if a Demucs model is fully downloaded.

    Demucs caches model files with hash-based names like '955717e8-8726e21a.th'.
    We need to check if all required signature files exist for the model.
    """
    cache_dir = _get_demucs_cache_dir()
    if not cache_dir.exists():
        return False

    # Get required signatures from the model's YAML config
    signatures = _get_model_signatures(model_name)
    if not signatures:
        return False

    # Check if all required signature files exist
    for sig in signatures:
        # Files are named like "{sig}-{checksum}.th"
        matches = list(cache_dir.glob(f"{sig}-*.th"))
        if not matches:
            return False

    return True


@app.get("/api/models")
def api_get_models():
    """Get available Demucs models with download status."""
    models = []
    current_model = app_state.get_config_value("demucs_model", DEFAULT_DEMUCS_MODEL)
    current_stem_mode = app_state.get_config_value("stem_mode", DEFAULT_STEM_MODE)

    for name, info in DEMUCS_MODELS.items():
        models.append({
            "name": name,
            "stems": info["stems"],
            "size_mb": info["size_mb"],
            "description": info["description"],
            "is_default": info.get("default", False),
            "is_selected": name == current_model,
            "downloaded": _is_model_downloaded(name),
        })

    stem_modes = []
    for mode_id, mode_info in STEM_MODES.items():
        stem_modes.append({
            "id": mode_id,
            "label": mode_info["label"],
            "description": mode_info["description"],
            "requires_model": mode_info.get("requires_model"),
            "is_selected": mode_id == current_stem_mode,
        })

    return {
        "models": models,
        "stem_modes": stem_modes,
        "current_model": current_model,
        "current_stem_mode": current_stem_mode,
    }


def _download_model_sync(model_name: str, python_exe: str, env: dict) -> dict:
    """Synchronous model download - runs in thread pool to avoid blocking."""
    import wave
    import struct

    tmp_audio = Path(tempfile.gettempdir()) / f"splitboy_model_download_{model_name}.wav"
    tmp_out = Path(tempfile.gettempdir()) / f"splitboy_model_download_out_{model_name}"
    tmp_out.mkdir(parents=True, exist_ok=True)

    try:
        # Create minimal WAV file (1 second of silence at 44.1kHz mono)
        with wave.open(str(tmp_audio), 'w') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(44100)
            wav.writeframes(struct.pack('<' + 'h' * 44100, *([0] * 44100)))

        # Run demucs to trigger model download
        cmd = [
            python_exe, "-m", "demucs.separate",
            "-n", model_name,
            "--mp3",
            "-o", str(tmp_out),
            str(tmp_audio)
        ]

        logger.info(f"Downloading model {model_name}...")
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=600)

        # Cleanup
        try:
            tmp_audio.unlink()
            shutil.rmtree(tmp_out, ignore_errors=True)
        except Exception:
            pass

        # Check if model files are now in cache
        if _is_model_downloaded(model_name):
            return {"success": True, "message": f"Model {model_name} downloaded successfully"}
        elif proc.returncode == 0:
            return {"success": True, "message": f"Model {model_name} downloaded successfully"}
        else:
            return {"success": False, "message": proc.stderr[-500:] if proc.stderr else "Download failed"}

    except subprocess.TimeoutExpired:
        if _is_model_downloaded(model_name):
            return {"success": True, "message": f"Model {model_name} downloaded successfully"}
        return {"success": False, "message": "Model download timed out (10 min limit)"}
    except Exception as e:
        if _is_model_downloaded(model_name):
            return {"success": True, "message": f"Model {model_name} downloaded successfully"}
        return {"success": False, "message": str(e)[:300]}


@app.post("/api/models/download")
async def api_download_model(req: Request):
    """Trigger download of a Demucs model by running a dummy separation."""
    import asyncio

    data = await req.json()
    model_name = data.get("model")

    if not model_name or model_name not in DEMUCS_MODELS:
        raise HTTPException(400, f"Invalid model: {model_name}")

    if _is_model_downloaded(model_name):
        return {"success": True, "message": f"Model {model_name} already downloaded"}

    python_exe = sys.executable
    env = os.environ.copy()

    ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")

    # Run in thread pool to avoid blocking the event loop
    result = await asyncio.to_thread(_download_model_sync, model_name, python_exe, env)
    return result


@app.delete("/api/models/{model_name}")
def api_delete_model(model_name: str):
    """Delete a downloaded model to free up space."""
    if model_name not in DEMUCS_MODELS:
        raise HTTPException(400, f"Invalid model: {model_name}")

    if model_name == DEFAULT_DEMUCS_MODEL:
        raise HTTPException(400, "Cannot delete the default model")

    cache_dir = _get_demucs_cache_dir()
    deleted = False

    # Get the signatures for this model and delete corresponding files
    signatures = _get_model_signatures(model_name)
    if cache_dir.exists() and signatures:
        for sig in signatures:
            for f in cache_dir.glob(f"{sig}-*.th"):
                try:
                    f.unlink()
                    deleted = True
                    logger.info(f"Deleted model file: {f}")
                except Exception as e:
                    logger.warning(f"Failed to delete {f}: {e}")

    if deleted:
        return {"success": True, "message": f"Model {model_name} deleted"}
    else:
        return {"success": False, "message": f"Model {model_name} files not found"}


# -----------------------------------------------------------------------------
# Search Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/search")
def api_search(q: str, max: int = 100, requestId: Optional[str] = None):
    if requestId:
        app_state.set_progress(requestId, "listing", message="Searching…")
    max = max if 1 <= max <= 500 else 100
    results = search_youtube(q, max_results=max)
    if requestId:
        app_state.update_progress(requestId, current=len(results), total=len(results),
                                   message=f"Found {len(results)} results")
        app_state.finish_progress(requestId)
    return {"items": results}


@app.get("/api/related")
def api_related(id: str, max: int = 50, requestId: Optional[str] = None):
    if requestId:
        app_state.set_progress(requestId, "listing", message="Fetching related…")
    max = max if 1 <= max <= 100 else 50
    results = get_related_videos(id, max_results=max)
    if requestId:
        app_state.update_progress(requestId, current=len(results), total=len(results),
                                   message=f"Found {len(results)} related")
        app_state.finish_progress(requestId)
    return {"items": results}


@app.get("/api/video-info")
def api_video_info(url: str):
    info = get_video_info(url)
    if not info:
        raise HTTPException(404, "Video info not found")
    return info


@app.get("/api/playlist")
def api_playlist(url: str, max: Optional[int] = None, requestId: Optional[str] = None):
    """Fetch playlist entries."""
    limit = min(max or PLAYLIST_HARD_CAP, PLAYLIST_HARD_CAP)

    if requestId:
        app_state.set_progress(requestId, "listing", message="Listing playlist…")

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
        if requestId:
            app_state.finish_progress(requestId, error=str(e))
        return JSONResponse({"error": str(e)}, status_code=400)


@app.get("/api/channel")
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
        app_state.set_progress(requestId, "listing", message="Listing channel…")

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
        if requestId:
            app_state.finish_progress(requestId, error=str(e))
        return JSONResponse({"error": str(e)}, status_code=400)


# -----------------------------------------------------------------------------
# Queue Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/queue")
def api_get_queue():
    return {"running": app_state.running, "items": app_state.get_queue()}


@app.post("/api/queue")
async def api_add_queue(req: Request):
    data = await req.json()
    urls = data.get("urls") or []
    folder = data.get("folder")
    stem_mode = data.get("stem_mode")  # Optional per-job stem mode

    if not isinstance(urls, list) or not urls:
        raise HTTPException(400, "urls must be a non-empty array")

    # Validate stem_mode if provided
    if stem_mode and stem_mode not in STEM_MODES:
        stem_mode = None

    added = []
    default_folder = app_state.get_config_value("default_folder", "")

    for url in urls:
        item = QueueItem(
            id=str(uuid.uuid4()),
            url=url,
            folder=folder or default_folder,
            stem_mode=stem_mode,
        )
        app_state.add_to_queue(item)
        added.append(item.to_dict())

    return {"added": added}


@app.post("/api/queue-local")
async def api_add_queue_local(req: Request):
    """Add local audio files to the queue."""
    data = await req.json()
    files = data.get("files") or []
    folder = data.get("folder")
    stem_mode = data.get("stem_mode")  # Optional per-job stem mode

    if not isinstance(files, list) or not files:
        raise HTTPException(400, "files must be a non-empty array")

    # Validate stem_mode if provided
    if stem_mode and stem_mode not in STEM_MODES:
        stem_mode = None

    added = []
    default_folder = app_state.get_config_value("default_folder", "")

    for file_path in files:
        if not os.path.exists(file_path):
            continue

        item = QueueItem(
            id=str(uuid.uuid4()),
            url=f"file://{file_path}",
            title=get_title_from_path(file_path),
            folder=folder or default_folder,
            local_file=True,
            local_path=file_path,
            stem_mode=stem_mode,
        )
        app_state.add_to_queue(item)
        added.append(item.to_dict())

    return {"added": added}


@app.post("/api/start")
def api_start():
    if app_state.running:
        return {"started": False, "message": "Already running"}

    t = threading.Thread(target=download_worker, daemon=True)
    app_state.worker_thread = t
    app_state.running = True
    app_state.active = 0
    t.start()
    return {"started": True}


@app.post("/api/stop")
def api_stop():
    """Stop queue processing."""
    app_state.stop_event.set()

    # Cancel queued items
    for item in app_state.get_queue_items():
        if item.status == "queued":
            item.status = "canceled"

    # Terminate active processes
    for proc in app_state.get_active_processes():
        try:
            proc.terminate()
        except Exception:
            pass

    return {"stopping": True}


@app.post("/api/clear")
def api_clear():
    """Clear the queue."""
    if app_state.running:
        app_state.clear_queue(running_only=True)
    else:
        app_state.clear_queue()
    return {"cleared": True}


@app.post("/api/cancel/{item_id}")
def api_cancel(item_id: str):
    item = app_state.get_queue_item(item_id)
    if not item:
        raise HTTPException(404, "Item not found")

    if item.status == "queued":
        item.status = "canceled"
        return {"canceled": True}
    return {"canceled": False, "message": "Only queued items can be canceled"}


@app.get("/api/progress")
def api_progress():
    out = app_state.global_progress()
    out["concurrency"] = {
        "active": app_state.active,
        "max": app_state.max_concurrency
    }
    return out


@app.get("/api/listing-progress/{request_id}")
def api_listing_progress(request_id: str):
    return app_state.get_progress(request_id)


# -----------------------------------------------------------------------------
# Concurrency Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/concurrency")
def api_get_concurrency():
    return {"active": app_state.active, "max": app_state.max_concurrency}


@app.post("/api/concurrency")
async def api_set_concurrency(req: Request):
    data = await req.json()
    if "max" not in data:
        raise HTTPException(400, "Body must contain 'max'")

    try:
        new_max = int(data["max"])
    except Exception:
        raise HTTPException(400, "'max' must be an integer")

    new_max = max(1, min(64, new_max))
    app_state.max_concurrency = new_max
    app_state.update_config({"max_concurrency": new_max})
    config.update({"max_concurrency": new_max})

    return {"active": app_state.active, "max": new_max, "serverMax": 64}


# -----------------------------------------------------------------------------
# Utility Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/scan-directory")
async def api_scan_directory(path: str):
    """Scan a directory for audio files."""
    if not path or not os.path.exists(path) or not os.path.isdir(path):
        raise HTTPException(400, "Invalid directory path")

    audio_extensions = {'.mp3', '.wav', '.flac', '.aac', '.m4a', '.ogg', '.wma', '.opus'}
    files = []

    try:
        for root, dirs, filenames in os.walk(path):
            for filename in filenames:
                ext = os.path.splitext(filename)[1].lower()
                if ext in audio_extensions:
                    files.append({
                        "name": filename,
                        "path": os.path.join(root, filename)
                    })
    except Exception as e:
        raise HTTPException(500, f"Error scanning directory: {str(e)}")

    return {"files": files}


@app.get("/api/check-exists")
def api_check_exists(title: str, folder: str = ""):
    """Check for existing files with similar names."""
    try:
        base = Path(app_state.get_config_value("output_dir") or get_default_desktop_path())
    except Exception:
        base = Path(get_default_desktop_path())

    safe_title = re.sub(r'[<>:"/\\|?*]', "_", (title or "").strip()).strip(". ")
    needle = safe_title.lower()
    matches = []

    try:
        for p in base.rglob("*.wav"):
            parts = {s.lower() for s in p.parts}
            if not (("vocals" in parts) or ("instrumental" in parts)):
                continue
            if needle and needle in p.stem.lower():
                matches.append({"type": "similar_file", "name": p.name, "similarity": "partial"})
                if len(matches) >= 5:
                    break
    except Exception:
        pass

    return {"matches": matches}


# -----------------------------------------------------------------------------
# yt-dlp Update Endpoints
# -----------------------------------------------------------------------------

@app.get("/api/ytdlp/status")
def api_ytdlp_status():
    """Get yt-dlp version and update status."""
    status = get_update_status()
    # Refresh current version if not set
    if not status.get("current_version"):
        status["current_version"] = get_current_version()
    return status


@app.post("/api/ytdlp/update")
def api_ytdlp_update():
    """Manually trigger yt-dlp update."""
    result = update_ytdlp(force=True)
    return result


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("SPLITBOY_HOST", DEFAULT_HOST)
    try:
        port = int(os.environ.get("SPLITBOY_PORT", str(DEFAULT_PORT)))
    except Exception:
        port = DEFAULT_PORT

    # Start background yt-dlp update check (non-blocking)
    check_and_update_on_startup()

    log_level = os.environ.get("SPLITBOY_LOG_LEVEL", "info")
    uvicorn.run(app, host=host, port=port, log_level=log_level, access_log=False)
