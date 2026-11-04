/**
 * Open a media file in the viewer.
 *
 * The shape of `grid/grid-open.ts`'s `openCsvGridTab`, and for the same reason: a real file tab
 * keyed by its path, with a stub document, because the tab model wants A DOCUMENT and this file is
 * not one. The viewer never reads it — it reads `tab.documentPath` and shows the bytes at that path
 * through an `<img>`, a `<video>` or a font specimen.
 *
 * `.svg` gets a `source` mode beside the viewer: it is the one media format that is also text, and
 * hand-editing one is an ordinary thing to want.
 *
 * The modes are set HERE rather than in `tabs/tab.ts`'s `inferModes`, which is the same division
 * CSV already lives under: `inferModes` answers for DOCUMENTS, from the format registry, and an
 * opener answers for the files that are not documents. Every media tab is created through this
 * function — `openFileInTab` routes to it, and session restore goes through `openFileInTab` — so
 * there is no path by which one is built without them.
 *
 * @docs studio/projects/media
 */

import { isFunction } from "@jxsuite/schema/guards";
import { activateTab, openTab, workspace } from "../workspace/workspace";
import { extensionOf, isMediaFile } from "../files/media-upload";
import { getPlatform, hasPlatform } from "../platform";
import { notify } from "../services/notify";
import { collabReadOnly } from "../collab/collab-session";
import { toRaw } from "../reactivity";
import { MEDIA_MODE } from "./media-pane";
import { IMAGE_MODE } from "./image-editor";
import { editRefusal, isEditableExtension } from "./image-format";
import type { Tab } from "../tabs/tab";

/** Placeholder document for a media tab — the viewer never reads it, and there is nothing to save. */
const MEDIA_STUB_DOCUMENT = { children: [], tagName: "div" };

/** Whether this path opens in the media viewer rather than through a document parse. */
export function isViewableMedia(path: string): boolean {
  return isMediaFile(path);
}

/**
 * The modes a media tab offers, as far as the path can say. SVG is also text, so it keeps a source
 * alternate; a still raster in a format the host can encode gets the Image editor (studio.md §9.5)
 * on a host that can hand Studio a file's raw bytes. A refused format is not offered rather than
 * offered and then refused, and the half of that the extension cannot answer (an animated `.png` or
 * `.webp`, say) is {@link withdrawRefusedEditor}'s.
 */
export function mediaTabModes(path: string): string[] {
  if (extensionOf(path) === ".svg") {
    return [MEDIA_MODE, "source"];
  }
  if (isEditableExtension(path) && hasPlatform() && isFunction(getPlatform().readFileBytes)) {
    return [MEDIA_MODE, IMAGE_MODE];
  }
  return [MEDIA_MODE];
}

/**
 * Open (or activate) a media file's viewer tab.
 *
 * The options are `openFileInTab`'s own, passed straight through: `paneId` says which pane the tab
 * lands in (defaulting to the focused one), `focus: false` browses without moving the keyboard, and
 * `preview` opens a disposable tab. An existing tab is activated with the caller's `focus` — the
 * same rule the document path follows.
 *
 * @param {string} path - Project-relative path of the file
 * @param {{ paneId?: string; focus?: boolean; preview?: boolean }} [opts]
 * @returns {Tab}
 */
export function openMediaTab(
  path: string,
  opts: { paneId?: string; focus?: boolean; preview?: boolean } = {},
): Tab {
  const existing = workspace.tabs.get(path);
  if (existing) {
    activateTab(path, { focus: opts.focus !== false });
    return existing;
  }
  const tab = openTab({
    capabilities: { modes: mediaTabModes(path) },
    document: structuredClone(MEDIA_STUB_DOCUMENT),
    documentPath: path,
    id: path,
    sourceFormat: null,
    ...(opts.paneId !== undefined && { paneId: opts.paneId }),
    ...(opts.preview === true && { preview: true }),
    ...(opts.focus === false && { focus: false }),
  });
  void withdrawRefusedEditor(tab, path);
  return tab;
}

/** Why a tab's Image editor was withdrawn, so a later attempt can say so again. */
const _withdrawn = new WeakMap<Tab, string>();

/**
 * Take the Image editor off a tab whose bytes refuse it: an extension is a claim about the bytes,
 * and a still `.png` and an animated one share an extension (studio.md §9.5).
 *
 * The extension already answered for every file the mode could never write, so this reads only a
 * file the path says is editable, and the viewer is drawing those same bytes anyway. A read that
 * fails decides nothing: the editor reports it if the author goes there. A tab already in the mode
 * goes back to the viewer and says why, because a mode that vanished in silence would look like a
 * click that did nothing.
 */
async function withdrawRefusedEditor(tab: Tab, path: string): Promise<void> {
  if (!tab.capabilities.modes.includes(IMAGE_MODE)) {
    return;
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await getPlatform().readFileBytes!(path));
  } catch {
    return;
  }
  const refusal = editRefusal(path, bytes);
  /* Through the workspace's own face of the tab: `openTab` hands back the raw object, and a write to
     that changes the value without telling the Editor control. It also answers a tab the read
     outlived, which has nothing left to withdraw from. */
  const live = workspace.tabs.get(path);
  if (refusal === null || !live) {
    return;
  }
  _withdrawn.set(toRaw(live), refusal);
  live.capabilities.modes = live.capabilities.modes.filter((mode) => mode !== IMAGE_MODE);
  if (live.session.ui.canvasMode === IMAGE_MODE) {
    live.session.ui.canvasMode = MEDIA_MODE;
    notify.warn(refusal, { key: `image.refused:${path}`, path, source: "Image" });
  }
}

/**
 * Whether to offer the Image editor for a file in a list of them: what the path says, and what its
 * open tab has since learned. The palette's `media.edit` cannot ask this (its context describes the
 * focused tab), so it is the flow's refusal there.
 */
export function canEditImage(path: string): boolean {
  if (!mediaTabModes(path).includes(IMAGE_MODE)) {
    return false;
  }
  const tab = workspace.tabs.get(path);
  return !tab || (tab.capabilities.modes.includes(IMAGE_MODE) && !collabReadOnly(tab));
}

/**
 * Whether this host can copy a media file: a copy needs its raw bytes (studio.md §9.3), and a
 * backend that cannot read them is not offered Duplicate rather than offered it and then refused.
 */
export function canDuplicateMedia(): boolean {
  return hasPlatform() && isFunction(getPlatform().readFileBytes);
}

/**
 * Whether a collaborator with read access to this file's session is the one asking to write it, and
 * if so say so. Asks the PATH's own tab, as {@link openImageEditor} does: a record's context
 * describes the focused tab, which may be another file.
 *
 * @param path The file.
 * @param done How the sentence ends: "renamed", "duplicated".
 */
export function mediaWriteRefused(path: string, done: string): boolean {
  const tab = workspace.tabs.get(path);
  if (!tab || !collabReadOnly(tab)) {
    return false;
  }
  const name = path.split("/").pop() ?? path;
  notify.warn(`You have read access to this session, so ${name} cannot be ${done}.`, {
    key: `media.readOnly:${path}`,
    path,
    source: "Collaboration",
  });
  return true;
}

/**
 * Open a media file in its Image editor (studio.md §9.5) — `media.edit`, and the Media workspace's
 * Edit action. The mode is entered by choosing a subject, never by name through `canvas.setMode`.
 *
 * Refused, with the reason, for a file the editor cannot write (the tab would not offer the mode)
 * and for a collaborator who cannot write the file: the gate asks the PATH's own tab, which is why
 * it lives here rather than on the command record, whose context describes the focused tab.
 *
 * @returns The tab, now in the Image editor, or null when it was refused.
 */
export function openImageEditor(
  path: string,
  opts: { paneId?: string; focus?: boolean } = {},
): Tab | null {
  const name = path.split("/").pop() ?? path;
  if (!mediaTabModes(path).includes(IMAGE_MODE)) {
    notify.warn(`${name} cannot be edited here.`, {
      detail:
        "The Image editor writes PNG, JPEG and WebP, on a backend that can hand Studio a file's raw bytes.",
      key: `image.notEditable:${path}`,
      path,
      source: "Image",
    });
    return null;
  }
  openMediaTab(path, opts);
  // Through the workspace's face of the tab, so the pane redraws (see withdrawRefusedEditor).
  const tab = workspace.tabs.get(path)!;
  /* Asked of the tab as it stands, after the open: a session may have attached in it, and bytes read
     earlier may have withdrawn the mode. Either leaves the tab in its viewer, saying why. */
  if (collabReadOnly(tab)) {
    notify.warn(`You have read access to this session, so ${name} cannot be edited.`, {
      key: `image.readOnly:${path}`,
      path,
      source: "Collaboration",
    });
    return null;
  }
  if (!tab.capabilities.modes.includes(IMAGE_MODE)) {
    notify.warn(_withdrawn.get(toRaw(tab)) ?? `${name} cannot be edited here.`, {
      key: `image.refused:${path}`,
      path,
      source: "Image",
    });
    return null;
  }
  tab.session.ui.canvasMode = IMAGE_MODE;
  return tab;
}
