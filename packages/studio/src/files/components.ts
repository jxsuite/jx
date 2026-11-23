/**
 * Component registry — cached list of project components discovered via the platform.
 *
 * **Keyed by the store** (`project-state.md` §11.1). Each project component's entry remembers the
 * key of the bytes it was derived from ({@link DerivationKey}: the definition's `DocId` and hash),
 * so that while the project state subscription is live, {@link refreshStaleComponents} re-derives
 * exactly the entries whose document changed, follows a renamed definition to its new path without
 * reading it (the bytes are the same), and drops the entry of a removed one. A full scan runs when
 * the project opens and when the host says the set of tags moved (`componentsChanged`).
 */

import { getPlatform } from "../platform";
import { projectState } from "../store";
import { contentStore } from "../project-state/store";
import type { DerivationKey } from "../project-state/store";
import type { ComponentMeta } from "../types";
import { componentMetaFrom } from "@jxsuite/schema/component-meta";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { parseNativeDocument } from "@jxsuite/schema/jxn";
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

/** The key of the bytes each project component's entry was derived from, by its path. */
const entryKeys = new Map<string, DerivationKey>();

/** Remember the store's key for the entry at `path`, or forget it when the store holds none. */
function recordKey(path: string): void {
  const key = contentStore.keyAt(path);
  if (key === undefined) {
    entryKeys.delete(path);
  } else {
    entryKeys.set(path, key);
  }
}

/** The hash half of a {@link DerivationKey}. */
const hashOf = (key: DerivationKey): string => key.slice(key.lastIndexOf("@") + 1);
/** The `DocId` half of a {@link DerivationKey}. */
const docIdOf = (key: DerivationKey): string => key.slice(0, key.lastIndexOf("@"));

/** Whether a registry entry is a project file's definition, which the store can key. */
const isProjectEntry = (entry: ComponentEntry): entry is ComponentEntry & { path: string } =>
  entry.path !== undefined && entry.source !== "npm";

/** Entries the newest scan found while the store held no key for their path. */
const scannedUnkeyed = new Set<string>();
/**
 * Entries with no key whose path the store has held a document at (one it named without a hash).
 * When the store stops holding that path the definition moved or went, and nothing says where, so
 * the registry is scanned again. An entry the store never held (a path outside the host's index) is
 * not followed by the store at all, and costs no scan.
 */
const unkeyedHeld = new Set<string>();

/**
 * Re-key the entries a snapshot left behind (`project-state.md` §11.1). A snapshot of a new epoch
 * names every document under a new `DocId`: an entry whose document is gone while the same bytes
 * sit at its path takes the new key, nothing read. An entry scanned before the store held any key
 * (the project opens before its subscription answers) takes the key the first snapshot gives its
 * path, since that snapshot is the account of the bytes the scan read. An entry whose bytes moved
 * keeps its old key, which {@link refreshStaleComponents} re-derives.
 */
function rekeyEntries(): void {
  for (const entry of componentRegistry) {
    if (!isProjectEntry(entry)) {
      continue;
    }
    const { path } = entry;
    const now = contentStore.keyAt(path);
    const was = entryKeys.get(path);
    if (was === undefined && contentStore.docAt(path) !== undefined) {
      unkeyedHeld.add(path);
    }
    if (now === undefined || was === now) {
      continue;
    }
    if (was === undefined) {
      if (scannedUnkeyed.delete(path)) {
        entryKeys.set(path, now);
        unkeyedHeld.delete(path);
      }
    } else if (contentStore.document(docIdOf(was)) === undefined && hashOf(was) === hashOf(now)) {
      entryKeys.set(path, now);
    }
  }
}

contentStore.onChange((change) => {
  if (change.snapshot) {
    rekeyEntries();
  }
});

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
      entryKeys.clear();
      scannedUnkeyed.clear();
      unkeyedHeld.clear();
      for (const entry of found) {
        if (isProjectEntry(entry)) {
          recordKey(entry.path);
          if (!entryKeys.has(entry.path)) {
            scannedUnkeyed.add(entry.path);
            if (contentStore.docAt(entry.path) !== undefined) {
              unkeyedHeld.add(entry.path);
            }
          }
        }
      }
    }
    _componentRegistryLoaded = true;
  })();
  _newest = scan;
  return scan;
}

/** The project file that defines the custom element `tag`, if the registry has one. */
export function componentPathOf(tag: string): string | undefined {
  return componentRegistry.find((entry) => entry.tagName === tag)?.path;
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
  recordKey(path);
  scannedUnkeyed.delete(path);
  unkeyedHeld.delete(path);
  const index = componentRegistry.findIndex((c) => c.path === path);
  /* SAFETY: a saved tab's document was parsed from JSON and has just been written back as JSON
     (`serializeDocument`), so every value it holds is a JSON value — the model the extractor reads. */
  const meta = componentMetaFrom(doc as JsonValue, path);
  if (!meta) {
    entryKeys.delete(path);
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
 * Re-derive the entries whose definition's bytes are no longer the ones they were derived from, by
 * the store's keys: an entry whose document moved takes its new path (the bytes are the same, so
 * nothing is read), one whose document is gone leaves the registry, and one whose hash changed is
 * read and extracted again as a save would ({@link noteComponentSaved}). An entry whose document's
 * id is gone while a file still sits at its path (a snapshot of a new epoch mints every id again)
 * is re-keyed when the bytes are the same and read again when they are not; only an entry whose
 * path the store no longer holds at all leaves. An entry with no key (the store held none when it
 * was derived) is read again once the store holds one, and when the store stops holding a path it
 * held nothing says where the definition went, so the registry is scanned again. Answers whether
 * the registry changed.
 *
 * Only meaningful while the store follows the host; a caller without a live subscription re-scans.
 */
export async function refreshStaleComponents(): Promise<boolean> {
  let changed = false;
  /** The definitions whose bytes changed, at the paths they hold now. */
  const stale: string[] = [];
  let rescan = false;
  for (const entry of componentRegistry) {
    if (!isProjectEntry(entry) || entryKeys.has(entry.path)) {
      continue;
    }
    const doc = contentStore.docAt(entry.path);
    if (doc === undefined) {
      rescan ||= unkeyedHeld.has(entry.path);
    } else if (contentStore.keyAt(entry.path) === undefined) {
      unkeyedHeld.add(entry.path);
    } else {
      scannedUnkeyed.delete(entry.path);
      unkeyedHeld.delete(entry.path);
      stale.push(entry.path);
    }
  }
  if (rescan) {
    await loadComponentRegistry();
    return true;
  }
  for (const [path, key] of entryKeys) {
    const now = contentStore.keyAt(path);
    if (now === key) {
      continue;
    }
    const moved = contentStore.document(docIdOf(key));
    const index = componentRegistry.findIndex((entry) => entry.path === path);
    entryKeys.delete(path);
    if (moved === undefined && contentStore.docAt(path)?.isDir === false) {
      // The id is gone but a file is still there: the same bytes re-key, other bytes re-derive.
      if (now !== undefined && hashOf(now) === hashOf(key)) {
        entryKeys.set(path, now);
      } else {
        stale.push(path);
      }
      continue;
    }
    if (moved && !moved.isDir && moved.path !== path && contentStore.keyAt(moved.path) === key) {
      // The same bytes under another name: relabel the entry, read nothing.
      if (index !== -1) {
        componentRegistry[index] = { ...componentRegistry[index]!, path: moved.path };
        changed = true;
      }
      entryKeys.set(moved.path, key);
    } else if (moved) {
      if (moved.path !== path && index !== -1) {
        // Moved and rewritten: the entry is derived again at its new path.
        componentRegistry.splice(index, 1);
        changed = true;
      }
      stale.push(moved.path);
    } else if (index !== -1) {
      componentRegistry.splice(index, 1);
      changed = true;
    }
  }
  const rederived = await Promise.all(stale.map((path) => rederive(path)));
  return changed || rederived.includes(true);
}

/** Read the definition at `path` again and bring its entry up to date; whether it changed. */
async function rederive(path: string): Promise<boolean> {
  let doc: JxMutableNode;
  try {
    doc = parseNativeDocument(await getPlatform().readFile(path), path);
  } catch {
    // A definition that no longer reads keeps the entry it had.
    return false;
  }
  return noteComponentSaved(path, doc);
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
