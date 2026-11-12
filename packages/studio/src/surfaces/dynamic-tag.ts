/// <reference lib="dom" />
/**
 * The tag popover's surface: `dynamic-tag.json` mounted once into its own popover slot.
 *
 * `panels/dynamic-tag.ts` is the flow (which tag is open, what each control writes, what the value
 * is) and this is what that flow draws into. Nothing here reads the document or parses an
 * expression: it takes a projection in which every field is already decided, and it owns the mount,
 * the panel's own `showPopover`, and the one piece of state that is the surface's alone, the text
 * being typed into Advanced before it is applied.
 *
 * **Mounted once.** The panel is a `jx-popover`, shown and hidden by its own methods, so a tag
 * opened after another is an assignment and never a second mount; and a close the platform made
 * (Escape, a press outside) is reported to the flow from the panel's `toggle`, which is the only
 * way the flow learns the tab's state must follow.
 *
 * @docs studio/editing/dynamic-tags
 */

import { isString } from "@jxsuite/schema/guards";
import { reactive } from "../reactivity";
import { whenOwnReady } from "../ui/own-ready";
import { mountSurface, registerSurface } from "../ui/surface";
import { rectOf } from "../utils/geometry";
import dynamicTagDoc from "./dynamic-tag.json";

import type { JxScope } from "@jxsuite/runtime/types";
import type { JxElement } from "@jxsuite/schema/types";
import type { ParameterField, SourceGroup } from "../editor/dynamic-tags";
import type { SurfaceHandle, SurfaceOption } from "../ui/surface";

registerSurface("dynamic-tag", dynamicTagDoc);

/** One way to format the value, drawn with the value itself. */
export interface TagFormatRow {
  /** The preset's id; `""` is no format, `"custom"` a format no preset spells. */
  id: string;
  /** The row's accessible name: the label and the sample together. */
  name: string;
  /** "Format date: long". */
  label: string;
  /** The value written this way, as the canvas would draw it. */
  sample: string;
  /** `"true"` or `"false"`: the radio state, as a word the kit's button reads. */
  checked: string;
}

/** Everything the document draws, as one assignment. */
export interface DynamicTagView {
  /** What the tag is called: "Post date", or "Custom expression". */
  title: string;
  /** What it is bound to: "Text", "Image". */
  property: string;
  /** Whether the tag is in the recognised grammar, and so has fields. */
  structured: boolean;
  source: string;
  sourceGroups: SourceGroup[];
  formats: TagFormatRow[];
  params: ParameterField[];
  /** `"0"`, `"1"` or `"2"`: the value, whether it is empty, whether it is set. */
  show: string;
  showOptions: SurfaceOption[];
  /** `""`, `"??"` or `"||"`. */
  fallbackWhen: string;
  fallbackOptions: SurfaceOption[];
  hasFallback: boolean;
  fallback: string;
  nowText: string;
  /** The whole value, or the whole error, when the line cuts it short. */
  nowTitle: string;
  nowState: "value" | "empty" | "pending" | "failed" | "not-run";
  /** "Advanced", or "Custom expression" when that is all there is. */
  advancedLabel: string;
  advancedOpen: boolean;
  /** The expression as stored: what Advanced holds until the author types. */
  expr: string;
}

/** What a control asks the flow to do. Every one of these is a decision the flow owns. */
export interface DynamicTagActions {
  setSource: (value: string) => void;
  setFormat: (id: string) => void;
  setParam: (key: string, value: string) => void;
  setShow: (value: string) => void;
  setFallbackWhen: (value: string) => void;
  setFallbackText: (value: string) => void;
  /** Store the expression typed into Advanced. */
  applyExpression: (text: string) => void;
  /** What to say under Advanced about the text being typed: empty, or why it is no longer fields. */
  describeDraft: (text: string) => string;
  /** The panel closed by the platform's own doing: Escape, or a press outside it. */
  closed: () => void;
}

/** The scope `dynamic-tag.json` reads. */
interface DynamicTagScope extends DynamicTagView {
  x: number;
  y: number;
  draft: string;
  draftClean: boolean;
  draftInvalid: boolean;
  draftNote: string;
  setSource: (value: string) => void;
  setFormat: (id: string) => void;
  setParam: (key: string, value: string) => void;
  setShow: (value: string) => void;
  setFallbackWhen: (value: string) => void;
  setFallbackText: (value: string) => void;
  editDraft: (value: string) => void;
  applyDraft: () => void;
  applyDraftOnChord: (ctrl: boolean, meta: boolean) => void;
  toggled: (scope: JxScope, event: Event) => void;
}

/** A `jx-popover`, with the members a host is allowed to touch. */
type PanelElement = HTMLElement & {
  showPopover: (options?: { source?: Element }) => void;
  hidePopover: () => void;
};

/** How tall the panel is taken to be before it has been drawn once, in pixels. */
const PANEL_HEIGHT_GUESS = 420;

/** The least room kept between the panel and what it opens from, and the window's edge. */
const PANEL_GAP = 6;

/** The projection before any tag has been opened. */
export function emptyDynamicTagView(): DynamicTagView {
  return {
    advancedLabel: "Advanced",
    advancedOpen: false,
    expr: "",
    fallback: "",
    fallbackOptions: [],
    fallbackWhen: "",
    formats: [],
    hasFallback: false,
    nowState: "empty",
    nowText: "",
    nowTitle: "",
    params: [],
    property: "",
    show: "0",
    showOptions: [],
    source: "",
    sourceGroups: [],
    structured: false,
    title: "",
  };
}

/** A node definition's `part`, as written in the document. */
function partOf(def: JxElement | string): string {
  const part = isString(def) ? undefined : def.attributes?.["part"];
  return isString(part) ? part : "";
}

/** The mounted popover, and every handle the flow is allowed to reach back through. */
export interface DynamicTagSurface {
  /** State what the popover says. Assignment only. */
  readonly update: (view: DynamicTagView) => void;
  /**
   * Show the panel under this viewport point, and move focus into it. `above` is the top edge of
   * what was pressed: where the panel does not fit below, it goes above that instead, so it does
   * not come to rest over the very text it edits.
   */
  readonly open: (at: { x: number; y: number; above?: number }) => void;
  /** Hide the panel. A no-op when it is not showing. */
  readonly close: () => void;
  /** Take the document down. Idempotent. */
  readonly dispose: () => void;
}

/**
 * Mount the popover into the layer slot the flow owns.
 *
 * @param host The `popover` layer slot; the document clears it, so nothing else may draw there.
 * @param actions What each control does.
 */
export function mountDynamicTag(host: HTMLElement, actions: DynamicTagActions): DynamicTagSurface {
  let panelEl: PanelElement | null = null;
  let sourceEl: HTMLElement | null = null;
  let expressionEl: HTMLElement | null = null;
  /** The panel's height when it was last drawn; a guess before it ever was. */
  let lastHeight = PANEL_HEIGHT_GUESS;
  /** Whether the flow wants the panel showing: what a `toggle` is compared against. */
  let wanted = false;
  let showing = false;
  /**
   * The `toggle` events of closes this surface made itself that have not arrived: the platform
   * reports a close after the fact, so one made as another tag was pressed arrives after the panel
   * was shown again, and is not the platform closing it.
   */
  let ownCloses = 0;

  const scope: DynamicTagScope = reactive<DynamicTagScope>({
    ...emptyDynamicTagView(),
    applyDraft: () => {
      if (!scope.draftClean) {
        actions.applyExpression(scope.draft);
      }
    },
    applyDraftOnChord: (ctrl: boolean, meta: boolean) => {
      // Enter alone is a new line in a multi-line field; with Ctrl or ⌘ it applies.
      if (ctrl || meta) {
        scope.applyDraft();
      }
    },
    draft: "",
    draftClean: true,
    draftInvalid: false,
    draftNote: "",
    editDraft: (value: string) => {
      scope.draft = isString(value) ? value : "";
      scope.draftClean = scope.draft.trim() === scope.expr.trim();
      scope.draftInvalid = scope.draft.trim() === "";
      scope.draftNote = scope.draftClean ? "" : actions.describeDraft(scope.draft);
    },
    setFallbackText: (value: string) => actions.setFallbackText(isString(value) ? value : ""),
    setFallbackWhen: (value: string) => actions.setFallbackWhen(isString(value) ? value : ""),
    setFormat: (id: string) => actions.setFormat(id),
    setParam: (key: string, value: string) => actions.setParam(key, isString(value) ? value : ""),
    setShow: (value: string) => actions.setShow(isString(value) ? value : "0"),
    setSource: (value: string) => actions.setSource(isString(value) ? value : ""),
    toggled: (_scope: JxScope, event: Event) => {
      /* The panel's own toggle and nobody else's: the Advanced section inside it is a disclosure,
         and its toggle arrives here too. Taking that one for the panel closing shut the popover
         the moment it was drawn. */
      if (event.target !== event.currentTarget || !("newState" in event)) {
        return;
      }
      if (event.newState === "closed" && ownCloses > 0) {
        ownCloses -= 1;
        return;
      }
      showing = event.newState === "open";
      // A close nobody here asked for is the platform's: Escape, or a press outside the panel.
      if (!showing && wanted) {
        wanted = false;
        actions.closed();
      }
    },
    x: 0,
    y: 0,
  });

  const mounted = mountSurface("dynamic-tag", scope, host, {
    onNodeCreated: (element, _path, def, _state: JxScope | undefined) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "panel") {
        // SAFETY: `part: "panel"` is the document's `jx-popover`, whose class has both methods.
        panelEl = element as PanelElement;
      } else if (part === "source") {
        sourceEl = element;
      } else if (part === "expression") {
        expressionEl = element;
      }
    },
  });

  const show = (): void => {
    const panel = panelEl;
    if (!panel || !wanted) {
      return;
    }
    if (!showing) {
      panel.showPopover();
    }
    // What the next open is placed by: the panel's height is only known once it has been drawn.
    const { height } = rectOf(panel);
    if (height > 0) {
      lastHeight = height;
    }
    /* Into the panel, so its fields take the keyboard and Escape is the panel's to answer. The
       control itself, not the kit element around it: a kit field is light DOM whose host takes no
       focus, and its control is drawn a frame after the host is. */
    requestAnimationFrame(() => {
      if (!wanted || !panel.isConnected) {
        return;
      }
      const first = scope.structured ? sourceEl : expressionEl;
      const control = (first?.isConnected === true ? first : panel).querySelector<HTMLElement>(
        "select, textarea, input, button:not([disabled])",
      );
      (control ?? panel).focus();
    });
  };

  /* A custom element connects asynchronously, so the panel may not carry the `popover` attribute
     that makes it showable yet: `jx-ready` is the element saying it does, the same handshake the
     block action bar's link panel waits on. */
  const showWhenReady = (): void => {
    const panel = panelEl;
    if (!panel) {
      return;
    }
    if (panel.hasAttribute("popover")) {
      show();
    } else {
      void whenOwnReady(panel).then(show);
    }
  };
  let handle: SurfaceHandle | null = null;
  let disposed = false;
  // The first open arrives before the document is mounted: it is shown when the mount lands.
  void mounted.then((surface) => {
    if (disposed) {
      surface.dispose();
      return;
    }
    handle = surface;
    showWhenReady();
  });

  return {
    close() {
      wanted = false;
      if (showing && panelEl) {
        // Down at once: a panel shown again before the platform reports this close is shown anew.
        showing = false;
        ownCloses += 1;
        panelEl.hidePopover();
      }
    },
    dispose() {
      wanted = false;
      disposed = true;
      handle?.dispose();
      handle = null;
      panelEl = null;
    },
    open(at) {
      const below = window.innerHeight - at.y;
      const fitsAbove = at.above !== undefined && at.above - lastHeight - PANEL_GAP >= PANEL_GAP;
      scope.x = Math.round(at.x);
      scope.y = Math.round(
        below < lastHeight + PANEL_GAP && at.above !== undefined && fitsAbove
          ? at.above - lastHeight - PANEL_GAP
          : at.y,
      );
      /* Whatever was typed for the tag shown before is its draft and nobody else's: the flow
         updates the view before it opens, so the field starts from this tag's expression. */
      scope.draft = scope.expr;
      scope.draftClean = true;
      scope.draftInvalid = false;
      scope.draftNote = "";
      wanted = true;
      showWhenReady();
    },
    update(view) {
      const moved = view.expr !== scope.expr;
      Object.assign(scope, view);
      /* A format gives the panel more fields, and it is placed by its top edge: one that has grown
         past the window's foot is moved up to stand on it. */
      requestAnimationFrame(() => {
        const box = showing && panelEl ? rectOf(panelEl) : undefined;
        if (box && box.height > 0) {
          lastHeight = box.height;
          if (box.bottom > window.innerHeight - PANEL_GAP) {
            scope.y = Math.max(PANEL_GAP, Math.round(window.innerHeight - box.height - PANEL_GAP));
          }
        }
      });
      // The tag changed under the field (an edit landed, another tag was opened): start from it.
      if (moved || scope.draftClean) {
        scope.draft = view.expr;
        scope.draftClean = true;
        scope.draftInvalid = false;
        scope.draftNote = "";
      }
    },
  };
}
