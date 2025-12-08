"""
Audio metadata extraction for SplitBoy.

Extracts artist, title, and other metadata from local audio files.
"""

import os
from pathlib import Path
from typing import Optional, Tuple

from .logging_config import get_logger

logger = get_logger("metadata")


def extract_audio_metadata(file_path: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Extract artist and title from an audio file's metadata.

    Args:
        file_path: Path to the audio file

    Returns:
        Tuple of (artist, title), either may be None if not found
    """
    try:
        import mutagen

        audiofile = mutagen.File(file_path)
        if audiofile is None:
            logger.debug(f"mutagen.File returned None for: {file_path}")
            return _parse_filename(file_path)

        logger.debug(f"Processing file: {file_path}")
        logger.debug(f"File format: {audiofile.mime[0] if hasattr(audiofile, 'mime') else 'unknown'}")
        logger.debug(f"Available tags: {list(audiofile.keys())}")

        artist = _extract_artist(audiofile)
        title = _extract_title(audiofile)

        if artist:
            logger.debug(f"Extracted artist: {artist}")
        if title:
            logger.debug(f"Extracted title: {title}")

        return artist, title

    except ImportError:
        logger.debug("mutagen not available, falling back to filename parsing")
        return _parse_filename(file_path)
    except Exception as e:
        logger.debug(f"Error extracting metadata: {e}")
        return _parse_filename(file_path)


def _extract_artist(audiofile) -> Optional[str]:
    """Extract artist from various tag formats."""
    # Tag priority order for different formats

    # ID3v2 (MP3)
    if 'TPE1' in audiofile:
        return str(audiofile['TPE1'][0]).strip() or None
    if 'TPE2' in audiofile:  # Album artist fallback
        return str(audiofile['TPE2'][0]).strip() or None

    # Vorbis/FLAC (case variations)
    for key in ['ARTIST', 'artist', 'ALBUMARTIST', 'albumartist']:
        if key in audiofile:
            val = audiofile[key]
            if isinstance(val, list) and val:
                return str(val[0]).strip() or None
            return str(val).strip() or None

    # MP4/M4A
    if '\xa9ART' in audiofile:  # ©ART
        val = audiofile['\xa9ART']
        if isinstance(val, list) and val:
            return str(val[0]).strip() or None
        return str(val).strip() or None
    if 'aART' in audiofile:  # Album artist
        val = audiofile['aART']
        if isinstance(val, list) and val:
            return str(val[0]).strip() or None
        return str(val).strip() or None

    return None


def _extract_title(audiofile) -> Optional[str]:
    """Extract title from various tag formats."""
    # ID3v2 (MP3)
    if 'TIT2' in audiofile:
        return str(audiofile['TIT2'][0]).strip() or None

    # Vorbis/FLAC (case variations)
    for key in ['TITLE', 'title']:
        if key in audiofile:
            val = audiofile[key]
            if isinstance(val, list) and val:
                return str(val[0]).strip() or None
            return str(val).strip() or None

    # MP4/M4A
    if '\xa9nam' in audiofile:  # ©nam
        val = audiofile['\xa9nam']
        if isinstance(val, list) and val:
            return str(val[0]).strip() or None
        return str(val).strip() or None

    return None


def _parse_filename(file_path: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse artist and title from filename.

    Handles patterns like "Artist - Title.mp3"
    """
    filename = os.path.splitext(os.path.basename(file_path))[0]

    # Check for "Artist - Title" pattern
    if ' - ' in filename:
        parts = filename.split(' - ', 1)
        artist = parts[0].strip() or None
        title = parts[1].strip() or None
        logger.debug(f"Parsed from filename - Artist: {artist}, Title: {title}")
        return artist, title

    # No clear separator, return filename as title
    return None, filename.strip() or None


def get_title_from_path(file_path: str) -> str:
    """Get a title from a file path, using filename without extension."""
    return os.path.splitext(os.path.basename(file_path))[0]
