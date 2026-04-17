/** Statusbar — status message display for Jx Studio */

import { statusbarEl, getNodeAtPath, nodeLabel } from "../../store.js";

// ─── Module state ────────────────────────────────────────────────────────────

let statusMsg = "";
/** @type {any} */
let statusTimeout;
/** @type {(() => void) | null} */
let _rerender = null;

/**
 * Register the callback used to re-render the statusbar. Called once from studio.js during init.
 *
 * @param {() => void} fn
 */
export function setStatusbarRenderer(fn) {
  _rerender = fn;
}

// ─── Statusbar ───────────────────────────────────────────────────────────────

/**
 * Render the statusbar text. Receives current studio state so the module stays decoupled from the
 * mutable `S` local in studio.js.
 *
 * @param {any} S - Current studio state
 */
export function renderStatusbar(S) {
  const parts = [];
  if (S.mode === "content") parts.push("Content Mode");
  if (S.selection) {
    const node = getNodeAtPath(S.document, S.selection);
    parts.push(`Selected: ${nodeLabel(node)}`);
    parts.push(`Path: ${S.selection.join(" > ") || "root"}`);
  }
  if (statusMsg) parts.push(statusMsg);
  statusbarEl.textContent = parts.join("  |  ") || "Jx Studio";
}

/**
 * Show a temporary status message.
 *
 * @param {any} msg
 * @param {number} [duration]
 */
export function statusMessage(msg, duration = 3000) {
  statusMsg = msg;
  _rerender?.();
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    statusMsg = "";
    _rerender?.();
  }, duration);
}
