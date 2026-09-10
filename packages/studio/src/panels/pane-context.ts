/// <reference lib="dom" />
/**
 * The pane's own chrome — region ⑦ (context bar) and region ⑩ (the floating zoom pod).
 *
 * This replaces `#tab-bar`, which was a 28px band styled identically to the tab strip above it,
 * holding **five unrelated axes** with no labels on any of them: a document-stack breadcrumb
 * (navigation), a zoom widget (viewport), route params and component test props (document data), a
 * colour-scheme switch and feature toggles (rendering state), and Export (a mode action). Plan §3.2
 * ⑦ replaces them with three axes that each say what they are:
 *
 * - **Editor kind** — `Canvas ⌄`, offering only the kinds this document declares. A document with one
 *   kind renders the name as text rather than as a dropdown that cannot go anywhere.
 * - **Canvas view** — `Edit │ Design` as a radio ({@link canvasBaseViewsFor}) with a **Preview**
 *   toggle beside it ({@link previewStateOf}), and none at all in a pane that may not host the
 *   Canvas. The two are drawn apart because they are two axes: preview is a flag over an edit or
 *   design base, so the radio marks the base throughout and the toggle says whether it is on.
 * - **Rendering context** — `md ⌄ Light ⌄`, folding the size breakpoint, the colour scheme, the
 *   feature queries and the layout show/hide switch into one popover. Per §2 principle 5 this
 *   control **only selects**; its footer is "Manage contexts…", which routes to the definition site
 *   — Project Settings › Contexts (`settings/contexts-section.ts`), the one place a breakpoint, a
 *   colour scheme or a feature query is defined.
 * - **Resolving with** — the document DATA a render resolves against: a page's route params, a
 *   component's test props. Its own popover beside the context one, headed "resolving with", with
 *   the fields in a vertical stack. A SECOND popover rather than a fourth group in the first,
 *   because these are values you type and everything in the rendering-context popover is something
 *   you pick — and because a row of text fields is what made the 28px band unreadable.
 *
 * **This module is the FLOW; `surfaces/pane-context.json` is the markup.** Everything below decides
 * — which kinds a document declares, what a lens may never write, which pane's stage a zoom verb
 * lands on, what a route param's candidates are, what a typed test prop parses as — and hands one
 * projection of words and keyed rows to `surfaces/pane-context.ts`, one mount per pane. Nothing
 * here renders.
 *
 * **The bar is not a grid row.** It renders inside the pane's own cell (`#pane-chrome`, stacked
 * over `#canvas-wrap`), because a per-pane surface cannot be a row of the application grid — the
 * second pane would have no way to have one. The stage is offset by {@link PANE_CONTEXT_VAR} rather
 * than by a track, and the zoom pod floats bottom-right over the canvas exactly as §3.2 ⑩ asks.
 *
 * **The read-only banner rides with the bar.** `collab/collab-state.ts` says whether a guest may
 * write (§7.4); the surface that owes them the sentence is this one, because it is the per-pane,
 * per-document chrome that sits directly above the editing surface. It is stacked under the bar
 * inside the document's `[part="band"]` and the offset is MEASURED from that band
 * ({@link applyPaneContextOffset}), so a two-line banner pushes the stage down instead of covering
 * the document it is warning you about.
 */

import { projectState, updateUi } from "../store";
import { effect, effectScope } from "../reactivity";
import { PRIMARY_PANE, focusPane, workspace } from "../workspace/workspace";
import {
  activeMediaOfPane,
  canvasModeOfPane,
  canvasModeOfTab,
  derivationOfPane,
  surfaceForPane,
  tabOfPane,
} from "../canvas/canvas-surface";
import {
  DERIVE_PRESETS,
  PRESET_LABELS,
  declaredMedia,
  deriveRefusal,
  pinRefusal,
  presetRefusal,
} from "../workspace/pane-derive";
import { openMenu } from "../surfaces/menu";
import { emptyPaneContextView, mountPaneContextSurface } from "../surfaces/pane-context";
import { paneRegion } from "../ui/regions";
import {
  fitToScreen,
  getFit,
  resetZoom,
  canvasBaseViewOf,
  canvasBaseViewsFor,
  previewStateOf,
  setCanvasView,
  setEditZoom,
  setFit,
  setUserZoom,
  stageZoom,
} from "../canvas/canvas-utils";
import { editorKindOf, editorKindsOf, modeForEditorKind } from "../tabs/tab";
import { collabState } from "../collab/collab-state";
import { activeRegistry } from "../commands/active-registry";
import { getEffectiveLayoutPath, getEffectiveLocales, getEffectiveMedia } from "../site-context";
import { localeLabel, localeOfPath } from "@jxsuite/schema/locale";
import { isSchemeQuery } from "../utils/canvas-media";
import { dynamicRouteParams, loadParamValues, pagePathsDef } from "../page-params";
import { componentPropEntries, isComponentDoc } from "../component-props";
import { mediaDisplayName } from "./shared";
import type { CanvasView, FitMode } from "../canvas/canvas-utils";
import { EDITOR_KIND_LABELS } from "../commands/context";
import type { EditorKind } from "../commands/context";
import type { ParamValues } from "../page-params";
import type { Tab } from "../tabs/tab";
import type { ResolvedI18n } from "@jxsuite/schema/locale";
import type { JsonValue } from "../types";
import type { EffectScope } from "@vue/reactivity";
import type { MenuHandle, MenuRowProjection } from "../surfaces/menu";
import { rectOf } from "../utils/geometry";
import type {
  PaneContextActions,
  PaneContextChoice,
  PaneContextSurfaceHandle,
  PaneContextToggle,
  PaneContextView,
} from "../surfaces/pane-context";

/**
 * The CSS variable the stage is offset by while a context bar is on screen.
 *
 * The bar overlays the pane cell, so something has to keep the canvas out from under it. A variable
 * written by one projection is the same shape `applyDockLayout()` uses for the dock widths — and it
 * means "no tab open" costs the welcome screen no dead band.
 */
export const PANE_CONTEXT_VAR = "--pane-context-h";

/** The bar's height. Declared here because the offset projection and the stylesheet must agree. */
const PANE_CONTEXT_HEIGHT = 28;

export interface PaneContextCtx {
  exportFile: () => void;
  /*
   * There is no `getCanvasMode` here, and there cannot be one.
   *
   * It answered for the FOCUSED pane — `studio.ts` composes it from `workspace.activePaneId` — and
   * this bar is drawn once per pane, from `tabOfPane(paneId)`. One reader was left: the Export
   * control, which is why entering Code in EITHER pane put an Export button in BOTH bars. Every
   * mode question this module asks is now asked of the pane it is drawing: `canvasModeOfTab(tab)`
   * for the tab's own effective mode, `canvasModeOfPane(paneId)` for the stage's.
   */
  /**
   * Write the BASE mode of the tab it is GIVEN. The editor-kind dropdown and the view control both
   * land here, and both are drawn per pane — so the tab is a parameter. It used to be `(mode:
   * string) => void`, resolving `activeTab.value` inside `studio.ts`, which made the side pane's
   * Editor picker a control over the primary's document.
   */
  setCanvasMode: (tab: Tab, mode: string) => void;
  parseMediaEntries: (media: Record<string, string> | null | undefined) => {
    sizeBreakpoints: {
      name: string;
      query: string;
      width: number;
      type: string;
    }[];
    featureQueries: { name: string; query: string }[];
    baseWidth: number;
  };
}

/**
 * Where each pane's chrome renders. One entry per drawn cell.
 *
 * A Map rather than a `let _host`, for the reason the whole grid exists: this bar states one pane's
 * editor kind, canvas view, rendering context and zoom, and two panes have two of each.
 * `panels/pane-grid.ts` attaches a cell's `.pane-chrome` as the cell is built.
 */
const _hosts = new Map<string, HTMLElement>();

/**
 * Each pane's mounted document, keyed the same way and for the same reason.
 *
 * A surface handle is per-pane state as much as a host is: it holds that pane's scope, its two
 * popovers and whether the "resolving with" one is showing. A module-level `let` here would give
 * the second pane's `canvas.setResolvingOpen` the first pane's panel — the exact shape
 * `scripts/check-pane-singletons.ts` exists to refuse.
 */
const _surfaces = new Map<string, PaneContextSurfaceHandle>();

let _ctx: PaneContextCtx | null = null;

let _scope: EffectScope | null = null;

/** Human names for the three Canvas views. */
const CANVAS_VIEW_LABELS: Readonly<Record<CanvasView, string>> = {
  design: "Design",
  edit: "Edit",
  preview: "Preview",
};

/** The colour-scheme segment's values, labels and tooltips. */
const SCHEMES = [
  ["auto", "Auto", "Follow the OS color scheme"],
  ["light", "Light", "Force the light scheme"],
  ["dark", "Dark", "Force the dark scheme"],
] as const;

/**
 * Give a pane's chrome somewhere to paint, or take it away.
 *
 * Called by `panels/pane-grid.ts` as a cell is built and as it is disposed.
 *
 * @param {string} paneId
 * @param {HTMLElement | null} host
 */
export function attachPaneChromeHost(paneId: string, host: HTMLElement | null): void {
  const previous = _hosts.get(paneId);
  if (previous === host) {
    return;
  }
  if (previous) {
    disposePane(paneId);
    applyPaneContextOffset(0, previous);
  }
  if (host) {
    _hosts.set(paneId, host);
    renderPane(paneId, host);
  } else {
    _hosts.delete(paneId);
  }
}

/** Take one pane's document down and forget it. Idempotent. */
function disposePane(paneId: string): void {
  _surfaces.get(paneId)?.dispose();
  _surfaces.delete(paneId);
}

/**
 * Mount the pane chrome. Idempotent.
 *
 * `host` is the PRIMARY pane's, the same bargain `panels/tab-strip.ts`'s `mount` makes: the
 * bootstrap holds the primary's cell, and every other pane's host arrives from the grid through
 * {@link attachPaneChromeHost}.
 *
 * @param {HTMLElement} host
 * @param {PaneContextCtx} ctx
 */
export function mount(host: HTMLElement, ctx: PaneContextCtx) {
  _ctx = ctx;
  attachPaneChromeHost(PRIMARY_PANE, host);
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      /* EVERY pane's tab. The bar states its own pane's editor kind, canvas view, rendering
         context and zoom, so the unfocused one has to repaint when ITS document moves — tracking
         `activeTab` alone left the side pane's bar frozen describing whatever it last drew. */
      for (const pane of workspace.panes) {
        /* NO DERIVATION READS HERE, and the reason is one rule rather than a tally. `render()`
           runs inside this effect and projects EVERY attached pane, so whatever the projection
           reads is ALREADY a dependency and restating it as a `void` line chooses nothing:
           `derived.kind` picks the bar's shape, `activeMediaOfPane` reads `kind`/`preset`/`media`
           for the Context axis, `zoomOf` reads `derived.zoom` for the pod, and {@link podFor} asks
           `canvasModeOfPane`, which for a lens answers `derived.mode` and decides whether the pod
           is drawn at all — pinned by lens-chrome's "the pod is drawn from the LENS's mode".
           `status` and `reason` really are unread here, so tracking them only repainted this bar
           for a change it does not draw. The stage is the surface that needs those two declared,
           because `renderCanvasImpl` runs in a rAF rather than in an effect — see `studio.ts`. */
        const tab = tabOfPane(pane.id);
        if (!tab) {
          continue;
        }
        // Read reactive properties to establish tracking — mirrors the toolbar's subset.
        void tab.doc.document;
        void tab.doc.document?.$layout;
        void tab.doc.mode;
        void tab.documentPath;
        void tab.capabilities.modes;
        void tab.session.ui.activeMedia;
        void tab.session.ui.canvasMode;
        void tab.session.ui.editZoom;
        void tab.session.ui.featureToggles;
        void tab.session.ui.preview;
        void tab.session.ui.previewColorScheme;
        void tab.session.ui.previewLocale;
        void tab.session.ui.previewParams;
        void tab.session.ui.previewProps;
        void tab.session.ui.showLayout;
        void tab.session.ui.zoom;
        // The read-only banner (§7.4) is part of this chrome, so its two facts are tracked here
        // Too: a peer downgrading you mid-session must make the sentence appear, not wait for the
        // Next zoom.
        void collabState(tab).active;
        void collabState(tab).readOnly;
      }
      render();
    });
  });
}

export function unmount() {
  _scope?.stop();
  _scope = null;
  dismissPresetMenu();
  for (const [paneId, host] of _hosts) {
    disposePane(paneId);
    applyPaneContextOffset(0, host);
  }
  _hosts.clear();
  _ctx = null;
  applyPaneContextOffset(0);
}

/**
 * Keep the stage clear of the pane's top band.
 *
 * One projection, one variable — the canvas is offset only by what is actually rendered, so the
 * welcome screen (no tab, no bar) does not open under a 28px gap nothing explains, and a read-only
 * banner does not sit on top of the document it is warning you about.
 *
 * **On the PANE, not on `:root`**, for the reason `panels/jump-bar.ts` gives at the same seam: two
 * cells have two bands of different heights, and a single document-level number offsets both stages
 * by whichever pane painted last. A host outside a cell writes the root, which is what it meant
 * when the shell had one bar.
 *
 * @param {number} height Band height in px. `0` when the pane has no chrome.
 * @param {HTMLElement | null} [host] The bar's host. Its cell takes the variable when it has one.
 */
export function applyPaneContextOffset(height: number, host?: HTMLElement | null): void {
  const target = host?.closest<HTMLElement>(".pane") ?? document.documentElement;
  target.style.setProperty(PANE_CONTEXT_VAR, `${height}px`);
}

/**
 * How tall the top band came out — the bar plus whatever banners rode with it.
 *
 * MEASURED rather than summed, because the banner's height is its wrapped text and only layout
 * knows how many lines that is. `offsetHeight` is 0 in a DOM with no layout engine (every unit
 * test), so the bar's declared height is the floor: the offset is then exactly what it was before
 * banners existed, which is the honest answer when nothing has been laid out.
 *
 * The band is the DOCUMENT's, handed back by the mount rather than found by selector — a surface
 * that re-queries its own markup is holding a node that the next render may already have replaced
 * (guidelines §9.4).
 */
function topBandHeight(surface: PaneContextSurfaceHandle): number {
  return Math.max(surface.band()?.offsetHeight ?? 0, PANE_CONTEXT_HEIGHT);
}

/**
 * Whether this tab's editor has any of the bar's three axes to offer.
 *
 * Project Settings has none: it declares one editor kind, no canvas view, and no rendering context
 * — and the one control the bar WOULD contribute, "Manage contexts…", routes to a section of the
 * very document on screen. A bar of three inert controls above the definition site they point at is
 * chrome that says nothing, so the stage takes the whole pane.
 *
 * @param {Tab} tab
 * @returns {boolean}
 */
function wantsContextBar(tab: Tab): boolean {
  return tab.session.ui.canvasMode !== "settings";
}

/** Project every attached pane's chrome. */
export function render() {
  for (const [paneId, host] of _hosts) {
    renderPane(paneId, host);
  }
}

/** Project one pane's chrome into its own mount, from its own tab. */
function renderPane(paneId: string, host: HTMLElement) {
  if (!_ctx) {
    return;
  }
  try {
    const tab = tabOfPane(paneId);
    const show = Boolean(tab) && wantsContextBar(tab as Tab);
    if (!show) {
      disposePane(paneId);
      applyPaneContextOffset(0, host);
      return;
    }
    const view = viewFor(tab as Tab, paneId, _ctx);
    let surface = _surfaces.get(paneId);
    if (!surface || !surface.connected()) {
      disposePane(paneId);
      surface = mountPaneContextSurface(paneId, host, view, actionsFor(paneId, _ctx));
      _surfaces.set(paneId, surface);
      /* The band cannot be measured until the document has drawn it, so the first offset lands
         after the mount settles; every later projection writes it synchronously from the standing
         band. The stage is offset by the declared height in between, which is what it was before
         banners existed. */
      applyPaneContextOffset(PANE_CONTEXT_HEIGHT, host);
      void surface.ready.then(() => {
        const live = _surfaces.get(paneId);
        if (live) {
          applyPaneContextOffset(topBandHeight(live), host);
        }
      });
      return;
    }
    surface.update(view);
    applyPaneContextOffset(topBandHeight(surface), host);
  } catch (error) {
    console.error("pane-context render error:", error);
  }
}

// ─── The preset menu · the first renderer of `context/pane` ──────────────────

/** The open preset menu, if any. One at a time, like every other menu in this shell. */
let _presetMenu: MenuHandle | null = null;

/** Close the preset menu, if it is open. Idempotent. */
export function dismissPresetMenu(): void {
  _presetMenu?.close();
  _presetMenu = null;
}

/**
 * Open the preset menu, from the ⟲ trigger in the bar's leading slot — the one that was empty.
 *
 * The leading slot existed to push the three axes right. It is where §18.4's preset menu goes
 * because the menu is about THIS PANE and the bar is the pane's own chrome; the alternative homes
 * (the tab strip, the jump bar) are about a document and an address respectively.
 *
 * **There is no `pane.showDerivePresets`.** §13.5, quoted verbatim in `canvas/canvas-render.ts`:
 * opening a menu to press an item names a CONTROL; the item is the command. Every row here runs
 * `pane.derive`, `pane.pin` or `pane.unsplit` with its own arguments, and the screenshot manifest
 * addresses those ids directly rather than driving this widget. Its region is
 * `overlay.menu:derive-presets`, which `ui/layers.ts` derives from the slot key — no budget is
 * spent.
 *
 * **It is the kit menu, not a second one.** `surfaces/menu.ts` already owns roving focus,
 * typeahead, light dismissal, the disabled row's `requires` sentence and the Escape that closes it
 * (guidelines §12.5); this hands it rows.
 */
function openPresetMenu(paneId: string, anchor: HTMLElement): void {
  dismissPresetMenu();
  const registry = activeRegistry();
  if (!registry) {
    return;
  }
  const rows = presetRows(paneId);
  _presetMenu = openMenu({
    label: "Show beside this pane",
    opener: anchor,
    onClosed: () => {
      _presetMenu = null;
    },
    place: (box) => {
      const at = rectOf(anchor);
      return {
        x: Math.round(Math.min(at.left, window.innerWidth - box.width - 4)),
        y: Math.round(at.bottom),
      };
    },
    region: "derive-presets",
    rows: rows.map((row) => menuRow(row)),
  });
}

/**
 * One preset row, as the kit menu reads it: an identity, a sentence, and what pressing it runs.
 *
 * **There is no second refusal inside `run`, and the lit version's is deliberately gone.** The
 * handler used to re-ask `row.disabled !== null` before doing anything, which was a second answer
 * to the question the line above it already settles: `jx-menu-item` writes `aria-disabled` from
 * this flag and raises no `select` while it is true, so a refused row never reaches `run` at all.
 * Keeping both left the projection's own flag with nothing able to tell right from wrong about it —
 * `check-lens-mutants.ts` said so, by surviving.
 */
function menuRow(row: PresetRow): MenuRowProjection {
  return {
    destructive: false,
    disabled: row.disabled !== null,
    dividerAbove: false,
    id: rowId(row),
    ...(row.disabled === null ? {} : { requires: row.disabled }),
    run: () => {
      /* THE PANE THE MENU IS ABOUT, before the verb that resolves the focus runs.
         See {@link PresetRow.pane}: all three of these commands take the focused pane as their
         subject, and a pointer gesture on this pane has already focused it — but a keyboard
         activation has not, because `panels/pane-grid.ts` focuses on pointerdown. Without this line
         the secondary pane's menu derived from the primary and its Unsplit closed the wrong pane,
         by keyboard only. */
      focusPane(row.pane);
      void activeRegistry()?.run(row.command, row.args);
    },
    title: row.label,
  };
}

/**
 * A row's identity in the menu, which is not simply its command: `pane.derive` appears once per
 * projection, once per declared breakpoint and once per declared locale, and a keyed `$map` cannot
 * reconcile three rows that all call themselves `pane.derive`.
 */
function rowId(row: PresetRow): string {
  const parts = [row.command];
  for (const key of ["preset", "media", "locale"] as const) {
    const value = row.args[key];
    if (typeof value === "string") {
      parts.push(value);
    }
  }
  return parts.join(":");
}

/** One row of the preset menu: a command, its arguments, and why it cannot run when it cannot. */
export interface PresetRow {
  label: string;
  command: string;
  args: Record<string, unknown>;
  /**
   * The pane this row is ABOUT — the one whose ⟲ opened the menu.
   *
   * The previous round made the row's ANSWER a pure function of the pane and left its ACTION
   * resolving the focus: every one of these three commands takes the focused pane as its subject
   * (`pane.derive`'s `activePane()`/`sidePane()`, `pane.unsplit`'s `workspace.activePaneId`), so a
   * row read off the secondary pane's menu derived from the primary. Reachable by keyboard and only
   * by keyboard, which is why it survived a browser pass: `panels/pane-grid.ts` focuses a pane on
   * POINTERDOWN, and a keyboard activation of a menu item fires `click` alone.
   *
   * Carried on the row rather than passed as a command argument. A pane id in `args` would make
   * "which pane" a public input of `pane.derive` — a third property on a record the palette already
   * cannot prompt for, and a value the AI tool would have to invent — to say something the focus
   * already says. The menu moves the focus to the pane it is a menu of, which is what a pointer
   * gesture on that pane does anyway, and all three verbs then agree with the row.
   */
  pane: string;
  /** The `requires` sentence, or null when the row can run. */
  disabled: string | null;
}

/**
 * The rows, built from the registry and from {@link presetRefusal} — one per projection, one per
 * declared breakpoint, then the two exits.
 *
 * Exported because it is the whole content of the menu and it is a pure function of the pane: the
 * widget is untestable in a DOM with no layout, and this is not.
 *
 * @param {string} paneId
 * @returns {PresetRow[]}
 */
export function presetRows(paneId: string): PresetRow[] {
  const registry = activeRegistry();
  const tab = tabOfPane(paneId);
  const derived = derivationOfPane(paneId);
  /* {@link deriveRefusal}, not `registry.disabledReason("pane.derive")`.
     The registry resolves its context from the FOCUS, so a menu built for a pane it was handed by
     name got the answer for whichever pane the keyboard happened to be in: the same pane's rows
     read "enabled" or "an open document in a pane that is not itself derived" depending on where
     the author had last clicked. `scripts/check-pane-singletons.ts` rule 4 could not see it — the
     focus read was a method call on a registry value, dispatched by a string id into a closure in
     another module. It counts `disabledReason` and `isEnabled` themselves as focus reads now,
     which names the shape without pretending to follow the dispatch. */
  const deriveReason = deriveRefusal(paneId);
  const rows: PresetRow[] = [];
  for (const preset of DERIVE_PRESETS) {
    if (preset === "breakpoint" || preset === "locale") {
      continue;
    }
    rows.push({
      args: { preset },
      command: "pane.derive",
      disabled: deriveReason ?? presetRefusal(preset, paneId, null),
      label: PRESET_LABELS[preset],
      pane: paneId,
    });
  }
  // "Same page at ⟨breakpoint⟩" — one row per breakpoint the document declares, because the item IS
  // The command and a submenu would be a second control between the author and it.
  for (const media of tab && !derived ? declaredMedia(tab) : []) {
    rows.push({
      /* BASE omits `media` rather than passing `""`. `optionalStringArg` refuses an empty string
         by design — "present but blank" is the shape that hides a missing value — so the base row
         has to say nothing rather than say nothing loudly. Caught by opening the menu in a real
         browser: every row ran, and the base one threw `expected a non-empty string, got ""`. */
      args: media === null ? { preset: "breakpoint" } : { media, preset: "breakpoint" },
      command: "pane.derive",
      disabled: deriveReason ?? presetRefusal("breakpoint", paneId, media),
      label: `${PRESET_LABELS.breakpoint} ${media ? mediaDisplayName(media) : "Base"}`,
      pane: paneId,
    });
  }
  /* "Same page in ⟨language⟩" — one row per locale the PROJECT declares, in the same shape as the
     breakpoint rows above and with one difference: there is no omit-the-argument row. A breakpoint
     has a base size that is spelled by saying nothing; every locale is a real tag, including the
     default one, whose file `translationPathFor` puts at the unprefixed path under
     `prefix-except-default`. The label is the locale's own AUTONYM — "français", not "French" —
     because that is what the person looking for their language scans a list for.
     A project that declares no `i18n` block at all contributes no rows: `getEffectiveLocales()`
     answers null, and the menu is the same menu it has always been. One that declares exactly one
     locale gets its one row carrying {@link presetRefusal}'s sentence, which names Project
     Settings › Locales — the author asked for languages, so the answer is where to add the second
     one rather than silence. */
  for (const locale of tab && !derived ? (getEffectiveLocales()?.locales ?? []) : []) {
    rows.push({
      args: { locale, preset: "locale" },
      command: "pane.derive",
      disabled: deriveReason ?? presetRefusal("locale", paneId, null, locale),
      label: `${PRESET_LABELS.locale} ${localeLabel(locale)}`,
      pane: paneId,
    });
  }
  /* The two exits, and the reason only ONE of them takes a pane.
     `pane.pin`'s subject is the grid's derived pane — the author reaches it from the palette while
     the keyboard is in the page they are editing — and {@link pinRefusal} answers about a named
     pane without reading the focus, so the menu can ask it about its own. `pane.unsplit`'s
     enablement is `workspace.panes.length > 1`, a fact about the grid with no pane in it at all;
     its `requires` is data on the record and the boolean is the same from anywhere. Its RUN is a
     focus read, like `pane.derive`'s — which is what {@link PresetRow.pane} is for. */
  const exits: [string, string | null][] = [
    ["pane.pin", pinRefusal(paneId)],
    [
      "pane.unsplit",
      workspace.panes.length > 1 ? null : (registry?.get("pane.unsplit")?.requires ?? null),
    ],
  ];
  for (const [id, disabled] of exits) {
    const command = registry?.get(id);
    if (command) {
      rows.push({ args: {}, command: id, disabled, label: command.title, pane: paneId });
    }
  }
  return rows;
}

// ─── The projection ──────────────────────────────────────────────────────────

/**
 * Everything one pane's chrome draws, as words and keyed rows.
 *
 * There is no takeover branch. Opening a function body or a formula reveals the dock's Logic tab
 * (P8) and leaves the canvas standing underneath it, so the axes still describe the document on the
 * stage and the zoom pod still has something to zoom. Suppressing them while the dock was open
 * removed the controls for the very document the reader could still see.
 *
 * **There is no breadcrumb either.** The address is ⑥'s job — `panels/jump-bar.ts`, one row above —
 * and the Logic tab's own header carries the Close. This bar drew a second Back and a second trail
 * beside both of them.
 */
function viewFor(tab: Tab, paneId: string, ctx: PaneContextCtx): PaneContextView {
  /* A LENS suppresses the two axes that WRITE. Editor kind and Canvas view both land in
     `ctx.setCanvasMode(tab, …)`, and that tab belongs to the pane beside this one — so a control
     drawn in the lens would flip the document the author is editing. The lens's own mode is the
     derivation, chosen when it was created and changed by re-deriving. The Context axis stays as
     a static summary for the same reason (it writes `updateUi(tab, …)`), and the zoom pod stays
     because zoom is the one view fact a lens genuinely owns. */
  const lens = derivationOfPane(paneId)?.kind === "lens";
  const readOnly = collabState(tab).active && collabState(tab).readOnly;
  const view: PaneContextView = {
    ...baseView(paneId),
    /* …and NO ⟲ trigger in a lens. Every projection row in the menu it opens is permanently
       disabled from there (a derived pane cannot derive again) and the breakpoint rows are
       suppressed outright, leaving one live row — Unsplit — which the derivation chip's ✕ in this
       pane's own strip already runs. A control that can do nothing from where it is drawn is the
       class this phase has deleted three times. A COMPANION keeps it: "Keep This Document" is live
       there and it is genuinely about that pane. The leading slot stays either way: it is what
       pushes the axes right, and dropping it would move the one control a lens does draw. */
    presetState: lens ? "hidden" : "shown",
    /* A lens draws no banner: the projection would be announcing a collaboration session it is not
       in, twice on one screen, about a document it does not own. */
    bannerState: !lens && readOnly ? "shown" : "hidden",
    barMode: lens ? "lens" : "full",
    ...podFor(tab, paneId),
  };
  if (lens) {
    view.summary = lensSummary(paneId);
    return view;
  }
  Object.assign(view, editorAxis(tab));
  if (editorKindOf(tab) === "canvas") {
    Object.assign(view, viewAxis(tab));
  }
  Object.assign(view, contextAxis(tab, paneId, ctx));
  /* THIS tab's effective mode. `ctx.getCanvasMode()` answered for the focused pane, so a document
     opened as Code in either pane put an Export button in the OTHER pane's bar as well — over a
     document that is not the one the button exports. */
  view.exportState = canvasModeOfTab(tab) === "source" ? "shown" : "hidden";
  return view;
}

/**
 * The projection before any axis has spoken: the two regions, and everything else absent.
 *
 * The empty shape comes from the SURFACE — one list of fields, beside the interface that declares
 * them — because two hand-kept copies of a 36-field record is exactly how a new field ends up
 * projected in one place and forgotten in the other.
 */
function baseView(paneId: string): PaneContextView {
  return {
    ...emptyPaneContextView(),
    contextRegion: paneRegion(paneId, "context"),
    zoomRegion: paneRegion(paneId, "zoom"),
  };
}

/**
 * A lens's rendering context, stated rather than offered.
 *
 * Open question 1, answered "keep it, read-only": a lens drawn under different preview params than
 * the pane it is a lens OF would be lying about what it is a lens of, so the summary has to be on
 * screen — but the popover behind it writes the source tab's `session.ui`, which is the one thing a
 * lens must never do.
 */
function lensSummary(paneId: string): string {
  /* No `ctx.parseMediaEntries` here. It parsed the document's whole `$media` map, discarded the
     result through `void sizeBreakpoints` and printed the media NAME — a parse per lens-bar render
     for a value that was never read. `mediaDisplayName` is the only lookup this line needs. */
  /* {@link activeMediaOfPane}, and it exists for exactly this. `session.ui.activeMedia` is per-TAB
     and a lens shares its tab with the pane beside it, so this axis printed the breakpoint the
     SOURCE pane was on: the stage drew the Tablet artboard and the line under it said "Base". The
     docstring above says a lens drawn under different params "would be lying about what it is a
     lens of" — and it lied about the one axis the preset is named after. */
  const media = activeMediaOfPane(paneId);
  /* A lens shares its TAB, so it renders under the tab's preview locale whether it asked to or not
     — and a lens whose stage is mirrored while its own line says nothing is the same lie about the
     rendering context this summary exists to prevent. Stated only when it differs from the
     document's own language, for the reason the trigger beside it is: a pane drawing the file it
     has open in the language that file is written in has nothing to report. */
  const locale = localeOf(tabOfPane(paneId));
  return `${media ? mediaDisplayName(media) : "Base"}${
    locale?.overridden ? ` · ${localeLabel(locale.effective)}` : ""
  }`;
}

// ─── Axis 1 · Editor kind ────────────────────────────────────────────────────

function editorAxis(tab: Tab): Partial<PaneContextView> {
  /* What the DOCUMENT declares, and nothing else. This read `hostableKindsOf` — the declared kinds
     narrowed by what the tab's pane was allowed to host — so a page in the side pane was offered
     Code and not Design. The pane cap is gone; a control that cannot go anywhere is still the
     defect this axis exists to remove, and one declared kind still renders as text. */
  const kinds = editorKindsOf(tab);
  const current = editorKindOf(tab);
  if (kinds.length < 2) {
    // One kind is not a choice. Rendering it as a dropdown would be a control that cannot move —
    // Which is the defect this axis exists to remove, in miniature.
    return { editorLabel: EDITOR_KIND_LABELS[current], editorMode: "static" };
  }
  return {
    editorMode: "picker",
    editorOptions: kinds.map((kind) => ({ label: EDITOR_KIND_LABELS[kind], value: kind })),
    editorValue: current,
  };
}

// ─── Axis 2 · Canvas view ────────────────────────────────────────────────────

function viewAxis(tab: Tab): Partial<PaneContextView> {
  // Every pane draws a live Canvas, so this is no longer narrowed by WHERE the tab is — only by
  // What the document declares. A document with no Canvas view still draws no view group.
  const views = canvasBaseViewsFor(tab);
  if (views.length === 0) {
    return {};
  }
  const current = canvasBaseViewOf(tab);
  const preview = previewStateOf(tab);
  /*
   * TWO CONTROLS, because they are two axes.
   *
   * `Edit │ Design │ Preview` was one three-way radio, and it lied about the state it was showing:
   * preview is stored as a flag OVER an edit/design base, so while it was on the radio could not
   * say which mode you were previewing — or which one Escape would return you to. Now the radio
   * marks the base the whole time and the toggle sits beside it, pressed.
   */
  return {
    previewHint: preview.on
      ? `Stop previewing — back to ${CANVAS_VIEW_LABELS[current ?? "edit"]}`
      : "Preview: the page as it ships, with editing off",
    previewOn: preview.on,
    previewState: preview.available ? "shown" : "hidden",
    views: views.map((value) => ({
      checked: value === current ? "true" : "false",
      hint: `Show this document in ${CANVAS_VIEW_LABELS[value]}`,
      key: value,
      label: CANVAS_VIEW_LABELS[value],
      value,
    })),
    viewState: "shown",
  };
}

// ─── Axis 3 · Rendering context ──────────────────────────────────────────────

/** Whether the open document is a page of a site project — pages get route params, others props. */
function isPageDoc(tab: Tab): boolean {
  const path = tab.documentPath;
  return Boolean(
    path &&
    projectState?.isSiteProject &&
    (path.startsWith("pages/") || path.startsWith("./pages/")),
  );
}

/** What a pane is rendering AS, once — the trigger, the popover and the lens summary all ask this. */
interface PaneLocale {
  /** The project's declared locales, default first. */
  i18n: ResolvedI18n;
  /** The locale of the FILE this pane has open, when its directory names one — `pages/fr/…`. */
  pathLocale: string | null;
  /** The tag the artboard is drawn under. */
  effective: string;
  /** Whether that is not the document's own language, i.e. whether the bar has something to say. */
  overridden: boolean;
}

/**
 * The language axis for a tab, or `null` when the project has no language question to ask.
 *
 * Called at PROJECTION time and never cached: `projectState` is replaced wholesale rather than
 * mutated, so a locale added in Settings reaches this bar on the next paint and a module-level copy
 * would still be describing the project that was open when this file loaded.
 *
 * A single declared locale is the same as none for this control — there is nothing to switch TO,
 * and "groups a document declares nothing for are absent" is the rule the whole popover follows.
 *
 * The fallback chain is what makes the control honest about a file it has not been told about:
 * `previewLocale` is the author's explicit choice, the path is the file's own language (§13.3 puts
 * a translation in its own directory), and the default locale is what an unprefixed page renders
 * as.
 */
function localeOf(tab: Tab | null): PaneLocale | null {
  const i18n = getEffectiveLocales();
  if (!tab || i18n === null || i18n.locales.length < 2) {
    return null;
  }
  const pathLocale = localeOfPath(tab.documentPath ?? "", i18n);
  const own = pathLocale ?? i18n.defaultLocale;
  const effective = tab.session.ui.previewLocale ?? own;
  return { effective, i18n, overridden: effective !== own, pathLocale };
}

function contextAxis(tab: Tab, paneId: string, ctx: PaneContextCtx): Partial<PaneContextView> {
  const { ui } = tab.session;
  const { featureQueries, sizeBreakpoints } = ctx.parseMediaEntries(
    getEffectiveMedia(tab.doc.document?.$media as Record<string, string> | undefined),
  );
  const schemeQueries = featureQueries.filter(({ query }) => isSchemeQuery(query));
  const plainQueries = featureQueries.filter(({ query }) => !isSchemeQuery(query));
  const scheme = (ui.previewColorScheme ?? "auto") as string;
  const activeMedia = (ui.activeMedia ?? null) as string | null;
  const sizeLabel = activeMedia ? mediaDisplayName(activeMedia) : "Base";
  const schemeLabel = SCHEMES.find(([value]) => value === scheme)?.[1] ?? "Auto";
  const locale = localeOf(tab);
  /* The language joins the trigger ONLY when the pane is not drawing the document's own — a French
     page open in a French pane is not a rendering context worth three more characters, and a bar
     that grew a third term in every multilingual project would stop reading as a state. */
  const contextSummary = [
    sizeLabel,
    schemeQueries.length > 0 ? schemeLabel : null,
    locale?.overridden ? localeLabel(locale.effective) : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  const hasLayout = isPageDoc(tab) && Boolean(getEffectiveLayoutPath(tab.doc.document?.$layout));
  const page = isPageDoc(tab);
  const params = page ? paramRows(tab) : [];
  const props = page ? [] : propRows(tab, paneId);
  /* How many of those fields carry a value. The trigger has to say something true at a glance, the
     way the Context trigger says `Base · Auto` — a chevron with no reading is a control you have to
     open in order to learn whether it was worth opening. */
  const resolvingSet = page
    ? Object.values(ui.previewParams ?? {}).filter((v) => v !== "" && v !== undefined).length
    : Object.keys(ui.previewProps ?? {}).length;
  const hasResolving = page ? params.length > 0 : props.length > 0;

  return {
    contextSummary,
    featureState: plainQueries.length > 0 ? "shown" : "hidden",
    features: plainQueries.map(({ name, query }) => ({
      hint: query,
      key: name,
      label: mediaDisplayName(name),
      selected: Boolean(ui.featureToggles[name]),
      value: name,
    })) satisfies PaneContextToggle[],
    layoutOn: ui.showLayout !== false,
    layoutState: hasLayout ? "shown" : "hidden",
    ...localeGroup(locale),
    params,
    props,
    resolvingKind: page ? "params" : "props",
    resolvingLabel: resolvingSet > 0 ? `${resolvingSet} set` : "Defaults",
    resolvingState: hasResolving ? "shown" : "hidden",
    schemes: SCHEMES.map(([value, label, hint]) => ({
      checked: scheme === value ? "true" : "false",
      hint,
      key: value,
      label,
      value,
    })) satisfies PaneContextChoice[],
    schemeState: schemeQueries.length > 0 ? "shown" : "hidden",
    sizes: sizeRows(sizeBreakpoints, activeMedia),
  };
}

/**
 * The size segment: the base width plus every declared size breakpoint.
 *
 * It writes `ui.activeMedia`, the same field a canvas panel header click writes — one axis, one
 * field, two ways in. The base is the empty string on the wire, because that is what "no breakpoint
 * applied" is: `canvas.setBreakpoint` reads it back as `null`.
 */
function sizeRows(
  breakpoints: { name: string; width: number }[],
  activeMedia: string | null,
): PaneContextChoice[] {
  return [
    {
      checked: activeMedia === null ? "true" : "false",
      hint: "The base rendering, with no breakpoint applied",
      key: "--base",
      label: "Base",
      value: "",
    },
    ...breakpoints.map(({ name, width }) => ({
      checked: activeMedia === name ? ("true" as const) : ("false" as const),
      hint: `${mediaDisplayName(name)} — ${width}px`,
      key: name,
      label: mediaDisplayName(name),
      value: name,
    })),
  ];
}

/**
 * The language segment: which of the project's locales this pane renders AS.
 *
 * It is one radio group and one sentence, and the sentence is the load-bearing half. Jx has no
 * message catalogue — a translation is a different file in a different directory — so this control
 * cannot and must not claim to translate the page. What it does change is real: the artboard's
 * `lang` and its `dir`, and an RTL locale mirrors the layout on the stage. A control that let an
 * author believe it had translated anything would be worse than no control — which is also why the
 * sentence stops there: the build's `$page.locale` is not injected into the canvas render today, so
 * a tooltip promising it would be describing the site rather than the pane.
 *
 * Labelled with each locale's AUTONYM, for the reason `localeLabel` gives: a reader looking for
 * their own language scans for their own word for it.
 *
 * The document's own language is named in its tooltip rather than styled apart — a per-pane axis
 * has no room for a second visual state, and the author needs to know which entry is "no override"
 * before clicking, not after.
 */
function localeGroup(locale: PaneLocale | null): Partial<PaneContextView> {
  if (!locale) {
    return { localeState: "hidden" };
  }
  return {
    localeHint:
      "The language this pane renders as — its lang and direction only. The text is whatever file is open.",
    locales: locale.i18n.locales.map((tag) => ({
      checked: locale.effective === tag ? "true" : "false",
      hint:
        tag === locale.pathLocale
          ? `${localeLabel(tag)} — the language of the file this pane has open`
          : `Render as ${localeLabel(tag)} (${tag})`,
      key: tag,
      label: localeLabel(tag),
      value: tag,
    })),
    localeState: "shown",
  };
}

// ─── ⑩ The floating zoom pod ─────────────────────────────────────────────────

/** The fit entries the pod offers, in menu order. `1` is "actual size", a numeric fit. */
const FIT_CHOICES: readonly { value: string; fit: FitMode; label: string }[] = [
  { fit: "page", label: "Fit page", value: "page" },
  { fit: "width", label: "Fit width", value: "width" },
  { fit: 1, label: "Actual size", value: "actual" },
  { fit: "none", label: "No fit", value: "none" },
];

/** Which entry the pod shows as chosen — a numeric fit reads as "actual size" only at 1. */
function fitChoiceValue(fit: FitMode): string {
  if (typeof fit === "number") {
    return fit === 1 ? "actual" : "";
  }
  return fit;
}

/** The modes whose stage is the panzoom surface — the only ones with a fit to state. */
const STAGE_ZOOM_MODES = new Set(["design", "stylebook", "git-diff"]);

/**
 * Zoom and fit, floating over the canvas bottom-right.
 *
 * Two surfaces, one control: `edit` drives the content-reflow `editZoom`, while design / Stylebook
 * / git-diff render on the panzoom surface and drive `ui.zoom` — and only the panzoom surface has a
 * fit, because a fit is a statement about an artboard. Preview is deliberately absent: its frame is
 * a real viewport that scrolls its own document, so there is nothing to zoom.
 */
function podFor(tab: Tab, paneId: string): Partial<PaneContextView> {
  /* THIS pane's mode. `ctx.getCanvasMode()` answers for the focused pane, so the unfocused pod
     offered an `editZoom` control over a stage drawing Design — and hid the fit that stage has. */
  const mode = canvasModeOfPane(paneId);
  /* And THIS pane's stage. Every zoom verb below takes a surface: without one they all defaulted to
     `activeCanvasSurface()`, so the side pane's `+` magnified the primary's document by a factor
     computed from the side pane's own zoom, and its "100%" button reset the primary. */
  const surface = surfaceForPane(paneId);
  if (mode === "edit") {
    const editZoom = tab.session.ui.editZoom ?? 1;
    return { podState: "shown", zoomLabel: `${Math.round(editZoom * 100)}%` };
  }
  if (!STAGE_ZOOM_MODES.has(mode)) {
    return { podState: "hidden" };
  }
  const zoom = stageZoom(surface);
  return {
    fitOptions: FIT_CHOICES.map(({ label, value }) => ({ label, value })),
    fitState: "shown",
    fitValue: fitChoiceValue(getFit(surface)),
    podState: "shown",
    zoomLabel: `${Math.round(zoom * 100)}%`,
  };
}

// ─── What the controls do ────────────────────────────────────────────────────

/**
 * Run a rendering-context verb through the registry.
 *
 * These four controls wrote `session.ui` directly through `updateUi`, which is why none of the
 * three axes was a command: the popover WAS the capability, and the palette, the assistant and
 * `__jxAutomation` had no name for it. Going through the registry makes the control and the verb
 * one thing (§2, principle 1) and gets the breakpoint refusal for free.
 */
function runContextCommand(paneId: string, id: string, args: Record<string, unknown>): void {
  // THIS pane, named. The bar is drawn once per pane and the side bar's controls write the side
  // Pane's tab; a verb defaulting to the focused pane would have made the side bar edit the
  // Foreground document the moment its control became a command.
  void activeRegistry()?.run(id, { ...args, pane: paneId });
}

/**
 * Every gesture the pane's chrome offers, bound to the pane it is drawn for.
 *
 * Built once per mount rather than per projection: the document holds these by reference, and a new
 * closure on every paint would replace a listener the reader may be mid-press on.
 */
function actionsFor(paneId: string, ctx: PaneContextCtx): PaneContextActions {
  /** The tab this pane is drawing, at the moment the gesture happens rather than when it was drawn. */
  const tabNow = (): Tab | null => tabOfPane(paneId);
  return {
    chooseEditor: (kind) => {
      const tab = tabNow();
      if (!tab) {
        return;
      }
      const mode = modeForEditorKind(tab, kind as EditorKind);
      if (!mode) {
        return;
      }
      tab.session.ui.preview = false;
      ctx.setCanvasMode(tab, mode);
    },
    chooseFit: (value) => {
      const choice = FIT_CHOICES.find((entry) => entry.value === value);
      if (!choice) {
        return;
      }
      const surface = surfaceForPane(paneId);
      // "Fit page" from the control may magnify a small artboard past life size; the fit APPLIED
      // On arrival never does. Same declared state, two caps — see fitToScreen's maxZoom.
      if (choice.fit === "page") {
        fitToScreen({ surface });
        return;
      }
      setFit(choice.fit, surface);
    },
    chooseView: (value) => {
      const tab = tabNow();
      if (tab) {
        setCanvasView(tab, value as CanvasView, ctx.setCanvasMode);
      }
    },
    exportFile: ctx.exportFile,
    manageContexts: () => {
      void activeRegistry()?.run("settings.open", { section: "contexts" });
    },
    openPresetMenu: (anchor) => {
      openPresetMenu(paneId, anchor);
    },
    setBreakpoint: (media) => {
      // The base row's value is the empty string, which the command reads back as "no breakpoint".
      runContextCommand(paneId, "canvas.setBreakpoint", { media: media === "" ? null : media });
    },
    setLocale: (locale) => {
      runContextCommand(paneId, "i18n.switchLocale", { locale });
    },
    setParam: (name, value) => {
      // Through the registry, like every control in the popover beside this one.
      runContextCommand(paneId, "canvas.setRouteParam", { name, value });
    },
    setProp: (name, raw) => {
      // The command owns the write; this control owns only the parse, because "what a typed string
      // Means" is a fact about a text field and not about the value.
      runContextCommand(paneId, "canvas.setTestProp", {
        name,
        value: raw === "" ? null : parsePropValue(raw),
      });
    },
    setScheme: (scheme) => {
      runContextCommand(paneId, "canvas.setColorScheme", { scheme });
    },
    toggleFeature: (name) => {
      const tab = tabNow();
      if (tab) {
        updateUi(tab, "featureToggles", {
          ...tab.session.ui.featureToggles,
          [name]: !tab.session.ui.featureToggles[name],
        });
      }
    },
    toggleLayout: () => {
      runContextCommand(paneId, "canvas.setLayoutVisible", {
        visible: tabNow()?.session.ui.showLayout === false,
      });
    },
    togglePreview: () => {
      const tab = tabNow();
      if (!tab) {
        return;
      }
      const preview = previewStateOf(tab);
      const current = canvasBaseViewOf(tab);
      setCanvasView(tab, preview.on ? (current ?? "edit") : "preview", ctx.setCanvasMode);
    },
    zoomIn: () => {
      const tab = tabNow();
      const surface = surfaceForPane(paneId);
      if (canvasModeOfPane(paneId) === "edit") {
        setEditZoom((tab?.session.ui.editZoom ?? 1) * 1.2, surface);
        return;
      }
      setUserZoom(stageZoom(surface) * 1.2, surface);
    },
    zoomOut: () => {
      const tab = tabNow();
      const surface = surfaceForPane(paneId);
      if (canvasModeOfPane(paneId) === "edit") {
        setEditZoom((tab?.session.ui.editZoom ?? 1) / 1.2, surface);
        return;
      }
      setUserZoom(stageZoom(surface) / 1.2, surface);
    },
    zoomReset: () => {
      const surface = surfaceForPane(paneId);
      if (canvasModeOfPane(paneId) === "edit") {
        setEditZoom(1, surface);
        return;
      }
      resetZoom(surface);
    },
  };
}

// ─── The resolving-with popover's open state ─────────────────────────────────

/**
 * Whether this pane's resolving popover is open. Exported for the tests.
 *
 * The MOUNT owns the answer, not this module: the panel is a `jx-popover` in that pane's document
 * and the platform can close it without telling anyone (a light dismiss, an Escape, a second panel
 * taking the top layer). The handle mirrors the platform's own `toggle`, so a pane with no chrome —
 * no tab, or Project Settings — is closed by definition.
 */
export function isResolvingOpen(paneId: string): boolean {
  return _surfaces.get(paneId)?.isResolvingOpen() ?? false;
}

/**
 * Open or close it.
 *
 * A named end state rather than a toggle, so `canvas.setResolvingOpen { open: false }` means the
 * same thing twice and a screenshot can photograph it (§13's R1).
 *
 * It writes the panel and does NOT re-project the bar. A popover moves into the top layer while it
 * is open; nothing about the bar changes when it does, and the only thing the bar redraws for is
 * the trigger's summary, which changes when a VALUE changes and already projects.
 */
export function setResolvingOpen(paneId: string, open: boolean): void {
  // Asked through {@link isResolvingOpen}, so "is it already what you are asking for" has one
  // Answer in this module rather than one here and another in the mount.
  if (isResolvingOpen(paneId) === open) {
    return;
  }
  _surfaces.get(paneId)?.setResolvingOpen(open);
}

/** Forget the mounted chrome — a fresh window, and the tests. */
export function resetResolvingOpen(): void {
  for (const surface of _surfaces.values()) {
    surface.dispose();
  }
  _surfaces.clear();
}

// ─── Dynamic route-param pickers ─────────────────────────────────────────────
// Candidate values load asynchronously (ContentCollection resolution / data-file read); the module
// Caches the last result per (documentPath, $paths) and re-projects when it lands — the same lazy
// Fill pattern as head-panel's loadLayoutEntries. When values arrive, any param without a chosen
// Value auto-selects the first candidate (matching the compiler, whose first expanded route is the
// First path entry).

/**
 * Candidate values per `(documentPath, $paths)` key, and the keys whose load is in flight.
 *
 * **A Map, not one slot, and that is a livelock fix rather than a cache-size preference.** It was
 * `_paramValues` + `_paramValuesKey`, holding exactly ONE result, while {@link render} loops every
 * attached pane. Two panes on documents with different keys evicted each other on every pass: pane
 * A's projection stored A's key and cleared the value, pane B's in the same loop stored B's, and
 * whichever load landed found its key gone — or, once the "still shown somewhere" guard let it
 * through, stored its value and called `render()`, which re-issued both loads again. An unbounded
 * microtask chain: no rAF, no paint, no input. `⌘\` with two pages under dynamic routes was enough,
 * and the probe never returned.
 *
 * `_paramLoading` is what stops a re-projection re-issuing a load that has not landed yet; the
 * value map is what stops one pane's answer erasing the other's.
 */
const _paramValues = new Map<string, ParamValues>();

const _paramLoading = new Set<string>();

/** Drop every cached candidate list — a project switch, and the tests. */
export function resetParamValues(): void {
  _paramValues.clear();
  _paramLoading.clear();
}

/**
 * @param {Tab} tab
 * @returns {ParamValues | null} — null while loading (or when the doc declares no params)
 */
function paramValuesFor(tab: Tab): ParamValues | null {
  const pathsDef = pagePathsDef({
    document: tab.doc.document,
    frontmatter: tab.doc.content.frontmatter,
  });
  if (!pathsDef && dynamicRouteParams(tab.documentPath).length === 0) {
    return null;
  }
  const key = `${tab.documentPath ?? ""}::${JSON.stringify(pathsDef)}`;
  const cached = _paramValues.get(key);
  if (cached) {
    return cached;
  }
  if (_paramLoading.has(key)) {
    return null;
  }
  _paramLoading.add(key);
  void loadParamValues(tab.documentPath, pathsDef).then((values) => {
    _paramLoading.delete(key);
    /* Still SHOWN somewhere, rather than still focused. The candidate values fill a picker in one
       pane's bar; a load that landed while the keyboard was in the other pane used to be discarded,
       leaving the picker permanently empty for whoever was not looking at it. */
    if (!workspace.panes.some((pane) => pane.activeTabId === tab.id)) {
      return;
    }
    _paramValues.set(key, values);
    autoSelectParams(tab, values);
    render();
  });
  return null;
}

/**
 * @param {Tab} tab
 * @param {ParamValues} values
 */
function autoSelectParams(tab: Tab, values: ParamValues) {
  const current = tab.session.ui.previewParams ?? {};
  const additions: Record<string, string> = {};
  for (const [name, list] of Object.entries(values)) {
    if (!current[name] && list.length > 0) {
      additions[name] = list[0]!;
    }
  }
  if (Object.keys(additions).length > 0) {
    updateUi(tab, "previewParams", { ...current, ...additions });
  }
}

/**
 * One picker per route param the document declares, in the order the path names them.
 *
 * @param {Tab} tab
 */
function paramRows(tab: Tab): PaneContextView["params"] {
  const values = paramValuesFor(tab);
  const names = new Set(dynamicRouteParams(tab.documentPath));
  for (const name of Object.keys(values ?? {})) {
    names.add(name);
  }
  const { previewParams } = tab.session.ui;
  return [...names].map((name) => ({
    key: name,
    label: `Preview value for [${name}]`,
    name,
    options: (values?.[name] ?? []).map((value: string) => ({ label: value, value })),
    value: previewParams?.[name] ?? "",
  }));
}

// ─── Component test-prop fields ──────────────────────────────────────────────
// The previewParams mirror for component docs: one small field per prop entry (the doc's
// Plain-data state entries), committed on change so typing never re-projects the bar mid-edit. A
// Value parses as JSON when it can (numbers, booleans, arrays) and falls back to the raw string;
// Clearing a field removes the override so the prop returns to its authored default.

/**
 * @param {string} raw
 * @returns {JsonValue}
 */
function parsePropValue(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

/**
 * @param {Tab} tab
 * @param {string} paneId
 */
function propRows(tab: Tab, paneId: string): PaneContextView["props"] {
  const doc = tab.doc.document;
  if (!isComponentDoc(doc)) {
    return [];
  }
  const { previewProps } = tab.session.ui;
  const display = (v: JsonValue | undefined) =>
    v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v);
  return componentPropEntries(doc).map(({ name }) => ({
    key: name,
    label: `Test value for ${name}`,
    name,
    region: paneRegion(paneId, `prop:${name}`),
    value: display(previewProps?.[name]),
  }));
}
