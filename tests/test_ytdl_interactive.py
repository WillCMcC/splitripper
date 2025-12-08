"""
Tests for ytdl_interactive module.
"""

import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from ytdl_interactive import extract_video_id, format_duration


class TestExtractVideoId:
    """Tests for extract_video_id function."""

    def test_plain_video_id(self):
        """Test extracting a plain 11-character video ID."""
        assert extract_video_id("dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_standard_youtube_url(self):
        """Test standard youtube.com/watch?v= URL."""
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_youtube_url_with_extra_params(self):
        """Test URL with additional query parameters."""
        url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest&t=120"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_short_url(self):
        """Test youtu.be short URL."""
        url = "https://youtu.be/dQw4w9WgXcQ"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_short_url_with_timestamp(self):
        """Test youtu.be URL with timestamp parameter."""
        url = "https://youtu.be/dQw4w9WgXcQ?t=42"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_embed_url(self):
        """Test youtube.com/embed/ URL."""
        url = "https://www.youtube.com/embed/dQw4w9WgXcQ"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_embed_url_with_params(self):
        """Test embed URL with query parameters."""
        url = "https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_old_v_url(self):
        """Test old youtube.com/v/ URL format."""
        url = "https://www.youtube.com/v/dQw4w9WgXcQ"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_url_without_protocol(self):
        """Test URL without https:// prefix."""
        url = "youtube.com/watch?v=dQw4w9WgXcQ"
        assert extract_video_id(url) == "dQw4w9WgXcQ"

    def test_invalid_input_none(self):
        """Test with None input."""
        assert extract_video_id(None) is None

    def test_invalid_input_number(self):
        """Test with numeric input."""
        assert extract_video_id(12345) is None

    def test_invalid_url(self):
        """Test with unrelated URL."""
        assert extract_video_id("https://example.com/video") is None

    def test_empty_string(self):
        """Test with empty string."""
        assert extract_video_id("") is None


class TestFormatDuration:
    """Tests for format_duration function."""

    def test_zero_seconds(self):
        """Test with 0 seconds."""
        assert format_duration(0) == "Unknown"

    def test_none_input(self):
        """Test with None input."""
        assert format_duration(None) == "Unknown"

    def test_under_minute(self):
        """Test duration under a minute."""
        assert format_duration(45) == "00:45"

    def test_exact_minute(self):
        """Test exactly one minute."""
        assert format_duration(60) == "01:00"

    def test_minutes_and_seconds(self):
        """Test minutes and seconds."""
        assert format_duration(185) == "03:05"

    def test_under_hour(self):
        """Test 59 minutes 59 seconds."""
        assert format_duration(3599) == "59:59"

    def test_exact_hour(self):
        """Test exactly one hour."""
        assert format_duration(3600) == "01:00:00"

    def test_hours_minutes_seconds(self):
        """Test full HH:MM:SS format."""
        assert format_duration(7325) == "02:02:05"

    def test_many_hours(self):
        """Test double-digit hours."""
        assert format_duration(36000) == "10:00:00"
