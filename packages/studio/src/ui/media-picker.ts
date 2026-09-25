/// <reference lib="dom" />
/**
 * Media Picker — the project's media, and the two surfaces that offer them.
 *
 * The FIELD (`surfaces/media-field.json`) is a control a row draws: a thumbnail of what the value
 * names, the value itself, an Upload button that adds a new file to the project and assigns it, and
 * a Browse button. The BROWSER (`surfaces/media-browser.json`) is the panel Browse opens: a search
 * box over the files under `public/`, with thumbnail previews for images.
 *
 * **This module is the flow, not the markup.** Both surfaces are Jx documents now; what is left
 * here is which files count as media, what a row's caption says, how long a keystroke waits before
 * it becomes a document write, and what a pick commits. Callers that used to interpolate a template
 * returned from here draw an empty box and call {@link mountMediaPicker} instead — a document
 * cannot be handed back as a value, and a document CLEARS the host it is given, so the two could
 * never have shared a container anyway.
 *
 * **The browse list carries metadata, and it costs nothing.** Size comes from the directory listing
 * the widget already performs to enumerate the files (`seedMediaMeta`), and pixel dimensions come
 * from the thumbnails it already loads (`recordImageSize`) — measuring an image is a decode the
 * `<img>` has finished by the time `load` fires, so the caption is a read of work already done
 * rather than a second fetch per row. What is NOT here is a usage count: `findReferences` sweeps
 * every document in the project per query, and fifty of those to caption a list is the wrong trade.
 * Usage is asked once, about one file, where it changes a decision — the delete confirmation
 * (`files/media-usage.ts`).
 *
 * @docs studio/projects/media
 */

import { getPlatform } from "../platform";
import { debouncedStyleCommit, renderOnly } from "../store";
import { mountMediaFieldSurface } from "../surfaces/media-field";
import { openMediaBrowserSurface } from "../surfaces/media-browser";
import { rectOf } from "../utils/geometry";
import { previewAssetSrc } from "../canvas/asset-refs";
import {
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  uploadAccept,
  extensionOf,
  uploadAssets,
} from "../files/media-upload";
import {
  invalidateMediaMeta,
  mediaMetaSummary,
  peekMediaMeta,
  recordImageSize,
  seedMediaMeta,
} from "../files/media-meta";
import { mediaSiteUrl, previewFileSrc } from "../files/media-paths";
import type { MediaBrowserRow, MediaBrowserSurfaceHandle } from "../surfaces/media-browser";
import type { MediaFieldHandle, MediaFieldView } from "../surfaces/media-field";

// ─── Media file cache ────────────────────────────────────────────────────────

/** One browsable media file: the ref a pick writes, and the file that ref names. */
interface MediaEntry {
  /** The value committed to the field — the site URL, which is the authored form. */
  path: string;
  /** Project-relative path on disk, the key everything in `media-meta` is stored under. */
  file: string;
  name: string;
  isImage: boolean;
}

let mediaCache: MediaEntry[] = [];
let mediaCacheLoaded = false;

/**
 * Recursively collect media files from a directory, seeding {@link seedMediaMeta} with the listing
 * on the way past — the size of every row is already in the response that enumerated it.
 */
async function collectMedia(
  dir: string,
  platform: ReturnType<typeof getPlatform>,
): Promise<MediaEntry[]> {
  const results: MediaEntry[] = [];
  try {
    const entries = await platform.listDirectory(dir);
    seedMediaMeta(entries);
    for (const entry of entries) {
      if (entry.type === "directory") {
        const sub = await collectMedia(entry.path, platform);
        results.push(...sub);
      } else {
        const ext = extensionOf(entry.name);
        if (MEDIA_EXTENSIONS.has(ext)) {
          results.push({
            file: entry.path,
            isImage: IMAGE_EXTENSIONS.has(ext),
            name: entry.name,
            // The site URL is what production serves and therefore what a document should say.
            // Media-paths holds the one definition of that mapping.
            path: mediaSiteUrl(entry.path),
          });
        }
      }
    }
  } catch {
    // Directory may not exist
  }
  return results;
}

async function loadMediaCache() {
  if (mediaCacheLoaded) {
    return;
  }
  const platform = getPlatform();
  mediaCache = await collectMedia("public", platform);
  mediaCacheLoaded = true;
  // Re-render the host panels so the browse panel has entries to show once the async listing
  // Resolves. Mirrors loadLayoutEntries()'s renderOnly() in head-panel.
  renderOnly("leftPanel", "rightPanel", "frontmatterPanel");
}

/**
 * Force media cache reload (e.g. after upload).
 *
 * The metadata cache goes with it, and for the same reason: both were derived from a listing that
 * is now out of date, and a size that survives the write it contradicts is worse than no size.
 */
export function invalidateMediaCache() {
  mediaCache = [];
  mediaCacheLoaded = false;
  invalidateMediaMeta();
}

// ─── The browser ─────────────────────────────────────────────────────────────

/** The most rows the panel lists. Everything past it is counted rather than drawn. */
const BROWSE_LIMIT = 50;

/** The open panel, and what a pick in it commits. One at a time. */
let _browser: MediaBrowserSurfaceHandle | null = null;
let _browserCommit: ((value: string) => void) | null = null;
let _browserFilter = "";
/** Where the panel was opened, kept so a filter keystroke does not move it. */
let _browserOrigin = { x: 0, y: 0 };

/** What the panel shows for the filter that stands now. */
function browserView() {
  const query = _browserFilter.toLowerCase();
  const filtered = query
    ? mediaCache.filter(
        (m) => m.path.toLowerCase().includes(query) || m.name.toLowerCase().includes(query),
      )
    : mediaCache;
  const listed = filtered.slice(0, BROWSE_LIMIT);
  const rows: MediaBrowserRow[] = listed.map((m) => {
    const caption = mediaMetaSummary(peekMediaMeta(m.file));
    return {
      caption,
      captionState: caption ? "shown" : "hidden",
      file: m.file,
      key: m.file,
      name: m.name,
      path: m.path,
      thumbSrc: m.isImage ? previewFileSrc(m.file) : "",
      thumbState: m.isImage ? "shown" : "hidden",
    };
  });
  return {
    emptyLabel: "No matches",
    filter: _browserFilter,
    moreLabel: `…${filtered.length - BROWSE_LIMIT} more`,
    moreState: (filtered.length > BROWSE_LIMIT ? "shown" : "hidden") as "hidden" | "shown",
    rows,
    rowsState: (rows.length > 0 ? "listed" : "empty") as "empty" | "listed",
    x: _browserOrigin.x,
    y: _browserOrigin.y,
  };
}

/** Take the panel down. Idempotent, and it forgets what a pick would have committed. */
function dismissMediaPickerPopover() {
  const open = _browser;
  _browser = null;
  _browserCommit = null;
  _browserFilter = "";
  open?.close();
}

/** A repaint scheduled by a thumbnail that just reported its size, or 0 when none is pending. */
let _sizeRepaint = 0;

/**
 * Fold a loaded thumbnail's intrinsic size into the metadata cache and, if that was news, repaint
 * the panel once so the caption appears.
 *
 * The repaint is coalesced across a whole list of images landing in the same frame, and it cannot
 * loop: a repaint that changes nothing about a row leaves its `<img>` alone, and a row that IS
 * rebuilt fires `load` again from cache, where `recordImageSize` returns false the second time
 * because the measurement has not changed.
 */
function noteImageSize(file: string, width: number, height: number) {
  if (!recordImageSize(file, width, height) || _sizeRepaint !== 0) {
    return;
  }
  _sizeRepaint = requestAnimationFrame(() => {
    _sizeRepaint = 0;
    _browser?.update(browserView());
  });
}

/**
 * Open the media browser under `anchorEl` and commit whatever is picked.
 *
 * Exported because the panel is a SURFACE OF ITS OWN — it renders into the popover layer, not into
 * the field that opened it — so a converted surface can offer the same browser without
 * re-implementing it. `surfaces/doc-header.ts`'s Browse button is the first such caller.
 *
 * @param {HTMLElement} anchorEl
 * @param {(val: string) => void} onCommit
 */
export function showMediaPickerPopover(anchorEl: HTMLElement, onCommit: (val: string) => void) {
  dismissMediaPickerPopover();
  _browserCommit = onCommit;
  const box = rectOf(anchorEl);
  /* Where it opens, once. `jx-popover` clamps a freshly shown panel into the viewport itself, so
     nothing here measures the panel or flips it above a low anchor — that was the layer-div
     popover's job because a layer div has no platform behind it. */
  _browserOrigin = { x: box.left, y: box.bottom + 4 };
  _browser = openMediaBrowserSurface(
    browserView(),
    {
      dismissed: () => {
        _browser = null;
        _browserCommit = null;
        _browserFilter = "";
      },
      measure: noteImageSize,
      pick: (path: string) => {
        const commit = _browserCommit;
        dismissMediaPickerPopover();
        commit?.(path);
      },
      setFilter: (value: string) => {
        _browserFilter = value;
        _browser?.update(browserView());
      },
    },
    anchorEl,
  );
}

// ─── Upload ──────────────────────────────────────────────────────────────────

/**
 * Upload files chosen in a media field's file input and assign the first one to the field. Exported
 * for the unit tests — the hidden input is created on demand, so there is no other way to reach
 * it.
 *
 * @param {FileList | File[]} files
 * @param {(val: string) => void} onCommit
 */
export async function uploadAndAssign(
  files: FileList | File[],
  onCommit: (val: string) => void,
): Promise<void> {
  const uploaded = await uploadAssets([...files]);
  const [first] = uploaded;
  if (first) {
    onCommit(first.ref);
  }
}

/**
 * Open the OS file picker for a media field. The input is created per click and discarded after — a
 * persistent hidden input would be one more node every host has to own.
 *
 * Exported for the same reason {@link showMediaPickerPopover} is: it opens an OS dialog rather than
 * rendering anything, so a surface that is a document can offer Upload without drawing a widget.
 *
 * @param {(val: string) => void} onCommit
 */
export function pickAndUpload(onCommit: (val: string) => void) {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = uploadAccept();
  input.addEventListener("change", () => {
    if (input.files?.length) {
      void uploadAndAssign(input.files, onCommit);
    }
  });
  input.click();
}

// ─── The field ───────────────────────────────────────────────────────────────

/** The standard live-preview debounce for a typed media path. */
const FIELD_DEBOUNCE_MS = 400;

/** One mounted field, and the decisions that move under it between repaints. */
interface FieldEntry {
  handle: MediaFieldHandle;
  prop: string;
  commit: (value: string) => void;
}

/**
 * The fields this module has mounted, by the host they were mounted into.
 *
 * A WeakMap rather than a list: the caller owns the box, and a box that has gone should take its
 * entry with it. It is not a substitute for {@link unmountMediaPicker} — a mount is recorded in
 * `services/surface-registry.ts`, which holds the host — but it is what makes a repeated
 * {@link mountMediaPicker} an update instead of a second document in the same box.
 */
const _fields = new WeakMap<HTMLElement, FieldEntry>();

/** What the control draws for a value. */
function fieldView(prop: string, value: string): MediaFieldView {
  const isImage = IMAGE_EXTENSIONS.has(extensionOf(value));
  return {
    label: prop,
    thumbSrc: isImage && value ? previewAssetSrc(value) : "",
    thumbState: isImage && value ? "shown" : "hidden",
    value,
  };
}

/**
 * Draw the media field into a host the caller owns, or bring the one already there up to date.
 *
 * The idempotence is the point: the Content tab repaints its controls on every projection, and a
 * second mount into the same box would be a second document over the first. A repeat call moves the
 * scope instead, so the field the reader is typing in keeps its caret.
 *
 * @param {HTMLElement} host - An empty box the caller drew
 * @param {string} prop - The attribute or prop being edited; the field's accessible name
 * @param {string} value - What it holds now
 * @param {(val: string) => void} onCommit - What a pick or a settled keystroke writes
 */
export function mountMediaPicker(
  host: HTMLElement,
  prop: string,
  value: string,
  onCommit: (val: string) => void,
): void {
  // Kick off async load (won't block the mount)
  void loadMediaCache();
  const existing = _fields.get(host);
  if (existing) {
    existing.prop = prop;
    existing.commit = onCommit;
    existing.handle.update(fieldView(prop, value));
    return;
  }
  const entry: FieldEntry = { commit: onCommit, handle: null as unknown as MediaFieldHandle, prop };
  entry.handle = mountMediaFieldSurface(host, fieldView(prop, value), {
    browse: (anchor: HTMLElement) => {
      void loadMediaCache();
      showMediaPickerPopover(anchor, (val: string) => entry.commit(val));
    },
    /* Debounced under the prop's own key, so the canvas follows the typing without a document write
       per keystroke and two fields never share a timer. */
    edit: (next: string) =>
      debouncedStyleCommit(`media:${entry.prop}`, FIELD_DEBOUNCE_MS, (v: string) =>
        entry.commit(v),
      )(next),
    upload: () => pickAndUpload((val: string) => entry.commit(val)),
    warm: () => {
      void loadMediaCache();
    },
  });
  _fields.set(host, entry);
}

/**
 * Take a mounted field down and forget its host.
 *
 * The caller has to say so: a mount is recorded in the surface registry, which holds the host
 * strongly, so a box dropped from a projection would otherwise keep its document alive.
 *
 * @param {HTMLElement} host
 */
export function unmountMediaPicker(host: HTMLElement): void {
  const entry = _fields.get(host);
  if (entry) {
    _fields.delete(host);
    entry.handle.dispose();
  }
}
