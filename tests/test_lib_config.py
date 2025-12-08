"""
Tests for lib/config module.
"""

import json
import sys
import tempfile
from pathlib import Path

# Add src to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from lib.config import Config, get_default_desktop_path, is_foreign_user_path


class TestGetDefaultDesktopPath:
    """Tests for get_default_desktop_path function."""

    def test_returns_string(self):
        """Test that function returns a string path."""
        result = get_default_desktop_path()
        assert isinstance(result, str)
        assert len(result) > 0

    def test_path_exists_or_home(self):
        """Test that returned path exists or is home directory."""
        result = get_default_desktop_path()
        # Should either be Desktop or a fallback that exists
        assert Path(result).exists() or result == str(Path.home())


class TestIsForeignUserPath:
    """Tests for is_foreign_user_path function."""

    def test_current_user_path(self):
        """Test current user's path is not foreign."""
        home = Path.home()
        assert is_foreign_user_path(home) is False
        assert is_foreign_user_path(home / "Desktop") is False

    def test_volume_path(self):
        """Test /Volumes paths are not considered foreign."""
        vol_path = Path("/Volumes/ExternalDrive/folder")
        assert is_foreign_user_path(vol_path) is False

    def test_system_path(self):
        """Test system paths are not foreign."""
        sys_path = Path("/usr/local/bin")
        assert is_foreign_user_path(sys_path) is False


class TestConfig:
    """Tests for Config class."""

    def test_load_nonexistent_file(self):
        """Test loading from nonexistent file uses defaults."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config = Config(config_path)

            assert config.max_concurrency > 0
            assert config.default_folder == ""

    def test_save_and_load(self):
        """Test config persistence."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"

            # Create and save config
            config1 = Config(config_path)
            config1.update({"default_folder": "TestFolder"})

            # Load in new instance
            config2 = Config(config_path)
            assert config2.default_folder == "TestFolder"

    def test_get_with_default(self):
        """Test get with default value."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config = Config(config_path)

            assert config.get("nonexistent", "default_value") == "default_value"
            assert config.get("nonexistent") is None

    def test_as_dict(self):
        """Test as_dict returns a copy."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config = Config(config_path)

            d = config.as_dict()
            d["output_dir"] = "/modified/path"

            # Original should be unchanged
            assert config.output_dir != "/modified/path"

    def test_update_filters_disabled_keys(self):
        """Test that disabled cookie keys are filtered out."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config = Config(config_path)

            config.update({
                "default_folder": "MyFolder",
                "cookies_file": "/should/be/ignored",
                "cookies_from_browser": {"browser": "chrome"}
            })

            # cookies keys should not be saved
            d = config.as_dict()
            assert "cookies_file" not in d
            assert "cookies_from_browser" not in d
            assert d["default_folder"] == "MyFolder"
