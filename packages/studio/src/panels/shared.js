/**
 * Shared panel utilities — portable helpers extracted from studio.js. These functions depend only
 * on store.js / state.js exports (no circular deps).
 */

/**
 * Convert a $media key like "--tablet" to a friendly display name "Tablet". "--" returns "Base".
 *
 * @param {any} name
 */
export function mediaDisplayName(name) {
  if (name === "--") return "Base";
  return (
    name
      .replace(/^--/, "")
      .replace(/-/g, " ")
      .replace(/\b\w/g, (/** @type {any} */ c) => c.toUpperCase()) || name
  );
}

/**
 * Ensure Lit's internal ChildPart markers are valid. If corrupted, clears the container so Lit
 * rebuilds from scratch on the next render.
 *
 * @param {HTMLElement} container
 */
export function ensureLitState(container) {
  // @ts-ignore — Lit stores a ChildPart on this private property
  const part = container["_$litPart$"];
  if (!part) return;
  const start = part._$startNode;
  const end = part._$endNode;
  const startBad = start && start.parentNode !== container;
  const endBad = end && end !== container && end.parentNode !== container;
  if (startBad || endBad) {
    console.warn("ensureLitState: clearing corrupted Lit state on", container.id || container);
    container.textContent = "";
    // @ts-ignore
    delete container["_$litPart$"];
  }
}
