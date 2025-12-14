# Quick Diagnostic Reference - Demucs Hang Issues

## When Progress Gets Stuck

### Step 1: Run Live Monitor (Recommended)
```bash
./monitor-demucs-live.sh
```
This shows real-time process state, CPU usage, and warns about issues.

### Step 2: Run Full Diagnostic
```bash
./debug-demucs-hang.sh > diagnostic_$(date +%Y%m%d_%H%M%S).txt
```
Save output for later analysis.

### Step 3: Analyze Specific Process
```bash
# First find the PID
ps aux | grep demucs

# Then analyze it
./analyze-stuck-process.sh <PID>
```

## Quick Manual Checks

### 1. Find the stuck process
```bash
ps aux | grep -i demucs | grep -v grep
```

### 2. Check if it's truly stuck (not processing)
```bash
# Look at CPU usage - should be >100% if processing
ps aux | grep demucs | grep -v grep | awk '{print $2, $3}'  # PID, CPU%
```

### 3. Check process state
```bash
ps -o pid,state,command -p <PID>
# D = stuck on I/O (bad)
# Z = zombie (bad)
# R/S = normal
```

### 4. See what files it has open
```bash
lsof -p <PID> | head -20
```

## Common Patterns and Fixes

### Pattern 1: CPU at 0%, State = D (Uninterruptible Sleep)
**Cause**: Waiting for disk I/O that's stuck
**Evidence**:
```bash
ps aux | grep python | grep " D "
```
**Fix**:
- Check disk health
- May need `kill -9` (won't respond to SIGTERM)
- Check for full disk

### Pattern 2: Multiple Python Processes After Completion
**Cause**: PyTorch worker processes didn't exit, inherited pipe FDs
**Evidence**:
```bash
ps aux | grep python | wc -l  # Should be 1-2, not 5+
lsof -p <PID> | grep pipe  # Many pipes = inherited FDs
```
**Fix**:
- Kill child processes first: `pkill -P <PARENT_PID>`
- Then kill main process: `kill <PID>`
- Code already has `close_fds=True` but may need explicit child tracking

### Pattern 3: Process Shows as Zombie (Z)
**Cause**: Process exited but parent didn't call wait()
**Evidence**:
```bash
ps aux | awk '$8=="Z"' | grep python
```
**Fix**:
- Kill parent process (FastAPI server)
- Parent needs to call `proc.wait()`

### Pattern 4: Progress Stuck at 99%
**Cause**: Demucs finished but reader thread waiting for EOF
**Evidence**:
- Process state = S (sleeping)
- Low CPU usage
- Open pipes in lsof output
**Fix**:
- Check if `proc.stdout.close()` is called (line 216 in demucs.py)
- Verify reader thread joins with timeout (line 219)

## What the Code Does (Current State)

**Good Things Already Implemented:**
1. ✅ `close_fds=True` (line 147) - prevents FD inheritance
2. ✅ Reader thread with queue (line 157-168) - non-blocking reads
3. ✅ Explicit `stdout.close()` (line 215-216) - signals EOF
4. ✅ Reader thread timeout join (line 219) - won't hang forever
5. ✅ Daemon threads (line 167) - exit with main process

**Potential Issues:**
1. ⚠️ No explicit child process tracking/cleanup
2. ⚠️ No timeout on overall Demucs execution
3. ⚠️ PyTorch workers may not receive termination signal
4. ⚠️ No check for process in D state before wait()

## Interpreting lsof Output

### Normal (Healthy):
```
python    12345   user  cwd    DIR   /tmp/splitboy_stems
python    12345   user  txt    REG   /usr/bin/python3
python    12345   user    0u   CHR   /dev/null
python    12345   user    1u   CHR   /dev/null
python    12345   user    3r   REG   /path/to/input.mp3
python    12345   user    4w   REG   /path/to/vocals.mp3
```

### Problematic (Stuck):
```
python    12345   user    5u  PIPE  0x... (no other process)
python    12345   user    6u  PIPE  0x... (inherited from child)
python    12345   user    7r   REG  /some/file (size not changing)
python    12345   user  txt    REG  /lib/libsomething.so (D state)
```

**Red flags in lsof:**
- Many open pipes (`PIPE`)
- Files opened for write but not being written to
- Network sockets (shouldn't exist for Demucs)
- Locked database files

## Stack Trace Interpretation

Get stack trace:
```bash
sample <PID> 1 -file /tmp/stack.txt
cat /tmp/stack.txt
```

### Look for:
- **Stuck in I/O**: `read()`, `write()`, `close()` in kernel space
- **Waiting on lock**: `pthread_mutex_lock`, `sem_wait`
- **Subprocess wait**: `wait4()`, `waitpid()`
- **Pipe operations**: `pipe_read`, `pipe_write`

### Example problematic stack:
```
python (PID)
  libsystem_kernel.dylib`read
  libpython.dylib`_io_read
  Python code: for line in proc.stdout
```
This shows blocked on reading from subprocess pipe.

## Prevention Tips

1. **Monitor during normal operation**: Run `monitor-demucs-live.sh` during a successful run to see baseline behavior

2. **Check temp directory regularly**:
   ```bash
   du -sh /tmp/splitboy_stems
   ```

3. **Watch for PyTorch warnings**:
   ```bash
   # In server logs, look for:
   # - "UserWarning: Failed to initialize NumPy"
   # - "RuntimeError: DataLoader worker"
   ```

4. **Test with small files first**: Process a 30-second track to verify setup

## Emergency Recovery

If app is completely stuck:

```bash
# 1. Find all Python processes
ps aux | grep python | grep -v grep

# 2. Find parent process (FastAPI server)
ps aux | grep server.py

# 3. Kill all gracefully
pkill -f "server.py"
pkill -f demucs

# 4. Force kill if needed
pkill -9 -f "server.py"
pkill -9 -f demucs

# 5. Clean up temp files
rm -rf /tmp/splitboy_stems/*
rm -rf /tmp/splitboy_downloads/*
```

## When to Report a Bug

Collect this information:
1. Output of `debug-demucs-hang.sh`
2. Stack trace from `sample` command
3. App version and macOS version
4. Demucs model being used
5. Input file characteristics (size, format, duration)
6. Reproducible steps

## Quick Sanity Checks

### Is Python/Demucs installed correctly?
```bash
python3 -m demucs --help
```

### Is ffmpeg accessible?
```bash
/Users/will/Code/splitripper/python_runtime_bundle/ffmpeg/ffmpeg -version
```

### Is there disk space?
```bash
df -h /tmp
df -h ~/Desktop
```

### Are processes actually running?
```bash
top -l 1 | grep python
```

## Resource Limits

Normal resource usage:
- **CPU**: 100-400% (using multiple cores)
- **Memory**: 500MB - 2GB (depending on model)
- **Disk I/O**: Moderate reads/writes
- **Processes**: 1-4 Python processes
- **File Descriptors**: <50

Concerning thresholds:
- **CPU**: 0% for >30 seconds = stuck
- **Memory**: >4GB = possible memory leak
- **Processes**: >6 Python processes = worker leak
- **File Descriptors**: >100 = FD leak

---

Last updated: 2025-12-13
