#!/usr/bin/env python3
"""
Simple runner for the splitripper application.
This runs the server from the reorganized src/ directory.
"""

import os
import sys
from pathlib import Path

# Add src directory to Python path
src_dir = Path(__file__).parent / "src"
sys.path.insert(0, str(src_dir))

# Change to src directory so relative paths work correctly
os.chdir(src_dir)

# Import and run the server
from server import app
import uvicorn

if __name__ == "__main__":
    print("Starting splitripper server on http://127.0.0.1:9000")
    print("Press Ctrl+C to stop")
    uvicorn.run(app, host="127.0.0.1", port=9000)