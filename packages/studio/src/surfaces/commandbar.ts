/// <reference lib="dom" />
/**
 * The Command Bar — region ① of studio-ui-guidelines §6, rendered FROM the registry, as a document.
 *
 * `surfaces/commandbar.json` is the band; this module is its adapter. Every control in the band is
 * a command, so what the document is handed is a PROJECTION of the registry rather than a list of
 * buttons: `primary` is `forPlacement("commandbar/primary")` (capped at five by
 * `scripts/check-chrome-budget.ts`), `docks` is the three dock records with the shell's state
 * beside them, `layouts` is the project's own layout record, and the ⬢ Studio menu is
 * `forPlacement("commandbar/overflow")` opened on the `menu` surface. With no project open the same
 * document renders; the records' own `when` clauses empty it (§2 principle 4: enablement is a
 * predicate with a sentence, never a second template).
 *
 * What is decided here, and nowhere in the document:
 *
 * - {@link commandTooltip}: the title, plus its chord formatted for THIS platform by `keymap.format`,
 *   or plus the `requires` sentence when the record is off — so no control is ever permanently dead
 *   with no explanation.
 * - The **Command Center pill** (①a) is the app's address bar: `◈ project › document › selection`,
 *   right-aligned ⌘K, each segment opening the palette pre-scoped. It gives Studio a persistent
 *   project name — the desktop titlebar is `titleBarStyle:"hidden"`.
 * - The window controls, which are the one thing in the band that is not an action, and whose ORDER
 *   is the platform's.
 *
 * **Retired, with a name, a chord and a residue** (§2 principle 9): Open Project + New Project +
 * recents → the pill and `Project: Open Recent…`; `Manage` → `File: Browse Library`; `Publish` →
 * the `Publish:` family; `Sync Project` → Source Control. The five-mode switcher lives in the pane
 * context bar and is reachable as `View: Set Canvas Mode` in the palette.
 *
 * @docs studio/interface
 */

import { presenceProjection } from "../collab/presence-chips";
import { effect, effectScope, reactive } from "../reactivity";
import { activeTab } from "../workspace/workspace";
import { primarySelection } from "../tabs/selection";
import { shell } from "../shell";
import { openQuickSearch } from "../panels/quick-search";
import { showPromptDialog } from "../ui/layers";
import { getPlatform, hasPlatform } from "../platform";
import { getPreviewNavigateHandler } from "../canvas/preview-navigate";
import { armPreviewOverlay, flushPreviewOverlay } from "../preview/preview-overlay";
import { documentUrlPattern, dynamicRouteParams } from "../page-params";
import { getNodeAtPath, nodeLabel, projectState } from "../store";
import { activeRegistry } from "../commands/active-registry";
import { notify } from "../services/notify";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import { openMenu } from "./menu";
import commandbarDoc from "./commandbar.json";
import type { PresenceProjection } from "../collab/presence-chips";
import type { MenuHandle, MenuRowProjection } from "./menu";
import type { SurfaceHandle } from "../ui/surface";
import type { Tab } from "../tabs/tab";
import type { SiteBuildResult, SitePreviewResult, StudioPlatform } from "../types";
import type { CommandRegistry } from "../commands/registry";
import type { EffectScope } from "@vue/reactivity";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("commandbar", commandbarDoc as unknown as JxDocument);

/**
 * What the Command Bar is handed at mount.
 *
 * HANDOFF: **nothing here is read any more** — every control in the band is a command, so the bar
 * asks the registry rather than the bootstrap. The fields stay declared, and optional, so
 * `studio.ts`'s `toolbarPanel.mount(toolbarEl, { … })` object literal keeps type-checking, and the
 * shell tests keep driving the canvas-mode seam through it; deleting them is one edit in that
 * file.
 */
export interface ToolbarCtx {
  openProject?: () => void;
  openFile?: (path: string) => void;
  saveFile?: () => void;
  getCanvasMode?: () => string;
  setCanvasMode?: (tab: Tab | null, mode: string) => void;
  renderCanvas?: () => void;
  safeRenderRightPanel?: () => void;
  openRecentProject?: (root: string) => Promise<void>;
  closeFunctionEditor?: () => void;
}

/** Test override for the mac CSD layout — happy-dom forbids redefining navigator.platform. */
let _isMacOverride: boolean | null = null;

/** Force (or restore, with null) the mac/non-mac window-control layout detection. */
export function setMacPlatformForTests(value: boolean | null): void {
  _isMacOverride = value;
}

/** True on macOS — picks the CSD window-control order (close-first, toolbar-leading). */
function isMacPlatform(): boolean {
  return _isMacOverride ?? navigator.platform.startsWith("Mac");
}

// ─── The projections ──────────────────────────────────────────────────────────

/** One command of the primary cluster, as the document draws it. */
export interface PrimaryProjection {
  id: string;
  title: string;
  /** {@link commandTooltip}: the name with its chord, or with why it is off. */
  tooltip: string;
  /** The record's glyph, by its name in the kit's manifest; empty for a labelled button. */
  icon: string;
  hasIcon: boolean;
  disabled: boolean;
}

/** One dock toggle: the record, with the dock's state beside it. */
export interface DockProjection {
  id: string;
  title: string;
  tooltip: string;
  icon: string;
  /** The right-hand dock draws the left-hand glyph mirrored: one shipped shape, two sides. */
  mirror: boolean;
  /** Pressed while the dock is open. */
  selected: boolean;
  disabled: boolean;
}

/** One layout tab. */
export interface LayoutTabProjection {
  id: string;
  name: string;
  active: boolean;
  title: string;
}

/** One segment of the address bar. */
export interface SegmentProjection {
  key: "project" | "document" | "selection";
  label: string;
  title: string;
  /** Every segment but the first is preceded by `›`. */
  sepBefore: boolean;
}

/**
 * Which window-control layout the band draws: none in a browser, mac leading, everything else
 * trailing.
 */
export type WindowControlLayout = "none" | "mac" | "other";

/** The document's scope: the projections, and the host functions its handlers `call`. */
interface CommandBarScope extends Record<string, unknown> {
  csd: WindowControlLayout;
  menuVisible: boolean;
  menuOpen: boolean;
  layoutsVisible: boolean;
  layouts: LayoutTabProjection[];
  segments: SegmentProjection[];
  chord: string;
  hasChord: boolean;
  primary: PrimaryProjection[];
  presenceVisible: boolean;
  presence: PresenceProjection;
  docks: DockProjection[];
  run: (id: string) => void;
  openSegment: (key: SegmentProjection["key"]) => void;
  openPicker: () => void;
  setLayout: (id: string) => void;
  renameLayout: (id: string) => void;
  saveLayout: () => void;
  openStudioMenu: (opener: HTMLElement) => void;
  windowControl: (action: keyof WindowControls) => void;
}

/** What the presence cluster holds while there is nothing to say — the `$switch` hides it. */
const NO_PRESENCE: PresenceProjection = {
  frozen: false,
  label: "",
  peers: [],
  readOnly: false,
  status: "unavailable",
  title: "",
};

/* The window, with THIS dock's rail marked — one shipped glyph per side.

   The pair these replace was `rail-right-open`/`close` under `scaleX(-1)`, because the left-hand
   pair looked absent. Spectrum's two right-hand glyphs were exact mirror images OF EACH OTHER, so
   flipping the wrong member of the pair landed on the other member's appearance — a real, crisp
   arrow pointing the wrong way, looking entirely deliberate. It shipped crossed and nothing could
   see it. Here the glyph is one shape and `mirror` is one boolean, asserted by name.

   State stays where it already was and where it is already asserted: `selected` on the button. */
const DOCKS = [
  { dock: "left", icon: "sidebar-simple", id: "view.toggleNavigator", mirror: false },
  { dock: "right", icon: "sidebar-simple", id: "view.toggleInspector", mirror: true },
  { dock: "bottom", icon: "rows", id: "view.toggleBottomDock", mirror: false },
] as const;

/** The palette mode each segment of the address opens. */
const SEGMENT_MODES = { document: "files", project: "projects", selection: "nodes" } as const;

let _rootEl: HTMLElement | null = null;
let _scope: EffectScope | null = null;
let _state: CommandBarScope | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;
let _menu: MenuHandle | null = null;

/**
 * The tooltip a control shows: the action's name, plus its chord, or plus WHY it is off.
 *
 * One string, three sources, all from the record: `title`, `keymap.formatBinding` and `requires`.
 * `tbBtnTpl(label, onClick, icon)` — the predecessor — could express none of them, which is why
 * "Open in Browser" had to hand-build its own disabled variant with a bespoke reason string.
 */
export function commandTooltip(registry: CommandRegistry, id: string): string {
  const command = registry.get(id);
  if (!command) {
    return "";
  }
  const reason = registry.disabledReason(id);
  if (reason) {
    return `${command.title} — requires ${reason}`;
  }
  const chord = registry.keymap.formatBinding(id);
  return chord ? `${command.title} (${chord})` : command.title;
}

// ─── View: Open in Browser ───────────────────────────────────────────────────

/**
 * Where `View: Open in Browser` would go — the site-relative PATH, not a URL — or the sentence
 * explaining why it cannot go anywhere.
 *
 * A path rather than a URL because the origin is not this command's to know: the built site is
 * served by the backend, on a port of its own, and the build call is what names it.
 */
export type BrowserTarget = { path: string } | { reason: string };

/**
 * Resolve the active document to the ROUTE its built page will be published at.
 *
 * The path mirrors the compiler's own `documentUrlPattern` plus the project's `trailingSlash`
 * setting, so it is the URL every link inside the built site already points at — which is exactly
 * why the reader can then browse from it.
 *
 * Everything that is not a page resolves to a REASON rather than to nothing: a disabled control the
 * user can hover is discoverable, an absent one is not.
 */
export function openInBrowserTarget(tab: Tab | null): BrowserTarget {
  const documentPath = tab?.documentPath?.replace(/^\.\//, "");
  if (!documentPath) {
    return { reason: "Open a page to view it in a browser." };
  }
  if (!projectState?.isSiteProject) {
    return { reason: "This project does not build a site." };
  }
  if (!documentPath.startsWith("pages/")) {
    return { reason: `Only pages have a route — ${documentPath} is not under pages/.` };
  }
  let route = documentUrlPattern(documentPath);
  if (route.includes("*")) {
    return { reason: "Catch-all routes match many pages — open a generated one instead." };
  }
  const params = dynamicRouteParams(documentPath);
  if (params.length > 0) {
    const chosen = (tab?.session.ui.previewParams ?? {}) as Record<string, string>;
    const missing = params.filter((name) => !chosen[name]);
    if (missing.length > 0) {
      const names = missing.map((name) => `:${name}`).join(", ");
      return { reason: `Pick a value for ${names} to open one of this route's pages.` };
    }
    route = route.replaceAll(/:(\w+)/g, (_m, name: string) => encodeURIComponent(chosen[name]!));
  }
  /* The page's URL, not its file's path.
     This used to answer `${origin}/dist${route}/index.html` — the compiler's OUTPUT PATH — and the
     browser then did exactly what a built page's own markup tells it to: a stylesheet at
     `/components/demo.css` and a link to `/basics/counter` are ROOT-absolute, so from a `/dist/…`
     URL the first 404s against the server root and the second leaves the site. Measured before the
     fix: the page 200, its CSS 404, its first link 404. */
  const trailingSlash = projectState.projectConfig?.build?.trailingSlash ?? "always";
  return { path: route === "/" ? "/" : trailingSlash === "always" ? `${route}/` : route };
}

/**
 * Hand a URL to the user's real browser.
 *
 * Reuses the seam the desktop launchers already register for Preview link clicks
 * (`canvas/preview-navigate.ts`), which routes through the OS rather than navigating a webview with
 * no address bar; the browser build falls back to a new tab.
 */
function openUrlExternally(url: string) {
  const override = getPreviewNavigateHandler();
  if (override) {
    override(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Run `View: Open in Browser`, reporting the blocking reason when there is one.
 *
 * Exported as the implementation the bootstrap hands to the record — the ⌘⇧O chord is the record's
 * `keybinding` now, so the bespoke `document.addEventListener("keydown", …)` this file used to
 * install (with its own `isModalOpen()` guard, its own shift test and no way to be rebound) is
 * deleted.
 */
export async function runOpenInBrowser() {
  const target = openInBrowserTarget(activeTab.value ?? null);
  if (!("path" in target)) {
    notify.warn(target.reason, { key: OPEN_IN_BROWSER, source: "Preview" });
    return;
  }
  const platform = hasPlatform() ? getPlatform() : null;
  if (!platform?.previewSite && !platform?.buildSite) {
    notify.warn("This backend cannot preview the site.", {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
    return;
  }

  /* A LIVE preview is what this action is for, and a build is the fallback for a backend that
     cannot do one. The two answer different questions: "what does this page look like at its real
     URL?" wants the tree as it stands, and "does my site build?" is `Build Site`. */
  if (platform.previewSite) {
    await runLivePreview(platform.previewSite, target.path);
    return;
  }
  await runBuiltPreview(platform.buildSite!, target.path);
}

/**
 * Preview the working tree, and open a tab only if one is not already showing this project.
 *
 * The overlay is flushed FIRST, and that ordering is the whole point: the page the author is about
 * to look at should carry the keystroke they just typed, not the one before the debounce.
 */
async function runLivePreview(
  previewSite: NonNullable<StudioPlatform["previewSite"]>,
  path: string,
) {
  armPreviewOverlay();
  await flushPreviewOverlay();
  notify.info("Opening a live preview…", { key: OPEN_IN_BROWSER, source: "Preview" });
  let result: SitePreviewResult;
  try {
    result = await previewSite({ route: path });
  } catch (error) {
    notify.error(`The site could not be previewed: ${errorText(error)}`, {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
    return;
  }
  if (!result.url) {
    notify.warn("This backend serves no preview of the site.", {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
    return;
  }

  /* `reused` is honoured, and honouring it is the feature. A tab already holding this project's
     preview has been pointed at the route; opening another would leave the author with two tabs on
     one project, which is exactly what retargeting the first one exists to prevent. What it costs
     is that the browser does not come forward — no page can raise a background tab, and handing the
     URL to the OS again would open a duplicate rather than switch to it — so the notification says
     where to look. A reader who CLOSED their tab is not stuck here: the stream closes with it, so
     `reused` comes back false and a fresh tab opens without anyone having to ask. */
  if (result.reused) {
    notify.info(`Updated your preview tab — switch to your browser to see ${path}`, {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
    return;
  }

  if (result.errors.length > 0) {
    notify.warn(`Previewed with ${result.errors.length} problem(s): ${result.errors[0]}`, {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
  } else {
    notify.success(
      `Opened a live preview of ${result.routes} page(s) — rendered from your working tree, not a build.`,
      { key: OPEN_IN_BROWSER, source: "Preview" },
    );
  }
  openUrlExternally(`${result.url}${path}`);
}

/**
 * The compiler-backed path, for a backend that declares no live preview.
 *
 * Kept so nothing regresses on a backend that predates `previewSite`: the cloud adapter answers
 * `buildSite` with `mode: "live"` of its own, and `jx dev` answers it with a real build.
 */
async function runBuiltPreview(buildSite: NonNullable<StudioPlatform["buildSite"]>, path: string) {
  notify.info("Building the site…", { key: OPEN_IN_BROWSER, source: "Preview" });
  let result: SiteBuildResult;
  try {
    result = await buildSite();
  } catch (error) {
    notify.error(`The site could not be built: ${errorText(error)}`, {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
    return;
  }
  if (!result.url) {
    notify.warn("The site was built, but this backend serves no preview of it.", {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
    return;
  }
  /* A live preview is not a build and the report must not say it was: what it renders is the
     working tree, unsaved edits and all, assembled in the reader's browser rather than compiled. */
  const live = result.mode === "live";
  if (result.errors.length > 0) {
    /* Named, and the page still opens. A partial build produced pages, and the author can see the
       one they asked for while reading what failed — which is the whole difference between a
       preview and a build log. */
    const verb = live ? "previewed" : "built";
    notify.warn(`The site ${verb} with ${result.errors.length} error(s): ${result.errors[0]}`, {
      key: OPEN_IN_BROWSER,
      source: "Preview",
    });
  } else if (live) {
    notify.success(
      `Opened a live preview of ${result.routes} page(s) — rendered from your working tree, not a build.`,
      { key: OPEN_IN_BROWSER, source: "Preview" },
    );
  } else {
    notify.success(`Built ${result.routes} page(s).`, { key: OPEN_IN_BROWSER, source: "Preview" });
  }
  openUrlExternally(`${result.url}${path}`);
}

/**
 * Run `Build Site`, the compiler-backed answer to "does my site build?".
 *
 * `View: Open in Browser` stopped meaning this when it started previewing the working tree, and the
 * question did not stop being worth asking: a build runs the bundler, the image pipeline and every
 * emitter, and a live preview runs none of them. So it keeps its own verb, its own report, and the
 * output origin it always opened.
 */
export async function runBuildSite() {
  const platform = hasPlatform() ? getPlatform() : null;
  if (!platform?.buildSite) {
    notify.warn("This backend cannot build the site.", { key: BUILD_SITE, source: "Build" });
    return;
  }
  notify.info("Building the site…", { key: BUILD_SITE, source: "Build" });
  let result: SiteBuildResult;
  try {
    result = await platform.buildSite();
  } catch (error) {
    notify.error(`The site could not be built: ${errorText(error)}`, {
      key: BUILD_SITE,
      source: "Build",
    });
    return;
  }
  if (result.errors.length > 0) {
    notify.warn(`Built with ${result.errors.length} error(s): ${result.errors[0]}`, {
      key: BUILD_SITE,
      source: "Build",
    });
    return;
  }
  notify.success(`Built ${result.routes} page(s), ${result.files} file(s).`, {
    key: BUILD_SITE,
    source: "Build",
  });
}

/** One notification key for the build, kept apart so a build report never replaces a preview's. */
const BUILD_SITE = "project.buildSite";

/** One notification key for the whole flow, so building → built → failed replaces rather than piles. */
const OPEN_IN_BROWSER = "view.openInBrowser";

/** The sentence in an unknown thrown value. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The document's label: its path without the project root, which is already segment one. */
export function documentSegmentLabel(tab: Tab | null): string {
  const path = tab?.documentPath;
  if (!path) {
    return "No document";
  }
  const root = projectState?.projectRoot;
  const trimmed = path.replace(/^\.\//, "");
  return root && trimmed.startsWith(`${root}/`) ? trimmed.slice(root.length + 1) : trimmed;
}

/** The selection's label — the Outline's own `nodeLabel`, so the two never disagree. */
export function selectionSegmentLabel(tab: Tab | null): string {
  if (shell.layoutSelection) {
    return "layout";
  }
  const paths = tab?.session.selection ?? [];
  const selection = primarySelection(paths);
  if (!tab || !selection) {
    return "";
  }
  // A batch is not a place, so the address bar names its SIZE rather than one of its members —
  // Printing the primary's tag would say `section` while five other elements were also selected.
  if (paths.length > 1) {
    return `${paths.length} elements`;
  }
  return nodeLabel(getNodeAtPath(tab.doc.document, selection));
}

/** Ask for a name, then run the command. Exported for the same reason `runOpenInBrowser` is. */
export async function saveLayoutPrompt(registry: CommandRegistry): Promise<void> {
  const name = await showPromptDialog("Save layout", {
    confirmLabel: "Save",
    message: "Remembers this project's Navigator panel, dock widths and Inspector tab.",
    placeholder: "Layout name",
  });
  if (name) {
    await registry.run("view.saveLayout", { name });
  }
}

/** The double-click gesture, routed through the command so the rename has one implementation. */
export async function renameLayoutPrompt(
  registry: CommandRegistry,
  layout: string,
  current: string,
): Promise<void> {
  const name = await showPromptDialog("Rename layout", { confirmLabel: "Rename", value: current });
  if (name) {
    await registry.run("view.renameLayout", { layout, name });
  }
}

interface WindowControls {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
}

function windowControls(): WindowControls | undefined {
  return (globalThis as unknown as { __jxPlatform?: { windowControls?: WindowControls } })
    .__jxPlatform?.windowControls;
}

// ─── The Command Center pill, the layout tabs and the docks, projected ───────

/**
 * `◈ project › document › selection`: four facts about where you are, in non-collapsible chrome
 * (§4.4).
 */
function projectSegments(tab: Tab | null): SegmentProjection[] {
  const segments: SegmentProjection[] = [
    {
      key: "project",
      label: projectState?.name ?? "No project",
      sepBefore: false,
      title: "Switch project — opens Project: Open Recent…",
    },
    { key: "document", label: documentSegmentLabel(tab), sepBefore: true, title: "Go to a file" },
  ];
  const selection = selectionSegmentLabel(tab);
  if (selection) {
    segments.push({
      key: "selection",
      label: selection,
      sepBefore: true,
      title: "Go to an element in this document",
    });
  }
  return segments;
}

/**
 * `Write · Design · Build · Ship · +` — named arrangements, as plain-text tabs.
 *
 * Each tab RUNS `view.setLayout`, so the click, the palette row and an agent all take the same
 * path; double-clicking one renames it, and `+` saves whatever is on screen now. **A layout
 * reconfigures; it never removes**: every panel stays on the rail, on its chord and in the palette
 * after any layout is applied.
 */
function projectLayouts(registry: CommandRegistry | null): LayoutTabProjection[] {
  // `get` first: a registry that has not been handed the shell's records yet (the skeleton the bar
  // Paints before the bootstrap composes them) has no verb to ask about.
  if (!registry?.get("view.setLayout") || !registry.isEnabled("view.setLayout")) {
    return [];
  }
  return shell.layouts.map((preset) => ({
    active: preset.id === shell.layout,
    id: preset.id,
    name: preset.name,
    title: `${preset.name} layout — double-click to rename`,
  }));
}

/** The primary verb cluster: exactly what declared `commandbar/primary`, in the registry's order. */
function projectPrimary(registry: CommandRegistry | null): PrimaryProjection[] {
  if (!registry) {
    return [];
  }
  return registry
    .forPlacement("commandbar/primary")
    .filter((command) => registry.isVisible(command.id))
    .map((command) => ({
      disabled: !registry.isEnabled(command.id),
      hasIcon: Boolean(command.icon),
      icon: command.icon ?? "",
      id: command.id,
      title: command.title,
      tooltip: commandTooltip(registry, command.id),
    }));
}

/**
 * ▤▥▦ — the three docks, each projected from its own record.
 *
 * The glyph names the region and `selected` reports its state, so the control says which way it
 * will go; the NAME and the chord still come from the record, which is why ⌘B and this button
 * cannot drift apart the way ⌘W and the tab strip's × did.
 */
function projectDocks(registry: CommandRegistry | null): DockProjection[] {
  if (!registry) {
    return [];
  }
  return DOCKS.flatMap((dock) => {
    const command = registry.get(dock.id);
    if (!command || !registry.isVisible(dock.id)) {
      return [];
    }
    return [
      {
        disabled: !registry.isEnabled(dock.id),
        icon: dock.icon,
        id: dock.id,
        mirror: dock.mirror,
        selected: !shell.docks[dock.dock].collapsed,
        title: command.title,
        tooltip: commandTooltip(registry, dock.id),
      },
    ];
  });
}

// ─── The ⬢ Studio menu (commandbar/overflow) ─────────────────────────────────

/**
 * Everything that declared `commandbar/overflow` — the chrome's residue for retired controls —
 * projected as rows for the `menu` surface, so a command that moves from the primary cluster to the
 * overflow keeps its name, its chord and its gate, and the move is one edit to its `menus`.
 */
function overflowRows(registry: CommandRegistry): MenuRowProjection[] {
  let group: string | undefined;
  return registry.forPlacement("commandbar/overflow").map((command, index) => {
    const dividerAbove = index > 0 && command.group !== group;
    ({ group } = command);
    const enabled = registry.isEnabled(command.id);
    const chord = registry.keymap.formatBinding(command.id);
    const reason = enabled ? undefined : registry.disabledReason(command.id);
    const row: MenuRowProjection = {
      destructive: command.destructive === true,
      disabled: !enabled,
      dividerAbove,
      id: command.id,
      title: command.title,
    };
    if (chord) {
      row.chord = chord;
    }
    if (reason) {
      row.requires = reason;
    }
    return row;
  });
}

/** Open the Studio menu under its button, or close the one that is up: the button is a toggle. */
function openStudioMenu(opener: HTMLElement): void {
  if (_menu) {
    _menu.close();
    return;
  }
  const registry = activeRegistry();
  if (!registry) {
    return;
  }
  const scope = state();
  const handle = openMenu({
    label: "Studio menu",
    onClosed: (closed) => {
      if (_menu !== closed) {
        return;
      }
      _menu = null;
      scope.menuOpen = false;
    },
    opener,
    place: () => {
      const box = rectOf(opener);
      return { x: box.left, y: box.bottom + 4 };
    },
    region: "studio",
    rows: overflowRows(registry),
    run: (id) => {
      if (registry.isEnabled(id)) {
        void registry.run(id);
      }
    },
  });
  _menu = handle;
  scope.menuOpen = true;
}

// ─── The scope ────────────────────────────────────────────────────────────────

/**
 * The one reactive scope the document is mounted over: rebuilt on mount, re-projected by the
 * effect.
 */
function state(): CommandBarScope {
  _state ??= reactive<CommandBarScope>({
    chord: "",
    csd: "none",
    docks: [],
    hasChord: false,
    layouts: [],
    layoutsVisible: false,
    menuOpen: false,
    menuVisible: false,
    openPicker: () => {
      openQuickSearch("picker");
    },
    openSegment: (key) => {
      openQuickSearch(SEGMENT_MODES[key]);
    },
    openStudioMenu,
    presence: NO_PRESENCE,
    presenceVisible: false,
    primary: [],
    renameLayout: (id) => {
      const registry = activeRegistry();
      const preset = shell.layouts.find((layout) => layout.id === id);
      if (registry && preset) {
        void renameLayoutPrompt(registry, id, preset.name);
      }
    },
    run: (id) => {
      const registry = activeRegistry();
      if (registry?.isEnabled(id)) {
        void registry.run(id);
      }
    },
    saveLayout: () => {
      const registry = activeRegistry();
      if (registry) {
        void saveLayoutPrompt(registry);
      }
    },
    segments: [],
    setLayout: (id) => {
      void activeRegistry()?.run("view.setLayout", { layout: id });
    },
    windowControl: (action) => {
      windowControls()?.[action]();
    },
  }) as CommandBarScope;
  return _state;
}

/**
 * Re-project the registry, the shell and the tab onto the scope. Every write is keyed, so the DOM
 * reconciles in place.
 */
function project(): void {
  const scope = state();
  const registry = activeRegistry();
  const tab = activeTab.value ?? null;
  const controls = windowControls();
  scope.csd = controls ? (isMacPlatform() ? "mac" : "other") : "none";
  scope.menuVisible = registry !== null;
  scope.layouts = projectLayouts(registry);
  scope.layoutsVisible = scope.layouts.length > 0;
  scope.segments = projectSegments(tab);
  scope.chord = registry?.keymap.formatBinding("palette.open") ?? "";
  scope.hasChord = scope.chord !== "";
  scope.primary = projectPrimary(registry);
  const presence = presenceProjection(tab);
  // The object before the flag, so the case that reads it never renders against the empty one.
  scope.presence = presence ?? NO_PRESENCE;
  scope.presenceVisible = presence !== null;
  scope.docks = projectDocks(registry);
  if (_menu && registry) {
    _menu.setRows(overflowRows(registry));
  }
}

// ─── Mount ────────────────────────────────────────────────────────────────────

/**
 * Mount the Command Bar.
 *
 * @param rootEl The `#toolbar` host, stamped `commandbar` by the frame (`shell/tree.ts`).
 * @param _ctx Ignored — see {@link ToolbarCtx}.
 */
export function mount(rootEl: HTMLElement, _ctx: ToolbarCtx = {}): void {
  unmount();
  _rootEl = rootEl;
  if (windowControls()) {
    rootEl.classList.add("electrobun-webkit-app-region-drag");
  }
  _scope = effectScope();
  _scope.run(() => {
    effect(() => {
      // Dock visibility, source control and the project are shell state, tracked here so the band
      // Follows a flip made from anywhere — the automation runner, the New Project agent hand-off,
      // The boot-time restore — not just this document's handlers.
      void shell.docks.left.collapsed;
      void shell.docks.right.collapsed;
      void shell.docks.bottom.collapsed;
      void shell.git.status;
      void shell.layoutSelection;
      // The layout tabs are a rendering of the project's own record, so the band repaints when a
      // Layout is saved, renamed or deleted from anywhere.
      void shell.layout;
      void shell.layouts;
      // The registry itself is reactive state: it is composed AFTER this mount runs, and reading it
      // Here is what repaints the band from a skeleton into the real bar.
      void activeRegistry();
      const tab = activeTab.value;
      if (tab) {
        void tab.doc.document;
        void tab.doc.dirty;
        void tab.doc.mode;
        // The whole SET, joined — a bare property read would not re-trigger when the selection
        // Changes WITHIN the array, and §6.5's helpers always replace it but nothing enforces that.
        void tab.session.selection.map((path) => path.join("/")).join("|");
        void tab.session.ui.canvasMode;
        // Open in Browser needs a value for every route param before it can resolve a page.
        void tab.session.ui.previewParams;
        void tab.history.index;
        void tab.history.snapshots.length;
      }
      try {
        project();
      } catch (error) {
        console.error("command bar projection error:", error);
      }
    });
  });
  _mount = mountSurface("commandbar", state(), rootEl);
  void _mount.then((handle) => {
    _handle = handle;
  });
}

export function unmount(): void {
  _menu?.close();
  _scope?.stop();
  _scope = null;
  const pending = _mount;
  _mount = null;
  if (_handle) {
    _handle.dispose();
    _handle = null;
  } else if (pending) {
    void pending.then((handle) => handle.dispose());
  }
  _state = null;
  _rootEl = null;
}

/**
 * Re-project now. The effect does this on its own; the bootstrap calls it after a store it does not
 * track hydrates.
 */
export function render(): void {
  if (_rootEl) {
    project();
  }
}
