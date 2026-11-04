/// <reference lib="dom" />
/**
 * The Image editor surface: one image asset, edited where it is opened (studio.md §9.5).
 *
 * This is the adapter. `media/image-editor.ts` keeps the recipe, its undo stack, the decoded source
 * and the one write door, and hands this module a flat projection: pre-formatted geometry strings,
 * the values the fields show, and the words the `$switch`es read. The document renders that and
 * decides nothing.
 *
 * **One island.** A drag converts screen pixels into the image's own frame, which needs the frame's
 * drawn size, so the frame element is captured as it is created (`onNodeCreated`,
 * studio-ui-guidelines.md §9.4) and the flow asks for its rect. The handles are captured the same
 * way, so moving the roving tab stop to the next handle focuses an element this module was handed
 * rather than one it searched for.
 *
 * **The container is CLEARED, because this is a pane and not a panel** — the reason
 * `surfaces/media-pane.ts` gives: the canvas stage is handed to whichever mode owns it whole.
 *
 * @docs studio/projects/media
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import imageEditorDoc from "./image-editor.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxElement } from "@jxsuite/schema/types";

registerSurface("image-editor", imageEditorDoc);

/** One crop handle as the document draws it. */
export interface ImageHandleRow {
  id: string;
  /** Where it sits on screen, as a reader hears it. */
  label: string;
  /** `"0"` for the one handle in the tab order, `"-1"` for the other seven. */
  tabindex: string;
}

/** Everything the document draws, as one value. */
export interface ImageEditorView {
  region: string;
  /** `loading` while the bytes are read, `refused` with the reason, `ready` with a picture. */
  status: "loading" | "ready" | "refused";
  /** What the loading or refused box says. */
  message: string;
  name: string;
  alt: string;
  /** A same-origin `blob:` URL for the bytes the editor holds. */
  src: string;
  /** The oriented aspect, width over height, as a number string. */
  ratio: string;
  /** The oriented width in CSS pixels, so the preview is never upscaled. */
  maxWidth: string;
  imageWidth: string;
  imageHeight: string;
  imageTransform: string;
  /** The tone pass, the same string the bake sets on its context; `none` when neutral. */
  filter: string;
  cropX: string;
  cropY: string;
  cropW: string;
  cropH: string;
  handles: ImageHandleRow[];
  handleHelpId: string;
  /** The ratio the crop is held to, and the picker's rows. */
  aspect: string;
  aspectOptions: { label: string; value: string }[];
  /** The crop area's cursor: `move`, or `default` when there is nowhere for it to go. */
  moveCursor: string;
  facts: string;
  width: string;
  maxOutputWidth: string;
  fitLabel: string;
  fitHint: string;
  quality: "shown" | "hidden";
  qualityValue: string;
  brightness: string;
  contrast: string;
  saturation: string;
  warning: string;
  /** Disabled flags, each named for the state that disables. */
  busy: boolean;
  undecoded: boolean;
  cannotUndo: boolean;
  cannotRedo: boolean;
  cannotFit: boolean;
  clean: boolean;
  cannotSave: boolean;
  saving: boolean;
}

/** What a control can ask the editor to do. Every one is a decision the flow owns. */
export interface ImageEditorActions {
  imageLoaded: (width: number, height: number) => void;
  imageFailed: (src: string) => void;
  rotate: (direction: number) => void;
  flip: (axis: string) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
  save: () => void;
  fieldEdited: () => void;
  fitForWeb: () => void;
  setWidth: (value: string) => void;
  setAspect: (value: string) => void;
  setValue: (key: string, value: string) => void;
  handleDown: (
    handle: string,
    pointerId: number,
    clientX: number,
    clientY: number,
    target: Element,
  ) => void;
  handleMove: (pointerId: number, clientX: number, clientY: number) => void;
  handleUp: (pointerId: number) => void;
  handleFocused: (handle: string) => void;
  nudge: (handle: string, dx: number, dy: number, large: boolean) => void;
  cycleHandle: (handle: string, step: number) => void;
}

export interface ImageEditorSurfaceHandle {
  ready: Promise<HTMLElement>;
  /** Whether what was mounted is still inside the host; true while the mount is in flight. */
  attached: () => boolean;
  update: (view: ImageEditorView) => void;
  /** The drawn frame's rect, or null before it exists. */
  frameRect: () => DOMRect | null;
  /** Move focus to one handle, when it has been drawn. */
  focusHandle: (handle: string) => void;
  /** Commit a number still being typed, so a save writes what is on screen. Keeps the focus. */
  flushFields: () => void;
  /** Put the view's values back in the number fields, whatever was typed into them. */
  syncFields: (view: ImageEditorView) => void;
  dispose: () => void;
}

type ImageEditorScope = ImageEditorView & ImageEditorActions;

/** Each number field's `part`, which is also the name of the view value it shows. */
const FIELD_VALUES = {
  brightness: "brightness",
  contrast: "contrast",
  quality: "qualityValue",
  saturation: "saturation",
  width: "width",
} as const;

function isFieldPart(part: string): part is keyof typeof FIELD_VALUES {
  return Object.hasOwn(FIELD_VALUES, part);
}

/**
 * The `part` a definition declares, or `""`. Read off the DEFINITION, because a node is announced
 * as it is created, before its attributes are applied.
 */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** The handle a mapped row stands for, read off its `$map` item. */
function mappedHandle(state: JxScope | undefined): string | null {
  const map = state?.["$map"];
  const item = isNonNullObject(map) && "item" in map ? map.item : undefined;
  return isNonNullObject(item) && "id" in item && isString(item.id) ? item.id : null;
}

/**
 * Write a projection into the scope. Each key is assigned through the reactive proxy, which
 * notifies only when a value moved, so a drag that changes four crop strings redraws those four.
 */
function project(scope: ImageEditorScope, view: ImageEditorView): void {
  Object.assign(scope, view);
}

/**
 * Mount the Image editor document into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The pane's canvas stage
 * @param {ImageEditorView} view - What to draw right now
 * @param {ImageEditorActions} actions - What each control does
 * @returns {ImageEditorSurfaceHandle}
 */
export function mountImageEditorSurface(
  host: HTMLElement,
  view: ImageEditorView,
  actions: ImageEditorActions,
): ImageEditorSurfaceHandle {
  host.replaceChildren();
  const scope = reactive<ImageEditorScope>({ ...view, ...actions });

  let frame: Element | null = null;
  const handles = new Map<string, HTMLElement>();
  const fields = new Map<keyof typeof FIELD_VALUES, HTMLElement>();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("image-editor", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      // `disposed` first: nodes are still created while a mount that was taken down runs out.
      if (disposed || !(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "frame") {
        frame = element;
      } else if (part === "handle") {
        const id = mappedHandle(state);
        if (id !== null) {
          handles.set(id, element);
        }
      } else if (isFieldPart(part)) {
        fields.set(part, element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    /* SAFETY: `image-editor.json`'s root definition is a `div` element, so the runtime mounts an
       HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    return surface.root as HTMLElement;
  });

  return {
    attached: () => {
      if (disposed) {
        return false;
      }
      const root = mounted?.root;
      return root === undefined ? true : host.contains(root);
    },
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
      frame = null;
      handles.clear();
      fields.clear();
    },
    focusHandle: (handle) => {
      const element = handles.get(handle);
      if (element?.isConnected) {
        element.focus();
      }
    },
    frameRect: () => (frame?.isConnected ? rectOf(frame) : null),
    flushFields: () => {
      /* A number input commits on blur, which fires its change event synchronously, and the
         document's handler then takes the value. Focused straight back, so the author's place is
         not lost to a keystroke that only meant "save". */
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && host.contains(active)) {
        active.blur();
        active.focus();
      }
    },
    ready,
    syncFields: (next) => {
      for (const [part, element] of fields) {
        if (element.isConnected && "value" in element) {
          element.value = next[FIELD_VALUES[part]];
        }
      }
    },
    update: (next) => project(scope, next),
  };
}
