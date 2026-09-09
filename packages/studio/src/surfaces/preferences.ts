/// <reference lib="dom" />
/**
 * Preferences (⌘,) as a mounted document.
 *
 * `settings/preferences-dialog.ts` is the flow — which section is showing, what the shell's theme
 * record holds, what `preferences-accounts.ts` enumerates, and the whole of the Keyboard sheet's
 * state machine (the filter, the armed capture, the last refusal) — and this is the surface it
 * draws into: the reactive scope the document reads, the four flags it discriminates on, and the
 * mount that lives in the dialog layer until the flow takes it down.
 *
 * **The flow states facts; the surface derives what the document branches on.** Whether there is a
 * registry at all, whether a filter matched anything, whether a refusal names a conflict — the flow
 * answers each of those as a SENTENCE or an empty string, and `derive` turns "empty" into the case
 * name. So no branch of the document is spelled twice.
 *
 * **Assistant is two islands.** `ui/ai-managed-connect.ts` and `ui/ai-credentials-form.ts` each own
 * an element that three other credentials gates also embed, and a repaint of this sheet must never
 * rebuild three fields a reader is typing into. So the document renders `managed-slot` and
 * `creds-slot` empty and this module reports them through `onNodeCreated`, one `connectedCallback`
 * earlier than awaiting the element would be — the island rule of studio-ui-guidelines.md §9.4.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` rather than reimplemented.
 *
 * @docs studio/interface/preferences
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { overlayRegion, REGION_ATTR } from "../ui/regions";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import preferencesDoc from "./preferences.json";
import type { JxElement, JxDocument } from "@jxsuite/schema/types";
import type { JxScope } from "@jxsuite/runtime/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("preferences", preferencesDoc as unknown as JxDocument);

/** One row of the section list. `current` is the string `aria-current` takes. */
export interface PreferencesSectionRow {
  id: string;
  title: string;
  current: string;
}

/** One segment of the theme control. `checked` is the string `aria-checked` takes. */
export interface PreferencesThemeRow {
  value: string;
  label: string;
  checked: string;
}

/** One button on an account row. */
export interface PreferencesAccountAction {
  /** `"<account>/<action>"` — what `onAccountAction` takes, so a click names both halves. */
  key: string;
  /** The action's own id, which the row carries as `data-action`. */
  id: string;
  label: string;
  /** The kit's button variant; `"secondary"` for the default treatment. */
  variant: string;
}

/** One stored credential, as the Accounts section draws it. Never the secret. */
export interface PreferencesAccountRow {
  id: string;
  label: string;
  detail: string;
  actions: PreferencesAccountAction[];
}

/** One live binding. Every field is a string or a boolean the flow decided. */
export interface PreferencesKeyRow {
  /** The row's identity for the keyed map: a command with two chords has two rows. */
  key: string;
  commandId: string;
  /** The chord as the platform prints it, or the invitation while this row is capturing. */
  chord: string;
  title: string;
  /** This row is listening for the next chord. */
  capturing: boolean;
  /** The binding came from the author's layer, so there is something to reset. */
  overridden: boolean;
  /** What the change button reads: "Change", or "Cancel" while it is listening. */
  changeLabel: string;
  /** The change button's accessible name, which says WHICH shortcut it changes. */
  changeName: string;
  /** The reset button's accessible name. */
  resetName: string;
}

/** One scope's worth of bindings, under the heading the reference gives that scope. */
export interface PreferencesKeyGroup {
  scope: string;
  label: string;
  rows: PreferencesKeyRow[];
}

/**
 * What the flow knows. Not one field is a case name: the words are the flow's, and which of them
 * add up to which branch is {@link derive}'s.
 */
export interface PreferencesView {
  /** The showing section's id — the document's outermost discriminant. */
  section: string;
  sections: PreferencesSectionRow[];
  sectionTitle: string;
  sectionBlurb: string;
  themes: PreferencesThemeRow[];
  accounts: PreferencesAccountRow[];
  /** Why there is no keyboard sheet at all. Empty means there is one. */
  keyboardEmpty: string;
  /** What the search field shows: typed text, or a captured chord as it prints. */
  keyQuery: string;
  /** What the keystroke toggle reads, which is also whether it is listening. */
  keystrokeLabel: string;
  capturingSearch: boolean;
  /** The last refusal, verbatim from whoever raised it. Empty draws nothing. */
  refusal: string;
  /** "Show Redo" — the one thing that can be done about a conflict. Empty draws no button. */
  conflictLabel: string;
  /** Why the list is empty under the current filter. Empty means it is not. */
  rowsEmpty: string;
  groups: PreferencesKeyGroup[];
}

/** The two islands the Assistant section renders and does not fill. */
export type PreferencesIsland = "managed" | "creds";

export interface PreferencesSurfaceOptions {
  /** Where the sheet is mounted — the dialog layer, handed in so this never reaches back. */
  layer: HTMLElement;
  /** What to draw before anything has changed: the flow's own view, so there is one builder. */
  view: PreferencesView;
  onSelectSection: (id: string) => void;
  onSetTheme: (value: string) => void;
  /** One account button was pressed, named by its `"<account>/<action>"` key. */
  onAccountAction: (key: string) => void;
  onKeyQuery: (value: string) => void;
  onToggleKeystroke: () => void;
  onToggleRebind: (commandId: string) => void;
  onResetBinding: (commandId: string) => void;
  onShowConflict: () => void;
  /** A keydown inside the keyboard sheet, whatever it was. The flow decides if it is a chord. */
  onCaptureKey: (event: KeyboardEvent) => void;
  /** An island was created: the flow puts the surface it owns inside it. */
  onIsland: (island: PreferencesIsland, host: HTMLElement) => void;
  /** The sheet closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface PreferencesSurfaceHandle {
  /** The slot in the dialog layer the document is mounted into. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: PreferencesView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** What the document discriminates on. Derived here, never handed in. */
interface PreferencesFlags {
  /** `"none"` draws the reason instead of the whole sheet; `"keys"` draws the sheet. */
  keyboardState: string;
  /** `"empty"` draws the reason under the search box; `"rows"` draws the groups. */
  rowsState: string;
  hasRefusal: boolean;
  hasConflict: boolean;
}

interface PreferencesScope extends Record<string, unknown>, PreferencesView, PreferencesFlags {
  selectSection: (id: string) => void;
  setTheme: (value: string) => void;
  runAccountAction: (key: string) => void;
  setKeyQuery: (value: string) => void;
  toggleKeystroke: () => void;
  toggleRebind: (commandId: string) => void;
  resetBinding: (commandId: string) => void;
  showConflict: () => void;
  capture: (scope: JxScope, event: Event) => void;
  closed: () => void;
}

/** The view plus the four flags the document branches on. */
function derive(view: PreferencesView): PreferencesView & PreferencesFlags {
  return {
    ...view,
    hasConflict: view.conflictLabel !== "",
    hasRefusal: view.refusal !== "",
    keyboardState: view.keyboardEmpty === "" ? "keys" : "none",
    rowsState: view.rowsEmpty === "" ? "rows" : "empty",
  };
}

/** The `part` a node's definition carries, or `""` for a text node or an unmarked element. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Open Preferences. The handle's `ready` resolves once the sheet is showing.
 *
 * @param options What to draw, and every decision a control can ask the flow for.
 * @returns The handle the flow updates and closes.
 */
export function openPreferencesSurface(
  options: PreferencesSurfaceOptions,
): PreferencesSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close`, which `close()`
   * provokes, and `close()` on a sheet that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };

  const scope = reactive({
    ...derive(options.view),
    capture: (_scope: JxScope, event: Event) => {
      options.onCaptureKey(event as KeyboardEvent);
    },
    closed: finish,
    resetBinding: (commandId: string) => {
      options.onResetBinding(commandId);
    },
    runAccountAction: (key: string) => {
      options.onAccountAction(key);
    },
    selectSection: (id: string) => {
      options.onSelectSection(id);
    },
    setKeyQuery: (value: string) => {
      /* What the control now holds, first and unconditionally. A binding only writes when the
         scope CHANGES, so a surface that decided a query without announcing the raw one would
         leave the field showing something the scope does not have (§9.3). */
      scope.keyQuery = value;
      options.onKeyQuery(value);
    },
    setTheme: (value: string) => {
      options.onSetTheme(value);
    },
    showConflict: () => {
      options.onShowConflict();
    },
    toggleKeystroke: () => {
      options.onToggleKeystroke();
    },
    toggleRebind: (commandId: string) => {
      options.onToggleRebind(commandId);
    },
  }) as PreferencesScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("preferences", scope, slot, {
    onNodeCreated: (element, _path, def) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "managed-slot") {
        options.onIsland("managed", element);
      } else if (part === "creds-slot") {
        options.onIsland("creds", element);
      }
    },
  }).then(async (surface) => {
    mounted = surface;
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (closed) {
      return element;
    }
    /* The region goes on the platform's own `<dialog>`, which is the one element here that HAS a
       box: `jx-dialog` is `display: contents`, and the slot wraps a dialog the top layer takes out
       of flow, so both measure 0×0 — and a region whose box is empty is refused outright by
       `scripts/screenshots/lib/shot.ts`. The kit treats that node as a seam already; its own
       behaviour sidecar finds it by exactly this selector. */
    const box = element.querySelector<HTMLElement>('dialog[part="dialog"]') ?? element;
    box.setAttribute(REGION_ATTR, overlayRegion("dialog", "preferences"));
    showModal(element);
    return element;
  });

  return {
    close() {
      /* Guarded on the WORK rather than on `closed`, and the difference is a slot that would
         otherwise be left behind: the platform's own `close` runs `finish()` before any caller
         reaches here, so a `close()` that returned early on `closed` would take the sheet down and
         leave its host div in the layer. Every line below is idempotent instead. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does — `finish` tells it so.
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
    update(view) {
      Object.assign(scope, derive(view));
    },
  };
}
