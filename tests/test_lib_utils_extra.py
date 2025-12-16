"""Additional tests for lib/utils module (filename sanitization and parsing)."""

import pytest
from unittest.mock import MagicMock, patch


class TestSanitizeName:
    """Test filename sanitization."""

    def test_removes_invalid_chars(self):
        """Test that invalid chars are removed."""
        from lib.utils import sanitize_filename

        result = sanitize_filename('Test <file>: "name"')
        assert "<" not in result
        assert ">" not in result
        assert ":" not in result
        assert '"' not in result

    def test_empty_returns_untitled(self):
        """Test that empty string returns 'untitled'."""
        from lib.utils import sanitize_filename

        assert sanitize_filename("") == "untitled"
        assert sanitize_filename(None) == "untitled"

    def test_whitespace_normalization(self):
        """Test that multiple whitespace is normalized."""
        from lib.utils import sanitize_filename

        result = sanitize_filename("Test   multiple   spaces")
        assert "  " not in result

    def test_max_length(self):
        """Test that result is truncated to max_length."""
        from lib.utils import sanitize_filename

        long_name = "a" * 200
        result = sanitize_filename(long_name, max_length=50)
        assert len(result) <= 50


class TestParseArtistSong:
    """Test artist/song parsing."""

    def test_standard_format(self):
        """Test 'Artist - Song' format."""
        from lib.utils import parse_artist_song

        artist, song = parse_artist_song("Queen - Bohemian Rhapsody", None)
        assert artist == "Queen"
        assert song == "Bohemian Rhapsody"

    def test_no_separator(self):
        """Test title without separator uses fallback."""
        from lib.utils import parse_artist_song

        artist, song = parse_artist_song("Just A Title", "Channel Name")
        assert artist == "Channel Name"
        assert song == "Just A Title"

    def test_empty_title(self):
        """Test empty title returns untitled."""
        from lib.utils import parse_artist_song

        artist, song = parse_artist_song("", "Channel")
        assert song == "untitled"

    def test_en_dash_separator(self):
        """Test en-dash separator."""
        from lib.utils import parse_artist_song

        artist, song = parse_artist_song("Artist \u2013 Song Title", None)
        assert artist == "Artist"
        assert song == "Song Title"

    def test_em_dash_separator(self):
        """Test em-dash separator."""
        from lib.utils import parse_artist_song

        artist, song = parse_artist_song("Artist \u2014 Song Title", None)
        assert artist == "Artist"
        assert song == "Song Title"


class TestParseTimeToSeconds:
    """Test time string parsing."""

    def test_mm_ss_format(self):
        """Test MM:SS format."""
        from lib.utils import parse_time_to_seconds

        assert parse_time_to_seconds("01:30") == 90

    def test_hh_mm_ss_format(self):
        """Test HH:MM:SS format."""
        from lib.utils import parse_time_to_seconds

        assert parse_time_to_seconds("01:30:00") == 5400

    def test_zero_time(self):
        """Test zero time."""
        from lib.utils import parse_time_to_seconds

        assert parse_time_to_seconds("00:00") == 0

    def test_invalid_format(self):
        """Test invalid format returns None."""
        from lib.utils import parse_time_to_seconds

        assert parse_time_to_seconds("invalid") is None
        assert parse_time_to_seconds("1:2:3:4") is None
