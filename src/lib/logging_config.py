"""
Logging configuration for SplitBoy.

Provides a centralized logger with configurable verbosity.
"""

import logging
import os
import sys

# Log level from environment, defaulting to INFO
LOG_LEVEL = os.environ.get("SPLITBOY_LOG_LEVEL", "INFO").upper()

# Create the main logger
logger = logging.getLogger("splitboy")
logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

# Console handler with formatting
_handler = logging.StreamHandler(sys.stdout)
_handler.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
_formatter = logging.Formatter(
    "[%(levelname)s] %(name)s: %(message)s"
)
_handler.setFormatter(_formatter)
logger.addHandler(_handler)

# Prevent propagation to root logger
logger.propagate = False


def get_logger(name: str) -> logging.Logger:
    """Get a child logger for a specific module."""
    return logger.getChild(name)
