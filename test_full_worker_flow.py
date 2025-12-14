#!/usr/bin/env python3
"""
Test the full worker flow to identify any hang points.

This simulates the actual queue processing with all the same code paths.
"""

import sys
import tempfile
import time
from pathlib import Path

# Add src to path so we can import modules
sys.path.insert(0, str(Path(__file__).parent / "src"))

from lib.state import app_state, QueueItem
from lib.config import Config
from services.worker import _process_local_item
import subprocess


def create_test_audio(output_path: Path) -> bool:
    """Create a test audio file."""
    bundled_ffmpeg = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg" / "ffmpeg"
    if bundled_ffmpeg.exists():
        ffmpeg_bin = str(bundled_ffmpeg)
    else:
        ffmpeg_bin = "ffmpeg"

    cmd = [
        ffmpeg_bin,
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=10",
        "-ac", "2",
        "-ar", "44100",
        "-y",
        str(output_path)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=15)
        return result.returncode == 0 and output_path.exists()
    except Exception:
        return False


def monitor_item_progress(item: QueueItem, stop_event):
    """Monitor and log item progress in real-time."""
    last_progress = -1
    last_status = None
    start_time = time.time()

    while not stop_event.is_set():
        with app_state.lock:
            current_progress = item.progress
            current_status = item.status
            processing = item.processing
            downloaded = item.downloaded

        elapsed = time.time() - start_time

        # Only log on changes
        if current_progress != last_progress or current_status != last_status:
            print(f"[{elapsed:6.2f}s] Progress: {current_progress*100:5.1f}% | "
                  f"Status: {current_status:10s} | "
                  f"Downloaded: {downloaded} | Processing: {processing}")
            last_progress = current_progress
            last_status = current_status

        if current_status in ("done", "error", "canceled"):
            print(f"[{elapsed:6.2f}s] Final state reached: {current_status}")
            break

        time.sleep(0.1)


def test_full_worker_flow():
    """Test the complete worker flow."""
    print("Testing Full Worker Flow")
    print("="*80)

    # Initialize config
    temp_dir = Path(tempfile.gettempdir()) / "splitboy_worker_test"
    temp_dir.mkdir(parents=True, exist_ok=True)

    config_path = temp_dir / "config.json"
    output_dir = temp_dir / "output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Create test audio
    test_audio = temp_dir / "test_10s.mp3"
    print(f"Creating test audio: {test_audio}")
    if not create_test_audio(test_audio):
        print("Failed to create test audio")
        return 1

    print(f"Test audio created: {test_audio.stat().st_size} bytes")

    # Initialize config
    config = Config(config_path)
    app_state.config = config
    config.update({
        "output_dir": str(output_dir),
        "stem_mode": "2",
        "demucs_model": "htdemucs"
    })

    # Create a queue item
    item = QueueItem(
        id="test_001",
        url="",
        local_file=True,
        local_path=str(test_audio),
        title="Test Song",
        channel="Test Artist",
        status="queued",
    )

    print(f"\nCreated queue item: {item.id}")
    print(f"  Title: {item.title}")
    print(f"  Artist: {item.channel}")
    print(f"  Path: {item.local_path}")

    # Start monitoring thread
    import threading
    stop_event = threading.Event()
    monitor_thread = threading.Thread(
        target=monitor_item_progress,
        args=(item, stop_event),
        daemon=True
    )
    monitor_thread.start()

    # Process the item
    print("\nStarting processing...")
    print("-"*80)

    start_time = time.time()
    try:
        _process_local_item(item)
        elapsed = time.time() - start_time
        print("-"*80)
        print(f"Processing completed in {elapsed:.2f}s")
    except Exception as e:
        elapsed = time.time() - start_time
        print("-"*80)
        print(f"Processing failed after {elapsed:.2f}s: {e}")
        import traceback
        traceback.print_exc()

    # Stop monitoring
    stop_event.set()
    monitor_thread.join(timeout=1.0)

    # Print final state
    print("\n" + "="*80)
    print("Final Item State:")
    print("="*80)
    with app_state.lock:
        print(f"  Status: {item.status}")
        print(f"  Progress: {item.progress*100:.1f}%")
        print(f"  Downloaded: {item.downloaded}")
        print(f"  Processing: {item.processing}")
        print(f"  Dest Path: {item.dest_path}")
        if item.error:
            print(f"  Error: {item.error}")

    # Check outputs
    if item.status == "done":
        print("\nChecking output files...")
        if item.dest_path:
            dest_path = Path(item.dest_path)
            vocals_dir = dest_path / "vocals"
            instrumental_dir = dest_path / "instrumental"

            if vocals_dir.exists():
                vocals_files = list(vocals_dir.glob("*.mp3"))
                print(f"  Vocals: {len(vocals_files)} files in {vocals_dir}")
                for f in vocals_files:
                    print(f"    - {f.name} ({f.stat().st_size} bytes)")

            if instrumental_dir.exists():
                inst_files = list(instrumental_dir.glob("*.mp3"))
                print(f"  Instrumental: {len(inst_files)} files in {instrumental_dir}")
                for f in inst_files:
                    print(f"    - {f.name} ({f.stat().st_size} bytes)")

    print(f"\nTest artifacts in: {temp_dir}")
    return 0 if item.status == "done" else 1


if __name__ == "__main__":
    sys.exit(test_full_worker_flow())
