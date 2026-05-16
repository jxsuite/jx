#!/usr/bin/env bash
# Jx Studio Desktop Launcher for NixOS
# Automatically picks the best renderer: Electrobun (CEF) or system Chromium

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# ─── Check if CEF can work (has X11 display) ────────────────────────────────

can_use_cef() {
  # CEF needs X11 display (even on Wayland, it needs Xwayland)
  [ -n "$DISPLAY" ]
}

# ─── Launch ──────────────────────────────────────────────────────────────────

if can_use_cef; then
  echo "[launcher] X11 display detected, using Electrobun (CEF)"
  cd "$REPO_ROOT"
  exec bun run --cwd packages/desktop dev "$@"
else
  echo "[launcher] No X11 display — using system Chromium in app mode"
  cd "$REPO_ROOT"
  exec bun run --cwd packages/desktop chromium "$@"
fi
