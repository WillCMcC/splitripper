"""
Tests for lib/metadata module.
"""

import sys
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lib.metadata import _parse_filename, get_title_from_path


class TestParseFilename:
    """Tests for _parse_filename function."""

    def test_artist_dash_title(self):
        """Test 'Artist - Title.mp3' format."""
        artist, title = _parse_filename("/path/to/Artist - Song Title.mp3")
        assert artist == "Artist"
        assert title == "Song Title"

    def test_title_only(self):
        """Test filename without artist separator."""
        artist, title = _parse_filename("/path/to/Just A Song.mp3")
        assert artist is None
        assert title == "Just A Song"

    def test_multiple_dashes(self):
        """Test filename with multiple dashes (only first used as separator)."""
        artist, title = _parse_filename("/path/to/The Band - Song - Live Version.mp3")
        assert artist == "The Band"
        assert title == "Song - Live Version"

    def test_whitespace_handling(self):
        """Test whitespace is trimmed."""
        artist, title = _parse_filename("/path/to/  Artist  -  Title  .mp3")
        assert artist == "Artist"
        assert title == "Title"

    def test_empty_artist(self):
        """Test empty artist part."""
        artist, title = _parse_filename("/path/to/ - Title.mp3")
        assert artist is None
        assert title == "Title"

    def test_nested_path(self):
        """Test deeply nested path."""
        artist, title = _parse_filename("/music/rock/2020/Band - Track.flac")
        assert artist == "Band"
        assert title == "Track"


class TestGetTitleFromPath:
    """Tests for get_title_from_path function."""

    def test_simple_filename(self):
        """Test simple filename."""
        assert get_title_from_path("/path/to/song.mp3") == "song"

    def test_filename_with_spaces(self):
        """Test filename with spaces."""
        assert get_title_from_path("/path/My Favorite Song.wav") == "My Favorite Song"

    def test_filename_with_dots(self):
        """Test filename with dots (only last one is extension)."""
        assert get_title_from_path("/path/Track.01.mp3") == "Track.01"

    def test_no_extension(self):
        """Test file without extension."""
        assert get_title_from_path("/path/noext") == "noext"
