"""
Centralized constants for SplitBoy.

This module contains all magic numbers and configuration defaults
that were previously scattered throughout the codebase.
"""

# Progress tracking weights for the two-phase pipeline
# Download phase takes ~30% of total time, processing (Demucs) takes ~70%
DOWNLOAD_PROGRESS_WEIGHT = 0.30
PROCESSING_PROGRESS_WEIGHT = 0.70

# Default concurrency settings
DEFAULT_CONCURRENCY = 4
MIN_CONCURRENCY = 1
MAX_CONCURRENCY = 64

# Server defaults
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9000
DEFAULT_LOG_LEVEL = "info"

# Timeouts (in seconds)
SERVER_SHUTDOWN_TIMEOUT_MS = 400
GRACEFUL_SHUTDOWN_WAIT_MS = 200
ENRICHMENT_STALL_TIMEOUT = 60
ENRICHMENT_HARD_TIMEOUT_MAX = 720  # 12 minutes

# Safety caps for large operations
PLAYLIST_HARD_CAP = 5000
ENRICHMENT_CAP = 1000

# Polling intervals (in seconds)
PROGRESS_UPDATE_THROTTLE = 0.08
PROCESSING_UPDATE_THROTTLE = 0.3

# Audio file extensions
AUDIO_EXTENSIONS = frozenset([
    "mp3", "wav", "flac", "aac", "m4a", "ogg", "wma", "opus"
])

# Supported download formats (in order of preference)
DOWNLOAD_AUDIO_FORMATS = ["mp3", "m4a", "webm", "wav", "opus"]
