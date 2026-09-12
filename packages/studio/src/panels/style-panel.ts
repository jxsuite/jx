/// <reference lib="dom" />
/**
 * Style panel — the FLOW behind the Inspector's Style tab (§6).
 *
 * The tab itself is a Jx document over the kit (`surfaces/style-panel.json`, mounted by
 * `surfaces/style-panel.ts`), so this module draws no markup: it projects. What stays here is
 * everything that is a DECISION — which compound coordinate the tab is editing, what css-meta says
 * a property is, where a value came from, what a commit writes and into how many elements, and
 * which of the four lists a control offers. The surface reads values.
 *
 * The panel resolves a compound coordinate before it can commit anything: `(selection, breakpoint,
 * scheme layer, nested selector)`. It has always computed that tuple — it is the per-field key and
 * the five-branch if/else below — and it used to hide it behind three disconnected widgets on two
 * different bars. `target-line.ts` renders it as one sentence instead, and the three widgets are
 * gone: the breakpoint and scheme axes are selected on the pane context bar (region ⑦), and the
 * selector is the one axis this tab owns.
 *
 * Every row then says where its value came from. `provenance.ts` supplies the vocabulary;
 * `computeInheritedSources()` supplies the donor breakpoint the cascade walk always knew and this
 * panel used to throw away.
 *
 * Three consequences of the conversion are worth knowing before editing it.
 *
 * **The tab keeps ITSELF up to date, and must never go back through the scheduler.**
 * `panels/panel-scheduler.ts`'s focus guard exists because a lit repaint of the whole dock could
 * take the field a reader is typing into; {@link mountStyleTab} owns an `effect()` instead, so a
 * commit, a breakpoint change and a settled usage query each reach the document as one write per
 * bound property, and an equal write is skipped. `renderOnly("rightPanel")` is gone from this file
 * with it.
 *
 * **Two controls are lists, and the list is the KIT MENU** (`surfaces/menu.ts`, §12.5). The unit
 * picker and the keyword suggestions were each an `sp-overlay` + `sp-menu` of their own; the Value
 * Source picker was a third. All three are `openMenu()` now, which is also how roving focus,
 * typeahead and Escape arrive here without a line of keyboard code.
 *
 * **Nothing here is an island any more.** One control was: `specs/ui.md` §5.6 (Colour) was Pending,
 * so a colour row drew an announced `[part="control-host"]` and a lit `paintColorControl` filled
 * it, and that was the last Spectrum on this surface. §5.6 landed. The row is a `jx-color-field` in
 * the document beside every other control, its palette is a `jx-swatch-group` slotted into the
 * picker, and `ui/color-selector.ts` is what remains: which colours THIS PROJECT has named, which
 * is a question no kit element can answer.
 *
 * @docs studio/design/style-inspector
 */

import { getNestedStyle } from "@jxsuite/schema/guards";
import { effect, effectScope, reactive } from "../reactivity";
import {
  cancelStyleDebounce,
  debouncedStyleCommit,
  getNodeAtPath,
  isNestedSelector,
  updateUi,
} from "../store";
import { activeTab } from "../workspace/workspace";
import { primarySelection, unifyValues } from "../tabs/selection";
import { shell } from "../shell";
import { activeRegistry } from "../commands/active-registry";
import { selectorsForNode } from "../utils/element-selectors";
import { selectStylebookTag } from "./stylebook-panel";
import {
  mutateUpdateMediaNestedStyle,
  mutateUpdateMediaNestedStylePath,
  mutateUpdateMediaStyle,
  mutateUpdateNestedStyle,
  mutateUpdateNestedStylePath,
  mutateUpdateStyle,
  transactDoc,
} from "../tabs/transact";
import {
  abbreviateValue,
  friendlyNameToVar,
  inferInputType,
  kebabToLabel,
  propLabel,
  varDisplayName,
} from "../utils/studio-utils";
import { stringArg } from "../commands/command-args";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import { showPromptDialog } from "../ui/layers";
import { parseMediaEntries, schemeOfQuery } from "../utils/canvas-media";
import { getEffectiveMedia, getEffectiveStyle } from "../site-context";
import { computeInheritedSources } from "../utils/inherited-style";
import { loadUsages, peekUsages, usageFiles } from "../services/references";
import { mediaDisplayName } from "./shared";
import {
  countProvenance,
  provenanceSummaryText,
  provenanceText,
  provenanceTitle,
} from "./provenance";
import {
  attachTargetLine,
  openSelectorMenu,
  resetTargetLine as resetTargetSelector,
  setTargetLine,
} from "../surfaces/target-line";
import { clickAnythingTo, openPageAction, staleSelectionMessage } from "./empty-state";
import {
  allConditionsPass,
  autoOpenSections,
  compressBorderSide,
  compressShorthand,
  cssMeta,
  expandBorderSide,
  expandShorthand,
  getCssInitialMap,
  getFontVars,
  TYPO_PREVIEW_CHANNELS,
  getLonghands,
} from "./style-utils";
import { UNIT_RE } from "../ui/unit-selector";
import { colorTokens, resolvedColor } from "../ui/color-selector";
import { resolveTokenValue, toTokenRef, tokenRefName } from "../style/token-ref";
import { mountStylePanelSurface } from "../surfaces/style-panel";
import { openMenu } from "../surfaces/menu";
import type { MenuHandle } from "../surfaces/menu";
import { cloneValue } from "../tabs/doc-op-apply";
import { effectiveSlotMode, slotModeSeed, switchSlotMode } from "../ui/dynamic-slot";
import { slotCaps, VALUE_SOURCE_HINTS, VALUE_SOURCE_LABELS } from "../ui/value-source";
import { dialogPathFor } from "../canvas/dialog-path";

import type { SlotMode } from "../ui/value-source";
import type { FieldProvenance, ProvenanceState } from "./provenance";
import type { TargetScope, TargetSegment } from "../surfaces/target-line";
import type {
  StyleButtonView,
  StyleOptionView,
  StylePanelActions,
  StylePanelSurface,
  StylePanelView,
  StyleRowView,
  StyleSectionView,
} from "../surfaces/style-panel";
import type { EffectScope } from "../reactivity";
import type { Tab } from "../tabs/tab";
import type { JxPath } from "../state";
import type { JsonValue } from "../types";
import type { JxMutableNode, JxStyle } from "@jxsuite/schema/types";

interface CssLonghand {
  name: string;
  entry: Record<string, unknown>;
}

type CssPropertyEntry = Record<string, unknown>;

/** The chip a row wears when its caller has nothing more specific to say. */
const DEFAULT_PROVENANCE: FieldProvenance = { state: "default" };

type StyleMutateFn = (
  t: Tab,
  prop: string,
  val?: string | Record<string, unknown> | undefined,
) => void;

/**
 * Check if a selector is a stylebook tag path (e.g., "table" or "table th"). Tag paths don't start
 * with selector prefixes (`:`, `.`, `&`, `[`, `@`).
 *
 * @param {string} selector
 * @returns {boolean}
 */
function isTagPath(selector: string) {
  return /^[a-z]/.test(selector);
}

/**
 * Resolve a style object by traversing a nested tag path. e.g., "table th" → style["table"]["th"]
 *
 * @param {JxStyle} style
 * @param {string} tagPath
 * @returns {JxStyle}
 */
function resolveNestedTagStyle(style: JxStyle, tagPath: string): JxStyle {
  let obj: JxStyle | undefined = style;
  for (const part of tagPath.split(" ")) {
    obj = getNestedStyle(obj, part);
    if (!obj) {
      return {};
    }
  }
  return obj;
}

/**
 * The style object one compound coordinate addresses.
 *
 * Split out of the panel body because the coordinate has to be resolved TWICE: once against the
 * effective (site-merged) style, which is what the rows display, and once against the document's
 * own, which is what a commit writes. The difference between the two is the "from site tokens"
 * donor — invisible for as long as there was only one resolution.
 *
 * @param {JxStyle} style
 * @param {string | null} activeSelector
 * @param {string | null} editMedia
 * @returns {JxStyle}
 */
function resolveContextStyle(
  style: JxStyle,
  activeSelector: string | null,
  editMedia: string | null,
): JxStyle {
  const base = editMedia ? (getNestedStyle(style, `@${editMedia}`) ?? {}) : style;
  if (activeSelector) {
    return isTagPath(activeSelector)
      ? resolveNestedTagStyle(base, activeSelector)
      : (getNestedStyle(base, activeSelector) ?? {});
  }
  const flat: JxStyle = {};
  for (const [p, v] of Object.entries(base)) {
    if (typeof v !== "object") {
      flat[p] = v;
    }
  }
  return flat;
}

/**
 * The mutation that writes to one compound coordinate — the other half of
 * {@link resolveContextStyle}, and the reason the two now sit side by side: they are one decision
 * expressed twice, and they used to be interleaved in a five-branch `if/else` where a new branch
 * could easily read one coordinate and write another.
 *
 * @param {JxPath} sel
 * @param {string | null} activeSelector
 * @param {string | null} editMedia
 * @returns {StyleMutateFn}
 */
function contextMutate(
  sel: JxPath,
  activeSelector: string | null,
  editMedia: string | null,
): StyleMutateFn {
  if (activeSelector && isTagPath(activeSelector)) {
    const stylePath = activeSelector.split(" ");
    return editMedia
      ? (t, prop, val) =>
          mutateUpdateMediaNestedStylePath(
            t,
            sel,
            editMedia,
            stylePath,
            prop,
            val as string | undefined,
          )
      : (t, prop, val) =>
          mutateUpdateNestedStylePath(t, sel, stylePath, prop, val as string | undefined);
  }
  if (activeSelector) {
    return editMedia
      ? (t, prop, val) =>
          mutateUpdateMediaNestedStyle(
            t,
            sel,
            editMedia,
            activeSelector,
            prop,
            val as string | undefined,
          )
      : (t, prop, val) =>
          mutateUpdateNestedStyle(t, sel, activeSelector, prop, val as string | undefined);
  }
  return editMedia
    ? (t, prop, val) => mutateUpdateMediaStyle(t, sel, editMedia, prop, val as string | undefined)
    : (t, prop, val) => mutateUpdateStyle(t, sel, prop, val as string | undefined);
}

/**
 * Which properties the selected elements disagree about, at the coordinate the tab is editing.
 *
 * Resolved through the SAME `resolveContextStyle` the panel reads its own values with, so "mixed"
 * is decided at exactly the breakpoint, scheme layer and selector the Target Line names — two cards
 * that differ only inside `@md` are not mixed while you are editing Base.
 *
 * Returns an empty set for a selection of one, which is the whole reason a single selection renders
 * no Mixed state anywhere: the loop never finds a second value to disagree with.
 *
 * @param {Tab} tab
 * @param {readonly JxPath[]} targets
 * @param {string | null} activeSelector
 * @param {string | null} editMedia
 * @returns {Set<string>}
 */
function mixedStyleProps(
  tab: Tab,
  targets: readonly JxPath[],
  activeSelector: string | null,
  editMedia: string | null,
): Set<string> {
  const mixed = new Set<string>();
  if (targets.length < 2) {
    return mixed;
  }
  const blocks = targets.map((path) => {
    const node = getNodeAtPath(tab.doc.document, path) as JxMutableNode | undefined;
    return resolveContextStyle(node?.style ?? {}, activeSelector, editMedia);
  });
  const props = new Set<string>();
  for (const block of blocks) {
    for (const prop of Object.keys(block)) {
      props.add(prop);
    }
  }
  for (const prop of props) {
    if (unifyValues(blocks.map((block) => block[prop] ?? null)).mixed) {
      mixed.add(prop);
    }
  }
  return mixed;
}

// ─── The edit target ─────────────────────────────────────────────────────────

/** Forget the selector menu's element handle — the Inspector unmounted, or a test starts clean. */
export function resetSelectorMenu(): void {
  resetTargetSelector();
}

/**
 * Whether the "show affected" list under a project-wide warning band is open.
 *
 * Module-local rather than a `session.ui` field: it is a disclosure on a project-level warning, and
 * a per-document field would make the same warning open in one tab and closed in another. Reactive
 * because the tab is now driven by an `effect()` — a plain field would move the disclosure and
 * nothing would redraw.
 */
const _disclosure = reactive({ showAffected: false, usageRevision: 0 });

/** Fold the affected list away — the Inspector unmounted, or a test starts clean. */
export function resetAffectedDisclosure(): void {
  _disclosure.showAffected = false;
}

/**
 * Ask a registered command to do something this panel does not own.
 *
 * The breakpoint and the colour scheme are DEFINED in Project Settings › Contexts and SELECTED on
 * the pane context bar. A Target Line segment that opened its own list would be the third selector
 * §6.4 forbids, so it routes to the definition site through the same command the context bar's
 * "Manage contexts…" footer runs.
 */
function runCommand(id: string, args?: Record<string, unknown>): void {
  void activeRegistry()?.run(id, args);
}

/**
 * The tag a stylebook rule restyles, when one is being edited.
 *
 * In Stylebook the "selector" is a bare tag path (`h1`, `table th`) written into the DOCUMENT's
 * root style, so the first segment of the path is the tag whose blast radius the scope chip
 * states.
 */
function stylebookTagOf(selector: string | null): string | null {
  return selector && isTagPath(selector) ? (selector.split(" ")[0] ?? null) : null;
}

/**
 * Whether this document IS the project's stylesheet.
 *
 * `project.json`'s `style` is not a document's style. The compiler hands it to EVERY route's
 * compile as `projectStyle` (`site/site-build.ts`), and `compileStyles` emits its custom properties
 * as `:root`, its flat properties as `body`, and every bare tag key as a global rule — so `{ "h1":
 * { "color": "red" } }` in project.json becomes `h1 { color: red }` in the stylesheet of every
 * page, reaching inside every component instance too (nothing in the compiler or the runtime
 * attaches a shadow root). Studio shows the same cascade: `getEffectiveStyle` merges the object
 * into every open document.
 *
 * That makes the document Stylebook opens by default the widest blast radius in the app — and it is
 * the one `resolveScope` used to label "in this **document**", the narrowest.
 *
 * Matched by suffix rather than by equality, the way `studio.ts` and `imports-panel.ts` already
 * address this file: a config reached from a sub-directory is still a config, and it still has no
 * elements of its own for "in this document" to be about.
 */
function isProjectStylesheet(path: string): boolean {
  return /(?:^|\/)project\.json$/.test(path);
}

/**
 * How wide an edit here reaches, and — for the project case — how wide, in numbers.
 *
 * Three kinds, in the order a user meets them:
 *
 * - **element** — an element is selected; the rule is scoped to it and to nothing else.
 * - **document** — Stylebook on an ordinary document: every `<tag>` on this page.
 * - **project** — the same keystroke restyles files that are not open. Two documents reach this far:
 *   a LAYOUT, whose root style is inherited by every page declaring it, and
 *   {@link isProjectStylesheet}, which is inherited by all of them.
 *
 * The project stylesheet reaches it with NO tag as well, which no other document does: deselecting
 * in Stylebook leaves the tab editing project.json's own root style — `:root` and `body` on every
 * route — and there is no element anywhere for "this element" to have meant.
 */
function resolveScope(tab: Tab, stylebookTag: string | null): TargetScope {
  const path = tab.documentPath ?? "";
  const isProjectStyle = isProjectStylesheet(path);
  if (!stylebookTag) {
    return isProjectStyle
      ? projectScope("every page in this project", null)
      : { kind: "element", label: "this element" };
  }
  const shared = isProjectStyle || /^\.?\/?layouts\//.test(path);
  const label = `all <${stylebookTag}> in this ${shared ? "project" : "document"}`;
  return shared ? projectScope(label, stylebookTag) : { kind: "document", label };
}

/**
 * The project-wide warning band: its label, its count, and its disclosure.
 *
 * The count is `findReferences`' tag walk, which counts `tagName` matches across the project. Where
 * the host cannot answer — no `findReferences` route, a failed sweep, or no tag to ask about — the
 * band says **unknown** rather than a confident zero, exactly as `services/references.ts` requires
 * of every rendering.
 *
 * @param {string} label
 * @param {string | null} tagName — null for a root-style edit, which has no tag to count.
 * @returns {TargetScope}
 */
function projectScope(label: string, tagName: string | null): TargetScope {
  if (tagName === null) {
    // No tag, so no query: `:root`/`body` on every route is not a `tagName` sweep, and how many
    // Routes that is, is a question no surface here can answer. A zero would be the same lie the
    // Band exists to stop, in a smaller font — and with no file list, there is nothing to disclose.
    return { affected: "how many pages that is, is unknown", kind: "project", label };
  }
  const query = { tagName };
  // The cache behind `peekUsages` is a plain Map, so a settled sweep is invisible to the effect
  // Driving this tab. The revision is what makes it visible, and reading it here is what enrols
  // The projection in it.
  void _disclosure.usageRevision;
  const state = peekUsages(query);
  if (state === null) {
    // First projection for this tag: ask once, and re-project when the answer lands. `loadUsages`
    // Joins an in-flight request, so a tab re-projecting sixty times a second is still one sweep.
    void loadUsages(query).then(() => {
      /* The bump is conditional on the cache having actually SETTLED, and that condition is what
         makes the loop terminate. Bumping unconditionally would re-run the effect, which would find
         `peekUsages` still null, ask again and bump again — a spin, not a repaint. A host that
         cannot answer this query at all is exactly the state that produces it. */
      if (peekUsages(query) !== null) {
        _disclosure.usageRevision += 1;
      }
    });
  }
  return {
    kind: "project",
    label,
    affected: affectedSentence(state),
    affectedFiles: state?.status === "ready" ? usageFiles(state.result) : [],
    showAffected: _disclosure.showAffected,
    onToggleAffected: () => {
      _disclosure.showAffected = !_disclosure.showAffected;
    },
  };
}

/** The affected count, in words — and "unknown" wherever the query cannot answer. */
function affectedSentence(state: ReturnType<typeof peekUsages>): string {
  if (state === null || state.status === "pending") {
    return "counting the elements it affects…";
  }
  if (state.status !== "ready") {
    return "how many elements that is, is unknown";
  }
  const { files, refsTotal } = state.result;
  if (refsTotal === 0) {
    return "no element in the project uses it yet";
  }
  return `${refsTotal} element${refsTotal === 1 ? "" : "s"} in ${files.length} file${
    files.length === 1 ? "" : "s"
  }`;
}

/** The two axes the Style tab states but does not own, plus the element it is pointed at. */
function targetSegments(
  elementLabel: string,
  mediaTab: string | null,
  hasBreakpoints: boolean,
  schemeLayer: string | null,
): TargetSegment[] {
  const segments: TargetSegment[] = [
    {
      key: "element",
      label: elementLabel,
      title: "What these edits are pointed at — click to find it in the Outline",
      onActivate: () => runCommand("view.setActivity", { tab: "layers" }),
    },
    {
      key: "media",
      label: hasBreakpoints && mediaTab ? `@${mediaDisplayName(mediaTab)}` : "Base",
      title:
        "The breakpoint these edits land in. Choose it on the pane's Context control; click to " +
        "manage breakpoints.",
      onActivate: () => runCommand("settings.open", { section: "contexts" }),
    },
  ];
  if (schemeLayer) {
    segments.push({
      key: "scheme",
      label: `${mediaDisplayName(schemeLayer)} variant`,
      title:
        "Edits land in this colour-scheme variant. Set the pane's Context control back to Auto " +
        "to edit base styles; click to manage schemes.",
      onActivate: () => runCommand("settings.open", { section: "contexts" }),
    });
  }
  return segments;
}

// ─── Provenance ──────────────────────────────────────────────────────────────

/** An inherited value, its donor's name, and how to go there. */
interface InheritedInfo {
  value: string | number;
  donor: string;
  jump?: (() => void) | undefined;
}

/**
 * The signal a `${…}` style value reads, when it reads one.
 *
 * `state.` is optional because both spellings occur in documents and both mean the same entry — the
 * chip names the signal, not the accessor path it was reached by.
 */
function templateSignalOf(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return /\$\{\s*(?:state\.)?([A-Za-z_$][\w$]*)/.exec(value)?.[1] ?? null;
}

/** Whether a value is a `${}` template rather than a literal — the `bound` rung for a CSS value. */
function isTemplateValue(value: unknown): boolean {
  return typeof value === "string" && value.includes("${");
}

/** What the Style tab can say about one property's origin. */
interface ProvenanceCtx {
  own: JxStyle;
  active: JxStyle;
  inherited: Record<string, InheritedInfo>;
  signals: string[];
  clear: (prop: string) => void;
  /**
   * Properties the selected elements DISAGREE about, and how many elements are selected (§6.5).
   *
   * Empty for a selection of one — which is what keeps every other branch of `provenanceOf`
   * reachable exactly as often as it was before the selection became a set.
   */
  mixed?: { props: Set<string>; count: number } | undefined;
}

/**
 * Where this property's value came from.
 *
 * Four answers, and three of them were previously indistinguishable from each other: an inherited
 * value arrived as a placeholder identical to the CSS initial value, a site token arrived looking
 * like a local override, and a `${}` binding arrived looking like a literal with braces in it.
 */
function provenanceOf(prop: string, ctx: ProvenanceCtx): FieldProvenance {
  // Mixed is decided FIRST, because it is a fact about the selection rather than about the value:
  // The primary's own value may be perfectly ordinary while five other elements disagree with it,
  // And drawing that as `set` is exactly the lie this state exists to stop.
  if (ctx.mixed?.props.has(prop)) {
    return {
      state: "mixed",
      donor: String(ctx.mixed.count),
      onClick: () => ctx.clear(prop),
    };
  }
  const value = ctx.active[prop];
  if (value !== undefined && ctx.own[prop] === undefined) {
    // Present in the effective style but not in the document's own: it came from the site style.
    // No jump: the project style document is not something this tab can open.
    return {
      state: "inherited",
      donor: "site tokens",
      title: `Inherited from the project's site tokens — ${prop} is not set on this document`,
    };
  }
  if (value !== undefined) {
    if (isTemplateValue(value)) {
      const signal = templateSignalOf(value);
      return {
        state: "bound",
        ...(signal ? { donor: signal } : {}),
        ...(signal && ctx.signals.includes(signal)
          ? {
              onClick: () => {
                runCommand("view.setActivity", { tab: "data" });
                runCommand("data.expandRow", { name: signal });
              },
            }
          : {}),
      };
    }
    return { state: "set", onClick: () => ctx.clear(prop) };
  }
  const inherited = ctx.inherited[prop];
  if (inherited) {
    return {
      state: "inherited",
      donor: inherited.donor,
      ...(inherited.jump ? { onClick: inherited.jump } : {}),
    };
  }
  return { state: "default" };
}

/**
 * Where a SHORTHAND row's value came from.
 *
 * A shorthand is less a value than a name for four of them, so every answer it can give is about
 * five properties at once: `padding` is set when `padding` or any of `paddingTop…Left` is, mixed
 * when the selection disagrees about any of the five, and inherited when the cascade supplies one
 * and this document supplies none. Asking only about the shorthand key is what let the row draw a
 * plain "Clear padding" dot over a property the panel had already computed as mixed.
 *
 * @param {string} shortProp
 * @param {ProvenanceCtx} ctx
 * @param {(() => void) | undefined} [clearAll] — clears the shorthand AND its longhands, which is
 *   the only clear this row has ever meant; omitted where there is nothing to clear.
 * @returns {FieldProvenance}
 */
function shorthandProvenance(
  shortProp: string,
  ctx: ProvenanceCtx,
  clearAll?: (() => void) | undefined,
): FieldProvenance {
  const props = [shortProp, ...(getLonghands(shortProp) as CssLonghand[]).map((l) => l.name)];
  const { mixed } = ctx;
  if (mixed && props.some((p) => mixed.props.has(p))) {
    return {
      state: "mixed",
      donor: String(mixed.count),
      ...(clearAll ? { onClick: clearAll } : {}),
    };
  }
  for (const p of props) {
    const prov = provenanceOf(p, ctx);
    if (prov.state === "default") {
      continue;
    }
    return prov.state === "set" && clearAll ? { ...prov, onClick: clearAll } : prov;
  }
  return DEFAULT_PROVENANCE;
}

/**
 * Where a longhand CHILD row's value came from.
 *
 * A longhand can hold a value it was never given: `padding: 1px 2px` fills four child rows, and
 * clearing one of them recompresses the shorthand rather than deleting a key. So a value derived
 * from the shorthand counts as `set` here, and a selection that disagrees about the shorthand
 * disagrees about every child the shorthand fills.
 *
 * @param {string} name
 * @param {string} shortProp
 * @param {boolean} hasValue — set here, or filled in by the shorthand above.
 * @param {ProvenanceCtx} ctx
 * @param {() => void} clearChild
 * @returns {FieldProvenance}
 */
function longhandProvenance(
  name: string,
  shortProp: string,
  hasValue: boolean,
  ctx: ProvenanceCtx,
  clearChild: () => void,
): FieldProvenance {
  const { mixed } = ctx;
  if (mixed && (mixed.props.has(name) || (hasValue && mixed.props.has(shortProp)))) {
    return { state: "mixed", donor: String(mixed.count), onClick: clearChild };
  }
  const prov = provenanceOf(name, ctx);
  if (prov.state === "set" || (prov.state === "default" && hasValue)) {
    return { state: "set", onClick: clearChild };
  }
  return prov;
}

/**
 * A section's tally, counting a shorthand as set when any of its longhands is.
 *
 * @param {{ prop: string; entry: CssPropertyEntry }[]} entries
 * @param {ProvenanceCtx} ctx
 */
function sectionProvenance(
  entries: { prop: string; entry: CssPropertyEntry }[],
  ctx: ProvenanceCtx,
): ProvenanceState[] {
  return entries.map(({ prop, entry }) =>
    inferInputType(entry) === "shorthand"
      ? shorthandProvenance(prop, ctx).state
      : provenanceOf(prop, ctx).state,
  );
}

// ─── The row register ────────────────────────────────────────────────────────

/** One choice a row's list offers. `divider` draws a rule above the entry. */
interface StyleChoice {
  value: string;
  label: string;
  divider?: boolean;
  checked?: boolean;
}

/**
 * What one projected row can DO, held beside the row the document draws.
 *
 * The document names a row by its `key` and nothing else, so this is where a key becomes a verb.
 * Every handler is optional because rows differ in what they own: a longhand child has no Value
 * Source ladder, a custom pair has no unit list, and the add-a-property field has no value to
 * clear.
 */
interface RowActions {
  /** The reader is typing — debounced under {@link RowActions.debounceId}. */
  edit?: (value: string) => void;
  /** The reader left the field or pressed Enter. Cancels the pending debounce first. */
  commit?: (value: string) => void;
  debounceId?: string;
  /** The provenance chip, a custom pair's remove and a nested rule's remove are one verb. */
  chip?: () => void;
  /** The list this row's chooser offers, and what taking one from it does. */
  choices?: StyleChoice[];
  choicesLabel?: string;
  choose?: (value: string) => void;
  /** The Value Source ladder for this position (§6.3). */
  source?: {
    mode: SlotMode;
    caps: SlotMode[];
    fieldKey: string;
    value: unknown;
    stateDefs: string[];
    onChange: (value?: JsonValue) => void;
  };
  /** Expand or collapse a shorthand's longhands. */
  toggle?: () => void;
  /** Rename a custom property, keeping each element's own value. */
  rename?: (name: string) => void;
  /** Seed a new custom property. Returns whether anything was written. */
  add?: (name: string) => boolean;
  /** Open a nested rule as the active selector. */
  open?: () => void;
}

/** Every row on screen, by key. Rebuilt whole on every projection; read by every action. */
let _rows = new Map<string, RowActions>();

/** What each section's clear-all dot does. Rebuilt with the sections it belongs to. */
let _sectionClears = new Map<string, () => void>();

/** What "+ Add" under Relative Styling does. Rebuilt with the section. */
let _nestedAdd: (() => void) | null = null;

/** The value each button-group row is holding — pressing the selected button again clears it. */
let _buttonValues = new Map<string, string>();

/** Look one row up. A key the projection no longer has is a stale click, and does nothing. */
function rowActions(key: string): RowActions | undefined {
  return _rows.get(key);
}

// ─── Widgets ─────────────────────────────────────────────────────────────────

/** Whether a typed value is a bare number — the unit control's own test. */
function isNumericValue(value: string): boolean {
  return /^-?\d*\.?\d*$/.test(value);
}

/**
 * Kit glyph names for the values a button-group offers.
 *
 * Only names the kit ACTUALLY has (`@jxsuite/ui/icons`) are here, and every other value falls back
 * to `abbreviateValue`, which is the same fallback the group has always had for a value with no
 * icon. The alternative was to guess an approximation — `align-left` for `justify-content:
 * flex-start`, say, which is a text-alignment glyph — and a glyph that means something else is
 * worse than three letters that mean what they say. The seventeen names still missing are recorded
 * against the kit rather than approximated here.
 */
const BUTTON_GLYPHS: Readonly<Record<string, string>> = {
  "arrow-down": "arrow-down",
  "arrow-left": "arrow-left",
  "arrow-right": "arrow-right",
  "arrow-up": "arrow-up",
  "text-align-center": "text-align-center",
  "text-align-justify": "text-align-justify",
  "text-align-left": "text-align-left",
  "text-align-right": "text-align-right",
};

/** The buttons a button-group row draws, and the overflow list it hands to the kit menu. */
function buttonGroup(
  entry: CssPropertyEntry,
  rowKey: string,
  value: string,
): { buttons: StyleButtonView[]; extra: string[] } {
  const values = (entry.$buttonValues || entry.enum || []) as string[];
  const iconMap = (entry.$icons || {}) as Record<string, string>;
  const buttonValues = entry.$buttonValues as string[] | undefined;
  const enumValues = entry.enum as string[] | undefined;
  const extra =
    buttonValues && enumValues && enumValues.length > buttonValues.length
      ? enumValues.filter((v) => !buttonValues.includes(v))
      : [];
  const buttons = values.map((v) => {
    const icon = BUTTON_GLYPHS[iconMap[v] ?? ""] ?? "";
    return {
      icon,
      row: rowKey,
      selected: v === value,
      text: icon === "" ? abbreviateValue(v) : "",
      title: v,
      value: v,
    };
  });
  return { buttons, extra };
}

/** How a keyword reads in a list: `Inline block` for `inline-block`, `Flex` for `flex`. */
function keywordLabel(value: string): string {
  return value.includes("-") ? kebabToLabel(value) : value.replace(/^./, (c) => c.toUpperCase());
}

/** The keyword list a button row's overflow menu offers, in the words the menu prints. */
function keywordChoices(options: string[], value: string): StyleChoice[] {
  return options.map((v) => ({ checked: v === value, label: keywordLabel(v), value: v }));
}

/**
 * The keyword list a `keywords` row suggests under its field.
 *
 * A typography row's options are their own preview: the axis the row moves is set on each option as
 * the value it offers, through the `jx-option` channel `TYPO_PREVIEW_CHANNELS` names, and every
 * such option is set in the element's own `face` — so a weight row shows `700` at 700 in the
 * typeface the element actually uses, rather than in the panel's. Any other row's options are the
 * words alone.
 */
function keywordOptions(options: string[], prop: string, face: string): StyleOptionView[] {
  const channel = TYPO_PREVIEW_CHANNELS[prop];
  return options.map((v) => {
    const option: StyleOptionView = { label: keywordLabel(v), value: v };
    if (channel) {
      option[channel] = v;
      option.face = face;
    }
    return option;
  });
}

/**
 * The typeface the edited element is set in, for the typography rows to preview their values in:
 * its own `fontFamily`, else the base context's when a breakpoint is being edited (which is what
 * `inheritedStyle` holds — the cascade within the coordinate, not the ancestors'), followed through
 * the effective style to the stack at the end of the chain. Empty when the element has no typeface
 * of its own or the reference cannot be followed, in which case the rows are set in the panel's.
 */
function previewFace(ctx: EditorCtx): string {
  const raw = ctx.activeStyle.fontFamily ?? ctx.inheritedStyle.fontFamily;
  if (typeof raw !== "string" && typeof raw !== "number") {
    return "";
  }
  const resolved = resolveTokenValue(getEffectiveStyle(ctx.tab.doc.document?.style), raw);
  return resolved === undefined ? "" : String(resolved);
}

/** The Modern Font Stacks a `fontFamily` entry offers, as css-meta.json states them. */
function fontPresets(entry: CssPropertyEntry): { title: string; value: string }[] {
  return Array.isArray(entry.presets) ? (entry.presets as { title: string; value: string }[]) : [];
}

/**
 * The font list: the project's `--font-*` tokens first — the site's and the document's together,
 * which is where a project declares its fonts once — then the presets it has not minted yet. Every
 * row is its own specimen through `face`, which is the reason this is a combobox over `jx-option`
 * rows rather than the kit menu it used to be: a menu row is an action and cannot draw itself in a
 * typeface (ui.md §5.1), and a font is the one thing a reader chooses by looking.
 *
 * A row's VALUE is a token's name, minted or not, because that is what the field holds after a pick
 * and what the commit turns into `var(--name)`. A token row says its name beside its title, so what
 * the pick will write is in the list; a preset row is bare, which is what tells the two groups
 * apart in a list that draws no divider.
 */
function fontOptions(entry: CssPropertyEntry): StyleOptionView[] {
  const fontVars = getFontVars();
  const style = getEffectiveStyle(activeTab.value?.doc.document?.style);
  const options: StyleOptionView[] = fontVars.map((fv) => ({
    description: fv.name,
    face: String(resolveTokenValue(style, fv.value) ?? fv.value),
    label: varDisplayName(fv.name, "--font-"),
    value: fv.name,
  }));
  for (const preset of fontPresets(entry)) {
    const name = friendlyNameToVar(preset.title, "--font-");
    if (!fontVars.some((fv) => fv.name === name)) {
      options.push({ face: preset.value, label: preset.title, value: name });
    }
  }
  return options;
}

/**
 * What the font field WRITES. A token name becomes the reference that points at it; free text —
 * `Georgia, serif` — is the value itself; and the empty string clears. A name that is a preset's
 * and no token yet is minted into the document's own style first, so the token exists before
 * anything references it — but only on a COMMIT, never on the debounced edit that follows each
 * keystroke: a reader halfway through typing `--font-slab-serif` has not asked for a token, and one
 * minted early would be left behind when they finished typing something else.
 */
function commitFont(
  entry: CssPropertyEntry,
  raw: string,
  mint: boolean,
  onCommit: (value: string) => void,
): void {
  const name = raw.trim();
  if (!name.startsWith("--")) {
    onCommit(raw);
    return;
  }
  if (mint && getEffectiveStyle(activeTab.value?.doc.document?.style)[name] === undefined) {
    const preset = fontPresets(entry).find((p) => friendlyNameToVar(p.title, "--font-") === name);
    if (preset) {
      transactDoc(activeTab.value, (t) => mutateUpdateStyle(t, [], name, preset.value));
    }
  }
  onCommit(toTokenRef(name));
}

/** A blank row, so every `$switch` case reads a path that exists whatever the row draws. */
function blankRow(key: string, prop: string, kind: StyleRowView["kind"]): StyleRowView {
  return {
    buttons: [],
    child: false,
    chip: "none",
    chipState: "default",
    chipText: "",
    chipTitle: "",
    choicesHint: "",
    choicesLabel: "",
    expandIcon: "caret-right",
    expandLabel: "",
    expanded: false,
    hasChoices: false,
    hasLabel: false,
    hasSource: false,
    hasTokens: false,
    key,
    kind,
    label: "",
    max: "",
    min: "",
    mono: false,
    name: "",
    openTitle: "",
    options: [],
    overflowSelected: false,
    placeholder: "",
    prop,
    removeLabel: "",
    resolved: "",
    sourceHint: "",
    sourceLabel: "",
    sourceState: "literal",
    span: false,
    step: "",
    tokens: [],
    value: "",
    warning: false,
    widget: "text",
  };
}

/** Fill a row's chip fields from the provenance answer, and register its click. */
function applyChip(row: StyleRowView, actions: RowActions, prov: FieldProvenance): void {
  if (prov.state === "default") {
    row.chip = "none";
    return;
  }
  row.chipState = prov.state;
  row.chipText = provenanceText(prov);
  row.chipTitle = provenanceTitle(row.prop, prov);
  if (prov.onClick) {
    row.chip = "button";
    actions.chip = prov.onClick;
  } else {
    row.chip = "text";
  }
}

// ─── The projection ──────────────────────────────────────────────────────────

/** What {@link buildEditor} is handed once, having resolved the coordinate. */
interface EditorCtx {
  tab: Tab;
  /** The block at the edited coordinate, as the rows display it. */
  activeStyle: JxStyle;
  activeSelector: string | null;
  editMedia: string | null;
  inheritedStyle: Record<string, string | number>;
  provCtx: ProvenanceCtx;
  templateSignals: string[];
  /** One write, fanned across every selected element, inside the caller's transaction. */
  mutate: StyleMutateFn;
  /** The same write in a transaction of its own. */
  commit: (prop: string, value?: string | Record<string, unknown> | undefined) => void;
  /** The key prefix a row's identity is built from — the coordinate, spelled once. */
  coord: string;
  targets: readonly JxPath[];
  filter: string;
}

/**
 * The rungs a CSS declaration admits.
 *
 * Derived from `StyleObject.additionalProperties` rather than listed (§6.6 rule 2), minus `ref` —
 * and that subtraction is the rule the panel already wrote down being enforced rather than a
 * narrowing of it. **`JxStyle` has no `$ref` branch at all**: a CSS value carrying `${…}` IS the
 * signal binding, which `emitStyleString` compiles to a reactive declaration, and a `{ $ref }` in a
 * declaration is a document the schema refuses. The generic ladder offered the rung anyway whenever
 * the document happened to declare a signal — the old panel's own test asserted "literal and
 * template only" and passed only because its fixture had none — so a document with one signal in it
 * put a control on every style row that writes an invalid style block.
 */
function styleCaps(): SlotMode[] {
  return slotCaps("styleProperty").filter((mode) => mode !== "ref");
}

/** One ordinary property row: the label, the chip, the ladder and whichever control it draws. */
function fieldRow(
  ctx: EditorCtx,
  entry: CssPropertyEntry,
  prop: string,
  value: string,
  opts: {
    child?: boolean;
    warning?: boolean;
    span?: boolean;
    provenance: FieldProvenance;
    onCommit: (value: string | undefined) => void;
    placeholder?: string;
  },
): { row: StyleRowView; actions: RowActions } {
  const key = `${ctx.coord}|${prop}${opts.child ? "|child" : ""}`;
  const row = blankRow(key, prop, "field");
  const actions: RowActions = {};
  const type = inferInputType(entry);
  const cssInitial = getCssInitialMap().get(prop) ?? "";
  const placeholder = opts.placeholder || cssInitial;
  const commitLiteral = (v: string) => opts.onCommit(v === "" ? undefined : v);

  row.label = propLabel(entry, prop);
  row.hasLabel = true;
  row.child = opts.child === true;
  row.warning = opts.warning === true;
  row.span = opts.span === true;
  row.value = value;
  row.placeholder = placeholder;
  applyChip(row, actions, opts.provenance);

  // The Value Source ladder (§6.3), and only where the position has one to offer. A longhand child
  // Is not a document position of its own — its value is a slice of the shorthand above it — so it
  // Carries no chip, which is what it has always done.
  if (!opts.child) {
    const caps = styleCaps();
    const fieldKey = `${ctx.coord}|${prop}`;
    const mode = effectiveSlotMode(fieldKey, value === "" ? undefined : value);
    row.hasSource = true;
    row.sourceState = mode;
    row.sourceLabel = VALUE_SOURCE_LABELS[mode];
    row.sourceHint = `Value source: ${VALUE_SOURCE_LABELS[mode]} — click to change`;
    actions.source = {
      caps,
      fieldKey,
      mode,
      onChange: (v) => opts.onCommit(v === undefined || v === "" ? undefined : String(v)),
      stateDefs: ctx.templateSignals,
      value: value === "" ? undefined : value,
    };
    if (mode === "template") {
      // The `${…}` rung: a mixed-text value is committed when the field is LEFT, never while it is
      // Typed — a half-written `${state.m` is not a binding, and writing one would move the row's
      // Rung out from under the caret.
      row.widget = "text";
      row.mono = true;
      row.placeholder = "${state.…}";
      actions.commit = (v) => opts.onCommit(v === "" ? undefined : v);
      return { actions, row };
    }
  }

  switch (type) {
    case "color": {
      row.widget = "color";
      row.tokens = colorTokens();
      row.hasTokens = row.tokens.length > 0;
      /* The literal behind a token, for the chip: `var(--color-accent)` resolves in the canvas and
         nowhere in this page, so without it a pick from the palette drew the no-colour chip. */
      row.resolved = resolvedColor(value);
      /* Both verbs, as a text row has: the field says `input` on every frame of a drag and
         `change` when the reader lets go, so the drag is debounced into one write per pause and
         the release lands immediately. */
      actions.edit = commitLiteral;
      actions.commit = commitLiteral;
      actions.debounceId = `color:${key}`;
      break;
    }
    case "button-group": {
      const { buttons, extra } = buttonGroup(entry, key, value);
      row.widget = "buttons";
      row.buttons = buttons;
      row.hasChoices = extra.length > 0;
      row.overflowSelected = extra.includes(value);
      row.choicesLabel = "";
      row.choicesHint = `More ${row.label.toLowerCase()} values`;
      actions.choices = keywordChoices(extra, value);
      actions.choose = commitLiteral;
      break;
    }
    case "number-unit": {
      const units = (entry.$units ?? []) as string[];
      const keywords = (entry.$keywords ?? []) as string[];
      const match = UNIT_RE.exec(value);
      const isKeyword = !match && value !== "" && keywords.includes(value);
      const currentUnit = isKeyword ? (units[0] ?? "") : (match?.[2] ?? units[0] ?? "");
      row.widget = "group";
      row.value = unitDisplayValue(value, match, isKeyword);
      row.placeholder = unitPlaceholder(placeholder);
      row.hasChoices = units.length > 0 || keywords.length > 0;
      row.choicesLabel = currentUnit || units[0] || "";
      row.choicesHint = `Unit for ${row.label.toLowerCase()}`;
      actions.choices = [
        ...units.map((u) => ({ checked: u === currentUnit, label: u, value: u })),
        ...keywords.map((kw, index) => ({
          checked: kw === value,
          label: kw,
          value: kw,
          ...(index === 0 && units.length > 0 ? { divider: true } : {}),
        })),
      ];
      actions.choose = (chosen) => {
        if (keywords.includes(chosen)) {
          opts.onCommit(chosen);
          return;
        }
        const numPart = UNIT_RE.exec(value)?.[1];
        if (numPart) {
          opts.onCommit(numPart + chosen);
        }
      };
      {
        const commitUnitValue = (raw: string) => {
          const v = raw.trim();
          if (v === "") {
            opts.onCommit("");
            return;
          }
          opts.onCommit(isNumericValue(v) && units.length > 0 ? v + currentUnit : v);
        };
        actions.edit = commitUnitValue;
        actions.commit = commitUnitValue;
        actions.debounceId = `nui:${key}`;
      }
      break;
    }
    case "number": {
      row.widget = "number";
      row.min = entry.minimum === undefined ? "" : String(entry.minimum);
      row.max = entry.maximum === undefined ? "" : String(entry.maximum);
      row.step = typeof entry.maximum === "number" && entry.maximum <= 1 ? "0.1" : "";
      actions.commit = commitLiteral;
      break;
    }
    case "select":
    case "combobox": {
      const options = Array.isArray(entry.enum)
        ? (entry.enum as string[])
        : Array.isArray(entry.examples)
          ? (entry.examples as string[])
          : [];
      // A keyword row is the combobox contract exactly: the field IS the value, and the rows
      // Under it are the values worth offering. `allows-custom-value` is what makes an enum a
      // List of suggestions rather than a whitelist — `full-width` is a text-transform whether or
      // Not the catalogue names it. The font row is the same element over a different list, with
      // A token showing as its own name rather than as the `var()` around it: the field edits
      // Which token this is, and `var(--font-body)` is punctuation the reader did not type. What
      // Differs is what a commit WRITES, and that is `commitFont`'s.
      row.widget = "keywords";
      if (prop === "fontFamily") {
        row.value = tokenRefName(value) ?? value;
        row.options = fontOptions(entry);
        actions.edit = (v) => commitFont(entry, v, false, commitLiteral);
        actions.commit = (v) => commitFont(entry, v, true, commitLiteral);
      } else {
        row.options = keywordOptions(options, prop, previewFace(ctx));
        actions.edit = commitLiteral;
        actions.commit = commitLiteral;
      }
      actions.debounceId = `kw:${key}`;
      break;
    }
    default: {
      row.widget = "text";
      actions.edit = commitLiteral;
      actions.commit = commitLiteral;
      actions.debounceId = `text:${key}`;
      break;
    }
  }
  return { actions, row };
}

/** What a unit field SHOWS: the number alone, or the keyword, or whatever could not be parsed. */
function unitDisplayValue(
  value: string,
  match: RegExpExecArray | null,
  isKeyword: boolean,
): string {
  if (isKeyword) {
    return value;
  }
  if (match) {
    return match[1] ?? "";
  }
  if (value === "") {
    return "";
  }
  // Intentional partial parse: a shorthand like "10px 20px" shows its leading number.
  // oxlint-disable-next-line unicorn/prefer-number-coercion
  const num = Number.parseFloat(value);
  return Number.isNaN(num) ? value : String(num);
}

/** A unit field's placeholder is the inherited NUMBER — "500", not "500px". */
function unitPlaceholder(placeholder: string): string {
  return UNIT_RE.exec(placeholder)?.[1] ?? placeholder ?? "0";
}

/** A shorthand header row and, when it is expanded, the longhand children under it. */
function shorthandRows(
  ctx: EditorCtx,
  entry: CssPropertyEntry,
  shortProp: string,
): { row: StyleRowView; actions: RowActions }[] {
  const longhands = getLonghands(shortProp) as CssLonghand[];
  const style = ctx.activeStyle as Record<string, unknown>;
  const shortVal = style[shortProp];
  const hasLonghands = longhands.some((l) => style[l.name] !== undefined);
  const isExpanded = ctx.tab.session.ui.styleShorthands[shortProp] ?? hasLonghands;
  const hasAnyVal = shortVal !== undefined || hasLonghands;
  const inherited = ctx.inheritedStyle;

  /**
   * Drop every longhand, then write the shorthand — the one write order this row has.
   *
   * The longhands go unconditionally rather than "the ones the panel can see set", because what the
   * panel can see is the PRIMARY element's style: a second selected element with a `paddingTop` of
   * its own would otherwise keep it and quietly out-rank the shorthand just written over it.
   * Deleting a property an element does not have is a no-op on that element.
   */
  const writeShorthand = (val?: string | undefined) =>
    transactDoc(activeTab.value, (t) => {
      for (const l of longhands) {
        ctx.mutate(t, l.name);
      }
      ctx.mutate(t, shortProp, val);
    });
  const clearAll = () =>
    transactDoc(activeTab.value, (t) => {
      ctx.mutate(t, shortProp);
      for (const l of longhands) {
        ctx.mutate(t, l.name);
      }
    });

  const key = `${ctx.coord}|${shortProp}`;
  const row = blankRow(key, shortProp, "shorthand");
  const actions: RowActions = {};
  row.widget = "shorthand";
  row.hasLabel = true;
  row.label = propLabel(entry, shortProp);
  row.value = typeof shortVal === "string" ? shortVal : "";
  row.placeholder = shorthandPlaceholder(shortVal, longhands, style, inherited, shortProp);
  row.expanded = isExpanded;
  row.expandIcon = isExpanded ? "caret-down" : "caret-right";
  row.expandLabel = `${isExpanded ? "Collapse" : "Expand"} ${row.label.toLowerCase()}`;
  applyChip(
    row,
    actions,
    shorthandProvenance(shortProp, ctx.provCtx, hasAnyVal ? clearAll : undefined),
  );
  actions.edit = (v) => writeShorthand(v || undefined);
  actions.commit = (v) => writeShorthand(v || undefined);
  actions.debounceId = `short:${key}`;
  actions.toggle = () => {
    const tab = activeTab.value;
    if (tab) {
      tab.session.ui.styleShorthands = {
        ...tab.session.ui.styleShorthands,
        [shortProp]: !isExpanded,
      };
    }
  };

  const out = [{ actions, row }];
  if (!isExpanded) {
    return out;
  }

  const isBorderSide = entry.$shorthandType === "border-side";
  const expanded =
    typeof shortVal === "string" && shortVal
      ? isBorderSide
        ? expandBorderSide(shortVal)
        : expandShorthand(shortVal, longhands.length)
      : null;
  const compress = isBorderSide ? compressBorderSide : compressShorthand;
  const emptyVal = isBorderSide ? "" : "0";
  /** This longhand becomes `val`; the others keep whatever they show. */
  const recompress = (idx: number, val: string) =>
    writeShorthand(
      compress(
        longhands.map((l, i) =>
          i === idx ? val : (style[l.name] ?? (expanded ? expanded[i] : emptyVal)),
        ) as string[],
      ),
    );

  for (const [idx, { name, entry: lEntry }] of longhands.entries()) {
    const lVal = style[name] ?? (expanded ? expanded[idx] : "");
    const hasLVal = lVal !== undefined && lVal !== "";
    out.push(
      fieldRow(ctx, lEntry, name, String(lVal ?? ""), {
        child: true,
        onCommit: (newVal) => recompress(idx, newVal || emptyVal),
        placeholder: !lVal && inherited[name] !== undefined ? String(inherited[name]) : "",
        provenance: longhandProvenance(name, shortProp, hasLVal, ctx.provCtx, () =>
          recompress(idx, emptyVal),
        ),
      }),
    );
  }
  return out;
}

/** The shorthand header's placeholder: the longhands it would compress, or what shows through. */
function shorthandPlaceholder(
  shortVal: unknown,
  longhands: CssLonghand[],
  style: Record<string, unknown>,
  inherited: Record<string, string | number>,
  shortProp: string,
): string {
  if (shortVal) {
    return "";
  }
  if (longhands.some((l) => style[l.name] !== undefined)) {
    return longhands.map((l) => style[l.name] || "0").join(" ");
  }
  if (inherited[shortProp] !== undefined) {
    return String(inherited[shortProp]);
  }
  if (longhands.some((l) => inherited[l.name] !== undefined)) {
    return longhands.map((l) => inherited[l.name] || "0").join(" ");
  }
  return "";
}

// ─── The whole view ──────────────────────────────────────────────────────────

/** The three teaching states, and the one that offers a button. */
function emptyView(message: string, withOpen: boolean): StylePanelView {
  return {
    emptyActionLabel: withOpen ? openPageAction().label : "",
    emptyMessage: message,
    filter: "",
    hasEmptyAction: withOpen,
    sections: [],
    view: "empty",
  };
}

/** What the tab is showing, from the state it can read right now. */
function buildView(canvasMode: () => string): StylePanelView {
  _rows = new Map();
  const tab = activeTab.value;
  if (!tab) {
    return emptyView("Open a page to style what you click.", true);
  }
  if (canvasMode() === "stylebook" && shell.stylebook.selection) {
    const node = tab.doc.document;
    if (!node) {
      return emptyView("Open a page to style what you click.", true);
    }
    // No separate `Styling: <h1>` header. It said the same thing the Target Line's scope chip says,
    // Except that it said it as a caption, after the fact, and without the blast radius (§6.1).
    return buildEditor(tab, node, {
      effectiveStyle: getEffectiveStyle(node.style),
      stylebookSelector: shell.stylebook.selection,
    });
  }
  const selected = primarySelection(tab.session.selection);
  if (!selected) {
    return emptyView(clickAnythingTo("style it"), false);
  }
  const node = getNodeAtPath(tab.doc.document, selected) as JxMutableNode | undefined;
  if (!node) {
    return emptyView(staleSelectionMessage(), false);
  }
  return buildEditor(tab, node, {});
}

/**
 * Resolve the coordinate, then project every section under it.
 *
 * @param {Tab} tab
 * @param {JxMutableNode} node
 * @param {{ effectiveStyle?: JxStyle; stylebookSelector?: string | null }} opts — `effectiveStyle`
 *   is the site-merged style Stylebook edits against; `stylebookSelector` is the tag catalogue
 *   entry being styled, which is what makes the edit tag-wide rather than element-wide and
 *   therefore what the scope chip reports.
 */
function buildEditor(
  tab: Tab,
  node: JxMutableNode,
  opts: { effectiveStyle?: JxStyle | undefined; stylebookSelector?: string | null },
): StylePanelView {
  const { effectiveStyle, stylebookSelector = null } = opts;
  const sel = primarySelection(tab.session.selection) as JxPath;
  /** The document's OWN style — what a commit writes into. */
  const ownRootStyle: JxStyle = node.style || {};
  const style = effectiveStyle ?? ownRootStyle;
  // Signals seeding the ${} template default when a style value escalates (no $ref in JxStyle).
  const templateSignals = Object.entries(tab.doc.document.state || {})
    .filter(
      ([, d]) =>
        !(d as Record<string, unknown>)?.$handler &&
        (d as Record<string, unknown>)?.$prototype !== "Function",
    )
    .map(([defName]) => defName);
  const { sizeBreakpoints } = parseMediaEntries(getEffectiveMedia(tab.doc.document.$media));
  const mediaNames = sizeBreakpoints.map((bp) => bp.name);
  const mediaTab = tab.session.ui.activeMedia || null;
  const { activeSelector } = tab.session.ui;

  // ── Scheme-layer routing (spec §9.5) ────────────────────────────────────────
  // With the tab-bar scheme control forcing a scheme that has a matching declared scheme query,
  // Base-context edits target that scheme's `@--name` block — no extra sidebar tabs. Breakpoint
  // Tabs stay breakpoint-scoped (scheme × breakpoint compound blocks are unsupported).
  const forcedScheme = tab.session.ui.previewColorScheme;
  const schemeLayer =
    mediaTab === null && (forcedScheme === "light" || forcedScheme === "dark")
      ? (Object.entries(getEffectiveMedia(tab.doc.document.$media) ?? {}).find(
          ([, q]) => schemeOfQuery(String(q)) === forcedScheme,
        )?.[0] ?? null)
      : null;
  // The media context edits actually target: a valid breakpoint tab, else the scheme layer.
  const editMedia = mediaTab && mediaNames.length > 0 ? mediaTab : schemeLayer;

  // ── The selector axis — the one this tab owns ──────────────────────────────
  const contextStyle = editMedia
    ? (style[`@${editMedia}`] as Record<string, unknown>) || {}
    : style;
  const declaredSelectors = new Set(Object.keys(contextStyle).filter((s) => isNestedSelector(s)));
  /* Element-aware, not the flat global list: `:popover-open` on a `<p>` is a rule that can never
     match, and a menu that offers unmatchable states is a menu people stop reading. What the
     element already DECLARES and the active selector are unioned in after, so nothing an author has
     written can drop out of it. */
  const selectorOptions = [
    ...new Set([
      ...selectorsForNode(node),
      ...declaredSelectors,
      ...(activeSelector ? [activeSelector] : []),
    ]),
  ];

  // ── The Target Line (§6.1) ─────────────────────────────────────────────────
  const stylebookTag = stylebookTagOf(stylebookSelector);
  const elementLabel =
    stylebookTag ?? (typeof node.tagName === "string" ? node.tagName : "element");
  setTargetLine({
    segments: targetSegments(elementLabel, mediaTab, mediaNames.length > 0, schemeLayer),
    selector: {
      value: activeSelector,
      options: selectorOptions,
      declared: declaredSelectors,
      onSelect: (value) => {
        const current = activeTab.value;
        if (!current) {
          return;
        }
        current.session.ui.activeSelector = value;
        /* §6.2's own rule: a control that selects a rendering context has to change the rendering,
           or it is a control over a label. `:hover` gets away with not doing this because you can
           hover the element; `:popover-open` cannot, because a closed popover is not on the screen
           to be put into that state by hand. This is the ONE state the canvas simulates — extending
           it to `:hover` and `:focus` is a larger decision and is deliberately not taken here. */
        if (value?.startsWith(":popover-open")) {
          runCommand("canvas.setPopoverOpen", { open: true });
        }
        // The dialog's open states, by the same rule, when the selection is in a dialog to open.
        if (
          (value?.startsWith("[open]") || value?.startsWith(":modal")) &&
          dialogPathFor(current) !== null
        ) {
          runCommand("canvas.setDialogOpen", { open: true });
        }
      },
      onAddCustom: () => {
        // One flow, through `ui/layers.ts` — the imperative `<input>` this replaces was appended to
        // A bar lit-html owns, bypassing both the renderer and the overlay stack (§11.4).
        void showPromptDialog("Add Selector", {
          confirmLabel: "Use",
          message: "A state or nested rule to edit under this element.",
          placeholder: ":hover, .child, &.active, [attr]",
          validate: (v) =>
            isNestedSelector(v.trim()) ? "" : 'A selector must start with ":", ".", "&" or "[".',
        }).then((value) => {
          if (value && activeTab.value) {
            activeTab.value.session.ui.activeSelector = value.trim();
          }
        });
      },
    },
    scope: resolveScope(tab, stylebookTag),
  });

  // ── Determine the active style object ──────────────────────────────────────
  const activeStyle = resolveContextStyle(style, activeSelector, editMedia);
  // The SAME coordinate, resolved against the document's own style. In Stylebook `style` is the
  // Site-merged effective style, so a property present here and absent there arrived from the
  // Project's tokens — a donor the panel can now name instead of drawing it as a local override
  // Whose "clear" would silently do nothing.
  const ownStyle =
    style === ownRootStyle
      ? activeStyle
      : resolveContextStyle(ownRootStyle, activeSelector, editMedia);
  // ── The selection, and what it means to commit to it (§6.5) ────────────────
  // Every selected element gets the same write, inside ONE `transactDoc` — so setting padding on
  // Six cards is one decision and one undo step. With one element selected this loop runs once
  // Against `sel` and is indistinguishable from the single-target commit it replaces.
  const targets = tab.session.selection.length > 0 ? tab.session.selection : [sel];
  /**
   * ONE write, applied to every selected element — the only write function this tab has.
   *
   * It takes the caller's transaction rather than opening its own, because a row that writes twice
   * (a shorthand and the longhands it supersedes; a renamed custom property and its old key) must
   * still be one undo step. There is no single-target counterpart: every row that had one wrote to
   * the primary element and silently dropped the rest of the selection on the floor.
   */
  const mutateTargets: StyleMutateFn = (t, prop, val) => {
    for (const target of targets) {
      contextMutate(target, activeSelector, editMedia)(t, prop, val);
    }
  };
  const commitStyle = (prop: string, val?: string | Record<string, unknown> | undefined) =>
    transactDoc(activeTab.value, (t) => mutateTargets(t, prop, val));

  // ── Compute inherited style, and NAME THE DONOR ────────────────────────────
  // Scheme layer: the base styles show through as inherited; breakpoint tabs inherit from lower
  // Breakpoints as before. Either way the donor is known at this point and is now kept: it is the
  // Difference between "some value is showing through" and "Base sets this to 16px, go and look".
  const inheritedInfo: Record<string, InheritedInfo> = {};
  if (schemeLayer) {
    const baseBlock = activeSelector ? (getNestedStyle(style, activeSelector) ?? {}) : style;
    for (const [p, v] of Object.entries(baseBlock)) {
      if (typeof v !== "object") {
        inheritedInfo[p] = {
          value: (v as string | number) ?? "",
          donor: "Base",
          jump: () => updateUi(activeTab.value, "previewColorScheme", "auto"),
        };
      }
    }
  } else {
    for (const [p, source] of Object.entries(
      computeInheritedSources(style, mediaNames, mediaTab, activeSelector),
    )) {
      inheritedInfo[p] = {
        value: source.value,
        donor: source.donor === null ? "Base" : mediaDisplayName(source.donor),
        jump: () => updateUi(activeTab.value, "activeMedia", source.donor),
      };
    }
  }
  const inheritedStyle: Record<string, string | number> = {};
  for (const [p, info] of Object.entries(inheritedInfo)) {
    inheritedStyle[p] = info.value;
  }
  const mixedProps = mixedStyleProps(tab, targets, activeSelector, editMedia);
  const provCtx: ProvenanceCtx = {
    own: ownStyle,
    active: activeStyle,
    inherited: inheritedInfo,
    signals: templateSignals,
    clear: (prop: string) => commitStyle(prop),
    ...(mixedProps.size > 0 ? { mixed: { count: targets.length, props: mixedProps } } : {}),
  };

  // Auto-open sections that have properties. Written back only when it actually moves, so the
  // Effect this runs inside settles after one extra pass rather than chasing its own write.
  const newSections = autoOpenSections({ style: activeStyle }, tab.session.ui.styleSections);
  if (JSON.stringify(newSections) !== JSON.stringify(tab.session.ui.styleSections)) {
    tab.session.ui.styleSections = newSections;
  }

  const filterText = (tab.session.ui.styleFilter || "").toLowerCase();
  const ctx: EditorCtx = {
    activeSelector,
    activeStyle,
    commit: commitStyle,
    coord: `style|${sel.join("/")}|${editMedia ?? ""}|${activeSelector ?? ""}`,
    editMedia,
    filter: filterText,
    inheritedStyle,
    mutate: mutateTargets,
    provCtx,
    tab,
    targets,
    templateSignals,
  };

  const sections = [...propertySections(ctx), ...nestedSection(ctx), ...customSection(ctx)];
  return {
    emptyActionLabel: "",
    emptyMessage: "",
    filter: tab.session.ui.styleFilter || "",
    hasEmptyAction: false,
    sections,
    view: "editor",
  };
}

/** Register a projected row's verbs, and hand back the row. */
function register(entry: { row: StyleRowView; actions: RowActions }): StyleRowView {
  _rows.set(entry.row.key, entry.actions);
  return entry.row;
}

/** The css-meta sections, in their declared order, minus the catch-all. */
function propertySections(ctx: EditorCtx): StyleSectionView[] {
  const { activeStyle, tab } = ctx;
  const isFiltering = ctx.filter.length > 0;
  const sectionProps: Record<string, { prop: string; entry: CssPropertyEntry }[]> = {};
  for (const sec of cssMeta.$sections) {
    sectionProps[sec.key] = [];
  }
  for (const [prop, entry] of Object.entries(cssMeta.$defs) as [string, CssPropertyEntry][]) {
    if (typeof entry.$shorthand === "string") {
      continue;
    }
    sectionProps[(entry.$section as string) || "other"]!.push({ entry, prop });
  }
  for (const sec of cssMeta.$sections) {
    sectionProps[sec.key]!.sort((a, b) => (a.entry.$order as number) - (b.entry.$order as number));
  }

  const out: StyleSectionView[] = [];
  for (const sec of cssMeta.$sections) {
    if (sec.key === "other") {
      continue;
    }
    const entries = sectionProps[sec.key]!;
    const sectionActiveProps = entries.filter(({ prop, entry }) => {
      if (activeStyle[prop] !== undefined) {
        return true;
      }
      return (
        inferInputType(entry) === "shorthand" &&
        (getLonghands(prop) as CssLonghand[]).some((l) => activeStyle[l.name] !== undefined)
      );
    });
    const clearSection = () => {
      transactDoc(activeTab.value, (t) => {
        for (const { prop, entry } of sectionActiveProps) {
          if (activeStyle[prop] !== undefined) {
            ctx.mutate(t, prop);
          }
          if (inferInputType(entry) === "shorthand") {
            for (const l of getLonghands(prop) as CssLonghand[]) {
              ctx.mutate(t, l.name);
            }
          }
        }
      });
    };

    // The heading's own answer to "is anything in here set, inherited or bound" — the question the
    // Retired "Active" toggle answered by hiding everything that was not.
    const counts = countProvenance(sectionProvenance(entries, ctx.provCtx));
    const isOpen = isFiltering ? true : (tab.session.ui.styleSections[sec.key] ?? false);
    const section = sectionShell(sec.key, sec.label, isOpen, counts, {
      canClear: sectionActiveProps.length > 0,
      clearTitle: `Clear all ${sec.label.toLowerCase()} properties`,
      layout: sec.$layout === "grid" ? "grid" : "",
      onClear: clearSection,
    });
    if (isOpen) {
      section.rows = sectionRows(ctx, entries, sec.$layout === "grid");
    }
    if (isFiltering && section.rows.length === 0) {
      continue;
    }
    out.push(section);
  }
  return out;
}

/** One section's rows: every property that is set, or whose `$show` condition passes. */
function sectionRows(
  ctx: EditorCtx,
  entries: { prop: string; entry: CssPropertyEntry }[],
  grid: boolean,
): StyleRowView[] {
  const { activeStyle } = ctx;
  const rows: StyleRowView[] = [];
  for (const { prop, entry } of entries) {
    const val = activeStyle[prop];
    const hasVal = val !== undefined;
    const condMet = allConditionsPass(entry, activeStyle);
    const type = inferInputType(entry);
    if (!hasVal && !condMet) {
      continue;
    }
    if (ctx.filter) {
      const label = propLabel(entry, prop).toLowerCase();
      if (!prop.includes(ctx.filter) && !label.includes(ctx.filter)) {
        continue;
      }
    }
    if (type === "shorthand") {
      const longhands = getLonghands(prop) as CssLonghand[];
      const hasAny = hasVal || longhands.some((l) => activeStyle[l.name] !== undefined);
      if (!hasAny && !condMet) {
        continue;
      }
      for (const built of shorthandRows(ctx, entry, prop)) {
        rows.push(register(built));
      }
      continue;
    }
    const inherited = ctx.inheritedStyle[prop];
    const built = fieldRow(ctx, entry, prop, (val as string) ?? "", {
      onCommit: (newVal) => ctx.commit(prop, newVal || undefined),
      placeholder: !hasVal && inherited !== undefined ? String(inherited) : "",
      provenance: provenanceOf(prop, ctx.provCtx),
      span: grid && entry.$span === 2,
      warning: hasVal && !condMet,
    });
    rows.push(register(built));
  }
  return rows;
}

/** A section with its tally worked out and no rows yet. */
function sectionShell(
  key: string,
  label: string,
  open: boolean,
  counts: ReturnType<typeof countProvenance>,
  opts: { canClear: boolean; clearTitle: string; layout: string; onClear: () => void },
): StyleSectionView {
  const marks: { state: string }[] = [];
  if (counts.inherited > 0) {
    marks.push({ state: "inherited" });
  }
  if (counts.bound > 0) {
    marks.push({ state: "bound" });
  }
  if (counts.mixed > 0) {
    marks.push({ state: "mixed" });
  }
  const canClear = counts.set > 0 && opts.canClear;
  if (canClear) {
    _sectionClears.set(key, opts.onClear);
  }
  return {
    canClear,
    clearTitle: opts.clearTitle,
    hasMarks: marks.length > 0,
    key,
    label,
    layout: opts.layout,
    marks,
    open,
    rows: [],
    tally: provenanceSummaryText(counts),
  };
}

/** Relative Styling — the nested rules declared at this coordinate, and the way to add one. */
function nestedSection(ctx: EditorCtx): StyleSectionView[] {
  const nestedRules: string[] = [];
  for (const [prop, val] of Object.entries(ctx.activeStyle)) {
    if (val !== null && typeof val === "object" && !Array.isArray(val) && !prop.startsWith("@")) {
      nestedRules.push(prop);
    }
  }
  if (nestedRules.length === 0) {
    return [];
  }
  const open = ctx.tab.session.ui.styleSections.nested ?? true;
  const section = sectionShell("nested", "Relative Styling", open, countProvenance([]), {
    canClear: false,
    clearTitle: "",
    layout: "",
    onClear: () => {},
  });
  if (!open) {
    return [section];
  }
  for (const rule of nestedRules) {
    const key = `${ctx.coord}|nested|${rule}`;
    const row = blankRow(key, rule, "nested");
    row.widget = "nested";
    row.name = rule;
    row.openTitle = `Edit ${rule} under this rule`;
    row.removeLabel = `Remove ${rule}`;
    _rows.set(key, {
      chip: () => ctx.commit(rule),
      open: () => {
        const compound = ctx.activeSelector ? `${ctx.activeSelector} ${rule}` : rule;
        selectStylebookTag(compound, undefined, { panCanvas: true });
      },
    });
    section.rows.push(row);
  }
  const addKey = `${ctx.coord}|nested|+add`;
  const addRow = blankRow(addKey, "+add", "nested-add");
  addRow.widget = "nestedadd";
  _rows.set(addKey, {});
  section.rows.push(addRow);
  _nestedAdd = () => {
    void showPromptDialog("Add Nested Selector", {
      confirmLabel: "Add",
      message: "Enter a selector to nest under the current rule.",
      placeholder: "th, :hover, .active",
      validate: (v) => (v.trim() ? "" : "Enter a selector."),
    }).then((name) => {
      if (name) {
        ctx.commit(name, {});
      }
    });
  };
  return [section];
}

/** Custom — every declaration css-meta does not know about, plus the field that adds one. */
function customSection(ctx: EditorCtx): StyleSectionView[] {
  const otherProps: string[] = [];
  for (const prop of Object.keys(ctx.activeStyle)) {
    if (!(cssMeta.$defs as Record<string, unknown>)[prop]) {
      const val = ctx.activeStyle[prop];
      if (val !== null && typeof val === "object") {
        continue;
      }
      otherProps.push(prop);
    }
  }
  const open = ctx.tab.session.ui.styleSections.other ?? otherProps.length > 0;
  const section = sectionShell("other", "Custom", open, countProvenance([]), {
    canClear: false,
    clearTitle: "",
    layout: "",
    onClear: () => {},
  });
  if (!open) {
    return [section];
  }
  const cssInitialMap = getCssInitialMap();
  /** One target's OWN block at this coordinate — what a write that preserves values reads first. */
  const targetStyleOf = (t: Tab, target: JxPath): JxStyle => {
    const targetNode = getNodeAtPath(t.doc.document, target) as JxMutableNode | undefined;
    return resolveContextStyle(targetNode?.style ?? {}, ctx.activeSelector, ctx.editMedia);
  };
  for (const prop of otherProps) {
    const key = `${ctx.coord}|custom|${prop}`;
    const row = blankRow(key, prop, "custom");
    row.widget = "kv";
    row.name = prop;
    row.value = String(ctx.activeStyle[prop]);
    row.placeholder = cssInitialMap.get(prop) ?? "";
    row.removeLabel = `Remove ${prop}`;
    _rows.set(key, {
      chip: () => ctx.commit(prop),
      debounceId: `custom:${key}`,
      edit: (value) => ctx.commit(prop, value),
      rename: (raw) => {
        const newProp = raw.trim();
        if (!newProp || newProp === prop) {
          return;
        }
        // A rename is the one write that cannot be fanned out with a single value: each element
        // Keeps ITS OWN value under the new key. The old code batched half of the rename (the
        // Delete) against the primary and the other half against the primary too, while the value
        // Cell beside it wrote to the whole selection — so renaming a property the selection shared
        // Moved it on one element and left it on the rest.
        transactDoc(activeTab.value, (t) => {
          for (const target of ctx.targets) {
            const current = targetStyleOf(t, target)[prop];
            if (current === undefined) {
              continue;
            }
            const write = contextMutate(target, ctx.activeSelector, ctx.editMedia);
            write(t, prop);
            write(t, newProp, String(current));
          }
        });
      },
    });
    section.rows.push(row);
  }
  const addKey = `${ctx.coord}|custom|+add`;
  const addRow = blankRow(addKey, "+add", "custom-add");
  addRow.widget = "kvadd";
  _rows.set(addKey, {
    add: (raw) => {
      const prop = raw.trim();
      if (!prop) {
        return false;
      }
      ctx.commit(prop, cssInitialMap.get(prop) || "");
      return true;
    },
  });
  section.rows.push(addRow);
  return [section];
}

// ─── The menus ───────────────────────────────────────────────────────────────

/**
 * The popover slot every list on this tab opens in; its region is `overlay.menu:style-value`.
 *
 * ONE slot, because only one of these can be open at a time — a unit list, a keyword list and a
 * Value Source picker are three uses of the same gesture, not three overlays — and a second menu
 * opening in the same slot would otherwise leave the first one's document mounted under it.
 */
const MENU_REGION = "style-value";

/** The list that is open, so opening another closes it first. */
let _menu: MenuHandle | null = null;

/** Close the row list — every choice does this, so the row is readable straight after. */
function closeRowMenu(): void {
  const menu = _menu;
  _menu = null;
  menu?.close();
}

/** Open a list under the control that asked for it. One menu at a time, the kit's. */
function openRowMenu(
  anchor: unknown,
  label: string,
  choices: StyleChoice[],
  run: (value: string) => void,
): void {
  const trigger = anchor instanceof HTMLElement ? anchor : null;
  closeRowMenu();
  if (!trigger || choices.length === 0) {
    return;
  }
  _menu = openMenu({
    label,
    onClosed: (closed) => {
      if (_menu === closed) {
        _menu = null;
      }
    },
    opener: trigger,
    region: MENU_REGION,
    rows: choices.map((choice) => ({
      ...(choice.checked === undefined
        ? {}
        : { checked: (choice.checked ? "true" : "false") as "true" | "false" }),
      destructive: false,
      disabled: false,
      dividerAbove: choice.divider === true,
      id: choice.value,
      title: choice.label,
    })),
    run: (value) => run(value),
  });
}

// ─── The mount ───────────────────────────────────────────────────────────────

/** Everything the document can ask for, resolved through {@link rowActions}. */
const ACTIONS: StylePanelActions = {
  addCustom: (key, field) => {
    const add = rowActions(key)?.add;
    if (!add || !(field instanceof HTMLInputElement)) {
      return;
    }
    if (add(field.value)) {
      field.value = "";
    }
  },
  addNested: () => _nestedAdd?.(),
  chipClick: (key) => rowActions(key)?.chip?.(),
  clearSection: (key) => _sectionClears.get(key)?.(),
  commitText: (key, value) => {
    const actions = rowActions(key);
    if (!actions) {
      return;
    }
    if (actions.debounceId) {
      cancelStyleDebounce(actions.debounceId);
    }
    actions.commit?.(value);
  },
  editText: (key, value) => {
    const actions = rowActions(key);
    if (!actions?.edit) {
      return;
    }
    if (actions.debounceId) {
      debouncedStyleCommit(actions.debounceId, 400, actions.edit)(value);
      return;
    }
    actions.edit(value);
  },
  openNested: (key) => rowActions(key)?.open?.(),
  pickChoice: (key, anchor) => {
    const actions = rowActions(key);
    if (!actions?.choose || !actions.choices) {
      return;
    }
    const { choose } = actions;
    openRowMenu(anchor, "Values", actions.choices, (value) => choose(value));
  },
  pickSource: (key, anchor) => {
    const source = rowActions(key)?.source;
    if (!source) {
      return;
    }
    openRowMenu(
      anchor,
      "Value source",
      source.caps.map((mode) => ({
        checked: mode === source.mode,
        label: `${VALUE_SOURCE_LABELS[mode]} — ${VALUE_SOURCE_HINTS[mode]}`,
        value: mode,
      })),
      (chosen) => {
        const next = chosen as SlotMode;
        if (next === source.mode) {
          return;
        }
        source.onChange(
          switchSlotMode(
            source.fieldKey,
            source.mode,
            next,
            cloneValue(source.value as JsonValue | undefined),
            slotModeSeed(next, { stateDefs: source.stateDefs }),
          ),
        );
      },
    );
  },
  pressButton: (key, value) => {
    const actions = rowActions(key);
    actions?.choose?.(value === currentButtonValue(key) ? "" : value);
  },
  renameCustom: (key, name) => rowActions(key)?.rename?.(name),
  runEmptyAction: () => openPageAction().run(),
  setFilter: (value) => {
    const tab = activeTab.value;
    if (tab) {
      tab.session.ui.styleFilter = value;
    }
  },
  toggleSection: (key, open) => {
    const tab = activeTab.value;
    if (!tab) {
      return;
    }
    tab.session.ui.styleSections = { ...tab.session.ui.styleSections, [key]: open };
  },
  toggleShorthand: (key) => rowActions(key)?.toggle?.(),
};

function currentButtonValue(key: string): string {
  return _buttonValues.get(key) ?? "";
}

/** The standing mount: one per window, because the Inspector draws one Style tab. */
let _standing: { host: HTMLElement; handle: StylePanelSurface; scope: EffectScope } | null = null;

/** What the Style tab cannot read for itself: which mode the canvas beside it is in. */
export interface StyleHostDeps {
  /** `stylebook` edits a tag catalogue entry; anything else edits the element selection. */
  getCanvasMode: () => string;
}

/** The default the tab falls back to when the dock names no mode. */
const EDIT_MODE = () => "edit";

/** The canvas mode the dock last reported — Stylebook edits a tag, Edit edits a selection. */
let _canvasMode: () => string = EDIT_MODE;

/** Remember the button values, so a second press on the selected one clears it. */
function rememberButtons(view: StylePanelView): void {
  _buttonValues = new Map();
  for (const section of view.sections) {
    for (const row of section.rows) {
      if (row.widget === "buttons") {
        _buttonValues.set(row.key, row.buttons.find((b) => b.selected)?.value ?? "");
      }
    }
  }
}

/**
 * Give the Style tab somewhere to draw, or take it away.
 *
 * The document is mounted once and then only ASSIGNED to: its own `effect()` re-projects whenever
 * anything the projection read moves, and the surface writes one property per binding with an equal
 * write skipped. It must NOT be routed through `panels/panel-scheduler.ts` — that scheduler defers
 * a repaint while a field in the dock has focus, because a lit render of the whole panel replaces
 * the node the reader is typing into, and here the deferral would buy nothing and make the canvas
 * lag the keystroke.
 *
 * `null` takes the tab down: the dock unmounted, or a test is starting clean.
 *
 * @param {HTMLElement | null} el The Inspector's Style tab body.
 * @param {StyleHostDeps} [ctx] What the tab cannot read for itself.
 */
export function bindStyleHost(el: HTMLElement | null, ctx?: StyleHostDeps): void {
  closeRowMenu();
  _standing?.scope.stop();
  _standing?.handle.dispose();
  _standing = null;
  _rows = new Map();
  _sectionClears = new Map();
  _nestedAdd = null;
  if (!el) {
    return;
  }
  _canvasMode = ctx?.getCanvasMode ?? EDIT_MODE;
  const first = buildView(_canvasMode);
  rememberButtons(first);
  const handle = mountStylePanelSurface(el, first, ACTIONS, {
    target: (element) => attachTargetLine(element ?? undefined),
  });
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      const view = buildView(_canvasMode);
      rememberButtons(view);
      handle.update(view);
    });
  });
  _standing = { handle, host: el, scope };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * The Style tab's selector verbs.
 *
 * `style.openSelectorMenu` is the one command here that addresses a CONTROL rather than a state,
 * and it earns that on purpose: the shot it serves photographs the open menu, so the menu is the
 * subject. What it does not do is hand a CSS selector back to the runner for a synthetic mouse
 * press — the element comes from the Target Line's own handle, so a refactor of that markup moves
 * the handle with it. The menu it opens is a segment of the Target Line rather than a picker on a
 * retired toolbar; the id, and therefore the shot, is unchanged.
 *
 * `style.setSelector` is the state half of the same idea, and it is what a caller that wants a
 * RESULT rather than a picture should use: the menu exists to choose a selector, and choosing one
 * is expressible.
 *
 * @returns {AnyCommand[]}
 */
export function styleCommands(): AnyCommand[] {
  const styleTabOpen = (ctx: { document: { open: boolean }; selection: { count: number } }) =>
    ctx.document.open && ctx.selection.count > 0;

  return [
    {
      category: "View",
      id: "style.openSelectorMenu",
      level: "selection",
      menus: ["palette"],
      group: "8_style",
      requires: "the Style tab showing a selected element",
      when: styleTabOpen,
      run: () => openSelectorMenu(),
      title: "Open Selector Menu",
    },
    {
      args: {
        additionalProperties: false,
        properties: {
          selector: pathlessSelectorProperty(),
        },
        required: ["selector"],
        type: "object",
      },
      category: "View",
      id: "style.setSelector",
      level: "selection",
      menus: ["palette"],
      group: "8_style",
      requires: "an element selection",
      when: styleTabOpen,
      run: (_commandCtx, args) => {
        const { selector } = args as { selector?: unknown };
        if (selector === null) {
          const tab = activeTab.value;
          if (tab) {
            tab.session.ui.activeSelector = null;
          }
          return;
        }
        const value = stringArg("style.setSelector", args, "selector");
        if (!isNestedSelector(value)) {
          throw new RangeError(
            `command "style.setSelector" argument "selector": "${value}" is not a nested ` +
              `selector — it must start with ":", ".", "&" or "["`,
          );
        }
        const tab = activeTab.value;
        if (!tab) {
          throw new RangeError(`command "style.setSelector" needs an open document`);
        }
        tab.session.ui.activeSelector = value;
      },
      title: "Set Style Selector",
    },
  ];
}

/** The `selector` property's schema: a nested selector, or `null` for the base context. */
function pathlessSelectorProperty(): object {
  return {
    description:
      'A nested selector such as ":hover", ".child" or "[open]". null edits the base context.',
    oneOf: [{ type: "string" }, { type: "null" }],
  };
}

/**
 * Register the Style tab's selector verbs.
 *
 * @param {CommandRegistry} registry
 */
export function registerStyleCommands(registry: CommandRegistry): void {
  registry.registerAll(styleCommands());
}
