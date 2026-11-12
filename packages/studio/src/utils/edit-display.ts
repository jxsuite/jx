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
  isMappedArray,
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
import { isDocumentContainer } from "./strip-events";
import type { RebuiltNode } from "./strip-events";

const mediaTags = new Set(["img", "video", "source", "iframe", "audio"]);

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
  // A repeater as the whole of `children` draws its rows there.
  if (isNodeObject(node.children)) {
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

// ─── Pointers ────────────────────────────────────────────────────────────────

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

// ─── The template row ────────────────────────────────────────────────────────

/**
 * The key the sample item of a **template row** carries, set true (studio.md §4.5).
 *
 * A repeater with no items is drawn as one row of its template, against an item made up from the
 * list's declared shape (`repeaterSampleItems` in `editor/repeater-scope.ts`), or against no item
 * at all when nothing declares one. The frame marks a made-up item with this key (`rowHooks` in
 * `canvas/iframe-rows.ts`), not enumerable, so nothing that walks the item sees it and an
 * expression can still ask whether its row is a real one.
 */
export const SAMPLE_ROW_KEY = "$__sample";

/** A template that reads the repeater row (`item`, `index`, `$map`). */
const ROW_BINDING_RE = /(?<![\w$.])(?:item|index|\$map)\b/u;

/**
 * The comment an attribute binding carries once {@link templateRowAttribute} has guarded it. A page
 * drawn inside a layout is prepared twice, and the guarded expression still spells `$map`: the mark
 * is what stops the second walk guarding it again.
 */
const ROW_GUARDED = "/*jx-row*/";

/** Whether a value is a template or `$ref` that reads the repeater row and has not been guarded. */
function readsRow(value: JxDocumentValue | undefined): boolean {
  if (isString(value)) {
    return value.includes("${") && !value.includes(ROW_GUARDED) && ROW_BINDING_RE.test(value);
  }
  return isRef(value) && /^(?:#\/)?\$map\//u.test(value.$ref);
}

/**
 * A row-bound ATTRIBUTE as the canvas resolves it: live against its own row, and absent in the
 * template row.
 *
 * No item is not the same as an item whose field is empty, and an expression cannot tell them
 * apart: `${!item?.published}` is true of the made-up item a template row is drawn with, so the
 * very row an empty list shows its template in came out `hidden`, and with it every part of the
 * template a condition guards. An attribute that reads the row is therefore not evaluated there at
 * all, nor where there is no item (a row binding outside any repeater, or the template row of a
 * list whose shape is unknown, which is drawn with none), and `null` takes it off. A longer string
 * is evaluated as the one template literal it is, so it too is all there or not there, never
 * `/posts/undefined`.
 *
 * Attributes alone: text, a style value and a property each show an empty value as nothing, and it
 * is an attribute's presence that hides, disables and links.
 */
function templateRowAttribute(template: string | null, ref: string | null): string {
  let live = "null";
  if (template !== null) {
    const [only, ...more] = templateExpressions(template);
    const whole =
      only !== undefined && more.length === 0 && only.start === 0 && only.end === template.length;
    live = whole ? `(${only.expr})` : `\`${template}\``;
  } else if (ref !== null) {
    // A `$map` pointer always has an accessor; any other never reads the row.
    live = refAccessor(ref) ?? live;
  }
  return `\${${ROW_GUARDED}$map?.item == null || $map.item.${SAMPLE_ROW_KEY} === true ? null : ${live}}`;
}

/**
 * A node's `attributes` as the canvas draws them: live, a row-bound one guarded for the template
 * row.
 */
function prepareAttributes(attributes: Readonly<RebuiltNode>): RebuiltNode {
  const out: RebuiltNode = {};
  for (const [name, value] of Object.entries(attributes)) {
    out[name] = readsRow(value)
      ? templateRowAttribute(isString(value) ? value : null, isRef(value) ? value.$ref : null)
      : value;
  }
  return out;
}

/**
 * Whether a member of `children` is drawn as some number of nodes other than one: a repeater, which
 * is a node per row, or a string that is one whole `${…}`, which splices an array's members in as
 * nodes (spec.md §8.4). Beside either, a child's index in the document is not its index in the DOM,
 * so nothing is spliced there by index (studio.md §4.5): asked by the patch classifier
 * (`canvas/canvas-patcher.ts`) and again by the frame (`canvas/iframe-patch.ts`).
 */
export function drawsManyNodes(child: JxDocumentValue | undefined): boolean {
  if (isMappedArray(child)) {
    return true;
  }
  if (!isString(child)) {
    return false;
  }
  const [only, ...more] = templateExpressions(child);
  return only !== undefined && more.length === 0 && only.start === 0 && only.end === child.length;
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

/** What separates a binding's place from its spelling in a key. No document string holds it. */
const SLOT_SEPARATOR = "\u0000";

/**
 * What every binding in `value` is counted as, where `value` is a property of an element other than
 * its text and `slot` is the key path it sits at (`attributes/href`, `innerHTML`, `style/color`):
 * one key for each `${…}` and each `{ "$ref" }`, at any depth.
 *
 * The slot is part of the key because a binding is not only its spelling. A link's `href` bound to
 * `${state.url}` and the same expression typed into the paragraph's text are two different things,
 * and counted alike the second stood in for the first. Shared by the commit guard that counts them
 * (`editor/inline-edit-apply.ts`) and by the frame, which reports one the author replaced (a URL
 * set in the link popover, `editor/inline-link.ts`).
 */
export function slotBindingKeys(value: JxDocumentValue | undefined, slot: string): string[] {
  if (isString(value)) {
    return templateExpressions(value).map(
      ({ start, end }) => slot + SLOT_SEPARATOR + value.slice(start, end),
    );
  }
  if (isRef(value)) {
    return [slot + SLOT_SEPARATOR + refBindingKey(value.$ref)];
  }
  if (isDocumentContainer(value)) {
    // An array's members or an object's values: `Object.entries` reads either.
    return Object.entries(value).flatMap(([key, member]) =>
      slotBindingKeys(member, `${slot}/${key}`),
    );
  }
  return [];
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

/** What a one-character escape of a template literal stands for (ECMA-262 SingleEscapeCharacter). */
const SINGLE_ESCAPES = new Map([
  ["0", "\0"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
]);

/** A run of hexadecimal digits, whole. */
const HEX_RE = /^[\da-f]+$/iu;

/** The character a hexadecimal code point spells, or null when it spells none. */
function codePointOf(hex: string): string | null {
  if (!HEX_RE.test(hex)) {
    return null;
  }
  const point = Number.parseInt(hex, 16);
  return point > 0x10_ff_ff ? null : String.fromCodePoint(point);
}

/**
 * A literal run of a template string as the text it shows: the inverse of
 * {@link escapeTemplateText} for text that holds no expression, read as a JavaScript template
 * literal reads it.
 *
 * A run is written this way once the string it stood in is no longer a template (its last `${…}`
 * was deleted, or the run was cut out of it): a string with no `${` is literal text, so `C:\\temp`
 * left as it was spelled would show both backslashes. Returns null for a run no template literal
 * could hold (a bare backtick, an escape that is not one), which a page cannot draw either.
 */
export function unescapeTemplateText(text: string): string | null {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (char === "`") {
      return null;
    }
    if (char !== "\\") {
      out += char;
      continue;
    }
    i += 1;
    const next = text.charAt(i);
    if (next === "") {
      return null;
    }
    if (next === "x" || (next === "u" && text.charAt(i + 1) !== "{")) {
      const length = next === "x" ? 2 : 4;
      const hex = text.slice(i + 1, i + 1 + length);
      const spelled = hex.length === length ? codePointOf(hex) : null;
      if (spelled === null) {
        return null;
      }
      out += spelled;
      i += length;
    } else if (next === "u") {
      const close = text.indexOf("}", i);
      const spelled = close === -1 ? null : codePointOf(text.slice(i + 2, close));
      if (spelled === null) {
        return null;
      }
      out += spelled;
      i = close;
    } else if (next === "0" && /\d/u.test(text.charAt(i + 1))) {
      // A legacy octal escape, which a template literal refuses.
      return null;
    } else if (/[1-9]/u.test(next)) {
      return null;
    } else if (next === "\r" || next === "\n") {
      // A line continuation: the backslash and the line break are no text at all.
      if (next === "\r" && text.charAt(i + 1) === "\n") {
        i += 1;
      }
    } else {
      out += SINGLE_ESCAPES.get(next) ?? next;
    }
  }
  return out;
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
 * A chip's content is the expression itself, resolved by the runtime against the real scope: the
 * page's, or inside a repeater the row's own, so every row's chip shows that row's value. One that
 * resolves to nothing, or throws, is empty, and an empty chip is drawn as its name
 * (`EDIT_PLACEHOLDER_CSS`).
 */
function templateRuns(template: string, member = false): (JxMutableNode | string)[] {
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
    /* A whole member keeps its value's type, so an array is spliced as the page splices it; every
       other chip is text, as the string it came from is. */
    const content = member ? segment.source : interpolated(segment.expr);
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
 * Plain text is itself, unless it must be kept `apart` from the string after it (below). A string
 * that is one whole `${…}` is one chip, marked as a member ({@link TAG_MEMBER_ATTR}): its value
 * keeps its type, so an array is spliced in as nodes. Any other templated string is ONE element
 * holding its runs and chips, because a member is one node at its index: the surgical patcher finds
 * a sibling's place by counting DOM children, and a member drawn as three nodes would move every
 * later sibling two places along.
 */
export function prepareTextMember(text: string, apart = false): JxMutableNode | string {
  if (!text.includes("${")) {
    /* `apart`: this plain string ends in a `$` and the plain string after it starts with a `{`
       ({@link opensExpression}). As two text nodes side by side they are one run of text to the
       editing host, which joins them, and joined they are an expression nobody wrote. So this one
       is drawn as a chip, a member of its own that is written back exactly as it is spelled. */
    return apart
      ? chipDef({ kind: "custom", label: ESCAPED_TEXT_LABEL, member: true, source: text }, text)
      : text;
  }
  if (templateSegments(text).length === 1) {
    // One whole `${…}`, or one literal run that only reads right evaluated: one chip, a member.
    const [only] = templateRuns(text, true);
    if (only !== undefined) {
      return only;
    }
  }
  return { [TEXT_MARK]: true, children: templateRuns(text), tagName: "data" };
}

/**
 * Whether two adjacent members of `children` are plain strings whose join would open an expression:
 * a `$` meeting a `{`. Stored content keeps such a pair apart (`editor/content-slice.ts`), and the
 * canvas must too ({@link prepareTextMember}).
 */
function opensExpression(
  member: JxDocumentValue | undefined,
  next: JxDocumentValue | undefined,
): boolean {
  return (
    isString(member) &&
    isString(next) &&
    // `member` is plain by the time this is asked of it (`prepareTextMember`).
    !next.includes("${") &&
    member.endsWith("$") &&
    next.startsWith("{")
  );
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
function refChip(ref: string): JxMutableNode {
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
  return chipDef(mark, `\${((v) => (v == null ? "" : String(v)))(${accessor})}`);
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
 * runtime resolves: bound text becomes literal runs and chips, and a `$prototype: "Array"` passes
 * through with its template prepared, so the runtime draws every row and resolves each against its
 * own item. State is preserved so the runtime can still initialise scope. Arrays are prepared
 * member by member, and primitives and a cleared (`undefined`) key return unchanged, so the walker
 * can recurse through any document value.
 *
 * Preparing a prepared tree changes nothing: a page drawn inside a layout is walked once alone and
 * once as the merge.
 *
 * @param {JxMutableNode} node
 * @returns {JxMutableNode}
 */
export function prepareForEditMode(node: JxMutableNode): JxMutableNode;
export function prepareForEditMode(node: JxDocumentValue): JxDocumentValue;
export function prepareForEditMode(node: JxDocumentValue | undefined): JxDocumentValue | undefined;
export function prepareForEditMode(node: JxDocumentValue | undefined): JxDocumentValue | undefined {
  return prepareNode(node);
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

/** {@link prepareForEditMode} for one value; `inForeign` inside SVG or MathML content. */
function prepareNode(node: JxMutableNode, foreign?: boolean): JxMutableNode;
function prepareNode(node: JxDocumentValue, foreign?: boolean): JxDocumentValue;
function prepareNode(
  node: JxDocumentValue | undefined,
  foreign?: boolean,
): JxDocumentValue | undefined;
function prepareNode(
  node: JxDocumentValue | undefined,
  inForeign = false,
): JxDocumentValue | undefined {
  if (Array.isArray(node)) {
    // Arrays of nodes round-trip element-wise; the array itself is not a node.
    return node.map((n) => prepareNode(n, inForeign));
  }
  if (!isNodeObject(node)) {
    return node;
  }
  // A chip, or the element a templated string is drawn as: prepared already, by an earlier walk.
  if (tagMarkOf(node) !== null || isTextRun(node)) {
    return node;
  }

  /* A repeater passes through: the runtime draws a row per item and resolves each against its own
     row scope (studio.md §4.5). Only its template is prepared, as any node is. Members of a
     children array and a legacy whole-`children` repeater both arrive here. */
  if (node.$prototype === "Array") {
    return isNodeObject(node.map) ? { ...node, map: prepareNode(node.map, inForeign) } : node;
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
    } else if (k === "attributes" && isDocumentContainer(v) && !Array.isArray(v)) {
      out.attributes = prepareAttributes(v);
    } else if (k === "$props" || k === "attributes" || k === "style") {
      /* The runtime's to resolve, every value live: a style declaration at any depth and a
         component's prop each read the page's scope, or inside a repeater their own row's, so a
         date or a locale a component formats is real data. */
      out[k] = v;
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
            members.push(c);
          } else {
            members.push(prepareNode(c, foreign));
          }
        }
        out.children = members;
      } else if (Array.isArray(v)) {
        /* Each member is one node at its index (an element, a chip, a text run), except a repeater,
           which is as many nodes as it has rows: a structural edit beside one is never spliced by
           index (`containerVerdict` in canvas/canvas-patcher.ts). */
        out.children = v.map((c, index) =>
          isString(c)
            ? prepareTextMember(c, opensExpression(c, v[index + 1]))
            : prepareNode(c, foreign),
        );
      } else if (isTemplateString(v)) {
        /* Computed children (spec.md §8.4) render live, as the build renders them. The nodes are
           not the document's, so the element is closed to the caret and the frame leaves them
           unstamped. A failure draws no children rather than throwing out of the effect. */
        out.children = v;
        closed = true;
      } else {
        // A legacy whole-`children` repeater, or a value that is no child list at all.
        out.children = prepareNode(v, foreign);
      }
    } else if (k === "cases" && obj.$switch && isDocumentContainer(v) && !Array.isArray(v)) {
      /* Every case reaches the runtime, which renders the one `$switch` selects at its own path
         under `cases`. An external case (`{ "$ref" }`) is fetched by the frame as it is. */
      const cases: RebuiltNode = {};
      for (const [name, body] of Object.entries(v)) {
        cases[name] = isRef(body) ? body : prepareNode(body, foreign);
      }
      out.cases = cases;
    } else if (k === "$switch") {
      // The discriminant is the runtime's to resolve; it selects among the cases above.
      out[k] = v;
    } else if ((k === "innerHTML" || k === INNER_TEXT) && isBound(v)) {
      // Content drawn from data: live, and closed to the caret, since none of it is a document node.
      out[k] = v;
      closed = true;
    } else if (k === "textContent" && isString(v) && v.includes("${")) {
      if (isEntryField) {
        out[k] = v;
      } else if (hasChildren || noChips) {
        /* Parenthesised so a bare `${state.key}` here is not taken for a component's prop binding
           (the runtime marks those for inline prop editing); the value is the same. */
        out[k] = prepared ? v : parenthesised(v);
        closed = true;
      } else {
        out.children = templateRuns(v);
      }
    } else if (k === "textContent" && isRef(v)) {
      if (hasChildren || noChips) {
        out[k] = v;
      } else {
        out.children = [refChip(v.$ref)];
      }
      closed = true;
    } else if (isString(v) || (isNodeObject(v) && v.$ref)) {
      // Any other bound or literal property renders as the page will.
      out[k] = v;
    } else {
      out[k] = prepareNode(v, foreign);
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
