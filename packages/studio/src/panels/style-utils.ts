/** Style utilities — pure CSS helper functions used by the style panel. */

import { isNumber, isString } from "@jxsuite/schema/guards";
import type { JxMutableNode, JxStyle } from "@jxsuite/schema/types";

import { activeTab } from "../workspace/workspace";
import { getEffectiveStyle } from "../site-context";
import cssMeta from "../../data/css-meta.json";

/** One `$show` condition: the row is offered while `prop` holds one of `values`, or any value. */
export interface CssShowCondition {
  prop: string;
  values: string[];
}

/** One Modern Font Stacks preset a `fontFamily` entry offers. */
export interface CssFontPreset {
  title: string;
  value: string;
}

/** Every kind of value a css-meta entry holds under any of its keys. */
type CssMetaValue =
  | string
  | number
  | boolean
  | string[]
  | CssShowCondition[]
  | CssFontPreset[]
  | Record<string, string>;

/**
 * What `css-meta.json` says about one CSS property: which section files it, where in that section,
 * and which control edits it. Every entry in the file carries `$order`; the rest is per property.
 *
 * The index signature is what keeps an entry assignable to the open records `inferInputType()` and
 * `propLabel()` read it through; it admits only the value kinds the file actually holds.
 */
export interface CssMetaEntry {
  $order: number;
  $section?: string;
  $label?: string;
  $input?: string;
  $buttonValues?: string[];
  $icons?: Record<string, string>;
  $keywords?: string[];
  $longhands?: string[];
  /** `true` on a shorthand row; the shorthand's own name on each of its longhands. */
  $shorthand?: string | boolean;
  $shorthandType?: string;
  $show?: CssShowCondition[];
  $span?: number;
  $units?: string[];
  enum?: string[];
  examples?: string[];
  presets?: CssFontPreset[];
  format?: string;
  type?: string;
  minimum?: number;
  maximum?: number;
  [key: string]: CssMetaValue | undefined;
}

/** A shorthand's longhand, with its own css-meta entry. */
export interface CssLonghand {
  name: string;
  entry: CssMetaEntry;
}

/**
 * Css-meta's property table, by property name. The JSON module's inferred type is checked against
 * {@link CssMetaEntry} here, once, so a key the file stops carrying is a type error at this line.
 */
export const cssDefs: Readonly<Record<string, CssMetaEntry>> = cssMeta.$defs;

let cssInitialMap = new Map<string, string>();

/** Initialise cssInitialMap from webdata — call once during bootstrap. */
export function initCssData(webdata: { cssProps: string[][] }) {
  cssInitialMap = new Map<string, string>();
  for (const [name, initial] of webdata.cssProps) {
    if (name !== undefined && initial !== undefined) {
      cssInitialMap.set(name, initial);
    }
  }
}

/** Get the CSS initial-value map (populated by initCssData). */
export function getCssInitialMap() {
  return cssInitialMap;
}

/**
 * A declaration's value rather than a nested block (`:hover`, `@--md`) or a block list.
 *
 * Exactly the `typeof value !== "object"` test the Style tab has always made, so a `null` a JSON
 * document might hold still counts as a block, never as a value.
 */
export function isDeclarationValue(value: JxStyle[string]): value is string | number | undefined {
  return typeof value !== "object";
}

// ─── Condition helpers ──────────────────────────────────────────────────────

/** Whether one `$show` condition holds against the style being edited. */
export function conditionPasses(cond: CssShowCondition, styles: JxStyle) {
  const val = styles[cond.prop] ?? "";
  if (cond.values.length === 0) {
    return val !== "" && val !== "initial";
  }
  return isString(val) && cond.values.includes(val);
}

/** Whether every `$show` condition of an entry holds; an entry with none always passes. */
export function allConditionsPass(entry: Pick<CssMetaEntry, "$show">, styles: JxStyle) {
  return (entry.$show ?? []).every((c) => conditionPasses(c, styles));
}

// ─── Auto-open sections ─────────────────────────────────────────────────────

/**
 * Open every section that has a value in it — and leave alone every section somebody has DECIDED
 * about.
 *
 * The distinction is `undefined` versus `false`, and it is what makes the Style tab's accordion
 * obey a click. It used to test `!result[section]`, which cannot tell "never opened" from "the
 * reader just closed it": with the tab drawn once per interaction that was invisible, because the
 * close and the re-open happened on either side of a render nobody looked between. The tab is a
 * document now and re-projects the moment the section record moves, so closing an auto-opened
 * section re-opened it in the same frame.
 *
 * @param {JxMutableNode} node @param {Record<string, boolean>} currentSections
 */
export function autoOpenSections(node: JxMutableNode, currentSections: Record<string, boolean>) {
  const style = node.style || {};
  const result = { ...currentSections };
  for (const prop of Object.keys(style)) {
    if (!isDeclarationValue(style[prop])) {
      continue;
    }
    const section = cssDefs[prop]?.$section ?? "other";
    if (result[section] === undefined) {
      result[section] = true;
    }
  }
  return result;
}

// ─── Shorthand expand/compress ──────────────────────────────────────────────

/** Get longhands for a shorthand property from css-meta, in their `$order`. */
export function getLonghands(shorthandProp: string): CssLonghand[] {
  const listed = cssDefs[shorthandProp]?.$longhands;
  if (listed) {
    return listed
      .map((name) => ({ entry: cssDefs[name] || { $order: 0 }, name }))
      .toSorted((a, b) => a.entry.$order - b.entry.$order);
  }
  const result: CssLonghand[] = [];
  for (const [name, e] of Object.entries(cssDefs)) {
    if (e.$shorthand === shorthandProp) {
      result.push({ entry: e, name });
    }
  }
  result.sort((a, b) => a.entry.$order - b.entry.$order);
  return result;
}

/**
 * Expand a CSS shorthand value into individual longhand values following the standard 1–4 value
 * TRBL pattern.
 */
export function expandShorthand(shortVal: string, count: number) {
  if (!shortVal) {
    return Array.from({ length: count }, () => "");
  }
  const parts = shortVal.trim().split(/\s+/);
  if (count !== 4 || parts.length === 0) {
    return Array.from({ length: count }, () => "");
  }
  if (parts.length === 1) {
    return [parts[0], parts[0], parts[0], parts[0]];
  }
  if (parts.length === 2) {
    return [parts[0], parts[1], parts[0], parts[1]];
  }
  if (parts.length === 3) {
    return [parts[0], parts[1], parts[2], parts[1]];
  }
  return [parts[0], parts[1], parts[2], parts[3]];
}

/** Compress 4 TRBL values back into the shortest valid CSS shorthand string. */
export function compressShorthand(vals: string[]) {
  const [t, r, b, l] = vals;
  if (t === r && r === b && b === l) {
    return t;
  }
  if (t === b && r === l) {
    return `${t} ${r}`;
  }
  if (r === l) {
    return `${t} ${r} ${b}`;
  }
  return `${t} ${r} ${b} ${l}`;
}

// ─── Border-side shorthand parsing ──────────────────────────────────────────

export const BORDER_STYLES = new Set([
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
  "hidden",
]);

/**
 * Parse a border-side shorthand value into [width, style, color].
 *
 * @param {string} value
 * @returns {string[]}
 */
export function expandBorderSide(value: string) {
  if (!value) {
    return ["", "", ""];
  }
  const tokens = [];
  let current = "";
  let depth = 0;
  for (const ch of value.trim()) {
    if (ch === "(") {
      depth += 1;
    }
    if (ch === ")") {
      depth -= 1;
    }
    if (ch === " " && depth === 0) {
      if (current) {
        tokens.push(current);
      }
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) {
    tokens.push(current);
  }

  let width = "";
  let style = "";
  let color = "";

  for (const tok of tokens) {
    if (!style && BORDER_STYLES.has(tok)) {
      style = tok;
    } else if (!width && /^[\d.]/.test(tok)) {
      width = tok;
    } else {
      color = color ? `${color} ${tok}` : tok;
    }
  }

  return [width, style, color];
}

/**
 * Recompose border-side longhand values into a shorthand string.
 *
 * @param {string[]} vals
 * @returns {string}
 */
export function compressBorderSide(vals: string[]) {
  return vals.filter((v) => v && v.trim()).join(" ");
}

// ─── Font helpers ───────────────────────────────────────────────────────────

/** Extract --font-* CSS custom properties from the document root style. */
export function getFontVars() {
  /* The EFFECTIVE style — the site's `project.json` block under the document's own — for the same
     reason `colorTokens()` reads it: a project's fonts are declared once, in the site, and a list
     that read only the document offered a component none of its project's fonts. The value is what
     the token's OWN declaration says; a token that aliases another (`--font-ui: var(--font-body)`)
     is followed by whoever draws it. Only scalars are taken: an object is a nested rule. */
  const style = getEffectiveStyle(activeTab.value?.doc.document?.style);
  const vars = [];
  for (const [k, v] of Object.entries(style)) {
    if (k.startsWith("--font") && (isString(v) || isNumber(v))) {
      vars.push({ name: k, value: String(v) });
    }
  }
  return vars;
}

/**
 * The typography properties whose keyword rows draw each value AS that value, and the `jx-option`
 * channel each one reaches the row through (ui.md §5.3): a weight row's `700` is set in 700, an
 * italic row's `Italic` leans, a transform row's `Uppercase` is capitalised without changing the
 * word a reader hears. `fontFamily` is not here because its rows are their own preview through
 * `face`, which is the channel every one of these rows ALSO carries, so a weight is shown in the
 * element's own typeface rather than in the panel's.
 */
export const TYPO_PREVIEW_CHANNELS = new Map<string, TypoPreviewChannel>([
  ["fontStyle", "slant"],
  ["fontVariant", "variant"],
  ["fontWeight", "weight"],
  ["textDecoration", "decoration"],
  ["textTransform", "transform"],
]);

/** A `jx-option` drawing channel a typography row previews its value through (ui.md §5.3). */
export type TypoPreviewChannel = "decoration" | "slant" | "transform" | "variant" | "weight";

export { default as cssMeta } from "../../data/css-meta.json";
