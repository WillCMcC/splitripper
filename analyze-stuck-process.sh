#!/bin/bash
# Analyze a stuck Demucs process and attempt recovery

if [ -z "$1" ]; then
    echo "Usage: $0 <PID>"
    echo ""
    echo "Find PID with: ps aux | grep demucs"
    exit 1
fi

PID=$1

echo "Analyzing stuck process: $PID"
echo "=========================================="
echo ""

# Check if process exists
if ! ps -p $PID > /dev/null 2>&1; then
    echo "ERROR: Process $PID does not exist"
    exit 1
fi

# Get process info
echo "1. PROCESS INFORMATION"
echo "----------------------"
ps -fp $PID
echo ""

# Get detailed state
STATE=$(ps -o state= -p $PID)
echo "Process State: $STATE"
case $STATE in
    *D*)
        echo "  => Process is in UNINTERRUPTIBLE SLEEP (waiting for I/O)"
        echo "     This usually means disk/network operation is stuck"
        echo "     Cannot be killed with SIGTERM, may need SIGKILL"
        ;;
    *Z*)
        echo "  => Process is a ZOMBIE (already exited, waiting for parent)"
        echo "     Parent process needs to call wait()"
        ;;
    *S*)
        echo "  => Process is SLEEPING (waiting for event)"
        echo "     Normal for idle processes"
        ;;
    *R*)
        echo "  => Process is RUNNING"
        echo "     Actively executing code"
        ;;
    *T*)
        echo "  => Process is STOPPED (received SIGSTOP)"
        ;;
esac
echo ""

# Get parent process
PPID=$(ps -o ppid= -p $PID | tr -d ' ')
echo "2. PARENT PROCESS"
echo "-----------------"
if [ ! -z "$PPID" ]; then
    ps -fp $PPID
    echo ""
else
    echo "No parent process found"
    echo ""
fi

# Find child processes
echo "3. CHILD PROCESSES"
echo "------------------"
CHILDREN=$(pgrep -P $PID 2>/dev/null)
if [ ! -z "$CHILDREN" ]; then
    echo "Found child PIDs: $CHILDREN"
    ps -fp $CHILDREN
else
    echo "No child processes found"
fi
echo ""

# Check open files
echo "4. OPEN FILES (first 30)"
echo "------------------------"
lsof -p $PID 2>/dev/null | head -30
echo ""

# Count file descriptors
FD_COUNT=$(lsof -p $PID 2>/dev/null | wc -l | tr -d ' ')
echo "Total open file descriptors: $FD_COUNT"
echo ""

# Check for pipes
echo "5. PIPE FILE DESCRIPTORS"
echo "------------------------"
PIPE_COUNT=$(lsof -p $PID 2>/dev/null | grep -i pipe | wc -l | tr -d ' ')
echo "Pipe count: $PIPE_COUNT"
if [ "$PIPE_COUNT" -gt 0 ]; then
    echo "Pipes (showing first 10):"
    lsof -p $PID 2>/dev/null | grep -i pipe | head -10
    echo ""
    echo "WARNING: Pipes may indicate inherited file descriptors"
    echo "         from child processes that prevent process exit"
fi
echo ""

# Check for locked files
echo "6. LOCKED FILES"
echo "---------------"
lsof -p $PID 2>/dev/null | grep -i "lock"
LOCK_COUNT=$(lsof -p $PID 2>/dev/null | grep -i "lock" | wc -l | tr -d ' ')
if [ "$LOCK_COUNT" -eq 0 ]; then
    echo "No locked files found"
fi
echo ""

# Check threads
echo "7. THREAD INFORMATION"
echo "---------------------"
THREAD_COUNT=$(ps -M -p $PID 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
echo "Thread count: $THREAD_COUNT"
if [ "$THREAD_COUNT" -gt 0 ]; then
    echo "Threads (first 15):"
    ps -M -p $PID 2>/dev/null | head -16
fi
echo ""

# Get stack trace
echo "8. STACK TRACE"
echo "--------------"
echo "Capturing stack trace (this may take a few seconds)..."
TRACE_FILE="/tmp/stack_trace_${PID}_$(date +%s).txt"
sample $PID 1 -file $TRACE_FILE 2>/dev/null

if [ -f "$TRACE_FILE" ]; then
    echo "Stack trace saved to: $TRACE_FILE"
    echo ""
    echo "Top of stack trace:"
    head -50 "$TRACE_FILE"
    echo ""
    echo "Full trace available in: $TRACE_FILE"
else
    echo "Failed to capture stack trace"
fi
echo ""

# Check system resources
echo "9. SYSTEM RESOURCES"
echo "-------------------"
echo "CPU Usage:"
ps -o pid,pcpu,pmem,time,command -p $PID
echo ""
echo "Memory Info:"
vm_stat | grep -E "Pages (free|active|inactive|wired)"
echo ""
echo "Disk Space:"
df -h /tmp
echo ""

# Recovery suggestions
echo "=========================================="
echo "RECOVERY SUGGESTIONS"
echo "=========================================="
echo ""

if [[ $STATE == *"D"* ]]; then
    echo "Process is stuck in I/O wait:"
    echo "  1. Check disk health: diskutil verifyVolume /"
    echo "  2. Check for disk errors in Console app"
    echo "  3. May need to force kill: kill -9 $PID"
    echo "     (Warning: -9 prevents cleanup, use as last resort)"
elif [[ $STATE == *"Z"* ]]; then
    echo "Process is a zombie:"
    echo "  1. Kill parent process (PID $PPID) to clean up"
    echo "  2. Parent should call wait() to reap zombie"
elif [ "$PIPE_COUNT" -gt 5 ]; then
    echo "Many open pipes detected:"
    echo "  1. Child processes may have inherited pipe file descriptors"
    echo "  2. Try killing child processes first"
    if [ ! -z "$CHILDREN" ]; then
        echo "  3. Kill children: kill $CHILDREN"
    fi
    echo "  4. Then kill main process: kill $PID"
else
    echo "Process appears to be in normal state."
    echo "To terminate gracefully:"
    echo "  1. Send SIGTERM: kill $PID"
    echo "  2. Wait 5 seconds"
    echo "  3. If still running: kill -9 $PID"
fi
echo ""

# Optional: offer to kill
echo "=========================================="
echo "Would you like to attempt to kill this process? (y/N)"
read -r -n 1 RESPONSE
echo ""

if [[ $RESPONSE =~ ^[Yy]$ ]]; then
    echo "Sending SIGTERM to process $PID..."
    kill $PID
    sleep 2

    if ps -p $PID > /dev/null 2>&1; then
        echo "Process still running after SIGTERM"
        echo "Sending SIGKILL to process $PID..."
        kill -9 $PID
        sleep 1

        if ps -p $PID > /dev/null 2>&1; then
            echo "ERROR: Process still running after SIGKILL!"
            echo "Process may be stuck in kernel space (D state)"
        else
            echo "Process killed successfully with SIGKILL"
        fi
    else
        echo "Process terminated successfully with SIGTERM"
    fi

    # Check for orphaned children
    if [ ! -z "$CHILDREN" ]; then
        echo ""
        echo "Checking for orphaned child processes..."
        for child in $CHILDREN; do
            if ps -p $child > /dev/null 2>&1; then
                echo "Child process $child still running, killing..."
                kill -9 $child 2>/dev/null
            fi
        done
    fi
else
    echo "Process analysis complete. No action taken."
fi
