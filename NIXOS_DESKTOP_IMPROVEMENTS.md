# NixOS Desktop App Improvements Summary

## Problem

JX Studio Desktop sigfaults on NixOS with pure Wayland due to CEF (Chromium Embedded Framework) failing to initialize GTK without an X11 display server connection.

## Solution Approach

Implemented a **multi-layered workaround** combining library fixes, nix integration, and user guidance:

### 1. **Library Fixes** (flake.nix)
- Added `libgbm` to desktop dependencies (was causing "libgbm.so.1: cannot open shared object" errors)
- Integrated `cef-binary` from nixpkgs (version 147.0.10) instead of relying on Electrobun's download
- Enhanced LD_LIBRARY_PATH with all required CEF runtime libs
- Added Wayland/Ozone platform environment variables

### 2. **CEF Replacement Mechanism**
- Created `packages/desktop/scripts/post-build.sh` hook to swap Electrobun's CEF with nix version after build
- Pre-build script checks for `NIX_CEF_BINARY` environment variable
- Improved library linking and GPU support

### 3. **User Guidance**
- Added `packages/desktop/scripts/launch.sh` smart launcher that:
  - Detects display environment (X11 vs Wayland vs headless)
  - Provides specific guidance based on situation
  - Recommends appropriate workaround
- Updated `packages/desktop/NODOS_NOTES.md` with comprehensive troubleshooting
- Modified root `package.json` to use launcher script

### 4. **Root Cause Analysis**

**Why it still doesn't work on pure Wayland:**

CEF's initialization sequence:
```
1. Load GTK (GLib/GObject)
2. Initialize GTK display connection
3. Check for X11 display ($DISPLAY)
4. If X11 unavailable, try Wayland
5. FAIL: GTK initialization requires display server connection
```

Even with:
- ✅ All libraries available
- ✅ Ozone/Wayland platform hints set
- ✅ Nix-compiled CEF with better compatibility
- ✅ Proper LD_LIBRARY_PATH

The **GTK initialization still requires a display connection**, which CEF's pre-compiled binaries cannot bypass.

## Files Changed

### Modified
- `flake.nix` - Added libgbm, cef-binary, NIX_CEF_BINARY env, Wayland flags
- `packages/desktop/electrobun.config.ts` - Added Ozone platform feature flags
- `packages/desktop/scripts/pre-build.ts` - Added CEF binary detection
- `package.json` - Changed desktop script to use launcher
- `packages/desktop/NODOS_NOTES.md` - Comprehensive troubleshooting guide

### Created
- `packages/desktop/scripts/launch.sh` - Smart launcher with environment detection
- `packages/desktop/scripts/post-build.sh` - CEF library replacement hook
- `packages/desktop/scripts/wayland-wrapper.sh` - Wayland compatibility wrapper (fallback)

## Recommendations

### For Users
1. **On pure Wayland without X11:** Use `bun run dev` (web UI) instead
2. **On Wayland with Xwayland:** Install xwayland and try desktop app
3. **Remote SSH:** Use X11 forwarding (`ssh -X`)

### For Jx Developers
1. Document Xwayland as optional dependency for NixOS
2. Consider WebKit renderer instead of CEF for better Wayland support
3. Provide JSON-RPC backend for truly headless operation
4. Test on CI with pure Wayland environment

## Testing

The changes have been tested with:
- ✅ Library linking (all CEF deps found)
- ✅ Nix CEF substitution (libs correctly swapped)
- ✅ Wayland environment detection
- ✅ Fallback guidance (launcher script works)

❌ Desktop app still fails on pure Wayland (GTK limitation, not a bug)

## Web UI as Primary Interface

For NixOS users on Wayland, the **web UI is the recommended solution**:
```bash
bun run dev
# Open: http://localhost:3000/packages/studio/index.html
```

✅ All features available
✅ Works on all platforms/environments
✅ No display server needed
✅ Same development experience
