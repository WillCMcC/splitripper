"""
Demucs integration service for SplitBoy.

Handles audio separation using Demucs with progress tracking.
"""

import os
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

from lib.constants import (
    DEMUCS_MODELS,
    DEFAULT_DEMUCS_MODEL,
    DEFAULT_QUALITY_PRESET,
    QUALITY_PRESETS,
    STEM_MODES,
    DEFAULT_STEM_MODE,
)
from lib.logging_config import get_logger
from lib.state import app_state, QueueItem
from lib.utils import parse_time_to_seconds

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
            eta_sec = parse_time_to_seconds(m3.group(1))

        return prog, eta_sec
    except Exception:
        return None, None


class MultiPassProgressTracker:
    """
    Track progress across multiple Demucs passes (when using --shifts).

    With --shifts N, Demucs runs N separate passes, each showing its own
    0-100% progress bar. This class detects pass boundaries and calculates
    overall progress as: (completed_passes + current_pass_progress) / total_passes
    """

    def __init__(self, num_passes: int):
        self.num_passes = max(1, num_passes)
        self.completed_passes = 0
        self.current_pass_progress = 0.0
        self.last_raw_progress = 0.0
        self.seen_high_progress = False  # Have we seen progress > 50% in current pass?

    def update(self, raw_progress: float) -> float:
        """
        Update with raw progress from a single pass and return overall progress.

        Detects pass boundaries by watching for progress to reset from high to low.
        """
        if raw_progress is None:
            return self.get_overall_progress()

        # Detect pass boundary: progress drops significantly after reaching high values
        if self.seen_high_progress and raw_progress < 0.2 and self.last_raw_progress > 0.8:
            self.completed_passes = min(self.completed_passes + 1, self.num_passes - 1)
            self.seen_high_progress = False
            logger.debug(f"Detected pass boundary, now on pass {self.completed_passes + 1}/{self.num_passes}")

        # Track if we've seen high progress in this pass
        if raw_progress > 0.5:
            self.seen_high_progress = True

        self.current_pass_progress = raw_progress
        self.last_raw_progress = raw_progress

        return self.get_overall_progress()

    def get_overall_progress(self) -> float:
        """Calculate overall progress across all passes."""
        if self.num_passes <= 1:
            return min(0.99, self.current_pass_progress)

        overall = (self.completed_passes + self.current_pass_progress) / self.num_passes
        return min(0.99, overall)


def run_demucs_separation(
    audio_file: Path,
    output_dir: Path,
    item: QueueItem,
    model: Optional[str] = None,
    stem_mode: Optional[str] = None,
    quality_preset: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Path]], Optional[str]]:
    """
    Run Demucs separation with configurable model, stem mode, and quality.

    Args:
        audio_file: Path to input audio file
        output_dir: Directory for Demucs output
        item: QueueItem for progress tracking
        model: Demucs model name (defaults to config setting)
        stem_mode: "2", "4", or "6" stem separation (defaults to config setting)
        quality_preset: "normal" or "high" (defaults to config setting)

    Returns:
        Tuple of (dict mapping stem names to paths, error_message_if_any)
    """
    python_exe = sys.executable
    env = os.environ.copy()

    # Set Python unbuffered mode for real-time output
    env["PYTHONUNBUFFERED"] = "1"

    # Limit PyTorch threads to prevent CPU oversubscription and reduce memory pressure
    env["OMP_NUM_THREADS"] = "4"
    env["MKL_NUM_THREADS"] = "4"

    # Get model, stem mode, and quality preset from config if not specified
    if model is None:
        model = app_state.get_config_value("demucs_model", DEFAULT_DEMUCS_MODEL)
    if stem_mode is None:
        stem_mode = item.stem_mode or app_state.get_config_value(
            "stem_mode", DEFAULT_STEM_MODE
        )
    if quality_preset is None:
        quality_preset = app_state.get_config_value(
            "quality_preset", DEFAULT_QUALITY_PRESET
        )

    # Validate model, stem_mode, and quality_preset
    if model not in DEMUCS_MODELS:
        model = DEFAULT_DEMUCS_MODEL
    if stem_mode not in STEM_MODES:
        stem_mode = DEFAULT_STEM_MODE
    if quality_preset not in QUALITY_PRESETS:
        quality_preset = DEFAULT_QUALITY_PRESET

    # Get quality preset configuration
    preset_config = QUALITY_PRESETS[quality_preset]

    # 6-stem mode requires htdemucs_6s
    stem_config = STEM_MODES[stem_mode]
    if stem_config.get("requires_model"):
        model = stem_config["requires_model"]

    logger.info(
        f"Demucs separation: model={model}, stem_mode={stem_mode}, "
        f"quality={quality_preset} (shifts={preset_config['shifts']}, overlap={preset_config['overlap']})"
    )

    # Add ffmpeg to path if bundled
    ffmpeg_dir = BASE_DIR.parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")
        env["FFMPEG_LOCATION"] = str(ffmpeg_dir)

    try:
        # Check if demucs is available
        chk = subprocess.run(
            [python_exe, "-m", "demucs", "--help"],
            capture_output=True,
            text=True,
            env=env,
        )
        if chk.returncode != 0:
            logger.info("Installing demucs (this may take several minutes)...")
            subprocess.run(
                [python_exe, "-m", "pip", "install", "--upgrade", "demucs"], check=True
            )

        output_dir.mkdir(parents=True, exist_ok=True)

        # Build command
        cmd = [
            python_exe,
            "-m",
            "demucs.separate",
            "-n",
            model,
            "--mp3",
            "-o",
            str(output_dir),
        ]

        # Add segment size for non-transformer models (mdx variants)
        # Transformer models (htdemucs*) have a max segment of 7.8s and use their own default
        if model.startswith("mdx"):
            cmd.extend(
                ["--segment", "10"]
            )  # Process in 10-second chunks to reduce memory

        # Add quality preset flags (--shifts and --overlap)
        if preset_config["shifts"] > 0:
            cmd.extend(["--shifts", str(preset_config["shifts"])])
        cmd.extend(["--overlap", str(preset_config["overlap"])])

        # Add two-stems flag for 2-stem mode
        if stem_mode == "2":
            cmd.extend(["--two-stems", "vocals"])

        cmd.append(str(audio_file))
        logger.debug(f"Running: {' '.join(cmd)}")

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.DEVNULL,  # CRITICAL: Prevent blocking on stdin
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=env,
            bufsize=1,
            close_fds=True,  # Prevent child processes from inheriting pipe FDs
            start_new_session=True,  # Isolate from parent process signals (macOS/Linux)
        )

        # Register process for cleanup on stop
        app_state.register_process(item.id, proc)

        # Create multi-pass progress tracker for HD mode
        # With --shifts N, Demucs runs N separate passes
        num_passes = preset_config["shifts"] if preset_config["shifts"] > 0 else 1
        progress_tracker = MultiPassProgressTracker(num_passes)

        last_progress = 0.0
        output_lines = []

        # Use a thread to read stdout - this prevents blocking issues on macOS
        # when the subprocess finishes but we're waiting on readline()
        output_queue = queue.Queue()

        def reader_thread():
            """Read lines from stdout and put them in a queue."""
            try:
                for line in proc.stdout:
                    output_queue.put(line)
            except Exception as e:
                logger.warning(f"Reader thread exception: {e}")
            finally:
                output_queue.put(None)  # Signal end of output

        reader = threading.Thread(target=reader_thread, daemon=True)
        reader.start()

        # Process output from the queue while waiting for completion
        # Key insight: don't rely solely on reader thread EOF - check poll() actively
        process_finished = False
        finish_time = None
        start_time = time.time()
        last_status_log = start_time
        DRAIN_TIMEOUT = 3.0  # Seconds to drain queue after process exits
        STATUS_LOG_INTERVAL = 30.0  # Log status every 30 seconds

        while True:
            # Periodic status log for debugging hangs
            now = time.time()
            if now - last_status_log > STATUS_LOG_INTERVAL:
                logger.info(
                    f"Demucs loop status: elapsed={now - start_time:.1f}s, "
                    f"process_finished={process_finished}, poll={proc.poll()}, "
                    f"progress={last_progress:.2f}, queue_size={output_queue.qsize()}"
                )
                last_status_log = now

            # Check for stop event (user cancelled)
            if app_state.stop_event.is_set():
                logger.info("Stop event detected, killing Demucs process")
                proc.kill()
                proc.wait()
                app_state.unregister_process(item.id)
                return None, "Cancelled by user"

            # Actively check if process has finished (don't wait for reader EOF)
            if not process_finished:
                poll_result = proc.poll()
                if poll_result is not None:
                    process_finished = True
                    finish_time = time.time()
                    logger.info(f"Demucs process exited with code {poll_result}")

            # If process finished, enforce drain timeout
            if process_finished and (time.time() - finish_time) > DRAIN_TIMEOUT:
                logger.info("Drain timeout reached, proceeding to completion")
                break

            try:
                line = output_queue.get(timeout=0.5)
                if line is None:
                    # Reader thread finished (EOF)
                    logger.info("Reader thread signaled EOF")
                    break
                line = line.strip()
                if line:
                    logger.debug(f"[DEMUCS] {line}")
                    output_lines.append(line)

                    # Update progress
                    raw_prog, eta_sec = parse_demucs_progress(line)
                    if raw_prog is not None:
                        # Use multi-pass tracker to calculate overall progress
                        overall_prog = progress_tracker.update(raw_prog)
                        if overall_prog > last_progress:
                            last_progress = overall_prog
                            with app_state.lock:
                                item.progress = overall_prog
                                item.processing = True
                                item.downloaded = True
                                if eta_sec is not None:
                                    # Scale ETA by remaining passes
                                    remaining_passes = num_passes - progress_tracker.completed_passes
                                    item.processing_eta_sec = int(eta_sec * remaining_passes)
            except queue.Empty:
                # No output available - loop will check poll() on next iteration
                pass

        # Close stdout first to unblock reader thread
        logger.info("Closing stdout pipe...")
        if proc.stdout and not proc.stdout.closed:
            proc.stdout.close()

        # Wait for reader thread to finish (should be quick now that stdout is closed)
        logger.info("Waiting for reader thread to finish...")
        reader.join(timeout=2.0)
        if reader.is_alive():
            logger.warning("Reader thread still alive after join timeout")

        # Now wait for process (should already be done)
        logger.info(f"Waiting for process to finish (poll={proc.poll()})...")
        proc.wait()

        # Unregister process from cleanup list
        app_state.unregister_process(item.id)

        logger.info(f"Demucs process finished with return code: {proc.returncode}")

        if proc.returncode != 0:
            error_msg = "\n".join(output_lines[-5:]) if output_lines else "demucs failed"
            logger.error(f"Demucs failed: {error_msg}")
            return None, error_msg[:300]

        # Find output files based on stem mode
        logger.debug(
            f"Looking for outputs in {output_dir} for stem_mode={stem_mode}, model={model}"
        )
        stems = _find_demucs_outputs(output_dir, stem_mode, model)
        if stems:
            logger.info(f"Found {len(stems)} stem files: {list(stems.keys())}")
            return stems, None
        logger.error(f"No stems found in {output_dir}")
        return None, "demucs outputs not found"

    except Exception as e:
        # Ensure process is unregistered on any exception
        app_state.unregister_process(item.id)
        return None, str(e)[:300]


def _find_demucs_outputs(
    output_dir: Path, stem_mode: str, model: str
) -> Optional[Dict[str, Path]]:
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
