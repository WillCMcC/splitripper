"""
Tests for lib/utils module.
"""

import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lib.utils import format_duration, is_audio_file, clamp, truncate_string


class TestFormatDuration:
    """Tests for format_duration function."""

    def test_zero_seconds(self):
        assert format_duration(0) == "Unknown"

    def test_none_input(self):
        assert format_duration(None) == "Unknown"

    def test_under_minute(self):
        assert format_duration(45) == "00:45"

    def test_exact_minute(self):
        assert format_duration(60) == "01:00"

    def test_minutes_and_seconds(self):
        assert format_duration(185) == "03:05"

    def test_exact_hour(self):
        assert format_duration(3600) == "01:00:00"

    def test_hours_minutes_seconds(self):
        assert format_duration(7325) == "02:02:05"


class TestIsAudioFile:
    """Tests for is_audio_file function."""

    def test_mp3_file(self):
        assert is_audio_file("song.mp3") is True

    def test_wav_file(self):
        assert is_audio_file("audio.wav") is True

    def test_flac_file(self):
        assert is_audio_file("music.flac") is True

    def test_m4a_file(self):
        assert is_audio_file("track.m4a") is True

    def test_ogg_file(self):
        assert is_audio_file("audio.ogg") is True

    def test_opus_file(self):
        assert is_audio_file("podcast.opus") is True

    def test_case_insensitive(self):
        assert is_audio_file("SONG.MP3") is True
        assert is_audio_file("Audio.WAV") is True

    def test_video_file(self):
        assert is_audio_file("video.mp4") is False
        assert is_audio_file("movie.mkv") is False

    def test_text_file(self):
        assert is_audio_file("readme.txt") is False

    def test_no_extension(self):
        assert is_audio_file("noextension") is False

    def test_none_input(self):
        assert is_audio_file(None) is False

    def test_empty_string(self):
        assert is_audio_file("") is False


class TestClamp:
    """Tests for clamp function."""

    def test_value_in_range(self):
        assert clamp(5, 0, 10) == 5

    def test_value_below_min(self):
        assert clamp(-5, 0, 10) == 0

    def test_value_above_max(self):
        assert clamp(15, 0, 10) == 10

    def test_value_at_min(self):
        assert clamp(0, 0, 10) == 0

    def test_value_at_max(self):
        assert clamp(10, 0, 10) == 10


class TestTruncateString:
    """Tests for truncate_string function."""

    def test_short_string(self):
        assert truncate_string("hello", 10) == "hello"

    def test_exact_length(self):
        assert truncate_string("hello", 5) == "hello"

    def test_truncated_with_default_suffix(self):
        assert truncate_string("hello world", 8) == "hello..."

    def test_truncated_with_custom_suffix(self):
        assert truncate_string("hello world", 8, "~") == "hello w~"

    def test_empty_string(self):
        assert truncate_string("", 10) == ""
