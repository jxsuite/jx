/// <reference lib="dom" />
/**
 * The Extensions surface: Project Settings › Extensions, as a Jx document over the kit.
 *
 * This is the adapter. `settings/extensions-section.ts` keeps the section — what the catalogue, the
 * dependency list and `project.json` add up to, which of the two writes an operation makes first,
 * and what a failed one says — and hands this module a projection: the groups, already composed,
 * and the one failure the section is currently showing. The document renders that.
 *
 * The projection is flattened here rather than in the document because a document has no
 * conditional beyond `$switch` over a value: "is there a note, and is it a warning" is two
 * questions, so the section answers them into one `noteTone` and the surface switches on it. That
 * is the same division `surfaces/settings-overview.ts` draws — the state machine on that side, the
 * markup on this one.
 *
 * **A switch the reader has flipped is not the scope's**, which is why `echo` exists on the handle
 * beside `update`. A binding writes when the SCOPE moves, and after a refused or still-running
 * toggle the scope holds exactly what `project.json` said before the flip — so re-stating that is
 * not a change and nothing is written back, and the switch keeps a state the project never took.
 * Echoing what the control now holds makes the correction that follows a real move. `live()` did
 * this for the lit template; a document has to be told.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import extensionsDoc from "./settings-extensions.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-extensions", extensionsDoc as unknown as JxDocument);

/** One `project.json` key an extension owns, as the chip repeater reads it. */
export interface ExtensionSectionView {
  key: string;
}

/** One offered or configured extension, as the document draws it. */
export interface ExtensionRowView {
  /** The package name — the row's identity, its `data-package`, and what Remove takes. */
  name: string;
  /** The string that is (or would be) in `project.json` `extensions[]`. What a toggle takes. */
  specifier: string;
  title: string;
  description: string;
  hasDescription: boolean;
  sections: ExtensionSectionView[];
  hasSections: boolean;
  /** Enabled in `project.json` and not installed — the state that fails the next build. */
  broken: boolean;
  enabled: boolean;
  /** Whether the switch can be used at all. */
  blocked: boolean;
  /** Why not, as the switch's tooltip. `""` when it can. */
  blockedReason: string;
  /**
   * Which sentence the row deserves, as a `$switch` discriminant: none, an ordinary note, or a
   * warning. One field rather than a boolean and a tone, because "there is a note" is a restatement
   * of the note and two fields are two chances to disagree about it.
   */
  noteTone: "none" | "note" | "warn";
  note: string;
  /** Whether Remove is offered at all — it is not for a package the project never installed. */
  canRemove: boolean;
  /** Offered but refused, which is how §10 wants a control that cannot act right now. */
  removeDisabled: boolean;
  removeLabel: string;
  removeHint: string;
}

/** One group heading, its sentence, and the rows under it. */
export interface ExtensionGroupView {
  /** `catalog`, `installed` or `configured` — the group's identity and its `data-origin`. */
  origin: string;
  label: string;
  blurb: string;
  rows: ExtensionRowView[];
}

/** Everything the document draws, as one value. */
export interface ExtensionsView {
  groups: ExtensionGroupView[];
  /** The last operation that failed, or `""`. */
  error: string;
}

/** What the reader may do here. Each one is an operation the section decides and runs. */
export interface ExtensionsActions {
  /**
   * A switch moved. `checked` is what it now holds — the echo — and the section decides the intent
   * from `project.json` rather than from this, because the browser has already moved the control by
   * the time the event fires.
   */
  toggle: (specifier: string, checked: boolean) => void;
  remove: (name: string) => void;
}

export interface ExtensionsSurfaceHandle {
  /** Bring the mounted document up to date. */
  update: (view: ExtensionsView) => void;
  /** Say that the reader has moved one switch, before anything is decided about it. */
  echo: (specifier: string, enabled: boolean) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/**
 * The scope the document reads.
 *
 * `listState` and `hasError` are derived here rather than passed in: both are restatements of a
 * value already in the view, and a view that had to keep them in step would be a second place to
 * get it wrong.
 */
interface ExtensionsScope extends Record<string, unknown>, ExtensionsView, ExtensionsActions {
  /** Whether to draw the groups or the sentence that says what this region is for. */
  listState: "empty" | "groups";
  hasError: boolean;
}

/** Write a projection into the scope. */
function project(scope: ExtensionsScope, view: ExtensionsView): void {
  scope.groups = view.groups;
  scope.listState = view.groups.length === 0 ? "empty" : "groups";
  scope.error = view.error;
  scope.hasError = view.error !== "";
}

/**
 * Mount the Extensions document into `container`.
 *
 * The container is cleared first: a settings section is handed the pane's content area, and
 * whatever the last section drew into it is not this one's to keep.
 *
 * @param {HTMLElement} container The section body the registry handed the renderer.
 * @param {ExtensionsView} view What to show.
 * @param {ExtensionsActions} actions What the reader may do — read once, when the surface mounts.
 * @returns {ExtensionsSurfaceHandle}
 */
export function mountExtensionsSurface(
  container: HTMLElement,
  view: ExtensionsView,
  actions: ExtensionsActions,
): ExtensionsSurfaceHandle {
  const scope = reactive<ExtensionsScope>({
    error: "",
    groups: [],
    hasError: false,
    listState: "empty",
    remove: actions.remove,
    toggle: actions.toggle,
  }) as ExtensionsScope;
  project(scope, view);

  container.replaceChildren();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on an element here, so the mount is all this has to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody asking them to (§1.1, "await the element"). */
  void mountSurface("settings-extensions", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* While the mount is still in flight this surface owns the container only for as long as the
       container is still the empty one it was handed: a settings section is drawn into the pane's
       content area, and if something else has claimed it in the meantime the document must not
       land on top of that. Once mounted, the question is simply whether the root is still there —
       a section that was switched away from had its root taken out from under it. */
    connected: () =>
      !disposed &&
      (mounted === null
        ? container.childNodes.length === 0
        : (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    echo(specifier, enabled) {
      /* Written into the row the scope already holds, not into a fresh projection: the point is to
         move the scope to where the CONTROL is, so that the projection which follows — the file's
         answer — is a move away from it rather than a restatement of a value that never changed. */
      for (const group of scope.groups) {
        for (const row of group.rows) {
          if (row.specifier === specifier) {
            row.enabled = enabled;
          }
        }
      }
    },
    update: (next) => project(scope, next),
  };
}
