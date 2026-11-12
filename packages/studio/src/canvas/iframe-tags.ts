/// <reference lib="dom" />
/**
 * Dynamic tags in the canvas frame: the three things only the frame can do for a tag (studio.md
 * §6.9).
 *
 * - **Say which chip was pressed.** A chip is no node of the document and carries no path, so the
 *   frame reports the block that holds it, what the chip stands for, and which of the block's chips
 *   of that source it is. The host finds the tag in the document from that and never reads the
 *   frame.
 * - **Evaluate a template where it is drawn.** The tag popover shows what a tag resolves to, and
 *   draws each format with the real value. The scope a tag reads is here: the page's, or inside a
 *   repeater the active row's own. A formula the document does not hold yet is defined for the one
 *   evaluation, so a format can be looked at before it is chosen.
 * - **Put a chip at the caret.** Insert adds a tag, not characters: the chip is in the block the
 *   moment it is inserted, and the block's next commit writes the expression it carries.
 *
 * @docs studio/editing/dynamic-tags
 */

import { evaluateTemplateValue } from "@jxsuite/runtime";
import { evaluateExpression } from "@jxsuite/runtime/expression";
import {
  isBoolean,
  isNamedFormulaDef,
  isNonNullObject,
  isNumber,
  isString,
} from "@jxsuite/schema/guards";
import {
  describeTag,
  TAG_ATTR,
  TAG_KIND_ATTR,
  TAG_LABEL_ATTR,
  TAG_REF_ATTR,
} from "../utils/edit-display";
import { rectOf } from "../utils/geometry";
import { caretBeside, chipsIn } from "./iframe-chips";
import { instancesOf, nearestStampedEl, ROWS_MORE_ATTR, TEMPLATE_ROW_ATTR } from "./iframe-rows";
import { rowsOf } from "./path-mapping";

import type { JxScope, JxScopeValue } from "@jxsuite/runtime/types";
import type { JxStateDefinition } from "@jxsuite/schema/types";
import type { TagTitles } from "../utils/edit-display";
import type { JxPath } from "../state";
import type { IframeToParent, RowCount, TemplateResult } from "./iframe-protocol";

/** The attribute the editing host writes on the block that holds the caret. */
const ACTIVE_BLOCK_ATTR = "data-jx-active-block";

/** The outermost chip that is `target` or holds it, or null when the press was on no chip. */
export function chipAt(target: EventTarget | null): Element | null {
  let chip: Element | null = null;
  // A press lands on an element, a caret stands in a text node: either is asked about its chip.
  const from =
    target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  for (let el = from; el; el = el.parentElement) {
    if (el.hasAttribute(TAG_ATTR)) {
      chip = el;
    }
  }
  return chip;
}

/**
 * Whether the block that holds the chip under `target` is already the author's: it holds the caret.
 * Read at `pointerdown`, before the press moves the caret there, because that is the only moment
 * the answer is about the block as it was.
 */
export function chipBlockActive(target: EventTarget | null): boolean {
  return chipAt(target)?.closest(`[${ACTIVE_BLOCK_ATTR}]`) != null;
}

/** What a `tagClick` says, without its `kind`. */
export type TagClick = Omit<Extract<IframeToParent, { kind: "tagClick" }>, "kind">;

/**
 * What a click on `target` says about the chip it landed on (studio.md §6.9), or null when it
 * landed on none, or on one in a block that is not addressable (an echo row before it is made the
 * active one, a layout's own chrome).
 */
export function tagClickAt(target: EventTarget | null, active: boolean): TagClick | null {
  const chip = chipAt(target);
  const block = chip ? nearestStampedEl(chip) : null;
  const source = chip?.getAttribute(TAG_ATTR);
  const serialized = block?.dataset.jxPath;
  if (!chip || !block || !isString(source) || serialized === undefined) {
    return null;
  }
  const ref = chip.getAttribute(TAG_REF_ATTR);
  /* Counted among the block's own chips: one in an inline child that is a node of its own is that
     child's, and has that child for its block. */
  const peers = chipsIn(block).filter(
    (other) =>
      nearestStampedEl(other) === block &&
      other.getAttribute(TAG_ATTR) === source &&
      other.getAttribute(TAG_REF_ATTR) === ref,
  );
  const box = rectOf(chip);
  return {
    active,
    occurrence: Math.max(0, peers.indexOf(chip)),
    // SAFETY: only the stamper writes `data-jx-path`, as JSON of a document path.
    path: JSON.parse(serialized) as JxPath,
    rect: { height: box.height, width: box.width, x: box.x, y: box.y },
    ref,
    source,
  };
}

// ─── Evaluating ──────────────────────────────────────────────────────────────

/** How long a value may run as text before it is cut: a popover line, not a document. */
const TEXT_CAP = 240;

/** What a value is, for choosing a format. */
function typeOf(value: JxScopeValue): TemplateResult["type"] {
  if (value === null || value === undefined || value === "") {
    return "empty";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (isString(value)) {
    return "string";
  }
  if (isNumber(value)) {
    return "number";
  }
  return isBoolean(value) ? "boolean" : "object";
}

/** A value as the text a chip holding it would draw. */
function textOf(value: JxScopeValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.length === 1 ? "1 item" : `${value.length} items`;
  }
  let text: string;
  if (isNonNullObject(value)) {
    try {
      /* SAFETY: `JSON.stringify` answers undefined for a function, which lib.d.ts leaves out. */
      text = (JSON.stringify(value) as string | undefined) ?? "";
    } catch {
      text = "";
    }
  } else {
    text = String(value);
  }
  return text.length > TEXT_CAP ? `${text.slice(0, TEXT_CAP)}…` : text;
}

/** What a thrown value says: its `message` when it has one, the value itself otherwise. */
function failureText(cause: unknown): string {
  const message = isNonNullObject(cause) && "message" in cause ? cause.message : undefined;
  return String(message ?? cause);
}

/**
 * `scope`, with each named formula of `formulas` the scope has none of defined over it. The scope
 * itself is not written: the formulas are own members of an object that reads everything else
 * through, so the evaluation sees them and the canvas does not.
 */
export function withFormulas(
  scope: JxScope,
  formulas: Readonly<Record<string, JxStateDefinition>> | undefined,
): JxScope {
  const entries = Object.entries(formulas ?? {}).filter(
    ([name, def]) => !(name in scope) && isNamedFormulaDef(def),
  );
  if (entries.length === 0) {
    return scope;
  }
  /* SAFETY: `Object.create(scope)` is an empty object whose prototype is the scope, so it is a
     scope that reads every key through and owns only the formulas set below. */
  const local = Object.create(scope) as JxScope;
  for (const [name, def] of entries) {
    if (!isNamedFormulaDef(def)) {
      continue;
    }
    const { parameters } = def;
    const formula = (...values: JxScopeValue[]): JxScopeValue => {
      const args: JxScope = {};
      for (const [index, parameter] of parameters.entries()) {
        const key = isString(parameter) ? parameter : parameter.name;
        const fallback = isString(parameter) ? undefined : parameter.default;
        args[key] = values[index] === undefined ? fallback : values[index];
      }
      return evaluateExpression(def.$expression, local, null, { args });
    };
    /* Defined, not assigned: the scope under `local` is the runtime's reactive proxy, and an
       assignment through a prototype chain is offered to the proxy first. */
    Object.defineProperty(local, name, { configurable: true, enumerable: true, value: formula });
  }
  return local;
}

/**
 * Evaluate each template against `scope` as the runtime would (`evaluateTemplateValue`), one result
 * per template in order. A template that throws is a result with its error, so one bad format does
 * not cost the others their value.
 */
export function evaluateTemplates(
  templates: readonly { id: string; template: string }[],
  scope: JxScope,
  formulas?: Readonly<Record<string, JxStateDefinition>>,
): TemplateResult[] {
  const local = withFormulas(scope, formulas);
  return templates.map(({ id, template }) => {
    try {
      const value = evaluateTemplateValue(template, local);
      return { id, text: textOf(value), type: typeOf(value) };
    } catch (error) {
      return { error: failureText(error), id, text: "", type: "empty" };
    }
  });
}

/**
 * How many rows of the repeater at `repeater` are drawn, among the rows of the outer row the active
 * one stands in (studio.md §4.5). Null when the frame draws none of it.
 */
export function rowCountOf(container: ParentNode, repeater: JxPath): RowCount | null {
  const roots = instancesOf(container, [...repeater, "map"]);
  const active = roots.find((root) => root.dataset.jxPath !== undefined);
  if (!active) {
    return null;
  }
  const coords = rowsOf(active);
  const outer = JSON.stringify(coords.slice(0, -1));
  const rows = roots.filter((root) => JSON.stringify(rowsOf(root).slice(0, -1)) === outer);
  if (active.hasAttribute(TEMPLATE_ROW_ATTR)) {
    return { active: 0, drawn: 0, total: 0 };
  }
  const drawn = rows.length;
  // The last row of a list the cap cut short says "24 of 512 rows".
  const more = rows.map((row) => row.getAttribute(ROWS_MORE_ATTR)).find((text) => text !== null);
  const total = Number(/of (\d+)/u.exec(more ?? "")?.[1] ?? drawn);
  return { active: coords.at(-1) ?? 0, drawn, total: Math.max(total, drawn) };
}

// ─── Inserting ───────────────────────────────────────────────────────────────

/**
 * Put a chip for `token` at the caret inside `root` (studio.md §6.9), and the caret after it.
 *
 * The chip is the element the canvas draws a binding as, carrying the expression verbatim, so the
 * block's next commit writes `${token}` where the chip stands and the render that follows draws its
 * value. It is empty until then, and an empty chip draws its name. A selection is not typed over:
 * the chip goes at its end, since replacing a range that holds another chip is a deletion the
 * author did not ask for. With no caret in `root` the chip goes at its end.
 *
 * @returns The chip, so the caller can report the input that follows.
 */
export function insertChip(root: HTMLElement, token: string, titles: TagTitles | null): Element {
  const doc = root.ownerDocument;
  const { kind, label } = describeTag(token, titles);
  const chip = doc.createElement("data");
  chip.setAttribute(TAG_ATTR, `\${${token}}`);
  chip.setAttribute(TAG_LABEL_ATTR, label);
  chip.setAttribute(TAG_KIND_ATTR, kind);
  chip.setAttribute("contenteditable", "false");

  const selection = doc.getSelection();
  const held = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const range = doc.createRange();
  if (held && root.contains(held.endContainer) && chipAt(held.endContainer) === null) {
    range.setStart(held.endContainer, held.endOffset);
  } else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  range.collapse(true);
  range.insertNode(chip);
  // Splitting a text node at its end leaves an empty one behind the chip: nothing is there.
  const trailing = chip.nextSibling;
  if (trailing && trailing.nodeType === trailing.TEXT_NODE && (trailing.nodeValue ?? "") === "") {
    trailing.remove();
  }
  // A lone `<br>` is what an empty block holds its line open with; beside a chip it is a second line.
  const filler = chip.nextSibling ?? chip.previousSibling;
  if (
    filler &&
    filler.nodeName === "BR" &&
    root.childNodes.length === 2 &&
    filler.parentNode === root
  ) {
    filler.remove();
  }
  const after = caretBeside(chip, 1);
  selection?.collapse(after.node, after.offset);
  return chip;
}
