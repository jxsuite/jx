/** Component registry — cached list of project components discovered via the platform. */

import { getPlatform } from "../platform";
import { projectState } from "../store";
import type { ComponentMeta } from "../types";
import { componentMetaFrom } from "@jxsuite/schema/component-meta";
import type { JxMutableNode } from "@jxsuite/schema/types";

/** A discovered component: project components carry a file path; package components may not. */
export interface ComponentEntry extends Omit<ComponentMeta, "path"> {
  path?: string;
  source?: string;
  package?: string;
  modulePath?: string;
}

export let componentRegistry: ComponentEntry[] = [];
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
 * Bring the registry up to date with a document that was just saved.
 *
 * The registry is the snapshot the platform's scan took when the project opened, and a saved
 * component definition used to leave it behind: give a prop `format: "image"` in the definition and
 * every instance's Component Settings kept drawing the text box the snapshot knew, until the
 * project was reopened. The saved document is the same input the scan reads, through the same
 * extractor (`componentMetaFrom`, shared by all three backends), so the entry is rebuilt from it
 * here rather than by a rescan of every JSON file in the project. A definition that stopped being a
 * component (its `tagName` lost its hyphen) leaves the registry by the same rule the scan applies.
 *
 * @param {string | null} path - The saved document's project-relative path; `null` for an unsaved
 *   draft, which no scan would have seen either.
 * @param {unknown} doc - The saved document.
 * @returns {boolean} Whether the registry changed, so a caller knows to repaint what reads it.
 */
export function noteComponentSaved(path: string | null, doc: unknown): boolean {
  if (!path) {
    return false;
  }
  const index = componentRegistry.findIndex((c) => c.path === path);
  const meta = componentMetaFrom(doc, path);
  if (!meta) {
    if (index === -1) {
      return false;
    }
    componentRegistry.splice(index, 1);
    return true;
  }
  const entry = meta as ComponentEntry;
  if (index === -1) {
    componentRegistry.push(entry);
  } else {
    componentRegistry[index] = entry;
  }
  return true;
}

/**
 * Build a fresh instance definition for a component: $props from prop defaults, plus the
 * component's slot fallback children cloned in as starting content so editors can edit from the
 * defaults. Children destined for a named slot carry a `slot` attribute (required for runtime
 * distribution); fallback for the default slot is inserted as-is. When the component has no slot
 * fallback, no `children` key is emitted so slotless instances stay atomic in the layers tree.
 *
 * @param {ComponentEntry} comp
 * @returns {JxMutableNode}
 */
export function buildComponentInstance(comp: ComponentEntry): JxMutableNode {
  const $props = Object.fromEntries(
    (comp.props ?? []).map((p) => [p.name, p.default !== undefined ? p.default : ""]),
  );
  const children: (JxMutableNode | string)[] = [];
  for (const slot of comp.slots ?? []) {
    for (const child of structuredClone(slot.fallback ?? [])) {
      if (!slot.name) {
        children.push(child);
      } else if (typeof child === "object" && child !== null && typeof child.tagName === "string") {
        // Preserve an author-set slot attribute (slot forwarding inside fallback).
        child.attributes = { slot: slot.name, ...child.attributes };
        children.push(child);
      } else {
        // Text and non-element nodes can't carry a slot attribute — wrap them.
        children.push({ attributes: { slot: slot.name }, children: [child], tagName: "span" });
      }
    }
  }
  return {
    $props,
    tagName: comp.tagName,
    ...(children.length > 0 ? { children } : {}),
  };
}

/**
 * @param {string | null} fromDocPath
 * @param {string} toCompPath
 */
export function computeRelativePath(fromDocPath: string | null, toCompPath: string) {
  if (!fromDocPath) {
    return `./${toCompPath}`;
  }
  const from = fromDocPath.replaceAll("\\", "/");
  const to = toCompPath.replaceAll("\\", "/");
  const fromDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  const fromParts = fromDir.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  const ups = fromParts.length - common;
  const remaining = toParts.slice(common);
  return (ups > 0 ? "../".repeat(ups) : "./") + remaining.join("/");
}
