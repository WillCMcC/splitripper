"""
Tests for lib/ytdlp_updater module.
"""

import sys
import tempfile
from pathlib import Path
from datetime import datetime, timedelta

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lib.ytdlp_updater import (
    init_updater,
    get_update_status,
    needs_update_check,
    _update_state,
    _state_lock,
    UPDATE_CHECK_INTERVAL_HOURS,
)


class TestUpdateStatus:
    """Tests for get_update_status function."""

    def test_initial_status(self):
        """Test that initial status has expected keys."""
        status = get_update_status()
        assert "current_version" in status
        assert "last_check" in status
        assert "last_update" in status
        assert "update_in_progress" in status
        assert "last_error" in status

    def test_update_in_progress_default_false(self):
        """Test that update_in_progress defaults to False."""
        status = get_update_status()
        assert status["update_in_progress"] is False


class TestNeedsUpdateCheck:
    """Tests for needs_update_check function."""

    def test_needs_check_when_never_checked(self):
        """Test returns True when never checked before."""
        with _state_lock:
            _update_state["last_check"] = None

        assert needs_update_check() is True

    def test_needs_check_when_old(self):
        """Test returns True when last check is old."""
        old_time = datetime.now() - timedelta(hours=UPDATE_CHECK_INTERVAL_HOURS + 1)
        with _state_lock:
            _update_state["last_check"] = old_time.isoformat()

        assert needs_update_check() is True

    def test_no_check_when_recent(self):
        """Test returns False when last check is recent."""
        recent_time = datetime.now() - timedelta(hours=1)
        with _state_lock:
            _update_state["last_check"] = recent_time.isoformat()

        assert needs_update_check() is False


class TestInitUpdater:
    """Tests for init_updater function."""

    def test_init_creates_state_file_path(self):
        """Test init sets up state file path."""
        with tempfile.TemporaryDirectory() as tmpdir:
            init_updater(Path(tmpdir))
            # State file path should be set (file may not exist yet)
            from lib.ytdlp_updater import _state_file
            assert _state_file is not None
            assert str(tmpdir) in str(_state_file)
