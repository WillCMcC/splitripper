"""Tests for Demucs service."""
import pytest
from pathlib import Path


class TestParseDemucsProgress:
    """Test progress parsing from Demucs output."""

    def test_percentage_format(self):
        """Test parsing percentage format."""
        from services.demucs import parse_demucs_progress
        progress, eta = parse_demucs_progress("61%|... [01:14<00:47]")
        assert progress is not None
        assert 0.6 <= progress <= 0.62

    def test_no_progress_info(self):
        """Test handling lines without progress."""
        from services.demucs import parse_demucs_progress
        progress, eta = parse_demucs_progress("Loading model...")
        assert progress is None

    def test_fraction_format(self):
        """Test parsing fraction format like '146.25/239.85'."""
        from services.demucs import parse_demucs_progress
        progress, eta = parse_demucs_progress("146.25/239.85 [01:14<00:47, 1.97s/it]")
        assert progress is not None
        assert 0.6 <= progress <= 0.62

    def test_eta_parsing(self):
        """Test ETA parsing from progress line."""
        from services.demucs import parse_demucs_progress
        progress, eta = parse_demucs_progress("50%|... [01:00<01:30, 1.5s/it]")
        assert eta is not None
        assert eta == 90  # 1:30 = 90 seconds

    def test_empty_line(self):
        """Test handling empty line."""
        from services.demucs import parse_demucs_progress
        progress, eta = parse_demucs_progress("")
        assert progress is None
        assert eta is None

    def test_progress_capped_at_99(self):
        """Test that progress is capped at 0.99."""
        from services.demucs import parse_demucs_progress
        progress, eta = parse_demucs_progress("100%|... [01:00<00:00]")
        assert progress is not None
        assert progress <= 0.99


class TestFindDemucsOutputs:
    """Test finding Demucs output files."""

    def test_find_2stem_outputs(self, temp_dir):
        """Test finding 2-stem outputs."""
        from services.demucs import _find_demucs_outputs

        # Create fake output structure
        output_dir = temp_dir / "htdemucs" / "test_audio"
        output_dir.mkdir(parents=True)
        (output_dir / "vocals.mp3").write_bytes(b"fake")
        (output_dir / "no_vocals.mp3").write_bytes(b"fake")

        result = _find_demucs_outputs(temp_dir, "2", "htdemucs")
        assert result is not None
        assert "vocals" in result

    def test_find_4stem_outputs(self, temp_dir):
        """Test finding 4-stem outputs."""
        from services.demucs import _find_demucs_outputs

        # Create fake output structure for 4 stems
        output_dir = temp_dir / "htdemucs" / "test_audio"
        output_dir.mkdir(parents=True)
        for stem in ["vocals", "drums", "bass", "other"]:
            (output_dir / f"{stem}.mp3").write_bytes(b"fake")

        result = _find_demucs_outputs(temp_dir, "4", "htdemucs")
        assert result is not None
        assert "vocals" in result
        assert "drums" in result
        assert "bass" in result
        assert "other" in result

    def test_no_outputs_found(self, temp_dir):
        """Test handling when no outputs are found."""
        from services.demucs import _find_demucs_outputs

        # Empty directory
        result = _find_demucs_outputs(temp_dir, "2", "htdemucs")
        assert result is None
