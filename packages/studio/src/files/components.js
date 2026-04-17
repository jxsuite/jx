/** Component registry — cached list of project components discovered via the platform. */

import { getPlatform } from "../platform.js";

/** @type {any[]} */
export let componentRegistry = []; // cached list from /__studio/components
export let _componentRegistryLoaded = false;

export async function loadComponentRegistry() {
  try {
    const platform = getPlatform();
    componentRegistry = await platform.discoverComponents();
    _componentRegistryLoaded = true;
  } catch {
    _componentRegistryLoaded = true;
  }
}

/**
 * @param {any} fromDocPath
 * @param {any} toCompPath
 */
export function computeRelativePath(fromDocPath, toCompPath) {
  if (!fromDocPath) return `./${toCompPath}`;
  const fromDir = fromDocPath.substring(0, fromDocPath.lastIndexOf("/"));
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = toCompPath.split("/").filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }
  const ups = fromParts.length - common;
  const remaining = toParts.slice(common);
  return (ups > 0 ? "../".repeat(ups) : "./") + remaining.join("/");
}
