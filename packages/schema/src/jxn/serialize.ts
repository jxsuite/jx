/**
 * Write a Jx document as Jx Notation, in its canonical form.
 *
 * Every string is checked by reading it back before it is trusted, because the failures are silent:
 * a whitespace-only line, a CRLF or a U+2028 can change in a raw string with no error at all.
 */
import { parse } from "@bgotink/kdl";
import type { JsonObject, JsonValue, JxDocument } from "../../types.ts";
import { isJsonObject, isNumber, isString } from "../guards.ts";
import { JxnError } from "./errors.ts";

const INDENT = "    ";

/** Past this a line of names is worse than one name per line. */
const WIDTH = 100;

/** What a bare KDL identifier can be: no keyword, nothing that reads as a number, no punctuation. */
const BARE =
  /^(?![-+]?\.?\d)(?!(?:true|false|null|inf|-inf|nan)$)[^\s\\/(){};[\]"#=,\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+$/u;

/** What cannot be written literally: control characters, and what would change how text is laid out. */
const UNWRITABLE = /[\p{Cc}\p{Zl}\p{Zp}‎‏‪-‮⁦-⁩﻿]/u;

/** The same, leaving the newline a multi-line string is made of. */
const UNWRITABLE_IN_LINES = /(?!\n)\p{Cc}|[\p{Zl}\p{Zp}‎‏‪-‮⁦-⁩﻿]/u;

/**
 * The child names an element reads as something other than a child, so a tag by one of these needs
 * `$element`.
 */
const RESERVED_TAGS = new Set(["-", "attributes", "script", "state", "style"]);

const isObject = (value: JsonValue | undefined): value is JsonObject => isJsonObject(value);

const isRef = (value: JsonValue | undefined): value is { $ref: string } =>
  isObject(value) && isString(value.$ref) && Object.keys(value).length === 1;

/** Whether a string has no lone surrogate. A `u` regular expression sees one as a code point. */
function isWellFormed(value: string): boolean {
  return !/\p{Cs}/u.test(value);
}

/** Whether a string reads back as itself from this spelling. */
function survives(spelling: string, value: string): boolean {
  try {
    return parse(`x ${spelling}`).nodes[0]?.entries[0]?.getValue() === value;
  } catch {
    return false;
  }
}

/** A quoted string, with everything awkward escaped. */
function quoted(value: string): string {
  let out = '"';
  for (const char of value) {
    if (char === '"') {
      out += String.raw`\"`;
    } else if (char === "\\") {
      out += String.raw`\\`;
    } else if (char === "\n") {
      out += String.raw`\n`;
    } else if (char === "\t") {
      out += String.raw`\t`;
    } else if (char === "\r") {
      out += String.raw`\r`;
    } else if (UNWRITABLE.test(char)) {
      out += `\\u{${char.codePointAt(0)?.toString(16)}}`;
    } else {
      out += char;
    }
  }
  return `${out}"`;
}

/** The fewest `#`s a raw string needs to hold this text. */
function rawHashes(value: string, quote: string): string {
  let hashes = "#";
  while (value.includes(quote + hashes)) {
    hashes += "#";
  }
  return hashes;
}

/** A multi-line raw string at this indent, if one would read back as the same text. */
function multiline(value: string, indent: string): string | null {
  if (UNWRITABLE_IN_LINES.test(value)) {
    return null;
  }
  const hashes = rawHashes(value, '"""');
  const inner = `${indent}${INDENT}`;
  const lines = value.split("\n").map((line) => (line === "" ? "" : inner + line));
  const spelling = `${hashes}"""\n${lines.join("\n")}\n${inner}"""${hashes}`;
  return survives(spelling, value) ? spelling : null;
}

/**
 * The best spelling of a string: bare, then raw, then quoted.
 *
 * A string holding a backslash is raw whenever it can be, so a person editing it does not have to
 * know that KDL's `\s` is a space.
 *
 * @param value The string.
 * @param indent Where a multi-line form would sit.
 * @param where The JSON Pointer, which a refusal names.
 */
function writeString(value: string, indent: string, where: string): string {
  if (!isWellFormed(value)) {
    throw new JxnError(`${where} holds a lone surrogate, which Jx Notation has no way to spell`);
  }
  if (BARE.test(value)) {
    return value;
  }
  if (value.includes("\n")) {
    const lines = multiline(value, indent);
    if (lines) {
      return lines;
    }
  } else if ((value.includes("\\") || value.includes('"')) && !UNWRITABLE.test(value)) {
    const hashes = rawHashes(value, '"');
    const spelling = `${hashes}"${value}"${hashes}`;
    if (survives(spelling, value)) {
      return spelling;
    }
  }
  return quoted(value);
}

/** A key, as a node or property name. Never multi-line: a name is one line. */
function writeName(key: string, where: string): string {
  if (!isWellFormed(key)) {
    throw new JxnError(`${where} is a key with a lone surrogate, which Jx Notation cannot spell`);
  }
  return BARE.test(key) ? key : quoted(key);
}

/** A value that fits in one token, or null if it needs a block. */
function scalar(value: JsonValue | undefined, indent: string, where: string): string | null {
  if (value === null) {
    return "#null";
  }
  if (value === true) {
    return "#true";
  }
  if (value === false) {
    return "#false";
  }
  if (isNumber(value)) {
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (isString(value)) {
    return writeString(value, indent, where);
  }
  return isRef(value) ? `(ref)${quoted(value.$ref)}` : null;
}

/** A pointer one step on. */
const down = (where: string, key: string | number): string =>
  `${where}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

/** Whether a function has a spelling as a `(fn)` node, rather than as a plain block. */
function isFunctionRow(value: JsonValue | undefined): value is JsonObject {
  if (!isObject(value) || value.$prototype !== "Function") {
    return false;
  }
  const { $prototype: _prototype, body, parameters, ...rest } = value;
  const isScalars = Object.values(rest).every((entry) => scalar(entry, "", "") !== null);
  const hasWritableParameters =
    parameters === undefined ||
    (Array.isArray(parameters) &&
      parameters.length > 0 &&
      parameters.every((parameter) => isString(parameter)) &&
      body !== undefined);
  const hasWritableBody = body === undefined || isString(body) || Array.isArray(body);
  const isEmptyList = Array.isArray(body) && body.length === 0;
  return isScalars && hasWritableParameters && hasWritableBody && !isEmptyList;
}

/** A `(fn)` node. */
function writeFunction(key: string, fn: JsonObject, indent: string, where: string): string[] {
  const { $prototype: _prototype, body, parameters, ...rest } = fn;
  const parts = [`${indent}(fn)${writeName(key, where)}`];
  for (const [name, value] of Object.entries(rest)) {
    parts.push(`${writeName(name, where)}=${scalar(value, indent, down(where, name))}`);
  }
  if (Array.isArray(parameters)) {
    for (const parameter of parameters) {
      parts.push(writeString(String(parameter), indent, down(where, "parameters")));
    }
  }
  if (isString(body)) {
    parts.push(writeString(body, indent, down(where, "body")));
  } else if (Array.isArray(body)) {
    return [
      `${parts.join(" ")} {`,
      ...body.flatMap((item, index) =>
        writeValue("-", item, indent + INDENT, down(down(where, "body"), index)),
      ),
      `${indent}}`,
    ];
  }
  return [parts.join(" ")];
}

/** A JSON block. */
function writeValue(key: string, value: JsonValue, indent: string, where: string): string[] {
  const name = writeName(key, where);
  const head = indent + name;
  const single = scalar(value, indent, where);
  if (single !== null) {
    return [`${head} ${single}`];
  }
  if (isFunctionRow(value)) {
    return writeFunction(key, value, indent, where);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${indent}(array)${name}`];
    }
    const items = value.map((item, index) => scalar(item, indent, down(where, index)));
    const isLine = value.length > 1 && items.every((item) => item !== null && !item.includes("\n"));
    if (isLine) {
      const line = `${head} ${items.join(" ")}`;
      if (line.length <= WIDTH) {
        return [line];
      }
    }
    return [
      `${head} {`,
      ...value.flatMap((item, index) => writeValue("-", item, indent + INDENT, down(where, index))),
      `${indent}}`,
    ];
  }
  // What is left is an object: `scalar` took the primitives and refs, and the branch above the lists.
  const entries = isObject(value) ? Object.entries(value) : [];
  if (entries.length === 0) {
    return [`${head} {}`];
  }
  const annotation = entries.every(([entry]) => entry === "-") ? `${indent}(object)${name}` : head;
  const props = entries.map(([entry, item]) => {
    const spelled = scalar(item, indent, down(where, entry));
    return spelled === null || spelled.includes("\n")
      ? null
      : `${writeName(entry, where)}=${spelled}`;
  });
  if (props.every((prop) => prop !== null)) {
    const line = `${annotation} ${props.join(" ")}`;
    if (line.length <= WIDTH) {
      return [line];
    }
  }
  return [
    `${annotation} {`,
    ...entries.flatMap(([entry, item]) =>
      writeValue(entry, item, indent + INDENT, down(where, entry)),
    ),
    `${indent}}`,
  ];
}

/** A `style` block. Only leading scalars can be names, because a block comes after them. */
function writeStyle(key: string, style: JsonObject, indent: string, where: string): string[] {
  const entries = Object.entries(style);
  const name = indent + writeName(key, where);
  if (entries.length === 0) {
    return [`${name} {}`];
  }
  const leading: string[] = [];
  let rest = 0;
  for (const [entry, value] of entries) {
    const spelled = scalar(value, indent, down(where, entry));
    if (spelled === null || spelled.includes("\n")) {
      break;
    }
    leading.push(`${writeName(entry, where)}=${spelled}`);
    rest += 1;
  }
  const line = `${name} ${leading.join(" ")}`;
  const hoisted = leading.length > 0 && line.length <= WIDTH;
  const start = hoisted ? rest : 0;
  const body = entries.slice(start).flatMap(([entry, value]) => {
    if (isObject(value) && !isRef(value)) {
      return writeStyle(entry, value, indent + INDENT, down(where, entry));
    }
    // A list, such as the several `@font-face` a stylesheet can hold, is the one other thing here.
    return writeValue(entry, value, indent + INDENT, down(where, entry));
  });
  if (hoisted && body.length === 0) {
    return [line];
  }
  return [`${hoisted ? line : name} {`, ...body, `${indent}}`];
}

/** Whether a mapped array has the `$array` row's spelling. */
function isArrayRow(value: JsonValue | undefined): value is JsonObject {
  if (!isObject(value) || value.$prototype !== "Array" || !isObject(value.map)) {
    return false;
  }
  const { $prototype: _prototype, map: _map, ...rest } = value;
  return Object.values(rest).every((entry) => {
    const spelled = scalar(entry, "", "");
    return spelled !== null && !spelled.includes("\n");
  });
}

/** A `$array` row. */
function writeArrayRow(row: JsonObject, indent: string, where: string): string[] {
  const { $prototype: _prototype, map, ...rest } = row;
  const parts = [`${indent}$array`];
  for (const [key, value] of Object.entries(rest)) {
    parts.push(`${writeName(key, where)}=${scalar(value, indent, down(where, key))}`);
  }
  return [
    `${parts.join(" ")} {`,
    ...writeChild(map ?? null, indent + INDENT, down(where, "map")),
    `${indent}}`,
  ];
}

/** Something in a list of children. */
function writeChild(child: JsonValue, indent: string, where: string): string[] {
  const single = scalar(child, indent, where);
  if (single !== null) {
    return [`${indent}- ${single}`];
  }
  if (isArrayRow(child)) {
    return writeArrayRow(child, indent, where);
  }
  if (isObject(child)) {
    return writeElement(child, indent, where);
  }
  // A list inside a list has no meaning as children. Refused here, and not silently dropped.
  throw new JxnError(`${where} is a list inside a list of children, which has no spelling`);
}

/** What an element's own tag is written as. */
function writeHead(element: JsonObject, indent: string, where: string): string {
  const { tagName } = element;
  if (!isString(tagName)) {
    return `${indent}$element`;
  }
  if (RESERVED_TAGS.has(tagName) || tagName.startsWith("$") || tagName.startsWith(".")) {
    return `${indent}$element ${quoted(tagName)}`;
  }
  return indent + writeName(tagName, where);
}

/** Whether this attribute can be a plain `name=value` on the element. */
function isPlainAttribute(key: string, spelled: string | null): spelled is string {
  return (
    spelled !== null &&
    !spelled.includes("\n") &&
    !key.startsWith("on") &&
    !key.startsWith("$") &&
    !key.startsWith(".")
  );
}

/** An element. */
function writeElement(element: JsonObject, indent: string, where: string): string[] {
  const parts = [writeHead(element, indent, where)];
  const inner = indent + INDENT;
  const blocks: string[] = [];
  const leftoverAttributes: JsonObject = {};
  let textPositional: string | null = null;
  for (const [key, value] of Object.entries(element)) {
    const at = down(where, key);
    if (key === "tagName" && isString(value)) {
      continue;
    }
    if (key === "children") {
      continue;
    }
    if (key === "textContent") {
      const spelled = scalar(value, indent, at);
      if (spelled === null || !isString(element.tagName)) {
        pushMember(parts, blocks, key, value, inner, indent, at);
      } else {
        textPositional = spelled;
      }
    } else if (key === "attributes" && isObject(value)) {
      for (const [name, item] of Object.entries(value)) {
        const spelled = scalar(item, indent, down(at, name));
        if (isPlainAttribute(name, spelled)) {
          parts.push(`${writeName(name, at)}=${spelled}`);
        } else {
          leftoverAttributes[name] = item;
        }
      }
    } else if (key === "state") {
      blocks.push(...writeValue("state", value, inner, at));
    } else if (key === "style" && isObject(value)) {
      blocks.push(...writeStyle("style", value, inner, at));
    } else if (key.startsWith("on") && isRef(value)) {
      parts.push(`${writeName(key, at)}=${scalar(value, indent, at)}`);
    } else if (key.startsWith("on")) {
      blocks.push(
        ...(isFunctionRow(value)
          ? writeFunction(key, value, inner, at)
          : writeValue(key, value, inner, at).map((line, index) =>
              index === 0 ? line.replace(inner, `${inner}(on)`) : line,
            )),
      );
    } else if (key.startsWith("$")) {
      const spelled = scalar(value, indent, at);
      if (spelled === null || spelled.includes("\n")) {
        blocks.push(...writeValue(key, value, inner, at));
      } else {
        parts.push(`${writeName(key, at)}=${spelled}`);
      }
    } else {
      pushMember(parts, blocks, key, value, inner, indent, at);
    }
  }
  if (Object.keys(leftoverAttributes).length > 0) {
    blocks.push(...writeValue("attributes", leftoverAttributes, inner, down(where, "attributes")));
  }
  blocks.push(...writeChildren(element.children, inner, down(where, "children")));
  if (textPositional !== null) {
    parts.push(textPositional);
  }
  return blocks.length === 0
    ? [parts.join(" ")]
    : [`${parts.join(" ")} {`, ...blocks, `${indent}}`];
}

/** The children of an element, in whichever form they take. */
function writeChildren(children: JsonValue | undefined, indent: string, where: string): string[] {
  if (children === undefined) {
    return [];
  }
  if (Array.isArray(children)) {
    if (children.length === 0) {
      return [`${indent}(array).children`];
    }
    return children.flatMap((child, index) => writeChild(child, indent, down(where, index)));
  }
  const single = scalar(children, indent, where);
  if (single !== null) {
    return [`${indent}.children ${single}`];
  }
  return [`${indent}.children {`, ...writeChild(children, indent + INDENT, where), `${indent}}`];
}

/** A member with no plainer form: `.name=value`, or a `.name` block. */
function pushMember(
  parts: string[],
  blocks: string[],
  key: string,
  value: JsonValue,
  inner: string,
  indent: string,
  where: string,
): void {
  const name = writeName(`.${key}`, where);
  if (key === "map" && isObject(value)) {
    blocks.push(`${inner}${name} {`, ...writeChild(value, inner + INDENT, where), `${inner}}`);
    return;
  }
  if (key === "cases" && isObject(value)) {
    blocks.push(`${inner}${name} {`);
    for (const [entry, item] of Object.entries(value)) {
      blocks.push(
        `${inner}${INDENT}${writeName(entry, where)} {`,
        ...writeChild(item, inner + INDENT + INDENT, down(where, entry)),
        `${inner}${INDENT}}`,
      );
    }
    blocks.push(`${inner}}`);
    return;
  }
  const spelled = scalar(value, indent, where);
  if (spelled === null || spelled.includes("\n")) {
    blocks.push(...writeValue(`.${key}`, value, inner, where));
  } else {
    parts.push(`${name}=${spelled}`);
  }
}

/** A file's `$head`, whose rows are elements. */
function writeHeadBlock(head: JsonValue[], indent: string): string[] {
  return [
    "$head {",
    ...head.flatMap((row, index) =>
      isObject(row) && !isRef(row) && isString(row.tagName) && !row.$ref
        ? writeElement(row, indent, `/$head/${index}`)
        : writeValue("-", row, indent, `/$head/${index}`),
    ),
    "}",
  ];
}

/**
 * Write a document in its canonical form.
 *
 * @param document The document.
 * @throws {JxnError} When it holds what Jx Notation cannot spell, naming the JSON Pointer.
 */
export function serializeJxn(document: JxDocument): string {
  if (!isJsonObject(document)) {
    throw new JxnError("A document is an object");
  }
  const source = document;
  const lines = ["/- kdl-version 2"];
  const root: JsonObject = {};
  for (const [key, value] of Object.entries(source)) {
    if (key === "$head" && Array.isArray(value)) {
      lines.push(...writeHeadBlock(value, INDENT));
    } else if (key === "$head") {
      // Not a list, so not rows. The annotation is what stops it being read as them.
      lines.push(`(object)${writeValue(key, value, "", "/$head").join("\n")}`);
    } else if (key.startsWith("$")) {
      lines.push(...writeValue(key, value, "", down("", key)));
    } else {
      root[key] = value;
    }
  }
  if (Object.keys(root).length > 0) {
    lines.push("", ...writeElement(root, "", ""));
  }
  return `${lines.join("\n")}\n`;
}
