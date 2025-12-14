"""Shared pytest fixtures for SplitBoy tests."""
import os
import sys
import json
import tempfile
import shutil
from pathlib import Path
from typing import Generator, Any
from unittest.mock import MagicMock, patch

import pytest

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


@pytest.fixture
def temp_dir() -> Generator[Path, None, None]:
    """Create a temporary directory for test files."""
    tmp = Path(tempfile.mkdtemp())
    yield tmp
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def temp_config_file(temp_dir: Path) -> Path:
    """Create a temporary config file."""
    config_path = temp_dir / "config.json"
    config_path.write_text(json.dumps({
        "output_dir": str(temp_dir / "output"),
        "default_folder": "",
        "max_concurrency": 4,
        "demucs_model": "htdemucs",
        "stem_mode": "2",
    }))
    return config_path


@pytest.fixture
def mock_app_state():
    """Create a fresh mock AppState for testing."""
    from lib.state import AppState
    state = AppState()
    state.update_config({"output_dir": "/tmp/test_output", "max_concurrency": 4})
    yield state
    # Cleanup
    state._queue.clear()
    state._progress_map.clear()


@pytest.fixture
def sample_queue_items():
    """Sample QueueItem objects for testing."""
    from lib.state import QueueItem
    return [
        QueueItem(id="1", url="https://youtube.com/watch?v=test1", title="Test 1", status="queued"),
        QueueItem(id="2", url="https://youtube.com/watch?v=test2", title="Test 2", status="running"),
        QueueItem(id="3", url="https://youtube.com/watch?v=test3", title="Test 3", status="done"),
        QueueItem(id="4", url="https://youtube.com/watch?v=test4", title="Test 4", status="error", error="Test error"),
    ]


@pytest.fixture
def mock_yt_dlp():
    """Mock yt_dlp module."""
    mock_ytdl = MagicMock()
    mock_ytdl.YoutubeDL.return_value.__enter__ = MagicMock(return_value=mock_ytdl)
    mock_ytdl.YoutubeDL.return_value.__exit__ = MagicMock(return_value=False)
    mock_ytdl.extract_info.return_value = {
        "id": "test_video_id",
        "title": "Test Video Title",
        "duration": 180,
        "channel": "Test Channel",
        "uploader": "Test Uploader",
    }

    with patch.dict("sys.modules", {"yt_dlp": mock_ytdl}):
        yield mock_ytdl


@pytest.fixture
def mock_subprocess():
    """Mock subprocess module."""
    with patch("subprocess.run") as mock_run, \
         patch("subprocess.Popen") as mock_popen:
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        mock_popen.return_value = MagicMock(
            pid=12345,
            returncode=0,
            stdout=MagicMock(readline=lambda: b""),
            stderr=MagicMock(readline=lambda: b""),
            poll=lambda: 0,
            wait=lambda: 0,
        )
        yield {"run": mock_run, "Popen": mock_popen}


@pytest.fixture
def sample_audio_file(temp_dir: Path) -> Path:
    """Create a minimal valid audio file for testing."""
    # Create a very simple WAV file (silent, 1 second)
    import wave
    import struct

    audio_path = temp_dir / "test_audio.wav"
    with wave.open(str(audio_path), "w") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(44100)
        # 1 second of silence
        wav.writeframes(struct.pack("<" + "h" * 44100, *([0] * 44100)))

    return audio_path


@pytest.fixture
def mock_demucs(temp_dir: Path):
    """Mock demucs separation to create fake output files."""
    def create_fake_stems(audio_file: Path, output_dir: Path, **kwargs):
        # Create fake stem files
        stems_dir = output_dir / "htdemucs" / audio_file.stem
        stems_dir.mkdir(parents=True, exist_ok=True)

        for stem in ["vocals", "no_vocals"]:
            stem_file = stems_dir / f"{stem}.mp3"
            stem_file.write_bytes(b"fake audio data")

        return {"vocals": stems_dir / "vocals.mp3", "no_vocals": stems_dir / "no_vocals.mp3"}, None

    with patch("services.demucs.run_demucs_separation", side_effect=create_fake_stems):
        yield


# FastAPI test client fixture
@pytest.fixture
def test_client():
    """Create a FastAPI TestClient.

    Requires fastapi and httpx to be installed (in requirements-dev.txt).
    Skips tests if dependencies are not available.
    """
    try:
        from fastapi.testclient import TestClient
    except ImportError:
        pytest.skip("FastAPI TestClient not available - install with: pip install fastapi httpx")

    try:
        # Import app after path setup
        from server import app
    except ImportError as e:
        pytest.skip(f"Server import failed: {e}")

    client = TestClient(app)
    yield client
