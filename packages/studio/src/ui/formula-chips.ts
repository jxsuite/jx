/**
 * Formula chips — the MODEL behind the chip pipeline (spec.md §19.9): an expression tree read as a
 * row of chips, left to right. The `target` chain unrolls deepest-first, so the head chip is the
 * innermost target operand (a ref or a literal) and each operator follows it out to the root;
 * nested non-target operands (`value`, `initial`, a `switch` case, a positional arg) become
 * parenthesized group chips beside the link they belong to.
 *
 * **This module draws nothing, and that is the conversion.** It used to be four lit templates over
 * an inline `style=` string, which is one drawing — and the strip has two surfaces now: the Logic
 * dock is a Jx document (`surfaces/logic-workspace.json`) and the expression editor is still a lit
 * template over Spectrum. A shared control cannot be both (studio-ui-guidelines.md §1), so what is
 * shared is the ANSWER — {@link formulaChipStrip} — and each surface draws it in its own element
 * set. The lit drawing lives beside its one remaining caller in `ui/expression-editor.ts` and dies
 * with that conversion; nothing here has to be touched when it does.
 *
 * The preview is taken structurally (`{ values }`) rather than as `services/preview-eval.ts`'s
 * `ExpressionPreview`, because a chip only ever reads that one field of it.
 */

import { isJsonObject, isRef, isString } from "@jxsuite/schema/guards";
import type { JxDocumentValue } from "@jxsuite/schema/types";

type NodePath = (string | number)[];

/**
 * A value of an expression tree: anything a document holds, or a node an editor rebuilt from one.
 *
 * The rebuilt half is why this is not just `JxDocumentValue`. Replacing one operand spreads the
 * node it sits in, and a member the source node lacked can come through as `undefined` (a blank
 * node's `target`); it serializes away, and until then `"target" in node` still sees the key.
 */
export type ExpressionValue = JxDocumentValue | ExpressionFields | ExpressionValue[];

/** An expression node's members by name — `operator`, `target`, `value`, `cases`, … */
export interface ExpressionFields {
  [key: string]: ExpressionValue | undefined;
}

/** What a chip needs to know about the live evaluation: display strings keyed by node path. */
export interface ChipPreview {
  values: Map<string, string>;
}

interface ChainLink {
  node: ExpressionFields;
  path: NodePath;
}

interface Chain {
  /** The innermost target operand (ref/literal), absent for target-less roots. */
  head: { value: ExpressionValue | undefined; path: NodePath } | null;
  /** Operator nodes, deepest target first → outermost operator last. */
  links: ChainLink[];
}

/**
 * One chip of the pipeline, already decided.
 *
 * `key` is the joined path and the chip's identity — a keyed `$map`'s key in the document, the
 * `data-path` a lit chip carries, and what a click reports back. It is unique within a strip by
 * construction: two chips of one expression cannot occupy one position in it.
 */
export interface FormulaChip {
  key: string;
  /** The node this chip addresses, for a caller that resolves a selection against the tree. */
  path: NodePath;
  /** What the chip reads, and its own tooltip: an operand's label or an operator's spelling. */
  label: string;
  /** The live value at this path. Empty when the preview has none. */
  badge: string;
  /** Whether {@link badge} is a value at all — "" is a legitimate one. */
  hasBadge: boolean;
  /** A parenthesized non-target operand rather than a link of the target chain. */
  group: boolean;
}

function isExprNode(value: ExpressionValue | undefined): value is ExpressionFields {
  return isJsonObject(value) && isString(value.operator);
}

/** Human label for a pointer ref: strips the #/state/ and window#/ prefixes. */
function refLabel(ref: string): string {
  if (ref.startsWith("#/state/")) {
    return ref.slice("#/state/".length);
  }
  if (ref.startsWith("window#/")) {
    return ref.slice("window#/".length).replaceAll("/", ".");
  }
  return ref || "?";
}

/** Compact label for a non-node operand (ref or literal). */
function operandLabel(value: ExpressionValue | undefined): string {
  if (isRef(value)) {
    return refLabel(value.$ref);
  }
  if (isExprNode(value)) {
    return `(${chipSummary(value)})`;
  }
  if (isString(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

/** The chain path for `hops` target descents below `basePath`. */
function targetPath(basePath: NodePath, hops: number): NodePath {
  return [...basePath, ...Array.from({ length: hops }, () => "target")];
}

/** Unroll a node's target chain into head operand + operator links (deepest first). */
function unrollChain(node: ExpressionFields, basePath: NodePath): Chain {
  // Collect the chain root-first, then materialize each link's path from its descent depth.
  const nodes: ExpressionFields[] = [];
  let current: ExpressionFields = node;
  for (;;) {
    nodes.push(current);
    const next = current.target;
    if (isExprNode(next)) {
      current = next;
    } else {
      break;
    }
  }
  const deepest = nodes.at(-1)!;
  // Reading an absent key yields undefined, so `in` alone decides whether a head operand exists.
  const head: Chain["head"] =
    "target" in deepest
      ? { path: targetPath(basePath, nodes.length), value: deepest.target }
      : null;
  const rootFirst = nodes.map((n, i) => ({ node: n, path: targetPath(basePath, i) }));
  return { head, links: rootFirst.toReversed() };
}

/** Compact one-line text form of a node: head operand followed by the operator chain. */
export function chipSummary(node: ExpressionValue | undefined): string {
  if (!isExprNode(node)) {
    return operandLabel(node);
  }
  const { head, links } = unrollChain(node, []);
  const parts: string[] = [];
  if (head) {
    parts.push(operandLabel(head.value));
  }
  for (const link of links) {
    parts.push(String(link.node.operator));
  }
  return parts.join(" › ");
}

/** One chip record, with its badge resolved against the preview. */
function chip(
  label: string,
  path: NodePath,
  preview: ChipPreview | null | undefined,
  group = false,
): FormulaChip {
  const key = path.join("/");
  const value = preview?.values.get(key);
  return {
    badge: value ?? "",
    group,
    hasBadge: value !== undefined,
    key,
    label,
    path,
  };
}

/** Group chips for a link's non-target expression operands (value / initial / cases / default). */
function groupChips(link: ChainLink, preview: ChipPreview | null | undefined): FormulaChip[] {
  const chips: FormulaChip[] = [];
  const add = (operand: ExpressionValue | undefined, path: NodePath) => {
    if (isExprNode(operand)) {
      chips.push(chip(`(${chipSummary(operand)})`, path, preview, true));
    }
  };
  const { value, initial, cases } = link.node;
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      add(item, [...link.path, "value", i]);
    }
  } else {
    add(value, [...link.path, "value"]);
  }
  add(initial, [...link.path, "initial"]);
  if (isJsonObject(cases)) {
    for (const [key, operand] of Object.entries(cases)) {
      add(operand, [...link.path, "cases", key]);
    }
  }
  add(link.node.default, [...link.path, "default"]);
  return chips;
}

/**
 * The chips one expression node reads as, in strip order.
 *
 * Empty for anything that is not an expression node, which is what a caller draws nothing for — a
 * strip of no chips and no strip at all are the same thing on screen, and saying it here keeps both
 * drawings from having to decide.
 *
 * @param {ExpressionValue | undefined} node The expression node to read.
 * @param {{ preview?: ChipPreview | null; path?: NodePath }} [opts] The live evaluation, and the
 *   document position `node` sits at — every chip path is prefixed with it.
 * @returns {FormulaChip[]}
 */
export function formulaChipStrip(
  node: ExpressionValue | undefined,
  opts: { preview?: ChipPreview | null; path?: NodePath } = {},
): FormulaChip[] {
  if (!isExprNode(node)) {
    return [];
  }
  const preview = opts.preview ?? null;
  const { head, links } = unrollChain(node, opts.path ?? []);

  const chips: FormulaChip[] = [];
  if (head) {
    chips.push(chip(operandLabel(head.value), head.path, preview));
  }
  for (const link of links) {
    chips.push(chip(String(link.node.operator), link.path, preview), ...groupChips(link, preview));
  }
  return chips;
}
