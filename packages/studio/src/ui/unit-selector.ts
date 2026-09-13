/**
 * The CSS length grammar the Style tab parses a typed value with.
 *
 * This module used to draw the control as well — an `sp-textfield` beside an `sp-picker-button` and
 * an `sp-overlay` of units — and that control is now the Style tab's own composite over the kit
 * (`surfaces/style-panel.json`'s `group` widget: a field the reader may type anything into, beside
 * a button that opens the KIT MENU of units and keywords). What could not move into the document is
 * this: deciding whether `12px`, `auto` and `10px 20px` are a number with a unit, a keyword, or a
 * value that only partially parses. That is a decision, so it stays in TypeScript, and it stays in
 * ONE place because the panel reads it three times over — for the number the field shows, for the
 * placeholder an inherited value contributes, and for the unit a menu choice re-attaches.
 */

/**
 * A number and, optionally, one of the units the panel offers.
 *
 * Anchored at both ends on purpose: a value that is a length AND something else — `10px 20px`, a
 * `calc()`, a `${}` template — must NOT match, because matching would let the unit menu rewrite a
 * value it does not understand. Those fall through to the partial-parse path instead, which shows
 * the leading number and leaves the value alone.
 */
export const UNIT_RE = /^(-?[\d.]+)(px|rem|em|%|vw|vh|svw|svh|dvh|ms|s|fr|ch|ex|deg)?$/;
