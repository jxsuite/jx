/**
 * Live authoring of Studio's own chrome.
 *
 * Studio's surfaces are Jx documents (`src/surfaces/*.json`) and its controls are the kit's
 * (`packages/ui/components/*.json`), so both are things Studio can open and edit. This is what
 * closes the loop: a saved surface document re-mounts every root drawn from it, and a saved kit
 * component redefines the element and re-mounts every root that used it, so the edit shows in the
 * shell the reader is standing in (studio-ui-guidelines.md §9.3, embedding.md §7).
 *
 * **The lane is keyed on the saved PATH, and that is the whole of how it stays inert.** A save is
 * something to act on only when the file, joined to the open project's root, is one of the two
 * places the chrome comes from. Any other project — a site, a starter, the examples — saves files
 * this never looks at, and the shipped app never reads its chrome from disk: the document that
 * re-mounts is the one the tab just wrote, handed over by the save path, never read back.
 *
 * Two things are deliberately NOT here. The lane does not watch the filesystem: an edit made
 * outside Studio reaches the shell on the next reload, as it always did, because a watcher is a
 * second writer racing the tab. And it does not diff: a saved document is re-registered whole and
 * every root re-mounted, because a surface's host scope is reused (`SurfaceMount.remount`) and only
 * the surface-local state resets, which is the contract §9.3 gives the registry.
 *
 * A kit redefinition reaches the canvas frames too, with the FILE's URL under the project as its
 * base: the frame draws a project's elements from the project's own files, so a sibling `$ref` in
 * the definition must resolve to the project's copy, not to the bundle's. The frame answers the
 * definition's `jx-ui:` sidecars from the loaders it registered at boot (`iframe-entry.ts`), one
 * chunk per behaviour on first use.
 *
 * @docs extending/ui-kit
 */
import { redefineElement } from "@jxsuite/runtime";
import { KIT_BASE } from "@jxsuite/ui";
import type { JxDocument } from "@jxsuite/schema/types";
import { mountsOf, mountsUsing } from "./surface-registry";
import { registerSurface, surfaceDocument } from "../ui/surface";
import { documentBase } from "../canvas/canvas-origin";

/** What a saved file IS to the running shell. */
export type LiveTarget =
  | { readonly kind: "surface"; readonly name: string }
  | { readonly kind: "element"; readonly tag: string };

/** Where a surface document lives, from any root that contains it. */
const SURFACE_PATH = /\/packages\/studio\/src\/surfaces\/([\w-]+)\.json$/;
/** Where a kit component lives, from any root that contains it. */
const ELEMENT_PATH = /\/packages\/ui\/components\/(jx-[\w-]+)\.json$/;

/**
 * Join a project root and a path the way the platform reports them, and normalise the separators so
 * a Windows root and a POSIX-relative path meet in one spelling.
 */
function joined(projectRoot: string, path: string): string {
  const root = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  const rel = path.replaceAll("\\", "/").replace(/^\.?\//, "");
  return `${root}/${rel}`;
}

/**
 * Which surface or element a saved path is, or null for every other file.
 *
 * Matched by suffix against the root JOINED to the path rather than by which project is open, so
 * the same answer comes from the kit opened as its own project (`components/jx-tree.json` under
 * `packages/ui`), from Studio opened as one (`src/surfaces/menu.json` under `packages/studio`), or
 * from any root above them. A path that is neither — including every file of every other project —
 * is null, and null is the lane doing nothing.
 *
 * @param projectRoot The open project's root, as the platform reports it.
 * @param path The saved path, relative to that root.
 */
export function liveSurfaceTarget(
  projectRoot: string | null | undefined,
  path: string | null | undefined,
): LiveTarget | null {
  if (!projectRoot || !path) {
    return null;
  }
  const full = joined(projectRoot, path);
  const surface = SURFACE_PATH.exec(full);
  if (surface) {
    return { kind: "surface", name: surface[1]! };
  }
  const element = ELEMENT_PATH.exec(full);
  if (element) {
    return { kind: "element", tag: element[1]! };
  }
  return null;
}

/** What one save did. */
export interface LiveSurfaceResult {
  readonly target: LiveTarget;
  /** How many roots were re-mounted. Zero is a document nothing on screen was drawn from. */
  readonly remounted: number;
  /** How many canvas frames were told of an element's redefinition. Absent for a surface. */
  readonly canvases?: number;
  /** Why nothing was applied, when nothing was. */
  readonly refused?: string;
}

/**
 * The URL a frame resolves a saved kit component against: the file's own URL under the project,
 * which is where the frame fetched the definition it holds and where its sibling `$ref`s live.
 *
 * @param projectRoot The open project's root.
 * @param path The saved path, relative to it.
 */
export function canvasBaseFor(projectRoot: string, path: string): string {
  return new URL(path.replaceAll("\\", "/").replace(/^\.?\//, ""), documentBase(projectRoot)).href;
}

/**
 * Apply a saved document to the running shell.
 *
 * A surface is re-registered under its name — the same call the bundle makes at boot, so the
 * runtime's own resolution paths see the new document too — and every root of that name is
 * re-mounted. An element is redefined through the runtime (embedding.md §7) and every root whose
 * render instantiated it is re-mounted, which is what turns a redefinition into something visible:
 * an instance already connected keeps the definition it rendered until it is re-mounted.
 *
 * A surface name nothing has registered is refused rather than registered: a new file under
 * `src/surfaces/` has no adapter to mount it, so registering it would promise a mount nothing will
 * make. An element whose document names a different tag than its file is refused too — the file is
 * what the kit's registry keys on, and a document that disagrees with its own name is a mistake to
 * report, not one to define under either spelling.
 *
 * @param target What the saved file is.
 * @param doc The document the tab just wrote.
 */
export async function applyLiveSave(
  target: LiveTarget,
  doc: JxDocument,
): Promise<LiveSurfaceResult> {
  if (target.kind === "surface") {
    if (!surfaceDocument(target.name)) {
      return { refused: `no surface is registered as "${target.name}"`, remounted: 0, target };
    }
    registerSurface(target.name, doc);
    const roots = mountsOf(target.name);
    await Promise.all(roots.map((m) => m.remount()));
    return { remounted: roots.length, target };
  }
  if (doc.tagName !== target.tag) {
    return {
      refused: `the document names <${String(doc.tagName)}>, but the file is ${target.tag}.json`,
      remounted: 0,
      target,
    };
  }
  await redefineElement(doc, KIT_BASE);
  const roots = mountsUsing(target.tag);
  await Promise.all(roots.map((m) => m.remount()));
  return { remounted: roots.length, target };
}

/** The two channels a save's outcome is said on. A refusal is a problem; a re-mount is a toast. */
export interface LiveSurfaceNotifier {
  info: (message: string, options: { key: string; source: string }) => void;
  warn: (message: string, options: { key: string; source: string; tier: "problem" }) => void;
}

/**
 * What the lane needs from the shell, as the records themselves rather than closures over them, so
 * the bootstrap hands over objects it already holds and writes no function of its own.
 */
export interface LiveSurfaceDeps {
  /** The workspace record; `projectRoot` is read at save time, never captured. */
  workspace: { readonly projectRoot: string | null };
  notify: LiveSurfaceNotifier;
  /**
   * Redefine an element in every live canvas frame and render them; answers how many were told.
   * `canvas-render.ts`'s `redefineElementOnCanvases`, injected so this module imports no canvas.
   */
  redefineOnCanvases: (doc: JxDocument, base: string) => number;
}

/** The sentence a result is said in. Exported so the wording is tested, not only the branch. */
export function liveSaveNotice(result: LiveSurfaceResult): {
  key: string;
  level: "info" | "warn";
  message: string;
} {
  const what =
    result.target.kind === "surface" ? `surface ${result.target.name}` : result.target.tag;
  const key = `live-chrome:${what}`;
  if (result.refused) {
    return { key, level: "warn", message: `Not applied to the running shell: ${result.refused}.` };
  }
  const canvases =
    result.canvases === undefined || result.canvases === 0
      ? ""
      : result.canvases === 1
        ? " and on the canvas"
        : ` and on ${result.canvases} canvases`;
  if (result.remounted === 0) {
    return {
      key,
      level: "info",
      message: `${what} saved; nothing in the shell is drawn from it${canvases ? `, redefined${canvases}` : ""}.`,
    };
  }
  const places = result.remounted === 1 ? "1 place" : `${result.remounted} places`;
  return {
    key,
    level: "info",
    message: `${what} saved and re-mounted in ${places}${canvases}.`,
  };
}

/**
 * The save listener: decide whether the saved file is chrome, and if it is, apply it and say so.
 *
 * Returns the result, or null when the save was not chrome, so a caller — and a test — can tell
 * "nothing to do" from "did nothing".
 *
 * @param deps The shell's workspace record and notifier.
 */
export function createLiveSurfaceSaver(
  deps: LiveSurfaceDeps,
): (path: string | null, doc: JxDocument | null) => Promise<LiveSurfaceResult | null> {
  return async (path, doc) => {
    const root = deps.workspace.projectRoot;
    const target = liveSurfaceTarget(root, path);
    if (!target || !doc || !root || !path) {
      return null;
    }
    let result = await applyLiveSave(target, doc);
    if (target.kind === "element" && !result.refused) {
      result = { ...result, canvases: deps.redefineOnCanvases(doc, canvasBaseFor(root, path)) };
    }
    const notice = liveSaveNotice(result);
    if (notice.level === "warn") {
      deps.notify.warn(notice.message, { key: notice.key, source: "Studio", tier: "problem" });
    } else {
      deps.notify.info(notice.message, { key: notice.key, source: "Studio" });
    }
    return result;
  };
}
