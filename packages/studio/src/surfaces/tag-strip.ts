/// <reference lib="dom" />
/**
 * The Inspector's bound-value strip: `tag-strip.json`, mounted into the box a row left for it.
 *
 * One per row, and a row is repainted often, so the mount is keyed by its host: the first paint
 * mounts the document and every later one is an assignment. A host that left the page, or that
 * another control cleared and drew into, is given up (the pattern `surfaces/expression-editor.ts`
 * set for the same box).
 *
 * @docs studio/editing/dynamic-tags
 */

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import tagStripDoc from "./tag-strip.json";

import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("tag-strip", tagStripDoc);

/** One run of a bound value: literal text, or a chip standing for one tag. */
export interface TagStripRun {
  /** The run's place in the value; for a chip, what a press hands back. */
  key: string;
  kind: "text" | "chip";
  /** The literal text, or the chip's name. */
  text: string;
  /** What the chip resolves to on the canvas; empty until it is known, and for a literal run. */
  value: string;
  /** The chip's accessible name: its name and its value. */
  name: string;
  /** `field`, `format`, `custom` or `ref`; empty for a literal run. */
  tagKind: string;
}

/** Everything the strip draws. */
export interface TagStripView {
  /** What the value is, for the group's accessible name: "Text Content". */
  label: string;
  /** The runs and chips, or the characters. */
  view: "strip" | "raw";
  runs: TagStripRun[];
  /** The value as stored, for the text field. */
  template: string;
  toggleLabel: string;
  /** A `{ "$ref" }` has no characters to type: it is edited in its popover. */
  toggleDisabled: boolean;
}

/** What a press asks the flow to do. */
export interface TagStripActions {
  openChip: (key: string, anchor: HTMLElement) => void;
  toggleRaw: () => void;
  commitRaw: (text: string) => void;
}

interface TagStripScope extends TagStripView {
  openChip: (scope: JxScope, event: Event) => void;
  toggleRaw: () => void;
  commitRaw: (text: string) => void;
}

interface Mounted {
  scope: TagStripScope;
  handle: SurfaceHandle | null;
  disposed: boolean;
  actions: TagStripActions;
}

const mounts = new Map<HTMLElement, Mounted>();

/** Give up a host: stop its mount (or the one still arriving) and forget it. */
function takeDown(host: HTMLElement, record: Mounted | undefined): void {
  if (!record) {
    return;
  }
  record.disposed = true;
  record.handle?.dispose();
  record.handle = null;
  mounts.delete(host);
}

/** Whether `host` holds a strip, or is about to: one that was let go no longer does. */
export function holdsTagStrip(host: HTMLElement): boolean {
  const record = mounts.get(host);
  return record !== undefined && !record.disposed;
}

/** Take down every strip whose host has left the document. */
export function disposeDetachedTagStrips(): void {
  for (const [host, record] of mounts) {
    if (!host.isConnected) {
      takeDown(host, record);
    }
  }
}

/** Take down the strip in `host`, if it holds one: the box is about to be drawn into by another. */
export function unmountTagStrip(host: HTMLElement): void {
  takeDown(host, mounts.get(host));
}

/**
 * Draw one strip into `host`, or bring the one already there up to date.
 *
 * @param host The element the row left for this control; the document clears it.
 * @param view What to draw.
 * @param actions What a press does. Read at every press, so a repaint may hand in fresh ones.
 */
export function renderTagStripSurface(
  host: HTMLElement,
  view: TagStripView,
  actions: TagStripActions,
): void {
  const existing = mounts.get(host);
  if (
    existing &&
    !existing.disposed &&
    (existing.handle === null || existing.handle.root.isConnected)
  ) {
    existing.actions = actions;
    Object.assign(existing.scope, view);
    return;
  }
  takeDown(host, existing);
  host.textContent = "";
  const scope: TagStripScope = reactive<TagStripScope>({
    ...view,
    commitRaw: (text: string) => record.actions.commitRaw(isString(text) ? text : ""),
    openChip: (rowScope: JxScope, event: Event) => {
      const map = rowScope["$map"];
      const item = isJsonObject(map) ? map["item"] : undefined;
      const key = isJsonObject(item) ? item["key"] : undefined;
      if (isString(key) && event.currentTarget instanceof HTMLElement) {
        record.actions.openChip(key, event.currentTarget);
      }
    },
    toggleRaw: () => record.actions.toggleRaw(),
  });
  const record: Mounted = { actions, disposed: false, handle: null, scope };
  mounts.set(host, record);
  void mountSurface("tag-strip", scope, host).then((handle) => {
    if (record.disposed) {
      handle.dispose();
      return;
    }
    record.handle = handle;
  });
}
