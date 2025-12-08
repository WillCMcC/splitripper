"""
Tests for lib/state module.
"""

import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lib.state import QueueItem, AppState


class TestQueueItem:
    """Tests for QueueItem dataclass."""

    def test_default_values(self):
        """Test default values are set correctly."""
        item = QueueItem(id="test-1", url="https://example.com")
        assert item.id == "test-1"
        assert item.url == "https://example.com"
        assert item.title is None
        assert item.status == "queued"
        assert item.progress == 0.0
        assert item.processing is False
        assert item.downloaded is False

    def test_to_dict(self):
        """Test conversion to dictionary."""
        item = QueueItem(
            id="test-1",
            url="https://example.com",
            title="Test Video",
            status="running",
            progress=0.5
        )
        d = item.to_dict()
        assert d["id"] == "test-1"
        assert d["url"] == "https://example.com"
        assert d["title"] == "Test Video"
        assert d["status"] == "running"
        assert d["progress"] == 0.5

    def test_from_dict(self):
        """Test creation from dictionary."""
        data = {
            "id": "test-2",
            "url": "https://youtube.com/watch?v=xyz",
            "title": "Another Video",
            "status": "done",
            "progress": 1.0,
        }
        item = QueueItem.from_dict(data)
        assert item.id == "test-2"
        assert item.url == "https://youtube.com/watch?v=xyz"
        assert item.title == "Another Video"
        assert item.status == "done"
        assert item.progress == 1.0

    def test_local_file_item(self):
        """Test local file queue item."""
        item = QueueItem(
            id="local-1",
            url="file:///path/to/song.mp3",
            title="Song",
            local_file=True,
            local_path="/path/to/song.mp3"
        )
        assert item.local_file is True
        assert item.local_path == "/path/to/song.mp3"


class TestAppState:
    """Tests for AppState class."""

    def test_initial_state(self):
        """Test initial state values."""
        state = AppState()
        assert state.running is False
        assert state.active == 0
        assert state.max_concurrency > 0
        assert len(state.get_queue()) == 0

    def test_config_operations(self):
        """Test config get/set/update."""
        state = AppState()
        state.set_config({"output_dir": "/test/path", "max_concurrency": 8})

        assert state.get_config_value("output_dir") == "/test/path"
        assert state.get_config_value("max_concurrency") == 8
        assert state.get_config_value("nonexistent", "default") == "default"

        state.update_config({"output_dir": "/new/path"})
        assert state.get_config_value("output_dir") == "/new/path"
        assert state.get_config_value("max_concurrency") == 8  # unchanged

    def test_queue_operations(self):
        """Test queue add/get/clear."""
        state = AppState()

        item1 = QueueItem(id="item-1", url="https://example.com/1")
        item2 = QueueItem(id="item-2", url="https://example.com/2")

        state.add_to_queue(item1)
        state.add_to_queue(item2)

        assert len(state.get_queue()) == 2
        assert state.get_queue_item("item-1") == item1
        assert state.get_queue_item("item-2") == item2
        assert state.get_queue_item("nonexistent") is None

        state.clear_queue()
        assert len(state.get_queue()) == 0

    def test_concurrency_bounds(self):
        """Test max_concurrency is bounded."""
        state = AppState()

        state.max_concurrency = 100
        assert state.max_concurrency == 64  # capped at 64

        state.max_concurrency = 0
        assert state.max_concurrency == 1  # minimum of 1

        state.max_concurrency = 8
        assert state.max_concurrency == 8

    def test_active_count(self):
        """Test active count increment/decrement."""
        state = AppState()

        assert state.active == 0
        state.increment_active()
        assert state.active == 1
        state.increment_active()
        assert state.active == 2
        state.decrement_active()
        assert state.active == 1
        state.decrement_active()
        state.decrement_active()  # Should not go below 0
        assert state.active == 0

    def test_progress_tracking(self):
        """Test progress tracking for long operations."""
        state = AppState()

        state.set_progress("req-1", "listing", current=0, total=100, message="Starting")
        prog = state.get_progress("req-1")
        assert prog["phase"] == "listing"
        assert prog["current"] == 0
        assert prog["total"] == 100

        state.update_progress("req-1", current=50, message="Halfway")
        prog = state.get_progress("req-1")
        assert prog["current"] == 50
        assert prog["message"] == "Halfway"

        state.finish_progress("req-1")
        prog = state.get_progress("req-1")
        assert prog["phase"] == "done"

    def test_global_progress(self):
        """Test global progress calculation."""
        state = AppState()

        # Empty queue
        prog = state.global_progress()
        assert prog["progress"] == 0.0
        assert prog["counts"]["queued"] == 0

        # Add items with various states
        item1 = QueueItem(id="1", url="u1", status="done")
        item2 = QueueItem(id="2", url="u2", status="running", progress=0.5)
        item3 = QueueItem(id="3", url="u3", status="queued")
        item4 = QueueItem(id="4", url="u4", status="error")

        state.add_to_queue(item1)
        state.add_to_queue(item2)
        state.add_to_queue(item3)
        state.add_to_queue(item4)

        prog = state.global_progress()
        assert prog["counts"]["done"] == 1
        assert prog["counts"]["running"] == 1
        assert prog["counts"]["queued"] == 1
        assert prog["counts"]["error"] == 1
        # Progress: (1.0 + 0.5 + 0.0) / 3 = 0.5
        assert abs(prog["progress"] - 0.5) < 0.01
