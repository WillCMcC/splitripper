#!/bin/bash
# Real-time Demucs Process Monitor
# Run this in a separate terminal while processing is happening

echo "Demucs Live Process Monitor"
echo "============================"
echo "Press Ctrl+C to stop monitoring"
echo ""

while true; do
    clear
    echo "Timestamp: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "=========================================="
    echo ""

    # Find all Python processes
    PYTHON_PIDS=$(ps aux | grep python | grep -v grep | awk '{print $2}')
    PYTHON_COUNT=$(echo "$PYTHON_PIDS" | grep -v '^$' | wc -l | tr -d ' ')

    # Find Demucs-specific processes
    DEMUCS_PIDS=$(ps aux | grep -i demucs | grep -v grep | awk '{print $2}')
    DEMUCS_COUNT=$(echo "$DEMUCS_PIDS" | grep -v '^$' | wc -l | tr -d ' ')

    echo "Python Processes: $PYTHON_COUNT"
    echo "Demucs Processes: $DEMUCS_COUNT"
    echo ""

    if [ "$PYTHON_COUNT" -gt 0 ]; then
        echo "PROCESS DETAILS:"
        echo "----------------"
        printf "%-8s %-8s %-6s %-5s %-5s %-8s %s\n" "PID" "PPID" "STATE" "CPU%" "MEM%" "TIME" "COMMAND"
        ps -eo pid,ppid,state,pcpu,pmem,time,command | grep python | grep -v grep | while read line; do
            pid=$(echo "$line" | awk '{print $1}')
            ppid=$(echo "$line" | awk '{print $2}')
            state=$(echo "$line" | awk '{print $3}')
            cpu=$(echo "$line" | awk '{print $4}')
            mem=$(echo "$line" | awk '{print $5}')
            time=$(echo "$line" | awk '{print $6}')
            cmd=$(echo "$line" | awk '{for(i=7;i<=NF;i++) printf $i" "; print ""}' | cut -c1-60)

            # Highlight bad states
            if [ "$state" = "D" ]; then
                printf "\033[1;31m%-8s %-8s %-6s %-5s %-5s %-8s %s\033[0m\n" "$pid" "$ppid" "$state" "$cpu" "$mem" "$time" "$cmd"
            elif [ "$state" = "Z" ]; then
                printf "\033[1;33m%-8s %-8s %-6s %-5s %-5s %-8s %s\033[0m\n" "$pid" "$ppid" "$state" "$cpu" "$mem" "$time" "$cmd"
            else
                printf "%-8s %-8s %-6s %-5s %-5s %-8s %s\n" "$pid" "$ppid" "$state" "$cpu" "$mem" "$time" "$cmd"
            fi
        done
        echo ""
        echo "State: R=Running, S=Sleeping, D=Stuck(I/O), Z=Zombie"
        echo ""

        # Show open file descriptors for first Demucs process
        if [ ! -z "$DEMUCS_PIDS" ]; then
            FIRST_PID=$(echo "$DEMUCS_PIDS" | head -1)
            if [ ! -z "$FIRST_PID" ]; then
                FD_COUNT=$(lsof -p $FIRST_PID 2>/dev/null | wc -l | tr -d ' ')
                echo "Open File Descriptors (PID $FIRST_PID): $FD_COUNT"

                # Show pipes (potential issue)
                PIPE_COUNT=$(lsof -p $FIRST_PID 2>/dev/null | grep -i pipe | wc -l | tr -d ' ')
                if [ "$PIPE_COUNT" -gt 0 ]; then
                    echo "  - Pipes: $PIPE_COUNT (inherited FDs can prevent exit)"
                fi

                # Show audio files
                AUDIO_COUNT=$(lsof -p $FIRST_PID 2>/dev/null | grep -E '\.(mp3|wav|m4a|flac)' | wc -l | tr -d ' ')
                if [ "$AUDIO_COUNT" -gt 0 ]; then
                    echo "  - Audio files open: $AUDIO_COUNT"
                fi
                echo ""
            fi
        fi

        # Check temp directory
        if [ -d /tmp/splitboy_stems ]; then
            TEMP_SIZE=$(du -sh /tmp/splitboy_stems 2>/dev/null | awk '{print $1}')
            TEMP_FILES=$(find /tmp/splitboy_stems -type f 2>/dev/null | wc -l | tr -d ' ')
            echo "Temp Directory: /tmp/splitboy_stems"
            echo "  - Size: $TEMP_SIZE"
            echo "  - Files: $TEMP_FILES"
            echo ""
        fi

        # Check for ffmpeg
        FFMPEG_COUNT=$(ps aux | grep ffmpeg | grep -v grep | wc -l | tr -d ' ')
        if [ "$FFMPEG_COUNT" -gt 0 ]; then
            echo "ffmpeg Processes: $FFMPEG_COUNT"
            ps aux | grep ffmpeg | grep -v grep | awk '{printf "  PID %s: %s\n", $2, substr($0, index($0,$11))}'
            echo ""
        fi

    else
        echo "No Python processes found."
        echo ""
    fi

    # Check for zombie processes
    ZOMBIE_COUNT=$(ps aux | awk '$8=="Z"' | grep -E "python|demucs" | wc -l | tr -d ' ')
    if [ "$ZOMBIE_COUNT" -gt 0 ]; then
        echo "\033[1;33mWARNING: $ZOMBIE_COUNT zombie processes detected!\033[0m"
        ps aux | awk '$8=="Z"' | grep -E "python|demucs"
        echo ""
    fi

    echo "Refreshing in 2 seconds... (Ctrl+C to stop)"
    sleep 2
done
