/**
 * A project file in Jx Notation: `project.jxn` (`site-architecture.md` §2.3).
 *
 * The grammar is `spec.md` §22's, with a different top level. There is no root element, and every
 * node is a member of the configuration. `$head` has element rows, `style` and `$media` have style
 * rows, and everything else is a JSON block. So the `$ref`, duplicate-key, NFC and refusal rules
 * are the document grammar's own, and a person who can write one can write the other.
 *
 * The file declares itself with a `project` node, the first after any `$` metadata, whose one
 * optional value is the project's `name`. `classifyJxn` reads that node without parsing the file.
 *
 * @docs framework/concepts/jxn-files
 */
import type { Node } from "@bgotink/kdl";
import type { JsonObject, JsonValue, ProjectConfig } from "../../types.ts";
import { isJsonObject } from "../guards.ts";
import { normalizeObject } from "../parse.ts";
import { classifyJxn } from "./classify.ts";
import { JxnError } from "./errors.ts";
import type { JxnSpan } from "./errors.ts";
import {
  annotationOf,
  childrenOf,
  failure,
  mark,
  parseSource,
  positionals,
  properties,
  readHead,
  readStyle,
  readValue,
  setKey,
  token,
} from "./parse.ts";
import type { Reader } from "./parse.ts";
import { reconcileJxn } from "./reconcile.ts";
import type { JxnReading } from "./reconcile.ts";
import { INDENT, down, isRef, scalar, writeHeadBlock, writeName, writeValue } from "./serialize.ts";

/** The node that makes a `.jxn` file a project's. */
const PROJECT_NODE = "project";

/** The members whose rows are style declarations, in source order. */
const STYLE_MEMBERS = new Set(["$media", "style"]);

/** Read the `project` node: the file's kind, and the project's name. */
function readProjectNode(reader: Reader, node: Node, config: JsonObject): void {
  if (annotationOf(reader, node) !== null) {
    throw failure(reader, node, `"project" names the file's kind, and takes no annotation`);
  }
  const values = positionals(reader, node);
  if (values.length > 1 || properties(node).length > 0 || childrenOf(node).length > 0) {
    throw failure(reader, node, `"project" holds one value, the project's name, and nothing else`);
  }
  if (values[0] !== undefined) {
    setKey(config, "name", values[0], reader, node);
    mark(reader, "/name", node);
  }
}

/** Read one top-level member. */
function readMember(reader: Reader, node: Node, config: JsonObject): void {
  const name = node.getName();
  const pointer = `/${token(name)}`;
  const isPlain = node.getTag() === null;
  let value: JsonValue;
  if (name === "$head" && isPlain) {
    value = readHead(reader, node);
    mark(reader, pointer, node);
  } else if (STYLE_MEMBERS.has(name) && isPlain) {
    value = readStyle(reader, node, pointer);
  } else {
    value = readValue(reader, node, pointer);
  }
  setKey(config, name, value, reader, node);
}

/** Read a whole project file. */
function readProject(reader: Reader): ProjectConfig {
  if (classifyJxn(reader.text) === "document") {
    throw new JxnError(
      `A project file declares itself: its first node, after any $ metadata, is project "<name>"`,
    );
  }
  const source = parseSource(reader.text);
  const config: JsonObject = {};
  let declared = false;
  for (const node of source.nodes) {
    const name = node.getName();
    if (name === PROJECT_NODE) {
      if (declared) {
        throw failure(reader, node, `"project" is written twice, and a file declares one project`);
      }
      readProjectNode(reader, node, config);
      declared = true;
    } else {
      // `classifyJxn` has already said that nothing but `$` metadata comes before the declaration.
      readMember(reader, node, config);
    }
  }
  /* SAFETY: every ProjectConfig member is optional, so any object is a structurally admissible
     config; member-level checking is `validateProject`'s job, as it is for `project.json`. */
  return normalizeObject(config) as ProjectConfig;
}

/**
 * Read a `project.jxn` file.
 *
 * @param text The file.
 * @param path Its path, when an error should name it.
 * @returns The same `ProjectConfig` its `project.json` spelling reads to.
 * @throws {JxnError} When it is not one, naming the line and column where it can.
 */
export function parseProject(text: string, path?: string): ProjectConfig {
  try {
    return readProject({ spans: null, text });
  } catch (error) {
    throw path !== undefined && error instanceof JxnError ? error.inFile(path) : error;
  }
}

/**
 * Read a `project.jxn` file, and where in the file each part of it came from.
 *
 * @param text The file.
 * @throws {JxnError} When it is not one.
 */
export function parseProjectWithSpans(text: string) {
  const spans = new Map<string, JxnSpan>();
  return { config: readProject({ spans, text }), spans };
}

/**
 * Style rows, one declaration per line, because `--="1280px"` on the node's own line reads badly
 * and a project's tokens are what people scan.
 */
function writeStyleRows(key: string, style: JsonValue, indent: string, where: string): string[] {
  if (!isJsonObject(style) || isRef(style)) {
    throw new JxnError(`${where} is a set of declarations, and this is not one`);
  }
  const entries = Object.entries(style);
  const head = indent + writeName(key, where);
  if (entries.length === 0) {
    return [`${head} {}`];
  }
  const inner = indent + INDENT;
  const rows = entries.flatMap(([entry, value]) => {
    const at = down(where, entry);
    const spelled = scalar(value, inner, at);
    if (spelled !== null) {
      return [`${inner}${writeName(entry, at)} ${spelled}`];
    }
    return isJsonObject(value)
      ? writeStyleRows(entry, value, inner, at)
      : // A list, such as the several `@font-face` a stylesheet can hold, is the one other thing.
        writeValue(entry, value, inner, at);
  });
  return [`${head} {`, ...rows, `${indent}}`];
}

/** One top-level member, in its canonical form. */
function writeMember(key: string, value: JsonValue): string[] {
  const where = down("", key);
  if (key === "$head") {
    return Array.isArray(value)
      ? writeHeadBlock(value, INDENT)
      : // Not a list, so not rows. The annotation is what stops it being read as them.
        [`(object)${writeValue(key, value, "", where).join("\n")}`];
  }
  return STYLE_MEMBERS.has(key)
    ? writeStyleRows(key, value, "", where)
    : writeValue(key, value, "", where);
}

/** A project file in its canonical form. */
function writeCanonical(config: ProjectConfig): string {
  if (!isJsonObject(config)) {
    throw new JxnError("A project's configuration is an object");
  }
  const source: JsonObject = config;
  const header = ["/- kdl-version 2"];
  const sections: string[][] = [];
  const name = scalar(source.name, "", "/name");
  for (const [key, value] of Object.entries(source)) {
    if (key === "name" && name !== null) {
      continue;
    }
    const isRows = key === "$head" || STYLE_MEMBERS.has(key);
    const spelled = key.startsWith("$") && !isRows ? scalar(value, "", down("", key)) : null;
    // Short metadata such as `$schema` stays above the declaration, where a document has it.
    if (spelled === null || spelled.includes("\n")) {
      sections.push(writeMember(key, value));
    } else {
      header.push(`${writeName(key, down("", key))} ${spelled}`);
    }
  }
  header.push(name === null ? PROJECT_NODE : `${PROJECT_NODE} ${name}`);
  return `${[header, ...sections].map((lines) => lines.join("\n")).join("\n\n")}\n`;
}

/** Read a file the way {@link reconcileJxn} wants to be told about it. */
function readForReconcile(text: string): JxnReading {
  const { config, spans } = parseProjectWithSpans(text);
  return { document: isJsonObject(config) ? config : null, spans };
}

/**
 * Write a project's configuration as a `project.jxn` file.
 *
 * @param config The configuration.
 * @param previous The file it is replacing. Everything that still means the same keeps its exact
 *   text, comments and blank lines included. Without one, the whole file is canonical.
 * @throws {JxnError} When it holds what Jx Notation cannot spell, naming the JSON Pointer.
 */
export function serializeProject(config: ProjectConfig, previous?: string): string {
  const canonical = writeCanonical(config);
  return previous === undefined ? canonical : reconcileJxn(previous, canonical, readForReconcile);
}
