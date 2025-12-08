#!/bin/bash

echo "Installing Python 3.9 for spleeter compatibility..."

# Check if homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "Homebrew is required. Please install it first:"
    echo "/bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    exit 1
fi

# Install Python 3.9
echo "Installing Python 3.9 via Homebrew..."
brew install python@3.9

# Verify installation
if python3.9 --version &> /dev/null; then
    echo "✅ Python 3.9 installed successfully!"
    echo "You can now run: npm run bundle-python"
else
    echo "❌ Python 3.9 installation failed"
    exit 1
fi
