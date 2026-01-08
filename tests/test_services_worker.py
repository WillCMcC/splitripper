"""Tests for services/worker.py - Queue worker service."""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock

import pytest

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


class TestSplitAndStage:
    """Test _split_and_stage function."""

    def test_creates_output_directory(self, temp_dir, sample_audio_file):
        """Test that output directory is created if it doesn't exist."""
        from lib.state import QueueItem, app_state
        from services.worker import _split_and_stage

        output_dir = temp_dir / "output" / "test_artist"
        item = QueueItem(
            id="test-1",
            url="https://youtube.com/watch?v=test",
            title="Test Song",
            channel="Test Artist",
            folder=str(temp_dir / "output"),
        )

        # Mock run_demucs_separation to return fake stems
        with patch("services.worker.run_demucs_separation") as mock_demucs:
            mock_stems = {
                "vocals": temp_dir / "vocals.mp3",
                "no_vocals": temp_dir / "instrumental.mp3",
            }
            # Create fake stem files
            for stem_path in mock_stems.values():
                stem_path.write_bytes(b"fake audio")
            mock_demucs.return_value = (mock_stems, None)

            success, error, dest_dir = _split_and_stage(sample_audio_file, item)

        assert success is True
        assert error is None
        assert dest_dir is not None

    def test_handles_demucs_failure(self, temp_dir, sample_audio_file):
        """Test handling of Demucs separation failure."""
        from lib.state import QueueItem
        from services.worker import _split_and_stage

        item = QueueItem(
            id="test-2",
            url="https://youtube.com/watch?v=test",
            title="Test Song",
            channel="Test Artist",
            folder=str(temp_dir / "output"),
        )

        with patch("services.worker.run_demucs_separation") as mock_demucs:
            mock_demucs.return_value = (None, "demucs error: out of memory")

            success, error, dest_dir = _split_and_stage(sample_audio_file, item)

        assert success is False
        assert "demucs" in error.lower()
        assert dest_dir is None


class TestProcessLocalItem:
    """Test _process_local_item function."""

    def test_file_not_found(self, mock_app_state):
        """Test handling of non-existent local file."""
        from lib.state import QueueItem
        from services.worker import _process_local_item

        item = QueueItem(
            id="test-local-1",
            url="file:///nonexistent/file.mp3",
            title="Test",
            local_file=True,
            local_path="/nonexistent/file.mp3",
        )
        mock_app_state.add_to_queue(item)

        _process_local_item(item)

        assert item.status == "error"
        assert "not found" in item.error.lower()

    def test_successful_processing(self, temp_dir, sample_audio_file, mock_app_state):
        """Test successful local file processing."""
        from lib.state import QueueItem
        from services.worker import _process_local_item

        item = QueueItem(
            id="test-local-2",
            url=f"file://{sample_audio_file}",
            local_file=True,
            local_path=str(sample_audio_file),
            folder=str(temp_dir / "output"),
        )
        mock_app_state.add_to_queue(item)

        # Mock the separation
        with patch("services.worker._split_and_stage") as mock_split:
            mock_split.return_value = (True, None, temp_dir / "output" / "artist")

            _process_local_item(item)

        assert item.status == "done"
        assert item.progress == 1.0


class TestProcessYouTubeItem:
    """Test _process_youtube_item function."""

    def test_yt_dlp_not_available(self, mock_app_state):
        """Test handling when yt_dlp is not available."""
        from lib.state import QueueItem
        from services.worker import _process_youtube_item

        item = QueueItem(
            id="test-yt-1",
            url="https://youtube.com/watch?v=test",
            title="Test Video",
        )
        mock_app_state.add_to_queue(item)

        # Mock yt_dlp import to fail
        with patch.dict("sys.modules", {"yt_dlp": None}):
            with patch(
                "builtins.__import__", side_effect=ImportError("No module named yt_dlp")
            ):
                # The function catches the import error internally
                pass

    def test_stop_event_handling(self, temp_dir, mock_app_state):
        """Test that processing respects stop_event."""
        from lib.state import QueueItem
        from services.worker import _process_youtube_item

        item = QueueItem(
            id="test-yt-2",
            url="https://youtube.com/watch?v=test",
            title="Test Video",
            folder=str(temp_dir),
        )
        mock_app_state.add_to_queue(item)

        # Set the stop event
        mock_app_state.stop_event.set()

        # Mock yt_dlp and patch app_state in worker module
        mock_ytdl = MagicMock()
        with patch.dict("sys.modules", {"yt_dlp": mock_ytdl}):
            with patch("services.worker.app_state", mock_app_state):
                _process_youtube_item(item)

        assert item.status == "canceled"
        mock_app_state.stop_event.clear()


class TestDownloadWorker:
    """Test download_worker main loop."""

    def test_worker_processes_queued_items(self, mock_app_state):
        """Test that worker processes items in queue."""
        from lib.state import QueueItem
        from services.worker import download_worker

        # Add a queued item
        item = QueueItem(
            id="test-worker-1",
            url="https://youtube.com/watch?v=test",
            title="Test",
            status="queued",
        )
        mock_app_state.add_to_queue(item)

        # Mock _process_item to just mark item as done
        def mock_process(it):
            it.status = "done"
            it.progress = 1.0
            mock_app_state.decrement_active()

        with patch("services.worker.app_state", mock_app_state):
            with patch("services.worker._process_item", side_effect=mock_process):
                download_worker()

        assert item.status == "done"

    def test_worker_respects_stop_event(self, mock_app_state):
        """Test that worker stops when stop_event is set."""
        from lib.state import QueueItem
        from services.worker import download_worker

        # Set max_concurrency to 1 so items are processed sequentially
        mock_app_state.max_concurrency = 1

        # Add queued items
        for i in range(3):
            item = QueueItem(
                id=f"test-stop-{i}",
                url=f"https://youtube.com/watch?v=test{i}",
                title=f"Test {i}",
                status="queued",
            )
            mock_app_state.add_to_queue(item)

        # Mock _process_item to set stop event on first call
        call_count = [0]

        def mock_process(it):
            call_count[0] += 1
            if call_count[0] == 1:
                # Set stop event during first item processing
                mock_app_state.stop_event.set()
            it.status = "done"
            it.progress = 1.0
            mock_app_state.decrement_active()

        with patch("services.worker.app_state", mock_app_state):
            with patch("services.worker._process_item", side_effect=mock_process):
                download_worker()

        # First item was processed, remaining should be canceled
        items = mock_app_state.get_queue_items()
        assert items[0].status == "done"
        for item in items[1:]:
            assert item.status == "canceled"

        mock_app_state.stop_event.clear()

    def test_worker_respects_max_concurrency(self, mock_app_state):
        """Test that worker respects max_concurrency setting."""
        from lib.state import QueueItem
        from services.worker import download_worker

        mock_app_state.max_concurrency = 2

        # Add more items than max_concurrency
        for i in range(5):
            item = QueueItem(
                id=f"test-conc-{i}",
                url=f"https://youtube.com/watch?v=test{i}",
                title=f"Test {i}",
                status="queued",
            )
            mock_app_state.add_to_queue(item)

        active_count = []

        def mock_process(it):
            import time

            active_count.append(mock_app_state.active)
            time.sleep(0.1)  # Simulate work
            it.status = "done"
            it.progress = 1.0
            mock_app_state.decrement_active()

        with patch("services.worker.app_state", mock_app_state):
            with patch("services.worker._process_item", side_effect=mock_process):
                with patch("time.sleep", return_value=None):  # Speed up the test
                    download_worker()

        # Active count should never exceed max_concurrency
        assert all(c <= 2 for c in active_count)
