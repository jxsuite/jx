/// <reference lib="dom" />
/**
 * The Inspector's Content tab as a mounted document.
 *
 * `panels/properties-panel.ts` is the flow — which attributes apply to this tag, which cascade a
 * value came from, which rung of the value ladder the position permits, what a keystroke is worth
 * and what a commit writes — and this is the surface it draws into. Nothing here knows what an
 * attribute is, what a component prop is, or that a `$ref` is a binding: the scope is a list of
 * sections whose every row is already decided.
 *
 * **One row vocabulary, five shapes.** A section's body is a single list, and each entry names the
 * shape it is drawn as — a `field` (label, provenance chip, value-source chip, control, error), a
 * `kv` pair, a `note` sentence, an `action` link, or a `file` the Usage list offers to open. The
 * densest surface in the application had five hand-written row templates that differed in their
 * markup and agreed about nothing; they differ now in one string.
 *
 * **`data-prop` is load-bearing and stays exactly as it was.** `ui/regions.ts` resolves
 * `inspector/field:<prop>` by finding `[data-prop]` inside the Inspector, and the screenshot
 * manifest has addressed the `href` row through it since the region grammar landed. A row emits it
 * whatever shape it is drawn as.
 *
 * **A control host is announced, never queried.** Three leaves are drawn by somebody else — the
 * media picker, the colour selector and the expression editor, each of which is its own surface
 * with its own readers elsewhere — so the document draws an empty `[part="control-host"]` for them
 * and the flow fills it, which is the seam `ui/schema-form.ts` established for a registered
 * control. The runtime reports the host through `onNodeCreated` as it is created, so the flow holds
 * the element rather than re-finding it by selector on every repaint. TWO of the three are still
 * lit; the media picker is a document mounted into the same box, which is why the seam hands over
 * the HOST rather than taking a template back.
 *
 * @docs studio/design/properties
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import propertiesPanelDoc from "./properties-panel.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxScope } from "@jxsuite/runtime/types";
import type { JxDocument, JxElement } from "@jxsuite/schema/types";

registerSurface("properties-panel", propertiesPanelDoc as unknown as JxDocument);

/** Which control a `field` row draws. The flow picks it; the document switches on it. */
export type ContentFieldKind =
  | "text"
  | "textarea"
  | "checkbox"
  | "number"
  | "select"
  | "link"
  | "color"
  | "control";

/** What a row is drawn as. Everything a section body can hold is one of these. */
export type ContentRowShape = "field" | "kv" | "note" | "action" | "file";

/**
 * One colour the project has named, as a `color` row's palette draws it.
 *
 * The same three fields the Style tab projects, and for the same reason: `value` is the reference a
 * click commits, `color` is only how it reads on screen, and `label` is what a reader hears.
 */
export interface ContentTokenView extends Record<string, unknown> {
  value: string;
  color: string;
  label: string;
}

/** A choice a select offers, in the shape the kit's select reads. */
export interface ContentOption {
  value: string;
  label: string;
}

/**
 * One row of a section — every field already decided, whatever shape it is.
 *
 * Fields that belong to another shape are still present and empty, because a document branches on a
 * flag and never on the presence of a key.
 */
export interface ContentRowView {
  /** The row's reconcile identity AND what every callback hands back. */
  key: string;
  shape: ContentRowShape;
  /** `data-prop` — what `inspector/field:<prop>` addresses. Every shape carries one. */
  prop: string;
  /** The visible label of a `field`; the accessible name of a `kv` pair's controls. */
  label: string;
  kind: ContentFieldKind;
  /** The value as the control reads it — a string for every kind but `checkbox`. */
  value: string;
  /**
   * A `color` row whose value is a token reference: the literal behind it, so the field's chip can
   * draw a colour this page cannot resolve. Empty on every other row and for a literal value.
   */
  resolved: string;
  checked: boolean;
  placeholder: string;
  /** Draw the text control monospaced — a template, a pointer, a code-ish value. */
  mono: boolean;
  /** Choices for `select`; the routes or the popover ids for a `link`'s value half. */
  options: ContentOption[];
  /** The palette a `color` row offers inside its picker, and whether it has one to offer. */
  tokens: ContentTokenView[];
  hasTokens: boolean;
  /**
   * The provenance chip's shape: `""` draws nothing (§6.2's `default` state, where absence IS the
   * ghost), `dot` is the 6px accent dot that clears the value, `text` states a donor without
   * offering to go there, and `press` states one and opens it.
   */
  chip: "" | "dot" | "text" | "press";
  /** `set` / `inherited` / `bound` / `mixed` — the chip's colour, as an attribute to style on. */
  chipState: string;
  chipText: string;
  chipTitle: string;
  /** Whether the value ladder is on offer at this position at all. */
  hasSource: boolean;
  /** The rung's name in the ladder's own vocabulary — "Fixed value", "From data…". */
  sourceLabel: string;
  /** The chip's accessible name and its tooltip. */
  sourceName: string;
  /** The position permits exactly one rung, so the chip states it and refuses to open. */
  sourceLocked: boolean;
  /** `"bound"` once the value is produced from something else; `"fixed"` while it is typed. */
  source: string;
  /** A `link` row's kind half: the chosen kind, and the five it chooses between. */
  linkKind: string;
  kindOptions: ContentOption[];
  /** `route` draws a picker of the site's own routes; `text` draws a field. */
  linkValueKind: string;
  /** A `kv` pair's key cell, and the remove button's accessible name. */
  name: string;
  removeLabel: string;
  /** A `note`'s sentence, an `action`'s label, a `file`'s path. */
  text: string;
  /** A `file`'s reference count, drawn hard right. */
  detail: string;
  /** A `file`'s tooltip: which references, and how many of each. */
  title: string;
}

/** One accordion section: a heading, a disclosure state, a tally dot, and its rows. */
export interface ContentSectionView {
  /** The section key — its reconcile identity and what `inspector.setSection` addresses. */
  key: string;
  label: string;
  open: boolean;
  /** Whether anything in this section is set, so a closed section still says so (§6.2). */
  hasDot: boolean;
  dotTitle: string;
  rows: ContentRowView[];
}

/** A button an empty state offers — the action that fills the region. */
export interface ContentEmptyAction {
  id: string;
  label: string;
}

/** Everything the document reads. */
export interface ContentPanelView {
  /**
   * Which of the three things the tab is showing: nothing it can edit, a layout element it may only
   * describe, or the element's own sections.
   */
  view: "empty" | "layout" | "content";
  /** The empty state's own words (`panels/empty-state.ts`'s copy rules, drawn here). */
  emptyMessage: string;
  emptyDetail: string;
  hasEmptyDetail: boolean;
  emptyActions: ContentEmptyAction[];
  hasEmptyActions: boolean;
  /** The layout card: the tag clicked, its class, the file it came from. */
  layoutTag: string;
  layoutClass: string;
  layoutHasClass: boolean;
  layoutNote: string;
  /** Whether `pane.derive` can run from the focused pane; a chip that cannot act is not drawn. */
  layoutCanOpen: boolean;
  sections: ContentSectionView[];
}

/** What a control can ask the panel to do. Every one of them is a decision the flow owns. */
export interface ContentPanelActions {
  /** A keystroke in a text control: the flow drafts and debounces. */
  edit: (key: string, value: string) => void;
  /** A committed value — a change event, a picked option, a blur. */
  commit: (key: string, value: string) => void;
  commitChecked: (key: string, checked: boolean) => void;
  /** A `link` row's kind half, which reinterprets the current value under the new kind. */
  commitKind: (key: string, kind: string) => void;
  /** Open the value-source picker over the chip that was clicked. */
  pickSource: (key: string, anchor: HTMLElement) => void;
  /** The provenance chip: clear, jump to the donor, or open the source. */
  chipAction: (key: string) => void;
  /** A `kv` pair's two cells and its remove button. */
  editName: (key: string, name: string) => void;
  editValue: (key: string, value: string) => void;
  removeRow: (key: string) => void;
  /** An `action` row, and a `file` row. */
  runAction: (key: string) => void;
  openFile: (key: string) => void;
  /** An empty state's button. */
  runEmptyAction: (id: string) => void;
  /** A section's disclosure, from the accordion's own toggle. */
  setSection: (key: string, open: boolean) => void;
  /** The layout card's one chip. */
  openLayout: () => void;
}

export interface ContentPanelSurface {
  /** Bring the standing document up to date with a whole projection. */
  readonly update: (view: ContentPanelView) => void;
  /** Take the document down. Idempotent. */
  readonly dispose: () => void;
}

/** A control host the document drew, reported as the runtime created it. */
export type ContentControlSink = (key: string, host: HTMLElement) => void;

interface ContentPanelScope
  extends Record<string, unknown>, ContentPanelView, ContentPanelActions {}

/** The scope's starting shape, before the first projection lands on it. */
export function emptyContentView(): ContentPanelView {
  return {
    emptyActions: [],
    emptyDetail: "",
    emptyMessage: "",
    hasEmptyActions: false,
    hasEmptyDetail: false,
    layoutCanOpen: false,
    layoutClass: "",
    layoutHasClass: false,
    layoutNote: "",
    layoutTag: "element",
    sections: [],
    view: "empty",
  };
}

/** Write a projection into the scope. Assignment by assignment, so an unchanged field is inert. */
function project(scope: ContentPanelScope, values: ContentPanelView): void {
  scope.view = values.view;
  scope.emptyMessage = values.emptyMessage;
  scope.emptyDetail = values.emptyDetail;
  scope.hasEmptyDetail = values.hasEmptyDetail;
  scope.emptyActions = values.emptyActions;
  scope.hasEmptyActions = values.hasEmptyActions;
  scope.layoutTag = values.layoutTag;
  scope.layoutClass = values.layoutClass;
  scope.layoutHasClass = values.layoutHasClass;
  scope.layoutNote = values.layoutNote;
  scope.layoutCanOpen = values.layoutCanOpen;
  scope.sections = values.sections;
}

/**
 * The row a control host belongs to, read out of the node's own `$map` scope.
 *
 * Off the scope rather than off the element, because `onNodeCreated` fires BEFORE the runtime
 * applies attributes — so a node that has just been created carries neither its `part` nor any
 * `data-` of its own yet, and a check on either answers no for exactly the node that needs filling.
 * The same reasoning, and the same shape, as `surfaces/schema-form.ts`.
 */
function controlKeyOf(part: string, state: JxScope | undefined): string {
  if (part !== "control-host") {
    return "";
  }
  const item = (state?.["$map"] as { item?: Record<string, unknown> } | undefined)?.item;
  const key = item?.["key"];
  return typeof key === "string" ? key : "";
}

/** A node definition's `part`, as written in the document. */
function partOf(def: JxElement | string): string {
  const part = typeof def === "string" ? undefined : def.attributes?.["part"];
  return typeof part === "string" ? part : "";
}

/**
 * Mount the Content tab's document into the container the Inspector owns.
 *
 * The container is the tab's own body and nothing else renders into it, so the document is free to
 * clear it — which is the difference between this seam and a Navigator panel's, where lit's comment
 * markers have to survive. `panels/right-panel.ts` hands it over once, for the life of the window.
 *
 * @param container The Inspector's `properties` tab body.
 * @param values The projection to begin with.
 * @param actions What each control does.
 * @param onControlHost Called for every lit-owned control host the document draws, as it is drawn.
 */
export function mountContentSurface(
  container: HTMLElement,
  values: ContentPanelView,
  actions: ContentPanelActions,
  onControlHost: ContentControlSink,
): ContentPanelSurface {
  const scope = reactive<ContentPanelScope>({
    ...emptyContentView(),
    ...actions,
  }) as ContentPanelScope;
  project(scope, values);

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  void mountSurface("properties-panel", scope, container, {
    onNodeCreated: (element, _path, def, state) => {
      if (!(element instanceof HTMLElement)) {
        return;
      }
      const key = controlKeyOf(partOf(def), state);
      if (key !== "") {
        onControlHost(key, element);
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
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    update(next) {
      if (!disposed) {
        project(scope, next);
      }
    },
  };
}
