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

    def test_find_6stem_outputs(self, temp_dir):
        """Test finding 6-stem outputs."""
        from services.demucs import _find_demucs_outputs

        # Create fake output structure for 6 stems
        output_dir = temp_dir / "htdemucs_6s" / "test_audio"
        output_dir.mkdir(parents=True)
        for stem in ["vocals", "drums", "bass", "other", "piano", "guitar"]:
            (output_dir / f"{stem}.mp3").write_bytes(b"fake")

        result = _find_demucs_outputs(temp_dir, "6", "htdemucs_6s")
        assert result is not None
        assert len(result) == 6
        assert "vocals" in result
        assert "piano" in result
        assert "guitar" in result

    def test_find_wav_outputs(self, temp_dir):
        """Test finding WAV format outputs."""
        from services.demucs import _find_demucs_outputs

        # Create fake output structure with WAV files
        output_dir = temp_dir / "htdemucs" / "test_audio"
        output_dir.mkdir(parents=True)
        (output_dir / "vocals.wav").write_bytes(b"fake")
        (output_dir / "no_vocals.wav").write_bytes(b"fake")

        result = _find_demucs_outputs(temp_dir, "2", "htdemucs")
        assert result is not None
        assert str(result["vocals"]).endswith(".wav")

    def test_partial_outputs_not_returned(self, temp_dir):
        """Test that partial outputs return None for strict modes."""
        from services.demucs import _find_demucs_outputs

        # Create partial output (only 2 of 4 stems)
        output_dir = temp_dir / "htdemucs" / "test_audio"
        output_dir.mkdir(parents=True)
        (output_dir / "vocals.mp3").write_bytes(b"fake")
        (output_dir / "drums.mp3").write_bytes(b"fake")
        # Missing: bass, other

        result = _find_demucs_outputs(temp_dir, "4", "htdemucs")
        # Should return None because not all 4 stems are present
        assert result is None


class TestRunDemucsSeparation:
    """Test run_demucs_separation function with mocked subprocess."""

    def test_selects_correct_model_for_6stem(
        self, temp_dir, sample_audio_file, mock_app_state
    ):
        """Test that 6-stem mode automatically selects htdemucs_6s model."""
        from lib.state import QueueItem
        from services.demucs import run_demucs_separation
        from unittest.mock import patch, MagicMock

        item = QueueItem(
            id="test-demucs-1",
            url="test",
            title="Test",
            stem_mode="6",
        )
        mock_app_state.add_to_queue(item)

        captured_cmd = []

        def mock_popen(cmd, **kwargs):
            captured_cmd.extend(cmd)
            mock_proc = MagicMock()
            mock_proc.stdout = MagicMock()
            mock_proc.stdout.__iter__ = lambda s: iter([])
            mock_proc.poll.return_value = 0
            mock_proc.returncode = 0
            mock_proc.wait.return_value = 0
            return mock_proc

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            with patch("subprocess.Popen", side_effect=mock_popen):
                with patch("services.demucs._find_demucs_outputs") as mock_find:
                    mock_find.return_value = None
                    run_demucs_separation(sample_audio_file, temp_dir, item)

        # Check that htdemucs_6s was used
        assert "htdemucs_6s" in captured_cmd

    def test_model_fallback_for_invalid_model(
        self, temp_dir, sample_audio_file, mock_app_state
    ):
        """Test that invalid model names fall back to default."""
        from lib.state import QueueItem
        from services.demucs import run_demucs_separation
        from lib.constants import DEFAULT_DEMUCS_MODEL
        from unittest.mock import patch, MagicMock

        item = QueueItem(
            id="test-demucs-2",
            url="test",
            title="Test",
        )
        mock_app_state.add_to_queue(item)

        captured_cmd = []

        def mock_popen(cmd, **kwargs):
            captured_cmd.extend(cmd)
            mock_proc = MagicMock()
            mock_proc.stdout = MagicMock()
            mock_proc.stdout.__iter__ = lambda s: iter([])
            mock_proc.poll.return_value = 0
            mock_proc.returncode = 0
            mock_proc.wait.return_value = 0
            return mock_proc

        # Set an invalid model in config
        mock_app_state.update_config({"demucs_model": "invalid_model_name"})

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(returncode=0)
            with patch("subprocess.Popen", side_effect=mock_popen):
                with patch("services.demucs._find_demucs_outputs") as mock_find:
                    mock_find.return_value = None
                    run_demucs_separation(sample_audio_file, temp_dir, item)

        # Check that default model was used
        assert DEFAULT_DEMUCS_MODEL in captured_cmd
