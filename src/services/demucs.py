"""
Demucs integration service for SplitBoy.

Handles audio separation using Demucs with progress tracking.
"""

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Dict, Optional, Tuple

from lib.constants import DEMUCS_MODELS, DEFAULT_DEMUCS_MODEL, STEM_MODES, DEFAULT_STEM_MODE
from lib.logging_config import get_logger
from lib.state import app_state, QueueItem

logger = get_logger("services.demucs")

BASE_DIR = Path(__file__).parent.parent.resolve()


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
