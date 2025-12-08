#!/bin/bash
# Setup script for SplitRipper (local output-only downloader)

set -e

echo "Setting up SplitRipper (local output-only)..."

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi
echo "✓ Python 3 is available"

# Install core Python deps
echo "Installing Python dependencies (fastapi, uvicorn, yt-dlp)..."
pip3 install --upgrade pip
pip3 install fastapi "uvicorn[standard]" yt-dlp

echo "✓ Dependencies installed"

cat << 'EOF'

SplitRipper is configured to save ONLY inside a single output directory.

Defaults:
  output_dir: /output at the repository root
             (i.e. /Users/will/Code/splitripper/output on this machine)

Start the server:
  cd setripper/setripper
  python3 server.py

Open the UI:
  http://127.0.0.1:9000

In the UI (Settings → Output folder) you can change the output_dir.
All intermediate downloads are staged under: output_dir/_downloads
Final stems are saved as:
  output_dir/Artist/vocals/Song.wav
  output_dir/Artist/instrumental/Song.wav

Note:
- Legacy NAS scripts (download_to_nas.py, populate_thumbnails.py, organize.py, thumbnail_ids.py)
  are deprecated and no longer used.

EOF

echo "✓ Setup complete!"
