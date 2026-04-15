/**
 * init.js — Webview initialization for Jx Studio desktop app
 *
 * This script runs in the webview BEFORE studio.js loads. It:
 * 1. Creates the DesktopPlatform adapter (connects RPC to Bun process)
 * 2. Registers it as the active platform via the PAL
 *
 * The studio's index.html loads this script before the main studio bundle.
 *
 * See spec/desktop.md §3.3 for the registration pattern.
 */

import { registerPlatform } from "@jxplatform/studio/platform.js";
import { createDesktopPlatform } from "./platform.js";

registerPlatform(createDesktopPlatform());
