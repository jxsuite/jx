/// <reference lib="dom" />
/**
 * Media Picker — the project's media, and the compact surfaces that offer them.
 *
 * The FIELD (`surfaces/media-field.json`) is a control a row draws: a thumbnail of what the value
 * names, the value itself, an Upload button that adds a new file to the project and assigns it, and
 * a Browse button. The BROWSER (`surfaces/media-browser.json`) is the compact panel Browse opens: a
 * search box over the project's media, with thumbnail previews for images, and a last row, **Browse
 * all media…**, that opens the Media workspace's own surface in a dialog in pick mode
 * (`media/media-library.ts`, studio.md §9.3). One picker, two sizes.
 *
 * **What media the project has is answered here, once.** {@link projectMediaFiles} walks
 * `public/**` and every collection's `content/<collection>/images/**`, and the Media workspace, the
 * Site panel's Media section, both pickers and the search-appearance dialog all read that one
 * listing, so "what media does this project have" cannot have two answers in two choosers.
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
 * Usage is asked about one file where it changes a decision (the delete confirmation, the Media
 * workspace's detail pane), and about every file only when the reader asks for **Unused**.
 *
 * @docs studio/projects/media
 */

import { getPlatform, hasPlatform } from "../platform";
import { debouncedStyleCommit, renderOnly } from "../store";
import { mountMediaFieldSurface } from "../surfaces/media-field";
import { openMediaBrowserSurface } from "../surfaces/media-browser";
import { rectOf } from "../utils/geometry";
import { previewAssetSrc } from "../canvas/asset-refs";
import {
  IMAGE_EXTENSIONS,
  MEDIA_EXTENSIONS,
  extensionOf,
  mediaFileKind,
  uploadAccept,
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
import { notedListing } from "../files/asset-versions";
import type { MediaFileKind } from "../files/media-upload";
import type {
  MediaBrowserRow,
  MediaBrowserSurfaceHandle,
  MediaBrowserView,
} from "../surfaces/media-browser";
import type { MediaFieldHandle, MediaFieldView } from "../surfaces/media-field";
import type * as MediaLibraryModule from "../media/media-library";

// ─── Media file cache ────────────────────────────────────────────────────────

/** One media file of the project, as every browsing surface lists it. */
export interface ProjectMediaFile {
  /** The project-relative path on disk, the key everything in `media-meta` is stored under. */
  file: string;
  name: string;
  /** The site URL a document authors for it, which is what a pick commits. */
  ref: string;
  isImage: boolean;
  /** What the file is, as the Media workspace's filters name it. */
  kind: MediaFileKind;
}

let mediaCache: ProjectMediaFile[] = [];
let mediaCacheLoaded = false;

/**
 * The directory every collection co-locates its uploads in (`files/media-upload.ts`
 * `uploadDirFor`).
 */
const COLLECTION_IMAGES = "images";

/**
 * Whether a project path is inside the media scan: under `public/`, or under a collection's
 * `content/<collection>/images/`. A filesystem batch that touches neither cannot change what
 * {@link projectMediaFiles} lists, so the listing is kept.
 */
export function isMediaScanPath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/");
  return (
    normalized.startsWith("public/") ||
    new RegExp(`^content/[^/]+/${COLLECTION_IMAGES}/`).test(normalized)
  );
}

/**
 * Recursively collect media files from a directory, seeding {@link seedMediaMeta} with the listing
 * on the way past — the size of every row is already in the response that enumerated it.
 */
async function collectMedia(
  dir: string,
  platform: ReturnType<typeof getPlatform>,
): Promise<ProjectMediaFile[]> {
  const results: ProjectMediaFile[] = [];
  try {
    const entries = await notedListing(() => platform.listDirectory(dir));
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
            kind: mediaFileKind(entry.name),
            name: entry.name,
            // The site URL is what production serves and therefore what a document should say.
            // Media-paths holds the one definition of that mapping, a collection's mount included.
            ref: mediaSiteUrl(entry.path),
          });
        }
      }
    }
  } catch {
    // Directory may not exist
  }
  return results;
}

/**
 * Every collection's co-located `images/` folder: `content/<collection>/images/**`.
 *
 * Listed from `content/` itself rather than from `project.json`'s declarations, because the folder
 * is where an upload from an entry lands whatever its collection's `source` says, and a picker that
 * could not see it could not choose a cover image the author had just uploaded to an entry.
 */
async function collectCollectionImages(
  platform: ReturnType<typeof getPlatform>,
): Promise<ProjectMediaFile[]> {
  let collections: string[];
  try {
    const entries = await platform.listDirectory("content");
    collections = entries.filter((entry) => entry.type === "directory").map((entry) => entry.path);
  } catch {
    return [];
  }
  const results: ProjectMediaFile[] = [];
  for (const dir of collections) {
    /* Descend only into an `images/` the collection actually holds: most collections have none,
       and asking the backend to list a directory that does not exist is a 404 in the console. */
    let holdsImages = false;
    try {
      const entries = await platform.listDirectory(dir);
      holdsImages = entries.some(
        (entry) => entry.type === "directory" && entry.name === COLLECTION_IMAGES,
      );
    } catch {
      // An unreadable collection folder has no images to offer.
    }
    if (holdsImages) {
      results.push(...(await collectMedia(`${dir}/${COLLECTION_IMAGES}`, platform)));
    }
  }
  return results;
}

/** The walk in flight, so every caller that asks while it runs shares it instead of starting one. */
let _mediaLoading: Promise<void> | null = null;
/** Bumped by {@link invalidateMediaCache}, so a walk that started before it cannot land after it. */
let _mediaEpoch = 0;

/** Surfaces that own their own repaint and want to hear when the listing moves. */
const _listeners = new Set<() => void>();

/**
 * Hear about every change to the listing: a walk landing, or an invalidation dropping it.
 *
 * For a surface that is not one of the named panels {@link loadMediaCache} repaints — the Media
 * workspace's library, which owns its own reactivity the way the Library pane does.
 *
 * @returns The unsubscribe.
 */
export function onProjectMediaChange(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function announce(): void {
  for (const listener of _listeners) {
    listener();
  }
}

function loadMediaCache(): Promise<void> {
  if (mediaCacheLoaded) {
    return Promise.resolve();
  }
  if (_mediaLoading) {
    return _mediaLoading;
  }
  if (!hasPlatform()) {
    // No backend to list (a window still booting): nothing is known, and nothing is claimed.
    return Promise.resolve();
  }
  const epoch = _mediaEpoch;
  const walk = (async () => {
    const platform = getPlatform();
    const [published, collections] = await Promise.all([
      collectMedia("public", platform),
      collectCollectionImages(platform),
    ]);
    if (epoch !== _mediaEpoch) {
      // Superseded: this listing is older than the invalidation, and a newer walk owns the cache.
      return;
    }
    mediaCache = [...published, ...collections];
    mediaCacheLoaded = true;
    _mediaLoading = null;
    // Re-render the host panels so the browse panel has entries to show once the async listing
    // Resolves. Mirrors loadLayoutEntries()'s renderOnly() in head-panel.
    renderOnly("leftPanel", "rightPanel", "frontmatterPanel");
    announce();
  })();
  _mediaLoading = walk;
  return walk;
}

/**
 * The project's media, or `null` while the listing is still being read — the same cache the picker
 * browses, so the Site panel's Media section, the Media workspace and the image field cannot
 * disagree about what exists. Asking starts the read; it repaints the panels that read it when it
 * lands, and tells every {@link onProjectMediaChange} listener.
 */
export function projectMediaFiles(): readonly ProjectMediaFile[] | null {
  if (!mediaCacheLoaded) {
    void loadMediaCache();
    return null;
  }
  return mediaCache;
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
  _mediaEpoch += 1;
  _mediaLoading = null;
  invalidateMediaMeta();
  announce();
}

// ─── The full-size picker ────────────────────────────────────────────────────

/** What a chooser offers: every media file, or only images, for a field whose value is a picture. */
export interface MediaPickOptions {
  images?: boolean;
}

/**
 * The library flow, imported on the first **Browse all media…**. One cached promise, because two
 * dynamic imports of a module in flight at once is the shape that loses its coverage record, and a
 * field nobody opened the big picker from should not load the workspace's surface.
 */
let _library: Promise<typeof MediaLibraryModule> | null = null;

function mediaLibrary(): Promise<typeof MediaLibraryModule> {
  _library ??= import("../media/media-library");
  return _library;
}

/**
 * Open the Media workspace's surface in a dialog, in pick mode, and commit what is chosen.
 *
 * @param {(val: string) => void} onCommit - What a pick writes: the file's site URL
 * @param {MediaPickOptions} options - Images only, for a field that holds a picture
 */
export async function openFullMediaPicker(
  onCommit: (val: string) => void,
  options: MediaPickOptions = {},
): Promise<void> {
  const library = await mediaLibrary();
  library.openMediaPickDialog({ images: options.images === true, onPick: onCommit });
}

// ─── The browser ─────────────────────────────────────────────────────────────

/** The most rows the panel lists. Everything past it is counted rather than drawn. */
const BROWSE_LIMIT = 50;

/** The open panel, and what a pick in it commits. One at a time. */
let _browser: MediaBrowserSurfaceHandle | null = null;
let _browserCommit: ((value: string) => void) | null = null;
let _browserFilter = "";
let _browserOptions: MediaPickOptions = {};
/** Where the panel was opened, kept so a filter keystroke does not move it. */
let _browserOrigin = { x: 0, y: 0 };

/** What the panel shows for the filter that stands now. */
function browserView(): MediaBrowserView {
  const query = _browserFilter.toLowerCase();
  const offered = _browserOptions.images ? mediaCache.filter((m) => m.isImage) : mediaCache;
  const filtered = query
    ? offered.filter(
        (m) => m.ref.toLowerCase().includes(query) || m.name.toLowerCase().includes(query),
      )
    : offered;
  const listed = filtered.slice(0, BROWSE_LIMIT);
  const rows: MediaBrowserRow[] = listed.map((m) => {
    const caption = mediaMetaSummary(peekMediaMeta(m.file));
    return {
      caption,
      captionState: caption ? "shown" : "hidden",
      file: m.file,
      key: m.file,
      name: m.name,
      path: m.ref,
      thumbSrc: m.isImage ? previewFileSrc(m.file) : "",
      thumbState: m.isImage ? "shown" : "hidden",
    };
  });
  return {
    browseAllLabel: _browserOptions.images ? "Browse all images…" : "Browse all media…",
    /* An empty project says so, rather than "No matches" over a search nobody typed: the Upload
       beside the field and the row below are what to do about it. */
    emptyLabel:
      offered.length > 0
        ? "No matches"
        : _browserOptions.images
          ? "No images in this project yet"
          : "No media in this project yet",
    filter: _browserFilter,
    moreLabel: `…${filtered.length - BROWSE_LIMIT} more`,
    moreState: filtered.length > BROWSE_LIMIT ? "shown" : "hidden",
    rows,
    rowsState: rows.length > 0 ? "listed" : "empty",
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
 * re-implementing it. `surfaces/doc-header.ts`'s Browse button is the first such caller, and the
 * search-appearance dialog's image rows another: the panel is a top-layer `jx-popover`, so it
 * paints over the modal that opened it.
 *
 * @param {HTMLElement} anchorEl
 * @param {(val: string) => void} onCommit
 * @param {MediaPickOptions} options - Images only, for a field that holds a picture
 */
export function showMediaPickerPopover(
  anchorEl: HTMLElement,
  onCommit: (val: string) => void,
  options: MediaPickOptions = {},
) {
  dismissMediaPickerPopover();
  void loadMediaCache().then(() => _browser?.update(browserView()));
  _browserCommit = onCommit;
  _browserOptions = options;
  const box = rectOf(anchorEl);
  /* Where it opens, once. `jx-popover` clamps a freshly shown panel into the viewport itself, so
     nothing here measures the panel or flips it above a low anchor — that was the layer-div
     popover's job because a layer div has no platform behind it. */
  _browserOrigin = { x: box.left, y: box.bottom + 4 };
  _browser = openMediaBrowserSurface(
    browserView(),
    {
      browseAll: () => {
        const commit = _browserCommit;
        const chosen = _browserOptions;
        dismissMediaPickerPopover();
        if (commit) {
          void openFullMediaPicker(commit, chosen);
        }
      },
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
/** What a field's callbacks read at call time; a re-mount rewrites both in place. */
interface FieldBinding {
  prop: string;
  commit: (value: string) => void;
  options: MediaPickOptions;
}

interface FieldEntry extends FieldBinding {
  handle: MediaFieldHandle;
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
 * @param {MediaPickOptions} options - Images only, for a field whose value is a picture
 */
export function mountMediaPicker(
  host: HTMLElement,
  prop: string,
  value: string,
  onCommit: (val: string) => void,
  options: MediaPickOptions = {},
): void {
  // Kick off async load (won't block the mount)
  void loadMediaCache();
  const existing = _fields.get(host);
  if (existing) {
    existing.prop = prop;
    existing.commit = onCommit;
    existing.options = options;
    existing.handle.update(fieldView(prop, value));
    return;
  }
  const entry: FieldBinding = { commit: onCommit, options, prop };
  const handle = mountMediaFieldSurface(host, fieldView(prop, value), {
    browse: (anchor: HTMLElement) => {
      showMediaPickerPopover(anchor, (val: string) => entry.commit(val), entry.options);
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
  // The same object, so the callbacks above see a later re-mount's `prop` and `commit`.
  _fields.set(host, Object.assign(entry, { handle }));
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
