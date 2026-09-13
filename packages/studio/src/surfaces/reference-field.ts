/// <reference lib="dom" />
/**
 * The `reference` form control as a mounted document.
 *
 * `ui/form-controls.ts` is the flow — it owns the one read per collection, decides which of the
 * three states the field is in, what each row is called and what a gesture commits — and this is
 * the surface it draws into (`surfaces/reference-field.json`). Nothing here reads a schema, lists a
 * directory or knows what a collection is: the scope is one already-classified control.
 *
 * **The host belongs to the caller**, as it does for `surfaces/schema-builder.ts`: a registered
 * control is drawn into the empty `[part="control-host"]` (or `[part="cell-control-host"]`) that
 * `surfaces/schema-form.json` announces for it, and a document clears the host it is given.
 *
 * **A mounted control has a second frame of its own, and that is what the conversion bought.** The
 * template this replaced could only be redrawn by its HOST, so the picker's answer arrived through
 * lit's `until` and the Retry button existed only where the host had passed a repaint hook — the
 * frontmatter renderer passes none, so that field could name a failure it could not retry. The flow
 * updates this surface directly, so the read landing and the retry are the same kind of event as
 * every other one.
 *
 * @docs studio/data/tables
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import referenceDoc from "./reference-field.json";

import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("reference-field", referenceDoc as unknown as JxDocument);

/** One row of the picker: an entry id, the empty row, or the value that is not on disk. */
export interface ReferenceChoice {
  value: string;
  label: string;
}

/** What the field says right now. Every field is the flow's, never a state it derives. */
export interface ReferenceFieldView {
  /**
   * Which control the field draws.
   *
   * `text` is not a degraded picker: it is the field a reader can still edit when the choices could
   * not be listed, or when the control was named on a property that references nothing.
   */
  kind: "picker" | "text";
  /** The accessible name — the row's own label, since the control carries no visible one. */
  label: string;
  /** The entry id the field holds, as a string. */
  value: string;
  /** The picker's rows, in the order they are offered. Empty on a text field. */
  options: ReferenceChoice[];
  /** True while the read is in flight: the picker is inert and says so in its one row. */
  disabled: boolean;
  /** A sentence under the control. Empty draws none. */
  note: string;
  /** Whether {@link ReferenceFieldView.note} has anything in it; `$switch` is the conditional. */
  hasNote: boolean;
  /** Whether the note is a fault or a fact — the note's only other channel is its colour. */
  noteTone: "dim" | "danger";
  /** Whether a Retry is on offer, which is exactly when a listing failed. */
  canRetry: boolean;
}

/** What the reader can do here. Every one of them is a decision the flow makes. */
export interface ReferenceFieldActions {
  /** A row was picked. The empty row is a value, and what it means is the flow's to say. */
  choose: (value: string) => void;
  /** The id was typed rather than picked. */
  edit: (value: string) => void;
  /** List the collection again after a failure. */
  retry: () => void;
}

export interface ReferenceFieldSurfaceHandle {
  /** The container the document was mounted into — the form's own control host. */
  host: HTMLElement;
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  update: (view: ReferenceFieldView) => void;
  dispose: () => void;
}

interface ReferenceScope
  extends Record<string, unknown>, ReferenceFieldView, ReferenceFieldActions {}

/** The view a freshly mounted surface starts on: a picker that has not been told anything. */
function emptyView(): ReferenceFieldView {
  return {
    canRetry: false,
    disabled: true,
    hasNote: false,
    kind: "picker",
    label: "",
    note: "",
    noteTone: "dim",
    options: [],
    value: "",
  };
}

/**
 * Mount the reference field into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The form's control host for this field or cell
 * @param {ReferenceFieldActions} actions - What each gesture does
 * @returns {ReferenceFieldSurfaceHandle}
 */
export function mountReferenceFieldSurface(
  host: HTMLElement,
  actions: ReferenceFieldActions,
): ReferenceFieldSurfaceHandle {
  host.textContent = "";
  const scope = reactive<ReferenceScope>({ ...emptyView(), ...actions }) as ReferenceScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = true;
  let disposed = false;

  const mount = (): Promise<HTMLElement> =>
    mountSurface("reference-field", scope, host).then((mounted) => {
      mounting = false;
      if (disposed) {
        mounted.dispose();
        return mounted.root as HTMLElement;
      }
      handle = mounted;
      return mounted.root as HTMLElement;
    });

  const ready = mount();

  return {
    dispose() {
      disposed = true;
      handle?.dispose();
      handle = null;
      host.textContent = "";
    },
    host,
    ready,
    update(view) {
      scope.canRetry = view.canRetry;
      scope.disabled = view.disabled;
      scope.hasNote = view.hasNote;
      scope.kind = view.kind;
      scope.label = view.label;
      scope.note = view.note;
      scope.noteTone = view.noteTone;
      scope.options = view.options;
      scope.value = view.value;
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the form around it
         would take the dropdown out from under a reader who has it open. The remount below answers
         the one case assignment cannot — a host the document has been taken out of — and it cannot
         fire while a mount is in flight, because a record with no handle yet IS the standing one. */
      if (disposed || mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      mounting = true;
      host.textContent = "";
      void mount();
    },
  };
}
