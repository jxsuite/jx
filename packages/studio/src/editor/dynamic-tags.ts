/**
 * Dynamic tags as the editor reads and writes them (studio.md §6.9).
 *
 * A tag is one `${…}` of a template, or one `{ "$ref" }`. `@jxsuite/schema/dynamic-tag` reads and
 * prints the expression; this module is everything between that and a control: where each tag of a
 * node is stored, what a person calls it, what each field of the tag popover changes in it, which
 * formats a value can take, and what is written back.
 *
 * Three rules hold it together:
 *
 * - **A tag is addressed by where it is stored**: the node's path, the key path of the property that
 *   holds it (`["textContent"]`, `["children", 2]`, `["attributes", "href"]`), and its place among
 *   that string's expressions. A chip on the canvas, a Bound pill and a chip in the Inspector are
 *   three ways to that one address.
 * - **An edit rewrites one tag and nothing beside it.** The string's other characters, and every
 *   other tag in it, are kept as written; a literal argument nobody changed is printed from the
 *   text it was read from.
 * - **Nothing is written by looking.** Every function here that changes a tag is called by an edit,
 *   and an edit that leaves the tag as it was answers the stored value itself.
 *
 * Pure and DOM-free.
 *
 * @docs studio/editing/dynamic-tags
 */

import {
  dynamicTagKind,
  dynamicTagLiteral,
  dynamicTagPath,
  humanizeIdentifier,
  parseDynamicTag,
  printDynamicTag,
} from "@jxsuite/schema/dynamic-tag";
import {
  displayTagName,
  isJsonObject,
  isMappedArray,
  isNumber,
  isRef,
  isString,
  templateExpressions,
} from "@jxsuite/schema/guards";
import {
  COMPUTED_LIST_LABEL,
  CUSTOM_TAG_LABEL,
  refAccessor,
  refBindingKey,
  refLabel,
  rowFieldKey,
  tagLabel,
} from "../utils/edit-display";
import { namedFormulaEntries, packagedFormulaEntries } from "../ui/formula-catalog";

import type {
  DynamicTag,
  DynamicTagCall,
  DynamicTagLiteral,
  DynamicTagPath,
  DynamicTagPipe,
} from "@jxsuite/schema/dynamic-tag";
import type {
  JsonObject,
  JsonValue,
  JxDocumentValue,
  JxMutableNode,
  JxStateDefinition,
} from "@jxsuite/schema/types";
import type { JxPath } from "../state";
import type { SurfaceOption } from "../ui/surface";
import type { TagKind, TagTitles } from "../utils/edit-display";
import type { FormulaParameterInfo } from "../ui/formula-catalog";

// ─── Where a tag is stored ───────────────────────────────────────────────────

/** The key path of the property of a node that holds a tag: `["attributes", "href"]`. */
export type TagSlot = readonly (string | number)[];

/** One tag of a document: its node, the property that holds it, and its place in that string. */
export interface TagAddress {
  path: JxPath;
  slot: TagSlot;
  /** Which `${…}` of the property's string, counted from 0; always 0 for a `{ "$ref" }`. */
  index: number;
}

/** One tag of a node, read. */
export interface BoundTag {
  slot: (string | number)[];
  index: number;
  /** What the document holds: the `${…}` verbatim, or a `{ "$ref" }` as JSON. */
  source: string;
  /** Whether it is stored inside a template string or as a reference object. */
  form: "template" | "ref";
  /** The expression: the inside of the `${…}`, or a reference read as one; null when it has none. */
  expr: string | null;
  /** The pointer of a `{ "$ref" }`, else null. */
  ref: string | null;
  /** The structured tag, or null for a Custom expression and for a pointer no template reaches. */
  tag: DynamicTag | null;
  kind: TagKind;
  /** What a person calls the value: "Post date". */
  label: string;
  /** What a person calls the property it is bound to: "Image", "Link", "Text". */
  property: string;
  /** Whether the tag is drawn as text on the canvas, and so has a chip there. */
  text: boolean;
}

/** The properties whose members are each a property of their own. */
const MEMBER_KEYS = new Set(["attributes", "style", "$props"]);

/**
 * Whether a property is an event handler, which is a reference to a function and not a source: the
 * `{ "$ref" }` of `onclick` is the standard form of a handler, and it prints no text.
 */
function isHandler(key: string, value: JxDocumentValue | undefined): boolean {
  return /^on[a-z]/u.test(key) && isRef(value);
}

/** The keys of a node that hold no binding a tag popover edits. */
const SKIPPED_KEYS = new Set(["state", "$media", "$elements", "$switch", "cases", "$prototype"]);

/** What a person calls a media element's source, by its tag. */
const SOURCE_NAMES = new Map([
  ["audio", "Audio"],
  ["iframe", "Page"],
  ["img", "Image"],
  ["source", "Source"],
  ["video", "Video"],
]);

/** What a person calls a property, where its key says less than a word would. */
const PROPERTY_NAMES = new Map([
  ["alt", "Alt text"],
  ["className", "Class"],
  ["href", "Link"],
  ["innerHTML", "HTML"],
  ["innerText", "Text"],
  ["textContent", "Text"],
]);

/** What a person calls the property a slot names, on a node of `tagName`. */
export function propertyLabel(slot: TagSlot, tagName: string): string {
  const [head, member] = slot;
  if (head === "children") {
    return member === undefined ? "Content" : "Text";
  }
  const key = String(MEMBER_KEYS.has(String(head)) ? (member ?? head) : head);
  if (key === "src" || key === "poster") {
    return key === "poster" ? "Poster" : (SOURCE_NAMES.get(tagName) ?? "Source");
  }
  return PROPERTY_NAMES.get(key) ?? humanizeIdentifier(key);
}

/** The value a slot holds on a node, or undefined when the node has none there. */
export function slotValue(
  node: JxMutableNode | null | undefined,
  slot: TagSlot,
): JxDocumentValue | undefined {
  /* SAFETY: a document node is JSON, so each step of a key path reads a document value. */
  let value = node as JxDocumentValue | undefined;
  for (const key of slot) {
    if (Array.isArray(value)) {
      value = isNumber(key) ? value[key] : undefined;
    } else if (isJsonObject(value)) {
      /* SAFETY: `isJsonObject` narrowed to a record, whose members are document values. */
      value = (value as Record<string, JxDocumentValue | undefined>)[String(key)];
    } else {
      return undefined;
    }
  }
  return value;
}

/** The tags one property's value holds, in order. */
function tagsOfValue(
  value: JxDocumentValue | undefined,
  slot: (string | number)[],
  tagName: string,
  titles: TagTitles | null,
): BoundTag[] {
  const property = propertyLabel(slot, tagName);
  const text = slot[0] === "textContent" || slot[0] === "children";
  if (isRef(value)) {
    /* A pointer reads as a template through optional steps, since a pointer into nothing is
       nothing and not a throw. Written with the member form where the key allows it, which is what
       an author sees in Advanced and what a tag that outgrows its pointer is stored as. */
    const accessor =
      refAccessor(value.$ref)?.replaceAll(/\?\.\["([A-Za-z_$][\w$]*)"\]/gu, "?.$1") ?? null;
    const tag = accessor === null ? null : parseDynamicTag(accessor);
    return [
      {
        expr: accessor,
        form: "ref",
        index: 0,
        kind: "ref",
        label: refLabel(value.$ref, titles),
        property,
        ref: value.$ref,
        slot,
        source: refBindingKey(value.$ref),
        tag,
        text,
      },
    ];
  }
  if (!isString(value)) {
    return [];
  }
  return templateExpressions(value).map(({ start, end, expr }, index) => {
    const tag = parseDynamicTag(expr);
    const whole = slot.length === 1 && slot[0] === "children";
    return {
      expr,
      form: "template" as const,
      index,
      kind: tag === null ? ("custom" as const) : dynamicTagKind(tag),
      label: whole ? COMPUTED_LIST_LABEL : tag === null ? CUSTOM_TAG_LABEL : tagLabel(tag, titles),
      property,
      ref: null,
      slot,
      source: value.slice(start, end),
      tag,
      text,
    };
  });
}

/**
 * Every tag a node's OWN properties hold, in the order the node writes them: its text, its string
 * children, its computed children, its `innerHTML`, its attributes, its top-level style values, a
 * component's props and any other bound property (`src`, `className`). A descendant's are its own.
 */
export function boundTagsOf(
  node: JxMutableNode | null | undefined,
  titles: TagTitles | null = null,
): BoundTag[] {
  if (!isJsonObject(node) || isMappedArray(node)) {
    return [];
  }
  const tagName = isString(node.tagName) ? displayTagName(node.tagName).toLowerCase() : "";
  const tags: BoundTag[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (SKIPPED_KEYS.has(key)) {
      continue;
    }
    if (key === "children") {
      if (Array.isArray(value)) {
        for (const [index, child] of value.entries()) {
          if (isString(child)) {
            tags.push(...tagsOfValue(child, ["children", index], tagName, titles));
          }
        }
      } else {
        tags.push(...tagsOfValue(value, ["children"], tagName, titles));
      }
    } else if (MEMBER_KEYS.has(key)) {
      if (isJsonObject(value)) {
        for (const [member, held] of Object.entries(value)) {
          if (!isHandler(member, held)) {
            tags.push(...tagsOfValue(held, [key, member], tagName, titles));
          }
        }
      }
    } else if (!isHandler(key, value)) {
      tags.push(...tagsOfValue(value, [key], tagName, titles));
    }
  }
  return tags;
}

/** Whether two slots are the same key path. */
export function sameSlot(a: TagSlot, b: TagSlot): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** The tag of `node` at `slot` and `index`, or null when the node holds none there. */
export function tagAt(
  node: JxMutableNode | null | undefined,
  slot: TagSlot,
  index: number,
  titles: TagTitles | null = null,
): BoundTag | null {
  return (
    boundTagsOf(node, titles).find((tag) => tag.index === index && sameSlot(tag.slot, slot)) ?? null
  );
}

/** What a chip on the canvas says of itself (`tagClick`): what it stands for, and which one. */
export interface ChipHit {
  /** The chip's `data-jx-tag`: a `${…}` verbatim, or the template a reference is read as. */
  source: string;
  /** The pointer of a `{ "$ref" }` chip, else null. */
  ref: string | null;
  /** How many chips of the same source precede it in its block. */
  occurrence: number;
}

/**
 * The tag a pressed chip stands for: the `occurrence`-th text tag of the node with the chip's
 * source. Null when the node holds no such tag (the document moved on since the frame drew it).
 */
export function chipTag(
  node: JxMutableNode | null | undefined,
  hit: ChipHit,
  titles: TagTitles | null = null,
): BoundTag | null {
  const source = hit.ref === null ? hit.source : refBindingKey(hit.ref);
  const matches = boundTagsOf(node, titles).filter((tag) => tag.text && tag.source === source);
  return matches[hit.occurrence] ?? matches[0] ?? null;
}

/** A Bound pill's words: the property and the value ("Image: Featured image"). */
export function pillLabel(tag: BoundTag): string {
  return `${tag.property}: ${tag.label}`;
}

// ─── Sources ─────────────────────────────────────────────────────────────────

/** The Source picker's rows, grouped by where the value comes from. */
export interface SourceGroup {
  id: string;
  label: string;
  /** Each row's `value` is what a template reads: `item.data.title`, `state.user.name`. */
  rows: SourceRow[];
}

/** One source: its name, what a template reads, and what it holds today when that is known. */
export interface SourceRow extends SurfaceOption {
  /** The value's type and a short preview of it: `string · "Alice"`. Empty where it is unknown. */
  hint?: string;
}

/**
 * What the Source picker holds for a tag: the row field it reads spelled from the bare row words,
 * or its path as written. `$map.item.data.title` and `item.data.title` are one row of the picker.
 */
export function sourceValue(tag: DynamicTag): string {
  const field = rowFieldKey(tag);
  if (field !== null) {
    return field;
  }
  /* Spelled one way whatever the tag wrote: `state?.["title"]`, which is how a `{ "$ref" }` reads
     as a template, is the picker's `state.title` row. */
  const path = dynamicTagPath(tag);
  let value: string = path.root;
  for (const step of path.steps) {
    const name = step.type === "member" ? step.name : step.key.value;
    value +=
      isString(name) && /^[A-Za-z_$][\w$]*$/u.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
  }
  return value;
}

/**
 * The path a picked source is written as. A row field is spelled the way the tag being edited
 * spells the row (`$map.item.…` or `item.…`), so picking another field and picking the first one
 * back writes the expression the author began with. Null for a value that is no path.
 */
export function sourcePath(value: string, like: DynamicTagPath | null): DynamicTagPath | null {
  const parsed = parseDynamicTag(value);
  if (parsed === null || parsed.pipe.type !== "path" || parsed.negations !== 0 || parsed.fallback) {
    return null;
  }
  const { pipe } = parsed;
  if (like?.root === "$map" && (pipe.root === "item" || pipe.root === "index")) {
    return {
      root: "$map",
      steps: optionalLike(
        [{ name: pipe.root, optional: false, type: "member" }, ...pipe.steps],
        like,
      ),
      type: "path",
    };
  }
  return { ...pipe, steps: optionalLike(pipe.steps, like) };
}

/**
 * `steps` read the way `like` reads its own: a step is optional where the step at its place was,
 * and the ones past the end of `like` as its last one was. A path the author wrote with `?.` is
 * then still read that way after another field is picked, and the first one picked back.
 */
function optionalLike(
  steps: DynamicTagPath["steps"],
  like: DynamicTagPath | null,
): DynamicTagPath["steps"] {
  const last = like?.steps.at(-1);
  if (!like || !last) {
    return steps;
  }
  return steps.map((step, index) => ({
    ...step,
    optional: (like.steps[index] ?? last).optional,
  }));
}

/** `pipe` with the path at its heart replaced, every formula around it kept. */
function withPipePath(pipe: DynamicTagPipe, path: DynamicTagPath): DynamicTagPipe {
  return pipe.type === "path" ? path : { ...pipe, input: withPipePath(pipe.input, path) };
}

/** `tag` reading another value: its formats, its fallback and its `!` are kept. */
export function withSource(tag: DynamicTag, path: DynamicTagPath): DynamicTag {
  return { ...tag, pipe: withPipePath(tag.pipe, path) };
}

/**
 * The pointer a tag can be stored as, or null when it is more than a plain read: a `{ "$ref" }`
 * holds a path of member steps from `state` or the row and nothing else.
 */
export function refOfTag(tag: DynamicTag): string | null {
  if (tag.negations !== 0 || tag.fallback || tag.pipe.type !== "path") {
    return null;
  }
  const { root, steps } = tag.pipe;
  const names: string[] = [];
  for (const step of steps) {
    const name = step.type === "member" ? step.name : step.key.value;
    // A pointer is read through optional steps, so `?.` is how it is spelled, not a difference.
    if (!isString(name)) {
      return null;
    }
    names.push(name.replaceAll("~", "~0").replaceAll("/", "~1"));
  }
  if (names.length === 0) {
    return null;
  }
  if (root === "state") {
    return `#/state/${names.join("/")}`;
  }
  if (root === "$map") {
    return `$map/${names.join("/")}`;
  }
  return root === "item" || root === "index" ? `$map/${[root, ...names].join("/")}` : null;
}

// ─── Fallback and negation ───────────────────────────────────────────────────

/** A string as a single-quoted literal, the form that reads cleanly inside a JSON document. */
function singleQuoted(text: string): DynamicTagLiteral {
  const inner = JSON.stringify(text)
    .slice(1, -1)
    .replaceAll(String.raw`\"`, '"')
    .replaceAll("'", String.raw`\'`);
  const literal = { raw: `'${inner}'`, value: text };
  // The reader is the judge: a text it would read differently is written the way JSON writes it.
  const read = parseDynamicTag(`state.x ?? ${literal.raw}`);
  return read?.fallback?.value.value === text ? literal : dynamicTagLiteral(text);
}

/**
 * The literal a typed fallback stands for. Text is a string, written in the quotes the fallback it
 * replaces used (single quotes for a new one). The one exception keeps a fallback that was not a
 * string from turning into one: where the old value was a number, a boolean or `null`, text that
 * reads as one of those is written as it reads.
 */
export function fallbackLiteral(text: string, previous?: DynamicTagLiteral): DynamicTagLiteral {
  if (previous !== undefined && !isString(previous.value)) {
    const read = parseDynamicTag(`state.x ?? ${text.trim()}`)?.fallback?.value;
    if (read !== undefined && !isString(read.value)) {
      return read;
    }
  }
  if (previous?.raw.startsWith('"')) {
    return dynamicTagLiteral(text);
  }
  return singleQuoted(text);
}

/** A fallback as the text its field shows: a string as itself, anything else as it is written. */
export function fallbackText(tag: DynamicTag): string {
  const value = tag.fallback?.value;
  return value === undefined ? "" : isString(value.value) ? value.value : value.raw;
}

/**
 * `tag` with its fallback set: `operator` null removes it, and otherwise `text` is what is shown
 * when the value is missing (`??`) or missing or blank (`||`). The text of an unchanged fallback is
 * kept as written.
 */
export function withFallback(
  tag: DynamicTag,
  operator: "??" | "||" | null,
  text: string = fallbackText(tag),
): DynamicTag {
  if (operator === null) {
    const { fallback: _dropped, ...rest } = tag;
    return rest;
  }
  const previous = tag.fallback?.value;
  const value =
    previous !== undefined && text === fallbackText(tag)
      ? previous
      : fallbackLiteral(text, previous);
  return { ...tag, fallback: { operator, value } };
}

/** `tag` read as its value (0), as "is empty" (1, `!`) or as "is set" (2, `!!`). */
export function withNegations(tag: DynamicTag, negations: 0 | 1 | 2): DynamicTag {
  return { ...tag, negations };
}

// ─── Formats ─────────────────────────────────────────────────────────────────

/** A formula a tag's value can be passed through, with what its parameters declare. */
export interface FormatFormula {
  name: string;
  description: string;
  parameters: FormulaParameterInfo[];
  /** The state entry to copy into the document when it has none of this name. */
  ensure?: { name: string; def: JxStateDefinition };
}

/** What a value is, as far as choosing a format goes. */
export type ValueType = "string" | "number" | "boolean" | "array" | "object" | "empty";

/** Whether a parameter can be left out of a call, or filled from what it declares. */
function isFillable(parameter: FormulaParameterInfo): boolean {
  return (
    parameter.optional === true ||
    parameter.default !== undefined ||
    Array.isArray(parameter.schema?.["enum"]) ||
    isJsonObject(parameter.schema?.["properties"])
  );
}

/** Whether a parameter's declared type names a list, which no single value is passed to. */
function takesList(parameter: FormulaParameterInfo): boolean {
  const declared = parameter.schema?.["type"];
  return (
    declared === "array" ||
    (parameter.type ?? "").includes("[]") ||
    /^(?:array|values|items|list)$/iu.test(parameter.name)
  );
}

/**
 * The formulas a tag's value can be formatted with: every named formula of the document, then the
 * packaged ones it does not hold yet, whose first parameter takes one value and whose other
 * parameters can each be left out or filled from the type they declare. Derived from the formulas'
 * own declarations, so a formula an author writes with a typed parameter is offered like a packaged
 * one (studio.md §6.6, rule 2).
 */
export function formatFormulas(
  state: Record<string, JxStateDefinition> | null | undefined,
): FormatFormula[] {
  const out: FormatFormula[] = [];
  for (const entry of [...namedFormulaEntries(state), ...packagedFormulaEntries(state)]) {
    const [first, ...rest] = entry.parameters;
    if (first === undefined || takesList(first) || !rest.every((p) => isFillable(p))) {
      continue;
    }
    const formula: FormatFormula = {
      description: entry.description,
      name: entry.name,
      parameters: entry.parameters,
    };
    if (entry.ensure) {
      formula.ensure = entry.ensure;
    }
    out.push(formula);
  }
  return out;
}

/** The types a formula's first parameter declares it takes, or null when it declares none. */
function declaredTypes(formula: FormatFormula): string[] | null {
  const [first] = formula.parameters;
  const declared = first?.schema?.["type"];
  if (isString(declared)) {
    return [declared];
  }
  if (Array.isArray(declared)) {
    return declared.filter((member) => isString(member));
  }
  const text = first?.type;
  return text === "string" || text === "number" || text === "boolean" ? [text] : null;
}

/**
 * Whether a formula is worth offering for a value of this type. A formula that declares nothing
 * takes anything; an empty value says nothing about what the field holds, so every formula stays.
 */
export function formatAccepts(formula: FormatFormula, type: ValueType): boolean {
  const declared = declaredTypes(formula);
  if (declared === null || type === "empty") {
    return true;
  }
  return declared.includes(type) || (type === "number" && declared.includes("integer"));
}

/** One way to format a value: a formula and the arguments after the value. */
export interface FormatPreset {
  /** `formatDate:{"dateStyle":"long"}`: the formula and its arguments, as text. */
  id: string;
  formula: string;
  /** "Format date: long". */
  label: string;
  args: DynamicTagLiteral[];
}

/** The first property of an object schema that offers a closed set, with that set. */
function leadingChoice(
  schema: JsonObject | undefined,
): { key: string; members: JsonValue[] } | null {
  const properties = schema?.["properties"];
  if (!isJsonObject(properties)) {
    return null;
  }
  for (const [key, property] of Object.entries(properties)) {
    if (isJsonObject(property) && Array.isArray(property["enum"])) {
      return { key, members: property["enum"] };
    }
  }
  return null;
}

/** A preset of `formula` with these arguments, named for `detail` when it has one. */
function presetOf(formula: FormatFormula, args: DynamicTagLiteral[], detail: string): FormatPreset {
  const name = humanizeIdentifier(formula.name);
  return {
    args,
    formula: formula.name,
    id: `${formula.name}:${args.map((arg) => arg.raw).join(",")}`,
    label: detail === "" ? name : `${name}: ${detail}`,
  };
}

/**
 * The presets a formula offers, read off its second parameter's declared type: one with the value
 * alone where that parameter can be left out, then one per member of the closed set it declares (a
 * string `enum`, or the first `enum` property of an options object). A formula with one parameter
 * is one preset.
 */
export function presetsOf(formula: FormatFormula): FormatPreset[] {
  const [, second] = formula.parameters;
  if (second === undefined) {
    return [presetOf(formula, [], "")];
  }
  const presets: FormatPreset[] = [];
  if (second.optional === true || second.default !== undefined) {
    presets.push(presetOf(formula, [], ""));
  }
  const members = second.schema?.["enum"];
  if (Array.isArray(members)) {
    for (const member of members) {
      if (member !== second.default) {
        presets.push(presetOf(formula, [dynamicTagLiteral(member)], String(member)));
      }
    }
  }
  const choice = leadingChoice(second.schema);
  if (choice !== null) {
    for (const member of choice.members) {
      presets.push(
        presetOf(formula, [dynamicTagLiteral({ [choice.key]: member })], String(member)),
      );
    }
  }
  return presets;
}

/** Every preset of every formula, in the formulas' order. */
export function formatPresets(formulas: readonly FormatFormula[]): FormatPreset[] {
  return formulas.flatMap((formula) => presetsOf(formula));
}

/** `tag` with its value passed through `preset`, or through nothing when `preset` is null. */
export function withFormat(tag: DynamicTag, preset: FormatPreset | null): DynamicTag {
  const path = dynamicTagPath(tag);
  const pipe: DynamicTagPipe =
    preset === null ? path : { args: preset.args, input: path, name: preset.formula, type: "call" };
  return { ...tag, pipe };
}

/** The one formula a tag's value passes through, or null for none and for a chain of several. */
export function formatCall(tag: DynamicTag): DynamicTagCall | null {
  return tag.pipe.type === "call" && tag.pipe.input.type === "path" ? tag.pipe : null;
}

/** Whether two literal lists hold the same values, whatever each was written as. */
function sameArgs(a: readonly DynamicTagLiteral[], b: readonly DynamicTagLiteral[]): boolean {
  return (
    a.length === b.length &&
    a.every((arg, index) => JSON.stringify(arg.value) === JSON.stringify(b[index]?.value))
  );
}

/**
 * Which preset a tag is on: its id, `""` for no format, or `"custom"` for a format no preset spells
 * (other arguments, a formula that is not offered, formulas nested in one another).
 */
export function presetOfTag(tag: DynamicTag, presets: readonly FormatPreset[]): string {
  if (tag.pipe.type === "path") {
    return "";
  }
  const call = formatCall(tag);
  const found =
    call === null
      ? undefined
      : presets.find((preset) => preset.formula === call.name && sameArgs(preset.args, call.args));
  return found?.id ?? "custom";
}

/** The expression a preset gives a tag's value, for drawing the preset with the real value. */
export function presetExpression(tag: DynamicTag, preset: FormatPreset | null): string {
  return printDynamicTag(withFormat({ negations: 0, pipe: tag.pipe }, preset));
}

// ─── A format's own parameters ───────────────────────────────────────────────

/** One field of the format a tag is on: an argument, or one property of an options argument. */
export interface ParameterField {
  /** `1` for the argument at index 1, `1.dateStyle` for a property of it. */
  key: string;
  label: string;
  /** A closed set to pick from, or free text. */
  kind: "select" | "text";
  /** The value as text; `""` is "not set". */
  value: string;
  options: SurfaceOption[];
}

/** How many properties of an options object are offered before any are set. */
const LEADING_PROPERTIES = 2;

/** A value as the text its field shows. */
function fieldText(value: JsonValue | undefined): string {
  return value === undefined ? "" : isString(value) ? value : JSON.stringify(value);
}

/** The closed set a schema offers, as rows under a "not set" row; none for an open one. */
function choicesOf(schema: JsonObject | undefined): SurfaceOption[] {
  const members =
    schema?.["type"] === "boolean"
      ? [true, false]
      : Array.isArray(schema?.["enum"])
        ? schema["enum"]
        : [];
  return members.length === 0
    ? []
    : [
        { label: "Default", value: "" },
        ...members.map((member) => ({
          label: humanizeIdentifier(String(member)),
          value: fieldText(member),
        })),
      ];
}

/** A field over `value`, a select when its schema is a closed set. */
function fieldOf(
  key: string,
  label: string,
  schema: JsonObject | undefined,
  value: JsonValue | undefined,
): ParameterField {
  const options = choicesOf(schema);
  return {
    key,
    kind: options.length > 0 ? "select" : "text",
    label,
    options,
    value: fieldText(value),
  };
}

/**
 * The fields of the format a tag is on, derived from what the formula's parameters declare
 * (studio.md §6.9): an argument is one field, and an options object is one field per property it
 * holds, after the first two its type declares. Empty for a tag with no single known format.
 */
export function parameterFields(
  tag: DynamicTag,
  formulas: readonly FormatFormula[],
): ParameterField[] {
  const call = formatCall(tag);
  const formula = call === null ? undefined : formulas.find((f) => f.name === call.name);
  if (call === null || formula === undefined) {
    return [];
  }
  const fields: ParameterField[] = [];
  for (const [offset, parameter] of formula.parameters.slice(1).entries()) {
    const position = offset + 1;
    const held = call.args[offset]?.value;
    const properties = parameter.schema?.["properties"];
    if (!isJsonObject(properties)) {
      fields.push(
        fieldOf(
          String(position),
          humanizeIdentifier(parameter.name),
          parameter.schema,
          held ?? parameter.default,
        ),
      );
      continue;
    }
    const set = isJsonObject(held) ? held : {};
    const shown = new Set([
      ...Object.keys(properties).slice(0, LEADING_PROPERTIES),
      ...Object.keys(set),
    ]);
    for (const name of shown) {
      const schema = properties[name];
      fields.push(
        fieldOf(
          `${position}.${name}`,
          humanizeIdentifier(name),
          isJsonObject(schema) ? schema : undefined,
          set[name],
        ),
      );
    }
  }
  return fields;
}

/** What a single-value parameter's values are: from its schema, its display type, or its default. */
function valueKind(parameter: FormulaParameterInfo): string {
  const declared = parameter.schema?.["type"];
  if (isString(declared)) {
    return declared;
  }
  if (parameter.type === "number" || parameter.type === "boolean") {
    return parameter.type;
  }
  return isNumber(parameter.default) ? "number" : "";
}

/**
 * Text typed into a field as the value its kind says it is; text that reads as nothing else stays
 * text.
 */
function fieldValue(text: string, kind: string, schema: JsonObject | undefined): JsonValue {
  if (kind === "boolean") {
    return text === "true";
  }
  if (kind === "integer" || kind === "number") {
    const number = Number(text);
    return Number.isFinite(number) && text.trim() !== "" ? number : text;
  }
  const members = Array.isArray(schema?.["enum"]) ? schema["enum"] : [];
  return members.find((member) => fieldText(member) === text) ?? text;
}

/**
 * `tag` with one {@link ParameterField} set to `text`; `""` unsets it. Only the argument the field
 * belongs to is written again: every other argument is printed from the text it was read from. An
 * options object left with no property, and any trailing argument left unset, is dropped from the
 * call.
 */
export function withParameter(
  tag: DynamicTag,
  formulas: readonly FormatFormula[],
  key: string,
  text: string,
): DynamicTag {
  const call = formatCall(tag);
  const formula = call === null ? undefined : formulas.find((f) => f.name === call.name);
  const [positionText = "", property] = key.split(".");
  const position = Number(positionText);
  const parameter = formula?.parameters[position];
  if (call === null || parameter === undefined || position < 1) {
    return tag;
  }
  const args: (DynamicTagLiteral | undefined)[] = [...call.args];
  const offset = position - 1;
  if (property === undefined) {
    args[offset] =
      text === ""
        ? undefined
        : dynamicTagLiteral(fieldValue(text, valueKind(parameter), parameter.schema));
  } else {
    const held = args[offset]?.value;
    const next: Record<string, JsonValue> = isJsonObject(held) ? { ...held } : {};
    const properties = parameter.schema?.["properties"];
    const declared = isJsonObject(properties) ? properties[property] : undefined;
    const schema = isJsonObject(declared) ? declared : undefined;
    const kind = schema?.["type"];
    if (text === "") {
      delete next[property];
    } else {
      next[property] = fieldValue(text, isString(kind) ? kind : "", schema);
    }
    args[offset] = Object.keys(next).length === 0 ? undefined : dynamicTagLiteral(next);
  }
  while (args.length > 0 && args.at(-1) === undefined) {
    args.pop();
  }
  // A gap before a later argument is `null`: a call has no way to skip a position.
  const filled = args.map((arg) => arg ?? dynamicTagLiteral(null));
  return { ...tag, pipe: { ...call, args: filled } };
}

// ─── Writing back ────────────────────────────────────────────────────────────

/** `template` with its `index`-th `${…}` holding `expr` instead, every other character kept. */
export function replaceExpression(template: string, index: number, expr: string): string {
  const part = templateExpressions(template)[index];
  return part === undefined
    ? template
    : `${template.slice(0, part.start)}\${${expr}}${template.slice(part.end)}`;
}

/**
 * What a property holds once the tag `was` in it reads `expr` instead: `held` itself when the
 * expression is the one it already has, so an edit that changes nothing writes nothing.
 *
 * A tag stored as a `{ "$ref" }` stays one for as long as it is a plain read of state or the row,
 * and becomes a template the moment it needs a format, a fallback or anything else a pointer cannot
 * say. A pointer no template reaches (`window#/…`) is edited as the pointer it is.
 */
export function rewrittenValue(
  held: JxDocumentValue | undefined,
  was: BoundTag,
  expr: string,
): JxDocumentValue | undefined {
  const text = expr.trim();
  if (was.form === "ref") {
    if (was.expr === null) {
      return text === "" || text === was.ref ? held : { $ref: text };
    }
    if (text === was.expr) {
      return held;
    }
    const tag = parseDynamicTag(text);
    const pointer = tag === null ? null : refOfTag(tag);
    if (pointer !== null && pointer === was.ref) {
      return held;
    }
    return pointer === null ? `\${${text}}` : { $ref: pointer };
  }
  if (!isString(held) || text === was.expr?.trim()) {
    return held;
  }
  return replaceExpression(held, was.index, text);
}
