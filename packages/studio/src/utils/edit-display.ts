/// <reference lib="dom" />
/**
 * Edit-mode display transforms: pure, stateless functions that prepare a document tree for the
 * editing canvas (studio.md §4.5). A binding is never replaced by a label: the runtime resolves it
 * against the document's real scope, and bound text is drawn as literal runs plus one chip per
 * `${…}`, an element closed to the caret that carries the expression it stands for.
 *
 * @docs studio/interface/modes
 */

import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
import {
  displayTagName,
  isNodeObject,
  isNonNullObject,
  isNumber,
  isRef,
  isString,
  isTemplateString,
  templateExpressions,
} from "@jxsuite/schema/guards";
import {
  dynamicTagKind,
  dynamicTagLabel,
  humanizeIdentifier,
  parseDynamicTag,
  templateSegments,
} from "@jxsuite/schema/dynamic-tag";
import type { TemplateExpression } from "@jxsuite/schema/guards";
import { isDocumentContainer } from "./strip-events";
import type { RebuiltNode } from "./strip-events";

const mediaTags = new Set(["img", "video", "source", "iframe", "audio"]);

/** A template that reads the repeater row (`item`, `index`, `$map`). */
const ROW_BINDING_RE = /(?<![\w$.])(?:item|index|\$map)\b/u;

/**
 * The comment a row binding carries once {@link liveRowTemplate} has given it its sample row.
 *
 * A page drawn inside a layout is prepared twice, once alone and once as the merge, and the second
 * walk reaches the first one's output with no row in hand. The mark is what tells it the binding
 * already holds the row it reads: without it the wrapped expression still spells `item`, and a
 * second wrap (or, for a style, the omission a rowless row binding gets) would undo the first.
 */
const ROW_RESOLVED = "/*jx-row*/";

/** Whether a value is a template or `$ref` that reads the repeater row and has not been given one. */
export function isRowBound(value: JxDocumentValue | undefined): boolean {
  if (isString(value)) {
    return value.includes("${") && !value.includes(ROW_RESOLVED) && ROW_BINDING_RE.test(value);
  }
  return isNodeObject(value) && isString(value.$ref) && /^(?:#\/)?\$map\//u.test(value.$ref);
}

const textTags = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
  "dt",
  "dd",
  "th",
  "td",
  "span",
  "strong",
  "em",
  "small",
  "mark",
  "code",
  "abbr",
  "q",
  "sub",
  "sup",
  "time",
  "a",
  "button",
  "label",
  "legend",
  "caption",
  "summary",
  "pre",
  "option",
]);

const containerTags = new Set([
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "figure",
  "figcaption",
  "details",
  "fieldset",
  "form",
  "ul",
  "ol",
  "dl",
  "table",
]);

/**
 * The property that draws an element's content as rendered text. A key of the document, read by
 * name: a Jx node is not a DOM node, and this is the one place the name is spelled.
 */
export const INNER_TEXT = "innerText";

/** All placeholder classes prepareForEditMode may add to an empty element. */
export const EMPTY_PLACEHOLDER_CLASSES = [
  "empty-text-placeholder",
  "empty-container-placeholder",
] as const;

/** The style keys that give an element a size of its own: its box, not its content, sets it. */
const SIZING_KEYS = ["width", "height", "inlineSize", "blockSize"] as const;

/**
 * Whether the node's own style fixes its width or height — a dot, a bar, a spacer.
 *
 * Such an element is drawn as a SHAPE, and an empty one is not missing anything: the jxsuite.com
 * home's 6px status dot is an empty `<span>` sized in its style, and the text placeholder turned it
 * into a column of letters one glyph wide over the hero. A placeholder that changes the box the
 * author sized (the container one sets a `min-height` and a border) misdraws the page it is meant
 * to explain, so a sized element gets none. Only the top-level declaration counts: a size set under
 * a media query or a state is a variant of a box whose base the content still sizes.
 */
function fixesItsOwnSize(node: JxMutableNode): boolean {
  const { style } = node;
  if (!isNonNullObject(style)) {
    return false;
  }
  return SIZING_KEYS.some((key) => {
    const value = style[key];
    const text = isNumber(value) ? String(value) : isString(value) ? value.trim() : "";
    return text !== "" && text !== "auto";
  });
}

/**
 * The empty-placeholder class prepareForEditMode would add for this node, or null. Used by the
 * canvas patcher to keep placeholder classes in sync when patching text without a full render.
 *
 * @param {JxMutableNode} node
 */
export function computeEmptyPlaceholderClass(node: JxMutableNode): string | null {
  if (!node.tagName || node.textContent || node.innerHTML || node[INNER_TEXT]) {
    return null;
  }
  /* A `$switch` draws one of its `cases` as its content: it is not empty, whichever case is live,
     and the container placeholder's dashed box and "Drag elements here" over that case would say
     otherwise. */
  if (node.$switch) {
    return null;
  }
  // Layout-originated nodes ($__layout, set by markLayoutNodes) are read-only in page context;
  // Edit affordances like "Click here to add text" don't apply to them.
  if (node.$__layout) {
    return null;
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return null;
  }
  // Computed children: not empty, only not known until the page runs. The canvas names the binding.
  if (isTemplateString(node.children)) {
    return null;
  }
  if (fixesItsOwnSize(node)) {
    return null;
  }
  if (textTags.has(displayTagName(node.tagName))) {
    return "empty-text-placeholder";
  }
  if (containerTags.has(displayTagName(node.tagName))) {
    return "empty-container-placeholder";
  }
  return null;
}

// ─── The sample row ──────────────────────────────────────────────────────────

/**
 * Build the edit-mode visual for a mapped array: a `<div class="repeater-perimeter">` wrapping a
 * single prepared instance of the map template. Always one element (an empty perimeter when the
 * template is missing) so the array keeps a 1:1 DOM node at its sibling index. The perimeter is an
 * edit-only device: it is never compiled or rendered in preview.
 *
 * @param {JxMutableNode} arrayObj
 * @returns {JxMutableNode}
 */
function arrayToPerimeter(arrayObj: JxMutableNode, row: SampleRow, foreign = false): JxMutableNode {
  const template = arrayObj.map;
  return {
    children: isNonNullObject(template)
      ? [prepareNode(template, sampleRowOf(arrayObj.items, row), foreign)]
      : [],
    className: "repeater-perimeter",
    tagName: "div",
  };
}

/**
 * The row a repeater's template is drawn with in edit mode, as a JavaScript expression the runtime
 * evaluates in the template's own scope, or null outside a repeater or where the repeater's items
 * cannot be read.
 *
 * It is the repeater's FIRST item. A perimeter draws one instance of the template, and everything
 * in it that reads the row (text, an attribute, a `src`, a style value, a component's prop) is
 * resolved against that item: real data of exactly the shape the template was written for, and the
 * row Preview draws first.
 */
export type SampleRow = string | null;

/** A JSON value as a JavaScript literal: JSON is a subset of ECMAScript since ES2019. */
function jsLiteral(value: JxDocumentValue): string {
  return JSON.stringify(value);
}

/**
 * A pointer the runtime resolves, as a JavaScript accessor over the template parameters, or null
 * for a scheme a template cannot reach (`window#/`, `$defs`, an external file).
 */
function refAccessor(ref: string): string | null {
  const pointer = ref.startsWith("#/") ? ref.slice(2) : ref;
  const [head, ...rest] = pointer.split("/");
  const base = head === "state" || head === "$map" ? head : null;
  if (base === null) {
    return null;
  }
  // JSON Pointer unescaping (RFC 6901): `~1` is `/`, `~0` is `~`, in that order.
  const keys = rest.map((seg) => seg.replaceAll("~1", "/").replaceAll("~0", "~"));
  return base + keys.map((key) => `?.[${jsLiteral(key)}]`).join("");
}

/** Evaluate `expr` where `item`, `index` and `$map` are the sample `row`, or as-is with no row. */
function inRow(expr: string, row: SampleRow): string {
  if (row === null) {
    return `(${expr})`;
  }
  return `((r) => ((item, index, $map) => (${expr}))(r, 0, { index: 0, item: r }))(${row})`;
}

/** The first item of a repeater's `items`, read inside the enclosing sample `row` (if any). */
function sampleRowOf(items: JxDocumentValue | undefined, row: SampleRow): SampleRow {
  if (Array.isArray(items)) {
    return `${jsLiteral(items)}[0]`;
  }
  if (isRef(items)) {
    const accessor = refAccessor(items.$ref);
    return accessor === null ? null : `${inRow(accessor, row)}?.[0]`;
  }
  const parts = isString(items) ? templateExpressions(items) : [];
  if (isString(items) && parts.length === 1 && isWholeTemplate(items, parts[0]!)) {
    return `${inRow(parts[0]!.expr, row)}?.[0]`;
  }
  return null;
}

/** Whether `part` is the whole of `template`: one expression end to end, so it keeps its type. */
function isWholeTemplate(template: string, part: TemplateExpression): boolean {
  return part.start === 0 && part.end === template.length;
}

/**
 * One row-reading expression as the canvas evaluates it: inside the sample `row`, and guarded, so a
 * binding with nothing to read (a list still loading, an empty one, no row at all) yields
 * `fallback` instead of throwing out of its effect. `fallback` is JavaScript source.
 */
function guardedRowExpr(expr: string, row: SampleRow, fallback: string): string {
  return `\${${guardedRowBody(expr, row, fallback)}}`;
}

/** The expression inside {@link guardedRowExpr}'s `${…}`. */
function guardedRowBody(expr: string, row: SampleRow, fallback: string): string {
  return `${ROW_RESOLVED}(() => { try { return ${inRow(expr, row)}; } catch { return ${fallback}; } })()`;
}

/**
 * A template whose expressions read the repeater row, as the canvas resolves it: each expression
 * evaluated LIVE against the sample row and guarded ({@link guardedRowExpr}).
 *
 * A template that is one whole `${…}` keeps its value's type, so `whole` is what a failure yields
 * there: `null` for an attribute, which removes it (a `hidden` bound to a row that is not there is
 * taken off, not left standing), and `[]` for computed children. Inside a longer string a failure
 * is the empty string.
 */
function liveRowTemplate(template: string, row: SampleRow, whole = '""'): string {
  const parts = templateExpressions(template);
  if (parts.length === 0) {
    return template;
  }
  if (parts.length === 1 && isWholeTemplate(template, parts[0]!)) {
    return guardedRowExpr(parts[0]!.expr, row, whole);
  }
  let out = "";
  let last = 0;
  for (const { start, end, expr } of parts) {
    out += template.slice(last, start) + guardedRowExpr(expr, row, '""');
    last = end;
  }
  return out + template.slice(last);
}

/**
 * A bound component prop as edit mode passes it: the binding itself, evaluated LIVE by the runtime
 * (against the page's own state and `$page`, and inside a repeater against its sample row) and
 * guarded, so a binding with nothing to read yet (a collection still loading, an empty one) reads
 * as the empty string, a component prop's usual default, rather than throwing out of the binding's
 * effect.
 *
 * A component's prop is not drawn by the page: the component decides what it means, and a date, a
 * locale, a count or a colour cannot be a label.
 */
export function liveEditProp(template: string, row: SampleRow = null): string {
  return liveRowTemplate(template, row);
}

/**
 * A row pointer (`$map/item/…`) as the canvas resolves it: read from the sample row and guarded, or
 * undefined for a pointer no template can reach, which the caller then leaves out.
 */
function liveRowRef(ref: string, row: SampleRow, whole: string): string | undefined {
  const accessor = refAccessor(ref);
  return accessor === null ? undefined : guardedRowExpr(accessor, row, whole);
}

/**
 * The sample row of the repeater template at `path` in `doc` (what {@link prepareForEditMode} draws
 * a perimeter's instance with), so a subtree re-rendered on its own (`iframe-subtree.ts`) is
 * prepared exactly as the full render prepared it.
 */
export function sampleRowAt(doc: JxDocumentValue, path: readonly (string | number)[]): SampleRow {
  let node: JxDocumentValue | undefined = doc;
  let row: SampleRow = null;
  for (const seg of path) {
    if (Array.isArray(node)) {
      node = isNumber(seg) ? node[seg] : undefined;
      continue;
    }
    if (!isNodeObject(node)) {
      return row;
    }
    if (seg === "map" && node.$prototype === "Array") {
      row = sampleRowOf(node.items, row);
    }
    node = isString(seg) ? node[seg] : undefined;
  }
  return row;
}

// ─── Entry-bound text ────────────────────────────────────────────────────────

/**
 * The state entries that are content entries: every `ContentEntry` a document declares. A
 * collection's page names the entry it is drawing through one (studio.md §22.5).
 */
export function entryRootsOf(doc: JxDocumentValue | undefined): ReadonlySet<string> {
  const roots = new Set<string>();
  const state = isNodeObject(doc) ? doc.state : undefined;
  if (isDocumentContainer(state) && !Array.isArray(state)) {
    for (const [key, value] of Object.entries(state)) {
      if (isNodeObject(value) && value.$prototype === "ContentEntry") {
        roots.add(key);
      }
    }
  }
  return roots;
}

/** `state.<root>` followed by plain member steps, the shape an entry field is placed in. */
const ENTRY_PATH_RE = /^state\.([\w$]+)((?:\.[\w$]+)*)$/u;

/** An empty fallback (`?? []`, `?? ""`) is plumbing: the binding reads as the field it guards. */
const EMPTY_FALLBACK_RE = /\s*\?\?\s*(?:\[\s*\]|""|'')\s*$/u;

/**
 * The field an expression reads from one of `roots`, by the name the author placed: `title` for
 * `state.entry.data.title`, `body` for `state.entry.$children`. Null for anything else.
 */
function entryFieldOf(expr: string, roots: ReadonlySet<string>): string | null {
  const match = ENTRY_PATH_RE.exec(expr.replace(EMPTY_FALLBACK_RE, "").trim());
  if (!match || !roots.has(match[1]!)) {
    return null;
  }
  const [first, second] = match[2]!.split(".").filter(Boolean);
  if (first === "data" && second) {
    return second;
  }
  return first === "$children" ? "body" : (first ?? match[1]!);
}

/**
 * The fields a template draws from an entry, in order, or null when it draws nothing from one or
 * when any of its expressions reads something else.
 */
export function entryBoundFields(template: string, roots: ReadonlySet<string>): string[] | null {
  if (roots.size === 0) {
    return null;
  }
  const parts = templateExpressions(template);
  if (parts.length === 0) {
    return null;
  }
  const fields: string[] = [];
  for (const { expr } of parts) {
    const field = entryFieldOf(expr, roots);
    if (field === null) {
      return null;
    }
    if (!fields.includes(field)) {
      fields.push(field);
    }
  }
  return fields;
}

// ─── Chips ───────────────────────────────────────────────────────────────────

/** What a chip stands for: a path, a formula over one, any other expression, or a `{ "$ref" }`. */
export type TagKind = "field" | "format" | "custom" | "ref";

/** The name of an expression outside the tag grammar (studio.md §6.9). Raw code is never drawn. */
export const CUSTOM_TAG_LABEL = "Custom expression";

/** The name of a literal run that only reads right once the template has evaluated its escapes. */
const ESCAPED_TEXT_LABEL = "Escaped text";

/** The name of computed children and of a string child that resolves to nodes (studio.md §4.5). */
export const COMPUTED_LIST_LABEL = "Computed list";

/**
 * The key a chip's definition carries what it stands for under: `{ source, label, kind }`.
 *
 * Not an attribute, because the runtime resolves a `${…}` in an attribute's value and the source IS
 * one. A `$`-prefixed key is a scope local to the runtime, which stores it and reads nothing in it,
 * so it crosses to the frame untouched; the frame's stamper writes it onto the element as
 * `data-jx-tag`, `data-jx-tag-label` and `data-jx-tag-kind` (`makeStamper` in
 * `canvas/iframe-render.ts`).
 */
export const TAG_MARK = "$__tag";

/** The key that marks the one element a templated string member of `children` is drawn as. */
export const TEXT_MARK = "$__text";

/** The attribute a chip carries its expression in, verbatim. Serialization reads this, never text. */
export const TAG_ATTR = "data-jx-tag";

/** The attribute a chip carries its human name in. */
export const TAG_LABEL_ATTR = "data-jx-tag-label";

/** The attribute a chip carries its {@link TagKind} in. */
export const TAG_KIND_ATTR = "data-jx-tag-kind";

/**
 * The attribute on a chip that is one whole string member of a `children` array, and so is never
 * joined with the text beside it.
 *
 * A member that is one whole `${…}` is the only string whose VALUE may be nodes: an array there is
 * spliced in as elements (spec.md §8.4), where the same expression inside a longer string, or as a
 * `textContent`, is interpolated into text. Joining `"Intro: "` and `"${state.spans}"` into one
 * string therefore turns a list of elements into `[object Object]`, and the reverse turns `a,b`
 * into two text nodes. So where a chip stands in the document is part of what it stands for, and
 * the serializer keeps it (`editor/inline-edit.ts`).
 */
export const TAG_MEMBER_ATTR = "data-jx-tag-member";

/**
 * The attribute a `{ "$ref" }` chip carries its pointer in, verbatim. A reference is not a string,
 * so it is written back as the object it was (`editor/inline-edit.ts`), never as `data-jx-tag`.
 */
export const TAG_REF_ATTR = "data-jx-tag-ref";

/**
 * What a `{ "$ref" }` text is counted as wherever bindings are counted: by the frame when it
 * reports a deleted chip, and by the commit guard that asks whether a write lost a binding
 * (`editor/inline-edit-apply.ts`). JSON, so it can never be mistaken for a `${…}`.
 */
export function refBindingKey(pointer: string): string {
  return JSON.stringify({ $ref: pointer });
}

/** The attribute on the element that holds one templated string member's runs and chips. */
export const TEXT_ATTR = "data-jx-text";

/** The selector for a chip. */
export const TAG_SELECTOR = `data[${TAG_ATTR}]`;

/** What a chip definition carries for the stamper. */
export interface TagMark {
  source: string;
  label: string;
  kind: TagKind;
  /** The chip is one whole string member of `children` ({@link TAG_MEMBER_ATTR}). */
  member?: boolean;
  /** The pointer of a `{ "$ref" }` chip ({@link TAG_REF_ATTR}). */
  ref?: string;
}

/** The {@link TagMark} of a prepared chip definition, or null for any other node. */
export function tagMarkOf(def: JxDocumentValue | undefined): TagMark | null {
  const mark = isNodeObject(def) ? def[TAG_MARK] : undefined;
  if (!isNodeObject(mark) || !isString(mark.source) || !isString(mark.label)) {
    return null;
  }
  const { kind } = mark;
  const out: TagMark = {
    kind: kind === "field" || kind === "format" || kind === "ref" ? kind : "custom",
    label: mark.label,
    source: mark.source,
  };
  if (mark.member === true) {
    out.member = true;
  }
  if (isString(mark.ref)) {
    out.ref = mark.ref;
  }
  return out;
}

/** Whether a prepared definition is the element one templated string member is drawn as. */
export function isTextRun(def: JxDocumentValue | undefined): boolean {
  return isNodeObject(def) && def[TEXT_MARK] === true;
}

/**
 * A chip: a `<data>` element closed to the caret that stands for `source` and whose content is
 * `content`, a live template the runtime resolves (or plain text).
 *
 * `<data>` and not `<span>`: `span` is a formatting tag to the inline normalizer
 * (`editor/inline-format.ts`), which merges two adjacent ones into one and unwraps a bare one. The
 * content is a `children` member, never `textContent`, so a whole-`${…}` value that is an array is
 * spliced as nodes the way the build splices it (spec.md §8.4), and the runtime never takes the
 * text for a component prop binding.
 */
function chipDef(mark: TagMark, content: string): JxMutableNode {
  return {
    [TAG_MARK]: { ...mark },
    attributes: { contenteditable: "false" },
    children: [content],
    tagName: "data",
  };
}

/** The human name and kind of one `${…}` expression. */
export function describeTag(expr: string): { label: string; kind: TagKind } {
  const tag = parseDynamicTag(expr);
  return tag === null
    ? { kind: "custom", label: CUSTOM_TAG_LABEL }
    : { kind: dynamicTagKind(tag), label: dynamicTagLabel(tag) };
}

/**
 * Whether a literal run must be evaluated to read as the page will read it. A template string is
 * the inside of a JavaScript template literal, so a backslash in it is an escape (`\n`, `\${`), and
 * a `${` no expression closes fails the whole template. Such a run is drawn by the runtime inside a
 * chip of its own, so what the author types into is always text that is stored as it is seen.
 */
export function needsEvaluation(text: string): boolean {
  return text.includes("\\") || text.includes("`") || text.includes("${");
}

/** {@link escapeTemplateText} for text that holds no `${`. */
function escapeLiteral(text: string): string {
  return text.replaceAll("\\", String.raw`\\`).replaceAll("`", "\\`");
}

/**
 * Text the author typed, as it is written INSIDE a template string so that it reads back as typed:
 * a template string is the inside of a JavaScript template literal, where a backslash starts an
 * escape and a backtick ends the literal (and with it the whole template, which then draws
 * nothing).
 *
 * A `${` is left as it is, and so is everything from one that nothing closes to the end of the
 * text. Writing `${…}` has always been how a binding is typed by hand, and it is what Insert data
 * writes; an open one is a binding still being typed, and escaping under the author's hands what
 * they have typed of it so far would mean it could never be finished.
 */
export function escapeTemplateText(text: string): string {
  let out = "";
  let last = 0;
  for (const { start, end } of templateExpressions(text)) {
    out += escapeLiteral(text.slice(last, start)) + text.slice(start, end);
    last = end;
  }
  const rest = text.slice(last);
  const open = rest.indexOf("${");
  return open === -1
    ? out + escapeLiteral(rest)
    : out + escapeLiteral(rest.slice(0, open)) + rest.slice(open);
}

/**
 * An expression as chip content that is INTERPOLATED, the way the page interpolates it inside a
 * longer string or a `textContent`: whatever it yields becomes text by a template literal's own
 * conversion, so an array reads `a,b` and is never spliced in as nodes. The nested literal is what
 * makes the chip's one whole `${…}` yield a string.
 */
function interpolated(expr: string): string {
  return `\${\`\${${expr}}\`}`;
}

/**
 * A template as the canvas draws it: each literal run as a string, each `${…}` as a chip.
 *
 * A chip's content is the expression itself, resolved by the runtime against the real scope. One
 * that reads the repeater row is resolved against the sample `row` and guarded, so with no row to
 * read it is empty, and an empty chip is drawn as its name (`EDIT_PLACEHOLDER_CSS`).
 */
function templateRuns(
  template: string,
  row: SampleRow,
  member = false,
): (JxMutableNode | string)[] {
  const runs: (JxMutableNode | string)[] = [];
  for (const segment of templateSegments(template)) {
    if (segment.type === "literal") {
      runs.push(
        needsEvaluation(segment.text)
          ? chipDef(
              withMember(
                { kind: "custom", label: ESCAPED_TEXT_LABEL, source: segment.text },
                member,
              ),
              `\${\`${segment.text}\`}`,
            )
          : segment.text,
      );
      continue;
    }
    const mark: TagMark =
      segment.type === "tag"
        ? {
            kind: dynamicTagKind(segment.tag),
            label: dynamicTagLabel(segment.tag),
            source: segment.source,
          }
        : { kind: "custom", label: CUSTOM_TAG_LABEL, source: segment.source };
    const rowBound = isRowBound(segment.source);
    /* A whole member keeps its value's type, so an array is spliced as the page splices it; every
       other chip is text, as the string it came from is. */
    const content = member
      ? rowBound
        ? guardedRowExpr(segment.expr, row, '""')
        : segment.source
      : interpolated(rowBound ? guardedRowBody(segment.expr, row, '""') : segment.expr);
    runs.push(chipDef(withMember(mark, member), content));
  }
  return runs;
}

/** `mark`, flagged as a whole string member of `children` when it is one. */
function withMember(mark: TagMark, member: boolean): TagMark {
  return member ? { ...mark, member: true } : mark;
}

/**
 * A string member of a `children` array as the canvas draws it (studio.md §4.5).
 *
 * Plain text is itself. A string that is one whole `${…}` is one chip, marked as a member
 * ({@link TAG_MEMBER_ATTR}): its value keeps its type, so an array is spliced in as nodes. Any
 * other templated string is ONE element holding its runs and chips, because a member is one node at
 * its index: the surgical patcher finds a sibling's place by counting DOM children, and a member
 * drawn as three nodes would move every later sibling two places along.
 */
export function prepareTextMember(text: string, row: SampleRow = null): JxMutableNode | string {
  if (!text.includes("${")) {
    return text;
  }
  if (templateSegments(text).length === 1) {
    // One whole `${…}`, or one literal run that only reads right evaluated: one chip, a member.
    const [only] = templateRuns(text, row, true);
    if (only !== undefined) {
      return only;
    }
  }
  return { [TEXT_MARK]: true, children: templateRuns(text, row), tagName: "data" };
}

/** The last segment of a pointer, as words: the name of what a `{ "$ref" }` reads. */
function refLabel(ref: string): string {
  const last = ref.split("/").at(-1) ?? "";
  const label = humanizeIdentifier(last.replaceAll("~1", "/").replaceAll("~0", "~"));
  return label === "" ? "Reference" : label;
}

/**
 * A `{ "$ref" }` text as one chip of kind `ref`. A pointer a template can reach is read as that
 * template; any other (`window#/…`) keeps the pointer, which the runtime resolves as it always
 * did.
 */
function refChip(ref: string, row: SampleRow): JxMutableNode {
  const accessor = refAccessor(ref);
  const mark: TagMark = {
    kind: "ref",
    label: refLabel(ref),
    ref,
    source: accessor === null ? ref : `\${${accessor}}`,
  };
  if (accessor === null) {
    return {
      [TAG_MARK]: { ...mark },
      attributes: { contenteditable: "false" },
      tagName: "data",
      textContent: { $ref: ref },
    };
  }
  /* The page assigns a reference's value to `textContent`, which reads null and undefined as no
     text and anything else by its string form (an array as `a,b`). The chip does the same, so its
     one whole `${…}` always yields a string and nothing is spliced. */
  const value = isRowBound({ $ref: ref }) ? guardedRowBody(accessor, row, '""') : accessor;
  return chipDef(mark, `\${((v) => (v == null ? "" : String(v)))(${value})}`);
}

// ─── The bound-block mark ────────────────────────────────────────────────────

/**
 * The attribute edit mode stamps on an element with any bound property: the names of what it draws
 * from data, joined ` · `. The canvas's edit stylesheet draws it as a dotted outline and a label
 * while the element is hovered or holds the caret, and at no other time (`iframe-render.ts`).
 */
export const BOUND_FIELD_ATTR = "data-jx-bound-field";

/**
 * The attribute that marks a collection page's text as one field of the entry being written, which
 * the author types in place (studio.md §22.5). Its text stays the field's live value, not a chip:
 * what is typed there is written to the entry, never to the page.
 */
export const ENTRY_FIELD_ATTR = "data-jx-entry-field";

/** At most this many names are spelled out in a bound block's label; the rest are counted. */
const MAX_BOUND_NAMES = 3;

/** Add the name of every binding `value` holds to `into`, in order, once each. */
function collectBindingNames(value: JxDocumentValue | undefined, into: string[]): void {
  const add = (name: string): void => {
    if (!into.includes(name)) {
      into.push(name);
    }
  };
  if (isString(value)) {
    for (const { expr } of templateExpressions(value)) {
      add(describeTag(expr).label);
    }
  } else if (isRef(value)) {
    add(refLabel(value.$ref));
  }
}

/**
 * The names of everything a node's OWN properties draw from data: its text, its computed children,
 * its string children, its `innerHTML`, its attributes, its top-level style values, a component's
 * props, and any other bound property (`src`, `className`). Descendants name their own.
 */
function boundNamesOf(node: JxMutableNode): string[] {
  const names: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "state" || key === "$media" || key === "$elements" || key === "$switch") {
      continue;
    }
    if (key === "children") {
      if (isTemplateString(value)) {
        names.push(COMPUTED_LIST_LABEL);
      } else if (Array.isArray(value)) {
        for (const child of value) {
          collectBindingNames(isString(child) ? child : undefined, names);
        }
      }
    } else if (key === "attributes" || key === "style" || key === "$props") {
      if (isDocumentContainer(value) && !Array.isArray(value)) {
        for (const member of Object.values(value)) {
          collectBindingNames(member, names);
        }
      }
    } else {
      collectBindingNames(value, names);
    }
  }
  return names;
}

/** A bound block's label: its first few names, and a count of the rest. */
function boundLabel(names: readonly string[]): string {
  const shown = names.slice(0, MAX_BOUND_NAMES).join(" · ");
  return names.length > MAX_BOUND_NAMES ? `${shown} +${names.length - MAX_BOUND_NAMES}` : shown;
}

// ─── The walk ────────────────────────────────────────────────────────────────

/**
 * Prepare a document for edit-mode rendering (studio.md §4.5). Every binding stays a binding the
 * runtime resolves: bound text becomes literal runs and chips, a value that reads the repeater row
 * is resolved against the repeater's sample row, and a `$prototype: "Array"` becomes its perimeter.
 * State is preserved so the runtime can still initialise scope. Arrays are prepared member by
 * member, and primitives and a cleared (`undefined`) key return unchanged, so the walker can
 * recurse through any document value.
 *
 * Preparing a prepared tree changes nothing: a page drawn inside a layout is walked once alone and
 * once as the merge.
 *
 * @param {JxMutableNode} node
 * @returns {JxMutableNode}
 */
export function prepareForEditMode(node: JxMutableNode, row?: SampleRow): JxMutableNode;
export function prepareForEditMode(node: JxDocumentValue, row?: SampleRow): JxDocumentValue;
export function prepareForEditMode(
  node: JxDocumentValue | undefined,
  row?: SampleRow,
): JxDocumentValue | undefined;
export function prepareForEditMode(
  node: JxDocumentValue | undefined,
  row: SampleRow = null,
): JxDocumentValue | undefined {
  return prepareNode(node, row);
}

/** Merge `extra` into a node's `attributes`, keeping what is there. */
function withAttributes(out: RebuiltNode, extra: Readonly<Record<string, string>>): void {
  const { attributes } = out;
  out.attributes =
    isDocumentContainer(attributes) && !Array.isArray(attributes)
      ? { ...attributes, ...extra }
      : { ...extra };
}

/** Whether a node's `attributes` hold `name` as a string. */
function hasAttribute(node: Readonly<RebuiltNode>, name: string): boolean {
  const { attributes } = node;
  if (!isDocumentContainer(attributes) || Array.isArray(attributes)) {
    return false;
  }
  const held: Readonly<RebuiltNode> = attributes;
  return isString(held[name]);
}

/**
 * A row-bound attribute as the canvas resolves it: against the sample `row`, and `null`, which
 * takes the attribute off, whenever there is no row to read or reading it fails.
 *
 * No row is not the same as a row whose field is empty, and an expression cannot tell them apart:
 * `${!item?.published}` is `true` with no item at all, so a template row drawn for an empty list
 * came out `hidden` with nothing on the canvas to click. An attribute that reads the row is
 * therefore not evaluated without one. A longer string is evaluated as the one template literal it
 * is, so it too is all there or not there, never `/posts/undefined`.
 */
function liveRowAttribute(template: string, row: Exclude<SampleRow, null>): string {
  const parts = templateExpressions(template);
  const [only] = parts;
  const value =
    only !== undefined && parts.length === 1 && isWholeTemplate(template, only)
      ? `(${only.expr})`
      : `\`${template}\``;
  return `\${${ROW_RESOLVED}((r) => { if (r == null) { return null; } try { return ((item, index, $map) => ${value})(r, 0, { index: 0, item: r }); } catch { return null; } })(${row})}`;
}

/** A node's `attributes` as the canvas draws them: a row-bound one resolved against the row. */
function prepareAttributes(attributes: Readonly<RebuiltNode>, row: SampleRow): RebuiltNode {
  const processed: RebuiltNode = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (!isRowBound(value)) {
      processed[name] = value;
    } else if (row === null) {
      // No row to read: the attribute is left off (see `liveRowAttribute`).
    } else if (isString(value)) {
      processed[name] = liveRowAttribute(value, row);
    } else if (isRef(value)) {
      const live = liveRowRef(value.$ref, row, "null");
      if (live !== undefined) {
        processed[name] = live;
      }
    }
  }
  return processed;
}

/**
 * A `style` object as the canvas draws it: every declaration live. One that reads the repeater row
 * is resolved against the sample row, at any depth of nested selector or media block; with no row
 * to read it is OMITTED, not blanked, so the cascade answers as it would for an absent one.
 */
function prepareStyle(style: Readonly<RebuiltNode>, row: SampleRow): RebuiltNode {
  const out: RebuiltNode = {};
  for (const [key, value] of Object.entries(style)) {
    if (isDocumentContainer(value) && !Array.isArray(value) && !isRef(value)) {
      out[key] = prepareStyle(value, row);
    } else if (!isRowBound(value)) {
      out[key] = value;
    } else if (row !== null && isString(value)) {
      out[key] = liveRowTemplate(value, row);
    } else if (row !== null && isRef(value)) {
      const live = liveRowRef(value.$ref, row, '""');
      if (live !== undefined) {
        out[key] = live;
      }
    }
  }
  return out;
}

/**
 * The edit-mode form of a node's `style` for `row`, shared with the surgical patcher so a patched
 * style is the style the full render drew (`canvas/iframe-patch.ts`).
 */
export function editModeStyle(
  style: JxDocumentValue | undefined,
  row: SampleRow,
): JxDocumentValue | undefined {
  return isDocumentContainer(style) && !Array.isArray(style) ? prepareStyle(style, row) : style;
}

/**
 * Elements whose content is read as TEXT and nothing else: the parser, and so the browser, takes no
 * element inside them. A chip there is a child the element ignores, so a templated `<style>` lost
 * the value it was written around and a `<textarea>` its whole content.
 */
const RAW_TEXT_TAGS = new Set(["style", "script", "title", "textarea"]);

/** The elements that open a foreign namespace, where an HTML `<data>` chip is not drawn at all. */
const FOREIGN_ROOT_TAGS = new Set(["svg", "math"]);

/** Whether a value is a binding: a template or a `{ "$ref" }`. */
function isBound(value: JxDocumentValue | undefined): boolean {
  return isTemplateString(value) || isRef(value);
}

/** Whether a node holds children: a non-empty array, or anything else that is not absent. */
function holdsChildren(children: JxDocumentValue | undefined): boolean {
  return Array.isArray(children) ? children.length > 0 : children != null;
}

/**
 * Whether what a node draws is a VALUE rather than the author's text, read from the document: its
 * children are computed, its `innerHTML` or `innerText` is bound, its text is a `{ "$ref" }`, or
 * its text is a template that shares the node with children. The canvas closes such a node to the
 * caret (studio.md §4.5), and nothing that slices or joins stored content may reach inside one,
 * because no offset counted on the canvas means anything in there (`editor/content-slice.ts`).
 */
export function isClosedContent(node: JxMutableNode): boolean {
  const { children, textContent } = node;
  if (isTemplateString(children) || isBound(node.innerHTML) || isBound(node[INNER_TEXT])) {
    return true;
  }
  return isRef(textContent) || (isTemplateString(textContent) && holdsChildren(children));
}

/** {@link prepareForEditMode} for one value, inside the sample `row` of its enclosing repeater. */
function prepareNode(node: JxMutableNode, row: SampleRow, foreign?: boolean): JxMutableNode;
function prepareNode(node: JxDocumentValue, row: SampleRow, foreign?: boolean): JxDocumentValue;
function prepareNode(
  node: JxDocumentValue | undefined,
  row: SampleRow,
  foreign?: boolean,
): JxDocumentValue | undefined;
function prepareNode(
  node: JxDocumentValue | undefined,
  row: SampleRow,
  inForeign = false,
): JxDocumentValue | undefined {
  if (Array.isArray(node)) {
    // Arrays of nodes round-trip element-wise; the array itself is not a node.
    return node.map((n) => prepareNode(n, row, inForeign));
  }
  if (!isNodeObject(node)) {
    return node;
  }
  // A chip, or the element a templated string is drawn as: prepared already, by an earlier walk.
  if (tagMarkOf(node) !== null || isTextRun(node)) {
    return node;
  }

  // A mapped-array node itself → its edit-mode perimeter (e.g. when the patcher re-renders an
  // Array node directly). Members inside a children array funnel here via the children branch.
  if (node.$prototype === "Array") {
    return arrayToPerimeter(node, row, inForeign);
  }

  const obj = node;

  const out: RebuiltNode = {};
  const isMediaElement = isString(obj.tagName) && mediaTags.has(obj.tagName);
  /* An entry's field the author types in place keeps its text as the field's live value: the
     nested host there commits to the entry, and a chip inside it would be typed around. */
  const isEntryField = hasAttribute(obj, ENTRY_FIELD_ATTR);
  /* Text and children are two properties the runtime writes in turn, the text first. A node that
     holds both keeps its text a property, so no child moves to another index, and is closed to the
     caret instead, which is what keeps its resolved value out of anything typed into. */
  const hasChildren = holdsChildren(obj.children);
  /** Whether what this node draws is a value, so the caret must not enter it. */
  let closed = false;
  /** Whether an earlier walk prepared this node: it carries the mark that walk left. */
  const prepared = hasAttribute(obj, BOUND_FIELD_ATTR);
  const tag = isString(obj.tagName) ? obj.tagName.toLowerCase() : "";
  /* SVG and MathML content is in another namespace, where the `<data>` a chip is drawn as is an
     unknown element the engine does not render: a chart label bound to data vanished. An
     `<foreignObject>` is HTML again. */
  const foreign = tag === "foreignobject" ? false : inForeign || FOREIGN_ROOT_TAGS.has(tag);
  /* Where no chip can be drawn, bound text stays the runtime's own text (a property, a string
     child), resolved as the page resolves it, and the node is closed to the caret instead. */
  const noChips = foreign || RAW_TEXT_TAGS.has(tag);
  /* Bound text with no children beside it is drawn as runs and chips, which ARE the node's
     children on the canvas: an empty `children` the document also holds must not replace them,
     whichever of the two keys comes first. */
  const textAsRuns =
    !hasChildren &&
    !noChips &&
    (isRef(obj.textContent) || (isTemplateString(obj.textContent) && !isEntryField));

  for (const [k, v] of Object.entries(obj)) {
    if (k === "state" || k === "$media" || k === "$elements") {
      out[k] = v; // Preserve as-is for runtime resolution
    } else if (k === "$props" && isDocumentContainer(v)) {
      /* A component's inputs render LIVE. They are its configuration, not text the author edits in
         place (a template-valued prop is refused by inline prop editing). A prop that reads the
         repeater row is drawn with the repeater's sample row (see liveEditProp), guarded, so a
         date or a locale the component formats is real data rather than a label. */
      const propsOut: RebuiltNode = {};
      for (const [pk, pv] of Object.entries(v)) {
        if (!isRowBound(pv)) {
          propsOut[pk] = pv;
        } else if (isString(pv)) {
          propsOut[pk] = liveEditProp(pv, row);
        } else if (isRef(pv)) {
          // A row pointer with no row to read is dropped, so the component keeps its own default.
          const live = row === null ? undefined : liveRowRef(pv.$ref, row, '""');
          if (live !== undefined) {
            propsOut[pk] = live;
          }
        }
      }
      out[k] = propsOut;
    } else if (k === "children") {
      if (textAsRuns) {
        continue;
      }
      if (Array.isArray(v) && noChips) {
        /* No chip here: a templated string stays the string child the runtime resolves, at its
           index, and the node is closed so its value is never taken for the author's text. */
        const members: JxDocumentValue[] = [];
        for (const c of v) {
          if (isString(c)) {
            closed ||= c.includes("${");
            members.push(isRowBound(c) ? liveRowTemplate(c, row) : c);
          } else {
            members.push(prepareNode(c, row, foreign));
          }
        }
        out.children = members;
      } else if (Array.isArray(v)) {
        // Each member is one node at its index: an element, a perimeter, a chip, or a text run.
        out.children = v.map((c) =>
          isString(c) ? prepareTextMember(c, row) : prepareNode(c, row, foreign),
        );
      } else if (isNodeObject(v) && v.$prototype === "Array") {
        // Legacy whole-children repeater → a single perimeter as the sole child.
        out.children = [prepareNode(v, row, foreign)];
      } else if (isTemplateString(v)) {
        /* Computed children (spec.md §8.4) render live, as the build renders them. The nodes are
           not the document's, so the element is closed to the caret and the frame leaves them
           unstamped. A failure draws no children rather than throwing out of the effect. */
        out.children = isRowBound(v) ? liveRowTemplate(v, row, "[]") : v;
        closed = true;
      } else {
        out.children = prepareNode(v, row, foreign);
      }
    } else if (k === "cases" && obj.$switch && isDocumentContainer(v) && !Array.isArray(v)) {
      /* Every case reaches the runtime, which renders the one `$switch` selects at its own path
         under `cases`. An external case (`{ "$ref" }`) is fetched by the frame as it is. */
      const cases: RebuiltNode = {};
      for (const [name, body] of Object.entries(v)) {
        cases[name] = isRef(body) ? body : prepareNode(body, row, foreign);
      }
      out.cases = cases;
    } else if (k === "$switch") {
      // The discriminant is the runtime's to resolve; it selects among the cases above.
      out[k] = v;
    } else if (k === "attributes" && isDocumentContainer(v) && !Array.isArray(v)) {
      out.attributes = prepareAttributes(v, row);
    } else if (k === "style") {
      out.style = editModeStyle(v, row);
    } else if ((k === "innerHTML" || k === INNER_TEXT) && isBound(v)) {
      // Content drawn from data: live, and closed to the caret, since none of it is a document node.
      out[k] = isString(v) && isRowBound(v) ? liveRowTemplate(v, row) : v;
      closed = true;
    } else if (k === "textContent" && isString(v) && v.includes("${")) {
      if (isEntryField) {
        out[k] = v;
      } else if (hasChildren || noChips) {
        /* Parenthesised so a bare `${state.key}` here is not taken for a component's prop binding
           (the runtime marks those for inline prop editing); the value is the same. */
        out[k] = prepared ? v : isRowBound(v) ? liveRowTemplate(v, row) : parenthesised(v);
        closed = true;
      } else {
        out.children = templateRuns(v, row);
      }
    } else if (k === "textContent" && isRef(v)) {
      if (hasChildren || noChips) {
        out[k] = isRowBound(v) ? (liveRowRef(v.$ref, row, '""') ?? "") : v;
      } else {
        out.children = [refChip(v.$ref, row)];
      }
      closed = true;
    } else if (isRowBound(v)) {
      // Any other property that reads the row: resolved against it, empty when there is none.
      const live = isString(v)
        ? liveRowTemplate(v, row)
        : isRef(v)
          ? liveRowRef(v.$ref, row, '""')
          : v;
      if (live !== undefined) {
        out[k] = live;
      }
    } else if (isString(v) || (isNodeObject(v) && v.$ref)) {
      // Any other bound or literal property renders as the page will.
      out[k] = v;
    } else {
      out[k] = prepareNode(v, row, foreign);
    }
  }

  if (closed) {
    withAttributes(out, { contenteditable: "false" });
  }

  /* Named once, by the walk that saw the document's own values: a second walk would name the
     wrapped expressions the first one left. */
  if (!prepared) {
    const names = boundNamesOf(obj);
    if (names.length > 0) {
      withAttributes(out, { [BOUND_FIELD_ATTR]: boundLabel(names) });
    }
  }

  // Mark empty elements with placeholder classes for design-mode visibility
  const placeholderClass = computeEmptyPlaceholderClass(out);
  const ownClasses = isString(out.className) ? out.className.split(" ") : [];
  if (placeholderClass && !ownClasses.includes(placeholderClass)) {
    out.className = out.className ? `${out.className} ${placeholderClass}` : placeholderClass;
  }

  // A media element that names no source at all is drawn as a placeholder; a bound one resolves.
  if (isMediaElement && namesNoSource(obj)) {
    const cls = isString(out.className) ? out.className : "";
    if (!cls.includes("empty-media-placeholder")) {
      out.className = cls ? `${cls} empty-media-placeholder` : "empty-media-placeholder";
    }
  }

  return out;
}

/** A template with each expression in parentheses: the same value, spelled as no bare path. */
function parenthesised(template: string): string {
  let out = "";
  let last = 0;
  for (const { start, end, expr } of templateExpressions(template)) {
    out += `${template.slice(last, start)}\${(${expr})}`;
    last = end;
  }
  return out + template.slice(last);
}

/** Whether a media element names neither a `src` nor a `poster`, as a property or an attribute. */
function namesNoSource(node: JxMutableNode): boolean {
  const { attributes } = node;
  const named = (value: JxDocumentValue | undefined): boolean => value != null && value !== "";
  return !(
    named(node.src) ||
    named(node.poster) ||
    named(attributes?.src) ||
    named(attributes?.poster)
  );
}
