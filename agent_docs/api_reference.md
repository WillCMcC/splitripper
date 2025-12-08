# FastAPI Endpoints Reference

All endpoints are in `src/server.py`.

## Search & Discovery

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/search?q=...&max=100` | GET | YouTube search |
| `/api/related?id=...&max=50` | GET | Related videos |
| `/api/video-info?url=...` | GET | Single video metadata |
| `/api/playlist?url=...&max=...` | GET | Playlist entries |
| `/api/channel?channelUrl=...` | GET | Channel uploads |

## Queue Management

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/queue` | GET | Get current queue state |
| `/api/queue` | POST | Add YouTube URLs: `{urls: [...], folder?: ""}` |
| `/api/queue-local` | POST | Add local files: `{files: [...], folder?: ""}` |
| `/api/start` | POST | Start processing queue |
| `/api/stop` | POST | Stop queue processing |
| `/api/clear` | POST | Clear queue |
| `/api/cancel/{item_id}` | POST | Cancel single item |

## Progress & Config

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/progress` | GET | Global progress + counts |
| `/api/listing-progress/{id}` | GET | Async listing progress |
| `/api/config` | GET | Get config |
| `/api/config` | POST | Update config: `{output_dir?, default_folder?}` |
| `/api/concurrency` | GET/POST | Get/set max parallel jobs |

## Utility

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/scan-directory?path=...` | GET | Find audio files in directory |
| `/api/check-exists?title=...` | GET | Check for duplicate stems |
| `/api/ytdlp/status` | GET | yt-dlp version info |
| `/api/ytdlp/update` | POST | Force yt-dlp update |
| `/api/_shutdown` | POST | Internal: graceful shutdown |

## Response Formats

Queue item structure (returned by `/api/queue`):
```json
{
  "id": "uuid",
  "url": "https://...",
  "title": "Song Name",
  "duration": 180,
  "channel": "Artist",
  "status": "queued|running|done|error|canceled",
  "progress": 0.0-1.0,
  "download_progress": 0.0-1.0,
  "processing": true/false,
  "downloaded": true/false,
  "error": "message if failed",
  "dest_path": "/path/to/output"
}
```
