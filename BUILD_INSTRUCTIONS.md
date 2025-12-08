# SplitRipper Build Instructions

## Overview

This document explains how to build and package the SplitRipper Electron app with all dependencies bundled, including the Python runtime and FastAPI server.

## Prerequisites

### For Development

- Node.js (v14 or higher)
- Python 3.9+ with conda (preferred) or system Python
- Git

### For Building

- All development prerequisites
- Platform-specific tools:
  - **macOS**: Xcode Command Line Tools
  - **Windows**: Visual Studio Build Tools
  - **Linux**: build-essential package

## Build Process

### Step 1: Install Node Dependencies

```bash
npm install
```

### Step 2: Create Python Bundle

The Python bundle includes Python runtime and all required packages (fastapi, uvicorn, yt-dlp, mutagen).

```bash
npm run bundle-python
```

Or manually:

```bash
node build-python-bundle.js
```

This will create a `python_runtime_bundle/` directory containing:

- A standalone Python environment (conda env or venv)
- All required Python packages
- A wrapper script for executing Python

### Step 3: Build the Application

```bash
npm run build
```

This will:

1. Automatically run the Python bundling script (via prebuild hook)
2. Package the Electron app with all resources
3. Create platform-specific installers in the `dist/` directory

## Build Outputs

After building, you'll find in the `dist/` directory:

- **macOS**: `.dmg` installer
- **Windows**: `.exe` installer (NSIS)
- **Linux**: `.AppImage` file

## How It Works

### Development Mode

When running in development (`npm run electron-dev`):

- Uses your local conda environment
- Runs the FastAPI server using `conda run -n base python src/server.py`
- No bundled Python is used

### Production Mode

When running the built app:

- Uses the bundled Python runtime from `python_runtime_bundle/`
- All Python dependencies are included in the bundle
- No external Python installation required

### Python Bundle Structure

The bundled Python includes:

```
python_runtime_bundle/
├── python (or python.exe on Windows)  # Wrapper script
├── env/ or venv/                      # Python environment
│   ├── bin/ (or Scripts/ on Windows)
│   ├── lib/
│   └── site-packages/
│       ├── fastapi/
│       ├── uvicorn/
│       ├── yt_dlp/
│       └── mutagen/
```

## Platform-Specific Notes

### macOS

- The build script tries to use conda first, falls back to venv
- For Apple Silicon Macs, ensure you have Rosetta 2 installed for x86_64 compatibility
- The app is signed with ad-hoc signature by default

### Windows

- Uses embedded Python distribution for minimal size
- All dependencies are installed in the embedded Python
- Requires Windows 10 or higher

### Linux

- Uses Python venv for compatibility
- Creates an AppImage for distribution
- Works on most modern Linux distributions

## Troubleshooting

### Python Bundle Creation Fails

1. **Conda not found**: Install Miniconda or use system Python
2. **pip install fails**: Check internet connection and proxy settings
3. **Permission errors**: Run with appropriate permissions or use sudo (Linux/macOS)

### FastAPI Server Doesn't Start in Built App

1. Check the Electron developer console for errors:

   - Open the built app
   - Press Cmd+Option+I (macOS) or Ctrl+Shift+I (Windows/Linux)
   - Look for Python-related errors in the console

2. Verify the Python bundle was created:

   ```bash
   ls -la python_runtime_bundle/
   ```

3. Test the Python bundle manually:
   ```bash
   ./python_runtime_bundle/python -c "import fastapi, uvicorn, yt_dlp, mutagen; print('All modules imported successfully')"
   ```

### Build Fails

1. **electron-builder errors**:

   - Clear node_modules and reinstall: `rm -rf node_modules && npm install`
   - Clear electron-builder cache: `rm -rf ~/Library/Caches/electron-builder/` (macOS)

2. **Missing dependencies**:
   - Ensure all files in the `files` array in package.json exist
   - Verify python_runtime_bundle was created before building

## Testing the Build

1. After building, test the app:

   ```bash
   # macOS
   open dist/SplitRipper-*.dmg

   # Windows
   dist/SplitRipper-*.exe

   # Linux
   ./dist/SplitRipper-*.AppImage
   ```

2. Verify the server starts:
   - The app should load after a 2-second delay
   - Check the developer console for server startup messages
   - The UI should be accessible at http://localhost:9000

## Continuous Integration

For CI/CD pipelines, you can automate the build process:

```yaml
# Example GitHub Actions workflow
- name: Setup Node
  uses: actions/setup-node@v3
  with:
    node-version: "18"

- name: Setup Python
  uses: actions/setup-python@v4
  with:
    python-version: "3.9"

- name: Install dependencies
  run: npm install

- name: Build Python bundle
  run: npm run bundle-python

- name: Build app
  run: npm run build
```

## Distribution

### Code Signing (Optional)

For distribution outside app stores:

- **macOS**: Sign with Developer ID certificate
- **Windows**: Sign with code signing certificate
- **Linux**: No signing required for AppImage

### Auto-Updates (Optional)

Configure electron-builder to support auto-updates:

1. Set up a release server (GitHub Releases, S3, etc.)
2. Configure `publish` in package.json
3. Implement auto-updater in the main process

## Support

For issues related to:

- **Python bundling**: Check build-python-bundle.js logs
- **Electron packaging**: Check electron-builder output
- **Runtime errors**: Check app developer console

## License

See LICENSE file in the project root.
