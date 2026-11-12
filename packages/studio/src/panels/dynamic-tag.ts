/// <reference lib="dom" />
/**
 * The tag popover's flow (studio.md §6.9): which tag is open, what it says, and what each of its
 * controls writes.
 *
 * **The open tag is the tab's state, and every door writes it the same way.** A chip pressed on the
 * canvas, a Bound pill, a chip in the Inspector and a script all run `canvas.setTagPopover`, which
 * writes `session.ui.tagPopover`; this module watches that and nothing else, so there is no second
 * notion of "open" for the popover and the tab to disagree about. Where the panel is drawn is the
 * one thing a door adds, and it is a hint, not state: a door that knows where it was pressed says
 * so first ({@link openTagPopover}), and one that does not (a script) gets the selected block.
 *
 * **An edit is one write to the document.** Each control rewrites the tag through the tag model
 * (`editor/dynamic-tags.ts`) and stores the property it stands in, in one transaction: one undo
 * step, the formula a format needs included. A control set to what the tag already says writes
 * nothing, which is also why opening and closing a popover never dirties a document.
 *
 * **The values are the canvas's.** The Now line and every format's sample are evaluated by the
 * frame, in the scope the tag is drawn in (`evalTemplate`), so the author picks by looking at what
 * the canvas will draw. They arrive after the panel has opened and fill in when they do.
 *
 * @docs studio/editing/dynamic-tags
 */

import { parseDynamicTag, printDynamicTag } from "@jxsuite/schema/dynamic-tag";
import { inheritableFormulas } from "@jxsuite/runtime/expression";
import { isJsonObject, isRef, isString, templateExpressions } from "@jxsuite/schema/guards";
import { flushCanvasEdits, getEditBarAnchorRect, requestTemplateEval } from "../canvas/iframe-host";
import { FAILED_NOTE, NOT_RUN_NOTE, PENDING_NOTE } from "../canvas/iframe-protocol";
import { runActiveReported } from "../commands/run-reported";
import {
  chipTag,
  formatAccepts,
  formatCall,
  formatFormulas,
  formatPresets,
  parameterFields,
  presetExpression,
  presetOfTag,
  replaceExpression,
  rewrittenValue,
  slotValue,
  sourcePath,
  sourceValue,
  sameSlot,
  boundTagsOf,
  tagAt,
  withFallback,
  withFormat,
  withNegations,
  withParameter,
  withSource,
  fallbackText,
} from "../editor/dynamic-tags";
import { tagTitlesAt } from "../editor/repeater-scope";
import { sourceGroups } from "../editor/tag-sources";
import { effect } from "../reactivity";
import { getNodeAtPath, projectState } from "../state";
import {
  mutateAddDef,
  mutateUpdateAttribute,
  mutateUpdateProp,
  mutateUpdateProperty,
  mutateUpdateStyle,
  transactDoc,
} from "../tabs/transact";
import { getLayerSlot } from "../ui/layers";
import { CUSTOM_TAG_LABEL } from "../utils/edit-display";
import { activeTab } from "../workspace/workspace";
import { emptyDynamicTagView, mountDynamicTag } from "../surfaces/dynamic-tag";
import {
  openTagPopover,
  setTagPopoverReplacer,
  TAG_POPOVER_GAP,
  takeTagPopoverHint,
} from "./tag-popover-door";

import type { DynamicTag } from "@jxsuite/schema/dynamic-tag";
import type { JsonValue, JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
import type { CanvasTagClick } from "../canvas/iframe-host";
import type { TemplateResult } from "../canvas/iframe-protocol";
import type {
  BoundTag,
  FormatFormula,
  FormatPreset,
  TagAddress,
  ValueType,
} from "../editor/dynamic-tags";
import type { ScopeRecord } from "../editor/merge-tags";
import type { DynamicTagSurface, DynamicTagView, TagFormatRow } from "../surfaces/dynamic-tag";
import type { ViewportPoint } from "../surfaces/menu";
import type { Tab } from "../tabs/tab";

/** What the frame last said about the open tag: its value, and each format drawn with it. */
interface TagValues {
  /** The tag these belong to: its address and what it held when they were asked for. */
  key: string;
  now: TemplateResult | null;
  type: ValueType;
  /** The value before any format, as text. */
  plain: string;
  samples: Map<string, TemplateResult>;
}

let _surface: DynamicTagSurface | null = null;
let _returnFocus: HTMLElement | null = null;
let _values: TagValues | null = null;
/** The key of the evaluation now out, so a second ask for the same tag is not made. */
let _asked = "";
/** The tag the panel is showing, as `JSON` of its address: a new one is placed, the same is not. */
let _shown = "";
let _returnToCanvas: (() => void) | null = null;
/** The tab the panel is showing a tag of, so leaving it can close the tag it holds open. */
let _shownTab: Tab | null = null;

/**
 * Which tag the panel was opened on, beyond its address. An address is a place, and a document that
 * shifts under it (a node removed, a chip inserted before it) would hand the panel to whatever now
 * stands there; the node itself, and how many tags its slot holds, are what stay put while the tag
 * is edited, since an edit mutates the node in place.
 */
interface OpenedTag {
  /** The address as `JSON.stringify` writes it. */
  key: string;
  node: object | null;
  count: number;
  /** The tag as it was opened, whose spelling a source picked back is restored to. */
  origin: DynamicTag | null;
}
let _opened: OpenedTag | null = null;

/** A number for each object the frame reported, so a new report is a new key. */
const _stamps = new WeakMap<WeakKey, number>();
let _stampCount = 0;

/** The stamp of `value`: the same for the same object, and 0 for none. */
function stampOf(value: WeakKey | null | undefined): number {
  if (!value) {
    return 0;
  }
  let stamp = _stamps.get(value);
  if (stamp === undefined) {
    _stampCount += 1;
    stamp = _stampCount;
    _stamps.set(value, stamp);
  }
  return stamp;
}

/** How many tags the slot of `address` holds on `node`. */
function slotCount(node: JxMutableNode | null | undefined, address: TagAddress): number {
  return boundTagsOf(node).filter((tag) => sameSlot(tag.slot, address.slot)).length;
}

/** The words of the "Show" field: the value, or one of the two questions `!` asks of it. */
const SHOW_OPTIONS = [
  { label: "The value", value: "0" },
  { label: "Whether it is set", value: "2" },
  { label: "Whether it is empty", value: "1" },
];

/** The words of the fallback's "when" field. */
const FALLBACK_OPTIONS = [
  { label: "No fallback", value: "" },
  { label: "When missing or blank", value: "||" },
  { label: "When missing", value: "??" },
];

/** Results a format must not be offered with: what a formula gives a value it cannot read. */
const UNREADABLE = /NaN|Invalid Date/u;

/** The tab's open tag, resolved against the document, or null when none is open or it is gone. */
function openTag(tab: Tab | null): { address: TagAddress; bound: BoundTag } | null {
  const address = tab?.session.ui.tagPopover;
  if (!tab || !address) {
    return null;
  }
  const titles = tagTitlesAt(tab.doc.document, address.path, projectState?.projectConfig ?? null);
  const node = getNodeAtPath(tab.doc.document, address.path);
  const bound = tagAt(node, address.slot, address.index, titles);
  if (!bound) {
    return null;
  }
  // The address names a tag the panel was opened on: another one standing there is not it.
  if (
    _opened?.key === JSON.stringify([tab.id, address]) &&
    (_opened.node !== node || _opened.count !== slotCount(node, address))
  ) {
    return null;
  }
  return { address, bound };
}

/** The formulas a tag of this tab can be formatted with, the project's own included. */
function formulasOf(tab: Tab): FormatFormula[] {
  const inherited = inheritableFormulas(projectState?.projectConfig?.state);
  return formatFormulas({ ...inherited, ...tab.doc.document.state });
}

/** What identifies one evaluation: the tag's place and what it holds. */
function valuesKey(tab: Tab, address: TagAddress, bound: BoundTag): string {
  /* What the answer depends on besides the tag: the row the canvas is on, the state values it was
     given, and the render the frame last reported (a formula it has just been given, a source that
     has just resolved). */
  return JSON.stringify([
    tab.id,
    address.path,
    address.slot,
    address.index,
    bound.source,
    tab.session.ui.activeRows,
    tab.session.ui.stateValues,
    stampOf(tab.session.canvas.bindings),
    stampOf(tab.session.canvas.scope),
  ]);
}

/** The presets a tag's value can take, once the frame has said what the value is. */
function offeredPresets(tab: Tab, values: TagValues | null): FormatPreset[] {
  if (values === null) {
    return [];
  }
  const formulas = formulasOf(tab).filter((formula) => formatAccepts(formula, values.type));
  return formatPresets(formulas).filter((preset) => {
    const sample = values.samples.get(preset.id);
    return sample !== undefined && sample.error === undefined && !UNREADABLE.test(sample.text);
  });
}

/** The Now line: the binding's own state when it has none to show, else its value. */
function nowOf(
  tab: Tab,
  address: TagAddress,
  bound: BoundTag,
  values: TagValues | null,
): Pick<DynamicTagView, "nowState" | "nowText" | "nowTitle"> {
  const reported = tab.session.canvas.bindings?.bindings.find(
    (binding) =>
      binding.source === bound.source &&
      JSON.stringify(binding.path) === JSON.stringify(address.path),
  );
  if (reported && reported.status !== "resolved") {
    const note =
      reported.status === "pending"
        ? PENDING_NOTE
        : reported.status === "not-run"
          ? NOT_RUN_NOTE
          : FAILED_NOTE;
    const text = reported.error ? `${note}: ${reported.error}` : note;
    return { nowState: reported.status, nowText: text, nowTitle: text };
  }
  const now = values?.now;
  if (now === null || now === undefined) {
    return { nowState: "pending", nowText: values === null ? "…" : "Not drawn", nowTitle: "" };
  }
  if (now.error !== undefined) {
    return { nowState: "failed", nowText: now.error, nowTitle: now.error };
  }
  return now.text === ""
    ? { nowState: "empty", nowText: "Empty", nowTitle: "" }
    : { nowState: "value", nowText: now.text, nowTitle: now.text };
}

/** A format row. */
function formatRow(id: string, label: string, sample: string, selected: string): TagFormatRow {
  return {
    checked: id === selected ? "true" : "false",
    id,
    label,
    name: sample === "" ? label : `${label}: ${sample}`,
    sample: sample === "" ? "—" : sample,
  };
}

/** What the popover says about one tag. */
function projectTag(tab: Tab, address: TagAddress, bound: BoundTag): DynamicTagView {
  const key = valuesKey(tab, address, bound);
  const values = _values?.key === key ? _values : null;
  const base: DynamicTagView = {
    ...emptyDynamicTagView(),
    ...nowOf(tab, address, bound, values),
    advancedLabel: bound.tag === null ? CUSTOM_TAG_LABEL : "Advanced",
    advancedOpen: bound.tag === null,
    expr: bound.expr ?? bound.ref ?? "",
    property: bound.property,
    title: bound.label,
  };
  const { tag } = bound;
  if (tag === null) {
    return base;
  }
  const groups = sourceGroups(
    tab.doc.document,
    address.path,
    projectState?.projectConfig ?? null,
    /* SAFETY: the scope snapshot is the frame's resolved state as JSON, which a scope record is. */
    tab.session.canvas.scope as ScopeRecord | null,
  );
  const presets = offeredPresets(tab, values);
  const selected = presetOfTag(tag, formatPresets(formulasOf(tab)));
  const formats = [formatRow("", "As stored", values?.plain ?? "", selected)];
  for (const preset of presets) {
    formats.push(
      formatRow(preset.id, preset.label, values?.samples.get(preset.id)?.text ?? "", selected),
    );
  }
  // The format the tag is on is always in the list, offered or not: a selection needs a row.
  if (selected !== "" && !formats.some((row) => row.id === selected)) {
    formats.push(
      formatRow(
        selected,
        selected === "custom" ? "Current format" : (formatCall(tag)?.name ?? "Current format"),
        values?.now?.text ?? "",
        selected,
      ),
    );
  }
  return {
    ...base,
    fallback: fallbackText(tag),
    fallbackOptions: FALLBACK_OPTIONS,
    fallbackWhen: tag.fallback?.operator ?? "",
    formats,
    hasFallback: tag.fallback !== undefined,
    params: parameterFields(tag, formulasOf(tab)),
    show: String(tag.negations),
    showOptions: SHOW_OPTIONS,
    source: sourceValue(tag),
    sourceGroups: groups,
    structured: true,
  };
}

/** Ask the frame for the open tag's value and each format's sample, once per tag and content. */
function refreshValues(tab: Tab, address: TagAddress, bound: BoundTag): void {
  const key = valuesKey(tab, address, bound);
  if (_asked === key || bound.expr === null) {
    return;
  }
  _asked = key;
  const { tag } = bound;
  const formulas = formulasOf(tab);
  const presets = tag === null ? [] : formatPresets(formulas);
  const templates = [{ id: "now", template: `\${${bound.expr}}` }];
  if (tag !== null) {
    templates.push({ id: "plain", template: `\${${presetExpression(tag, null)}}` });
    for (const preset of presets) {
      templates.push({
        id: `preset:${preset.id}`,
        template: `\${${presetExpression(tag, preset)}}`,
      });
    }
  }
  const defs: Record<string, NonNullable<FormatFormula["ensure"]>["def"]> = {};
  for (const formula of formulas) {
    if (formula.ensure) {
      defs[formula.ensure.name] = formula.ensure.def;
    }
  }
  void requestTemplateEval(tab.id, { formulas: defs, path: address.path, templates }).then(
    (reply) => {
      if (_asked !== key) {
        return;
      }
      const byId = new Map((reply?.results ?? []).map((result) => [result.id, result]));
      const plain = byId.get("plain");
      _values = {
        key,
        now: byId.get("now") ?? null,
        plain: plain?.text ?? "",
        samples: new Map(
          presets.flatMap((preset) => {
            const sample = byId.get(`preset:${preset.id}`);
            return sample ? [[preset.id, sample] as const] : [];
          }),
        ),
        type: plain?.type ?? "empty",
      };
      renderTagPopover();
    },
  );
}

/** Where the panel goes when no door said: under the selected block, or near the window's top. */
function fallbackPoint(): ViewportPoint & { above?: number } {
  const anchor = getEditBarAnchorRect();
  return anchor
    ? { above: anchor.top, x: anchor.left, y: anchor.top + anchor.height + TAG_POPOVER_GAP }
    : { x: Math.max(16, Math.round(window.innerWidth / 2) - 160), y: 96 };
}

/** The mounted surface, created on first use. */
function ensureSurface(): DynamicTagSurface {
  _surface ??= mountDynamicTag(getLayerSlot("popover", "dynamic-tag"), {
    applyExpression: (text) => commitExpression(text),
    closed: () => {
      void runActiveReported("canvas.setTagPopover", { tag: null }, "Dynamic tag");
    },
    describeDraft: (text) =>
      text.trim() === ""
        ? "An expression is needed."
        : draftProblem(text) !== ""
          ? draftProblem(text)
          : parseDynamicTag(text.trim()) === null
            ? "Kept as a custom expression."
            : "",
    setFallbackText: (text) =>
      editTag((tag) => withFallback(tag, tag.fallback?.operator ?? "||", text)),
    setFallbackWhen: (when) =>
      editTag((tag) => withFallback(tag, when === "??" || when === "||" ? when : null)),
    setFormat: (id) =>
      editTag((tag, tab) => {
        if (id === "custom" || id === presetOfTag(tag, formatPresets(formulasOf(tab)))) {
          return tag;
        }
        const preset = formatPresets(formulasOf(tab)).find((candidate) => candidate.id === id);
        return id === "" ? withFormat(tag, null) : preset ? withFormat(tag, preset) : tag;
      }),
    setParam: (key, value) =>
      editTag((tag, tab) => withParameter(tag, formulasOf(tab), key, value)),
    setShow: (value) =>
      editTag((tag) => withNegations(tag, value === "1" ? 1 : value === "2" ? 2 : 0)),
    setSource: (value) =>
      editTag((tag) => {
        const { origin } = _opened ?? { origin: null };
        // The field the tag began on, picked back, is the tag as it was written.
        const path =
          origin !== null && value === sourceValue(origin)
            ? pathOf(origin)
            : sourcePath(value, pathOf(tag));
        return path === null ? tag : withSource(tag, path);
      }),
  });
  return _surface;
}

/** The path at the heart of a tag's pipe. */
function pathOf(tag: DynamicTag): Extract<DynamicTag["pipe"], { type: "path" }> {
  let { pipe } = tag;
  while (pipe.type === "call") {
    pipe = pipe.input;
  }
  return pipe;
}

/** Store `value` in the property `slot` names on the node at `path`. */
function writeSlot(tab: Tab, address: TagAddress, value: JxDocumentValue | undefined): void {
  const { path, slot } = address;
  const [head, member] = slot;
  /* SAFETY: a rewritten binding is a template string or a `{ "$ref" }`, which is JSON. */
  const json = value as JsonValue;
  if (head === "attributes" && isString(member)) {
    mutateUpdateAttribute(tab, path, member, isString(value) || isRef(value) ? value : undefined);
  } else if (head === "style" && isString(member)) {
    mutateUpdateStyle(tab, path, member, isString(value) || isRef(value) ? value : undefined);
  } else if (head === "$props" && isString(member)) {
    mutateUpdateProp(tab, path, member, json);
  } else if (head === "children" && member !== undefined) {
    const held = getNodeAtPath(tab.doc.document, path)?.children;
    if (Array.isArray(held) && isString(value)) {
      mutateUpdateProperty(tab, path, "children", held.with(Number(member), value));
    }
  } else if (isString(head)) {
    mutateUpdateProperty(tab, path, head, json);
  }
}

/** The formulas `expr` calls that the document must be given first. */
function missingFormulas(tab: Tab, expr: string): NonNullable<FormatFormula["ensure"]>[] {
  const tag = parseDynamicTag(expr);
  const names = new Set<string>();
  for (let pipe = tag?.pipe; pipe?.type === "call"; pipe = pipe.input) {
    names.add(pipe.name);
  }
  return formulasOf(tab).flatMap((formula) =>
    formula.ensure && names.has(formula.name) ? [formula.ensure] : [],
  );
}

/** Why `text` cannot be this tag's expression without touching the text around it, or `""`. */
function draftProblem(text: string): string {
  const tab = activeTab.value;
  const open = openTag(tab);
  if (!tab || !open || open.bound.form !== "template") {
    return "";
  }
  const held = slotValue(getNodeAtPath(tab.doc.document, open.address.path), open.address.slot);
  if (!isString(held)) {
    return "";
  }
  const next = replaceExpression(held, open.address.index, text.trim());
  const parts = templateExpressions(next);
  return parts.length === templateExpressions(held).length &&
    parts[open.address.index]?.expr.trim() === text.trim()
    ? ""
    : "Braces and quotes must balance, or the text around the tag would change.";
}

/**
 * Store `expr` as the open tag's expression: one transaction, so one undo step, with the state
 * entry of a packaged formula it calls copied in beside it. Nothing is written when the tag already
 * says that. What the caret has typed is committed first, so the write lands on the document the
 * author is looking at and the block's own commit does not follow it with the tag as it was.
 */
function commitExpression(expr: string): void {
  const tab = activeTab.value;
  const open = openTag(tab);
  if (!tab || !open || expr.trim() === "") {
    return;
  }
  void flushCanvasEdits(tab.id).then(() => {
    const current = openTag(tab);
    if (!current) {
      return;
    }
    const node = getNodeAtPath(tab.doc.document, current.address.path);
    const held = slotValue(node, current.address.slot);
    const next = rewrittenValue(held, current.bound, expr);
    if (next === held) {
      return;
    }
    if (draftProblem(expr) !== "") {
      return;
    }
    const ensure = missingFormulas(tab, expr);
    transactDoc(tab, (t) => {
      for (const { name, def } of ensure) {
        if (isJsonObject(def)) {
          mutateAddDef(t, name, def);
        }
      }
      writeSlot(t, current.address, next);
    });
  });
}

/** Rewrite the open tag through the tag model and store the result. */
function editTag(change: (tag: DynamicTag, tab: Tab) => DynamicTag): void {
  const tab = activeTab.value;
  const open = openTag(tab);
  if (!tab || !open?.bound.tag) {
    return;
  }
  const next = change(open.bound.tag, tab);
  if (next !== open.bound.tag) {
    commitExpression(printDynamicTag(next));
  }
}

/**
 * A chip was pressed on the canvas. The first press on a block selects it and names its chips; a
 * press on a chip of a block that was the author's already opens that chip, under it.
 */
export function handleTagClick(click: CanvasTagClick): void {
  if (!click.chosen || click.tab.id !== activeTab.value?.id) {
    return;
  }
  const bound = chipTag(getNodeAtPath(click.tab.doc.document, click.path), click);
  if (bound) {
    openTagPopover(
      { index: bound.index, path: click.path, slot: bound.slot },
      {
        at: {
          above: click.rect.top,
          x: click.rect.left,
          y: click.rect.top + click.rect.height + TAG_POPOVER_GAP,
        },
      },
    );
  }
}

/** Bring the panel up to date with the tab's open tag: show it, fill it, or take it down. */
export function renderTagPopover(): void {
  const tab = activeTab.value;
  // Leaving the tab closes the tag it had open: the popover belongs to the canvas it was opened on.
  if (_shownTab && _shownTab !== tab) {
    if (_shownTab.session.ui.tagPopover) {
      _shownTab.session.ui.tagPopover = null;
    }
    _shownTab = null;
  }
  const open = openTag(tab);
  if (!tab || !open) {
    _surface?.close();
    // The panel was showing a tag: the keyboard goes back to where it came from.
    if (_shown !== "") {
      const back = _returnFocus;
      _returnFocus = null;
      if (back?.isConnected) {
        // A kit button is light DOM around its control: the control is what takes focus.
        (back.querySelector<HTMLElement>("button") ?? back).focus();
      } else {
        _returnToCanvas?.();
      }
    }
    _shown = "";
    _asked = "";
    _opened = null;
    _shownTab = null;
    // A tag that is open in the tab's state and gone from the document is not open.
    if (tab?.session.ui.tagPopover) {
      void runActiveReported("canvas.setTagPopover", { tag: null }, "Dynamic tag");
    }
    return;
  }
  const surface = ensureSurface();
  const shown = JSON.stringify([tab.id, open.address]);
  if (shown !== _shown) {
    const node = getNodeAtPath(tab.doc.document, open.address.path);
    _opened = {
      count: slotCount(node, open.address),
      key: shown,
      node: node ?? null,
      origin: open.bound.tag,
    };
    _shownTab = tab;
  }
  surface.update(projectTag(tab, open.address, open.bound));
  if (shown !== _shown) {
    _shown = shown;
    const hint = takeTagPopoverHint();
    _returnFocus = hint?.returnFocus ?? null;
    surface.open(hint?.at ?? fallbackPoint());
  }
  refreshValues(tab, open.address, open.bound);
}

/**
 * Start the flow: watch the focused tab's open tag, and the document under it, and keep the panel
 * saying what they say.
 *
 * @param returnToCanvas Hand the keyboard back to the canvas, for a popover a chip opened.
 */
export function initDynamicTag(returnToCanvas: () => void): () => void {
  _returnToCanvas = returnToCanvas;
  setTagPopoverReplacer(() => {
    _shown = "";
    renderTagPopover();
  });
  const runner = effect(() => {
    const tab = activeTab.value;
    const address = tab?.session.ui.tagPopover;
    if (tab && address) {
      // Read for the dependency: an edit to the tag, or to the state it reads, redraws the panel.
      void slotValue(getNodeAtPath(tab.doc.document, address.path), address.slot);
      void tab.doc.document.state;
      void tab.session.canvas.bindings;
      void tab.session.canvas.scope;
      void tab.session.ui.activeRows;
      void tab.session.ui.stateValues;
    }
    renderTagPopover();
  });
  return () => {
    runner.effect.stop();
    _surface?.close();
    _surface?.dispose();
    _surface = null;
    _values = null;
    _opened = null;
    _shownTab = null;
    setTagPopoverReplacer(null);
    takeTagPopoverHint();
    _returnFocus = null;
    _asked = "";
    _shown = "";
  };
}
