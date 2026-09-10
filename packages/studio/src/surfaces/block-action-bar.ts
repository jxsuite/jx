/// <reference lib="dom" />
/**
 * The block action bar's surface: `block-action-bar.json` mounted once over the canvas layer.
 *
 * `panels/block-action-bar.ts` is the flow — which records the registry places, whether each can
 * act, where the bar belongs against the selection rect, when it steps aside — and this is what
 * that flow draws into. Nothing here asks the registry a question, reads the document or measures
 * anything: it takes a projection whose every button already carries a glyph, a name, a tooltip and
 * a refusal, and it owns the mount, the two islands and the link panel's own `showPopover`.
 *
 * **The bar is mounted once and never re-mounted.** A document reconciles by assignment, so a
 * selection snapshot, a pan and a zoom all cost a scope write rather than a teardown — which is
 * what retires the `_linkPopoverOpen` render guard the lit bar needed: there is no pass that could
 * re-create the URL field under the author's caret. Hiding is {@link BlockBarView.visible}, a
 * `$switch` at the document's root, so a dismissed bar is genuinely absent from the DOM rather than
 * merely invisible.
 *
 * **Two islands, both through `onNodeCreated`** (studio-ui-guidelines.md §9.4). The drag handle
 * takes its pragmatic-dnd registration as it is created — `canDrag` and the dragged path are the
 * flow's, so the registration outlives every selection change and the bar never carries two. The
 * link panel is the kit's `jx-popover`, and an element's own `showPopover()` is the one overlay
 * call §9.4 leaves on this side of the seam.
 *
 * **Every control the flow has to reach again is announced, never queried.** `format.link`'s button
 * is the link panel's anchor and ⌥↑ needs the toolbar itself; both are recorded here as the runtime
 * creates them, so no pass re-finds a node it drew.
 *
 * @docs studio/interface/canvas
 * @docs studio/editing/writing
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import blockActionBarDoc from "./block-action-bar.json";

import type { JxScope } from "@jxsuite/runtime/types";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";
import { rectOf } from "../utils/geometry";

registerSurface("block-action-bar", blockActionBarDoc as unknown as JxDocument);

/** One button, already decided: what it is called, what it draws, and why it cannot act. */
export interface BlockBarTool {
  /** The command id — the button's identity across updates and what `run` receives. */
  id: string;
  title: string;
  /** The record's tooltip: its chord when it can act, its `requires` sentence when it cannot. */
  tooltip: string;
  /** A kit glyph name, or `""` for a record with no icon, which draws its title instead. */
  icon: string;
  /** Whether {@link icon} names a glyph — the discriminant the document draws the fallback on. */
  hasIcon: boolean;
  disabled: boolean;
  /** Drawn in the danger colour — the record's own `destructive`. */
  destructive: boolean;
  /** A format toggle's pressed state; ignored on a plain verb. */
  selected: boolean;
  /** The inline tag a format toggle applies, for the region grammar. */
  value: string;
}

/** Everything the document draws, as one assignment. */
export interface BlockBarView {
  /** Whether the bar is on screen at all. False draws nothing — the `$switch` at the root. */
  visible: boolean;
  /** The bar's position, as the two custom properties the document's `left`/`top` read. */
  anchorVars: string;
  /** The anchor left the stage: hidden by `visibility`, so the drag handle survives the scroll. */
  offscreen: boolean;
  parentLabel: string;
  parentHint: string;
  parentDisabled: boolean;
  /** The element badge's text: the node's `$id`, its tag, or a repeater's label. */
  tagLabel: string;
  tagHint: string;
  /** `"menu"` when the badge opens the convert list, `""` when it cannot. */
  tagPopup: string;
  tagDisabled: boolean;
  canDrag: boolean;
  dragHint: string;
  verbs: BlockBarTool[];
  hasOverflow: boolean;
  overflowOpen: boolean;
  showFormat: boolean;
  formats: BlockBarTool[];
}

/** What the bar's controls do. Every one of these is a decision, so every one comes from the flow. */
export interface BlockBarActions {
  /** Run a command by id — a verb, a format toggle, either. */
  run: (id: string) => void;
  selectParent: () => void;
  /** Open the convert-targets list under the badge. */
  openTagMenu: (anchor: HTMLElement) => void;
  /** Open the `⋮` menu under the overflow button. */
  openOverflow: (anchor: HTMLElement) => void;
  /** Open the merge-tag list under the Insert data button. */
  openMergeTags: (anchor: HTMLElement) => void;
  /** Escape: leave the bar for wherever the keyboard came from. */
  leaveBar: () => void;
  /** Apply the URL now in the link field. */
  applyLink: (href: string) => void;
  /** Take the link off the range. */
  removeLink: () => void;
  /**
   * The drag handle, announced as the runtime creates it (studio-ui-guidelines.md §9.4).
   *
   * The document draws the node; the flow attaches the pragmatic-dnd registration, because what a
   * drag CARRIES is the selection's path and whether one may start at all is a structural question
   * about the document. Called again whenever the node is re-created, which is every time the bar
   * is hidden and shown, so the flow releases before it installs.
   */
  onDragHandle: (element: HTMLElement) => void;
}

/** The scope `block-action-bar.json` reads. */
interface BlockBarScope extends BlockBarView, Record<string, unknown> {
  linkValue: string;
  linkExisting: boolean;
  linkApplyLabel: string;
  linkX: number;
  linkY: number;
  run: (id: string) => void;
  selectParent: () => void;
  openTagMenu: (scope: JxScope, event: Event) => void;
  openOverflow: (scope: JxScope, event: Event) => void;
  openMergeTags: (scope: JxScope, event: Event) => void;
  leaveBar: () => void;
  guardFocus: (scope: JxScope, event: Event) => void;
  linkInput: (scope: JxScope, event: Event) => void;
  applyLink: () => void;
  removeLink: () => void;
  closeLink: () => void;
}

/** A `jx-popover`, with the two members a host is allowed to touch. */
type PopoverElement = HTMLElement & {
  open?: boolean;
  showPopover: (options?: { source?: Element }) => void;
};

/** The empty projection: what the bar is before a selection has ever been made. */
export function emptyBlockBarView(): BlockBarView {
  return {
    anchorVars: "",
    canDrag: false,
    dragHint: "",
    formats: [],
    hasOverflow: false,
    offscreen: false,
    overflowOpen: false,
    parentDisabled: true,
    parentHint: "",
    parentLabel: "Select Parent",
    showFormat: false,
    tagDisabled: true,
    tagHint: "",
    tagLabel: "",
    tagPopup: "",
    verbs: [],
    visible: false,
  };
}

/** A node definition's `part`, as written in the document. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * A mapped button's command id, read out of the node's own `$map` scope.
 *
 * Off the scope rather than off the element, because `onNodeCreated` fires BEFORE the runtime
 * applies attributes — so the node that has just been created carries neither its `part` nor its
 * `data-command-id` yet, and a check on either answers no for exactly the node being recorded. The
 * same shape `surfaces/schema-form.ts` and `surfaces/properties-panel.ts` use.
 */
function commandIdOf(state: JxScope | undefined): string {
  const item = (state?.["$map"] as { item?: Record<string, unknown> } | undefined)?.item;
  const id = item?.["id"];
  return typeof id === "string" ? id : "";
}

/** The bar's mounted surface, and every handle the flow is allowed to reach back through. */
export interface BlockBarSurface {
  /** State what the bar says. Assignment only — a repaint never rebuilds the mount. */
  readonly update: (view: BlockBarView) => void;
  /** The bar element itself, or null while it is hidden or the mount is still in flight. */
  readonly bar: () => HTMLElement | null;
  /** The toolbar `jx-action-group`, which owns the roving caret. */
  readonly toolbar: () => HTMLElement | null;
  /** A rendered button by its command id — the link panel's anchor, and nothing else. */
  readonly button: (id: string) => HTMLElement | null;
  /** Show the link panel under `anchor`, prefilled from the range's existing link. */
  readonly openLink: (anchor: HTMLElement, href: string | null, existing: boolean) => void;
  /** Close the link panel. A no-op when it is not open. */
  readonly closeLink: () => void;
  /** Whether the link panel is showing. */
  readonly linkOpen: () => boolean;
}

/**
 * Mount the bar into the layer slot the flow owns.
 *
 * @param host The `popover` layer slot; the document clears it, so nothing else may draw there.
 * @param actions What each control does.
 */
export function mountBlockActionBar(host: HTMLElement, actions: BlockBarActions): BlockBarSurface {
  const buttons = new Map<string, HTMLElement>();
  let barEl: HTMLElement | null = null;
  let toolbarEl: HTMLElement | null = null;
  let linkEl: PopoverElement | null = null;
  let linkFieldEl: (HTMLElement & { value?: string }) | null = null;
  let linkShowing = false;

  const closeLink = (): void => {
    linkShowing = false;
    if (linkEl?.open) {
      linkEl.hidePopover();
    }
  };

  const scope: BlockBarScope = reactive<BlockBarScope>({
    ...emptyBlockBarView(),
    applyLink: () => {
      const href = scope.linkValue;
      closeLink();
      actions.applyLink(href);
    },
    closeLink,
    guardFocus: (_scope: JxScope, event: Event) => {
      /* The bar must not take the caret out of the canvas. The two exceptions are the affordances
         that NEED the press: a native drag never starts from a prevented mousedown, and the badge's
         convert list is a menu that takes focus of its own. The link panel is the third, because a
         URL field the press cannot reach is a field nobody can type in. */
      const { target } = event;
      if (
        target instanceof Element &&
        target.closest('[part="drag-handle"], [part="tag"], [part="link"]')
      ) {
        return;
      }
      event.preventDefault();
    },
    leaveBar: () => actions.leaveBar(),
    linkApplyLabel: "Apply",
    linkExisting: false,
    linkInput: (_scope: JxScope, event: Event) => {
      const value = (event.target as { value?: unknown } | null)?.value;
      scope.linkValue = typeof value === "string" ? value : "";
    },
    linkValue: "",
    linkX: 0,
    linkY: 0,
    openMergeTags: (_scope: JxScope, event: Event) => {
      event.stopPropagation();
      actions.openMergeTags(event.currentTarget as HTMLElement);
    },
    openOverflow: (_scope: JxScope, event: Event) => {
      event.stopPropagation();
      actions.openOverflow(event.currentTarget as HTMLElement);
    },
    openTagMenu: (_scope: JxScope, event: Event) => {
      event.stopPropagation();
      actions.openTagMenu(event.currentTarget as HTMLElement);
    },
    removeLink: () => {
      closeLink();
      actions.removeLink();
    },
    run: (id: string) => actions.run(id),
    selectParent: () => actions.selectParent(),
  }) as BlockBarScope;

  /* One mount for the life of the window, and no teardown to write. The bar is chrome the app
     never takes down: `dismissBlockActionBar` hides it through `visible`, and its layer slot is
     never cleared — so a `dispose()` here would be a door nothing walks through and a promise
     nothing keeps. */
  void mountSurface("block-action-bar", scope, host, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const part = partOf(def);
      if (part === "bar") {
        barEl = element;
        return;
      }
      if (part === "tools") {
        toolbarEl = element;
        return;
      }
      if (part === "link") {
        linkEl = element as PopoverElement;
        return;
      }
      if (part === "link-field") {
        linkFieldEl = element;
        return;
      }
      if (part === "drag-handle") {
        actions.onDragHandle(element);
        return;
      }
      const id = part === "verb" || part === "format-button" ? commandIdOf(state) : "";
      if (id !== "") {
        buttons.set(id, element);
      }
    },
  });

  return {
    bar: () => (barEl?.isConnected === true ? barEl : null),
    button: (id) => {
      const el = buttons.get(id) ?? null;
      return el?.isConnected === true ? el : null;
    },
    closeLink,
    linkOpen: () => linkShowing,
    openLink(anchor, href, existing) {
      scope.linkValue = href ?? "";
      scope.linkExisting = existing;
      scope.linkApplyLabel = existing ? "Update" : "Apply";
      linkShowing = true;
      const panel = linkEl;
      if (!panel) {
        return;
      }
      /*
       * Placing is by measured coordinate — the anchor's box, read here rather than bound in the
       * document, which is the one measurement §9.4 leaves on this side of the seam — and showing
       * is the element's own `showPopover`.
       *
       * A custom element connects asynchronously, so the panel may not yet carry the `popover`
       * attribute that makes it showable: `jx-ready` is the element saying it does. The same
       * handshake `surfaces/menu.ts` waits on, and the reason it is a branch rather than an
       * unconditional wait is that a second press on the Link button arrives long after the first
       * `jx-ready` has fired and gone.
       */
      const show = (): void => {
        if (!linkShowing) {
          return;
        }
        const box = rectOf(anchor);
        scope.linkX = Math.round(box.left);
        scope.linkY = Math.round(box.bottom);
        panel.showPopover({ source: anchor });
        linkFieldEl?.focus();
      };
      if (panel.hasAttribute("popover")) {
        show();
      } else {
        panel.addEventListener("jx-ready", show, { once: true });
      }
    },
    toolbar: () => (toolbarEl?.isConnected === true ? toolbarEl : null),
    update(view) {
      if (!view.visible) {
        closeLink();
      }
      Object.assign(scope, view);
    },
  };
}
