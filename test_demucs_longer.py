#!/usr/bin/env python3
"""
Test Demucs with a longer audio file to reproduce the hang issue.

This test creates a 30-second audio file which should take longer to process
and may reveal timing/synchronization issues.
"""

import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path


def create_longer_test_audio(output_path: Path, duration: int = 30) -> bool:
    """Create a longer test audio file."""
    print(f"Creating {duration}s test audio file: {output_path}")

    bundled_ffmpeg = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg" / "ffmpeg"
    if bundled_ffmpeg.exists():
        ffmpeg_bin = str(bundled_ffmpeg)
    else:
        ffmpeg_bin = "ffmpeg"

    # Create a more complex audio signal with multiple tones
    cmd = [
        ffmpeg_bin,
        "-f", "lavfi",
        "-i", f"sine=frequency=440:duration={duration}",
        "-f", "lavfi",
        "-i", f"sine=frequency=880:duration={duration}",
        "-filter_complex", "[0][1]amix=inputs=2:duration=longest",
        "-ac", "2",
        "-ar", "44100",
        "-y",
        str(output_path)
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, timeout=duration + 10)
        if result.returncode == 0 and output_path.exists():
            print(f"✓ Test audio created: {output_path.stat().st_size} bytes")
            return True
        else:
            print(f"✗ Failed to create test audio: {result.stderr.decode()}")
            return False
    except Exception as e:
        print(f"✗ Error creating test audio: {e}")
        return False


def test_with_detailed_monitoring(audio_file: Path, output_dir: Path):
    """
    Test with very detailed monitoring to catch the exact hang point.
    This replicates the exact code from demucs.py with additional logging.
    """
    print("\n" + "="*80)
    print("TEST: Detailed monitoring (exact code from demucs.py)")
    print("="*80)

    python_exe = sys.executable
    env = os.environ.copy()

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

    # Exact pattern from demucs.py lines 155-210
    output_queue = queue.Queue()

    def reader_thread():
        """Read lines from stdout and put them in a queue."""
        try:
            for line in proc.stdout:
                output_queue.put(line)
        except Exception:
            pass
        finally:
            output_queue.put(None)  # Signal end of output

    reader = threading.Thread(target=reader_thread, daemon=True)
    reader.start()
    print("Reader thread started")

    # Track timing
    start_time = time.time()
    last_output_time = start_time
    line_count = 0
    last_progress = 0.0

    # Process output from the queue while waiting for completion
    while True:
        try:
            line = output_queue.get(timeout=0.5)
            now = time.time()
            if line is None:
                print(f"\n[{now-start_time:.2f}s] Received EOF signal from reader thread")
                break
            line_count += 1
            line = line.strip()
            if line:
                print(f"[{now-start_time:.2f}s] Line {line_count}: {line[:100]}")
                last_output_time = now

                # Parse progress
                import re
                m = re.match(r"\s*(\d+)%", line)
                if m:
                    pct = int(m.group(1))
                    prog = min(0.99, max(0.0, pct / 100.0))
                    if prog > last_progress:
                        last_progress = prog
                        print(f"  → Progress updated to {prog*100:.1f}%")

        except queue.Empty:
            now = time.time()
            poll_result = proc.poll()
            time_since_last_output = now - last_output_time
            print(f"[{now-start_time:.2f}s] Queue timeout (no output for {time_since_last_output:.1f}s), poll()={poll_result}")

            if poll_result is not None:
                print(f"[{now-start_time:.2f}s] Process finished with returncode={poll_result}")
                # Drain any remaining output
                drained = 0
                while True:
                    try:
                        line = output_queue.get_nowait()
                        if line is None:
                            break
                        drained += 1
                    except queue.Empty:
                        break
                print(f"[{now-start_time:.2f}s] Drained {drained} remaining lines")
                break

    # Wait for reader thread to finish
    print(f"[{time.time()-start_time:.2f}s] Waiting for reader thread to finish...")
    reader.join(timeout=2.0)
    if reader.is_alive():
        print(f"[{time.time()-start_time:.2f}s] WARNING: Reader thread still alive!")
    else:
        print(f"[{time.time()-start_time:.2f}s] Reader thread finished")

    # Wait for process to fully finish
    print(f"[{time.time()-start_time:.2f}s] Calling proc.wait()...")
    proc.wait()
    elapsed = time.time() - start_time
    print(f"[{elapsed:.2f}s] proc.wait() returned, returncode={proc.returncode}")

    return proc.returncode, elapsed


def test_with_process_monitoring(audio_file: Path, output_dir: Path):
    """Test while monitoring the process state."""
    print("\n" + "="*80)
    print("TEST: With external process monitoring")
    print("="*80)

    python_exe = sys.executable
    env = os.environ.copy()

    ffmpeg_dir = Path(__file__).parent / "python_runtime_bundle" / "ffmpeg"
    if ffmpeg_dir.exists():
        env["PATH"] = f"{ffmpeg_dir}{os.pathsep}" + env.get("PATH", "")

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

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env
    )

    print(f"Process PID: {proc.pid}")

    # Monitor process state
    import psutil
    ps_proc = None
    try:
        ps_proc = psutil.Process(proc.pid)
    except:
        print("psutil not available for detailed monitoring")

    start_time = time.time()
    for line in proc.stdout:
        now = time.time()
        print(f"[{now-start_time:.2f}s] {line.strip()[:100]}")

        # Check process state
        if ps_proc:
            try:
                print(f"  Process status: {ps_proc.status()}, threads: {ps_proc.num_threads()}")
            except:
                pass

    print(f"\n[{time.time()-start_time:.2f}s] stdout exhausted")
    if ps_proc:
        try:
            print(f"Process status before wait: {ps_proc.status()}")
        except:
            pass

    proc.wait()
    elapsed = time.time() - start_time
    print(f"[{elapsed:.2f}s] Process finished: returncode={proc.returncode}")

    return proc.returncode, elapsed


def main():
    print("Demucs Long Audio Test")
    print("="*80)

    # Create test audio file
    temp_dir = Path(tempfile.gettempdir()) / "splitboy_demucs_long_test"
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Try 30 second file
    test_audio = temp_dir / "test_30s.mp3"

    if not create_longer_test_audio(test_audio, duration=30):
        print("\nFailed to create test audio file. Exiting.")
        return 1

    # Create output directory
    output_dir = temp_dir / "demucs_output"
    output_dir.mkdir(parents=True, exist_ok=True)

    # Run test
    try:
        returncode, elapsed = test_with_detailed_monitoring(test_audio, output_dir)
        print(f"\n✓ Test completed in {elapsed:.2f}s (returncode={returncode})")
    except KeyboardInterrupt:
        print("\n\n✗ Test interrupted by user")
        return 1
    except Exception as e:
        print(f"\n✗ Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        return 1

    # Run second test
    try:
        print("\n\nRunning second test with process monitoring...")
        returncode2, elapsed2 = test_with_process_monitoring(test_audio, output_dir)
        print(f"\n✓ Test 2 completed in {elapsed2:.2f}s (returncode={returncode2})")
    except Exception as e:
        print(f"\n✗ Test 2 failed: {e}")

    print(f"\n\nTest artifacts in: {temp_dir}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
