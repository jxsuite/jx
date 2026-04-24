/** Component registry — cached list of project components discovered via the platform. */

import { getPlatform } from "../platform.js";
import { projectState } from "../store.js";

/** @type {any[]} */
export let componentRegistry = []; // cached list from /__studio/components
export let _componentRegistryLoaded = false;

export async function loadComponentRegistry() {
  try {
    const platform = getPlatform();
    componentRegistry = await platform.discoverComponents(projectState?.projectRoot || undefined);
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
  const from = fromDocPath.replaceAll("\\", "/");
  const to = toCompPath.replaceAll("\\", "/");
  const fromDir = from.substring(0, from.lastIndexOf("/"));
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
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
