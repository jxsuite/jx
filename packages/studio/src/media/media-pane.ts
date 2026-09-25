/// <reference lib="dom" />
/**
 * The Media viewer — a pane that SHOWS a file the studio has no document model for.
 *
 * Clicking an image in the Files tree used to end in a toast: `openFileInTab` reads every file as
 * text, finds no format class and no `.json`, and throws — so a PNG produced _"No format class
 * imported for public/hero.jpg — add one to project.json imports"_, advice that means nothing about
 * a binary asset. Video, audio, fonts and PDFs all failed the same way, and so did every tile in
 * the Library, which routes to the same function. There was no way at all to look at an asset the
 * project contains, which is exactly what somebody who has just imported a site needs to do.
 *
 * Almost nothing here is new. `files/media-paths.ts` already computes a src the parent realm can
 * load, `files/media-meta.ts` already holds size, modified time and — once an `<img>` has loaded —
 * pixel dimensions, and `files/media-usage.ts` already answers "which pages use this?" honestly.
 * That last one had, in `site-architecture.md` §9.4's own words, _no reader but the delete
 * confirmation_: you could only learn what an image was used for by trying to remove it. This is
 * the surface that query was waiting for.
 *
 * Read-only, deliberately. Rename, delete and reveal are the file tree's, and a second set of
 * buttons for them here would be a second place to keep them right.
 *
 * **This module is the flow; `surfaces/media-pane.json` is the markup.** Everything below decides
 * something — which pane holds which tab, which of the six stages a file belongs in, when the
 * metadata and the reference count are asked for, what a copy writes and what a row opens — and
 * hands the surface a projection with no decisions left in it.
 *
 * @docs studio/projects/media
 */

import { effect, effectScope } from "../reactivity";
import { paneRegion } from "../ui/regions";
import { mediaSiteUrl, previewFileSrc } from "../files/media-paths";
import { formatBytes, loadMediaMeta, peekMediaMeta, recordImageSize } from "../files/media-meta";
import { extensionOf, mediaKind } from "../files/media-upload";
import { loadMediaUsages, mediaUsageHeadline, peekMediaUsages } from "../files/media-usage";
import { mountMediaSurface } from "../surfaces/media-pane";
import type { MediaStage, MediaSurfaceHandle, MediaView } from "../surfaces/media-pane";
import type { MediaMeta } from "../files/media-meta";
import type { UsageState } from "../services/references";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";

/** The `canvasMode` the media viewer draws under. */
export const MEDIA_MODE = "media";

/** Extensions the viewer renders as a font specimen rather than as a file it cannot show. */
const FONT_EXTENSIONS = new Set([".woff", ".woff2", ".ttf", ".otf"]);

/** The pangram the font specimen is set in — short, and every letter of the alphabet once. */
const SPECIMEN = "The quick brown fox jumps over the lazy dog";

// ─── Mounting ────────────────────────────────────────────────────────────────

interface ActiveMediaPane {
  paneId: string;
  tabId: string;
  wrap: HTMLElement;
  surface: MediaSurfaceHandle;
  scope: { stop: () => void; run: <T>(fn: () => T) => T | undefined };
}

/**
 * The viewer mounted in each pane, keyed by pane id.
 *
 * Per pane rather than a singleton, for the reason `content/entry-editor.ts` documents: `media` is
 * a kind the side pane may host, so two panes can hold one at once and a shared slot would let the
 * second mount stop the first one's effect scope.
 */
const _active = new Map<string, ActiveMediaPane>();

function activeIn(paneId: string): ActiveMediaPane | null {
  return _active.get(paneId) ?? null;
}

/** Whether this tab's viewer is already mounted in this pane and still in the document. */
export function mediaPaneMounted(paneId: string, tab: Tab): boolean {
  const panel = activeIn(paneId);
  return (
    panel !== null && panel.tabId === tab.id && panel.wrap.isConnected && panel.surface.attached()
  );
}

/** Tear one pane's viewer down (mode change, tab switch, project close). Idempotent. */
export function detachMediaPane(paneId: string): void {
  const panel = _active.get(paneId);
  if (!panel) {
    return;
  }
  panel.scope.stop();
  panel.surface.dispose();
  _active.delete(paneId);
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * Which element the stage should draw this file in.
 *
 * A font is decided by extension before anything else: `mediaKind` calls a `.woff2` a plain file,
 * and a file the browser cannot render is the last answer here rather than the first.
 */
function stageFor(path: string): MediaStage {
  const ext = extensionOf(path);
  if (FONT_EXTENSIONS.has(ext)) {
    return "font";
  }
  const kind = mediaKind({ name: path });
  if (kind === "image" || kind === "video" || kind === "audio") {
    return kind;
  }
  return ext === ".pdf" ? "embed" : "unviewable";
}

/** Kind, dimensions, size and modified time — each omitted rather than zeroed when unknown. */
function factsLine(path: string, meta: MediaMeta | null): string {
  const facts: string[] = [mediaKind({ name: path })];
  if (meta?.width != null && meta.height != null) {
    facts.push(`${meta.width} × ${meta.height}`);
  }
  if (meta?.bytes != null) {
    facts.push(formatBytes(meta.bytes));
  }
  if (meta?.modified) {
    facts.push(`modified ${meta.modified.slice(0, 10)}`);
  }
  return facts.join(" · ");
}

/** The family name a specimen is set in, generated from the path so two cannot collide. */
function specimenFamily(path: string): string {
  return `jx-specimen-${path.replaceAll(/[^a-zA-Z0-9]/g, "-")}`;
}

/** Which documents reference this file, or the honest reason there is no list. */
function usageOf(
  usage: UsageState | null,
): Pick<MediaView, "usageState" | "usageHeadline" | "usageFiles"> {
  const headline = mediaUsageHeadline(usage);
  if (headline === null) {
    // The host has no reference index. A zero here would be a number nobody can stand behind.
    return { usageFiles: [], usageHeadline: "", usageState: "hidden" };
  }
  const files = usage?.status === "ready" ? usage.result.files : [];
  return {
    usageFiles: files.map((file) => ({ count: String(file.count), path: file.path })),
    usageHeadline: headline,
    usageState: "shown",
  };
}

/**
 * Open a document that references this file.
 *
 * Dynamic, for the reason `content/entry-editor.ts` gives: `files/files.ts` reaches the platform,
 * the format registry and the packages layer, and a static edge would drag all of it in here.
 */
async function openDocument(path: string): Promise<void> {
  const { openFileInTab } = await import("../files/files");
  await openFileInTab(path);
}

// ─── Render ──────────────────────────────────────────────────────────────────

/**
 * Mount the media viewer into the pane.
 *
 * The same non-iframe-editor pattern as the grid, the Library, Project Settings and the Entry form:
 * it owns its own effect scope from here, so learning an image's dimensions repaints this panel and
 * nothing else.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderMediaMode(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap: canvasWrap } = surface;
  if (mediaPaneMounted(paneId, tab)) {
    return;
  }
  detachMediaPane(paneId);

  const path = tab.documentPath ?? "";
  const family = specimenFamily(path);
  const src = previewFileSrc(path);
  const ref = mediaSiteUrl(path);
  const ext = extensionOf(path);
  const kind = stageFor(path);

  let panel: ActiveMediaPane | null = null;
  const redraw = () => {
    if (panel !== null && activeIn(paneId) === panel) {
      draw();
    }
  };

  const view = (): MediaView => {
    const meta = peekMediaMeta(path);
    const usage = peekMediaUsages(path);
    /* Asked on the first paint that finds it missing, never on every paint: both loaders cache and
       de-duplicate in flight, and both repaint through `redraw` when they land. */
    if (meta === null) {
      void loadMediaMeta(path).then(redraw);
    }
    if (usage === null || usage.status === "pending") {
      void loadMediaUsages(path).then(redraw);
    }
    return {
      extLabel: ext || "this file",
      facts: factsLine(path, meta),
      /* The face is scoped to the generated family name, so two specimens open side by side cannot
         claim the same one. Written only for a font: every other stage carries an empty sheet. */
      fontFace:
        kind === "font" ? `@font-face { font-family: "${family}"; src: url("${src}"); }` : "",
      kind,
      name: path.split("/").pop() ?? "",
      ref,
      region: paneRegion(paneId, "media"),
      specimen: SPECIMEN,
      specimenFamily: `--jx-specimen-family: "${family}"`,
      src,
      ...usageOf(usage),
    };
  };

  const draw = () => {
    panel?.surface.update(view());
  };

  const scope = effectScope();
  const mounted = mountMediaSurface(canvasWrap, view(), {
    copyRef: () => {
      void navigator.clipboard?.writeText(ref);
    },
    imageLoaded: (width, height) => {
      /* The only honest source of pixel dimensions in a browser is an image that has loaded, and
         this viewer is showing one at full size anyway. `recordImageSize` reports whether the
         number was new, so a repaint happens once rather than on every load event. */
      if (recordImageSize(path, width, height)) {
        redraw();
      }
    },
    openDocument: (target: string) => {
      void openDocument(target);
    },
  });
  panel = { paneId, scope, surface: mounted, tabId: tab.id, wrap: canvasWrap };
  _active.set(paneId, panel);

  scope.run(() => {
    effect(() => {
      if (activeIn(paneId) !== panel) {
        return;
      }
      /* The tab's path is the whole of what this pane draws from — the file's bytes are the
         browser's problem, and its metadata repaints through `redraw`. Reading it here is what
         makes a rename repaint the viewer rather than leave it pointing at a name that is gone. */
      void tab.documentPath;
      draw();
    });
  });
}
