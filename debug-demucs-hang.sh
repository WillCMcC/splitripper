#!/bin/bash
# Demucs Process Diagnostic Script
# Run this while Demucs is stuck/hanging

echo "=========================================="
echo "DEMUCS PROCESS DIAGNOSTIC"
echo "Timestamp: $(date)"
echo "=========================================="
echo ""

echo "1. DEMUCS PROCESSES"
echo "-------------------"
ps aux | grep -i demucs | grep -v grep
echo ""

echo "2. ALL PYTHON PROCESSES"
echo "-----------------------"
ps aux | grep python | grep -v grep
echo ""

echo "3. PROCESS TREE (showing parent-child relationships)"
echo "----------------------------------------------------"
# macOS uses different flags than Linux
pstree -p $$ 2>/dev/null || ps -ef | grep -E "python|demucs|splitripper" | grep -v grep
echo ""

echo "4. PYTHON PROCESS DETAILS (with state)"
echo "---------------------------------------"
ps -eo pid,ppid,state,user,time,command | grep python | grep -v grep
echo ""
echo "State codes: R=running, S=sleeping, D=uninterruptible sleep (stuck I/O), Z=zombie, T=stopped"
echo ""

echo "5. FINDING DEMUCS PIDs"
echo "----------------------"
DEMUCS_PIDS=$(ps aux | grep -i demucs | grep -v grep | awk '{print $2}')
if [ -z "$DEMUCS_PIDS" ]; then
    echo "No demucs processes found. Checking for python processes with 'separate' or 'demucs' args..."
    PYTHON_PIDS=$(ps aux | grep python | grep -v grep | awk '{print $2}')
    echo "Python PIDs: $PYTHON_PIDS"
else
    echo "Demucs PIDs: $DEMUCS_PIDS"
fi
echo ""

echo "6. OPEN FILES FOR EACH PROCESS"
echo "-------------------------------"
for pid in $DEMUCS_PIDS $PYTHON_PIDS; do
    if [ ! -z "$pid" ]; then
        echo "--- PID $pid ---"
        lsof -p $pid 2>/dev/null | head -50
        echo ""
    fi
done

echo "7. SYSTEM RESOURCE USAGE"
echo "------------------------"
echo "CPU and Memory for python processes:"
ps aux | grep python | grep -v grep | awk '{printf "PID: %s  CPU: %s%%  MEM: %s%%  CMD: %s\n", $2, $3, $4, substr($0, index($0,$11))}'
echo ""

echo "8. NETWORK CONNECTIONS (if any)"
echo "--------------------------------"
for pid in $DEMUCS_PIDS $PYTHON_PIDS; do
    if [ ! -z "$pid" ]; then
        lsof -i -a -p $pid 2>/dev/null
    fi
done
echo ""

echo "9. THREAD INFORMATION"
echo "---------------------"
for pid in $DEMUCS_PIDS $PYTHON_PIDS; do
    if [ ! -z "$pid" ]; then
        echo "Threads for PID $pid:"
        ps -M -p $pid 2>/dev/null | head -20
        echo ""
    fi
done

echo "10. PROCESS STACK TRACE (if available)"
echo "---------------------------------------"
echo "On macOS, you can use 'sample' command for detailed stack trace:"
for pid in $DEMUCS_PIDS; do
    if [ ! -z "$pid" ]; then
        echo "sample $pid 1 -file /tmp/demucs_stack_$pid.txt"
    fi
done
echo ""

echo "11. CHECK FOR ZOMBIE PROCESSES"
echo "-------------------------------"
ps aux | awk '$8=="Z" {print}' | grep -E "python|demucs"
echo ""

echo "=========================================="
echo "DIAGNOSTIC COMPLETE"
echo "=========================================="
echo ""
echo "NEXT STEPS:"
echo "1. If process is in 'D' state - it's stuck on I/O (disk/network)"
echo "2. If process is in 'Z' state - it's a zombie (parent didn't wait())"
echo "3. Check lsof output for locked files in /tmp or output directory"
echo "4. Look for multiple python processes that should have exited"
echo "5. Check if ffmpeg subprocess is also running (demucs uses it)"
echo ""
echo "To get detailed stack trace, run:"
echo "  sample <PID> 1 -file /tmp/stack_trace.txt"
echo ""
