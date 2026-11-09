/// <reference lib="dom" />
/**
 * The Image editor — an image asset edited where it is opened (studio.md §9.5).
 *
 * A mode of the media tab, beside the read-only viewer (`media/media-pane.ts`), because losing
 * unsaved work is this feature's worst outcome and §14.7 already owns that problem: the dirty-close
 * prompt, the close that waits on the write, and the two-answer variant for a collaborator who
 * cannot write. This module is the flow; `surfaces/image-editor.json` is the markup, reached
 * through a dynamic import so neither it nor the bake (`media/image-bake.ts`) is in the entry
 * bundle.
 *
 * **Two maps, at two scopes.** The recipe, its undo stack, the decoded source and the dirty flag
 * are per TAB, because the mode is per tab (`tab.session.ui.canvasMode`) and a crop belongs to the
 * file: two panes showing one image tab are both in the editor, and they show one pending crop, so
 * {@link saveImage}, {@link imageEditorDirty} and `shouldWarnOnClose` all have one subject. Only
 * the mount, its effect scope, the roving handle and an in-flight drag are per PANE.
 *
 * **One write door.** The chord (`saveFile` delegates here), the Save button and the close prompt
 * all reach {@link saveImage}, and the refusals live inside it rather than at any caller.
 *
 * @docs studio/projects/media
 */

import { isNumber } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { effect, effectScope, reactive, toRaw } from "../reactivity";
import { getPlatform, hasPlatform } from "../platform";
import { projectState } from "../store";
import { notify } from "../services/notify";
import { announce } from "../services/announce";
import { paneRegion } from "../ui/regions";
import { collabReadOnly } from "../collab/collab-session";
import { setHistoryDelegate } from "../tabs/transact";
import { setEditBesideDocument, tabIsLive, workspace } from "../workspace/workspace";
import { formatBytes, recordImageSize } from "../files/media-meta";
import { replaceAsset } from "../files/media-upload";
import { carryRecordBetween } from "../files/media-record";
import { editRefusal, mimeForPath, sniffImage, takesQuality } from "./image-format";
import {
  ASPECTS,
  CROP_STOPS,
  HANDLE_LABELS,
  cropOf,
  focusThrough,
  displaySize,
  filterString,
  fitForWebWidth,
  flip,
  historyOf,
  isIdentity,
  moveStop,
  orientedSize,
  outputSize,
  pushStep,
  redoStep,
  sourceToDisplay,
  swapsAxes,
  turn,
  undoStep,
  withAspect,
  withValue,
  withWidth,
} from "./image-recipe";
import type { CropStop, ImageRecipe, PixelSize, RecipeHistory } from "./image-recipe";
import type {
  ImageEditorActions,
  ImageEditorSurfaceHandle,
  ImageEditorView,
  ImageHandleRow,
} from "../surfaces/image-editor";
import type * as ImageEditorSurfaceModule from "../surfaces/image-editor";
import type * as ImageBakeModule from "./image-bake";
import type { BakeResult } from "./image-bake";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { HistoryDelegate } from "../tabs/transact";
import type { Tab } from "../tabs/tab";

/** The `canvasMode` the Image editor draws under. */
export const IMAGE_MODE = "image";

/**
 * The widths the build derives when a project declares none (`packages/compiler`'s site loader).
 * Read here rather than imported, so Studio keeps its dependencies; **Fit for web** proposes from
 * the project's own `images.widths` first and from these only in its absence.
 */
export const BUILD_DEFAULT_WIDTHS: readonly number[] = [320, 640, 960, 1280, 1920];

// ─── Lazy modules ────────────────────────────────────────────────────────────

/* One cached promise per module: two dynamic imports of one module in flight at once is the shape
   that loses its coverage record (AGENTS.md), and it would also be two requests for one chunk. */
let _surface: Promise<typeof ImageEditorSurfaceModule> | null = null;
let _bake: Promise<typeof ImageBakeModule> | null = null;

function surfaceModule(): Promise<typeof ImageEditorSurfaceModule> {
  _surface ??= import("../surfaces/image-editor");
  return _surface;
}

function bakeModule(): Promise<typeof ImageBakeModule> {
  _bake ??= import("./image-bake");
  return _bake;
}

// ─── Per tab ─────────────────────────────────────────────────────────────────

/** The bytes the editor holds, and what the page shows them through. */
interface ImageSource {
  bytes: Uint8Array<ArrayBuffer>;
  /** A same-origin `blob:` URL for {@link ImageSource.bytes}, revoked when the source is replaced. */
  url: string;
}

/** One tab's edit. Reactive, so every pane showing the tab repaints from one record. */
interface ImageSession {
  history: RecipeHistory;
  /** The recipe mid-drag, pushed as ONE step when the gesture ends; null between gestures. */
  live: ImageRecipe | null;
  source: ImageSource | null;
  /**
   * The decoded size, orientation applied: the frame the crop is stored in. Kept when the bytes are
   * released, because whether the tab holds unsaved work must not depend on a pane showing it.
   */
  size: PixelSize | null;
  /**
   * Whether {@link ImageSession.size} is the decoded size rather than the header's first guess. No
   * gesture is taken until it is, because a crop is stored in the decoded frame, and the two differ
   * for a photograph with an orientation tag: a crop made in the header's frame lands elsewhere.
   */
  decoded: boolean;
  /**
   * Whether a number field holds text it has not committed. That is unsaved work like a Monaco
   * buffer's (`tabs/typing.ts`), and what lets the Save chord through to commit and write it.
   */
  typed: boolean;
  status: "loading" | "ready" | "refused";
  message: string;
  saving: boolean;
  /** Bumped by every load, so a read that lands after a newer one began is dropped. */
  generation: number;
}

/**
 * Per-tab sessions, keyed by the RAW tab: the readers reach tabs through reactive proxies and the
 * writers through the raw object, and a closed tab's edit goes with it rather than resurfacing when
 * the same path is opened again.
 */
const _sessions = new WeakMap<Tab, ImageSession>();

function sessionOf(tab: Tab): ImageSession | undefined {
  return _sessions.get(toRaw(tab));
}

function sessionFor(tab: Tab): ImageSession {
  const raw = toRaw(tab);
  let session = _sessions.get(raw);
  if (!session) {
    session = reactive<ImageSession>({
      decoded: false,
      generation: 0,
      history: historyOf(),
      live: null,
      message: "Reading the image…",
      saving: false,
      size: null,
      source: null,
      status: "loading",
      typed: false,
    });
    _sessions.set(raw, session);
    /* ⌘Z and the command bar's Undo are the tab's history, and this tab's history is the recipe: its
       document is a stub with nothing to undo. Registered under both faces of the tab, because a
       writer holds the raw object and a reader the reactive proxy, and `transact`'s map is keyed by
       whichever it is handed. */
    const delegate = historyDelegateFor(session);
    setHistoryDelegate(raw, delegate);
    setHistoryDelegate(tab, delegate);
  }
  return session;
}

/** The recipe's undo stack, as the tab's history. */
function historyDelegateFor(session: ImageSession): HistoryDelegate {
  return {
    canRedo: () => !session.saving && session.history.future.length > 0,
    canUndo: () => !session.saving && session.history.past.length > 0,
    redo: () => {
      if (!session.saving) {
        session.history = redoStep(session.history);
      }
    },
    undo: () => {
      if (!session.saving) {
        session.history = undoStep(session.history);
      }
    },
  };
}

/** The recipe on screen: the in-flight drag's, or the history's present. */
function currentRecipe(session: ImageSession): ImageRecipe {
  return session.live ?? session.history.present;
}

/** Point a session at new bytes, revoking the URL the old ones were shown through. */
function setSource(session: ImageSession, bytes: Uint8Array<ArrayBuffer>, mime: string): void {
  /* Swapped in place rather than through `loading`, so a save leaves the frame standing: only the
     picture's src changes, and a keyboard user's focus stays on the handle they were using. */
  const previous = session.source;
  session.source = { bytes, url: URL.createObjectURL(new Blob([bytes], { type: mime })) };
  session.status = "ready";
  session.message = "";
  if (previous !== null) {
    URL.revokeObjectURL(previous.url);
  }
}

/** Drop the bytes and their URL; the next mount or save reads them again. */
function releaseSource(session: ImageSession): void {
  if (session.source !== null) {
    URL.revokeObjectURL(session.source.url);
    session.source = null;
    session.status = "loading";
  }
}

/**
 * Read the file's bytes into the session, unless it already holds them.
 *
 * The editable set is decided HERE, from the bytes (§9.5): an animated `.png` or `.webp`, bytes of
 * another format than the extension says, or a source past the pixel ceiling is refused with the
 * reason, before anything is decoded.
 */
async function ensureSource(session: ImageSession, path: string): Promise<void> {
  if (session.source !== null) {
    return;
  }
  session.generation += 1;
  const { generation } = session;
  session.status = "loading";
  session.message = "Reading the image…";
  const platform = hasPlatform() ? getPlatform() : null;
  const read = platform?.readFileBytes;
  if (read === undefined) {
    session.status = "refused";
    session.message = "This backend cannot hand Studio a file's raw bytes, so it cannot edit one.";
    return;
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await read.call(platform, path));
  } catch (error) {
    if (session.generation === generation) {
      session.status = "refused";
      session.message = `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`;
    }
    return;
  }
  if (session.generation !== generation) {
    return;
  }
  const refusal = editRefusal(path, bytes);
  if (refusal !== null) {
    session.status = "refused";
    session.message = refusal;
    return;
  }
  /* The header's size is a first guess, replaced by the decoded size the moment the picture loads;
     the two differ only for a photograph with an orientation tag. A size already known (the bytes
     were released and are being read again) is the decoded one, and is kept. */
  session.size ??= sniffImage(bytes).size;
  setSource(session, bytes, mimeForPath(path) ?? "");
}

/** Whether this tab holds an image edit that has not been written. */
export function imageEditorDirty(tab: Tab): boolean {
  const session = sessionOf(tab);
  const size = session?.size;
  if (session === undefined || size === null || size === undefined) {
    return false;
  }
  return session.typed || !isIdentity(currentRecipe(session), size);
}

/** Replace the recipe as one undoable step. */
function commit(session: ImageSession, next: ImageRecipe): void {
  session.live = null;
  session.history = pushStep(session.history, next);
}

// ─── Per pane ────────────────────────────────────────────────────────────────

interface DragState {
  handle: CropStop;
  pointerId: number;
  startX: number;
  startY: number;
  start: ImageRecipe;
  /** Image pixels per screen pixel in the frame the author is looking at. */
  scale: number;
}

interface ImagePane {
  paneId: string;
  tab: Tab;
  wrap: HTMLElement;
  scope: { stop: () => void; run: <T>(fn: () => T) => T | undefined };
  surface: ImageEditorSurfaceHandle | null;
  disposed: boolean;
  drag: DragState | null;
  /** The one crop stop in the tab order. */
  active: CropStop;
  /** The rows last drawn, kept while the active handle is unchanged so the list is not rebuilt. */
  rows: ImageHandleRow[];
}

const _panes = new Map<string, ImagePane>();

/** Whether this tab's editor is mounted in this pane and still in the document. */
export function imageEditorMounted(paneId: string, tab: Tab): boolean {
  const pane = _panes.get(paneId);
  return (
    pane !== undefined &&
    toRaw(pane.tab) === toRaw(tab) &&
    pane.wrap.isConnected &&
    (pane.surface === null || pane.surface.attached())
  );
}

/**
 * Tear one pane's editor down (mode change, tab switch, project close). Idempotent.
 *
 * The recipe stays with the tab, because it is the tab's unsaved work and §14.7 asks about it on
 * close. The decoded source goes when the last pane showing the tab does: it is re-read on the next
 * mount, and holding a full-size image for a tab nobody is looking at is the one allocation here
 * that is large.
 */
export function detachImageEditor(paneId: string): void {
  const pane = _panes.get(paneId);
  if (!pane) {
    return;
  }
  pane.disposed = true;
  pane.scope.stop();
  pane.surface?.dispose();
  _panes.delete(paneId);
  const session = sessionOf(pane.tab);
  // A gesture that never ended is not a step (§9.5), so the drag this pane was running is abandoned.
  if (pane.drag !== null && session !== undefined) {
    session.live = null;
  }
  // The field that held any uncommitted text has just gone with the pane.
  if (session !== undefined && panesShowing(pane.tab).length === 0) {
    session.typed = false;
  }
  // A save running now releases them itself when it finishes, having needed them until then.
  if (panesShowing(pane.tab).length === 0 && session !== undefined && !session.saving) {
    releaseSource(session);
    session.generation += 1;
  }
}

/** The handle rows, rebuilt only when the roving stop moves. */
function handleRows(pane: ImagePane): ImageHandleRow[] {
  if (pane.rows.length === 0 || pane.rows.find((row) => row.tabindex === "0")?.id !== pane.active) {
    pane.rows = CROP_STOPS.map((id) => ({
      id,
      label: HANDLE_LABELS[id],
      tabindex: id === pane.active ? "0" : "-1",
    }));
  }
  return pane.rows;
}

/** A number as a percentage string, to four places — enough for a 16384-pixel side. */
function percent(value: number): string {
  return `${Number(value.toFixed(4))}%`;
}

/** The widths **Fit for web** chooses from: the project's own, or the build's defaults. */
function projectWidths(): readonly number[] {
  /* SAFETY: `images` is the project's build section; only an array of numbers is used, and any
     other shape falls back to the build's own defaults, which is what the build would do. */
  const images = projectState?.projectConfig?.images as { widths?: unknown } | undefined;
  const widths = images?.widths;
  return Array.isArray(widths) && widths.length > 0 && widths.every((width) => isNumber(width))
    ? widths
    : BUILD_DEFAULT_WIDTHS;
}

/** The ratio picker's rows, built once: the options never change, so the list is never redrawn. */
const ASPECT_OPTIONS = ASPECTS.map(({ id, label }) => ({ label, value: id }));

/** The projection for one pane. Pure over the session and the pane. */
function viewOf(pane: ImagePane, session: ImageSession): ImageEditorView {
  const path = pane.tab.documentPath ?? "";
  const name = path.split("/").pop() ?? path;
  const recipe = currentRecipe(session);
  const size = session.size ?? { height: 1, width: 1 };
  const shown = displaySize(recipe.turns, size);
  const crop = sourceToDisplay(cropOf(recipe, size), recipe, size);
  const oriented = orientedSize(recipe, size);
  const out = outputSize(recipe, size);
  const fit = fitForWebWidth(recipe, size, projectWidths());
  const mime = mimeForPath(path) ?? "";
  const known = session.source !== null && session.decoded && session.size !== null;
  const dirty = known && (session.typed || !isIdentity(recipe, size));
  const odd = swapsAxes(recipe.turns);
  return {
    alt: `${name}, being edited`,
    aspect: recipe.aspect,
    aspectOptions: ASPECT_OPTIONS,
    brightness: String(recipe.brightness),
    busy: session.saving || !known,
    /* Not while saving: a browser takes focus from an input as it is disabled, and a save from the
       keyboard must leave the author where they were. A save refuses edits itself. */
    undecoded: !known,
    cannotFit: session.saving || !known || fit === null || fit === out.width,
    cannotRedo: session.saving || session.history.future.length === 0,
    cannotSave: session.saving || !dirty || collabReadOnly(pane.tab),
    cannotUndo: session.saving || session.history.past.length === 0,
    clean: session.saving || !dirty,
    contrast: String(recipe.contrast),
    cropH: percent((crop.height / shown.height) * 100),
    cropW: percent((crop.width / shown.width) * 100),
    cropX: percent((crop.x / shown.width) * 100),
    cropY: percent((crop.y / shown.height) * 100),
    facts: known
      ? `Output ${out.width} × ${out.height} · crop ${oriented.width} × ${oriented.height} · source ${size.width} × ${size.height}`
      : "",
    filter: filterString(recipe) || "none",
    fitHint:
      fit === null
        ? "Already no wider than the largest width the build derives."
        : "The largest of the project's image widths (images.widths, or the build's defaults) below this crop.",
    fitLabel: fit === null ? "Fit for web" : `Fit for web (${fit} px)`,
    handleHelpId: `${paneRegion(pane.paneId, "image")}/handle-help`,
    handles: handleRows(pane),
    imageHeight: odd ? percent((size.height / shown.height) * 100) : "100%",
    imageTransform: `translate(-50%, -50%) scale(${recipe.flipH ? -1 : 1}, ${recipe.flipV ? -1 : 1}) rotate(${recipe.turns * 90}deg)`,
    imageWidth: odd ? percent((size.width / shown.width) * 100) : "100%",
    maxOutputWidth: String(oriented.width),
    maxWidth: `${shown.width}px`,
    message: session.message,
    // A crop of the whole image has nowhere to go, so the area does not offer to move.
    moveCursor: recipe.crop === null ? "default" : "move",
    name,
    quality: takesQuality(mime) ? "shown" : "hidden",
    qualityValue: String(recipe.quality),
    ratio: String(shown.width / shown.height),
    region: paneRegion(pane.paneId, "image"),
    saturation: String(recipe.saturation),
    saving: session.saving,
    src: session.source?.url ?? "",
    status: session.status,
    warning: `Save overwrites ${path} and keeps no backup. Source control is how to get the original back.`,
    width: String(out.width),
  };
}

// ─── Gestures ────────────────────────────────────────────────────────────────

/** Say where the crop is now, for a reader who cannot see the frame move. */
function announceCrop(handle: CropStop, recipe: ImageRecipe, size: PixelSize): void {
  const crop = sourceToDisplay(cropOf(recipe, size), recipe, size);
  announce(`${HANDLE_LABELS[handle]}: crop ${crop.width} × ${crop.height} at ${crop.x}, ${crop.y}`);
}

function isHandle(value: string): value is CropStop {
  return CROP_STOPS.some((stop) => stop === value);
}

/** The actions one pane's document calls. Each reads the session the moment it runs. */
function actionsFor(pane: ImagePane, session: ImageSession): ImageEditorActions {
  const sized = (): PixelSize | null =>
    session.source === null || !session.decoded ? null : session.size;
  /* A value the recipe refused or clamped may leave the recipe as it was, and then nothing would
     correct the field, which must show what a save would use rather than what was typed. */
  const syncFields = () => pane.surface?.syncFields(viewOf(pane, session));
  // The toolbar's Undo and Redo are the same two functions ⌘Z reaches.
  const history = historyDelegateFor(session);
  const step = (next: (recipe: ImageRecipe, size: PixelSize) => ImageRecipe) => {
    const size = sized();
    if (size !== null && !session.saving) {
      commit(session, next(currentRecipe(session), size));
    }
  };
  return {
    cycleHandle: (handle, direction) => {
      if (!isHandle(handle)) {
        return;
      }
      const at = CROP_STOPS.indexOf(handle);
      const by = direction < 0 ? -1 : 1;
      const next = CROP_STOPS[(at + by + CROP_STOPS.length) % CROP_STOPS.length]!;
      pane.active = next;
      pane.surface?.update(viewOf(pane, session));
      pane.surface?.focusHandle(next);
      announce(HANDLE_LABELS[next]);
    },
    fieldEdited: () => {
      session.typed = true;
    },
    fitForWeb: () => {
      step((recipe, size) => {
        const width = fitForWebWidth(recipe, size, projectWidths());
        return width === null ? recipe : withWidth(recipe, size, width);
      });
    },
    flip: (axis) => {
      step((recipe) => flip(recipe, axis === "v" ? "v" : "h"));
    },
    handleDown: (handle, pointerId, clientX, clientY, target) => {
      const size = sized();
      const rect = pane.surface?.frameRect();
      if (size === null || !isHandle(handle) || !rect || rect.width <= 0 || session.saving) {
        return;
      }
      target.setPointerCapture(pointerId);
      pane.active = handle;
      pane.drag = {
        handle,
        pointerId,
        scale: displaySize(currentRecipe(session).turns, size).width / rect.width,
        start: currentRecipe(session),
        startX: clientX,
        startY: clientY,
      };
    },
    handleFocused: (handle) => {
      if (isHandle(handle) && pane.active !== handle) {
        pane.active = handle;
        pane.surface?.update(viewOf(pane, session));
      }
    },
    handleMove: (pointerId, clientX, clientY) => {
      const { drag } = pane;
      const size = sized();
      if (drag === null || drag.pointerId !== pointerId || size === null || session.saving) {
        return;
      }
      session.live = moveStop(
        drag.start,
        size,
        drag.handle,
        (clientX - drag.startX) * drag.scale,
        (clientY - drag.startY) * drag.scale,
      );
    },
    handleUp: (pointerId) => {
      const { drag } = pane;
      if (drag === null || drag.pointerId !== pointerId) {
        return;
      }
      pane.drag = null;
      // One drag is one step, pushed as the gesture ends rather than while it moves.
      if (session.live !== null) {
        commit(session, session.live);
      }
    },
    imageFailed: (src) => {
      /* A header can parse over a body that does not decode, and the controls must not stand live
         over a broken picture. The src is compared because a swap at save fires for the old URL. */
      if (session.source?.url !== src) {
        return;
      }
      releaseSource(session);
      session.status = "refused";
      session.message = `${pane.tab.documentPath ?? "This file"} could not be decoded, so it cannot be edited.`;
    },
    imageLoaded: (width, height) => {
      if (session.source === null || !(width > 0 && height > 0)) {
        return;
      }
      session.decoded = true;
      if (session.size?.width !== width || session.size.height !== height) {
        session.size = { height, width };
      }
      recordImageSize(pane.tab.documentPath ?? "", width, height);
    },
    nudge: (handle, dx, dy, large) => {
      const size = sized();
      if (size === null || !isHandle(handle) || session.saving) {
        return;
      }
      const by = large ? 10 : 1;
      const next = moveStop(currentRecipe(session), size, handle, dx * by, dy * by);
      commit(session, next);
      announceCrop(handle, next, size);
    },
    redo: () => {
      history.redo(pane.tab);
    },
    reset: () => {
      step(() => historyOf().present);
    },
    rotate: (direction) => {
      step((recipe) => turn(recipe, direction < 0 ? -1 : 1));
    },
    save: () => {
      void saveImage(pane.tab);
    },
    setAspect: (value) => {
      const choice = ASPECTS.find((aspect) => aspect.id === value);
      if (choice) {
        step((recipe, size) => withAspect(recipe, size, choice.id));
      }
    },
    setValue: (key, value) => {
      /* An empty field reads as nothing rather than as zero: a cleared Quality would otherwise be a
         1% JPEG written over the master, with nothing on screen to say so. */
      if (
        value.trim() !== "" &&
        (key === "brightness" || key === "contrast" || key === "saturation" || key === "quality")
      ) {
        step((recipe) => withValue(recipe, key, Number(value)));
      }
      session.typed = false;
      syncFields();
    },
    setWidth: (value) => {
      step((recipe, size) => withWidth(recipe, size, value.trim() === "" ? null : Number(value)));
      session.typed = false;
      syncFields();
    },
    undo: () => {
      history.undo(pane.tab);
    },
  };
}

// ─── Render ──────────────────────────────────────────────────────────────────

/**
 * Mount the Image editor into the pane. The same non-iframe-editor pattern as the media viewer: it
 * owns its own effect scope from here, so a gesture repaints this pane (and any other pane showing
 * the tab) and nothing reaches the canvas pipeline.
 */
export function renderImageMode(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap } = surface;
  if (imageEditorMounted(paneId, tab)) {
    return;
  }
  detachImageEditor(paneId);
  const session = sessionFor(tab);
  const pane: ImagePane = {
    active: "nw",
    disposed: false,
    drag: null,
    paneId,
    rows: [],
    scope: effectScope(),
    surface: null,
    tab,
    wrap,
  };
  _panes.set(paneId, pane);
  void ensureSource(session, tab.documentPath ?? "");
  void surfaceModule().then(({ mountImageEditorSurface }) => {
    if (pane.disposed) {
      return;
    }
    pane.surface = mountImageEditorSurface(wrap, viewOf(pane, session), actionsFor(pane, session));
    pane.scope.run(() => {
      effect(() => {
        if (!pane.disposed) {
          pane.surface?.update(viewOf(pane, session));
        }
      });
    });
  });
}

// ─── The one write door ──────────────────────────────────────────────────────

/**
 * The session's bytes, read again when no pane is holding them or an earlier read failed.
 *
 * Read twice at most: a pane mounting during the first read starts a newer one, which drops this
 * one, and the second read's answer stands either way. Null means the file could not be read, and
 * the session's message says why.
 */
async function settledSource(session: ImageSession, path: string): Promise<ImageSource | null> {
  if (session.source === null) {
    await ensureSource(session, path);
  }
  if (session.source === null && session.status === "loading") {
    await ensureSource(session, path);
  }
  return session.source;
}

/** The panes showing this tab right now. */
function panesShowing(tab: Tab): ImagePane[] {
  const raw = toRaw(tab);
  return [..._panes.values()].filter((pane) => toRaw(pane.tab) === raw);
}

/**
 * Write the tab's edit over its file. The one door every save of an image passes through (§9.5).
 *
 * In order: a read-only collaborator is refused, as every other save is (§14.7); a number still
 * being typed and a drag still moving become part of the edit, so what is written is what is on
 * screen; an edit that changes nothing writes nothing; the bake verifies its own output; a tab
 * closed or renamed while that ran writes nothing, because the answer that closed it or the name it
 * now has outranks the save that was pending; the write goes through §9.3's Replace path, so an
 * edit has the same story about caches, usages and a backend that stored the file elsewhere as the
 * gesture beside it; and only a write that landed at the path resets the recipe — after the source
 * has been replaced by the bytes just written, so an empty recipe always means "what is on disk"
 * and the next save cannot write the original back.
 *
 * @returns Whether the file now holds the edit (true, too, when no edit was pending). False is what
 *   stops the close prompt's Save from closing the tab on top of a write that did not happen.
 */
export async function saveImage(tab: Tab): Promise<boolean> {
  const path = tab.documentPath ?? "";
  const name = path.split("/").pop() ?? path;
  if (collabReadOnly(tab)) {
    notify.warn(
      `You have read access to this session — the edit to ${name} stays in your browser and cannot be saved.`,
      { key: `image.readOnly:${path}`, path, source: "Collaboration" },
    );
    return false;
  }
  const session = sessionOf(tab);
  if (session === undefined || session.saving) {
    return session === undefined;
  }
  for (const pane of panesShowing(tab)) {
    pane.surface?.flushFields();
    pane.drag = null;
  }
  // Text the blur did not commit was typed back to what it already said.
  session.typed = false;
  if (session.live !== null) {
    commit(session, session.live);
  }
  // Claimed before the first await, so a second Save pressed while this one reads is refused.
  session.saving = true;
  try {
    const { size } = session;
    const recipe = currentRecipe(session);
    if (size === null || isIdentity(recipe, size)) {
      notify.info(`${name} has no changes, so nothing was written.`, {
        key: `image.identity:${path}`,
      });
      return true;
    }
    const failed = (detail: string): false => {
      notify.error(`Could not save ${name}.`, { detail, path, source: "Image" });
      return false;
    };
    const source = await settledSource(session, path);
    if (source === null) {
      return failed(session.message);
    }
    const mime = mimeForPath(path) ?? "";
    const { bakeImage } = await bakeModule();
    let result: BakeResult;
    try {
      result = await bakeImage(recipe, source.bytes, mime);
    } catch (error) {
      return failed(`The browser could not process this image: ${errorMessage(error)}`);
    }
    if (!result.ok) {
      return failed(result.reason);
    }
    /* The canvas re-encode carries no metadata, so the file's alt text, tags and focal point are carried from the
       bytes it was edited from (§22.6), and what is written is also the next save's source. Done
       here, before the liveness check, which must share one synchronous stretch with the upload. */
    const written = carryRecordBetween(
      path,
      source.bytes,
      new Uint8Array(await result.blob.arrayBuffer()),
      // The focal point moves with the pixels: turned, mirrored, measured inside the crop.
      (focus) => focusThrough(focus, recipe, size),
    );
    /* Checked in the same synchronous stretch as the upload call below, so neither the tab nor the
       project root can move between the two. After a project switch a project-relative path names
       a file in the OTHER project. */
    if (!tabIsLive(tab)) {
      return false;
    }
    if (tab.documentPath !== path) {
      return failed(`It was renamed while saving, so the edit was not written to its old name.`);
    }
    const was = formatBytes(source.bytes.byteLength);
    const grew = written.byteLength > source.bytes.byteLength ? ", so the file grew" : "";
    const replaced = await replaceAsset(path, new File([written], name, { type: mime }), {
      carry: false,
      note: `${result.size.width} × ${result.size.height}, ${formatBytes(written.byteLength)} (was ${was}${grew})`,
    });
    if (!replaced) {
      // Two files exist now, or none was written: the edit is still the author's to decide about.
      return false;
    }
    /* Re-read from the bytes just written BEFORE the recipe resets: the source and the recipe are
       always of one generation, so the next save starts from what is on disk. */
    setSource(session, written, mime);
    session.size = result.size;
    session.decoded = true;
    recordImageSize(path, result.size.width, result.size.height);
    session.live = null;
    session.history = historyOf();
    return true;
  } finally {
    session.saving = false;
    // A save from the viewer, or from the close prompt, read bytes no pane is holding.
    if (panesShowing(tab).length === 0) {
      releaseSource(session);
      session.generation += 1;
    }
  }
}

/**
 * Whether **Replace** may write over `path`. Not while its tab holds an edit: the recipe was made
 * against the bytes Replace is about to overwrite, so the next save would apply an old crop to the
 * new picture and write that over the file the author just chose. Refused with the way out.
 */
export function imageEditorAllowsReplace(path: string): boolean {
  const tab = workspace.tabs.get(path);
  if (!tab || !imageEditorDirty(tab)) {
    return true;
  }
  const name = path.split("/").pop() ?? path;
  notify.warn(`${name} has an unsaved edit. Save or discard it before replacing the file.`, {
    key: `image.replaceDirty:${path}`,
    path,
    source: "Image",
  });
  return false;
}

/**
 * The file at `path` has new bytes that did not come from this editor: Replace, or a change the
 * file-event stream reported. An editor with no pending edit reads them, so an empty recipe still
 * means what is on disk. One holding an edit is left alone (§9.5 says what that means).
 */
export function imageFileChanged(path: string): void {
  const tab = workspace.tabs.get(path);
  const session = tab && sessionOf(tab);
  if (!tab || session === undefined || session.saving || imageEditorDirty(tab)) {
    return;
  }
  releaseSource(session);
  session.generation += 1;
  session.size = null;
  session.decoded = false;
  session.live = null;
  // The steps behind the present were made against the old picture.
  session.history = historyOf();
  if (panesShowing(tab).length > 0) {
    void ensureSource(session, path);
  }
}

setEditBesideDocument(imageEditorDirty);
