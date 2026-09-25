/// <reference lib="dom" />
/**
 * The one empty-state pattern.
 *
 * Every region in the shell that can be empty says its piece through {@link EmptyStateSpec} — drawn
 * by `surfaces/empty-state.json`, or by a converted panel's own `[part="empty"]` block — instead of
 * hand-writing one, so the copy rules below are inherited rather than re-decided:
 *
 * 1. **One sentence saying what the region is _for_.** Not what is absent — "No state defined" is a
 *    dead end, "Data this page can read, compute or fetch lives here" tells you what it is.
 * 2. **The action that fills it**, as a real button that does the thing. Compact states that sit
 *    directly above their own add form are the one exception: the form _is_ the action.
 * 3. **One shared verb across equivalent surfaces.** Everything that wants a canvas selection says
 *    {@link clickAnythingTo}; everything that wants an open document offers
 *    {@link openPageAction}.
 *
 * A region with no object to show renders one of these in its own words — it never paints a bare
 * container.
 */

/**
 * A button offered by an empty state.
 *
 * There is no `icon` here any more, and its absence is the point rather than an omission: it was
 * typed `TemplateResult` and every value passed to it was an `sp-icon-*`, which is a Spectrum
 * element smuggled through a shared vocabulary into surfaces that have no other Spectrum in them.
 * `panels/git-panel.ts` was the last caller and it is a document now, so the field went with it —
 * `surfaces/empty-state.json` draws a word, and a region that needs a glyph beside one is asking
 * for a control the kit declares rather than for a hole in this type.
 */
export interface EmptyStateAction {
  /** Imperative naming what happens — "Add a value", not "Go to the Data panel". */
  label: string;
  run: () => void;
  disabled?: boolean;
}

export interface EmptyStateSpec {
  /** One sentence: what this region is for. */
  message: string;
  /** Optional second sentence: where its content comes from. */
  detail?: string;
  /** The action(s) that fill the region. */
  actions?: EmptyStateAction[];
  /** An inline section inside an otherwise populated panel — tighter and left-aligned. */
  compact?: boolean;
}

/** The one verb every selection-driven surface shares. */
export const CANVAS_VERB = "Click anything on the canvas";

/**
 * The shared selection prompt. `outcome` completes "…to ⟨outcome⟩": "edit its content", "style it",
 * "wire it up". Every inspector surface phrases its requirement this way so the rail does not read
 * as three different requirements.
 */
export function clickAnythingTo(outcome: string): string {
  return `${CANVAS_VERB} to ${outcome}.`;
}

/** Told the user something is gone: name it, then hand back the shared verb. */
export function staleSelectionMessage(): string {
  return `That element is no longer on the page. ${clickAnythingTo("pick another one")}`;
}

/**
 * The one action every "needs an open document" empty state offers.
 *
 * Quick Access is reached through a lazy import on purpose: this module is imported by every panel
 * in the shell, and a static edge would drag the file browser, the format host and the recents
 * store into all of them. P2 replaces the closure with a command id.
 */
export function openPageAction(label = "Open a page…"): EmptyStateAction {
  return {
    label,
    run: () => {
      void import("./quick-search.js").then((m) => {
        m.openQuickSearch();
      });
    },
  };
}

/*
 * `renderEmptyState` was here, and it is GONE rather than kept beside the document.
 *
 * It drew the pattern as a lit template over an `sp-action-button`, and by the end of this batch it
 * had no caller: the Navigator's bodies, the Bottom dock and a derived stage hand their box to
 * `surfaces/empty-state.ts`'s `emptyState()`, the nine panels that are documents draw a
 * `[part="empty"]` of their own, and `ui/expression-editor.ts` — the last lit caller — converted
 * alongside them.
 *
 * What is left here is the half that was never about drawing: {@link EmptyStateSpec}, which the
 * document reads verbatim, and the copy rules at the top of this file, which are the reason a
 * region says what it is FOR rather than what is absent. One vocabulary, one renderer.
 */
