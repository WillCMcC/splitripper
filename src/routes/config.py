"""
Config endpoints for SplitBoy API.

Handles reading and updating application configuration.
"""

from fastapi import APIRouter

from lib.logging_config import get_logger
from lib.models import ConfigUpdateRequest
from lib.state import app_state

router = APIRouter()
logger = get_logger("routes.config")


@router.get("/config")
def get_cfg():
    """Get current configuration."""
    return app_state.get_config()


@router.post("/config")
def set_cfg(req: ConfigUpdateRequest):
    """Update configuration settings."""
    # Import config here to avoid circular imports
    from lib.config import Config
    from pathlib import Path

    BASE_DIR = Path(__file__).parent.parent.resolve()
    CONFIG_PATH = BASE_DIR / "config.json"
    config = Config(CONFIG_PATH)

    # Get non-None values from validated request
    updates = req.model_dump(exclude_none=True)

    if updates:
        app_state.update_config(updates)
        config.update(updates)
        logger.info(f"Configuration updated: {list(updates.keys())}")

    return app_state.get_config()
