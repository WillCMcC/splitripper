# Queue Processing System

## Overview

The queue system processes items through two phases:
1. **Download** (30% of progress) - yt-dlp downloads audio
2. **Processing** (70% of progress) - Demucs separates stems

Weights defined in `src/lib/constants.py:8-11`.

## Queue Item Lifecycle

```
queued -> running -> done
                  -> error
                  -> canceled
```

State machine in `src/lib/state.py:19-85` (`QueueItem` dataclass).

## Worker Implementation

Main worker loop: `src/server.py:553-599` (`download_worker`)

1. Launches items up to `max_concurrency` (default: 4)
2. Each item runs in a daemon thread
3. Polls every 0.3s for new work or completion
4. Respects `stop_event` for graceful cancellation

## Processing Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `_process_item` | `server.py:545-550` | Routes to local/YouTube handler |
| `_process_youtube_item` | `server.py:397-542` | Download + split |
| `_process_local_item` | `server.py:346-394` | Local file split |
| `_split_and_stage` | `server.py:281-343` | Run Demucs + move outputs |
| `run_demucs_separation` | `server.py:141-230` | Demucs subprocess |

## Progress Updates

- Download progress: Updated in yt-dlp `progress_hook` (`server.py:429-458`)
- Processing progress: Parsed from Demucs tqdm output (`server.py:90-123`)
- Global progress: Aggregated in `AppState.global_progress()` (`state.py:297-317`)

## Output Structure

```
output_dir/
  Artist Name/
    vocals/
      Song Title.mp3
    instrumental/
      Song Title.mp3
```

Artist parsed from "Artist - Song" format, or falls back to channel name.
