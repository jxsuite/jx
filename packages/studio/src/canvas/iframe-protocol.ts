/// <reference lib="dom" />
/**
 * The versioned message protocol spoken across the {@link IframeChannel} between the editor (parent)
 * and the canvas iframe. This is the Phase 1 message set (render the document); later phases extend
 * both unions with selection/geometry/patch/DnD/inline-edit messages.
 *
 * Every parent→iframe message and the iframe's render acknowledgements carry a `gen` (generation)
 * counter so the iframe can ignore stale commands and the parent can correlate acknowledgements —
 * the cross-frame analog of the legacy renderer's `renderGeneration` staleness guard.
 */

import type { AssetContext } from "./asset-resolve";
import type { JxDocOp } from "../tabs/patch-ops";
import type { JxContentResult, SlashCommand } from "../editor/inline-edit";
import type {
  JsonObject,
  JsonValue,
  JxExpressionNode,
  JxMutableNode,
  JxStateDefinition,
  JxStyle,
} from "@jxsuite/schema/types";

export const CANVAS_MODES = ["preview", "design", "edit", "stylebook", "git-diff"] as const;

/**
 * How the iframe renders the document: live `preview`, instrumented `design`/`edit`, the
 * `stylebook` specimen catalog (hit/hover/measure only — no inline editing, DnD, or insert zones),
 * or a `git-diff` comparison artboard (a read-only render carrying {@link WireDiffMarks}).
 *
 * `git-diff` was reaching the frame long before it was listed here: `preparePassRender` casts the
 * resolved mode with `as CanvasMode`, so the one mode this union did not admit crossed the wire
 * anyway and `isCanvasMode` answered false for a mode the frame was actively rendering.
 */
export type CanvasMode = (typeof CANVAS_MODES)[number];

export function isCanvasMode(value: unknown): value is CanvasMode {
  return typeof value === "string" && CANVAS_MODES.some((mode) => mode === value);
}

/** The render path-mapping context as it crosses the boundary: `PathMapCtx`, which is plain data. */
export interface WireMapperCtx {
  canvasMode: string;
  layoutWrapped: boolean;
  pageContentPrefix: (string | number)[] | null;
  pageContentOffset: number | null;
}

/** How many rows of a repeater the canvas draws until the author asks for more (studio.md §4.5). */
export const DEFAULT_ROW_LIMIT = 24;

/** The most rows `canvas.setRepeaterRows` accepts. */
export const MAX_ROW_LIMIT = 1000;

/**
 * Each repeater's active row (studio.md §4.5), by the repeater's document path as `JSON.stringify`
 * writes it. A repeater that is absent is on its first row.
 */
export type ActiveRows = Readonly<Record<string, number>>;

/**
 * One live binding, as the frame needs to know it: the chord and the scope that holds it.
 *
 * Scopes are carried rather than flattened because the frame picks its own stack per keystroke —
 * `caret` when an inline-edit session is live, `canvas` when the artboard has a selection, `global`
 * under both — which is the same ladder `commands/context.ts`'s `keyScopeStack` walks host-side.
 * Flattening to "chords the parent wants" would lose exactly the distinction that lets ⌘C reach the
 * browser mid-sentence and the structural copy verb at every other moment.
 *
 * The command ID is deliberately absent: the frame decides whether to FORWARD, never what runs.
 */
export interface SyncedChord {
  chord: string;
  scope: "caret" | "canvas" | "global";
}

/** One node the comparison says changed, addressed in THIS artboard's document. */
export interface WireDiffMark {
  path: (string | number)[];
  /**
   * How to draw it.
   *
   * A modification is ONE change with two faces, and the artboard it is drawn on decides which:
   * `modified-before` on the committed side, `modified-after` on the working copy. The parent
   * splits them when it hands each artboard its own marks, because the frame does not know which
   * side it is. Marked identically on both, a modification read as "added" on the left — the green
   * of the added colour over the text that is being replaced.
   */
  kind: "added" | "removed" | "modified-before" | "modified-after";
}

/** An artboard's whole mark set. Each side receives only its own; `[]` clears. */
export type WireDiffMarks = readonly WireDiffMark[];

/** A language as the frame applies it: the BCP 47 tag for `lang`, and its direction for `dir`. */
export interface WireLocale {
  locale: string;
  dir: "ltr" | "rtl";
}

/** Messages the editor (parent) sends into the canvas iframe. */
export type ParentToIframe =
  | { kind: "init"; gen: number }
  | {
      kind: "render";
      doc: unknown;
      // The RAW (pre-resolution) page document the forward ops are recorded against. The iframe
      // Keeps it as a non-reactive shadow doc — its patch source-of-truth. `doc` above is the
      // Resolved render doc (layout-wrapped); this raw doc's paths match the forward-op paths and
      // The stamped data-jx-path attributes.
      shadowDoc: unknown;
      /**
       * The document format's per-tag verdicts on which tags can hold a text caret, or absent for a
       * native document with no format class. Overrides only — tags the format says nothing about
       * fall back to the studio's own element metadata. See `formatEditableVerdicts`.
       */
      editableTags?: Record<string, boolean>;
      mode: CanvasMode;
      docBase: string;
      /**
       * The client script of every document this render is composed from, as each was last saved,
       * under the `jx-script:` specifier the document's entries name it by (`canvas-scripts.ts`).
       * Absent when none of them has one. The documents themselves cross without `$script`.
       */
      scripts?: Record<string, string>;
      /**
       * How this host addresses project media, or null/absent when the canvas origin serves the
       * site's own URL space (desktop, `jx dev`) and no reference needs resolving.
       *
       * Plain data because the resolver is a FUNCTION and functions do not cross a realm: the
       * iframe rebuilds the resolver from this and installs it on the runtime.
       */
      assets?: AssetContext | null;
      mapperCtx: WireMapperCtx;
      siteStyle: JxStyle | null;
      /**
       * The project's pure named formulas, which every component drawn in the frame inherits
       * (spec.md §13.4). Absent when the project declares none, or there is no project: a component
       * is then its own document, and the frame clears what an earlier render set.
       */
      projectFormulas?: Record<string, JxStateDefinition>;
      /**
       * The state key of the entry this render draws live inside its collection's page (studio.md
       * §22.5), or absent when it draws none. An `entryState` message replaces that key's value in
       * place, which is how a field edit reaches the page without redrawing it.
       */
      entryRoot?: string;
      // Forced color-scheme preview (spec.md §9.5): "light"/"dark" sets data-color-scheme on the
      // Iframe root, null clears it (auto — follow the OS).
      colorScheme: "light" | "dark" | null;
      /**
       * Whether text chips draw their value or their name, carried on `render` as well as by the
       * setter below for `colorScheme`'s reason: a frame that boots, or reboots, after the choice
       * was made must draw the choice. Absent means values.
       */
      bindingDisplay?: BindingDisplay;
      /**
       * The tab's active rows, carried on `render` as well as by `setActiveRows` below for
       * `colorScheme`'s reason: a frame is reused from tab to tab, and one that boots after a row
       * was chosen must draw the choice. Absent means every repeater is on its first row.
       */
      activeRows?: ActiveRows;
      /**
       * At most this many rows of a repeater are drawn (`canvas.setRepeaterRows`, studio.md §4.5).
       * Absent means the frame's own default. A field of the render and no message of its own: the
       * cap decides which nodes exist, so changing it IS a render.
       */
      rowLimit?: number;
      /**
       * One sample item per repeater of the document, by the repeater's serialized path: what the
       * frame draws a single row of the template with when the list has no items. Deduced by the
       * parent from the project's content schemas, which the frame never sees. Absent for none.
       */
      rowSamples?: Readonly<Record<string, JsonValue>>;
      /**
       * The document's remote data for this render (studio.md §4.5): which session of the tab's
       * cache it is drawn from, every answer that session holds, and whether THIS frame is the one
       * that fetches what the session lacks. Present only for an editable view, and filled in when
       * the render is posted, so a render queued for a frame still booting says what is true once
       * the frame is up. Absent, the frame starts no automatic `Request` and no `timing: "server"`
       * call outside Preview, as it never did; a frame that predates the field ignores it.
       */
      remote?: RemoteWire;
      /**
       * Which nodes to tint on a `git-diff` artboard, in this side's own coordinates.
       *
       * A FIELD ON THE RENDER, not a message of its own, and the reason is ordering. A render ends
       * in `container.replaceChildren(el)`, which destroys the DOM any earlier mark was stamped on
       * — so a separate message would need its own generation, a queue for arriving early, and a
       * re-apply hook after every render, three mechanisms to reproduce what carrying the data
       * already guarantees. The transport settles it too: a host holds ONE `pending` message while
       * its iframe boots, so a marks message posted beside a queued render would replace it.
       */
      diffMarks?: WireDiffMarks | null;
      /**
       * Which popover the artboard draws OPEN, by document path — absent or null for none.
       *
       * Carried on `render` as well as by the setter below for the same reason `colorScheme` is: a
       * render replaces the DOM, and the open state is one attribute on one element, so without it
       * every re-render would close the panel the author is editing.
       */
      popoverOpen?: (string | number)[] | null;
      /**
       * The language the artboard is drawn in, carried on `render` for `colorScheme`'s reason: a
       * frame that boots after the pane's locale was posted (a new host, a reload) would otherwise
       * draw an Arabic document left to right until the locale next CHANGED. Absent or null clears
       * `lang` and `dir`.
       */
      locale?: WireLocale | null;
      /** The dialog to draw open after this render, for the same reason. */
      dialogOpen?: (string | number)[] | null;
      gen: number;
    }
  /**
   * The content versions of the project's media, by normalized project path — what the frame folds
   * into every render's `assets` context so a repo-space reference resolves to `<file>?v=<version>`
   * (specs/studio.md §3.4). A path absent here resolves unversioned.
   *
   * A message of its own, not a field on `render`: the map is as large as the project's media and
   * changes far less often than the document does. The host posts it before a frame's first render
   * and again before any render or patch that would otherwise see an older map — the channel is
   * FIFO, so "posted before" is "applied before". Gen-less and render-free: the frame keeps the
   * latest map and re-installs its asset resolver around it, so the next node a patch draws already
   * uses it. A frame built before this message existed ignores it and keeps resolving unversioned.
   */
  | {
      kind: "assetVersions";
      versions: Readonly<Record<string, string>>;
      /**
       * Studio's own repaint keys (studio.md §3.4), for paths Studio itself just wrote in place.
       * Optional so a host that predates them still speaks the message; absent reads as none.
       */
      revisions?: Readonly<Record<string, string>>;
    }
  // Flip the forced color-scheme preview on the iframe root without re-rendering — a document-level
  // Idempotent attribute write, deliberately gen-less (like endEdit).
  | { kind: "setColorScheme"; scheme: "light" | "dark" | null }
  /*
   * Draw every text chip as its value or as its name (`canvas.setBindingDisplay`, studio.md §6.9).
   *
   * Render-free and gen-less, like `setColorScheme` above, because it changes no content: one
   * attribute on the frame's root. Guarded by the `bindingDisplay` capability.
   */
  | { kind: "setBindingDisplay"; display: BindingDisplay }
  /*
   * Make these the active rows (`canvas.setActiveRow`, studio.md §4.5): the whole map, never a
   * difference, so the frame ends in the state the message names however many it missed.
   *
   * Render-free and gen-less: an active row is which of two attributes a row's nodes carry their
   * path in, and the frame renames them in place. A frame with a caret in a row that stops being
   * the active one ends that session first. Guarded by the `rows` capability.
   */
  | { kind: "setActiveRows"; rows: ActiveRows }
  /**
   * Answers another frame of the same tab fetched (studio.md §4.5): one frame fetches what the
   * tab's session lacks, and the host hands each answer to the others, which were told to wait.
   * Dropped by a frame drawing another `session`. Guarded by the `bindingStatus` capability.
   */
  | { kind: "remoteResults"; session: string; results: Readonly<Record<string, RemoteResult>> }
  /**
   * Draw the popover at `path` open, and every other one closed. `null` closes them all.
   *
   * Render-free and gen-less, exactly like `setColorScheme` above, because it changes no content:
   * the runtime has already renamed every addressable `popover` to `data-jx-popover` for this
   * render (`setCanvasDelinkPopovers`), so open-ness is ONE attribute on ONE element and the whole
   * document's layout follows from flipping it. Opening a popover must not cost a full render —
   * §4.1 calls that expensive, and it would rebuild every binding effect under the author's caret.
   *
   * Refused in preview, in BOTH realms: preview is native, and a canvas-only attribute has no
   * business in a view whose whole job is fidelity (§4.2).
   *
   * A frame built before this message existed ignores it and draws every popover closed, which is
   * the compatibility story `dist/iframe-entry.js` shipping prebuilt requires.
   */
  | { kind: "setPopoverOpen"; path: (string | number)[] | null }
  /** The `<dialog>` to draw open in place, or none. The dialog twin of `setPopoverOpen`. */
  | { kind: "setDialogOpen"; path: (string | number)[] | null }
  /**
   * Replace a custom element's definition in the frame's realm — the canvas half of
   * `redefineElement` (embedding.md §7). Instances already on the canvas keep the old definition
   * until the next render replaces them, which is why the host follows it with a `render`.
   */
  | { kind: "redefineElement"; doc: JxMutableNode; base?: string }
  /**
   * Set the language the artboard is drawn in — `lang` and `dir` on the frame's document element.
   *
   * Render-free and gen-less, like `setColorScheme` above, because it changes no content: Jx has no
   * message catalogue, so the TEXT is whatever file is open and only the direction, the font stack
   * and CSS's own `:lang()` selectors move. `dir` travels with the tag rather than being derived in
   * the frame — `localeDirection` is CLDR's answer via `Intl.Locale`, and the frame has no reason
   * to hold a second copy of the RTL script list.
   *
   * The host posts the language the pane DRAWS, not only an override: the preview choice, else the
   * file's own, else the site default (`canvasLocaleOf`). `null` is a project that declares no
   * locales: both attributes come off, and the frame falls back to whatever the rendered document
   * declares.
   */
  | { kind: "setLocale"; locale: string | null; dir: "ltr" | "rtl" }
  /**
   * Open the slash menu at the caret, by name rather than by typing "/".
   *
   * The gesture is recognised inside the frame (`canvas/iframe-inline-edit.ts`), because that is
   * where the keystroke is; this is the door for `insert.openSlashMenu` — the palette, a rebound
   * chord, the automation runner and the assistant. The frame opens it UNANCHORED: there is no "/"
   * in the document, so the menu carries its own filter field and selecting a block deletes
   * nothing.
   *
   * Gen-less and render-free, like `setColorScheme` above. A frame with no caret session ignores
   * it, which is the same refusal the record's `requires` sentence states.
   */
  | { kind: "openSlash" }
  /**
   * The chord table, so the frame forwards exactly what the host's registry binds.
   *
   * The frame used to answer "does the parent want this keystroke?" from three hand-written lists —
   * eight bare keys, four "the editor owns these" chords, three "the browser owns these" chords —
   * maintained beside a registry that already knew the answer. They disagreed in both directions:
   * ⌘A was forwarded and `preventDefault`ed by a frame that assumed the host would claim it (no
   * record binds it, so select-all did nothing AND the native one was suppressed), while ⌘B was
   * withheld on the assumption the editing engine handled it (it does not — the parent's
   * block-level keydown listener never fires against a container-level editing host, and
   * `canvas/editable-actions.ts` rejects the browser's own `formatBold`), so Bold in the canvas did
   * nothing at all.
   *
   * Idempotent and render-free, like `setColorScheme` above, and deliberately gen-less: it
   * describes the APP, not a document. The host reposts it whenever the keymap changes, which is
   * what makes a rebinding in Preferences take effect inside the canvas.
   *
   * A frame built before this message existed ignores it and keeps its own lists — which is the
   * compatibility story `dist/iframe-entry.js` shipping prebuilt requires.
   */
  | { kind: "keymap"; mac: boolean; chords: readonly SyncedChord[] }
  // Replace the injected site-style sheet in place (live design-token editing) — idempotent and
  // Render-free; the superseding render carries the same style via its own siteStyle.
  | {
      kind: "siteStyleUpdate";
      siteStyle: JxStyle | null;
      media: Record<string, string>;
    }
  // Ask the iframe to measure the given document paths and post their current rects back. Used to
  // Draw the selection overlay regardless of where the selection change originated (canvas click,
  // Layers panel, keyboard) — the parent can't measure iframe nodes itself (cross-origin bridge).
  | { kind: "measure"; paths: (string | number)[][]; reqId: number }
  // Commit any text the caret has typed but not yet flushed, then acknowledge. The parent sends
  // This before anything that reads the document as authoritative — chiefly a save. Because the
  // Resulting `editCommit` is posted BEFORE the acknowledgement and postMessage preserves order,
  // A parent that has seen `flushComplete` has already applied the pending text.
  | { kind: "flushEdits"; reqId: number }
  // Apply a surgical edit: fold each value-carrying forward op into the shadow doc and patch the DOM
  // In place. `gen` matches the last render so the iframe drops patches superseded by a re-render.
  | {
      kind: "patch";
      /**
       * The `forward` halves of the recorded {@link JxDocOp} pairs (tabs/patch-ops.ts). Each carries
       * the inserted/replaced `node` and the set `value`, not just a path, so the iframe folds it
       * into its shadow doc without ever reading the parent's reactive document.
       */
      forwardOps: JxDocOp[];
      gen: number;
      /**
       * Paths whose DOM the RECIPIENT already has correct, because this patch is the echo of an
       * edit it originated itself. Their ops are still folded into the shadow doc; only the DOM
       * write is skipped — re-rendering the subtree the user is typing in would destroy the caret.
       *
       * Sent ONLY to the originating host, and only while the block is still active: a split-view
       * panel showing the same document did NOT type the text, and the final commit-on-exit must
       * render normally.
       */
      echoPaths?: (string | number)[][];
      /**
       * Component instances whose `$props` op in this patch must draw the instance again rather
       * than write the changed props into it (§4.1). Sent at the end of a prop-bound inline edit:
       * the text typed into a prop marker is DOM the instance's bindings did not write, and a write
       * of the value the instance already holds would leave it standing.
       */
      redrawPaths?: (string | number)[][];
    }
  // Replace the rendered ROOT's style block in place (stylebook live style editing): the iframe
  // Folds it into the shadow doc and re-runs the runtime's reapplyStyle on the root element, which
  // Regenerates the whole scoped-CSS cascade (real @media included) without a re-render. `style` is
  // Already transposed parent-side (transposeStylebookStyle); `gen` must equal the iframe's
  // RenderedGen — a stale update is dropped (the superseding render carries the same style).
  | { kind: "styleUpdate"; style: JxStyle; gen: number }
  /*
   * The entry a render draws inside its collection's page, as its fields now stand (studio.md
   * §22.5): the frame assigns it to the render's `entryRoot` key of its live scope, so the page's
   * bound text follows without a redraw and a caret elsewhere on the page stays where it is.
   * Acknowledged as a patch: `patchComplete`, or `patchError` from a frame whose render at `gen`
   * draws no live entry, which the host escalates to a full render.
   */
  | { kind: "entryState"; gen: number; value: JsonObject }
  // Enter inline editing on the node at `path` (used to re-enter after a split/insert re-renders).
  | {
      kind: "enterEdit";
      path: (string | number)[];
      /** Character offset for the caret; defaults to the block's start. */
      offset?: number;
      /**
       * Re-enter the PROP-BOUND host for this prop of the instance at `path`, rather than placing a
       * caret in a block. A prop host is identified by (instance, prop) — the marker element
       * carries no path of its own — and it is re-entered rather than caret-placed because the
       * release of a prop session rebuilds the whole instance, replacing the element the session
       * was on.
       */
      prop?: string;
    }
  // Commit and end the inline-edit session if one is live (a no-op otherwise). Posted by the parent
  // When focus/intent leaves the edit surface in the PARENT realm (tab switch, layers-panel click,
  // Chrome pointerdown outside the edit toolbars) — the iframe can't observe those itself. Carries
  // No identity: each host talks to exactly one iframe, so the parent routes the resulting
  // EditCommit by the posting host's tab.
  | { kind: "endEdit" }
  // The parent slash menu resolved a selection — the iframe engine deletes the "/filter" text and
  // Runs its insert flow (which posts editInsert back).
  | { kind: "slashSelect"; cmd: SlashCommand }
  // The parent dismissed the slash menu (outside click / Escape / no matches). The iframe bridge
  // Flips closed but KEEPS its stored onSelect — the parent's select() dismisses the menu BEFORE it
  // Fires onSelect, so a slashSelect may legitimately arrive after this.
  | { kind: "slashDismissed" }
  // Apply a format/link/insert intent to the iframe's cached selection range (4b-2 format toolbar).
  // The parent toolbar lives in the parent realm but never touches the iframe Selection — it posts
  // The author's intent and the iframe applies it where the edited DOM (and its Selection) live.
  | {
      kind: "applyFormat";
      intent:
        | {
            command:
              | "bold"
              | "italic"
              | "underline"
              | "strikethrough"
              | "subscript"
              | "superscript"
              | "code";
          }
        | { command: "link"; href: string | null } // Null/"" = remove
        | { command: "insertData"; token: string };
    }
  // ─── Live expression preview (M6) ───────────────────────────────────────────
  // Evaluate expression nodes against the iframe's LIVE resolved scope (real repeater items, real
  // Window#/ globals) and post per-node display values back. `contextPath` is the document path of
  // The node whose scope context the expressions bind to (null = the root scope); when it sits
  // Inside a repeater template, the iframe binds the first rendered item's $map context. `reqId`
  // Correlates the reply (measure/geometry precedent); `gen` is the render the request targets —
  // The iframe refuses to evaluate against a different render, and the parent drops replies whose
  // Gen no longer matches its last-rendered one.
  | {
      kind: "evalExpr";
      exprs: { id: string; node: JxExpressionNode }[];
      contextPath: (string | number)[] | null;
      reqId: number;
      gen: number;
    }
  // ─── Cross-frame DnD (Phase 4c spike) ──────────────────────────────────────
  // Begin a drag session in the iframe: `src` is the realm-agnostic source kind, `dragSeq` is the
  // Per-session id (parent drops any reply with a different seq), `gen` is the render the session
  // Started against (parent drops dragOver/dropResult whose gen != the iframe's last-rendered gen).
  | { kind: "dragStart"; src: DragSrcKind; dragSeq: number; gen: number }
  // The pointer moved over the canvas. `cursor` is already converted to IFRAME-VIEWPORT coords.
  | { kind: "dragMove"; cursor: { x: number; y: number }; dragSeq: number }
  // The pointer was released over the canvas — the iframe computes the drop FRESH and posts dropResult.
  | { kind: "drop"; cursor: { x: number; y: number }; dragSeq: number }
  // The pointer left this canvas (dropped elsewhere / migrated to another panel): the iframe forgets
  // The session + stops any auto-scroll. `dragMove`/`drop` arriving after are no-ops.
  | { kind: "dragEnd"; dragSeq: number }
  // The drag was cancelled (Escape/abort from the parent realm) — same teardown as dragEnd.
  | { kind: "dragCancel"; dragSeq: number };

/**
 * One expression's live evaluation outcome (M6). `values` are path-key → display-string pairs — the
 * trace hook's per-node values, already formatted INSIDE the iframe (same truncation rules as the
 * parent's snapshot preview) so only postMessage-safe strings cross the boundary. `error` carries
 * the thrown message when this expression failed (its `values` then hold whatever nodes reported
 * before the throw).
 */
export interface EvalExprResult {
  id: string;
  values: [string, string][];
  error?: string;
}

/** A node's bounding box, in the iframe's own viewport coordinates. */
export interface SerializableRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Cross-frame drag-and-drop (Phase 4c) ──────────────────────────────────────

/**
 * The structural placement a drop resolves to, applied via the realm-agnostic
 * `applyDropInstruction`.
 */
export type DropInstructionType = "reorder-above" | "reorder-below" | "make-child";

/**
 * The kind of thing being dragged. `tree-node` carries the source's existing document path (a
 * move); `block` carries only its fragment's tag on the wire — its full `fragment` (a
 * {@link JxMutableNode}) is retained PARENT-SIDE keyed by `dragSeq` and never crosses the boundary.
 * The tag is what lets the iframe keep a block out of a paragraph (`iframe-drop.ts`); an OS file
 * drag has none, and is placed as a block.
 */
export type DragSrcKind =
  | { type: "tree-node"; path: (string | number)[] }
  | { type: "block"; tag?: string };

/**
 * A display-only drop preview the iframe posts on `dragOver`: where the drop indicator should draw
 * (`referenceRect`, in iframe-viewport coords) and the resolved structural placement. `edge` is the
 * geometric side (added for the indicator slice; unused in the spike). The actual drop is
 * recomputed FRESH in the `drop` handler — a preview is never the source of truth for the applied
 * mutation.
 */
export interface DropPreview {
  instruction: DropInstructionType;
  targetPath: (string | number)[];
  referenceRect: SerializableRect;
  edge: "top" | "bottom" | "inside";
}

/**
 * A click that landed on LAYOUT chrome — a header, a footer, anything the layout file contributes
 * that is not the page's own content. Such a node has no page-document path, so it can never be a
 * {@link NodeHit}; it is addressed by the layout FILE it came from plus its path inside that file.
 *
 * This is the message that makes the first click a new author makes do something. On a default
 * project the two most conspicuous strings on the page ("My Site", "Built with Jx") both come from
 * `layouts/base.json`, and before this existed clicking either one selected nothing, hovered
 * nothing and posted nothing.
 */
export interface LayoutHit {
  /** Project-relative path of the layout document, e.g. `layouts/base.json`. */
  layoutFile: string;
  /** The clicked node's path WITHIN that layout document (what to select once it is open). */
  layoutPath: (string | number)[];
  /** The rendered tag, for the panel's `<header>` label. */
  tagName: string;
  /** The rendered class list, shown read-only in the panel. */
  className: string;
  /** The node's box, in iframe-viewport coords (same convention as {@link NodeHit}). */
  rect: SerializableRect;
}

/** A document path plus the iframe-space rect of the node it resolves to. */
export interface NodeHit {
  path: (string | number)[];
  rect: SerializableRect;
}

/**
 * The node under an external file drag. Extends {@link NodeHit} with the resolved `tagName` so the
 * parent can decide replace-vs-insert without a second round trip — it needs the tag to recognise
 * an `<img>`/`<video>`/`<source>` and to look a custom element up in the component registry.
 */
export interface FileDropHit extends NodeHit {
  tagName: string;
}

// ─── Cross-frame insertion affordance ("+") ─────────────────────────────────────

/**
 * One candidate insertion point the iframe computed from its own pointer hit-test (the cross-origin
 * cousin of the legacy insertion-helper). `edge` is the geometric side of the hovered node the "+"
 * anchors to; the parent positions a clickable "+" from `rect` (a small anchor box in
 * iframe-viewport coords, mapped via {@link canvasRectToParent} at scale=1 like the drop indicator).
 * On click the parent runs the unchanged parent-realm slash-menu → mutateInsertNode flow with
 * `insertParentPath` + `index`. A `center` zone is an empty container (insert as its first child);
 * top/bottom/left/right insert a sibling before (`index`) or after the hovered node.
 */
export interface InsertZone {
  edge: "top" | "bottom" | "left" | "right" | "center";
  insertParentPath: (string | number)[];
  index: number;
  rect: SerializableRect;
}

/**
 * A keyboard event flattened for the bridge. The iframe forwards the global-shortcut subset (so
 * undo/redo/save/delete/… still fire when focus is inside the canvas iframe); the parent rebuilds a
 * synthetic `keydown` from these fields and dispatches it to its existing shortcut handler.
 */
export interface SerializedKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** What a text chip draws: the binding's live value, or its name (studio.md §6.9). */
export type BindingDisplay = "values" | "names";

/** The two {@link BindingDisplay} values, `canvas.setBindingDisplay`'s enum. */
export const BINDING_DISPLAYS = ["values", "names"] as const satisfies readonly BindingDisplay[];

/**
 * One remote lookup's settled answer, as the tab's session keeps it: the value, or why there is
 * none. JSON, because it crosses the frame boundary in both directions.
 */
export type RemoteResult = { ok: true; value: JsonValue } | { ok: false; error: string };

/** What a render says about the document's remote data (studio.md §4.5). */
export interface RemoteWire {
  /**
   * The tab's cache session. A frame is reused from tab to tab, and Refresh starts a new session,
   * so a frame that sees another string forgets every answer it holds.
   */
  session: string;
  /** Whether this frame fetches what the session lacks. Exactly one frame of a tab does. */
  fetch: boolean;
  /**
   * Whether the host has a backend that can run a `timing: "server"` function. Without one the
   * frame calls nothing and the entry reads "Runs on the live page".
   */
  server: boolean;
  /** Every answer the session holds, by lookup key (`remoteKey` in `canvas/iframe-remote.ts`). */
  results: Readonly<Record<string, RemoteResult>>;
}

/**
 * Where one binding, or one state entry, stands on the canvas (studio.md §4.5).
 *
 * - `resolved`: it has its value.
 * - `pending`: it reads a lookup that has not answered yet.
 * - `failed`: its expression threw, or the lookup it reads failed; `error` says how.
 * - `not-run`: it reads something the canvas does not run (a request that is not a `GET`, a `manual`
 *   one, a server function on a host with no backend).
 */
export type BindingState = "resolved" | "pending" | "failed" | "not-run";

/** What a binding that reads an entry the canvas does not run says, on the canvas and beside it. */
export const NOT_RUN_NOTE = "Runs on the live page";

/** What a binding still waiting for its data says. */
export const PENDING_NOTE = "Loading";

/** What a binding whose data could not be had says. */
export const FAILED_NOTE = "Could not load";

/**
 * What a binding whose own expression throws says. Other words than {@link FAILED_NOTE}, because
 * nothing was fetched: the mistake is in the expression, and the page would draw nothing there
 * too.
 */
export const THROWN_NOTE = "Has an error";

/** One state entry's standing: {@link BindingState}, and what the canvas says about it. */
export interface EntryStatus {
  status: BindingState;
  /** Why it failed. Present on `failed` alone. */
  error?: string;
}

/** One binding drawn on the canvas, and where it stands. */
export interface BindingStatus extends EntryStatus {
  /** The document path of the node the binding is drawn in, or null for one with no path. */
  path: (string | number)[] | null;
  /** The expression, verbatim: a `${…}`, or a `{ "$ref" }` as JSON. */
  source: string;
}

/**
 * A thing a frame build may or may not understand, announced on `ready`.
 *
 * - `bindingDisplay`: the `setBindingDisplay` message.
 * - `rows`: repeaters drawn as real rows, the `setActiveRows` message and the `rowActivated` reply.
 * - `bindingStatus`: remote data fetched once (the render's `remote` field, the `remoteResults`
 *   message and the `remoteSettled` reply) and the `bindingStatus` report.
 */
export type FrameCapability = "bindingDisplay" | "rows" | "bindingStatus";

/** Every capability this build of the frame announces. */
export const FRAME_CAPABILITIES: readonly FrameCapability[] = [
  "bindingDisplay",
  "rows",
  "bindingStatus",
];

/** Messages the canvas iframe sends back to the editor (parent). */
export type IframeToParent =
  /*
   * The frame has booted. `capabilities` names what THIS build of the frame understands beyond the
   * protocol it shipped with (studio.md §4.5): the frame bundle is prebuilt, a message kind the
   * other side does not know is dropped without a word, and a host must be able to tell an old
   * frame from a broken one. A host posts a message a capability guards only to a frame that
   * announced it. Absent means none.
   */
  | { kind: "ready"; capabilities?: readonly FrameCapability[] }
  /*
   * A press in an echo row made it the active row of the repeater at `path` (studio.md §4.5). The
   * frame has already renamed its stamps, so the `hit` that follows names an element that is
   * addressable; the host records the choice on the tab, which is what carries it to the tab's
   * other artboards and across a render. One message per repeater whose row changed: a press
   * inside nested repeaters posts one for each.
   */
  | { kind: "rowActivated"; path: (string | number)[]; row: number }
  /*
   * A lookup this frame ran has answered (studio.md §4.5). The host keeps the answer in the tab's
   * session, which is what every later render and every other frame of the tab is given, so the
   * lookup is never started twice. `session` is the one the lookup was asked in, which need not be
   * the one the frame draws now (a frame is handed another tab's document while a request is
   * out); the host finds the tab by it, and drops an answer for a session a Refresh has replaced.
   */
  | { kind: "remoteSettled"; session: string; key: string; result: RemoteResult }
  /*
   * Where every state entry and every binding of the drawn document stands (studio.md §4.5).
   * Posted after a render and again whenever an answer changes it. `entries` is the root scope's
   * remote entries by state key; `bindings` is the chips and bound blocks drawn, in document
   * order. `gen` lets the host drop a report from a superseded render.
   */
  | {
      kind: "bindingStatus";
      gen: number;
      entries: Readonly<Record<string, EntryStatus>>;
      bindings: readonly BindingStatus[];
    }
  // Acknowledges a `flushEdits`: every pending commit for this frame has been posted.
  | { kind: "flushComplete"; reqId: number }
  | { kind: "renderComplete"; gen: number }
  | { kind: "renderError"; gen: number; message: string }
  // The iframe's measured content height in CSS px. The host sizes the iframe ELEMENT to this so the
  // Canvas never scrolls internally — the parent canvas pans/scrolls instead, every node stays inside
  // The iframe box (hit-testable), and the parent-drawn overlay tracks it (it can't follow an internal
  // Scroll). Viewport units are transposed to container units (runtime `transposeCanvasUnits`) so a
  // `100vh` section can't feed back into an ever-growing height. Posted after each render and on reflow.
  // `fragment` = the rendered root is a component DEFINITION (a fragment, not a page): the host then
  // Drops the iframe's 480px pre-measurement floor so a short component hugs its content.
  | { kind: "contentHeight"; height: number; fragment: boolean }
  // A serializable snapshot of the iframe's resolved `$defs` (buildScope's output — content
  // Collections / `$prototype` data sources eagerly resolved). The parent adopts it into
  // `S.canvas.scope` so the data-explorer panel shows live data instead of "pending" (the iframe,
  // Not the parent, now resolves the scope). `gen` lets the parent drop a snapshot from a superseded
  // Render. Posted right after `renderComplete`; values are JSON-safe deep clones (see serialize-scope).
  | { kind: "dataScope"; gen: number; scope: JsonObject }
  // The frame's own quiescence, ANSWERED rather than polled (studio.md §13.5).
  // Nothing in the parent realm can see inside a cross-origin frame, so a parent that wanted to
  // Know whether the canvas had settled could only sleep. The frame samples itself at its own rAF
  // And posts whenever the tuple changes, ending with the quiet one; the host holds the latest.
  //
  // `fonts` is `document.fonts.status === "loaded"` and is NOT sufficient alone — in a blank canvas
  // Frame it reports "loaded" against an EMPTY font set (measured: `hero` drifted 0.150 RMSE
  // Because the first capture measured fallback metrics while Plus Jakarta Sans was still in
  // Flight). It is honest only together with `gen` (a frame that has not acked a render has not
  // Loaded its fonts either) and the runner's per-frame network count.
  //
  // `images` counts images whose load FAILED and whose retry (`installCanvasImageRetry`, re-firing
  // At 150/300/450 ms) has not resolved. Deliberately NOT "images not yet complete": blocking on
  // `img.complete` failed 8 of 61 shots — the design canvas renders unresolved bindings as literal
  // Srcs, several starters ship a 404 favicon, and lazy images below the fold never complete. A
  // Pending retry is the one image fact only the app knows.
  | { kind: "idle"; gen: number; fonts: boolean; animations: number; images: number }
  // `additive` is Ctrl/Cmd being held at the moment of the click — the ACCUMULATE gesture, which
  // The parent turns into a toggle against `session.selection` (studio-ui-guidelines.md §8.1).
  // Absent/false is a plain replace, which is what every canvas click was before the selection
  // Became a set.
  | { kind: "hit"; hit: NodeHit; additive?: boolean }
  // A click on layout chrome (see {@link LayoutHit}). Distinct from `hit` because the target is not
  // In the page document at all: the parent adopts it as `view.layoutSelection` (which shows the
  // Read-only layout panel with its "Open Layout →" action) rather than as a document selection.
  | { kind: "layoutHit"; hit: LayoutHit }
  | { kind: "hover"; hit: NodeHit | null }
  // Candidate insertion "+" zones for the hovered node, recomputed on pointermove (cross-origin
  // Cousin of the legacy insertion-helper). `null` clears the "+" (cursor mid-element / left the
  // Canvas). The parent draws a clickable "+" from each zone's rect and, on click, runs the
  // Parent-realm slash-menu → mutateInsertNode flow with the zone's insertParentPath + index.
  | { kind: "insertZones"; zones: InsertZone[] | null }
  // Response to `measure`: the rects of whichever requested paths resolved to a node (missing paths
  // Are simply omitted). `reqId` echoes the request so the parent can drop stale responses.
  /**
   * Measured rects for the requested paths.
   *
   * `hidden` names the paths that RESOLVED to an element but are not rendered — a closed popover, a
   * `display: none` node, a `$switch` branch that is not the live case. They are reported apart
   * from `hits` rather than as a zero rect, because a zero rect is a truthy object: the overlay
   * drew a 0×0 box at the artboard origin and the block action bar anchored to it, so selecting a
   * hidden node put a selection marker in the top-left corner of the page.
   *
   * Optional, so a prebuilt frame that predates it still answers.
   */
  | { kind: "geometry"; reqId: number; hits: NodeHit[]; hidden?: (string | number)[][] }
  // Response to `evalExpr`: one result per requested expression (empty when the request's gen no
  // Longer matches the live render — the iframe never evaluates against the wrong scope). `reqId`/
  // `gen` echo the request so the parent can drop stale replies (measure/geometry precedent).
  | { kind: "evalResult"; reqId: number; gen: number; results: EvalExprResult[] }
  // A patch applied cleanly (echoes gen so the host can re-measure the selection overlay).
  | { kind: "patchComplete"; gen: number }
  // A patch could not be applied surgically — the parent escalates to a full render.
  | { kind: "patchError"; gen: number; message: string }
  // A global-shortcut keystroke captured inside the iframe, for the parent to re-dispatch.
  | { kind: "forwardKey"; event: SerializedKey }
  // A wheel event over the canvas iframe, for the parent's zoom/pan handler. The iframe is sized to
  // Its content (never scrolls itself) and a cross-origin OOPIF doesn't bubble wheel to the parent, so
  // It forwards the deltas + modifiers + its own cursor (iframe-viewport coords) for the host to map.
  | {
      kind: "forwardWheel";
      deltaX: number;
      deltaY: number;
      x: number;
      y: number;
      ctrlKey: boolean;
      metaKey: boolean;
      shiftKey: boolean;
    }
  // Inline editing started in the iframe (the parent shows the format toolbar from here). `prop`
  // Names the component-instance prop when the session edits prop-bound text, and `field` the
  // Entry field when it edits a collection page's text drawn from the entry (plain sessions both).
  | { kind: "editStart"; path: (string | number)[]; prop?: string; field?: string }
  // The first keystroke of a typing burst, ahead of the idle tick's commit: the parent marks the tab
  // Dirty now, so Save is enabled the instant there is text a save would keep.
  | { kind: "editInput" }
  // Committed inline-edit content (rich `children` else `textContent`) for the parent to persist.
  | {
      kind: "editCommit";
      path: (string | number)[];
      children: (JxMutableNode | string)[] | null;
      textContent: string | null;
      /**
       * True when the caret is still in the block (the idle tick) rather than leaving it. The
       * parent echoes such a commit back with the path suppressed, so the patch cannot re-render
       * the subtree under a live caret.
       */
      inPlace?: boolean;
      /**
       * The chips the author deleted from the block since its content last reached the document,
       * each as the expression it stood for (studio.md §4.5). A write may drop a binding only when
       * it is named here; absent means none were deleted.
       */
      removedTags?: string[];
    }
  // Join two blocks. `fromPath`'s content is appended to `intoPath`'s and `fromPath` is removed —
  // Backspace at a block start and Delete at a block end are the same operation from either side.
  // The iframe names BOTH paths because document order lives in the rendered DOM, where a list
  // Item, a table cell, and a nested container all resolve without the parent re-deriving it.
  | { kind: "editMerge"; fromPath: (string | number)[]; intoPath: (string | number)[] }
  // Collapse a selection that spans blocks, replacing it with `text` (empty for a deletion). The
  // Iframe supplies the blocks strictly BETWEEN the endpoints, since document order lives in the
  // Rendered DOM — the same reason a boundary merge names its neighbour there.
  | {
      kind: "editRangeReplace";
      from: { path: (string | number)[]; offset: number };
      to: { path: (string | number)[]; offset: number };
      between: (string | number)[][];
      text: string;
      /**
       * The chips the selection covers in its two end blocks, each as the expression it stood for:
       * the bindings this collapse is allowed to drop. See `editCommit.removedTags`.
       */
      removedTags?: string[];
    }
  // Committed prop-bound text: persist `value` into `$props[prop]` of the instance at `path`.
  | {
      kind: "editCommitProp";
      /** See `editCommit.inPlace` — a prop patch re-renders the whole instance. */
      inPlace?: boolean;
      path: (string | number)[];
      prop: string;
      value: string;
    }
  // Committed entry-field text (studio.md §22.5): an entry written inside its collection's page
  // Typed one of the page's whole-field nodes; the parent writes `value` to the entry's `field`.
  // Sent on release only, never on the idle tick: a field write redraws the page around the caret.
  | { kind: "editCommitField"; field: string; value: string }
  // Enter split a paragraph: keep `before` in the node, insert a new one with `after`.
  | {
      kind: "editSplit";
      path: (string | number)[];
      before: JxContentResult;
      after: JxContentResult;
      /** See `editCommit.removedTags`. */
      removedTags?: string[];
    }
  // Slash-insert: swap the tag in place when empty, else commit + insert a new element after.
  | {
      kind: "editInsert";
      path: (string | number)[];
      cmd: SlashCommand;
      commitData: JxContentResult | undefined;
      /** See `editCommit.removedTags`. */
      removedTags?: string[];
    }
  // A serializable selection snapshot for the parent format toolbar (4b-2). The iframe owns the
  // Selection; the parent renders pressed-state/position from this and never reads the iframe DOM.
  | {
      kind: "selectionChanged";
      // Monotonic per edit session; the parent drops snapshots with a stale (<=) seq.
      seq: number;
      path: (string | number)[];
      // Strong/em/u/del/sub/sup/code/a active across the WHOLE selection (both endpoints).
      activeTags: string[];
      // Caret/selection bbox in IFRAME-VIEWPORT coords (null when unmeasurable).
      rect: SerializableRect | null;
      collapsed: boolean;
      link: { active: boolean; href: string | null };
      // D-B: always null this phase — repeater item/index merge-tag scope is a follow-up.
      localScope: null;
    }
  // The inline-edit session ended.
  | { kind: "editEnd" }
  // ─── Slash-menu bridge ──────────────────────────────────────────────────────
  // The engine (in the iframe) detected "/" in a live edit session; the parent shows the real
  // Host-realm menu. Re-posted with a new `filter` as the author keeps typing (the engine's
  // UpdateSlashMenu drives it). `rect` is the edited element's bbox in IFRAME-VIEWPORT coords.
  /**
   * Show the parent's slash menu at this rect.
   *
   * `showFilter` is what an UNANCHORED menu needs — one opened by `insert.openSlashMenu` rather
   * than by typing "/". There is no "/…" run in the document to narrow the list with, so the menu
   * has to carry its own field or the only way past fifteen blocks is scrolling. It existed as a
   * callback option INSIDE the frame and was dropped at this boundary, which is the argument for a
   * message carrying every fact its receiver needs rather than most of them: the loss was
   * invisible, because the menu still appeared.
   */
  | { kind: "slashShow"; rect: SerializableRect; filter: string; showFilter?: boolean }
  // A menu-navigation key pressed in the iframe while the parent menu is open. The iframe
  // Intercepts these four keys capture-phase (restoring the "menu captures Enter" contract) and the
  // Host drives the parent menu's key handler directly — no synthetic keydown redispatch.
  | { kind: "slashNav"; key: "ArrowUp" | "ArrowDown" | "Enter" | "Escape" }
  // Iframe-side dismissal (backspace past the "/", session end, a click inside the iframe — the
  // Parent's outside-click listener can't see iframe clicks).
  | { kind: "slashDismiss" }
  // ─── Context menu ───────────────────────────────────────────────────────────
  // Right-click in the canvas. `path` is the nearest data-jx-path node (null on empty space — the
  // Browser menu is still suppressed, legacy parity); x/y are IFRAME-VIEWPORT coords for the host
  // To convert via its empirical geometry.
  | { kind: "contextMenu"; path: (string | number)[] | null; x: number; y: number }
  // ─── Pane focus ─────────────────────────────────────────────────────────────
  // A pointer went down somewhere in this frame. Nothing else — no path, no coordinates, no
  // Selection: it says only "the person is working in this pane now", which the parent realm cannot
  // Observe for itself because a pointer event inside a cross-origin iframe is delivered in the
  // Frame's own realm and never surfaces above it.
  //
  // `hit` used to be the whole seam, and it has two holes. It is not posted in PREVIEW at all — a
  // Click there is a click on the page, never a selection — so a pane showing Preview could not be
  // Focused by clicking the thing it is showing; and in edit/design it is only posted when the
  // Click lands ON a `[data-jx-path]` node, so clicking an artboard's empty margin focused nothing
  // Either. Both left the keyboard in the other pane while the person was plainly in this one.
  //
  // Deliberately NOT in the host's preview block-list: focusing a pane is not an edit, and it is
  // The one thing preview must still report.
  /**
   * A `popovertarget` invoker was clicked, and it names a popover the studio can address.
   *
   * The canvas renames `popover` to `data-jx-popover`, so the browser's own invoker activation no
   * longer fires — which is a gain, not a loss: there is exactly ONE writer of open state instead
   * of a race between the platform and the editor, and the model can no longer disagree with what
   * is on screen. The affordance is re-supplied here, and the host runs the same command the
   * palette and the assistant run.
   *
   * Posted ALONGSIDE `hit`, never instead of it: clicking a trigger both selects the button and
   * opens its panel, which is what an author expects from a control they can also style.
   */
  | {
      kind: "popoverTargetClick";
      targetPath: (string | number)[];
      action: "toggle" | "show" | "hide";
    }
  /**
   * A click on a `<button command commandfor>` the canvas de-linked: the frame reports the target
   * and the command, and the host's single writer of open state answers for a popover or a dialog.
   */
  | { kind: "commandTargetClick"; targetPath: (string | number)[]; command: string }
  | { kind: "paneFocus" }
  // ─── Preview navigation ─────────────────────────────────────────────────────
  // A link was clicked in PREVIEW mode. Preview keeps anchors live (design/edit de-link them onto
  // `data-jx-href`), so the click would navigate the canvas iframe away and destroy the render —
  // Taking the editing session with it. The iframe reports the intent instead and the parent opens the
  // Real page in a real browser tab, which is also the only place project JS, routing and server data
  // Behave exactly as they will in production.
  | { kind: "previewNavigate"; href: string }
  // ─── Cross-frame DnD (Phase 4c spike) ──────────────────────────────────────
  // Flow 3 (grab-anywhere): the iframe detected a drag begin on an element body (pointerdown past a
  // Movement threshold on a `[data-jx-path]`, NOT during an inline-edit). The parent starts a
  // Coordinator session as a `tree-node` source with this `path` and synthesizes dragMove from its
  // Own pointermove over the iframe. `dragSeq` is the iframe's pre-allocated session hint; the parent
  // Bumps its own authoritative seq in beginDragSession.
  // A NATIVE drag stream entered this iframe with NO session bound here. Chromium delivers
  // Dragover/drop to the frame UNDER THE CURSOR, so a parent-originated drag (palette/layers)
  // Crosses onto the canvas without the parent ever seeing a cursor inside the iframe rect — it
  // Never binds a host. On this message the bridge binds/migrates its live pragmatic session to
  // This host (posting dragStart); the iframe's native handlers then drive dragOver/dropResult.
  | { kind: "nativeDragEnter" }
  // The iframe cancelled a flow-3 (iframe-originated) drag locally (Escape during a body-grab): the
  // Parent tears down its ghost/indicator. Single-sourced through the iframe for that case so cancel
  // Never double-fires (the parent-source flows cancel via pragmatic instead).
  | { kind: "dragEnd"; dragSeq: number }
  // A display-only drop preview for the parent's indicator. `gen` lets the parent drop previews
  // Computed against a superseded render; `preview` is null when the cursor resolves to no drop.
  // `cursor` is present ONLY for flow-3 (iframe-driven) drags, in IFRAME-VIEWPORT coords: the parent
  // Has no pointer during an iframe-originated drag, so it positions the ghost by forward-converting
  // This cursor. Parent-driven flows (1/2/4) omit it (the parent already has the raw cursor).
  | {
      kind: "dragOver";
      dragSeq: number;
      gen: number;
      preview: DropPreview | null;
      cursor?: { x: number; y: number };
    }
  // The resolved drop, computed FRESH from the current DOM. The parent (if non-stale, non-null)
  // Applies it via applyDropInstruction with the retained source data.
  | {
      kind: "dropResult";
      dragSeq: number;
      gen: number;
      instruction: DropInstructionType | null;
      targetPath: (string | number)[] | null;
    }
  // ─── External file drop (flow 5) ───────────────────────────────────────────
  // An OS file drag is moving over / was released on this canvas. Unlike flows 1-4 there is no
  // Parent session to bind: the parent never saw the gesture start, so the iframe drives the whole
  // Thing and the parent's only jobs are the overlay and the upload+mutation. The iframe supplies
  // GEOMETRY only (`hit` = the node under the cursor, `preview` = where an insert would land); the
  // Parent decides SEMANTICS (replace this image's src vs. insert a new element) because that needs
  // The component registry, which is parent-realm.
  | { kind: "fileDragOver"; hit: FileDropHit | null; preview: DropPreview | null }
  // The pointer left the canvas mid-drag — the parent clears its overlay.
  | { kind: "fileDragLeave" }
  // The files were released. `File` is structured-cloneable so the bytes cross the boundary here;
  // `FileList` is NOT, so the iframe spreads it. The parent uploads and mutates.
  | { kind: "fileDrop"; files: File[]; hit: FileDropHit | null; preview: DropPreview | null };

/** The iframe→parent selection snapshot that drives the parent format toolbar. */
export type SelectionSnapshot = Extract<IframeToParent, { kind: "selectionChanged" }>;

/** The author's format/link/insert intent the parent toolbar posts back to the iframe. */
export type ApplyFormatIntent = Extract<ParentToIframe, { kind: "applyFormat" }>["intent"];

/** The parent→iframe drag-session start message (Phase 4c). */
export type DragStartMsg = Extract<ParentToIframe, { kind: "dragStart" }>;

/** The iframe→parent display-only drop-preview message (Phase 4c). */
export type DragOverMsg = Extract<IframeToParent, { kind: "dragOver" }>;

/** The iframe→parent insertion-affordance ("+") message. */
export type InsertZonesMsg = Extract<IframeToParent, { kind: "insertZones" }>;
