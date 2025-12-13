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

# =============================================================================
# Demucs Model Configuration
# =============================================================================

# Available Demucs models with metadata
# Each model has: stems (4 or 6), size (approx MB), description
#
# Quality rankings (SDR on MUSDB18-HQ benchmark):
# - htdemucs_ft: ~9.2 dB (best overall, but 4x slower)
# - htdemucs: ~9.0 dB (great balance of quality/speed)
# - mdx_extra: ~8.5 dB (good for vocals specifically)
# - htdemucs_6s: for when you need piano/guitar separation
#
DEMUCS_MODELS = {
    "htdemucs": {
        "stems": 4,
        "size_mb": 81,  # Actual checkpoint size
        "description": "Best quality/speed balance",
        "default": True,
    },
    "htdemucs_ft": {
        "stems": 4,
        "size_mb": 81,
        "description": "Highest quality, 4x slower",
        "default": False,
    },
    "htdemucs_6s": {
        "stems": 6,
        "size_mb": 81,
        "description": "Adds piano + guitar stems",
        "default": False,
    },
    "mdx": {
        "stems": 4,
        "size_mb": 53,
        "description": "Faster, good for vocals",
        "default": False,
    },
    "mdx_extra": {
        "stems": 4,
        "size_mb": 53,
        "description": "Better vocals than htdemucs",
        "default": False,
    },
    "mdx_q": {
        "stems": 4,
        "size_mb": 18,
        "description": "Fastest, smallest, lower quality",
        "default": False,
    },
    "mdx_extra_q": {
        "stems": 4,
        "size_mb": 18,
        "description": "Fast and small",
        "default": False,
    },
}

# Default model to use
DEFAULT_DEMUCS_MODEL = "htdemucs"

# Available stem modes
STEM_MODES = {
    "2": {
        "label": "2 Stems",
        "description": "Vocals + Instrumental (karaoke mode)",
        "stems": ["vocals", "no_vocals"],
        "output_dirs": ["vocals", "instrumental"],
    },
    "4": {
        "label": "4 Stems",
        "description": "Vocals, Drums, Bass, Other",
        "stems": ["vocals", "drums", "bass", "other"],
        "output_dirs": ["vocals", "drums", "bass", "other"],
    },
    "6": {
        "label": "6 Stems",
        "description": "Vocals, Drums, Bass, Other, Piano, Guitar",
        "stems": ["vocals", "drums", "bass", "other", "piano", "guitar"],
        "output_dirs": ["vocals", "drums", "bass", "other", "piano", "guitar"],
        "requires_model": "htdemucs_6s",
    },
}

# Default stem mode
DEFAULT_STEM_MODE = "2"
