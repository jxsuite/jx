# Jx Studio Desktop on NixOS

## Current Status

The desktop app works on NixOS but has **known limitations with Wayland** environments that lack X11 fallback (pure Wayland, SSH, containers).

## ✅ Working Configurations

- **X11-based systems** (traditional Linux desktops with X11)
- **Wayland with Xwayland** (most modern GNOME/KDE setups)
- **SSH with X11 forwarding** (remote development)

## ❌ Known Issues

### CEF/Chromium GTK Initialization on Pure Wayland

The Chromium Embedded Framework (CEF) fails to initialize GTK without access to an X11 display:

```
(bun:...): Gtk-WARNING **: cannot open display:
```

**Root cause:** CEF's GTK initialization code requires a display server connection. While we can:
- ✅ Provide all runtime libraries (libgbm, libGL, libEGL, mesa, etc.)
- ✅ Use nixpkgs `cef-binary` instead of Electrobun's download
- ✅ Set Wayland/Ozone platform hints
- ❌ **Still cannot bypass GTK's display requirement**

This is a **fundamental CEF limitation**, not a bug in Jx.

### Why Using Nixpkgs CEF Didn't Help

We successfully integrated `cef-binary` from nixpkgs:
- Added to flake.nix dev environment
- Created post-build hook to swap libs
- Verified libraries are correctly linked

**However:** The GTK display initialization happens before Ozone/Wayland rendering, so CEF still fails on headless systems.

## 🔧 Recommended Solutions

### **Option 1: Use Web UI** (Recommended for non-X11)

This is the full-featured Jx Studio experience and works **everywhere**:

```bash
cd /path/to/jx
bun run dev
# Open browser: http://localhost:3000/packages/studio/index.html
```

✅ Works on headless, remote, containers, pure Wayland
✅ Same features as desktop app
✅ No display server needed

### **Option 2: SSH with X11 Forwarding** (Remote development)

```bash
ssh -X user@host
bun run desktop
```

✅ Works if remote host has X11
⚠️  Performance depends on network latency

### **Option 3: Wayland with Xwayland** (Local pure-Wayland systems)

If using GNOME/KDE on pure Wayland with Xwayland available:

```bash
# Option A: Install xwayland in dev env
nix-shell -p xwayland

# Option B: Or system-wide  
nixos-option environment.systemPackages xwayland

# Then try
bun run desktop
```

✅ May work if Xwayland can initialize
⚠️  Not guaranteed—depends on CEF build

### **Option 4: Helper Script**

Use the provided launcher script that detects your environment:

```bash
./packages/desktop/scripts/launch.sh
```

This will guide you to the appropriate solution.

## 📋 Technical Checklist

We've optimized for NixOS as much as possible:

- ✅ Added `libgbm` to desktop libs (required by EGL)
- ✅ Added `cef-binary` from nixpkgs (version 147.0.10)
- ✅ Created post-build hook to replace Electrobun CEF
- ✅ Set Wayland/Ozone platform hints
- ✅ Configured proper LD_LIBRARY_PATH wrapping
- ✅ Added environment variable passthrough

But GTK's display requirement cannot be bypassed without:
- [ ] Compiling CEF with headless mode
- [ ] Building CEF without GTK dependency
- [ ] Switching to WebKit renderer (not available in Electrobun)
- [ ] Xvfb/virtual display server

## 🔮 Future Improvements

1. **Switch renderer engine** → WebKit (better GTK/Wayland support)
2. **Compile CEF with headless mode** → Time-intensive
3. **Provide JSON-RPC backend** → Use web UI instead
4. **Document Xwayland workaround** → In setup guides

## 📝 For Local Pure-Wayland Users

If you're on NixOS with pure Wayland (no Xwayland) and want the desktop app:

1. **Try installing Xwayland:**
   ```bash
   # In flake.nix or configuration.nix
   environment.systemPackages = with pkgs; [ xwayland ];
   ```

2. **Or use the web UI** (recommended):
   ```bash
   bun run dev  # Always works
   ```

The web UI is fully featured and the recommended way forward for headless/remote scenarios.

