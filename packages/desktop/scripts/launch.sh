#!/usr/bin/env bash
# Jx Studio Desktop Launcher for NixOS
# Handles display detection and provides helpful guidance

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

print_header() {
  echo -e "${GREEN}=====${NC} $1 ${GREEN}=====${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠${NC}  $1"
}

print_error() {
  echo -e "${RED}✗${NC}  $1"
}

print_success() {
  echo -e "${GREEN}✓${NC}  $1"
}

# ─── Check display environment ───────────────────────────────────────────────

print_header "Checking display environment"

echo "  DISPLAY=$DISPLAY"
echo "  WAYLAND_DISPLAY=$WAYLAND_DISPLAY"
echo "  XDG_RUNTIME_DIR=$XDG_RUNTIME_DIR"

if [ -z "$DISPLAY" ] && [ -z "$WAYLAND_DISPLAY" ]; then
  print_error "No display server detected"
  echo ""
  echo "Jx Studio Desktop requires a graphical environment to run."
  echo ""
  print_header "Solutions"
  echo ""
  echo "1. ${GREEN}Use X11 Forwarding (Remote SSH)${NC}"
  echo "   $ ssh -X user@host"
  echo "   $ bun run desktop"
  echo ""
  echo "2. ${GREEN}Use Web UI (Recommended for headless)${NC}"
  echo "   $ cd $REPO_ROOT"
  echo "   $ bun run dev"
  echo "   Then open: http://localhost:3000/packages/studio/index.html"
  echo ""
  echo "3. ${GREEN}Local graphical session${NC}"
  echo "   Ensure you're logged into a GNOME/KDE/Wayland session"
  echo ""
  exit 1
fi

# ─── Detect Wayland-only ─────────────────────────────────────────────────────

if [ -z "$DISPLAY" ] && [ -n "$WAYLAND_DISPLAY" ]; then
  print_warning "Running on pure Wayland (no X11 fallback)"
  echo ""
  echo "  CEF (Chromium Embedded Framework) may not start on pure Wayland."
  echo "  Troubleshooting:"
  echo ""
  echo "  • If you have Xwayland installed, CEF may work. Check:"
  echo "    $ which Xwayland"
  echo ""
  echo "  • If not installed, try:"
  echo "    nix-shell -p xwayland"
  echo "    bun run desktop"
  echo ""
  echo "  • As fallback, use the web UI (always works):"
  echo "    cd $REPO_ROOT && bun run dev"
  echo ""
fi

# ─── Run desktop ────────────────────────────────────────────────────────────

print_success "Display environment OK, launching Jx Studio…"
cd "$REPO_ROOT"
bun run desktop "$@"
