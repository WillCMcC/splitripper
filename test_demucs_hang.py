#!/usr/bin/env python3
"""
Diagnostic script to identify why Demucs subprocess doesn't exit.

This script:
1. Creates a small test audio file (1 second sine wave)
2. Runs demucs with subprocess.Popen
3. Monitors the process closely with detailed logging
4. Tests different configurations to identify the hang point
"""

import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

# Generate a small test audio file using ffmpeg
def create_test_audio(output_path: Path) -> bool:
    """Create a 1-second test audio file using ffmpeg."""
    print(f"Creating test audio file: {output_path}")

    # Find ffmpeg
    bundled_ffmpeg = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg" / "ffmpeg"
    if bundled_ffmpeg.exists():
        ffmpeg_bin = str(bundled_ffmpeg)
    else:
        ffmpeg_bin = "ffmpeg"

    cmd = [
        ffmpeg_bin,
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=1",
        "-ac", "2",  # stereo
        "-ar", "44100",
        "-y",
        str(output_path)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=10)
        if result.returncode == 0 and output_path.exists():
            print(f"✓ Test audio created: {output_path.stat().st_size} bytes")
            return True
        else:
            print(f"✗ Failed to create test audio: {result.stderr.decode()}")
            return False
    except Exception as e:
        print(f"✗ Error creating test audio: {e}")
        return False


def test_demucs_with_current_code(audio_file: Path, output_dir: Path):
    """Test Demucs using the current code pattern from demucs.py"""
    print("\n" + "="*80)
    print("TEST 1: Current implementation (with reader thread)")
    print("="*80)

    python_exe = sys.executable
    env = os.environ.copy()

    # Add ffmpeg to path if bundled
    ffmpeg_dir = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")
        env["FFMPEG_LOCATION"] = str(ffmpeg_dir)

    cmd = [
        python_exe, "-m", "demucs.separate",
        "-n", "htdemucs",
        "--mp3",
        "--two-stems", "vocals",
        "-o", str(output_dir),
        str(audio_file)
    ]

    print(f"Command: {' '.join(cmd)}")
    print(f"Python: {python_exe}")
    print(f"Working dir: {os.getcwd()}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        bufsize=1,
        universal_newlines=True
    )

    print(f"Process spawned: PID={proc.pid}")

    # Reader thread pattern from demucs.py
    output_queue = queue.Queue()

    def reader_thread():
        """Read lines from stdout and put them in a queue."""
        try:
            line_count = 0
            for line in proc.stdout:
                line_count += 1
                output_queue.put(line)
                print(f"[READER] Line {line_count}: {line.strip()[:80]}")
        except Exception as e:
            print(f"[READER] Exception: {e}")
        finally:
            print(f"[READER] Finished reading {line_count} lines, sending EOF signal")
            output_queue.put(None)  # Signal end of output

    reader = threading.Thread(target=reader_thread, daemon=True)
    reader.start()
    print("Reader thread started")

    # Process output from the queue
    line_count = 0
    last_poll_time = time.time()
    poll_interval = 0.5

    while True:
        try:
            line = output_queue.get(timeout=poll_interval)
            if line is None:
                print(f"[MAIN] Received EOF signal from reader thread")
                break
            line_count += 1
            # Don't print again (reader already printed)
        except queue.Empty:
            # Check process status
            poll_result = proc.poll()
            elapsed = time.time() - last_poll_time
            print(f"[MAIN] Queue timeout after {elapsed:.2f}s, poll()={poll_result}")

            if poll_result is not None:
                print(f"[MAIN] Process finished with returncode={poll_result}")
                # Drain remaining output
                drained = 0
                while True:
                    try:
                        line = output_queue.get_nowait()
                        if line is None:
                            break
                        drained += 1
                    except queue.Empty:
                        break
                print(f"[MAIN] Drained {drained} remaining lines")
                break

            last_poll_time = time.time()

    print(f"[MAIN] Waiting for reader thread to finish...")
    reader.join(timeout=5.0)
    if reader.is_alive():
        print(f"[MAIN] WARNING: Reader thread still alive after 5s timeout!")
    else:
        print(f"[MAIN] Reader thread finished successfully")

    print(f"[MAIN] Calling proc.wait()...")
    proc.wait()
    print(f"[MAIN] proc.wait() returned, returncode={proc.returncode}")

    return proc.returncode


def test_demucs_simple(audio_file: Path, output_dir: Path):
    """Test Demucs with simpler approach - no threading, just communicate()"""
    print("\n" + "="*80)
    print("TEST 2: Simple implementation (communicate())")
    print("="*80)

    python_exe = sys.executable
    env = os.environ.copy()

    ffmpeg_dir = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")
        env["FFMPEG_LOCATION"] = str(ffmpeg_dir)

    output_dir2 = output_dir.parent / f"{output_dir.name}_test2"
    output_dir2.mkdir(parents=True, exist_ok=True)

    cmd = [
        python_exe, "-m", "demucs.separate",
        "-n", "htdemucs",
        "--mp3",
        "--two-stems", "vocals",
        "-o", str(output_dir2),
        str(audio_file)
    ]

    print(f"Command: {' '.join(cmd)}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env
    )

    print(f"Process spawned: PID={proc.pid}")
    print(f"Calling communicate()...")

    start_time = time.time()
    stdout, _ = proc.communicate()
    elapsed = time.time() - start_time

    print(f"communicate() returned after {elapsed:.2f}s")
    print(f"returncode={proc.returncode}")
    print(f"Output length: {len(stdout)} chars")
    print("\nLast 500 chars of output:")
    print(stdout[-500:])

    return proc.returncode


def test_demucs_no_text_mode(audio_file: Path, output_dir: Path):
    """Test Demucs without text mode - using binary pipes"""
    print("\n" + "="*80)
    print("TEST 3: Binary mode (no text=True)")
    print("="*80)

    python_exe = sys.executable
    env = os.environ.copy()

    ffmpeg_dir = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")
        env["FFMPEG_LOCATION"] = str(ffmpeg_dir)

    output_dir3 = output_dir.parent / f"{output_dir.name}_test3"
    output_dir3.mkdir(parents=True, exist_ok=True)

    cmd = [
        python_exe, "-m", "demucs.separate",
        "-n", "htdemucs",
        "--mp3",
        "--two-stems", "vocals",
        "-o", str(output_dir3),
        str(audio_file)
    ]

    print(f"Command: {' '.join(cmd)}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env
    )

    print(f"Process spawned: PID={proc.pid}")

    # Read binary output
    output = b''
    while True:
        chunk = proc.stdout.read(1024)
        if not chunk:
            break
        output += chunk
        print(f"Read {len(chunk)} bytes (total: {len(output)})")

    proc.wait()
    print(f"Process finished: returncode={proc.returncode}")

    return proc.returncode


def test_demucs_close_pipes(audio_file: Path, output_dir: Path):
    """Test explicitly closing pipes after process finishes"""
    print("\n" + "="*80)
    print("TEST 4: Explicit pipe closing")
    print("="*80)

    python_exe = sys.executable
    env = os.environ.copy()

    ffmpeg_dir = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")
        env["FFMPEG_LOCATION"] = str(ffmpeg_dir)

    output_dir4 = output_dir.parent / f"{output_dir.name}_test4"
    output_dir4.mkdir(parents=True, exist_ok=True)

    cmd = [
        python_exe, "-m", "demucs.separate",
        "-n", "htdemucs",
        "--mp3",
        "--two-stems", "vocals",
        "-o", str(output_dir4),
        str(audio_file)
    ]

    print(f"Command: {' '.join(cmd)}")

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        bufsize=1,
        universal_newlines=True
    )

    print(f"Process spawned: PID={proc.pid}")

    # Read all output
    for line in proc.stdout:
        print(f"[OUTPUT] {line.strip()[:80]}")

    print(f"[MAIN] stdout iterator exhausted")
    print(f"[MAIN] Closing stdout...")
    proc.stdout.close()

    print(f"[MAIN] Calling wait()...")
    returncode = proc.wait()
    print(f"[MAIN] wait() returned: {returncode}")

    return returncode


def main():
    print("Demucs Subprocess Hang Diagnostic Tool")
    print("="*80)

    # Create test audio file
    temp_dir = Path(tempfile.gettempdir()) / "splitboy_demucs_test"
    temp_dir.mkdir(parents=True, exist_ok=True)

    test_audio = temp_dir / "test_sine_1s.mp3"

    if not create_test_audio(test_audio):
        print("\nFailed to create test audio file. Exiting.")
        return 1

    # Create output directory
    output_dir = temp_dir / "demucs_output_test1"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run tests
    tests = [
        ("Current Implementation", test_demucs_with_current_code),
        ("Simple communicate()", test_demucs_simple),
        ("Binary Mode", test_demucs_no_text_mode),
        ("Explicit Pipe Closing", test_demucs_close_pipes),
    ]

    results = {}

    for test_name, test_func in tests:
        print(f"\n\nStarting: {test_name}")
        try:
            start = time.time()
            returncode = test_func(test_audio, output_dir)
            elapsed = time.time() - start
            results[test_name] = {
                "status": "PASSED" if returncode == 0 else "FAILED",
                "returncode": returncode,
                "elapsed": elapsed
            }
            print(f"\n✓ {test_name} completed in {elapsed:.2f}s (returncode={returncode})")
        except Exception as e:
            results[test_name] = {
                "status": "ERROR",
                "error": str(e)
            }
            print(f"\n✗ {test_name} failed with exception: {e}")

        print("\nWaiting 2 seconds before next test...")
        time.sleep(2)

    # Summary
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    for test_name, result in results.items():
        print(f"\n{test_name}:")
        for key, value in result.items():
            print(f"  {key}: {value}")

    # Cleanup
    print(f"\n\nTest artifacts in: {temp_dir}")
    print("Run 'rm -rf {}' to clean up".format(temp_dir))

    return 0


if __name__ == "__main__":
    sys.exit(main())
