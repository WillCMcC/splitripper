"""
Audio separation using Demucs.

This module handles stem separation (vocals/instrumental) using the Demucs library.
"""

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple


def parse_time_to_seconds(ts: str) -> Optional[int]:
    """Parse a time string like HH:MM:SS or MM:SS to total seconds."""
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


def parse_demucs_progress(line: str) -> Tuple[Optional[float], Optional[int]]:
    """
    Parse Demucs tqdm line for (progress, eta_seconds).

    Examples:
        "61%|... [01:14<00:47,  1.96seconds/s]"
        "146.25/239.85 [01:14<00:47,  1.96seconds/s]"

    Returns:
        Tuple of (progress 0..0.99, eta_seconds or None)
    """
    try:
        s = line.strip()
        prog = None

        # Try percentage prefix
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

        # Try to extract remaining time inside brackets "elapsed<remaining,"
        eta_sec = None
        m3 = re.search(r"\[(?:[0-9:]+)\s*<\s*([0-9:]+)\s*,", s)
        if m3:
            eta_sec = parse_time_to_seconds(m3.group(1))

        return prog, eta_sec
    except Exception:
        return None, None


def run_demucs_separation(
    python_exe: str,
    audio_file: Path,
    output_dir: Path,
    env: Dict[str, str],
    progress_callback: Optional[callable] = None
) -> Tuple[Optional[Path], Optional[Path], Optional[str]]:
    """
    Run Demucs two-stem separation.

    Args:
        python_exe: Path to Python interpreter
        audio_file: Input audio file
        output_dir: Directory for Demucs output
        env: Environment variables
        progress_callback: Optional callback(progress: float, eta_sec: Optional[int])

    Returns:
        Tuple of (vocals_path, accompaniment_path, error_message_if_any)
    """
    try:
        # Ensure demucs is available
        chk = subprocess.run(
            [python_exe, "-m", "demucs", "--help"],
            capture_output=True,
            text=True,
            env=env
        )
        if chk.returncode != 0:
            print("[DEMUCS] Installing demucs (this may take several minutes)…")
            subprocess.run(
                [python_exe, "-m", "pip", "install", "--upgrade", "demucs"],
                check=True
            )

        output_dir.mkdir(parents=True, exist_ok=True)

        # Use --mp3 to avoid torchaudio save issues
        cmd = [
            python_exe, "-m", "demucs.separate",
            "--two-stems", "vocals",
            "--mp3",
            "-o", str(output_dir),
            str(audio_file)
        ]
        print("[DEMUCS][CMD]", " ".join(cmd))

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
        error_output = []
        has_torchaudio_error = False

        for line in iter(proc.stdout.readline, ''):
            if not line:
                break
            line = line.strip()
            if line:
                print(f"[DEMUCS] {line}")
                error_output.append(line)

                # Check for torchaudio save errors
                if "torchaudio" in line.lower() and ("save" in line.lower() or "encoding" in line.lower()):
                    has_torchaudio_error = True

                # Parse progress and call callback
                if progress_callback:
                    prog, eta_sec = parse_demucs_progress(line)
                    if prog is not None and prog > last_progress:
                        last_progress = prog
                        progress_callback(prog, eta_sec)

        proc.wait()

        if proc.returncode != 0:
            error_msg = '\n'.join(error_output[-5:]) if error_output else "demucs failed"
            if has_torchaudio_error:
                error_msg = "Audio processing completed but file save failed. This may be due to torchaudio compatibility issues."
            return None, None, error_msg[:300]

        # Find output files (try MP3 first, then WAV)
        vocals, accomp = _find_demucs_outputs(output_dir)
        if vocals and accomp:
            return vocals, accomp, None
        return None, None, "demucs outputs not found"

    except Exception as e:
        return None, None, str(e)[:300]


def _find_demucs_outputs(output_dir: Path) -> Tuple[Optional[Path], Optional[Path]]:
    """Find vocals and accompaniment files in Demucs output directory."""
    vocals = None
    accomp = None

    # Try MP3 format first (our --mp3 flag output)
    for p in output_dir.rglob("vocals.mp3"):
        vocals = p
        nv = p.parent / "no_vocals.mp3"
        if nv.exists():
            accomp = nv
        else:
            alt = p.parent / "accompaniment.mp3"
            if alt.exists():
                accomp = alt
        if vocals and accomp:
            return vocals, accomp

    # Fallback to WAV
    for p in output_dir.rglob("vocals.wav"):
        vocals = p
        nv = p.parent / "no_vocals.wav"
        if nv.exists():
            accomp = nv
        else:
            alt = p.parent / "accompaniment.wav"
            if alt.exists():
                accomp = alt
        if vocals and accomp:
            return vocals, accomp

    return vocals, accomp


def sanitize_filename(name: str, max_length: int = 120) -> str:
    """Sanitize a string for use as a filename."""
    s = re.sub(r'[<>:"/\\|?*]', "_", name or "").strip().strip(".")
    return re.sub(r"\s+", " ", s).strip()[:max_length] or "untitled"


def parse_artist_song(
    title: Optional[str],
    channel: Optional[str]
) -> Tuple[Optional[str], str]:
    """
    Parse artist and song from a title string.

    Handles formats like "Artist - Song Title" and falls back to channel name.
    """
    base = (title or "").strip()
    if not base:
        return (channel or None), "untitled"

    # Try to split on common separators
    m = re.match(r"\s*([^\-–—]+)\s*[\-–—]\s*(.+)", base)
    if m:
        artist = sanitize_filename(m.group(1).strip())
        song = sanitize_filename(m.group(2).strip())
        return (artist or (channel or None)), song

    # No clear separator - use channel as artist if available
    return ((channel and sanitize_filename(channel)) or None, sanitize_filename(base))
