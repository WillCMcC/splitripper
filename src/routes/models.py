"""
Model management endpoints for SplitBoy API.

Handles Demucs model listing, downloading, and deletion.
"""

import asyncio
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path
from typing import List

from fastapi import APIRouter, HTTPException

from lib.constants import (
    DEMUCS_MODELS,
    DEFAULT_DEMUCS_MODEL,
    STEM_MODES,
    DEFAULT_STEM_MODE,
)
from lib.logging_config import get_logger
from lib.models import ModelDownloadRequest
from lib.state import app_state

router = APIRouter()
logger = get_logger("routes.models")

BASE_DIR = Path(__file__).parent.parent.resolve()


def _get_demucs_cache_dir() -> Path:
    """Get the Demucs model cache directory (follows torch hub conventions)."""
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


def _get_model_signatures(model_name: str) -> List[str]:
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


# Known model signatures (fallback when demucs YAML files are inaccessible)
# These are the signature prefixes from demucs model definitions
# Source: demucs/remote/*.yaml files
KNOWN_MODEL_SIGNATURES = {
    "htdemucs": ["955717e8"],
    "htdemucs_ft": ["f7e0c4bc", "d12395a8", "92cfc3b6", "04573f0d"],
    "htdemucs_6s": ["5c90dfd2"],
    "mdx": ["0d19c1c6", "7ecf8ec1", "c511e2ab", "7d865c68"],
    "mdx_extra": ["e51eebcc", "a1d90b5c", "5d2d6c55", "cfa93e08"],
    "mdx_q": ["6b9c2ca1", "b72baf4e", "42e558d4", "305bc58f"],
    "mdx_extra_q": ["83fc094f", "464b36d7", "14fc6a69", "7fd6ef75"],
}


def _is_model_downloaded(model_name: str) -> bool:
    """Check if a Demucs model is fully downloaded.

    Demucs caches model files with hash-based names like '955717e8-8726e21a.th'.
    We need to check if all required signature files exist for the model.
    """
    cache_dir = _get_demucs_cache_dir()
    if not cache_dir.exists():
        logger.debug(f"Cache dir does not exist: {cache_dir}")
        return False

    # Get required signatures from the model's YAML config
    signatures = _get_model_signatures(model_name)
    
    if not signatures:
        # Fallback: use known signatures if demucs YAML files are inaccessible
        signatures = KNOWN_MODEL_SIGNATURES.get(model_name, [])
        if signatures:
            logger.debug(f"Using fallback signatures for {model_name}: {signatures}")
        else:
            logger.debug(f"No signatures found for {model_name}")
            return False

    # Check if all required signature files exist
    for sig in signatures:
        # Files are named like "{sig}-{checksum}.th"
        matches = list(cache_dir.glob(f"{sig}-*.th"))
        if not matches:
            logger.debug(f"Model {model_name}: signature {sig} not found in cache")
            return False

    logger.debug(f"Model {model_name}: all {len(signatures)} signatures found")
    return True


@router.get("/models")
def api_get_models():
    """Get available Demucs models with download status."""
    models = []
    current_model = app_state.get_config_value("demucs_model", DEFAULT_DEMUCS_MODEL)
    current_stem_mode = app_state.get_config_value("stem_mode", DEFAULT_STEM_MODE)

    for name, info in DEMUCS_MODELS.items():
        models.append(
            {
                "name": name,
                "stems": info["stems"],
                "size_mb": info["size_mb"],
                "description": info["description"],
                "is_default": info.get("default", False),
                "is_selected": name == current_model,
                "downloaded": _is_model_downloaded(name),
            }
        )

    stem_modes = []
    for mode_id, mode_info in STEM_MODES.items():
        stem_modes.append(
            {
                "id": mode_id,
                "label": mode_info["label"],
                "description": mode_info["description"],
                "requires_model": mode_info.get("requires_model"),
                "is_selected": mode_id == current_stem_mode,
            }
        )

    return {
        "models": models,
        "stem_modes": stem_modes,
        "current_model": current_model,
        "current_stem_mode": current_stem_mode,
    }


def _download_model_sync(model_name: str, python_exe: str, env: dict) -> dict:
    """Synchronous model download - runs in thread pool to avoid blocking."""
    tmp_audio = (
        Path(tempfile.gettempdir()) / f"splitboy_model_download_{model_name}.wav"
    )
    tmp_out = Path(tempfile.gettempdir()) / f"splitboy_model_download_out_{model_name}"
    tmp_out.mkdir(parents=True, exist_ok=True)

    try:
        # Create minimal WAV file (1 second of silence at 44.1kHz mono)
        with wave.open(str(tmp_audio), "w") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(44100)
            wav.writeframes(struct.pack("<" + "h" * 44100, *([0] * 44100)))

        # Run demucs to trigger model download
        cmd = [
            python_exe,
            "-m",
            "demucs.separate",
            "-n",
            model_name,
            "--mp3",
            "-o",
            str(tmp_out),
            str(tmp_audio),
        ]

        logger.info(f"Downloading model {model_name}...")
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env)

        # Cleanup
        try:
            tmp_audio.unlink()
            shutil.rmtree(tmp_out, ignore_errors=True)
        except Exception:
            pass

        # Check if model files are now in cache
        if _is_model_downloaded(model_name):
            return {
                "success": True,
                "message": f"Model {model_name} downloaded successfully",
            }
        elif proc.returncode == 0:
            return {
                "success": True,
                "message": f"Model {model_name} downloaded successfully",
            }
        else:
            return {
                "success": False,
                "message": proc.stderr[-500:] if proc.stderr else "Download failed",
            }

    except subprocess.TimeoutExpired:
        if _is_model_downloaded(model_name):
            return {
                "success": True,
                "message": f"Model {model_name} downloaded successfully",
            }
        return {"success": False, "message": "Model download timed out (10 min limit)"}
    except Exception as e:
        if _is_model_downloaded(model_name):
            return {
                "success": True,
                "message": f"Model {model_name} downloaded successfully",
            }
        return {"success": False, "message": str(e)[:300]}


@router.post("/models/download")
async def api_download_model(req: ModelDownloadRequest):
    """Trigger download of a Demucs model by running a dummy separation."""
    model_name = req.model

    if _is_model_downloaded(model_name):
        logger.info(f"Model {model_name} already downloaded")
        return {"success": True, "message": f"Model {model_name} already downloaded"}

    python_exe = sys.executable
    env = os.environ.copy()

    ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")

    # Run in thread pool to avoid blocking the event loop
    result = await asyncio.to_thread(_download_model_sync, model_name, python_exe, env)
    if result.get("success"):
        logger.info(f"Model {model_name} downloaded successfully")
    else:
        logger.error(f"Failed to download model {model_name}: {result.get('message')}")
    return result


@router.delete("/models/{model_name}")
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
