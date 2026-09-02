/**
 * The CSS-authoring rules that are not the DOM.
 *
 * `@jxsuite/runtime` renders a document in a browser, and every consumer of its root export pays
 * for that: the element registry, the reactive scope, `@vue/reactivity`. These exports need none of
 * it. They are pure string and regex math over what a `style` block MEANS — how a property name is
 * spelled in CSS, which media query an `@`-key resolves to, and which selector pair a
 * scheme-conditional rule dual-emits as.
 *
 * The rule builder joined them for the same reason: it is what a style object MEANS as a list of
 * CSS rules, and three emitters used to answer that question three different ways. Its only import
 * is `@jxsuite/schema/guards`, which imports nothing but types.
 *
 * They are a subpath of their own because of who else needs them. `@jxsuite/site/site-style` turns
 * `project.json`'s `style` into a stylesheet, and it runs in places the DOM runtime cannot go — a
 * static build, and a Cloudflare Worker serving a live preview. Importing the root export for
 * `camelToKebab` would put the whole renderer plus `@vue/reactivity` inside a Worker script for
 * four pure functions.
 *
 * `./runtime` re-exports all of these, so nothing that already imported them from the root export
 * has to change. This is a narrow door beside the wide one, not a replacement for it.
 */

import { isRef, isTemplateString } from "@jxsuite/schema/guards";
import type { JxRef, JxStyle } from "@jxsuite/schema/types";

/**
 * Convert camelCase to kebab-case.
 *
 * @param {string} s
 * @returns {string}
 */
export function camelToKebab(s: string) {
  return s.replaceAll(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

// ─── Style At-Rules ───────────────────────────────────────────────────────────

/**
 * The four CSS media types. A media _type_ is bare — `@media print` — while a media _feature_ is
 * parenthesised, so `@media (print)` reads as a boolean feature named `print`, which does not exist
 * and evaluates false.
 */
const MEDIA_TYPES = new Set(["all", "print", "screen", "speech"]);

/**
 * The media query an `@`-prefixed style key names, or null when the key is some other at-rule
 * (`@supports`, `@starting-style`) that is emitted verbatim.
 *
 * `@--name` resolves through the project's `$media` map. `@(…)` carries its own parentheses, so
 * they are stripped only when what they wrap is a bare media type: `@(print)` must become `@media
 * print`, while `@(min-width: 40rem)` keeps them.
 *
 * @param {string} atKey
 * @param {Record<string, string>} mediaQueries
 * @returns {string | null}
 * @docs framework/concepts/styling
 */
export function resolveAtQuery(atKey: string, mediaQueries: Record<string, string>): string | null {
  if (atKey.startsWith("@--")) {
    return mediaQueries[atKey.slice(1)] ?? atKey.slice(1);
  }
  if (atKey.startsWith("@(")) {
    const inner = atKey.slice(2, -1).trim();
    return MEDIA_TYPES.has(inner.toLowerCase()) ? inner : atKey.slice(1);
  }
  return null;
}

/**
 * At-rules whose body is a list of DECLARATIONS rather than a list of rules.
 *
 * Every other `@`-key in a `style` object wraps selectors — `@media`, `@supports`,
 * `@starting-style` — so both emitters assume a selector child and write `@key { <selector> { … }
 * }`. These four have no selector: `@position-try --flip { inset-block-start: auto }` IS the body,
 * and wrapping it in one produces a block the parser discards without a word.
 *
 * That is why an anchored dropdown had no custom fallback to declare. `position-try-fallbacks` can
 * name `flip-block` and friends without this, but a bespoke fallback position — the thing you need
 * when the built-in flips do not fit — could not be expressed at all.
 *
 * The name is part of the key (`@position-try --flip`), so this is a PREFIX match. `@keyframes` is
 * deliberately absent, and stays absent: its body is neither declarations nor selectors but
 * keyframe stops, which is a third shape with its own predicate ({@link isKeyframesAtRule}) and its
 * own serializer. Adding it here would be the tempting one-line fix and it deletes the animation
 * without a word — every child of a keyframes block is a block, `declarationsOf` skips blocks, and
 * a rule with no declarations is never emitted.
 *
 * @param {string} atKey - An `@`-prefixed style key
 * @returns {boolean} True when the block is emitted verbatim, with no selector inside
 * @docs framework/concepts/styling
 */
export function isDeclarationAtRule(atKey: string): boolean {
  return (
    atKey.startsWith("@position-try") ||
    atKey.startsWith("@property") ||
    atKey.startsWith("@font-face") ||
    atKey.startsWith("@counter-style")
  );
}

/**
 * The at-rule whose body is a list of KEYFRAME BLOCKS: `@keyframes <name>`.
 *
 * The third body shape, and the only one. Its children are keyframe selectors — `from`, `to`,
 * `50%`, `"0%, 100%"` — which name a point in an animation's timeline and not an element. Scoping
 * one produces `@keyframes toast-in { .x from { … } }`, which a browser parses without complaint
 * into a keyframes rule holding NO keyframes: the `animation` declaration still names a live
 * animation, and that animation animates nothing. That is how the Studio toast lost its entry
 * animation the day it became a Jx document.
 *
 * The name is part of the key, so this is a PREFIX match like {@link isDeclarationAtRule}.
 *
 * @param {string} atKey - An `@`-prefixed style key
 * @returns {boolean}
 * @docs framework/concepts/styling
 */
export function isKeyframesAtRule(atKey: string): boolean {
  return atKey.startsWith("@keyframes");
}

/**
 * Resolve one nested style key against its parent selector.
 *
 * `&` splices, `:`/`.`/`[` concatenate, anything else is a descendant. Extracted because the same
 * four-branch decision was written THREE times in `applyStyle` — the top-level nested loop,
 * `emitNested`'s recursion and `emitMediaNested` — and three copies of one decision is three
 * chances for a selector to mean different things depending on how deeply it was nested.
 *
 * @param {string} scope - The parent selector
 * @param {string} key - The nested key, e.g. `":hover"`, `"& > li"`, `".child"`
 * @returns {string} The resolved selector
 */
export function resolveNestedSelector(scope: string, key: string): string {
  const resolved: string[] = [];
  for (const scopePart of splitSelectorList(scope)) {
    for (const keyPart of splitSelectorList(key)) {
      resolved.push(resolveOneNestedSelector(scopePart, keyPart));
    }
  }
  return resolved.join(", ");
}

/** One member of a scope against one member of a key — the four-branch decision itself. */
function resolveOneNestedSelector(scope: string, key: string): string {
  if (key.startsWith("&")) {
    return key.replaceAll("&", scope);
  }
  if (key.startsWith("[") || key.startsWith(":") || key.startsWith(".")) {
    return `${scope}${key}`;
  }
  return `${scope} ${key}`;
}

/**
 * Split a selector list on its top-level commas.
 *
 * A comma inside `:is()`, `:where()`, `:not()`, an attribute value or a quoted string separates
 * nothing, so depth and quotes are tracked. Members are trimmed and an empty member is dropped; a
 * selector with no top-level comma comes back as itself, so callers never special-case the single
 * form.
 *
 * Why this exists: a nested key was spliced onto its scope as ONE string, so `"& .a, & .b"` with a
 * `":hover"` inside it emitted `#x .a, #x .b:hover` — the first member got the hover rule with no
 * hover — and the second `&` of the key was never replaced at all. CSS Nesting distributes a nested
 * selector over every member of the parent list (its implicit `:is()`); the flattener now does the
 * same, member by member.
 *
 * @param {string} selector - A selector or a selector list
 * @returns {string[]} The members, in order
 */
export function splitSelectorList(selector: string): string[] {
  const members: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i]!;
    if (quote) {
      if (ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "(" || ch === "[") {
      depth += 1;
    } else if (ch === ")" || ch === "]") {
      depth = Math.max(0, depth - 1);
    } else if (ch === "," && depth === 0) {
      members.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  members.push(selector.slice(start));
  const trimmed = members.map((member) => member.trim()).filter((member) => member !== "");
  return trimmed.length > 0 ? trimmed : [selector];
}

/**
 * Studio-canvas popover selector transposition — the style half of `setCanvasDelinkPopovers`.
 *
 * The canvas renames `popover` to `data-jx-popover` so an open panel leaves the TOP LAYER and
 * becomes an ordinary positioned element the editor can measure, select and grow the artboard for.
 * The moment it does, `:popover-open` matches nothing — so an authored open state would simply not
 * apply, and the author would be styling a rule they could never see.
 *
 * `[data-jx-popover-open]` is the stand-in, and the substitution is exact in the way that matters:
 * a pseudo-class and an attribute selector are both specificity (0,1,0), so a `:popover-open` block
 * still wins and loses against the same neighbours it does on the shipped page.
 *
 * `null` means "do not emit this rule at all", and `::backdrop` is the one thing it is returned
 * for. There is no backdrop pseudo-element outside the top layer; synthesising one would paint a
 * full-canvas scrim over the document being edited, and emitting an inert rule would mark the
 * selector as "styled" in the Style panel while doing nothing. Preview renders it natively.
 *
 * @param {string} selector - A fully resolved selector, canvas-side
 * @returns {string | null} The selector to emit, or null to emit nothing
 * @docs framework/concepts/overlays
 */
export function transposeCanvasPopoverSelector(selector: string): string | null {
  return transposeCanvasOverlaySelector(selector);
}

/** What {@link transposeCanvasOverlaySelector} needs to know about the element that owns a rule. */
export interface CanvasOverlayTransposeOptions {
  /**
   * The rule was authored on a `<dialog>`. It answers `[open]` only for a compound that names no
   * element type at all (`&[open]`, `#d[open]`, `.panel[open]`) — a compound that names one is
   * decided by that type instead, so a `<div>`'s `& dialog[open]` is transposed and a `<dialog>`'s
   * `& details[open]` is not.
   */
  dialog?: boolean;
}

/** A character that ends the compound selector to the left of it. */
const COMPOUND_BREAK = /[\s>+~,()]/;

/** The leading type selector of a compound, if it has one. */
const LEADING_TYPE = /^[A-Za-z_\u{00A0}-\u{FFFF}][\w\u{00A0}-\u{FFFF}-]*/u;

/**
 * Rewrite each `[open]` according to the compound it belongs to, not the element the style object
 * hangs off. A compound naming `dialog` is the dialog's own open state and is transposed; one
 * naming any other type (`details`, a custom element) is left alone; one naming no type — or naming
 * the scope handle, which IS the styled element — inherits `options.dialog`.
 */
function transposeOpenAttribute(selector: string, options: CanvasOverlayTransposeOptions): string {
  let out = "";
  let from = 0;
  for (;;) {
    const at = selector.indexOf("[open]", from);
    if (at === -1) {
      return out + selector.slice(from);
    }
    let start = at;
    while (start > 0 && !COMPOUND_BREAK.test(selector[start - 1] as string)) {
      start -= 1;
    }
    const type = LEADING_TYPE.exec(selector.slice(start, at))?.[0]?.toLowerCase();
    const dialog = type === undefined ? options.dialog === true : type === "dialog";
    out += selector.slice(from, at) + (dialog ? "[data-jx-dialog-open]" : "[open]");
    from = at + "[open]".length;
  }
}

/**
 * Studio-canvas overlay selector transposition, for dialogs as well as popovers — the style half of
 * `setCanvasDelinkPopovers` and `setCanvasDelinkCommands` together.
 *
 * A dialog the canvas shows in place is not `:modal` and, its `open` renamed with the rest of the
 * invoker machinery, not `[open]` either; `[data-jx-dialog-open]` is the stand-in for both, at the
 * same (0,1,0) specificity. `::backdrop` is dropped for the reason given above: neither kind of
 * overlay has one outside the top layer.
 *
 * `[inert]` travels with `commandfor` and a dialog's `open`, and for the same reason: the canvas
 * renames the attribute on every stamped node so the editor can select into an inert region, so a
 * rule the author wrote against `[inert]` would match on the built page and silently not on the
 * canvas. `[data-jx-inert]` is the same (0,1,0) specificity, so it wins and loses against the same
 * neighbours. Unlike `[open]` it needs no option: `inert` is renamed whatever the tag is, where
 * `<details open>` keeps its attribute and so its `[open]` must keep matching.
 *
 * **`[open]` follows the compound it is written on, not the element the style object hangs off.** A
 * compound naming `dialog` is transposed whatever owns the rule, so a wrapper's `& dialog[open]`
 * keeps matching; a compound naming any other type is left alone, so a dialog's `& details[open]`
 * is not corrupted into a selector that can never match. Only a compound with no type of its own —
 * `&[open]`, `#d[open]`, or the runtime's own scope handle — falls back to `options.dialog`. The
 * handle needs no special case: it is not a parseable type name, so the scan finds none and the
 * fallback is what answers for it, which is the right answer because the handle IS the styled
 * element.
 *
 * Three shapes are out of reach of that scan and take the fallback: `:is(dialog)[open]`, a quoted
 * attribute value carrying selector punctuation, and any functional pseudo between the type and the
 * attribute — `dialog:not(.x)[open]` reads as no type, because a parenthesis breaks the backscan.
 *
 * **The rename is per NODE and the selector is not**, so one limitation survives whatever this
 * does. `open` is renamed only on a node the canvas stamped, and a rule may address both stamped
 * and unstamped dialogs at once: a stamped wrapper styling `& dialog[open]` whose dialog comes from
 * a component's own template now emits an attribute that dialog does not carry. Before this, the
 * same rule failed the other way round, on the stamped dialog. Whichever way it is decided one of
 * the two is wrong, so it is decided for the addressable one and stated here rather than papered
 * over.
 *
 * @param {string} selector - A fully resolved selector, canvas-side
 * @param {CanvasOverlayTransposeOptions} [options]
 * @returns {string | null} The selector to emit, or null to emit nothing
 * @docs framework/concepts/overlays
 */
export function transposeCanvasOverlaySelector(
  selector: string,
  options: CanvasOverlayTransposeOptions = {},
): string | null {
  if (selector.includes("::backdrop")) {
    return null;
  }
  const transposed = selector
    .replaceAll(":popover-open", "[data-jx-popover-open]")
    .replaceAll(":modal", "[data-jx-dialog-open]")
    .replaceAll("[inert]", "[data-jx-inert]");
  return transposeOpenAttribute(transposed, options);
}

// ─── Color Schemes ────────────────────────────────────────────────────────────

/**
 * Attribute on the root element (`<html>`) that forces a color scheme. Absent = auto (follow the OS
 * `prefers-color-scheme`). Values: "light" | "dark".
 *
 * @docs framework/concepts/color-schemes
 */
export const COLOR_SCHEME_ATTR = "data-color-scheme";

/**
 * The localStorage key a site switcher persists the visitor's forced scheme under; read by the
 * compiler-injected pre-paint script. Values: "light" | "dark" (absent = auto).
 *
 * @docs framework/concepts/color-schemes
 */
export const COLOR_SCHEME_STORAGE_KEY = "jx-color-scheme";

/**
 * The scheme a _pure_ `prefers-color-scheme` media query targets. Compound queries (any other
 * conditions attached) return null — they are not eligible for forced-scheme dual emission.
 *
 * @param {string} query
 * @returns {"light" | "dark" | null}
 * @docs framework/concepts/color-schemes
 */
export function pureSchemeOf(query: string): "light" | "dark" | null {
  const m = /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/.exec(query.trim());
  return (m?.[1] as "light" | "dark") ?? null;
}

/**
 * Selector pair for a scheme-conditional rule: `auto` applies inside the scheme's media query only
 * while no scheme is forced; `forced` applies unconditionally when the root attribute forces the
 * scheme. Guards are wrapped in `:where()` so specificity matches the unguarded selector and source
 * order decides the cascade.
 *
 * @param {string} selector
 * @param {"light" | "dark"} scheme
 * @returns {{ auto: string; forced: string }}
 * @docs framework/concepts/color-schemes
 */
export function schemeSelectors(
  selector: string,
  scheme: "light" | "dark",
): { auto: string; forced: string } {
  if (selector === ":root" || selector === "html") {
    return {
      auto: `${selector}:where(:not([${COLOR_SCHEME_ATTR}]))`,
      forced: `${selector}:where([${COLOR_SCHEME_ATTR}="${scheme}"])`,
    };
  }
  return {
    auto: `:where(:root:not([${COLOR_SCHEME_ATTR}])) ${selector}`,
    forced: `:where(:root[${COLOR_SCHEME_ATTR}="${scheme}"]) ${selector}`,
  };
}

// ─── The Rule Builder ─────────────────────────────────────────────────────────

/**
 * Where a rule points, relative to the element the style object was authored on.
 *
 * The runtime needs this to decide what it is allowed to SHARE. A `self` rule can be interned and
 * pointed at by any number of elements, because everything it says applies to whichever element
 * carries the scope handle. A `descendant` rule cannot be shared the moment it reads a custom
 * property, because `var()` resolves from the nearest ancestor that set it and a shared handle has
 * more than one such ancestor. `unscoped` is a declaration-body at-rule — `@font-face`,
 * `@position-try` — or a `@keyframes` block, whose name is document-global and which is therefore
 * hoisted once rather than emitted per element.
 */
export type CssRuleTarget = "self" | "descendant" | "unscoped";

/** One keyframe stop: its keyframe selector, verbatim as authored, and what it declares. */
export interface CssKeyframeBlock {
  /** `from`, `to`, `50%`, `"0%, 100%"` — a point on the timeline, never an element selector. */
  selector: string;
  /** Kebab-cased property/value pairs, in authored order. */
  declarations: readonly (readonly [string, string])[];
}

/** One emitted CSS rule: its parts, its text, and a content hash of the two. */
export interface CssRule {
  /** The rule as one `insertRule` argument, or one line of a `<style>` element. */
  text: string;
  /** At-rule wrappers, outermost first. Empty for a top-level rule. */
  conditions: readonly string[];
  /**
   * The resolved selector, or null for a rule that has none: a declaration-body at-rule, or a
   * `@keyframes` block (whose stops are in {@link CssRule.blocks} instead).
   */
  selector: string | null;
  /** Kebab-cased property/value pairs, in authored order. Empty for a `@keyframes` block. */
  declarations: readonly (readonly [string, string])[];
  /**
   * The stops of a `@keyframes` block, in authored order. Absent for every other rule.
   *
   * `declarations` cannot describe N stops each with its own list, so it stays empty here and this
   * carries the body. Nothing in the repository reads either field — `text`, `key` and `target` are
   * the whole cross-consumer contract — but a rule that plainly has declarations must not report
   * none without saying where they went.
   */
  blocks?: readonly CssKeyframeBlock[];
  /** See {@link CssRuleTarget}. */
  target: CssRuleTarget;
  /** FNV-1a base36 hash of `text` — the dedup key. */
  key: string;
}

/** Hooks that let one builder serve the DOM runtime, the compiler, the site builder and Studio. */
export interface CssBuildOptions {
  /**
   * The selector the style object hangs off. Every nested key resolves against it, so the runtime
   * passes a placeholder it substitutes afterwards and the compiler passes `#id` / `.jx-N` / a
   * tag.
   */
  scope?: string | null;
  /** The project's `$media` map, for resolving `@--name` keys. */
  mediaQueries?: Record<string, string>;
  /** Applied to every declaration value. The canvas passes `canvasStyleValue`; hosts pass identity. */
  transposeValue?: (value: string) => string;
  /**
   * Applied to every resolved selector. Returning null drops the rule entirely, which is how the
   * canvas refuses to synthesise a `::backdrop` outside the top layer.
   */
  transposeSelector?: (selector: string) => string | null;
  /**
   * Resolve a value the builder cannot serialize on its own: a `${…}` template or a `{ $ref }`.
   *
   * The runtime returns `var(--jx-rN)` and writes the real value into that custom property from an
   * effect, so the declaration lives in a rule where `:hover` can override it while the reactive
   * part stays inline. Hosts with no scope to evaluate against omit the hook, and the declaration
   * is dropped — which is what the compiler already did for template strings, and what the runtime
   * should always have done with a `$ref` it was instead reading as a nested selector.
   */
  resolveValue?: (property: string, value: string | JxRef) => string | null;
}

/** A style-object key that names a nested selector rather than a CSS property. */
export function isNestedSelectorKey(key: string): boolean {
  return key.startsWith(":") || key.startsWith(".") || key.startsWith("&") || key.startsWith("[");
}

/**
 * A style-object key as a CSS property name.
 *
 * Custom properties pass through untouched. They are case-SENSITIVE — `--fooBar` and `--foo-bar`
 * are two different properties — so kebab-casing one renames it, and the `var(--fooBar)` that reads
 * it finds nothing.
 *
 * @param {string} property
 * @returns {string}
 */
export function cssPropertyName(property: string): string {
  return property.startsWith("--") ? property : camelToKebab(property);
}

/**
 * FNV-1a (32-bit), base36. Not a cryptographic hash and does not need to be: it is a dedup key and
 * an SSR-stable replacement for `Math.random()`, and a collision costs two elements sharing a rule
 * set that says the same thing.
 *
 * @param {string} text
 * @returns {string}
 */
export function hashCss(text: string): string {
  /* oxlint-disable no-bitwise, unicorn/prefer-code-point -- FNV-1a IS bitwise arithmetic over
     16-bit code UNITS; `codePointAt` would consume a surrogate pair as one unit and change the
     hash of any string containing an astral character, for no benefit to a non-cryptographic
     content key. The final `>>> 0` is what keeps the result unsigned, and so base36-clean. */
  let h = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return (h >>> 0).toString(36);
  /* oxlint-enable no-bitwise, unicorn/prefer-code-point */
}

/**
 * Serialize one rule: declarations, wrapped in a selector unless there is none, wrapped in its
 * at-rule conditions from the inside out.
 *
 * @param {readonly string[]} conditions
 * @param {string | null} selector
 * @param {readonly (readonly [string, string])[]} declarations
 * @returns {string}
 */
export function cssRuleText(
  conditions: readonly string[],
  selector: string | null,
  declarations: readonly (readonly [string, string])[],
): string {
  const body = declarations.map(([property, value]) => `${property}: ${value}`).join("; ");
  let text = selector === null ? body : `${selector} { ${body} }`;
  for (let i = conditions.length - 1; i >= 0; i -= 1) {
    text = `${conditions[i]} { ${text} }`;
  }
  return text;
}

/**
 * Serialize one `@keyframes` block: every stop, in authored order, inside ONE at-rule, wrapped in
 * its enclosing conditions.
 *
 * One rule, not one per stop, and that is a correctness requirement rather than tidiness. CSS
 * Animations 1: where two `@keyframes` rules share a name, the last in document order wins and the
 * earlier ones are ignored ENTIRELY. So a block split into `@keyframes fade { from { … } }` plus
 * `@keyframes fade { to { … } }` is valid CSS that animates only its last stop, which is the shape
 * the site-style and compiler paths emitted before this existed.
 *
 * @param {readonly string[]} conditions
 * @param {string} name - The animation name, as authored
 * @param {readonly CssKeyframeBlock[]} blocks
 * @returns {string}
 */
function cssKeyframesText(
  conditions: readonly string[],
  name: string,
  blocks: readonly CssKeyframeBlock[],
): string {
  const body = blocks
    .map(
      ({ selector, declarations }) =>
        `${selector} { ${declarations.map(([property, value]) => `${property}: ${value}`).join("; ")} }`,
    )
    .join(" ");
  let text = `@keyframes ${name} { ${body} }`;
  for (let i = conditions.length - 1; i >= 0; i -= 1) {
    text = `${conditions[i]} { ${text} }`;
  }
  return text;
}

/**
 * A block with its `@keyframes` children removed, for the forced-scheme twin of a dual emission.
 *
 * A scheme-pure query emits twice, once media-guarded and once under the root attribute, because a
 * SELECTOR can be re-pointed at the forced state. A `@keyframes` name cannot: it is document-global
 * and has no selector, so a second copy would be a second definition of one name, and the
 * unconditional copy would silently replace the media-guarded one for every visitor. The
 * media-guarded copy is the one that keeps the author's condition, so it is the one that survives.
 */
function withoutKeyframes(block: JxStyle): JxStyle {
  const keyframeKeys = Object.keys(block).filter((key) => isKeyframesAtRule(key));
  if (keyframeKeys.length === 0) {
    return block;
  }
  const rest: JxStyle = { ...block };
  for (const key of keyframeKeys) {
    delete rest[key];
  }
  return rest;
}

/**
 * Whether a nested key COMPOUNDS onto its scope rather than descending from it.
 *
 * `:hover`, `.wide`, `[open]` and their `&`-spliced spellings still match the element the style was
 * authored on; `> li` and `span` match something inside it. That distinction is the whole of
 * {@link CssRuleTarget}, so it is decided once, here.
 */
function compoundsOntoScope(key: string): boolean {
  const rest = key.startsWith("&") ? key.slice(1) : key;
  return rest === "" || rest.startsWith(":") || rest.startsWith(".") || rest.startsWith("[");
}

/**
 * Turn one authored `style` object into a flat list of CSS rules.
 *
 * This is the single answer to "what does a Jx style object MEAN as CSS", shared by the DOM
 * runtime, the compiler's static emitter and the site-style builder. Before it, three emitters each
 * walked the shape with their own recursion and each dropped a different combination: the runtime
 * lost `selector → @media`, the compiler lost `@media → selector → pseudo`, and neither composed
 * at-rules at all.
 *
 * The recursion carries `{ selector, conditions }` rather than special-casing depth, so nesting and
 * at-rules compose to any depth in either order by construction. A scheme-pure media query
 * dual-emits through {@link schemeSelectors} — a media-guarded copy for the OS preference and an
 * unconditional copy for the forced root attribute — and the forced copy keeps recursing, so an
 * `@--md` block inside a `@(prefers-color-scheme: dark)` block survives both branches.
 *
 * Nesting is FLATTENED, never handed to the browser as native CSS nesting: `&` is resolved here and
 * no `&` reaches the output. That is deliberate — Jx compounds `.child` onto its scope where CSS
 * Nesting would make it a descendant — and it is also what keeps the output parseable by the test
 * DOM, which has no native nesting.
 *
 * @param {JxStyle} style - The authored style object
 * @param {CssBuildOptions} [options]
 * @returns {CssRule[]} Rules in cascade order: a scope's own declarations before its nested blocks
 * @docs framework/concepts/styling
 */
export function buildStyleRules(style: JxStyle, options: CssBuildOptions = {}): CssRule[] {
  const {
    scope = null,
    mediaQueries = {},
    transposeValue = (value: string) => value,
    transposeSelector = (selector: string) => selector,
    resolveValue,
  } = options;
  const rules: CssRule[] = [];

  const isBlock = (value: unknown): value is JxStyle =>
    value !== null && typeof value === "object" && !Array.isArray(value) && !isRef(value);

  const declarationValue = (property: string, value: unknown, reactive: boolean): string | null => {
    if (value === undefined || value === null) {
      return null;
    }
    /* Defect: a `{ $ref }` is a VALUE. Read as an object it looked like a nested selector, and the
       runtime emitted `[data-jx="…"] color { $ref: #/state/tint }` — a rule for an element named
       `color`, and a declaration whose property is `$ref`. */
    if (isRef(value)) {
      return reactive ? (resolveValue?.(property, value) ?? null) : null;
    }
    if (typeof value === "object") {
      return null;
    }
    const raw = String(value);
    if (isTemplateString(raw)) {
      return reactive ? (resolveValue?.(property, raw) ?? null) : null;
    }
    return transposeValue(raw);
  };

  /**
   * `reactive: false` drops a `${…}` or `{ $ref }` instead of resolving it, and only a `@keyframes`
   * stop passes it. The resolver's answer is `var(--jx-rN-M)`, a custom property the runtime writes
   * INLINE on the one element that declared the style — but a keyframes block is hoisted once for
   * the whole document, so the variable would be read where it was never set. Worse, the hoist is
   * refcounted by rule TEXT: two elements naming one animation would produce two different texts,
   * hence two definitions of one name, and the later would erase the earlier.
   */
  const declarationsOf = (
    node: JxStyle,
    skipSelectorKeys: boolean,
    reactive = true,
  ): [string, string][] => {
    const declarations: [string, string][] = [];
    for (const [key, value] of Object.entries(node)) {
      if (isBlock(value)) {
        continue;
      }
      // A scalar under a selector or at-rule key is an invalid shape, not a declaration.
      if (skipSelectorKeys && (key.startsWith("@") || isNestedSelectorKey(key))) {
        continue;
      }
      const resolved = declarationValue(key, value, reactive);
      if (resolved !== null) {
        declarations.push([cssPropertyName(key), resolved]);
      }
    }
    return declarations;
  };

  const emit = (
    conditions: readonly string[],
    selector: string | null,
    declarations: readonly (readonly [string, string])[],
    target: CssRuleTarget,
  ) => {
    if (declarations.length === 0) {
      return;
    }
    let resolved = selector;
    if (resolved !== null) {
      const transposed = transposeSelector(resolved);
      if (transposed === null) {
        return;
      }
      resolved = transposed;
    }
    const text = cssRuleText(conditions, resolved, declarations);
    rules.push({
      text,
      conditions: [...conditions],
      selector: resolved,
      declarations,
      target,
      key: hashCss(text),
    });
  };

  /**
   * Emit a whole `@keyframes` block as ONE unscoped rule.
   *
   * The enclosing `selector` is not a parameter, which is the fix stated as a signature: a keyframe
   * selector is a point on a timeline, so there is nothing for a scope to compound onto or descend
   * from. Its key is therefore taken VERBATIM — no `resolveNestedSelector`, no selector-list split
   * (`"0%, 100%"` is one valid keyframe selector already), and no `transposeSelector`, whose canvas
   * implementation may return null and would delete a stop out of an otherwise sound animation.
   * `transposeValue` still runs on every declaration, so a `translateY(10vh)` stop keeps the
   * canvas's viewport-to-container rewrite.
   *
   * It pushes onto `rules` rather than going through `emit`, which serializes a declaration list
   * and refuses an empty one.
   */
  const emitKeyframes = (atKey: string, block: JxStyle, conditions: readonly string[]) => {
    const name = atKey.slice("@keyframes".length).trim();
    if (name === "") {
      return;
    }
    const blocks: CssKeyframeBlock[] = [];
    for (const [key, value] of Object.entries(block)) {
      if (!isBlock(value)) {
        continue;
      }
      /* A stop holds declarations and nothing else. A nested selector or at-rule inside one is not
         valid CSS, and `declarationsOf` drops both shapes rather than emitting a block a parser
         would throw the whole animation away over. */
      const declarations = declarationsOf(value, true, false);
      if (declarations.length > 0) {
        blocks.push({ declarations, selector: key.trim() });
      }
    }
    if (blocks.length === 0) {
      return;
    }
    const text = cssKeyframesText(conditions, name, blocks);
    rules.push({
      blocks,
      conditions: [...conditions],
      declarations: [],
      key: hashCss(text),
      selector: null,
      target: "unscoped",
      text,
    });
  };

  const walkAt = (
    atKey: string,
    block: JxStyle,
    selector: string | null,
    conditions: readonly string[],
    target: CssRuleTarget,
  ) => {
    /* Not a query. `@--` is the canvas's base-width block — the value a breakpoint panel renders
       at when no named breakpoint applies — and resolving it would emit `@media --`. */
    if (atKey === "@--") {
      return;
    }
    if (isDeclarationAtRule(atKey)) {
      emit([...conditions, atKey], null, declarationsOf(block, false), "unscoped");
      return;
    }
    if (isKeyframesAtRule(atKey)) {
      emitKeyframes(atKey, block, conditions);
      return;
    }
    const query = resolveAtQuery(atKey, mediaQueries);
    const atRule = query === null ? atKey : `@media ${query}`;
    const scheme = query === null ? null : pureSchemeOf(query);
    if (scheme !== null && selector !== null) {
      const { auto, forced } = schemeSelectors(selector, scheme);
      walk(block, auto, [...conditions, atRule], target);
      walk(withoutKeyframes(block), forced, conditions, target);
      return;
    }
    walk(block, selector, [...conditions, atRule], target);
  };

  function walk(
    node: JxStyle,
    selector: string | null,
    conditions: readonly string[],
    target: CssRuleTarget,
  ) {
    emit(conditions, selector, declarationsOf(node, true), target);
    for (const [key, value] of Object.entries(node)) {
      if (!isBlock(value)) {
        continue;
      }
      if (key.startsWith("@")) {
        walkAt(key, value, selector, conditions, target);
      } else if (selector !== null) {
        walk(
          value,
          resolveNestedSelector(selector, key),
          conditions,
          compoundsOntoScope(key) ? target : "descendant",
        );
      }
    }
  }

  walk(style, scope, [], "self");
  return rules;
}
