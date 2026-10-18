/** Component registry — cached list of project components discovered via the platform. */

import { getPlatform } from "../platform";
import { projectState } from "../store";
import type { ComponentMeta } from "../types";
import { componentMetaFrom } from "@jxsuite/schema/component-meta";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";

/** A discovered component: project components carry a file path; package components may not. */
export interface ComponentEntry extends Omit<ComponentMeta, "path"> {
  path?: string;
  source?: string;
  package?: string;
  modulePath?: string;
}

export let componentRegistry: ComponentEntry[] = [];
export let _componentRegistryLoaded = false;

/** Bumped by every load, so only the newest scan may write the registry. */
let _generation = 0;
/** The newest scan, which a superseded one waits on so its caller still sees a loaded registry. */
let _newest: Promise<void> = Promise.resolve();

/**
 * Scan the project's components into the registry.
 *
 * Scans can overlap (the project-open path and the Site panel each start one), and a scan bound to
 * the project being closed may resolve after the next project's. So the newest scan wins: an older
 * one discards what it read and resolves when the newest has written the registry.
 */
export function loadComponentRegistry(): Promise<void> {
  _generation += 1;
  const generation = _generation;
  const scan = (async () => {
    let found: ComponentEntry[] | null = null;
    try {
      found = await getPlatform().discoverComponents(projectState?.projectRoot || undefined);
    } catch {
      found = null;
    }
    if (generation !== _generation) {
      await _newest;
      return;
    }
    if (found) {
      componentRegistry = found;
    }
    _componentRegistryLoaded = true;
  })();
  _newest = scan;
  return scan;
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
 * @param {JxMutableNode} doc - The saved document.
 * @returns {boolean} Whether the registry changed, so a caller knows to repaint what reads it.
 */
export function noteComponentSaved(path: string | null, doc: JxMutableNode): boolean {
  if (!path) {
    return false;
  }
  const index = componentRegistry.findIndex((c) => c.path === path);
  /* SAFETY: a saved tab's document was parsed from JSON and has just been written back as JSON
     (`serializeDocument`), so every value it holds is a JSON value — the model the extractor reads. */
  const meta = componentMetaFrom(doc as JsonValue, path);
  if (!meta) {
    if (index === -1) {
      return false;
    }
    componentRegistry.splice(index, 1);
    return true;
  }
  /* SAFETY: `componentMetaFrom` is the extractor every backend's `discoverComponents` scan runs to
     Produce the registry's entries, so its output has the shape the registry already holds. */
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
      } else if (isNonNullObject(child) && isString(child.tagName)) {
        // Preserve an author-set slot attribute (slot forwarding inside fallback).
        child.attributes = { slot: slot.name, ...child.attributes };
        children.push(child);
      } else {
        // Text and non-element nodes can't carry a slot attribute — wrap them.
        children.push({ attributes: { slot: slot.name }, children: [child], tagName: "span" });
      }
    }
  }
  const instance: JxMutableNode = { $props, tagName: comp.tagName };
  if (children.length > 0) {
    instance.children = children;
  }
  return instance;
}

/**
 * Walk `parts` the way a path resolver does: `.` stays, `..` climbs, the rest descend. A climb
 * above the start is kept as a leading `..`, which is how a project-relative path names a file
 * outside the project.
 */
function normalizeParts(parts: readonly string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    if (part === ".") {
      continue;
    }
    if (part === ".." && out.length > 0 && out.at(-1) !== "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out;
}

/**
 * The `$ref` a document at `fromDocPath` writes to reach `toCompPath`, both project-relative.
 *
 * A document can sit OUTSIDE the project: jxsuite.com's docs collection is `../../docs`, so an
 * entry is `../../docs/extending/x.md`. Climbing from there back into the project needs the names
 * of the folders the project sits in, which a project-relative path does not carry; counting its
 * segments gave five `../` and a ref into a folder that does not exist, so every component a docs
 * layout imports failed to register on the canvas. Such a path is resolved against `projectRoot`
 * (the open project's, by default), the way the browser resolves the ref.
 *
 * @param {string | null} fromDocPath
 * @param {string} toCompPath
 * @param {string | null} [projectRoot]
 */
export function computeRelativePath(
  fromDocPath: string | null,
  toCompPath: string,
  projectRoot: string | null = projectState?.projectRoot ?? null,
) {
  if (!fromDocPath) {
    return `./${toCompPath}`;
  }
  const from = fromDocPath.replaceAll("\\", "/");
  const to = toCompPath.replaceAll("\\", "/");
  const fromDir = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
  let fromParts = normalizeParts(fromDir.split("/").filter(Boolean));
  let toParts = normalizeParts(to.split("/").filter(Boolean));
  if (fromParts[0] === ".." && projectRoot) {
    const rootParts = projectRoot.replaceAll("\\", "/").split("/").filter(Boolean);
    fromParts = normalizeParts([...rootParts, ...fromParts]);
    toParts = normalizeParts([...rootParts, ...toParts]);
  }
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
