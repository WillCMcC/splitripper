"""
Config endpoints for SplitBoy API.

Handles reading and updating application configuration.
"""

from fastapi import APIRouter, Request

from lib.constants import DEMUCS_MODELS, STEM_MODES
from lib.state import app_state

router = APIRouter()


@router.get("/config")
def get_cfg():
    """Get current configuration."""
    return app_state.get_config()


@router.post("/config")
async def set_cfg(req: Request):
    """Update configuration settings."""
    # Import config here to avoid circular imports
    from lib.config import Config
    from pathlib import Path

    BASE_DIR = Path(__file__).parent.parent.resolve()
    CONFIG_PATH = BASE_DIR / "config.json"
    config = Config(CONFIG_PATH)

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
