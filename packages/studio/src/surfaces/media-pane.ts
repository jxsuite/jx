/// <reference lib="dom" />
/**
 * The Media viewer surface: the pane that SHOWS a file, as a Jx document over the kit.
 *
 * This is the adapter. `media/media-pane.ts` keeps the viewer — which pane holds which tab, when
 * the metadata and the reference count are asked for, what a copy writes and what a row opens — and
 * hands this module one projection: which of the six stages to draw, the URL that loads it, the
 * facts beside it, and the documents that already reference it. The document renders that and
 * decides nothing.
 *
 * **Six stages, one discriminant.** `$switch` over a value is the only conditional a document has,
 * and "is this a font, is it a PDF, and does the browser have an element for it" is three
 * questions. The viewer answers them once and the surface reads a word.
 *
 * **The container is CLEARED, because this is a pane and not a panel.** A panel is handed
 * `.panel-content`, a node lit renders `nothing` into, whose comment markers must survive; the
 * canvas stage is handed to whichever mode owns it whole, and `canvas/canvas-render.ts` hands it
 * over by emptying it. So the mount empties it too, which is what stops two viewers stacking when a
 * second file opens into the same pane before the first mount has settled.
 *
 * @docs studio/projects/media
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import mediaDoc from "./media-pane.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("media-pane", mediaDoc as unknown as JxDocument);

/**
 * Which element the stage draws the file in.
 *
 * `unviewable` is a stage rather than an error: a zip, or a format this build has never heard of,
 * is a file the project builds with, and the box says so.
 */
export type MediaStage = "image" | "video" | "audio" | "embed" | "font" | "unviewable";

/** One document that references this file, and how many times it does. */
export interface MediaUsageRow {
  /** The document's project-relative path. The row's key, its caption and what a click opens. */
  path: string;
  /** The count, already a string: the document writes it and never does arithmetic on it. */
  count: string;
}

/** Everything the document draws, as one value. */
export interface MediaView {
  /** The region id stamped on the root, so the screenshot pipeline can address the viewer. */
  region: string;
  /** The file's own name — the heading, and the `<embed>`'s accessible name. */
  name: string;
  kind: MediaStage;
  /** The URL the parent realm can load the file from. */
  src: string;
  /** Kind, pixel size, bytes and modified date, already joined. */
  facts: string;
  /** The reference a document would write for this file. */
  ref: string;
  /** The pangram the specimen is set in. */
  specimen: string;
  /**
   * The specimen's family, as an inline custom property declaration.
   *
   * The NAME travels and the fallback stack stays in the document's style block, because the stack
   * is a rule and the name is data: it is generated from the path so two specimens open side by
   * side cannot claim one family.
   */
  specimenFamily: string;
  /** The `@font-face` that gives that family a face. Empty for every other stage. */
  fontFace: string;
  /** The extension the `unviewable` box names, or a phrase for a file that has none. */
  extLabel: string;
  /**
   * Whether the "Used by" block is drawn at all.
   *
   * `hidden` is a host with no reference index, which is a different fact from "nothing uses it" —
   * a confident zero is the one answer this surface must never invent.
   */
  usageState: "hidden" | "shown";
  usageHeadline: string;
  usageFiles: MediaUsageRow[];
}

/** What a control can ask the viewer to do. Every one of them is a decision the viewer owns. */
export interface MediaActions {
  copyRef: () => void;
  openDocument: (path: string) => void;
  /** The picture finished loading at this size — the only honest source of pixel dimensions. */
  imageLoaded: (width: number, height: number) => void;
}

export interface MediaSurfaceHandle {
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host. */
  attached: () => boolean;
  update: (view: MediaView) => void;
  dispose: () => void;
}

/**
 * The scope the document reads: {@link MediaView} plus the actions its controls call, and the one
 * `$switch` discriminant derived here — "is there a list" is a restatement of the list, and a view
 * that had to keep the two in step would be a second place to get it wrong.
 */
interface MediaScope extends Record<string, unknown>, MediaView, MediaActions {
  hasUsageFiles: boolean;
}

/** Write a projection into the scope. */
function project(scope: MediaScope, view: MediaView): void {
  scope.region = view.region;
  scope.name = view.name;
  scope.kind = view.kind;
  scope.src = view.src;
  scope.facts = view.facts;
  scope.ref = view.ref;
  scope.specimen = view.specimen;
  scope.specimenFamily = view.specimenFamily;
  scope.fontFace = view.fontFace;
  scope.extLabel = view.extLabel;
  scope.usageState = view.usageState;
  scope.usageHeadline = view.usageHeadline;
  scope.usageFiles = view.usageFiles;
  scope.hasUsageFiles = view.usageFiles.length > 0;
}

/**
 * Mount the Media viewer document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The pane's canvas stage
 * @param {MediaView} view - What to draw right now
 * @param {MediaActions} actions - What each control does
 * @returns {MediaSurfaceHandle}
 */
export function mountMediaSurface(
  host: HTMLElement,
  view: MediaView,
  actions: MediaActions,
): MediaSurfaceHandle {
  host.replaceChildren();
  const scope = reactive<MediaScope>({
    copyRef: actions.copyRef,
    extLabel: "",
    facts: "",
    fontFace: "",
    hasUsageFiles: false,
    imageLoaded: actions.imageLoaded,
    kind: "unviewable",
    name: "",
    openDocument: actions.openDocument,
    ref: "",
    region: "",
    specimen: "",
    specimenFamily: "",
    src: "",
    usageFiles: [],
    usageHeadline: "",
    usageState: "hidden",
  }) as MediaScope;
  project(scope, view);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all there is to wait for: the DOCUMENT is
     what this surface renders, and the kit's Copy button settles its own template one
     `connectedCallback` later without anybody asking it to (§1.1, "await the element"). */
  const ready = mountSurface("media-pane", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
      return surface.root as HTMLElement;
    }
    mounted = surface;
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      /* A mount still in flight has nothing in the host yet, and answering "no" to that would make
         the next canvas repaint tear down the mount it is waiting for and start another. */
      return root === undefined ? true : root instanceof HTMLElement && host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update: (next) => project(scope, next),
  };
}
