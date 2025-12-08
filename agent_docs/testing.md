# Testing

## Running Tests

```bash
npm test           # Full test suite with verbose output
npm run test:quick # Quick test run (-q flag)
```

Both use pytest on the `tests/` directory.

## Test Files

| File | Coverage |
|------|----------|
| `tests/test_lib_config.py` | Config loading, sanitization, defaults |
| `tests/test_lib_state.py` | AppState thread safety, queue operations |
| `tests/test_lib_utils.py` | Utility functions |
| `tests/test_lib_metadata.py` | Audio metadata extraction |
| `tests/test_lib_ytdlp_updater.py` | yt-dlp auto-update logic |
| `tests/test_ytdl_interactive.py` | YouTube search/info helpers |

## Test Patterns

Tests use standard pytest conventions:
- Fixtures in individual test files
- Mocking for external services (yt-dlp, filesystem)
- Thread safety tests for state module

## Adding Tests

1. Create `tests/test_<module>.py`
2. Import from `src/lib/` or `src/`
3. Use pytest fixtures for setup/teardown
