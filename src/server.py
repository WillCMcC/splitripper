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
- Routes organized in routes/ package
- Services in services/ package
- State managed via lib/state.py singleton
"""

import os
import shutil
import subprocess
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

# Local imports
from lib.constants import DEFAULT_HOST, DEFAULT_PORT
from lib.config import Config
from lib.logging_config import get_logger
from lib.state import app_state
from lib.ytdlp_updater import init_updater, check_and_update_on_startup

# Import routers
from routes.config import router as config_router
from routes.models import router as models_router
from routes.search import router as search_router
from routes.queue import router as queue_router, set_download_worker
from routes.utils import router as utils_router
from routes.ytdlp import router as ytdlp_router

# Import worker
from services.worker import download_worker

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

# Set the download worker function for the queue router
set_download_worker(download_worker)


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


# Include all routers with /api prefix
app.include_router(config_router, prefix="/api")
app.include_router(models_router, prefix="/api")
app.include_router(search_router, prefix="/api")
app.include_router(queue_router, prefix="/api")
app.include_router(utils_router, prefix="/api")
app.include_router(ytdlp_router, prefix="/api")


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
