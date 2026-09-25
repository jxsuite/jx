/// <reference lib="dom" />
/**
 * The Languages surface: the translation parity grid, as a Jx document over the kit.
 *
 * This is the adapter. `panels/i18n-panel.ts` keeps the panel — the scan, the fold from files to
 * rows, which command a cell runs, whether that command is refused and what the refusal says — and
 * hands this module a projection the document can draw with no decisions left in it: a mode, a
 * sentence, a column per locale and a row per translation key whose every square already carries
 * its glyph, its tooltip, its disabled flag and the three arguments its command takes.
 *
 * The flattening is here rather than in the document for the reason `surfaces/settings-overview.ts`
 * gives: `$switch` over a value is the only conditional a document has, and "is this cell missing
 * AND is its command registered AND does the registry refuse it" is three questions. So the panel
 * answers them and the surface reads a string.
 *
 * **A cell hands its command three primitives, not itself.** `runCell(command, locale, path)` is
 * called positionally through `$expression` `call`, so nothing crosses the boundary but the values
 * the registry is about to be given — a row object would arrive as a reactive proxy, and a handler
 * that reads a proxy is a handler whose reads are one refactor away from being tracked.
 *
 * @docs studio/interface/languages
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import i18nDoc from "./panel-i18n.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("panel-i18n", i18nDoc as unknown as JxDocument);

/** Which of the three bodies the panel is showing. */
export type I18nMode =
  /** The project declares fewer than two languages, so there is no parity to draw. */
  | "mono"
  /** `pages/` and `content/` are still being read. */
  | "scanning"
  /** The scan is in, and the grid — or its own empty state — is what is drawn. */
  | "grid";

/** One square of the grid, with every decision about it already taken. */
export interface I18nParityCell {
  /** The column this cell sits under. Also the row's key inside its cells array. */
  locale: string;
  /** `present` | `stale` | `missing` — the glyph's colour and the dashed border come off this. */
  state: string;
  /** The one character the square shows. `aria-hidden`; the sentence is in `title`. */
  glyph: string;
  /** What the click does, or what it needs first. Both the tooltip and the accessible name. */
  title: string;
  disabled: boolean;
  /** The command id the click runs. */
  command: string;
  /** The `path` argument that command is given — the ROW's address, not this cell's. */
  rowPath: string;
}

/** One row: a translation key and its cell per declared locale, in declaration order. */
export interface I18nParityRow {
  key: string;
  cells: I18nParityCell[];
}

/** One column head: the locale's autonym, its tag as the tooltip, and whether it is the source. */
export interface I18nLocaleHead {
  locale: string;
  label: string;
  isDefault: boolean;
}

/** What the panel says the surface should be showing right now. */
export interface I18nValues {
  mode: I18nMode;
  /** Whether the monolingual body's one action can run — `settings.open`, through the registry. */
  settingsDisabled: boolean;
  /** The one sentence above the grid: its size, and what is outstanding in it. */
  summary: string;
  /** The directories the scan could not read, joined, or `""` when it read all of them. */
  incomplete: string;
  /** The remainder the grid does not draw, as its whole sentence, or `""` when it draws all. */
  truncated: string;
  heads: I18nLocaleHead[];
  rows: I18nParityRow[];
}

/** What a control can ask the panel to do. Every one of them is a decision the panel owns. */
export interface I18nActions {
  openSettings: () => void;
  rescan: () => void;
  runCell: (command: string, locale: string, path: string) => void;
}

export interface I18nSurfaceHandle {
  /** Bring the mounted document up to date. A key left out is left alone. */
  update: (patch: Partial<I18nValues>) => void;
  /** Whether the document this mounted is still standing in the container it was given. */
  connected: () => boolean;
  /** Take the document down. Idempotent. */
  dispose: () => void;
}

/**
 * The scope the document reads.
 *
 * Each `has*` is the flattening of a presence test: a document switches on a VALUE, so "is there a
 * failure to report" has to arrive as a boolean rather than as a string the markup could measure.
 */
interface I18nScope extends Record<string, unknown> {
  mode: I18nMode;
  settingsDisabled: boolean;
  summary: string;
  incomplete: string;
  hasIncomplete: boolean;
  truncated: string;
  hasTruncated: boolean;
  heads: I18nLocaleHead[];
  rows: I18nParityRow[];
  hasRows: boolean;
  openSettings: () => void;
  rescan: () => void;
  runCell: (command: string, locale: string, path: string) => void;
}

/** Write a patch into the scope, deriving the three presence flags the document switches on. */
function project(scope: I18nScope, patch: Partial<I18nValues>): void {
  if (patch.mode !== undefined) {
    scope.mode = patch.mode;
  }
  if (patch.settingsDisabled !== undefined) {
    scope.settingsDisabled = patch.settingsDisabled;
  }
  if (patch.summary !== undefined) {
    scope.summary = patch.summary;
  }
  if (patch.incomplete !== undefined) {
    scope.incomplete = patch.incomplete;
    scope.hasIncomplete = patch.incomplete !== "";
  }
  if (patch.truncated !== undefined) {
    scope.truncated = patch.truncated;
    scope.hasTruncated = patch.truncated !== "";
  }
  if (patch.heads !== undefined) {
    scope.heads = patch.heads;
  }
  if (patch.rows !== undefined) {
    scope.rows = patch.rows;
    scope.hasRows = patch.rows.length > 0;
  }
}

/**
 * Mount the Languages document into `container`.
 *
 * The container is NOT cleared, and that is the difference between a panel and a settings section.
 * A section is handed the pane's whole content area; a panel is handed `.panel-content`, a node lit
 * owns and renders `nothing` into — so its two marker comments are already there and taking them
 * out would leave lit holding a part whose ends are detached. Appending beside them is safe in both
 * directions: a repaint of the same panel commits `nothing` again, which lit skips, and a switch to
 * another panel commits a template, which clears to the end of the parent and takes this document
 * with it. That is what {@link I18nSurfaceHandle.connected} then reports, and why the panel can
 * simply ask rather than track the switch itself.
 */
export function mountI18nSurface(
  container: HTMLElement,
  values: I18nValues,
  actions: I18nActions,
): I18nSurfaceHandle {
  const scope = reactive<I18nScope>({
    hasIncomplete: false,
    hasRows: false,
    hasTruncated: false,
    heads: [],
    incomplete: "",
    mode: "scanning",
    openSettings: actions.openSettings,
    rescan: actions.rescan,
    rows: [],
    runCell: actions.runCell,
    settingsDisabled: false,
    summary: "",
    truncated: "",
  }) as I18nScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  /* Nothing is called on the element, so the mount is all this has to wait for: the DOCUMENT is
     what this surface renders, and the kit elements inside it settle their own templates one
     `connectedCallback` later without anybody here asking them to (§1.1, "await the element"). */
  void mountSurface("panel-i18n", scope, container).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    /* In flight the answer is yes: nothing has landed yet, so there is nothing that could have been
       taken away. Once mounted the question is simply whether the root is still in the container —
       a panel that was switched away from had its document cleared out from under it by lit. */
    connected: () =>
      !disposed && (mounted === null || (mounted.root as Node).parentNode === container),
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update: (patch) => project(scope, patch),
  };
}
