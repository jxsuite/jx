/**
 * platform.js — Platform Abstraction Layer (PAL)
 *
 * Studio is backend-agnostic. Each deployment target (desktop, dev server, cloud)
 * registers a platform adapter at startup. All file I/O, project loading, and
 * component discovery goes through this interface.
 *
 * See spec/desktop.md §3 for the full StudioPlatform interface.
 */

let _platform = null;

export function registerPlatform(platform) {
  _platform = platform;
}

export function getPlatform() {
  if (!_platform) throw new Error("No platform registered. Call registerPlatform() before starting Studio.");
  return _platform;
}
