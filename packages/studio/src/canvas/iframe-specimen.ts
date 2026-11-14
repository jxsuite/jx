/// <reference lib="dom" />
/**
 * The frame's half of a surface specimen (studio.md §4.6): everything a render of one of Studio's
 * own surfaces needs that a render of any other document does not.
 *
 * A surface names no `$elements` and declares no `state`. In the shell the kit is registered at
 * boot, the chrome's tokens are linked stylesheets, and the adapter hands the document its scope.
 * The frame has none of the three, so this module supplies each for the one render that asks:
 *
 * - The kit's elements, defined from the documents the bundle carries, each a chunk of its own and
 *   only the ones the surface draws (ui.md §10);
 * - The chrome's tokens, as a style block the render folds under the project's own;
 * - The scope, made by the surface's specimen.
 *
 * `iframe-render.ts` imports this module with `import()`, so a frame that never draws a surface
 * never loads it, and the frame's entry carries the thunk and nothing else.
 *
 * @docs extending/ui-kit
 */
import { defineElement, preloadDocument } from "@jxsuite/runtime";
import { isNonNullObject, isRef, isString } from "@jxsuite/schema/guards";
import { KIT_DOCUMENT_LOADERS, kitDocumentOf } from "@jxsuite/ui/document-loaders";
import { KIT_BASE } from "@jxsuite/ui/loaders";
import { THEME_LAYER, themeTokens } from "@jxsuite/ui/theme";
import chromeTokens from "../../styles/tokens.json";
import { SPECIMENS } from "../surfaces/specimens";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JsonValue, JxDocument, JxStyle } from "@jxsuite/schema/types";
import type { SurfaceSpecimen } from "../surfaces/specimen";

/** The specimen a render names: the surface, and which of its variants. */
export interface SpecimenRequest {
  name: string;
  variant: string | null;
}

/** What a specimen render is drawn with. */
export interface PreparedSpecimen {
  /** The host scope the document's `#/state/…` reads resolve in. */
  scope: JxScope;
  /** The chrome's tokens, which the site sheet carries under the project's own style. */
  theme: JxStyle;
}

/**
 * Marks an overlay this module drew open, so the canvas's own single writer of open state
 * (`applyCanvasPopoverOpen`, `applyCanvasDialogOpen`) leaves it standing.
 */
export const HELD_ATTR = "data-jx-overlay-held";

/**
 * The specimen module of a surface, or null for a name the table lacks. Never throws for a name: a
 * frame and a parent of different builds may disagree about which specimens exist.
 *
 * @param {string} name - A surface name
 * @returns {Promise<SurfaceSpecimen | null>}
 */
export async function loadSpecimen(name: string): Promise<SurfaceSpecimen | null> {
  const entry = SPECIMENS.get(name);
  if (!entry) {
    return null;
  }
  const module = await entry.load();
  return module.specimen;
}

const loaders = new Map<string, () => Promise<{ default: object }>>(
  Object.entries(KIT_DOCUMENT_LOADERS),
);

/** Kit documents already loaded and preloaded under their URL in this realm, by tag. */
const loaded = new Map<string, JxDocument>();

/** Collect every kit tag a document tree names, and every kit document its `$elements` import. */
function kitTagsIn(node: JsonValue | undefined, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const member of node) {
      kitTagsIn(member, into);
    }
    return;
  }
  if (!isNonNullObject(node)) {
    return;
  }
  if (isString(node.tagName) && loaders.has(node.tagName)) {
    into.add(node.tagName);
  }
  if (isRef(node) && isString(node.$ref)) {
    const tag = /(?:^|\/)(jx-[a-z-]+)\.json$/u.exec(node.$ref)?.[1];
    if (tag !== undefined && loaders.has(tag)) {
      into.add(tag);
    }
  }
  for (const value of Object.values(node)) {
    kitTagsIn(value, into);
  }
}

/**
 * Define the kit elements a document draws, in this realm, from the bundle.
 *
 * Each needed document is loaded through its own loader, one at a time, and preloaded under its
 * `jx-ui:` URL before anything is defined, so a definition's own `$elements` (`./jx-icon.json`)
 * resolve with no fetch. They are then defined in the kit's registration order. A tag already
 * defined is left alone by the runtime, so a second render costs a walk and nothing else.
 *
 * @param {JxDocument} doc - The surface document about to be rendered
 * @returns {Promise<void>}
 */
export async function defineKitFor(doc: JxDocument): Promise<void> {
  const needed = new Set<string>();
  /* SAFETY: a render document is JSON by construction (it crossed into this realm by
     `postMessage`); the walk reads `tagName` and `$ref` off it and nothing else. */
  kitTagsIn(doc as JsonValue, needed);
  // A set visits the members added while it is walked, which is the transitive closure.
  for (const tag of needed) {
    let kitDoc = loaded.get(tag);
    if (!kitDoc) {
      const load = loaders.get(tag);
      if (!load) {
        continue;
      }
      kitDoc = kitDocumentOf(await load());
      loaded.set(tag, kitDoc);
      preloadDocument(`${KIT_BASE}${tag}.json`, kitDoc);
    }
    /* SAFETY: as above; a kit document is one of the package's own JSON files. */
    kitTagsIn(kitDoc as JsonValue, needed);
  }
  for (const tag of loaders.keys()) {
    const kitDoc = needed.has(tag) ? loaded.get(tag) : undefined;
    if (kitDoc) {
      await defineElement(kitDoc, KIT_BASE);
    }
  }
}

/** What the chrome's root rule declares that a surface inherits: its text and its ground. */
const INHERITED = new Set(["background", "color", "font-family", "font-size", "line-height"]);

/**
 * The chrome's tokens as one style block: the kit's theme in its own cascade layer, then Studio's
 * aliases of it (`--fg`, `--border`, `--radius`) and the root's text and ground, which every
 * surface is written against (`styles/tokens.json`, studio-ui-guidelines.md §1.1). The shell's
 * layout declarations on the same rule (a fixed height, hidden overflow, no selection) are the
 * application window's and are left out: the frame is a page, sized to its content.
 *
 * @returns {JxStyle}
 */
export function chromeTheme(): JxStyle {
  const theme: JxStyle = { [`@layer ${THEME_LAYER}`]: themeTokens };
  for (const [key, value] of Object.entries(chromeTokens.style)) {
    if (isString(value) && (key.startsWith("--") || INHERITED.has(key))) {
      theme[key] = value;
    }
  }
  return theme;
}

/**
 * Everything a specimen render is drawn with, or null when the frame has no specimen of that name
 * and the document renders as any other does.
 *
 * @param {SpecimenRequest} request - The surface and variant the render names
 * @param {JxDocument} doc - The surface document about to be rendered
 * @returns {Promise<PreparedSpecimen | null>}
 */
export async function prepareSpecimen(
  request: SpecimenRequest,
  doc: JxDocument,
): Promise<PreparedSpecimen | null> {
  const specimen = await loadSpecimen(request.name);
  if (!specimen) {
    return null;
  }
  await defineKitFor(doc);
  return { scope: specimen.make(request.variant).scope, theme: chromeTheme() };
}

/**
 * Draw a surface's own overlay shown in place.
 *
 * A menu, a popover or a dialog is closed until something opens it, and on the canvas nothing does:
 * the frame de-links `popover` and a dialog's `open` (studio.md §4.2.2, §4.2.3), and the adapter
 * that would call `showPopover()` is not here. A surface whose ROOT is such an overlay is nothing
 * but the overlay, so its specimen is drawn with it open, by the same two attributes the canvas
 * shows any overlay with, and held so the tab's own open state does not close it.
 *
 * @param {Element | Text} root - The rendered surface root
 */
export function showRootOverlay(root: Element | Text): void {
  if (!(root instanceof HTMLElement) || holdOverlay(root) || !root.tagName.includes("-")) {
    return;
  }
  /* A kit element writes its own attributes and draws its own children when it connects, which is
     after the render that created it returns: the `popover` a `jx-menu` declares on itself and the
     dialog inside a `jx-dialog` are both watched for, and the watch ends with the first found. */
  const observer = new MutationObserver(() => {
    if (holdOverlay(root)) {
      observer.disconnect();
    }
  });
  observer.observe(root, { attributeFilter: ["data-jx-popover"], childList: true });
}

/** Mark the overlay a surface root is, or holds as its own child, open; false while it has none. */
function holdOverlay(root: HTMLElement): boolean {
  if (root.dataset.jxPopover !== undefined) {
    root.dataset.jxPopoverOpen = "";
    root.setAttribute(HELD_ATTR, "");
    return true;
  }
  const dialog = root.querySelector<HTMLElement>(":scope > dialog");
  if (!dialog) {
    return false;
  }
  dialog.dataset.jxDialogOpen = "";
  dialog.setAttribute(HELD_ATTR, "");
  return true;
}
