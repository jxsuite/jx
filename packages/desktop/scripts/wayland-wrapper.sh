#!/usr/bin/env bash
# Wayland/NixOS compatibility wrapper for Jx Studio desktop app
set -e

# Get the script's directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BIN_DIR="$APP_DIR/build/dev-linux-x64/JxStudio-dev/bin"

if [ ! -d "$BIN_DIR" ]; then
  echo "Desktop app not built. Run 'bun run desktop' first."
  exit 1
fi

# Setup Wayland environment
export QT_QPA_PLATFORM=${QT_QPA_PLATFORM:-wayland}
export XDG_SESSION_TYPE=${XDG_SESSION_TYPE:-wayland}
export OZONE_PLATFORM_HINT=auto

# Ensure chromium flags are set for Wayland
export CEF_ENABLE_WAYLAND=${CEF_ENABLE_WAYLAND:-1}

# Set reasonable defaults for headless/remote scenarios
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
  echo "No display detected. Attempting to use Xvfb if available..."
  if command -v xvfb-run &> /dev/null; then
    exec xvfb-run -a "$BIN_DIR/bun" "$BIN_DIR/../Resources/main.js" "$@"
  else
    echo "Warning: No X11 or Wayland display available."
    echo "Install xvfb-run or set DISPLAY/WAYLAND_DISPLAY"
    exit 1
  fi
fi

# Run the app
cd "$BIN_DIR"
export LD_PRELOAD="./libcef.so:./libvk_swiftshader.so"
exec ./bun "../Resources/main.js" "$@"
