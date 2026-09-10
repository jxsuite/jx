/// <reference lib="dom" />
/**
 * The pane's chrome as a mounted document — regions ⑦ and ⑩, one mount per pane.
 *
 * `panels/pane-context.ts` is the flow: which editor kinds a document declares, which canvas views
 * it has, whether preview is a flag over one of them, what a lens may never write, which pane's
 * stage a zoom verb lands on, what a route param's candidate values are, and what a typed test prop
 * parses as. This is the surface it draws into — the reactive scope the document reads, the words
 * it discriminates on, and the two popovers whose open state a command has to be able to write.
 *
 * **The mount is per pane and the handle is the caller's**, which is the whole reason this module
 * exports a factory rather than an `attach`/`render` pair: this bar states one pane's editor kind,
 * canvas view, rendering context and zoom, and two panes have two of each
 * (`scripts/check-pane-singletons.ts`). Nothing here is module state.
 *
 * **The host is not cleared.** `.pane-chrome` belongs to this surface alone — `panels/pane-grid.ts`
 * renders nothing inside it — and the document's root is `display: contents`, so the band and the
 * pod become the flex items the chrome layer's `justify-content: space-between` pushes apart,
 * exactly as the two lit children did.
 *
 * **The region goes on the BAR, not on the host.** `mountSurface`'s own `region` option stamps the
 * host, and the host is `.pane-chrome` — a larger box wrapping both regions. `resolveRegion` takes
 * the LAST match, so an id on the wrapper as well as on the bar is a silently widened crop
 * (`panels/pane-grid.ts` says so at the ref that hands this module its host). The document carries
 * `pane.<id>/context` and `pane.<id>/zoom` in its own markup instead.
 *
 * @docs studio/interface/tabs
 */

import { close as closePopover, openAt } from "@jxsuite/ui/behaviors/popover";
import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import paneContextDoc from "./pane-context.json";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("pane-context", paneContextDoc as unknown as JxDocument);

/** One row of a `jx-select`: the value it writes and the word it prints. */
export interface PaneContextOption {
  value: string;
  label: string;
}

/**
 * One segment of a radio group — a size, a scheme, a view, a language.
 *
 * `checked` is the STRING the kit reads: `jx-action-button` becomes a `role="radio"` only when
 * `checked` is non-empty, and a `selects="single"` group of bare buttons announces a radiogroup
 * with no checked member at all.
 */
export interface PaneContextChoice {
  key: string;
  value: string;
  label: string;
  hint: string;
  checked: "true" | "false";
}

/** One independent toggle — a feature query. `selected` draws it; `toggles` announces it. */
export interface PaneContextToggle {
  key: string;
  value: string;
  label: string;
  hint: string;
  selected: boolean;
}

/** One route param: a picker over the candidate values the flow loaded. */
export interface PaneContextParam {
  key: string;
  name: string;
  label: string;
  value: string;
  options: PaneContextOption[];
}

/** One component test prop: a field, and the region id the screenshot pipeline addresses it by. */
export interface PaneContextProp {
  key: string;
  name: string;
  label: string;
  region: string;
  value: string;
}

/**
 * Everything the document draws, as words and values. No records, no closures, no tabs.
 *
 * Every `*State` field is a `$switch` discriminant rather than a boolean, for the reason
 * `library-pane.json` gives: a word cannot be two things at once, and the absent case is the absent
 * group.
 */
export interface PaneContextView {
  /** `pane.<id>/context`, stamped on the bar itself. */
  contextRegion: string;
  /** `pane.<id>/zoom`, stamped on the pod. */
  zoomRegion: string;
  /** `full` draws the three axes; `lens` draws the rendering context as a read-only summary. */
  barMode: "full" | "lens";
  presetState: "shown" | "hidden";
  bannerState: "shown" | "hidden";
  /** The lens's stated rendering context — "Tablet · français". */
  summary: string;

  editorMode: "static" | "picker";
  editorLabel: string;
  editorValue: string;
  editorOptions: PaneContextOption[];

  viewState: "shown" | "hidden";
  views: PaneContextChoice[];
  previewState: "shown" | "hidden";
  previewOn: boolean;
  previewHint: string;

  /** "Base · Auto" — what the rendering-context trigger reads before it is opened. */
  contextSummary: string;
  resolvingState: "shown" | "hidden";
  /** "2 set", or "Defaults". */
  resolvingLabel: string;
  resolvingKind: "params" | "props";
  params: PaneContextParam[];
  props: PaneContextProp[];

  sizes: PaneContextChoice[];
  schemeState: "shown" | "hidden";
  schemes: PaneContextChoice[];
  localeState: "shown" | "hidden";
  /** The sentence the language group says about itself — what it changes, and what it does not. */
  localeHint: string;
  locales: PaneContextChoice[];
  featureState: "shown" | "hidden";
  features: PaneContextToggle[];
  layoutState: "shown" | "hidden";
  layoutOn: boolean;

  exportState: "shown" | "hidden";

  podState: "shown" | "hidden";
  zoomLabel: string;
  fitState: "shown" | "hidden";
  fitValue: string;
  fitOptions: PaneContextOption[];
}

/** What a control can ask the pane to do. Every one of them is a decision the flow owns. */
export interface PaneContextActions {
  openPresetMenu: (anchor: HTMLElement) => void;
  chooseEditor: (kind: string) => void;
  chooseView: (view: string) => void;
  togglePreview: () => void;
  setBreakpoint: (media: string) => void;
  setScheme: (scheme: string) => void;
  setLocale: (locale: string) => void;
  toggleFeature: (name: string) => void;
  toggleLayout: () => void;
  manageContexts: () => void;
  setParam: (name: string, value: string) => void;
  setProp: (name: string, raw: string) => void;
  exportFile: () => void;
  zoomOut: () => void;
  zoomIn: () => void;
  zoomReset: () => void;
  chooseFit: (value: string) => void;
}

export interface PaneContextSurfaceHandle {
  /** Bring the mounted document up to date with a whole projection. */
  update: (view: PaneContextView) => void;
  /** Whether the document this mounted is still standing in the host it was given. */
  connected: () => boolean;
  /**
   * The band the stage must clear — the bar plus whatever banners rode with it — or `null` while
   * the mount is still in flight. MEASURED by the caller rather than summed, because a banner's
   * height is its wrapped text.
   */
  band: () => HTMLElement | null;
  /** Whether this pane's "resolving with" panel is showing. */
  isResolvingOpen: () => boolean;
  /** Open or close it, from the command as well as from the trigger. */
  setResolvingOpen: (open: boolean) => void;
  /** Take the document down. Idempotent. */
  dispose: () => void;
  /**
   * Settles once the document has rendered.
   *
   * Every caller that MEASURES the band has to await it: `mountSurface` is asynchronous, so the
   * band the stage is offset by does not exist on the line after the mount call.
   */
  ready: Promise<void>;
}

/** The panel state the scope carries beside the projection: where each popover is, and whether. */
interface PopoverState {
  contextPopoverId: string;
  resolvingPopoverId: string;
  contextX: number;
  contextY: number;
  contextOpen: boolean;
  resolvingX: number;
  resolvingY: number;
  resolvingOpen: boolean;
}

interface PaneContextScope
  extends Record<string, unknown>, PaneContextView, PaneContextActions, PopoverState {
  /** The two panel doors the document calls, which the mount owns rather than the flow. */
  openContext: (anchor: HTMLElement) => void;
  openResolving: (anchor: HTMLElement) => void;
}

/** A `jx-popover`, as the two doors this module uses see it. */
type PopoverElement = HTMLElement & { open?: boolean };

/** Write a projection into the scope. Assignment by assignment, so an unchanged field is inert. */
function project(scope: PaneContextScope, view: PaneContextView): void {
  scope.contextRegion = view.contextRegion;
  scope.zoomRegion = view.zoomRegion;
  scope.barMode = view.barMode;
  scope.presetState = view.presetState;
  scope.bannerState = view.bannerState;
  scope.summary = view.summary;
  scope.editorMode = view.editorMode;
  scope.editorLabel = view.editorLabel;
  scope.editorValue = view.editorValue;
  scope.editorOptions = view.editorOptions;
  scope.viewState = view.viewState;
  scope.views = view.views;
  scope.previewState = view.previewState;
  scope.previewOn = view.previewOn;
  scope.previewHint = view.previewHint;
  scope.contextSummary = view.contextSummary;
  scope.resolvingState = view.resolvingState;
  scope.resolvingLabel = view.resolvingLabel;
  scope.resolvingKind = view.resolvingKind;
  scope.params = view.params;
  scope.props = view.props;
  scope.sizes = view.sizes;
  scope.schemeState = view.schemeState;
  scope.schemes = view.schemes;
  scope.localeState = view.localeState;
  scope.localeHint = view.localeHint;
  scope.locales = view.locales;
  scope.featureState = view.featureState;
  scope.features = view.features;
  scope.layoutState = view.layoutState;
  scope.layoutOn = view.layoutOn;
  scope.exportState = view.exportState;
  scope.podState = view.podState;
  scope.zoomLabel = view.zoomLabel;
  scope.fitState = view.fitState;
  scope.fitValue = view.fitValue;
  scope.fitOptions = view.fitOptions;
}

/** The projection a pane's chrome starts from — a bar with nothing in it yet. */
export function emptyPaneContextView(): PaneContextView {
  return {
    bannerState: "hidden",
    barMode: "full",
    contextRegion: "",
    contextSummary: "Base",
    editorLabel: "",
    editorMode: "static",
    editorOptions: [],
    editorValue: "",
    exportState: "hidden",
    featureState: "hidden",
    features: [],
    fitOptions: [],
    fitState: "hidden",
    fitValue: "",
    layoutOn: true,
    layoutState: "hidden",
    localeHint: "",
    locales: [],
    localeState: "hidden",
    params: [],
    podState: "hidden",
    presetState: "hidden",
    previewHint: "",
    previewOn: false,
    previewState: "hidden",
    props: [],
    resolvingKind: "params",
    resolvingLabel: "Defaults",
    resolvingState: "hidden",
    schemes: [],
    schemeState: "hidden",
    sizes: [],
    summary: "Base",
    views: [],
    viewState: "hidden",
    zoomLabel: "100%",
    zoomRegion: "",
  };
}

/**
 * An attribute a node's DEFINITION carries, or "" when it carries none.
 *
 * The definition rather than the element: `onNodeCreated` fires as the node is made, and an
 * attribute binding is applied by an effect of its own — so `element.dataset.popover` is still
 * undefined at that moment and the two panels would both be filed under the same empty key.
 */
function attrOf(def: JxElement | string, name: string): string {
  const value = typeof def === "string" ? undefined : def.attributes?.[name];
  return typeof value === "string" ? value : "";
}

/**
 * Where a panel opens, from the control that opened it: below it, and right-aligned to it.
 *
 * Right-aligned because the three axes sit at the trailing edge of a pane that may be half the
 * window wide — `bottom-end` is what the Spectrum overlay did, and a panel hanging off the left of
 * a trigger 40px from the window edge runs off the screen. The panel's own width is only known once
 * it has been shown, which is why this is called twice ({@link showPanel}): the same two-pass
 * `surfaces/menu.ts` uses, for the same reason.
 */
function placeBelow(anchor: HTMLElement, panel: HTMLElement | null): { x: number; y: number } {
  const box = rectOf(anchor);
  const width = panel ? rectOf(panel).width : 0;
  const right = Math.max(0, box.right - width);
  return { x: Math.round(right), y: Math.round(box.bottom) };
}

/**
 * Mount the pane chrome into `host`, which is one pane's `.pane-chrome`.
 *
 * @param {string} paneId The pane whose chrome this is — the two popovers' id stem
 * @param {HTMLElement} host The pane cell's chrome layer
 * @param {PaneContextView} view What to draw right now
 * @param {PaneContextActions} actions What each control does
 * @returns {PaneContextSurfaceHandle}
 */
export function mountPaneContextSurface(
  paneId: string,
  host: HTMLElement,
  view: PaneContextView,
  actions: PaneContextActions,
): PaneContextSurfaceHandle {
  /* The ids the two `jx-popover`s carry, and the reason they are per PANE. A popover id is
     document-global — `getElementById` is how an invoker finds its panel, and how the behaviour
     module finds an invoker from a panel — so two panes mounting this surface under one id would
     hand the second pane's trigger the first pane's panel. */
  const uid = `pane-context-${paneId}`;
  const scope = reactive<PaneContextScope>({
    ...emptyPaneContextView(),
    ...actions,
    contextOpen: false,
    contextPopoverId: `${uid}-context`,
    contextX: 0,
    contextY: 0,
    openContext: (anchor: HTMLElement) => {
      togglePanel("context", anchor);
    },
    openResolving: (anchor: HTMLElement) => {
      togglePanel("resolving", anchor);
    },
    resolvingOpen: false,
    resolvingPopoverId: `${uid}-resolving`,
    resolvingX: 0,
    resolvingY: 0,
  }) as PaneContextScope;
  project(scope, view);

  const nodes = new Map<string, HTMLElement>();
  let mounted: SurfaceHandle | null = null;
  let disposed = false;

  /** The panel a `data-popover` key names, once the document has drawn it. */
  const panelOf = (kind: "context" | "resolving"): PopoverElement | null =>
    (nodes.get(`popover:${kind}`) as PopoverElement | undefined) ?? null;

  /**
   * Show a panel from its trigger, positioning it before and after the show.
   *
   * Before, so a panel that has been shown once opens where it belongs on the frame it appears;
   * after, because only a shown panel has a width to right-align by.
   */
  const showPanel = (kind: "context" | "resolving", anchor: HTMLElement): void => {
    const panel = panelOf(kind);
    if (!panel) {
      return;
    }
    const write = (at: { x: number; y: number }): void => {
      if (kind === "context") {
        scope.contextX = at.x;
        scope.contextY = at.y;
      } else {
        scope.resolvingX = at.x;
        scope.resolvingY = at.y;
      }
    };
    write(placeBelow(anchor, panel));
    if (kind === "context") {
      scope.contextOpen = true;
    } else {
      scope.resolvingOpen = true;
    }
    openAt(panel, anchor);
    write(placeBelow(anchor, panel));
  };

  const hidePanel = (kind: "context" | "resolving"): void => {
    if (kind === "context") {
      scope.contextOpen = false;
    } else {
      scope.resolvingOpen = false;
    }
    const panel = panelOf(kind);
    if (panel) {
      closePopover(panel);
    }
  };

  /**
   * The trigger's own gesture: a second press on an open panel closes it.
   *
   * The platform light-dismisses an `auto` popover on a press outside it, and the trigger IS
   * outside it — so without this the panel is closed by the dismissal and reopened by the click,
   * which reads as a control that cannot be turned off. Naming the trigger as the popover's
   * `source` is what keeps the dismissal from firing first ({@link openAt}).
   */
  function togglePanel(kind: "context" | "resolving", anchor: HTMLElement): void {
    if (kind === "context" ? scope.contextOpen : scope.resolvingOpen) {
      hidePanel(kind);
      return;
    }
    showPanel(kind, anchor);
  }

  const ready = mountSurface("pane-context", scope, host, {
    onNodeCreated: (element, _path, def) => {
      const part = attrOf(def, "part");
      if (part === "" || !(element instanceof HTMLElement)) {
        return;
      }
      if (part === "popover") {
        const kind = attrOf(def, "data-popover");
        if (kind) {
          nodes.set(`popover:${kind}`, element);
          /* The platform's own toggle is the only thing that knows about a light dismiss, an
             Escape, or a second panel taking the top layer — so the flag follows it rather than
             only the two doors above. It is a flag rather than a read of the element because
             `hidePopover()` queues its toggle: `canvas.setResolvingOpen { open: false }` has to be
             true of `isResolvingOpen()` on the line after it, not a task later. */
          element.addEventListener("toggle", (event) => {
            const open = (event as Event & { newState?: string }).newState === "open";
            if (kind === "context") {
              scope.contextOpen = open;
            } else {
              scope.resolvingOpen = open;
            }
          });
        }
        return;
      }
      if (part === "band" || part === "resolving-trigger" || part === "context-trigger") {
        nodes.set(part, element);
      }
    },
  }).then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    mounted = surface;
  });

  return {
    band: () => {
      const band = nodes.get("band");
      return band?.isConnected === true ? band : null;
    },
    /* A mount still in flight has nothing in the host to ask about, and answering "no" would make
       the next repaint tear down the mount it is waiting for and start a second one. */
    connected: () => !disposed && (mounted === null || (mounted.root as Node).parentNode === host),
    dispose() {
      disposed = true;
      hidePanel("context");
      hidePanel("resolving");
      mounted?.dispose();
      mounted = null;
      nodes.clear();
    },
    isResolvingOpen: () => scope.resolvingOpen,
    ready,
    setResolvingOpen: (open) => {
      if (scope.resolvingOpen === open) {
        return;
      }
      if (!open) {
        hidePanel("resolving");
        return;
      }
      const trigger = nodes.get("resolving-trigger");
      if (trigger?.isConnected === true) {
        showPanel("resolving", trigger);
      }
    },
    update: (next) => {
      project(scope, next);
    },
  };
}
