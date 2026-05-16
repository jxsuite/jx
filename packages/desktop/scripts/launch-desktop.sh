#!/usr/bin/env bash
# Desktop app launch helper for NixOS with Wayland/display detection

set -e

# Determine if we're in a headless or non-X11 environment
if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
  cat <<'EOF'
❌ JX Studio Desktop cannot start without a display server.

Current environment:
  - DISPLAY=$DISPLAY (X11)
  - WAYLAND_DISPLAY=$WAYLAND_DISPLAY (Wayland)
  - XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR

✅ Suggested workarounds:

1. If you have a local GUI (on GNOME/KDE/Wayland):
   Make sure you're logged into a graphical session and try again.

2. If using SSH (remote):
   Enable X11 forwarding:
   $ ssh -X user@host
   Then run: bun run desktop

3. If in a container/VM without graphics:
   Use the web UI instead:
   $ bun run dev
   Then open: http://localhost:3000/packages/studio/index.html

4. To debug:
   $ RUST_LOG=debug bun run desktop

Known limitation: CEF (Chromium Embedded Framework) on NixOS currently
requires either X11 or Wayland with proper display initialization.
EOF
  exit 1
fi

# Warnings for Wayland-only
if [ -z "$DISPLAY" ] && [ -n "$WAYLAND_DISPLAY" ]; then
  echo "⚠️  Running on Wayland-only environment (no X11)."
  echo "If you experience crashes, try:"
  echo "  - Setting QT_QPA_PLATFORM=xcb (if Xwayland is available)"
  echo "  - Using SSH with X11 forwarding"
  echo ""
fi

exec bun run desktop
