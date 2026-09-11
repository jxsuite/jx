/// <reference lib="dom" />
/**
 * The Content tab — everything about WHAT this element is and says.
 *
 * Plan §6.5 re-split the inspector by task. Content is the element itself (tag, id, class, text),
 * its HTML attributes, its link target, its custom attributes, its component props and its media.
 * Three things left, and each left for a place that already had a better claim on it:
 *
 * - **Repeater · Switch · Observed Attributes · CSS Properties · CSS Parts → the Logic tab.** Wiring
 *   a `$switch` and wiring a click handler are the same task (`panels/events-panel.ts`).
 * - **The Page section → the Document Header card.** `panels/head-panel.ts` owns the one layout
 *   picker; this panel drew a second one that could disagree with it.
 * - **Media breakpoint DEFINITIONS → Project Settings › Contexts** (P4). Nothing remains here: the
 *   only reason adding a breakpoint used to cost you your element selection.
 *
 * **This module decides; `surfaces/properties-panel.json` draws.** Every question with an answer —
 * which attributes apply to this tag, which cascade a value came from, which rungs of the value
 * ladder the position permits, what a keystroke is worth, and what a commit writes — is answered
 * here and handed over as sections whose every row is already decided. The document holds the
 * markup, the ARIA and the style, and holds no idea what an attribute is.
 *
 * **It does not go through the panel scheduler, and that is the point.**
 * `panels/panel-scheduler.ts` withholds a repaint while a text input inside the dock has focus,
 * because a lit repaint rebuilds the field the reader is typing into and takes the caret with it. A
 * document has one effect per bound property and skips a write equal to what is already there, so
 * the Content tab is updated in place: the rows that changed change, the field being typed in is
 * untouched, and there is nothing to guard against. What survives is the DRAFT layer
 * (`ui/field-input.ts`), which is a different promise — it is what keeps a half-typed value from
 * being replaced by the last committed one, and what keys that half-typed value to the NODE rather
 * than to the field's name (§11.4).
 *
 * **Two leaves are drawn elsewhere**, and each is its own surface with readers outside this tab:
 * the media picker and the expression editor. The document draws an empty `[part="control-host"]`
 * for them and this module fills it, which is the seam `ui/schema-form.ts` established for an
 * extension's registered control. The expression editor is lit and is RENDERED into the box; the
 * media picker is a document and is MOUNTED into it, so a `control` takes the host instead of
 * returning a template — a document cannot be handed back as a value, and it clears the host it is
 * given. There were three: a `format: "color"` prop was the middle one, and it is a
 * `jx-color-field` in the document now that `ui.md` §5.6 has landed.
 *
 * @docs studio/design/properties
 */

import { getNodeAtPath } from "../store";
import { effect, effectScope, reactive } from "../reactivity";
import { displayTagName, isRef, isTagExpression } from "@jxsuite/schema/guards";
import type { DirEntry, JsonValue } from "../types";
import {
  mutateUpdateAttribute,
  mutateUpdateDef,
  mutateUpdateProp,
  mutateUpdateProperty,
  transactDoc,
} from "../tabs/transact";
import { activeTab, workspace } from "../workspace/workspace";
import { deriveRefusal } from "../workspace/pane-derive";
import { primarySelection, unifyValues } from "../tabs/selection";
import { shell } from "../shell";
import {
  argsSchema,
  booleanArg,
  booleanProperty,
  stringArg,
  stringProperty,
} from "../commands/command-args";
import type { LayoutSelection } from "../shell";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import { activeRegistry } from "../commands/active-registry";
import { componentRegistry } from "../files/components";
import { provenanceText, provenanceTitle } from "./provenance";
import type { FieldProvenance } from "./provenance";
import {
  effectiveSlotMode,
  hasStashedSlotValue,
  slotModeSeed,
  stashSlotValue,
  switchSlotMode,
} from "../ui/dynamic-slot";
import {
  TAG_EXPRESSION_OPERATORS,
  VALUE_SOURCE_LABELS,
  slotCaps,
  slotMode,
} from "../ui/value-source";
import type { SlotCapsSource, SlotMode } from "../ui/value-source";
import {
  clearDraft,
  commitField,
  getFieldValue,
  hasDraft,
  scheduleDraftCommit,
  setDraft,
} from "../ui/field-input";
import { INPUT_DEBOUNCE, LIVE_PREVIEW } from "../ui/timing";
import { cloneValue } from "../tabs/doc-op-apply";
import { rectOf } from "../utils/geometry";
import { openMenu } from "../surfaces/menu";
import type { MenuHandle } from "../surfaces/menu";
import {
  attrLabel,
  camelToLabel,
  inferInputType,
  isMediaFormat,
  parseCemType,
} from "../utils/studio-utils";
import { classifyHref, composeHref } from "../utils/link-target";
import type { LinkKind } from "../utils/link-target";
import { clickAnythingTo, openPageAction, staleSelectionMessage } from "./empty-state";
import { mountMediaPicker, unmountMediaPicker } from "../ui/media-picker";
import { colorTokens } from "../ui/color-selector";
import { mountExpressionEditor } from "../ui/expression-editor";
import {
  loadUsages,
  peekUsages,
  retryUsages,
  usageFiles,
  usageHeadline,
} from "../services/references";
import { getPlatform } from "../platform";
import htmlMeta from "../../data/html-meta.json";
import { popoverIdsIn } from "@jxsuite/schema/overlays";
import { POPOVER_TAGS } from "@jxsuite/ui";
import { showPromptDialog } from "../ui/layers";
import { emptyContentView, mountContentSurface } from "../surfaces/properties-panel";

import type {
  ContentOption,
  ContentPanelActions,
  ContentPanelSurface,
  ContentPanelView,
  ContentRowView,
  ContentSectionView,
} from "../surfaces/properties-panel";
import type {
  JxAttributeValue,
  JxElement,
  JxMutableNode,
  JxPrototypeDef,
  JxStateDefinition,
  JxStateObject,
} from "@jxsuite/schema/types";
import type { SignalOption } from "../ui/dynamic-slot";
import type { JxPath } from "../state";
import type { EffectScope } from "@vue/reactivity";

/** The picker's escape hatch: a popover declared in another file, typed by hand. */
const POPOVER_TARGET_OTHER = "jx:other";

/** The empty row a picker offers so a value can be taken away with the same control that set it. */
const CLEAR_OPTION: ContentOption = { label: "—", value: "" };

interface HtmlMetaEntry {
  $section: string;
  $order: number;
  $attr?: string;
  $elements?: string[];
  $label?: string;
  $input?: string;
  $shorthand?: boolean;
  type?: string;
  [key: string]: unknown;
}

// ─── The binding vocabulary, shared with the Logic tab ───────────────────────

/**
 * The two extra signals a position inside a repeater template can bind to, or `null` outside one.
 *
 * A "map" segment addresses a repeater template (`[…, "children", i, "map", …]`, or the legacy `[…,
 * "children", "map", …]`), so anything at or below it is inside one.
 *
 * Exported because Content and Logic both offer them and there is one right answer: a `$switch`
 * inside a `$map` can read `$map/item`, and so can the `alt` attribute two nodes below it.
 */
export function mapSignalsFor(path: JxPath): SignalOption[] | null {
  return path.includes("map")
    ? [
        { label: "$map/item", value: "$map/item" },
        { label: "$map/index", value: "$map/index" },
      ]
    : null;
}

/** State keys a value position may bind to — handlers and Functions are not values. */
export function bindableSignalNames(doc: JxMutableNode): string[] {
  return Object.entries(doc.state || {})
    .filter(
      ([, d]) =>
        !(d as Record<string, unknown>)?.$handler &&
        (d as JxPrototypeDef)?.$prototype !== "Function",
    )
    .map(([defName]) => defName);
}

/**
 * Render a state entry's default value as the static input text when unbinding.
 *
 * @param {import("@jxsuite/schema/types").JxStateDefinition | undefined} def
 * @returns {string}
 */
export function defaultAsString(def: JxStateDefinition | undefined) {
  if (!def || typeof def !== "object" || Array.isArray(def)) {
    return "";
  }
  const dv = (def as JxStateObject).default;
  if (dv === undefined) {
    return "";
  }
  return typeof dv === "object" ? JSON.stringify(dv) : String(dv);
}

/** Who a bound value comes from, in the fewest words that are true — the chip's donor text. */
function bindingDonor(value: unknown): string {
  if (isRef(value)) {
    const ref = value.$ref;
    return ref.startsWith("#/state/") ? ref.slice(8) : ref || "nothing yet";
  }
  return typeof value === "string" ? "a template" : "a formula";
}

/**
 * The state entry a bound value reads, when the chip can name one — a `$ref` or a `${…}` template.
 *
 * §6.2's table says a bound chip "click opens the source", and on the Content tab it did not: both
 * bound branches returned a `donor` and a `title` and no `onClick`, so the chip was drawn as a
 * handler-less span. The Style tab's chip has jumped to the Data panel since P5; the same promise
 * on the other tab was a label. Same regex as `style-panel.ts`'s `templateSignalOf`, because both
 * spellings of a template (`${x}` and `${state.x}`) name the same entry.
 */
function boundSignalOf(value: unknown): string | null {
  if (isRef(value)) {
    const ref = value.$ref;
    return ref.startsWith("#/state/") ? (ref.slice(8).split("/")[0] ?? null) : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  return /\$\{\s*(?:state\.)?([A-Za-z_$][\w$]*)/.exec(value)?.[1] ?? null;
}

/**
 * Reveal the state entry a bound field reads: the Data panel, and that entry's row.
 *
 * Both verbs, because the rail tab alone leaves you looking at a collapsed list — the same pair the
 * Style tab's chip runs.
 */
function revealSignal(name: string): void {
  const registry = activeRegistry();
  void registry?.run("view.setActivity", { tab: "data" });
  void registry?.run("data.expandRow", { name });
}

/**
 * The bound chip, naming its donor and — when the donor is a state entry — opening it.
 *
 * The entry list is read here rather than threaded through both callers' signatures: the two
 * provenance functions differ in everything else, and the question "does this document define
 * `title`?" has one answer that neither of them should have to be handed.
 */
function boundProvenance(value: unknown, title: string): FieldProvenance {
  const signal = boundSignalOf(value);
  const document = activeTab.value?.doc.document;
  const known = signal && document ? bindableSignalNames(document).includes(signal) : false;
  return {
    donor: bindingDonor(value),
    state: "bound",
    title,
    // Only when the document actually defines it: a chip that jumps to a row that is not there
    // Would be a worse answer than a chip that does not jump.
    ...(known && signal ? { onClick: () => revealSignal(signal) } : {}),
  };
}

/**
 * Is the selected node an INSTANCE of a component, or the definition of one?
 *
 * A component's own root tag has a hyphen, so "the tag contains a dash" answers yes to both — and
 * that is what put the instance form in front of someone editing the component itself. The
 * distinguishing fact is whose document this is: if the component's definition path IS the open
 * file, there is no instance, no override and no donor to jump to.
 */
export function isComponentDefinitionOpen(node: JxMutableNode): boolean {
  const comp = componentRegistry.find((c) => c.tagName === displayTagName(node.tagName));
  const open = activeTab.value?.documentPath;
  return comp?.path !== undefined && open !== undefined && comp.path === open;
}

/**
 * Which of §6.2's four states a component-prop row is in.
 *
 * Bound beats set (a `$ref` IS a value, but "bound to `title`" is the more useful sentence); set
 * beats inherited; a prop with no declared default and no value is plain Default and draws
 * nothing.
 */
function componentPropProvenance(
  prop: { name: string; default?: unknown; description?: string },
  rawValue: unknown,
  hasVal: boolean,
  actions: {
    onClear: () => void;
    openDefinition?: (() => void) | undefined;
    /** Editing the component itself, where there is no instance and therefore no donor. */
    isDefinition?: boolean;
  },
): FieldProvenance {
  if (hasVal && slotMode(rawValue) !== "literal") {
    return boundProvenance(rawValue, `Bound — ${prop.name}`);
  }
  if (hasVal) {
    return { onClick: actions.onClear, state: "set", title: `Clear ${prop.name}` };
  }
  /* INHERITED is a statement about somewhere ELSE, so it cannot be true here. In the definition an
     unset field means this component ships no default for that setting — which is `default`, the
     state that draws nothing, not a badge pointing at itself. */
  if (prop.default !== undefined && !actions.isDefinition) {
    return {
      donor: "the component default",
      state: "inherited",
      title: `Not set here — the component's default (${String(prop.default)}) applies`,
      ...(actions.openDefinition ? { onClick: actions.openDefinition } : {}),
    };
  }
  return { state: "default" };
}

/** Which of §6.2's states an HTML-attribute row is in. Attributes have no third cascade layer. */
function attributeProvenance(
  attr: string,
  value: unknown,
  hasVal: boolean,
  onClear: () => void,
  mixedCount = 0,
): FieldProvenance {
  // Mixed first, for the same reason the Style tab decides it first: it is a fact about the
  // SELECTION, and the primary's own value says nothing about whether the others agree. A count of
  // 0 (a selection of one) can never reach this branch, so single-selection rows are untouched.
  if (mixedCount > 0) {
    return { donor: String(mixedCount), onClick: onClear, state: "mixed" };
  }
  if (hasVal && (isRef(value) || (typeof value === "string" && value.includes("${")))) {
    return boundProvenance(value, `Bound — ${attr}`);
  }
  return hasVal ? { onClick: onClear, state: "set", title: `Clear ${attr}` } : { state: "default" };
}

/**
 * How many selected elements disagree about `key` on `read` — 0 when they agree or there is one.
 *
 * The Content tab's two cascades (HTML attributes and component props) both need the same answer
 * about the same set, so the question is asked once here and answered with `unifyValues`, the same
 * comparison the Style tab uses.
 */
export function mixedAcrossSelection(
  doc: JxMutableNode,
  targets: readonly JxPath[],
  read: (node: JxMutableNode | undefined) => unknown,
): number {
  if (targets.length < 2) {
    return 0;
  }
  const values = targets.map((path) => read(getNodeAtPath(doc, path) as JxMutableNode | undefined));
  return unifyValues(values).mixed ? targets.length : 0;
}

/**
 * True when an attribute value is a binding (a `$ref` object or a template string containing
 * `${…}`), so the Link-target special-case must fall back to the raw widget to keep it editable.
 */
function isBoundAttrValue(value: unknown): boolean {
  return isRef(value) || (typeof value === "string" && value.includes("${"));
}

// ─── Page-route enumeration (for the Link-target Internal picker) ─────────────

/** Cached list of internal routes derived from the pages/ tree; `null` until one is asked for. */
let pageRouteEntries: string[] | null = null;

/** Whether a walk is already in flight, so a re-projection does not start a second one. */
let pageRoutesLoading = false;

/**
 * Derive a site route from a page file path relative to `pages/`, following the file-based routing
 * convention: `index.json` → the directory route, `[slug].json` → `:slug`, all others drop their
 * extension. Directory routes get a trailing slash (`/about/`); the root is `/`.
 */
function routeForPagePath(relPath: string): string {
  const withoutExt = relPath.replace(/\.[^./]+$/, "");
  const segments = withoutExt
    .split("/")
    .map((seg) => (seg.startsWith("[") ? `:${seg.slice(1, -1)}` : seg));
  const isIndex = segments.at(-1) === "index";
  if (isIndex) {
    segments.pop();
  }
  const body = segments.join("/");
  if (!body) {
    return "/";
  }
  // Dynamic routes keep no trailing slash; static routes are directory-style (trailing slash).
  return isIndex || body.includes(":") ? `/${body}${isIndex ? "/" : ""}` : `/${body}/`;
}

/**
 * Recursively walk the pages/ tree and populate {@link pageRouteEntries} with derived routes.
 *
 * The in-flight flag is released in a `finally` rather than after the walk: the projection starts
 * this whenever the cache is empty, so a host with no platform registered — which throws on the
 * first line — would otherwise leave the flag raised and the routes unenumerable for the life of
 * the window.
 */
async function loadPageRouteEntries() {
  pageRoutesLoading = true;
  const routes: string[] = [];
  const docExts = new Set([".json", ".md", ".html"]);
  try {
    const platform = getPlatform();
    const walk = async (dir: string, rel: string): Promise<void> => {
      let listing: DirEntry[];
      try {
        listing = await platform.listDirectory(dir);
      } catch {
        return;
      }
      for (const entry of listing) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.type === "directory") {
          await walk(entry.path ?? `${dir}/${entry.name}`, childRel);
        } else if (docExts.has(entry.name.slice(entry.name.lastIndexOf(".")))) {
          routes.push(routeForPagePath(childRel));
        }
      }
    };
    await walk("pages", "");
    pageRouteEntries = [...new Set(routes)].toSorted((a, b) => a.localeCompare(b));
  } finally {
    pageRoutesLoading = false;
  }
  renderPropertiesPanel();
}

export function invalidatePageRouteCache() {
  pageRouteEntries = null;
  renderPropertiesPanel();
}

// ─── Section state ────────────────────────────────────────────────────────────

/**
 * The Inspector's fixed section keys — the accordion rows the inspector always draws.
 *
 * Attribute-schema sections add their own keys at render time (a class's `$section`), so this is a
 * floor, not a closed set: {@link inspectorSectionKeys} unions it with whatever the OPEN DOCUMENT
 * declares, and that union is what `inspector.setSection` validates against. A fixed enum would
 * refuse a section the user is looking at; no validation at all would accept the label the old
 * `inspector.toggleSection` step passed ("Element", not `__element`) and silently do nothing.
 *
 * `__media` left with the breakpoint definitions, which are Project Settings › Contexts now (P4).
 * `__observed`, `__cssprops` and `__cssparts` are drawn by the Logic tab; the key space is the
 * INSPECTOR's, not one tab's, so `inspector.setSection` keeps addressing all of them.
 */
export const INSPECTOR_SECTION_KEYS = [
  "__element",
  "__observed",
  "__usages",
  "__custom",
  "__cssprops",
  "__cssparts",
] as const;

export type InspectorSectionKey = (typeof INSPECTOR_SECTION_KEYS)[number];

/** The Component Settings section's key — recorded rather than fixed, like an attribute section. */
const PROPS_SECTION = "__props";

/**
 * The Usage section's key, in the same per-tab `inspectorSections` record every other section uses,
 * so `inspector.setSection` addresses it exactly like the rest and nothing needs a second store.
 */
const USAGES_SECTION = "__usages";

/** Section keys addressable right now: the fixed rows plus any already recorded for this tab. */
export function inspectorSectionKeys(): string[] {
  const recorded = Object.keys(activeTab.value?.session.ui.inspectorSections ?? {});
  return [...new Set<string>([...INSPECTOR_SECTION_KEYS, ...recorded])];
}

/**
 * Whether one Inspector section is expanded, falling back to the caller's default.
 *
 * The fallback is the caller's because it is not a constant: an attribute section opens itself when
 * one of its attributes is set, and Usage never does. Only the panel drawing the row knows.
 */
export function isInspectorSectionOpen(section: string, fallback: boolean): boolean {
  const recorded = activeTab.value?.session.ui.inspectorSections?.[section];
  return recorded === undefined ? fallback : recorded;
}

/**
 * Open or close one Inspector section, per tab.
 *
 * The pair `{ section, open }` is the whole point: `inspector.toggleSection` named a DELTA against
 * a section whose state depended on the selected node's own attributes (`autoOpen`), so the same
 * three manifest steps opened a section on one document and closed it on the next. Writing a new
 * object rather than mutating in place is what the reactive read in the projection depends on.
 */
export function setInspectorSection(section: string, open: boolean): void {
  const tab = activeTab.value;
  if (!tab) {
    return;
  }
  tab.session.ui.inspectorSections = { ...tab.session.ui.inspectorSections, [section]: open };
}

// ─── Row plans: how this module reads a gesture back ──────────────────────────

/** The ladder as one row holds it, so a rung change needs nothing re-derived. */
interface LadderPlan {
  fieldKey: string;
  mode: SlotMode;
  offered: SlotMode[];
  /** Every pointer the From data… rung offers, state entries and repeater signals alike. */
  sources: SignalOption[];
  /**
   * The state entries alone, kept apart from {@link sources} because `slotModeSeed` reads them
   * differently: a fresh Mixed text rung seeds `${state.<first>}` from a state entry and `${}` from
   * anything else, so folding the two lists into one is how a bound prop dropped to an empty
   * template instead of naming the signal it had just left.
   */
  stateDefs: string[];
  extraSignals: SignalOption[];
  value: JsonValue | undefined;
  onChange: (v?: JsonValue) => void;
  literalDefault: JsonValue | undefined;
  seedFor: ((mode: SlotMode) => JsonValue | undefined) | undefined;
}

/**
 * What a row's callbacks do. The document reports `commit("attr|href", "/about")` and nothing else;
 * everything needed to turn that into a document write was decided when the row was built.
 */
interface RowPlan {
  /** Turn a committed string into a document value. */
  commit?: ((raw: string) => void) | undefined;
  commitChecked?: ((checked: boolean) => void) | undefined;
  commitKind?: ((kind: string) => void) | undefined;
  /** The provenance chip's verb: clear it, jump to the donor, open the source. */
  chipAction?: (() => void) | undefined;
  /** An `action` row's verb, and a `file` row's path. */
  action?: (() => void) | undefined;
  openPath?: string | undefined;
  /** The draft key for a text control; absent when the row commits with no draft. */
  draft?: string | undefined;
  /** How long after a keystroke {@link commit} runs; `0` means only on change. */
  debounceMs: number;
  /**
   * A key/value pair's two draft keys, what each cell currently holds on disk, and the write that
   * lands both at once. The committed pair is carried because either cell may be edited alone, and
   * a missing draft has to fall back to the value that is actually there — reading `""` for the
   * name is how a value-only edit renamed the attribute to nothing.
   */
  kv?: {
    nameKey: string;
    valueKey: string;
    name: string;
    value: string;
    write: (name: string, value: string) => void;
  };
  ladder?: LadderPlan | undefined;
  /**
   * A leaf the document does not draw, given the empty box it drew for it.
   *
   * It takes the host rather than returning a template because the two leaves do not agree about
   * what drawing means: the expression editor is lit and renders into the box, the media picker is
   * a document and is MOUNTED into it. Both are idempotent, so a repaint calls this again rather
   * than deciding which of the two it is holding.
   */
  control?: ((host: HTMLElement) => void) | undefined;
}

/** A row view with every field filled in, before the caller narrows it. */
function blankRow(key: string, prop: string, label: string): ContentRowView {
  return {
    checked: false,
    chip: "",
    chipState: "",
    chipText: "",
    chipTitle: "",
    detail: "",
    hasSource: false,
    hasTokens: false,
    key,
    kind: "text",
    kindOptions: [],
    label,
    linkKind: "",
    linkValueKind: "text",
    mono: false,
    name: "",
    options: [],
    placeholder: "",
    prop,
    removeLabel: "",
    shape: "field",
    source: "fixed",
    sourceLabel: "",
    sourceLocked: false,
    sourceName: "",
    text: "",
    title: "",
    tokens: [],
    value: "",
  };
}

// ─── The panel ───────────────────────────────────────────────────────────────

/** Where a control is navigated to when a row asks to open a component definition. */
let navigateToComponent: (path: string) => void = () => {};

/** The mounted document, once the Inspector has handed over its container. */
let surface: ContentPanelSurface | null = null;

/** The effect that watches everything the projection reads. */
let panelScope: EffectScope | null = null;

/** Row key → what its callbacks do. Rebuilt by every projection. */
const plans = new Map<string, RowPlan>();

/** The lit-owned control hosts the document has announced, by row key. */
const controlHosts = new Map<string, HTMLElement>();

/**
 * Every draft key this tab has minted.
 *
 * `ui/field-input.ts`'s draft map is module-global and a draft deliberately OUTLIVES the commit it
 * provoked — that is what keeps a field controlled by the text in it until the reader blurs. So the
 * one moment a draft of this tab's is certainly dead is when the tab is unbound, and nothing but
 * this set knows which of them were ours.
 */
const draftKeys = new Set<string>();

/** Mint a draft key, remembering it for the unbind. */
function draft(key: string): string {
  draftKeys.add(key);
  return key;
}

/** The rung picker, while one is up. One at a time, and it goes down with the panel. */
let sourceMenu: MenuHandle | null = null;

/**
 * The repaint signal for state no reactive store carries — the component registry, the usage cache
 * and the route walk, each of which lands asynchronously and used to repaint through
 * `renderOnly("rightPanel")`.
 */
const pulse = reactive({ tick: 0 });

/** Whether a projection is already queued for the end of this tick. */
let projectionQueued = false;

/**
 * Ask the Content tab to re-read the world.
 *
 * Three of the facts the projection reads are NOT reactive stores — the component registry, the
 * usage cache and the enumerated page routes — so they announce themselves here. Every other
 * repaint arrives through the watcher below, which is why this is a signal rather than a render
 * call.
 */
export function renderPropertiesPanel(): void {
  /* The pulse is the whole of it: the watcher reads it, so a bump reaches the same coalescer every
     other fact does. A second queue here would be a second scheduler for one surface. */
  pulse.tick += 1;
}

/**
 * Hand the Content tab its container, and subscribe to the state it draws.
 *
 * `null` unbinds — the document goes down and the watcher stops — which is what the Inspector's own
 * teardown needs. The same seam rather than a second export, for the reason `panels/ai-panel.ts`
 * gives: a teardown nothing but a teardown reaches is one the reachability ledger has to carry.
 */
export function bindContentHost(
  el: HTMLElement | null,
  ctx?: { navigateToComponent: (path: string) => void },
): void {
  panelScope?.stop();
  panelScope = null;
  surface?.dispose();
  surface = null;
  plans.clear();
  for (const host of controlHosts.values()) {
    unmountMediaPicker(host);
  }
  controlHosts.clear();
  for (const key of draftKeys) {
    clearDraft(key);
  }
  draftKeys.clear();
  sourceMenu?.close();
  sourceMenu = null;
  if (!el) {
    return;
  }
  navigateToComponent = ctx?.navigateToComponent ?? (() => {});
  surface = mountContentSurface(el, emptyContentView(), ACTIONS, (key, host) => {
    controlHosts.set(key, host);
    paintControl(key, host);
  });
  panelScope = effectScope();
  panelScope.run(() => {
    effect(() => {
      // Everything the projection reads that a store can announce. The tab's own fields are read
      // One by one because a bare `void tab` tracks the holder and not the document inside it.
      const tab = activeTab.value;
      void shell.layoutSelection;
      void workspace.activePaneId;
      void pulse.tick;
      if (tab) {
        void tab.doc.document;
        void tab.documentPath;
        // The whole SET, joined — a bare property read would not re-trigger when the selection
        // Changes WITHIN the array.
        void tab.session.selection.map((path) => path.join("/")).join("|");
        void tab.session.ui.inspectorSections;
      }
      queueProjection();
    });
  });
}

/**
 * Project once at the end of this tick.
 *
 * Coalesced on a microtask because one gesture writes several reactive facts — a transaction moves
 * the document, the selection and the history index — and the projection walks every applicable
 * attribute of the selected tag. Running it once per write would build the whole accordion three
 * times for one edit.
 */
function queueProjection(): void {
  if (projectionQueued || !surface) {
    return;
  }
  projectionQueued = true;
  queueMicrotask(() => {
    projectionQueued = false;
    surface?.update(projectPanel());
    paintControls();
  });
}

/**
 * Draw one lit-owned leaf into the host the document announced for it.
 *
 * Connectedness is deliberately NOT consulted: a host is announced as it is CREATED, one reconcile
 * step before it is in the page, so "is it connected" answers no for exactly the node that needs
 * drawing.
 */
function paintControl(key: string, host: HTMLElement): void {
  plans.get(key)?.control?.(host);
}

/** Redraw every leaf this panel has been handed a host for, and forget the hosts that have gone. */
function paintControls(): void {
  for (const [key, host] of controlHosts) {
    if (plans.has(key)) {
      paintControl(key, host);
    } else {
      controlHosts.delete(key);
      /* A media picker in that box is a MOUNTED document, and the surface registry holds its host:
         dropping our handle on it would leave the mount alive with nothing left to draw. */
      unmountMediaPicker(host);
    }
  }
}

// ─── What a control asks for ─────────────────────────────────────────────────

const ACTIONS: ContentPanelActions = {
  chipAction: (key) => {
    plans.get(key)?.chipAction?.();
  },
  commit: (key, raw) => {
    const plan = plans.get(key);
    if (!plan?.commit) {
      return;
    }
    if (plan.draft) {
      setDraft(plan.draft, raw);
      commitField(plan.draft, plan.commit);
      return;
    }
    plan.commit(raw);
  },
  commitChecked: (key, checked) => {
    plans.get(key)?.commitChecked?.(checked);
  },
  commitKind: (key, kind) => {
    plans.get(key)?.commitKind?.(kind);
  },
  edit: (key, raw) => {
    const plan = plans.get(key);
    if (!plan?.commit || !plan.draft || plan.debounceMs <= 0) {
      return;
    }
    setDraft(plan.draft, raw);
    scheduleDraftCommit(plan.draft, plan.debounceMs, plan.commit);
  },
  editName: (key, raw) => {
    editKvCell(key, "nameKey", raw);
  },
  editValue: (key, raw) => {
    editKvCell(key, "valueKey", raw);
  },
  openFile: (key) => {
    const path = plans.get(key)?.openPath;
    if (path) {
      openUsage(path);
    }
  },
  openLayout: () => {
    /* ONE command, addressed by id — the chip is a control, not a second definition site for what
       "open the layout" means. It opens the layout BESIDE the page and leaves the keyboard in the
       page, so the next click on layout chrome moves the side pane's selection instead of teaching
       the author what a pane is. */
    void activeRegistry()?.run("pane.derive", { preset: "layout" });
  },
  pickSource: (key, anchor) => {
    openSourceMenu(key, anchor);
  },
  removeRow: (key) => {
    plans.get(key)?.action?.();
  },
  runAction: (key) => {
    plans.get(key)?.action?.();
  },
  runEmptyAction: (id) => {
    if (id === "open-page") {
      // The one verb every "needs an open document" empty state offers, run from where it is
      // Declared rather than re-implemented: `panels/empty-state.ts` owns both its words and its
      // Lazy reach into Quick Access.
      openPageAction().run();
    } else if (id === "open-logic") {
      showLogicTab();
    }
  },
  setSection: (key, open) => {
    // One writer: the accordion's own toggle and `inspector.setSection` land in the same function,
    // So the command and the control cannot disagree about what "open" means.
    setInspectorSection(key, open);
  },
};

/** A keystroke in one cell of a key/value pair: draft it, and land both cells together. */
function editKvCell(key: string, cell: "nameKey" | "valueKey", raw: string): void {
  const plan = plans.get(key);
  if (!plan?.kv) {
    return;
  }
  const cellDraft = plan.kv[cell];
  setDraft(cellDraft, raw);
  scheduleDraftCommit(cellDraft, plan.debounceMs, () => {
    commitKvPair(key);
  });
}

/** Land a key/value pair: whatever is in both cells right now, in one transaction. */
function commitKvPair(key: string): void {
  const plan = plans.get(key);
  if (!plan?.kv) {
    return;
  }
  const { nameKey, valueKey, write } = plan.kv;
  // Both cells schedule the same commit, so the second timer arrives with nothing left to say.
  if (!hasDraft(nameKey) && !hasDraft(valueKey)) {
    return;
  }
  const name = getFieldValue(nameKey, plan.kv.name);
  const value = getFieldValue(valueKey, plan.kv.value);
  clearDraft(nameKey);
  clearDraft(valueKey);
  write(name, value);
}

/** The rung picker: every source this position permits, one action away (§6.3). */
function openSourceMenu(key: string, anchor: HTMLElement): void {
  const ladder = plans.get(key)?.ladder;
  if (!ladder) {
    return;
  }
  const { fieldKey, mode, offered } = ladder;
  const box = rectOf(anchor);
  sourceMenu?.close();
  sourceMenu = openMenu({
    label: "Value source",
    onClosed: () => {
      sourceMenu = null;
    },
    opener: anchor,
    origin: { x: box.left, y: box.bottom },
    region: "value-source",
    rows: offered.map((rung) => ({
      checked: (rung === mode ? "true" : "false") as "true" | "false",
      destructive: false,
      disabled: false,
      dividerAbove: false,
      id: rung,
      title: VALUE_SOURCE_LABELS[rung],
    })),
    run: (id) => {
      const next = id as SlotMode;
      if (next === mode) {
        return;
      }
      /* Leaving From data… seeds an empty Fixed value stash with the signal's declared default, so
         unbind-restores-default survives a detour (ref → mixed text → fixed value). */
      if (
        mode === "ref" &&
        ladder.literalDefault !== undefined &&
        !hasStashedSlotValue(fieldKey, "literal")
      ) {
        stashSlotValue(fieldKey, "literal", ladder.literalDefault);
      }
      ladder.onChange(
        switchSlotMode(
          fieldKey,
          mode,
          next,
          cloneValue(ladder.value),
          ladder.seedFor?.(next) ??
            slotModeSeed(next, {
              extraSignals: ladder.extraSignals,
              literalDefault: ladder.literalDefault,
              stateDefs: ladder.stateDefs,
            }),
        ),
      );
    },
  });
}

/** Open a referencing file in a tab — the "→" half of "Used on N pages →". */
function openUsage(path: string): void {
  // Lazy import: `files/files.ts` imports this panel's siblings, and a static edge here would close
  // The inspector → files → inspector cycle.
  void import("../files/files").then((m) => m.openFileInTab(path));
}

/** Send the user to the tab that DOES answer, without this module importing the dock. */
function showLogicTab(): void {
  void import("./right-panel").then((m) => m.setInspectorTab("events"));
}

// ─── Row builders ────────────────────────────────────────────────────────────

/** Record a row's plan and hand back the row, so a builder reads as one expression. */
function withPlan(row: ContentRowView, plan: RowPlan): ContentRowView {
  plans.set(row.key, plan);
  return row;
}

/** Fill in a row's provenance chip from the vocabulary `panels/provenance.ts` owns. */
function applyChip(
  row: ContentRowView,
  plan: RowPlan,
  prop: string,
  p: FieldProvenance | undefined,
): void {
  if (!p || p.state === "default") {
    return;
  }
  row.chipState = p.state;
  row.chipText = provenanceText(p);
  row.chipTitle = provenanceTitle(prop, p);
  row.chip = p.state === "set" ? "dot" : p.onClick ? "press" : "text";
  plan.chipAction = p.onClick;
}

/** Everything a bindable position needs to offer the value ladder. */
interface LadderOpts {
  fieldKey: string;
  caps: SlotCapsSource;
  value: unknown;
  onChange: (v?: JsonValue) => void;
  stateDefs: string[];
  extraSignals?: SignalOption[] | null;
  literalDefault?: JsonValue | undefined;
  seedFor?: ((mode: SlotMode) => JsonValue | undefined) | undefined;
  /** The operators this position's grammar admits, when it admits fewer than all of them. */
  operators?: readonly string[] | undefined;
}

/**
 * Offer the value ladder on a row, and draw the rung it is actually at.
 *
 * The rungs are DERIVED from the schema at the named position, never listed by the caller, so a
 * panel can no longer offer a rung the compiler would reject nor withhold one it would accept. The
 * literal rung is whatever the caller already put on the row; every other rung replaces it.
 */
function applyLadder(row: ContentRowView, plan: RowPlan, opts: LadderOpts): void {
  const caps = slotCaps(opts.caps);
  const mode = effectiveSlotMode(opts.fieldKey, opts.value);
  const sources: SignalOption[] = [
    ...opts.stateDefs.map((name) => ({ label: name, value: `#/state/${name}` })),
    ...(opts.extraSignals ?? []),
  ];
  // A ref rung with nothing to point at is a dead end — drop it rather than offer an empty picker.
  const offered = caps.filter((m) => m !== "ref" || sources.length > 0);
  const label = VALUE_SOURCE_LABELS[mode];
  /* Locked only when the rung this value already sits on is the only one there is. A value on a
     rung the position does NOT permit — a fixed string left in a `$switch`, say — is exactly the
     case that needs the chip most, and counting rungs alone used to grey it out. */
  const locked = !offered.some((m) => m !== mode);
  row.hasSource = true;
  row.sourceLabel = label;
  row.sourceLocked = locked;
  row.sourceName = locked
    ? `Value source: ${label} (no other source available here)`
    : `Value source: ${label} — click to change`;
  row.source = mode === "literal" ? "fixed" : "bound";
  plan.ladder = {
    extraSignals: [...(opts.extraSignals ?? [])],
    fieldKey: opts.fieldKey,
    literalDefault: opts.literalDefault,
    mode,
    offered,
    onChange: opts.onChange,
    seedFor: opts.seedFor,
    sources,
    stateDefs: opts.stateDefs,
    value: cloneValue(opts.value as JsonValue | undefined),
  };
  if (mode === "ref") {
    row.kind = "select";
    row.value = isRef(opts.value) ? opts.value.$ref : "";
    row.options = [
      { label: "— select signal —", value: "" },
      ...sources.map((s) => ({ label: s.label, value: s.value })),
    ];
    plan.commit = (raw) => opts.onChange(raw ? { $ref: raw } : undefined);
    plan.debounceMs = 0;
    plan.draft = undefined;
    plan.control = undefined;
    return;
  }
  if (mode === "template") {
    const templateDraft = draft(`${opts.fieldKey}:template`);
    row.kind = "text";
    row.mono = true;
    row.placeholder = "${state.…}";
    row.value = getFieldValue(templateDraft, typeof opts.value === "string" ? opts.value : "");
    plan.commit = (raw) => opts.onChange(raw);
    plan.debounceMs = LIVE_PREVIEW;
    plan.draft = templateDraft;
    plan.control = undefined;
    return;
  }
  if (mode === "expression") {
    const node = (opts.value as { $expression?: unknown } | undefined)?.$expression;
    row.kind = "control";
    plan.commit = undefined;
    plan.draft = undefined;
    plan.control = (host) =>
      mountExpressionEditor(
        host,
        node,
        (next) => opts.onChange({ $expression: next } as JsonValue),
        {
          allowEventRef: false,
          ...(opts.operators ? { operators: opts.operators } : {}),
          preview: null,
          stateDefs: opts.stateDefs,
          stateEntries: null,
        },
      );
  }
}

/** A text row bound to the draft layer: the one control every typed value in this tab goes through. */
function textRow(opts: {
  key: string;
  prop: string;
  label: string;
  draft: string;
  value: string;
  placeholder?: string;
  commit: (raw: string) => void;
}): { row: ContentRowView; plan: RowPlan } {
  const row = blankRow(opts.key, opts.prop, opts.label);
  row.kind = "text";
  row.value = getFieldValue(opts.draft, opts.value);
  row.placeholder = opts.placeholder ?? "";
  const plan: RowPlan = { commit: opts.commit, debounceMs: LIVE_PREVIEW, draft: draft(opts.draft) };
  return { plan, row };
}

// ─── The projection ──────────────────────────────────────────────────────────

/** An empty state, in the words §-6's copy rules ask for. */
function emptyView(
  message: string,
  detail: string,
  actions: { id: string; label: string }[],
): ContentPanelView {
  return {
    ...emptyContentView(),
    emptyActions: actions,
    emptyDetail: detail,
    emptyMessage: message,
    hasEmptyActions: actions.length > 0,
    hasEmptyDetail: detail !== "",
    view: "empty",
  };
}

/**
 * The whole tab, as the document reads it.
 *
 * Every plan this panel can act on is rebuilt here, which is what makes a callback safe: a row key
 * that is no longer in the projection has no plan, so a click on a control the reconciler has since
 * taken away reaches nothing rather than the wrong node.
 */
function projectPanel(): ContentPanelView {
  plans.clear();
  const tab = activeTab.value;
  if (!tab) {
    return emptyView("Open a page to inspect and style what you click.", "", [
      { id: "open-page", label: openPageAction().label },
    ]);
  }

  // Layout chrome first: it is mutually exclusive with a document selection, and it is the one
  // Target whose name has to say where it came FROM.
  if (shell.layoutSelection) {
    return layoutView(shell.layoutSelection as LayoutSelection);
  }

  const selected = primarySelection(tab.session.selection);
  if (!selected) {
    return emptyView(clickAnythingTo("edit its content"), "", []);
  }
  const path: JxPath = selected;
  const node = getNodeAtPath(tab.doc.document, path);
  if (!node) {
    return emptyView(staleSelectionMessage(), "", []);
  }

  // A repeating list has no content of its own — it has a source and a template, and both are
  // Wiring. Content says where the answer lives rather than drawing an empty accordion (§6.5).
  if (node.$prototype === "Array") {
    return emptyView(
      "A repeating list has no content of its own.",
      "Its items, filter, sort and template are wiring, so they live in Logic.",
      [{ id: "open-logic", label: "Open Logic" }],
    );
  }

  return {
    ...emptyContentView(),
    sections: sectionsFor(node, path),
    view: "content",
  };
}

/** The Layout-element card — what the inspector says when you click page chrome. */
function layoutView(selection: LayoutSelection): ContentPanelView {
  const displayPath = selection.layoutFile || "layout";
  return {
    ...emptyContentView(),
    /* Drawn only where it can run. `canvas/iframe-host.ts` focuses the pane a layout click landed
       in — including a LENS, which draws layout chrome because it draws the same document — and
       from a derived pane `pane.derive` can only throw into a floating `void registry.run(…)` that
       swallows it. A chip that does nothing when you press it is worse than no chip. */
    layoutCanOpen: deriveRefusal(workspace.activePaneId) === null,
    layoutClass: selection.className,
    layoutHasClass: Boolean(selection.className),
    layoutNote:
      `This element comes from ${displayPath}, which wraps every page that uses it. ` +
      "Open the layout to edit it.",
    layoutTag: selection.tagName || "element",
    view: "layout",
  };
}

/** Every section the selected node draws, in reading order. */
function sectionsFor(node: JxMutableNode, path: JxPath): ContentSectionView[] {
  const tab = activeTab.value!;
  const doc = tab.doc.document;
  const targets: JxPath[] = tab.session.selection.length > 0 ? tab.session.selection : [path];
  const tagName = displayTagName(node.tagName) || "div";
  const isCustomInstance = displayTagName(node.tagName).includes("-");
  const attrs = node.attributes || {};
  const mapSignals = mapSignalsFor(path);
  const bindableSignals = bindableSignalNames(doc);

  // ── Which attributes this tag has, by section ──
  const applicableAttrs = {} as Record<string, HtmlMetaEntry>;
  for (const [attr, entry] of Object.entries(htmlMeta.$defs) as [string, HtmlMetaEntry][]) {
    if (!entry.$elements || entry.$elements.includes(displayTagName(tagName))) {
      // The $attr field aliases a $defs key to a different attribute name, so the same attribute
      // (e.g. "name") can carry per-element metadata.
      applicableAttrs[entry.$attr ?? attr] = entry;
    }
  }
  const attrSections: Record<string, { name: string; entry: HtmlMetaEntry }[]> = {};
  for (const sec of htmlMeta.$sections) {
    attrSections[sec.key] = [];
  }
  for (const [attr, entry] of Object.entries(applicableAttrs)) {
    attrSections[entry.$section]?.push({ entry, name: attr });
  }
  for (const sec of htmlMeta.$sections) {
    attrSections[sec.key]!.sort((a, b) => a.entry.$order - b.entry.$order);
  }

  const knownAttrNames = new Set(Object.keys(applicableAttrs));
  if (isCustomInstance) {
    const comp = componentRegistry.find((c) => c.tagName === node.tagName);
    for (const p of comp?.props ?? []) {
      knownAttrNames.add(p.name);
    }
  }
  const customAttrs = Object.entries(attrs).filter(([k]) => !knownAttrNames.has(k));

  const autoOpen = new Set<string>();
  for (const attr of Object.keys(attrs)) {
    const entry = applicableAttrs[attr];
    if (entry) {
      autoOpen.add(entry.$section);
    }
  }
  if (customAttrs.length > 0) {
    autoOpen.add("__custom");
  }

  const sections: ContentSectionView[] = [
    sectionView("__element", "Element", isInspectorSectionOpen("__element", false), [], 0),
  ];
  sections[0]!.rows = elementRows(node, path, tagName, mapSignals, bindableSignals);

  if (isCustomInstance) {
    const definitionOfThis = isComponentDefinitionOpen(node);
    sections.push(
      sectionView(
        PROPS_SECTION,
        definitionOfThis ? "Component Defaults" : "Component Settings",
        isInspectorSectionOpen(PROPS_SECTION, true),
        componentPropRows(node, path, mapSignals, definitionOfThis),
        0,
      ),
    );
    // "Used on N pages →". Only for a component instance: an ordinary <div> is not a thing that can
    // Be reused, so the question does not arise.
    const usages = usagesSection(
      displayTagName(tagName),
      componentRegistry.find((c) => c.tagName === displayTagName(tagName))?.path ?? null,
    );
    if (usages) {
      sections.push(usages);
    }
  }

  for (const sec of htmlMeta.$sections) {
    const sectionAttrs = attrSections[sec.key]!;
    if (sectionAttrs.length === 0) {
      continue;
    }
    const setCount = sectionAttrs.filter((a) => attrs[a.name] !== undefined).length;
    const attrCtx: AttrCtx = {
      bindableSignals,
      doc,
      mapSignals,
      node,
      path,
      tagName,
      targets,
    };
    const rows = sectionAttrs.map((a) => attributeRow(a.name, a.entry, attrs[a.name], attrCtx));
    const open = isInspectorSectionOpen(sec.key, autoOpen.has(sec.key));
    sections.push(sectionView(sec.key, sec.label, open, rows, setCount));
  }

  if (customAttrs.length > 0 || Object.keys(attrs).length > 0) {
    const custom = customRows(path, customAttrs);
    const open = isInspectorSectionOpen("__custom", autoOpen.has("__custom"));
    sections.push(sectionView("__custom", "Custom", open, custom, customAttrs.length));
  }
  return sections;
}

/**
 * One accordion section, with §6.2's collapsed-header tally.
 *
 * The dot is an INDICATOR and not a control: it used to inherit `.set-dot`'s pointer cursor and its
 * danger hover, which together say "click me to clear this", and nothing happened because it never
 * had a handler. Clicking anywhere in the heading already toggles the section.
 */
function sectionView(
  key: string,
  label: string,
  open: boolean,
  rows: ContentRowView[],
  setCount: number,
): ContentSectionView {
  return {
    dotTitle: `${setCount} value${setCount === 1 ? "" : "s"} set in this section`,
    hasDot: setCount > 0,
    key,
    label,
    open,
    rows,
  };
}

// ─── The Element section ─────────────────────────────────────────────────────

/**
 * A draft key for one field ON THIS NODE.
 *
 * The three Element rows used constant keys — `"prop:tagName"`, `"prop:$id"`, `"prop:className"` —
 * and `ui/field-input.ts`'s draft map is module-global, so every element shared one draft slot per
 * field. Type a class name, click a sibling before blurring, and the sibling's Class row showed the
 * text you had typed for the first one; blur it there and the commit landed on the WRONG element.
 */
function draftKey(path: JxPath, name: string): string {
  return `prop:${path.join("/")}:${name}`;
}

function elementRows(
  node: JxMutableNode,
  path: JxPath,
  tagName: string,
  mapSignals: SignalOption[] | null,
  bindableSignals: string[],
): ContentRowView[] {
  const chosenTag = isTagExpression(node.tagName) ? node.tagName.$expression : null;
  /**
   * The set-here chip for a document property, with the tooltip in the label's own words.
   *
   * The derived tooltip would read "Clear textContent"; the label above it reads "Text Content".
   * The row's key and the row's name are different vocabularies, and the tooltip belongs to the one
   * the user is looking at.
   */
  const propertyChip = (name: string, human: string): FieldProvenance => ({
    onClick: () => transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, path, name)),
    state: "set",
    title: `Clear ${human}`,
  });
  const writeProperty = (name: string) => (raw: string) => {
    transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, path, name, raw || undefined));
  };

  const rows: ContentRowView[] = [];

  /* THE SHARED SLOT, not a hand-rolled control. `tagName` is a bindable position like any other — a
     literal name or a `TagExpression` — so it gets the same Value Source chip and the same
     expression editor as `href`, a style declaration or an event handler. The rungs are DERIVED
     from `SLOT_POSITION_SCHEMAS.elementTag`, which is why only Fixed value and Formula are offered:
     `TagName` carries a pattern, so a template rung is refused, and a `${…}` in tag position is
     precisely what that pattern exists to reject.

     The seed is ours because the generic one is `{ operator: "??" }`, which a `TagExpression` does
     not admit — clicking the chip would otherwise write a document that fails its own validator.
     And the GRAMMAR is ours for exactly the same reason: seeding `?:` and then handing the node to
     an unrestricted editor left the very next click free to reoperate it to `capitalize`, or to
     pick `toUpperCase` out of the formula catalog. `TAG_EXPRESSION_OPERATORS` is read off the def,
     so the two branches the editor offers are the two branches the validator accepts. */
  const tag = textRow({
    commit: writeProperty("tagName"),
    draft: draftKey(path, "tagName"),
    key: "prop|tagName",
    label: "Tag",
    prop: "tagName",
    value: tagName,
  });
  applyLadder(tag.row, tag.plan, {
    caps: "elementTag",
    fieldKey: `${path.join(".")}:tagName`,
    operators: TAG_EXPRESSION_OPERATORS,
    onChange: (next) => {
      transactDoc(activeTab.value, (t) =>
        mutateUpdateProperty(t, path, "tagName", next ?? undefined),
      );
    },
    seedFor: (mode) =>
      mode === "expression"
        ? { $expression: { initial: tagName, operator: "?:", target: null, value: tagName } }
        : undefined,
    stateDefs: bindableSignals,
    value: node.tagName as JsonValue | undefined,
  });
  void chosenTag;
  rows.push(withPlan(tag.row, tag.plan));

  const id = textRow({
    commit: writeProperty("$id"),
    draft: draftKey(path, "$id"),
    key: "prop|$id",
    label: "ID",
    prop: "$id",
    value: String(node.$id || ""),
  });
  if (node.$id) {
    applyChip(id.row, id.plan, "$id", propertyChip("$id", "ID"));
  }
  rows.push(withPlan(id.row, id.plan));

  const cls = textRow({
    commit: writeProperty("className"),
    draft: draftKey(path, "className"),
    key: "prop|className",
    label: "Class",
    prop: "className",
    value: String(node.className || ""),
  });
  if (node.className) {
    applyChip(cls.row, cls.plan, "className", propertyChip("className", "class"));
  }
  rows.push(withPlan(cls.row, cls.plan));

  if (!Array.isArray(node.children) || node.children.length === 0) {
    const textDraft = draft(draftKey(path, "textContent"));
    const text = blankRow("prop|textContent", "textContent", "Text Content");
    text.kind = "textarea";
    text.value = getFieldValue(
      textDraft,
      typeof node.textContent === "string" ? node.textContent : "",
    );
    const plan: RowPlan = {
      commit: writeProperty("textContent"),
      debounceMs: LIVE_PREVIEW,
      draft: textDraft,
    };
    applyLadder(text, plan, {
      caps: "textProperty",
      extraSignals: mapSignals,
      fieldKey: `prop|${path.join("/")}|textContent`,
      onChange: (v) =>
        transactDoc(activeTab.value, (t) => mutateUpdateProperty(t, path, "textContent", v)),
      stateDefs: bindableSignals,
      value: node.textContent,
    });
    if (node.textContent !== undefined) {
      applyChip(text, plan, "textContent", propertyChip("textContent", "text"));
    }
    rows.push(withPlan(text, plan));
  }

  const hidden = blankRow("prop|hidden", "hidden", "Hidden");
  hidden.kind = "checkbox";
  hidden.checked = Boolean(node.hidden);
  const hiddenPlan: RowPlan = {
    commitChecked: (checked) =>
      transactDoc(activeTab.value, (t) =>
        mutateUpdateProperty(t, path, "hidden", checked || undefined),
      ),
    debounceMs: 0,
  };
  if (node.hidden) {
    applyChip(hidden, hiddenPlan, "hidden", propertyChip("hidden", "hidden"));
  }
  rows.push(withPlan(hidden, hiddenPlan));

  return rows;
}

// ─── Component settings ──────────────────────────────────────────────────────

/**
 * Component props, each row carrying §6.2's provenance chip — the SECOND cascade.
 *
 * A component instance's value for a prop either overrides the component's declared default or does
 * not exist, and until the chip landed the two were the same blank field. The chip states which,
 * and in the inherited case it names the donor AND jumps to it: the donor of a component default is
 * the component definition, which this panel can already open.
 */
function componentPropRows(
  node: JxMutableNode,
  path: JxPath,
  mapSignals: SignalOption[] | null,
  definitionOfThis: boolean,
): ContentRowView[] {
  const tab = activeTab.value!;
  const comp = componentRegistry.find((c) => c.tagName === displayTagName(node.tagName));
  if (!comp || !comp.props) {
    return [
      noteRow(
        "props|unknown",
        "This component is not in the project's library, so it has no settings to show.",
      ),
    ];
  }
  const isNpm = comp.source === "npm";
  /* In the definition the "value" of a setting is its DECLARED DEFAULT — the state entry's
     `default` — not a per-instance override, so the row reads and writes there instead. */
  const stateEntries = (tab.doc.document.state ?? {}) as Record<string, { default?: JsonValue }>;
  const currentVals: Record<string, unknown> = definitionOfThis
    ? Object.fromEntries(comp.props.map((prop) => [prop.name, stateEntries[prop.name]?.default]))
    : isNpm
      ? node.attributes || {}
      : node.$props || {};
  const updateFn = definitionOfThis
    ? (name: string, v?: JsonValue) =>
        transactDoc(activeTab.value, (t) => mutateUpdateDef(t, name, { default: v }))
    : isNpm
      ? (name: string, v?: JsonValue) =>
          transactDoc(activeTab.value, (t) =>
            mutateUpdateAttribute(
              t,
              path,
              name,
              v === "" ? undefined : (v as JxAttributeValue | undefined),
            ),
          )
      : (name: string, v?: JsonValue) =>
          transactDoc(activeTab.value, (t) => mutateUpdateProp(t, path, name, v));

  const defs = tab.doc.document.state || {};
  const signalNames = bindableSignalNames(tab.doc.document);
  const definitionPath = comp.path;
  /* One closure for the whole list rather than one per prop: it says the same thing every time,
     and building it inside the loop is what made every row carry its own copy of it. */
  const openDefinition =
    definitionPath && !definitionOfThis ? () => navigateToComponent(definitionPath) : undefined;
  const rows: ContentRowView[] = [];

  for (const prop of comp.props) {
    const rawValue = currentVals[prop.name];
    const boundRef = isRef(rawValue) ? rawValue.$ref : null;
    const hasVal = rawValue !== undefined && rawValue !== null;
    const parsed = parseCemType(prop.type);
    const onChange = (v?: JsonValue) => updateFn(prop.name, v);
    const staticVal = slotMode(rawValue) === "literal" ? String(rawValue ?? "") : "";
    const key = `cprop|${prop.name}`;
    const propDraft = draft(`cprop:${path.join("/")}:${prop.name}`);
    const row = blankRow(key, prop.name, camelToLabel(prop.name));
    const plan: RowPlan = { debounceMs: LIVE_PREVIEW };

    if (isMediaFormat(prop.format)) {
      row.kind = "control";
      plan.control = (host) =>
        mountMediaPicker(host, prop.name, staticVal, (v: string) => onChange(v));
    } else if (prop.format === "color") {
      row.kind = "color";
      row.tokens = colorTokens();
      row.hasTokens = row.tokens.length > 0;
      row.value = getFieldValue(propDraft, staticVal);
      plan.commit = (raw) => onChange(raw);
      plan.draft = propDraft;
    } else if (prop.format === "date") {
      row.kind = "text";
      row.placeholder = "YYYY-MM-DD";
      row.value = getFieldValue(propDraft, staticVal);
      plan.commit = (raw) => onChange(raw);
      plan.draft = propDraft;
    } else if (parsed.kind === "boolean") {
      row.kind = "checkbox";
      row.checked = Boolean(staticVal);
      plan.commitChecked = (checked) => onChange(checked || undefined);
    } else if (parsed.kind === "number") {
      row.kind = "number";
      row.value = getFieldValue(propDraft, staticVal);
      plan.commit = (raw) => onChange(raw);
      plan.draft = propDraft;
    } else if (parsed.kind === "combobox") {
      row.kind = "select";
      row.value = staticVal;
      row.options = [
        CLEAR_OPTION,
        ...(parsed.options as string[]).map((o) => ({ label: camelToLabel(o), value: o })),
      ];
      plan.commit = (raw) => onChange(raw || undefined);
      plan.debounceMs = 0;
    } else {
      row.kind = "text";
      row.value = getFieldValue(propDraft, staticVal);
      plan.commit = (raw) => onChange(raw);
      plan.draft = propDraft;
    }

    applyLadder(row, plan, {
      caps: "componentProp",
      extraSignals: mapSignals,
      fieldKey: `cprop|${path.join("/")}|${prop.name}`,
      // De-escalating to literal restores the bound signal's declared default (the old unbind).
      literalDefault: boundRef
        ? defaultAsString(defs[boundRef.startsWith("#/state/") ? boundRef.slice(8) : boundRef]) ||
          undefined
        : undefined,
      onChange,
      stateDefs: signalNames,
      value: rawValue,
    });
    applyChip(
      row,
      plan,
      prop.name,
      componentPropProvenance(prop, rawValue, hasVal, {
        // No donor and no jump in the definition: the value IS the component's default, and
        // "→ the component definition" would open the document already in front of you.
        isDefinition: definitionOfThis,
        onClear: () => updateFn(prop.name),
        ...(openDefinition ? { openDefinition } : {}),
      }),
    );
    rows.push(withPlan(row, plan));
  }

  if (comp.props.length === 0) {
    rows.push(
      noteRow(
        "props|empty",
        definitionOfThis
          ? "This component declares no settings yet. Add a state entry with a default to give " +
              "whoever places it something to fill in."
          : "This component has no settings to fill in yet.",
      ),
    );
  }
  // A link to the definition, from inside the definition, is a link to here.
  if (openDefinition) {
    rows.push(
      actionRow("props|edit-definition", "editDefinition", "→ Edit definition", openDefinition),
    );
  }
  return rows;
}

// ─── HTML attributes ─────────────────────────────────────────────────────────

interface AttrCtx {
  node: JxMutableNode;
  path: JxPath;
  doc: JxMutableNode;
  targets: JxPath[];
  tagName: string;
  mapSignals: SignalOption[] | null;
  bindableSignals: string[];
}

function attributeRow(
  attr: string,
  entry: HtmlMetaEntry,
  value: unknown,
  ctx: AttrCtx,
): ContentRowView {
  const { doc, node, path, tagName, targets } = ctx;
  const hasVal = value !== undefined && value !== "";
  const key = `attr|${attr}`;
  const label = attrLabel(entry, attr);
  // One write per selected element, inside ONE transaction (§6.5). `targets` is `[path]` for a
  // Single selection, so this is the same single mutation it has always been.
  const commitAttr = (v?: JsonValue) =>
    transactDoc(activeTab.value!, (t) => {
      for (const target of targets) {
        mutateUpdateAttribute(t, target, attr, v as JxAttributeValue | undefined);
      }
    });
  const clearAttr = () =>
    transactDoc(activeTab.value, (t) => {
      for (const target of targets) {
        mutateUpdateAttribute(t, target, attr);
      }
    });
  const chip = () =>
    attributeProvenance(
      attr,
      value,
      hasVal,
      clearAttr,
      mixedAcrossSelection(doc, targets, (n) => (n?.attributes ?? {})[attr] ?? null),
    );

  // Enhanced Link handling: only for anchors (a/area) with a plain (non-binding) value. Bindings
  // ($ref objects or ${…} template strings) fall through to the raw widget to stay editable.
  const isAnchor = tagName === "a" || tagName === "area";
  if (isAnchor && !isBoundAttrValue(value)) {
    if (attr === "href") {
      return linkRow(key, label, node, path);
    }
    if (attr === "target") {
      const row = blankRow(key, attr, label);
      row.kind = "select";
      row.value = typeof node.attributes?.target === "string" ? node.attributes.target : "";
      row.options = [
        CLEAR_OPTION,
        ...(Array.isArray(entry.enum) ? (entry.enum as string[]) : []).map((o) => ({
          label: o,
          value: o,
        })),
      ];
      const plan: RowPlan = { commit: (raw) => commitAttr(raw || undefined), debounceMs: 0 };
      applyChip(row, plan, attr, chip());
      return withPlan(row, plan);
    }
  }

  /* Same gate as the anchor fields above: a BOUND value falls through to the raw widget so it stays
     editable as an expression rather than being flattened into a picker. */
  if (entry.$input === "popover-target" && !isBoundAttrValue(value)) {
    const row = blankRow(key, attr, label);
    row.kind = "select";
    row.value = typeof value === "string" ? value : "";
    row.options = [
      CLEAR_OPTION,
      ...popoverIdsIn((activeTab.value?.doc.document ?? {}) as JxElement, {
        popoverTags: POPOVER_TAGS,
      }).map((id) => ({ label: id, value: id })),
      { label: "Type an id…", value: POPOVER_TARGET_OTHER },
    ];
    const plan: RowPlan = {
      commit: (raw) => {
        if (raw === POPOVER_TARGET_OTHER) {
          /* It stays typeable, because the list can never be complete: a `popovertarget` resolves
             in the RENDERED DOM, and a page composes components whose internals this document
             cannot see. */
          void showPromptDialog("Popover id", {
            confirmLabel: "Use",
            message: "The id of a popover in another file.",
            placeholder: "site-mobile-menu",
          }).then((typed) => commitAttr(typed?.trim() || undefined));
          return;
        }
        commitAttr(raw || undefined);
      },
      debounceMs: 0,
    };
    applyChip(row, plan, attr, chip());
    return withPlan(row, plan);
  }

  const row = blankRow(key, attr, label);
  const attrDraft = draft(`attr:${path.join("/")}:${attr}`);
  const plan: RowPlan = { debounceMs: INPUT_DEBOUNCE };
  const type = inferInputType(entry);
  if (entry.type === "boolean") {
    row.kind = "checkbox";
    row.checked = Boolean(value);
    plan.commitChecked = (checked) => commitAttr(checked ? "" : undefined);
  } else if (type === "media") {
    row.kind = "control";
    const staticVal = isRef(value) ? "" : String(value || "");
    plan.control = (host) =>
      mountMediaPicker(host, attr, staticVal, (v: string) => commitAttr(v || undefined));
  } else if (type === "select") {
    row.kind = "select";
    row.value = isRef(value) ? "" : String(value || "");
    row.options = [
      CLEAR_OPTION,
      ...(Array.isArray(entry.enum) ? (entry.enum as string[]) : []).map((o) => ({
        label: o,
        value: o,
      })),
    ];
    plan.commit = (raw) => commitAttr(raw || undefined);
    plan.debounceMs = 0;
  } else {
    row.kind = "text";
    row.value = getFieldValue(attrDraft, isRef(value) ? "" : String(value || ""));
    plan.commit = (raw) => commitAttr(raw || undefined);
    plan.draft = attrDraft;
  }

  applyLadder(row, plan, {
    caps: "attribute",
    extraSignals: ctx.mapSignals,
    fieldKey: `attr|${path.join("/")}|${attr}`,
    onChange: commitAttr,
    stateDefs: ctx.bindableSignals,
    value,
  });
  applyChip(row, plan, attr, chip());
  return withPlan(row, plan);
}

/**
 * The Link target: a kind and a value over one `href`.
 *
 * `utils/link-target.ts` classifies the current value and composes the next one, so switching kind
 * REINTERPRETS what is there rather than throwing it away — `a@b.com` picked as Email becomes
 * `mailto:a@b.com`. Internal targets offer the routes enumerated from the `pages/` tree.
 */
function linkRow(key: string, label: string, node: JxMutableNode, path: JxPath): ContentRowView {
  const raw = typeof node.attributes?.href === "string" ? node.attributes.href : "";
  const { kind, value } = classifyHref(raw);
  const commit = (nextKind: LinkKind, nextValue: string) => {
    const composed = composeHref(nextKind, nextValue);
    transactDoc(activeTab.value!, (t) =>
      mutateUpdateAttribute(t, path, "href", composed || undefined),
    );
  };

  const row = blankRow(key, "href", label);
  row.kind = "link";
  row.linkKind = kind;
  row.kindOptions = [
    { label: "Internal Page", value: "internal" },
    { label: "External URL", value: "external" },
    { label: "Anchor", value: "anchor" },
    { label: "Email", value: "mailto" },
    { label: "Phone", value: "tel" },
  ];
  const plan: RowPlan = {
    commit: (next) => commit(kind, next),
    commitKind: (nextKind) => commit(nextKind as LinkKind, value),
    debounceMs: INPUT_DEBOUNCE,
  };

  if (kind === "internal") {
    if (pageRouteEntries === null && !pageRoutesLoading) {
      void loadPageRouteEntries();
    }
    row.linkValueKind = "route";
    row.value = value;
    // `jx-select` stands in a row for a value no option holds, so a route this document cannot
    // Enumerate — one in another file, or a listing that failed — stays selected and offered.
    row.options = (pageRouteEntries ?? []).map((r) => ({ label: r, value: r }));
    plan.debounceMs = 0;
  } else {
    const linkDraft = draft(`link:${path.join("/")}:href`);
    row.linkValueKind = "text";
    row.value = getFieldValue(linkDraft, value);
    row.placeholder =
      kind === "mailto"
        ? "name@example.com"
        : kind === "tel"
          ? "+15551234567"
          : kind === "anchor"
            ? "section-id"
            : "https://example.com";
    plan.draft = linkDraft;
  }

  applyChip(
    row,
    plan,
    "href",
    raw === ""
      ? { state: "default" }
      : {
          onClick: () =>
            transactDoc(activeTab.value, (t) => mutateUpdateAttribute(t, path, "href")),
          state: "set",
          title: "Clear href",
        },
  );
  return withPlan(row, plan);
}

// ─── Custom attributes ───────────────────────────────────────────────────────

function customRows(path: JxPath, customAttrs: [string, unknown][]): ContentRowView[] {
  const rows: ContentRowView[] = customAttrs.map(([attr, val]) => {
    const key = `kv|${attr}`;
    const nameKey = draft(`kvname:${path.join("/")}:${attr}`);
    const valueKey = draft(`kvval:${path.join("/")}:${attr}`);
    const row = blankRow(key, attr, `${attr} value`);
    row.shape = "kv";
    row.name = getFieldValue(nameKey, attr);
    row.value = getFieldValue(valueKey, String(val));
    row.removeLabel = `Remove ${attr}`;
    const plan: RowPlan = {
      action: () => transactDoc(activeTab.value, (t) => mutateUpdateAttribute(t, path, attr)),
      debounceMs: INPUT_DEBOUNCE,
      kv: {
        name: attr,
        nameKey,
        value: String(val),
        valueKey,
        write: (nextAttr, nextVal) => {
          if (nextAttr !== attr) {
            transactDoc(activeTab.value, (t) => {
              mutateUpdateAttribute(t, path, attr);
              mutateUpdateAttribute(t, path, nextAttr, nextVal);
            });
          } else {
            transactDoc(activeTab.value, (t) => mutateUpdateAttribute(t, path, attr, nextVal));
          }
        },
      },
    };
    return withPlan(row, plan);
  });
  rows.push(
    actionRow("kv|add", "addAttribute", "+ Add attribute", () =>
      transactDoc(activeTab.value, (t) => mutateUpdateAttribute(t, path, "data-", "")),
    ),
  );
  return rows;
}

// ─── Usage (§9.6) ────────────────────────────────────────────────────────────

/**
 * The component instance's usage line — "Used on 7 pages →", expanding to the files.
 *
 * Three things this deliberately does NOT do. It does not render when the host cannot answer
 * (`usagesSupported()` is `capability.findReferences`): a confident "0" for a component used
 * everywhere is worse than no line at all. It does not ask on every paint — `peekUsages` is
 * side-effect-free and only a cold target starts a request, which re-projects once when it lands.
 * And it does not swallow a failure: a failed count says so and offers Retry, because "we could not
 * check" and "nothing uses this" are the two answers a user must never confuse.
 */
function usagesSection(tagName: string, componentPath: string | null): ContentSectionView | null {
  const query = { tagName, ...(componentPath ? { path: componentPath } : {}) };
  const state = peekUsages(query);
  // ONE gate, and it is the peek itself: a host with no `findReferences` answers "unsupported"
  // Synchronously, and the section does not exist.
  if (state?.status === "unsupported") {
    return null;
  }
  if (state === null) {
    // Cold: ask once, and re-project when the answer arrives.
    void loadUsages(query).then(() => renderPropertiesPanel());
  }

  const rows: ContentRowView[] = [];
  let heading = "Usage";
  if (state === null || state.status === "pending") {
    rows.push(noteRow("usage|pending", "Counting references…"));
  } else if (state.status === "failed") {
    heading = "Usage · unknown";
    rows.push(
      noteRow(
        "usage|failed",
        `References could not be counted: ${state.message}. This is not the same as “unused”.`,
      ),
      actionRow("usage|retry", "retryUsages", "Retry", () => {
        void retryUsages(query).then(() => renderPropertiesPanel());
      }),
    );
  } else {
    const files = usageFiles(state.result);
    heading = usageHeadline(state.result);
    if (files.length === 0) {
      rows.push(noteRow("usage|none", `Nothing else in this project places <${tagName}> yet.`));
    } else {
      for (const file of files) {
        const row = blankRow(`usage|${file.path}`, file.path, file.path);
        row.shape = "file";
        row.text = file.path;
        row.detail = String(file.count);
        row.title = file.refs.map((r) => `${r.refType} ${r.ref} ×${r.count}`).join(", ");
        rows.push(withPlan(row, { debounceMs: 0, openPath: file.path }));
      }
    }
  }
  return sectionView(
    USAGES_SECTION,
    heading,
    isInspectorSectionOpen(USAGES_SECTION, false),
    rows,
    0,
  );
}

// ─── The two rows that are not fields ────────────────────────────────────────

function noteRow(key: string, text: string): ContentRowView {
  const row = blankRow(key, key, "");
  row.shape = "note";
  row.text = text;
  plans.set(key, { debounceMs: 0 });
  return row;
}

function actionRow(key: string, prop: string, text: string, run: () => void): ContentRowView {
  const row = blankRow(key, prop, text);
  row.shape = "action";
  row.text = text;
  return withPlan(row, { action: run, debounceMs: 0 });
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/** The Inspector's section verb. **This is the setter that retires `inspector.toggleSection`.** */
export function inspectorCommands(): AnyCommand[] {
  return [
    {
      args: argsSchema({
        open: booleanProperty("True to expand the section, false to collapse it."),
        section: stringProperty(
          "The section key — one of the fixed rows (__element, __observed, __usages, " +
            "__custom, __cssprops, __cssparts) or an attribute schema's own $section.",
        ),
      }),
      category: "View",
      id: "inspector.setSection",
      level: "document",
      menus: ["palette"],
      group: "4_docks",
      requires: "an open document",
      when: (ctx) => ctx.document.open,
      run: (_commandCtx, args) => {
        const open = booleanArg("inspector.setSection", args, "open");
        const section = stringArg("inspector.setSection", args, "section");
        const known = inspectorSectionKeys();
        if (!known.includes(section)) {
          throw new RangeError(
            `command "inspector.setSection" argument "section": "${section}" is not a section ` +
              `this document declares — declared: ${known.join(", ")}`,
          );
        }
        setInspectorSection(section, open);
      },
      title: "Show Inspector Section",
    },
    {
      /**
       * Find Usages. Defined ONCE, here, and rendered twice: the palette gets it from the app
       * registry, and `editor/context-menu.ts` pulls the `context/element` records out of this same
       * set into the menu it builds — so the row and the palette entry cannot drift in title, chord
       * or availability. It reads `ctx.selection.kind`, which both contexts populate from the node
       * under the cursor, so one `run` serves the menu's target and the canvas selection alike.
       *
       * `when` is the capability, not a `try`: a host with no `findReferences` route hides the
       * command rather than offering a verb that answers "0 usages" for a component on every page.
       */
      category: "Selection",
      id: "selection.findUsages",
      level: "selection",
      menus: ["context/element", "palette"],
      group: "4_identity",
      undo: "none",
      when: (ctx) => ctx.capability.findReferences && ctx.selection.isComponentInstance,
      requires: "a component instance, on a backend that can search the project",
      run: () => {
        const tagName = componentSelectionTag();
        if (!tagName) {
          return;
        }
        const componentPath = componentRegistry.find((c) => c.tagName === tagName)?.path ?? null;
        setInspectorSection(USAGES_SECTION, true);
        void loadUsages({ tagName, ...(componentPath ? { path: componentPath } : {}) }).then(() =>
          renderPropertiesPanel(),
        );
      },
      title: "Find Usages",
    },
  ];
}

/**
 * The tag of the selected component instance, or null.
 *
 * Read from the document rather than from a menu target so the one record works in both registries:
 * the context menu's own `getContext` reports the right-clicked node's tag as `selection.kind`, and
 * the app's reports the canvas selection's. This is the fallback for the app registry, where the
 * selection lives on the tab.
 */
function componentSelectionTag(): string | null {
  const tab = activeTab.value;
  const selection = primarySelection(tab?.session.selection);
  if (!tab || !selection) {
    return null;
  }
  const node = getNodeAtPath(tab.doc.document, selection);
  const tagName = typeof node?.tagName === "string" ? node.tagName : "";
  return tagName.includes("-") ? tagName : null;
}

/** Register the Inspector's section verb. */
export function registerInspectorCommands(registry: CommandRegistry): void {
  registry.registerAll(inspectorCommands());
}
