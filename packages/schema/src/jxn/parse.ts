/**
 * Read a `.jxn` file: Jx Notation, which is KDL 2 with Jx's own rules for what each node means.
 *
 * `spec.md` §22 is the grammar. Everything here answers to one property:
 * `parseJxn(serializeJxn(doc))` deep-equals `doc`, with `style` order intact, for every valid
 * document. KDL is a spelling, and the data model does not change.
 *
 * `@bgotink/kdl` is only a parser with source locations. It stays behind this folder so it can be
 * replaced, and its own `toJson` is not used, because it turns `x (ref)"p"` into `"p"`, silently.
 */
import { InvalidKdlError, getLocation, parse } from "@bgotink/kdl";
import type { Document, Entry, Node } from "@bgotink/kdl";
import type { JsonObject, JsonValue, JxDocument } from "../../types.ts";
import { isJsonObject, isNumber, isString } from "../guards.ts";
import { normalizeObject } from "../parse.ts";
import { classifyJxn } from "./classify.ts";
import { JxnError, locate } from "./errors.ts";
import type { JxnSpan } from "./errors.ts";
import { EVENT_HANDLER_NAMES } from "./event-handlers.ts";

/** Bytes KDL's parser admits that a person should never have in a text file. */
const RAW_CONTROL = /(?![\t\n\v\f\r])\p{Cc}/u;

/** The annotations the grammar gives meaning to. Any other is a mistake, and not a thing to ignore. */
const ANNOTATIONS = new Set(["array", "fn", "object", "on", "ref"]);

/** A child node name that means something other than an element. */
const RESERVED_CHILDREN = new Set(["attributes", "script", "state", "style"]);

/** What one read of a file is building. */
export interface Reader {
  /** Where each thing came from, by JSON Pointer, when that was asked for. */
  spans: Map<string, JxnSpan> | null;
  text: string;
}

/** Set a key, refusing a repeat and a key that would be a prototype rather than data. */
export function setKey(
  target: JsonObject,
  key: string,
  value: JsonValue,
  reader: Reader,
  at: Entry | Node,
): void {
  const normalized = key.normalize("NFC");
  if (normalized === "__proto__") {
    throw failure(reader, at, `"__proto__" cannot be a key: it would not be data`);
  }
  if (Object.hasOwn(target, normalized)) {
    throw failure(reader, at, `"${normalized}" is written twice, and one of them would be lost`);
  }
  target[normalized] = value;
}

/** An error at a node or entry's place in the file. */
export function failure(reader: Reader, at: Entry | Node, message: string): JxnError {
  const start = spanOf(at)?.start;
  return new JxnError(message, start === undefined ? null : locate(reader.text, start));
}

/** Where a node or entry is, from the locations the parser stored. */
function spanOf(at: Entry | Node): JxnSpan | null {
  const location = getLocation(at);
  return location ? { end: location.end.offset, start: location.start.offset } : null;
}

/** Record where a pointer's value came from. */
export function mark(reader: Reader, pointer: string, at: Entry | Node): void {
  const span = reader.spans ? spanOf(at) : null;
  if (span) {
    reader.spans?.set(pointer, span);
  }
}

/** A JSON Pointer token. */
export function token(key: string): string {
  return key.replaceAll("~", "~0").replaceAll("/", "~1");
}

/** A node's annotation, checked. */
export function annotationOf(reader: Reader, node: Node): string | null {
  const tag = node.getTag();
  if (tag !== null && !ANNOTATIONS.has(tag)) {
    throw failure(reader, node, `(${tag}) is not an annotation Jx Notation has`);
  }
  if (tag === "ref") {
    throw failure(reader, node, `(ref) annotates a value, and this is a name`);
  }
  return tag;
}

/** An entry's value, with `(ref)` read, and what JSON would lose refused. */
function valueOf(reader: Reader, entry: Entry): JsonValue {
  const tag = entry.getTag();
  const value: JsonValue = entry.getValue();
  if (tag !== null && tag !== "ref") {
    throw failure(reader, entry, `(${tag}) cannot annotate a value here; only (ref) can`);
  }
  if (isNumber(value)) {
    if (!Number.isFinite(value)) {
      throw failure(reader, entry, "JSON has no way to hold #inf or #nan");
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw failure(reader, entry, "This number is too large to survive being read as JSON");
    }
  }
  if (tag === "ref") {
    if (!isString(value)) {
      throw failure(reader, entry, "(ref) needs a string");
    }
    return { $ref: value };
  }
  return value;
}

/** A node's positional values, in order. */
export function positionals(reader: Reader, node: Node): JsonValue[] {
  return node.entries.filter((entry) => !entry.name).map((entry) => valueOf(reader, entry));
}

/** A node's named entries. */
export function properties(node: Node): Entry[] {
  return node.entries.filter((entry) => entry.name);
}

/** The node's children, or none. */
export function childrenOf(node: Node): readonly Node[] {
  return node.children?.nodes ?? [];
}

/** The name of a property entry. */
function nameOf(entry: Entry): string {
  return entry.getName() ?? "";
}

/** A function: its parameters, then a last string as the body, or a child block as a structured one. */
function readFunction(reader: Reader, node: Node, pointer: string): JsonObject {
  const fn: JsonObject = { $prototype: "Function" };
  const values = positionals(reader, node);
  const kids = childrenOf(node);
  for (const entry of properties(node)) {
    setKey(fn, nameOf(entry), valueOf(reader, entry), reader, entry);
  }
  if (kids.length > 0) {
    if (values.length > 0) {
      setKey(fn, "parameters", values, reader, node);
    }
    setKey(fn, "body", readItems(reader, kids, `${pointer}/body`), reader, node);
  } else if (values.length > 0) {
    const body = values.at(-1) ?? null;
    const parameters = values.slice(0, -1);
    if (parameters.length > 0) {
      setKey(fn, "parameters", parameters, reader, node);
    }
    setKey(fn, "body", body, reader, node);
  }
  mark(reader, pointer, node);
  return fn;
}

/** The items of a block made of `-` nodes. */
function readItems(reader: Reader, kids: readonly Node[], pointer: string): JsonValue[] {
  return kids.map((kid, index) => {
    if (kid.getName() !== "-") {
      throw failure(reader, kid, `A list holds only "-" items, and this is "${kid.getName()}"`);
    }
    return readValue(reader, kid, `${pointer}/${index}`);
  });
}

/** A JSON block: JSON-in-KDL, plus `(ref)` and `(fn)`. */
export function readValue(reader: Reader, node: Node, pointer: string): JsonValue {
  const tag = annotationOf(reader, node);
  mark(reader, pointer, node);
  if (tag === "fn") {
    return readFunction(reader, node, pointer);
  }
  const values = positionals(reader, node);
  const props = properties(node);
  const kids = childrenOf(node);
  if (tag === "array") {
    if (props.length > 0) {
      throw failure(reader, node, "(array) holds items, and these are named");
    }
    return [...values, ...readItems(reader, kids, pointer)];
  }
  if (tag !== "object") {
    if (values.length > 1) {
      if (props.length > 0 || kids.length > 0) {
        throw failure(reader, node, "A list of values cannot also have names or a block");
      }
      return values;
    }
    if (values.length === 1) {
      if (props.length > 0 || kids.length > 0) {
        throw failure(reader, node, "A value cannot also have names or a block");
      }
      return values[0] ?? null;
    }
    if (kids.length > 0 && props.length === 0 && kids.every((kid) => kid.getName() === "-")) {
      return readItems(reader, kids, pointer);
    }
  } else if (values.length > 0) {
    throw failure(reader, node, "(object) holds names, and this is a value");
  }
  const object: JsonObject = {};
  for (const entry of props) {
    const key = nameOf(entry);
    setKey(object, key, valueOf(reader, entry), reader, entry);
    mark(reader, `${pointer}/${token(key)}`, entry);
  }
  for (const kid of kids) {
    const key = kid.getName();
    setKey(object, key, readValue(reader, kid, `${pointer}/${token(key)}`), reader, kid);
  }
  return object;
}

/** A `style` block: scalars, and nested blocks, with source order significant. */
export function readStyle(reader: Reader, node: Node, pointer: string): JsonObject {
  const style: JsonObject = {};
  mark(reader, pointer, node);
  if (positionals(reader, node).length > 0) {
    throw failure(reader, node, "A style block holds declarations, and this is a value");
  }
  for (const entry of properties(node)) {
    const key = nameOf(entry);
    setKey(style, key, valueOf(reader, entry), reader, entry);
    mark(reader, `${pointer}/${token(key)}`, entry);
  }
  for (const kid of childrenOf(node)) {
    const key = kid.getName();
    const child = `${pointer}/${token(key)}`;
    const grandchildren = childrenOf(kid);
    if (
      kid.getTag() === "array" ||
      (grandchildren.length > 0 && grandchildren.every((item) => item.getName() === "-"))
    ) {
      setKey(style, key, readValue(reader, kid, child), reader, kid);
      continue;
    }
    const values = positionals(reader, kid);
    if (values.length > 1) {
      throw failure(
        reader,
        kid,
        `"${key}" has more than one value. A selector with a space in it needs quotes`,
      );
    }
    if (values.length === 1) {
      if (properties(kid).length > 0 || childrenOf(kid).length > 0) {
        throw failure(
          reader,
          kid,
          `"${key}" has a value and names. A selector with a space in it needs quotes`,
        );
      }
      setKey(style, key, values[0] ?? null, reader, kid);
      mark(reader, child, kid);
    } else {
      setKey(style, key, readStyle(reader, kid, child), reader, kid);
    }
  }
  return style;
}

/** The elements a `.map` or a value of `.cases` holds: exactly one. */
function readOnlyElement(reader: Reader, node: Node, pointer: string): JsonValue {
  const kids = childrenOf(node);
  if (kids.length !== 1 || !kids[0]) {
    throw failure(reader, node, `"${node.getName()}" holds one element`);
  }
  return readChild(reader, kids[0], pointer);
}

/** A `$array` row: `$prototype: "Array"`, with its one element as `map`. */
function readArrayRow(reader: Reader, node: Node, pointer: string): JsonObject {
  const row: JsonObject = { $prototype: "Array" };
  mark(reader, pointer, node);
  if (positionals(reader, node).length > 0) {
    throw failure(reader, node, "$array holds names and one element, and this is a value");
  }
  for (const entry of properties(node)) {
    const key = nameOf(entry);
    setKey(row, key.startsWith(".") ? key.slice(1) : key, valueOf(reader, entry), reader, entry);
  }
  if (childrenOf(node).length > 0) {
    setKey(row, "map", readOnlyElement(reader, node, `${pointer}/map`), reader, node);
  }
  return row;
}

/** Something in a list of children. */
function readChild(reader: Reader, node: Node, pointer: string): JsonValue {
  const name = node.getName();
  if (name === "-") {
    const values = positionals(reader, node);
    if (values.length !== 1 || properties(node).length > 0 || childrenOf(node).length > 0) {
      throw failure(reader, node, `"-" is one piece of text or one (ref)`);
    }
    mark(reader, pointer, node);
    return values[0] ?? null;
  }
  if (name === "$array") {
    return readArrayRow(reader, node, pointer);
  }
  return readElement(reader, node, pointer);
}

/** Read a named member of an element, whose value is a block. */
function readDotMember(reader: Reader, key: string, kid: Node, pointer: string): JsonValue {
  const annotation = annotationOf(reader, kid);
  if (key === "map") {
    return readOnlyElement(reader, kid, pointer);
  }
  if (key === "cases") {
    const cases: JsonObject = {};
    for (const entry of childrenOf(kid)) {
      const name = entry.getName();
      setKey(
        cases,
        name,
        readOnlyElement(reader, entry, `${pointer}/${token(name)}`),
        reader,
        entry,
      );
    }
    return cases;
  }
  if (key === "children" && annotation !== "array" && childrenOf(kid).length > 0) {
    /* The whole of `children` being one mapped array or switch is the rare form, and it is spelled
       out, because a lone `$array` child means a list of one, which is 17 times as common. */
    return readOnlyElement(reader, kid, pointer);
  }
  return readValue(reader, kid, pointer);
}

/** An element. */
function readElement(reader: Reader, node: Node, pointer: string): JsonObject {
  const element: JsonObject = {};
  const name = node.getName();
  const tag = annotationOf(reader, node);
  mark(reader, pointer, node);
  if (tag !== null) {
    throw failure(reader, node, `(${tag}) cannot annotate an element`);
  }
  const values = positionals(reader, node);
  if (name === "$element") {
    const [tagName, text, ...rest] = values;
    if (rest.length > 0) {
      throw failure(reader, node, "$element takes at most a tag and a text value");
    }
    if (tagName !== undefined) {
      setKey(element, "tagName", tagName, reader, node);
    }
    if (text !== undefined) {
      setKey(element, "textContent", text, reader, node);
    }
  } else {
    if (name.startsWith("$")) {
      throw failure(reader, node, `"${name}" is not a kind of element`);
    }
    setKey(element, "tagName", name, reader, node);
    if (values.length > 1) {
      throw failure(reader, node, "An element has one text value. A list of them needs a block");
    }
    if (values[0] !== undefined) {
      setKey(element, "textContent", values[0], reader, node);
      mark(reader, `${pointer}/textContent`, node);
    }
  }
  readElementEntries(reader, node, element, pointer);
  const children: JsonValue[] = [];
  for (const kid of childrenOf(node)) {
    readElementChild(reader, kid, element, children, pointer);
  }
  if (children.length > 0) {
    setKey(element, "children", children, reader, node);
  }
  return element;
}

/** An element's attributes, made when first wanted. */
function attributesOf(element: JsonObject): JsonObject {
  const { attributes } = element;
  if (isJsonObject(attributes)) {
    return attributes;
  }
  const made: JsonObject = {};
  element.attributes = made;
  return made;
}

/** An element's named entries: attributes, members, handlers. */
function readElementEntries(
  reader: Reader,
  node: Node,
  element: JsonObject,
  pointer: string,
): void {
  for (const entry of properties(node)) {
    const key = nameOf(entry);
    const entryTag = entry.getTag();
    if (entryTag === "fn") {
      throw failure(reader, entry, "A function has a block form: (fn)name, on a line of its own");
    }
    const value = valueOf(reader, entry);
    if (key.startsWith(".") || key.startsWith("$")) {
      const member = key.startsWith(".") ? key.slice(1) : key;
      setKey(element, member, value, reader, entry);
      mark(reader, `${pointer}/${token(member)}`, entry);
    } else if (key.startsWith("on") && entryTag === "ref") {
      setKey(element, key, value, reader, entry);
      mark(reader, `${pointer}/${token(key)}`, entry);
    } else if (key.startsWith("on") && EVENT_HANDLER_NAMES.has(key)) {
      throw failure(
        reader,
        entry,
        `${key} needs (ref)"pointer", or a function on a line of its own: (fn)${key} "…"`,
      );
    } else {
      setKey(attributesOf(element), key, value, reader, entry);
      mark(reader, `${pointer}/attributes/${token(key)}`, entry);
    }
  }
}

/** One child node of an element, which may be a member and may be a child. */
function readElementChild(
  reader: Reader,
  kid: Node,
  element: JsonObject,
  children: JsonValue[],
  pointer: string,
): void {
  const name = kid.getName();
  const tag = annotationOf(reader, kid);
  const member = (key: string): string => `${pointer}/${token(key)}`;
  if (tag === "fn" || tag === "on") {
    if (!name.startsWith("on")) {
      throw failure(
        reader,
        kid,
        `(${tag}) in an element marks a handler, and "${name}" is not one`,
      );
    }
    // `(on)` has done its job by saying this is a handler, and what it holds is a JSON block.
    setKey(element, name, readValue(reader, kid, member(name)), reader, kid);
  } else if (name === "script") {
    throw failure(reader, kid, `"script" is reserved. A <script> element is $element "script"`);
  } else if (name === "state") {
    setKey(element, "state", readValue(reader, kid, member("state")), reader, kid);
  } else if (name === "style") {
    setKey(element, "style", readStyle(reader, kid, member("style")), reader, kid);
  } else if (name === "attributes") {
    const attributes = readValue(reader, kid, member("attributes"));
    if (isJsonObject(attributes)) {
      for (const [key, value] of Object.entries(attributes)) {
        setKey(attributesOf(element), key, value, reader, kid);
      }
    } else {
      setKey(element, "attributes", attributes, reader, kid);
    }
  } else if (name.startsWith(".")) {
    const key = name.slice(1);
    setKey(element, key, readDotMember(reader, key, kid, member(key)), reader, kid);
  } else if (name.startsWith("$") && name !== "$array" && name !== "$element") {
    setKey(element, name, readValue(reader, kid, member(name)), reader, kid);
  } else {
    if (RESERVED_CHILDREN.has(name)) {
      throw failure(reader, kid, `"${name}" is reserved here`);
    }
    children.push(readChild(reader, kid, `${pointer}/children/${children.length}`));
  }
}

/**
 * Read a file's `$head`, whose rows are elements, as a project file's are.
 *
 * @param reader The read.
 * @param node The `$head` node.
 */
export function readHead(reader: Reader, node: Node): JsonValue {
  return childrenOf(node).map((kid, index) => {
    const pointer = `/$head/${index}`;
    return kid.getName() === "-"
      ? readValue(reader, kid, pointer)
      : readElement(reader, kid, pointer);
  });
}

/** Parse KDL, and turn its error into ours. */
export function parseSource(text: string): Document {
  const control = RAW_CONTROL.exec(text);
  if (control) {
    throw new JxnError(
      `A raw control character (U+${control[0].codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}) cannot be in a Jx Notation file. Escape it, as \\u{1b}`,
      locate(text, control.index),
    );
  }
  try {
    return parse(text, { storeLocations: true });
  } catch (error) {
    const first = error instanceof InvalidKdlError ? (error.errors?.[0] ?? error) : null;
    const start = first?.start;
    const message = error instanceof Error ? error.message : String(error);
    throw new JxnError(
      message.split("\n")[0] ?? message,
      start ? locate(text, start.offset) : null,
    );
  }
}

/** Read a whole document. */
function readDocument(reader: Reader): JxDocument {
  const kind = classifyJxn(reader.text);
  if (kind === "project") {
    throw new JxnError(
      `This is a project file: its first node is "project". A document has an element there, and a <project> element is $element "project"`,
    );
  }
  const source = parseSource(reader.text);
  const document: JsonObject = {};
  let root: Node | null = null;
  for (const node of source.nodes) {
    const name = node.getName();
    if (name === "$head" && node.getTag() === null) {
      setKey(document, name, readHead(reader, node), reader, node);
    } else if (name.startsWith("$") && name !== "$array" && name !== "$element") {
      setKey(document, name, readValue(reader, node, `/${token(name)}`), reader, node);
      mark(reader, `/${token(name)}`, node);
    } else if (root) {
      throw failure(reader, node, "A document has one root element, and this is a second");
    } else {
      root = node;
    }
  }
  if (root) {
    const element =
      root.getName() === "$array" ? readArrayRow(reader, root, "") : readElement(reader, root, "");
    for (const [key, value] of Object.entries(element)) {
      setKey(document, key, value, reader, root);
    }
  }
  /* SAFETY: every member of a JxDocument is optional and this object is what the grammar reads;
     member-level checking is `validateDocument`'s job, as it is for a `.json` document. */
  return normalizeObject(document) as JxDocument;
}

/**
 * Read a `.jxn` document.
 *
 * @param text The file.
 * @param path Its path, when an error should name it.
 * @returns The same `JxDocument` a `.json` spelling of it would give.
 * @throws {JxnError} When it is not one, naming the line and column where it can.
 */
export function parseJxn(text: string, path?: string): JxDocument {
  try {
    return readDocument({ spans: null, text });
  } catch (error) {
    throw path !== undefined && error instanceof JxnError ? error.inFile(path) : error;
  }
}

/**
 * Read a `.jxn` document, and where in the file each part of it came from.
 *
 * @param text The file.
 * @throws {JxnError} When it is not one.
 */
export function parseJxnWithSpans(text: string) {
  const spans = new Map<string, JxnSpan>();
  return { document: readDocument({ spans, text }), spans };
}
