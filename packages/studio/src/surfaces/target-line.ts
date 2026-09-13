/// <reference lib="dom" />
/**
 * The Target Line — the Style tab's compound edit target, as one sentence (plan §6.1).
 *
 * ```text
 * ⌖  h1 · @md · :hover · dark variant                    [ all <h1> in this document ]
 * ```
 *
 * `style-panel.ts` has always computed this tuple exactly: it is the per-field key
 * (`style|${sel}|${editMedia}|${activeSelector}|${prop}`) and the five-branch if/else that picks
 * the commit function. What it did with it was hide it behind three disconnected widgets on two
 * different bars — a `<sp-tabs>` breakpoint strip, a `.selector-select` picker, and a
 * `.style-scheme-badge` whose class had **no CSS rule anywhere in the repo**, so the one control
 * that admitted the tab bar was overriding the panel rendered as unstyled inline text.
 *
 * Three rules shape what this module is allowed to be:
 *
 * 1. **Every segment is a control.** A sentence you cannot act on is a caption, and the panel already
 *    had one of those.
 * 2. **The Style tab does not own the breakpoint or the scheme.** Those axes are SELECTED on the pane
 *    context bar (region ⑦) and DEFINED in Project Settings › Contexts — §2 principle 5. The
 *    breakpoint and scheme segments therefore state the resolved value and route to the definition
 *    site; they do not offer a third list to pick from. The selector segment is the one axis this
 *    tab owns, so it is the one segment with a menu.
 * 3. **The scope chip is what makes Stylebook safe.** Entering Stylebook silently discards the element
 *    selection and converts every subsequent edit from "this element" to "every element of this
 *    tag" — with one line of text, after the fact, as the only signal. The chip states the blast
 *    radius BEFORE the first keystroke, and the project case is a warning band with an affected
 *    count and a "show affected" list.
 *
 * The count comes from `services/references.ts` where that query can answer, and says **"unknown"**
 * where it cannot. A confirmation may be silent; it may never be confidently wrong.
 *
 * **The line is a document now** (`target-line.json`, studio-ui-guidelines.md §6, §9.3). The Style
 * panel renders an EMPTY host for it and hands this module the model; the document owns the markup,
 * the ARIA and every value in the style, and this module owns the decisions — what each word says,
 * what pressing one does, and what the selector menu offers. That menu is the KIT's
 * (`surfaces/menu.ts`), because a list of choices is what that surface already is (§12.5), which is
 * also how the roving caret, typeahead and Escape arrive here without a line of keyboard code.
 *
 * @docs studio/design/states-and-selectors
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { openMenu } from "./menu";
import targetLineDoc from "./target-line.json";
import type { JxDocument } from "@jxsuite/schema/types";
import type { MenuHandle, MenuRowProjection } from "./menu";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("target-line", targetLineDoc as unknown as JxDocument);

/** The region the line stamps on itself, so a shot can crop it. */
const REGION = "inspector/target";

/** The popover slot the selector menu opens in; its region is `overlay.menu:style-selector`. */
const MENU_REGION = "style-selector";

// ─── The model ───────────────────────────────────────────────────────────────

/** One clickable word of the sentence. */
export interface TargetSegment {
  /** `element` | `media` | `scheme` — the axis, used as the segment's `data-seg`. */
  key: string;
  label: string;
  title: string;
  /** What clicking it opens. A segment with no action is not rendered as a button. */
  onActivate?: (() => void) | undefined;
}

/** The selector axis — the one the Style tab owns, so the one with a menu. */
export interface TargetSelector {
  /** The active nested selector, or `null` for the element's own base rule. */
  value: string | null;
  /** Every selector offerable right now: the common set ∪ what the element declares. */
  options: string[];
  /** Which options the element already declares — marked in the menu. */
  declared: Set<string>;
  onSelect: (selector: string | null) => void;
  /** Opens the Add Nested Selector dialog (`showPromptDialog`, ui-guidelines §8.7). */
  onAddCustom: () => void;
}

/** How wide the blast radius is, and what the app can say about it. */
export interface TargetScope {
  kind: "element" | "document" | "project";
  /** "this element" / "all `<h1>` in this document" / "all `<h1>` in this project". */
  label: string;
  /** The affected-count sentence — "312 elements in 24 files", or "unknown". */
  affected?: string | undefined;
  /** The files the count came from, for the "show affected" disclosure. */
  affectedFiles?: readonly { path: string; count: number }[] | undefined;
  showAffected?: boolean | undefined;
  onToggleAffected?: (() => void) | undefined;
}

export interface TargetLineModel {
  segments: TargetSegment[];
  selector: TargetSelector;
  scope: TargetScope;
}

/** The label the selector segment wears when no nested selector is active. */
export const BASE_SELECTOR_LABEL = "base rule";

// ─── The projection ──────────────────────────────────────────────────────────

/** One word of the sentence, as the document reads it. */
interface ProjectedSegment extends Record<string, unknown> {
  key: string;
  label: string;
  title: string;
  /** `button` when the word has somewhere to go, `readout` when it only states a value. */
  control: "button" | "readout";
  /** The first word draws no separator before it. */
  leading: boolean;
}

/** The scope `target-line.json` reads. */
interface TargetLineScope extends Record<string, unknown> {
  region: string;
  segments: ProjectedSegment[];
  selectorLabel: string;
  scopeKind: string;
  scopeLabel: string;
  scopeTitle: string;
  warn: boolean;
  warningText: string;
  hasToggle: boolean;
  toggleLabel: string;
  showAffected: boolean;
  /** `hidden` draws nothing, `list` the files, `empty` the sentence explaining there are none. */
  affectedState: "hidden" | "list" | "empty";
  affectedFiles: { path: string; count: number }[];
  activate: (key: string) => void;
  openSelector: () => void;
  toggleAffected: () => void;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _scope: TargetLineScope | null = null;
let _model: TargetLineModel | null = null;
let _host: HTMLElement | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _menu: MenuHandle | null = null;

/**
 * Forget the mount — the Inspector unmounted, or a test is starting clean.
 *
 * A module-local handle rather than a `querySelector` at call time: the line is rebuilt whenever
 * the Style tab's host element is, so anything that resolved the trigger once would hold a detached
 * node. What {@link openSelectorMenu} looks up inside that handle is the button, and it looks it up
 * at the moment of the press, which is the imperative USE the guideline allows.
 */
export function resetTargetLine(): void {
  closeSelectorMenu();
  const pending = _mount;
  _mount = null;
  _host = null;
  _model = null;
  _scope = null;
  if (pending) {
    void pending.then((handle) => {
      handle.dispose();
    });
  }
}

/** Close the selector menu — every choice does this, so the sentence is readable straight after. */
function closeSelectorMenu(): void {
  const menu = _menu;
  _menu = null;
  menu?.close();
}

/** The document's scope, made once. */
function scope(): TargetLineScope {
  _scope ??= reactive<TargetLineScope>({
    activate: (key: string) => {
      _model?.segments.find((segment) => segment.key === key)?.onActivate?.();
    },
    affectedFiles: [],
    affectedState: "hidden",
    hasToggle: false,
    openSelector: () => {
      openSelectorMenu();
    },
    region: REGION,
    scopeKind: "element",
    scopeLabel: "",
    scopeTitle: "",
    segments: [],
    selectorLabel: BASE_SELECTOR_LABEL,
    showAffected: false,
    toggleAffected: () => {
      _model?.scope.onToggleAffected?.();
    },
    toggleLabel: "Show affected",
    warn: false,
    warningText: "",
  }) as TargetLineScope;
  return _scope;
}

/**
 * Give the line somewhere to draw, or take it away.
 *
 * This is the `ref()` the Style panel puts beside an empty `<div>`: lit calls it with the element
 * when the node is created and with `undefined` when the part is torn down, which is exactly the
 * hand-over a mounted document needs — a document CLEARS its host, so it can never share one with a
 * template.
 *
 * @param {Element | undefined} host
 */
export function attachTargetLine(host: Element | undefined): void {
  const el = host instanceof HTMLElement ? host : null;
  if (el === _host) {
    return;
  }
  closeSelectorMenu();
  const stale = _mount;
  _host = el;
  _mount = el ? mountSurface("target-line", scope(), el) : null;
  if (stale) {
    void stale.then((handle) => {
      handle.dispose();
    });
  }
}

/**
 * State what the line says. Assignment only — a repaint never rebuilds the mount, so the reader's
 * pointer does not lose the word it is aiming at.
 *
 * @param {TargetLineModel} model
 */
export function setTargetLine(model: TargetLineModel): void {
  _model = model;
  const state = scope();
  const files = [...(model.scope.affectedFiles ?? [])];
  const show = model.scope.showAffected === true;
  state.segments = model.segments.map((segment, index) => ({
    control: segment.onActivate ? "button" : "readout",
    key: segment.key,
    label: segment.label,
    leading: index === 0,
    title: segment.title,
  }));
  state.selectorLabel = model.selector.value ?? BASE_SELECTOR_LABEL;
  state.scopeKind = model.scope.kind;
  state.scopeLabel = model.scope.label;
  state.scopeTitle =
    model.scope.kind === "element"
      ? "These edits apply to the selected element only"
      : `These edits apply to ${model.scope.label}`;
  state.warn = model.scope.kind === "project";
  state.warningText = `Every edit here restyles ${model.scope.label} — ${
    model.scope.affected ?? "unknown"
  }.`;
  state.hasToggle = Boolean(model.scope.onToggleAffected);
  state.toggleLabel = show ? "Hide affected" : "Show affected";
  state.showAffected = show;
  state.affectedFiles = files;
  state.affectedState = show ? (files.length > 0 ? "list" : "empty") : "hidden";
}

// ─── The selector menu ───────────────────────────────────────────────────────

/** The values the two standing rows carry; neither is a selector, so neither can collide. */
const BASE_SELECTOR_VALUE = "__base__";
const ADD_SELECTOR_VALUE = "__add_custom__";

/**
 * Open the selector menu.
 *
 * The one command in this file, and it addresses a CONTROL rather than a state — which is why it
 * refuses out loud instead of doing nothing: a manifest that hands a CSS selector to a synthetic
 * mouse would silently photograph the wrong panel (§13).
 *
 * @throws {RangeError} When the Style tab is not rendered.
 */
export function openSelectorMenu(): void {
  const trigger = _host?.querySelector<HTMLElement>('[data-seg="selector"]') ?? null;
  if (!trigger?.isConnected) {
    throw new RangeError(
      `command "style.openSelectorMenu" needs the Inspector's Style tab rendered; its selector ` +
        `menu is not in the document`,
    );
  }
  const selector = _model?.selector;
  if (!selector) {
    return;
  }
  closeSelectorMenu();
  const choose = (value: string | null): void => {
    closeSelectorMenu();
    selector.onSelect(value);
  };
  const rows: MenuRowProjection[] = [
    {
      destructive: false,
      disabled: false,
      dividerAbove: false,
      id: BASE_SELECTOR_VALUE,
      run: () => {
        choose(null);
      },
      title: BASE_SELECTOR_LABEL,
    },
    ...selector.options.map((option, index) => ({
      /* What the ● in the old menu said: this element already DECLARES this rule. Where you are is
         stated once, by the trigger's own label — a row that carried both facts would be two
         answers on one line. */
      checked: (selector.declared.has(option) ? "true" : "false") as "true" | "false",
      destructive: false,
      disabled: false,
      dividerAbove: index === 0,
      id: option,
      run: () => {
        choose(option);
      },
      title: option,
    })),
    {
      destructive: false,
      disabled: false,
      dividerAbove: true,
      id: ADD_SELECTOR_VALUE,
      run: () => {
        closeSelectorMenu();
        selector.onAddCustom();
      },
      title: "+ Add custom…",
    },
  ];
  _menu = openMenu({
    label: "Edit target",
    onClosed: (closed) => {
      if (_menu === closed) {
        _menu = null;
      }
    },
    opener: trigger,
    region: MENU_REGION,
    rows,
  });
}
