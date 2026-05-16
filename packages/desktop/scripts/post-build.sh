#!/usr/bin/env bash
# Post-build hook: Replace Electrobun's CEF with nixpkgs cef-binary
# This improves Wayland compatibility and reduces build time

set -e

if [ -z "$NIX_CEF_BINARY" ]; then
  exit 0  # Not running under nix, skip
fi

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$DESKTOP_DIR/build"

# Find the built app (may be dev or release)
APP_DIR=$(find "$BUILD_DIR" -maxdepth 2 -type d -name "*.dev" -o -name "*JxStudio*" | head -1)

if [ -z "$APP_DIR" ] || [ ! -d "$APP_DIR/bin/cef" ]; then
  echo "[post-build] No CEF directory found, skipping replacement"
  exit 0
fi

echo "[post-build] Replacing CEF libs with nixpkgs version from $NIX_CEF_BINARY"

CEF_RELEASE="$NIX_CEF_BINARY/Release"
APP_CEF="$APP_DIR/bin/cef"

if [ ! -d "$CEF_RELEASE" ]; then
  echo "[post-build] Warning: CEF_RELEASE not found at $CEF_RELEASE"
  exit 0
fi

# Backup originals
mkdir -p "$APP_CEF/backup"
for lib in libcef.so libEGL.so libGLESv2.so libvk_swiftshader.so libvulkan.so.1; do
  if [ -f "$APP_CEF/$lib" ]; then
    cp "$APP_CEF/$lib" "$APP_CEF/backup/$lib.bak" || true
  fi
done

# Copy nix versions
cp "$CEF_RELEASE"/libcef.so "$APP_CEF/libcef.so"
cp "$CEF_RELEASE"/libEGL.so "$APP_CEF/libEGL.so"
cp "$CEF_RELEASE"/libGLESv2.so "$APP_CEF/libGLESv2.so"
cp "$CEF_RELEASE"/libvk_swiftshader.so "$APP_CEF/libvk_swiftshader.so"

# libvulkan may not be in Release, try parent or Resources
if [ -f "$NIX_CEF_BINARY/Release/libvulkan.so.1" ]; then
  cp "$NIX_CEF_BINARY/Release/libvulkan.so.1" "$APP_CEF/libvulkan.so.1"
fi

echo "[post-build] CEF libs replaced successfully"
