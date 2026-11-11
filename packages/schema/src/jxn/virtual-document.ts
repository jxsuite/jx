/**
 * The TypeScript a checker reads for a whole `.jxn` document (`spec.md` §23.3).
 *
 * A document is not TypeScript, and most of what a checker should read in one is: its script, and
 * the body of each function. This writes that as modules, and says for each stretch of them where
 * in the file it was written, so a checker's errors, and an editor's hover and rename, land on the
 * author's own text.
 *
 * - **The main module** is the document's client script as written, followed by `State`: what the
 *   document's `state` proves, exported so that a `.ts` file importing the document can name it. An
 *   `(export)` entry has the type of the export it names, so a wrong name is an error at the entry
 *   and renaming the function renames the entry.
 * - **The server module** is the server script, followed by what it adds to `State`: each `(server)`
 *   entry is what its function resolves to, or `null` before it has answered.
 * - **One module for each body**: the function a string `body` is the inside of, with `State` and the
 *   names the runtime binds (`spec.md` §5.3 4d). A body does not see what the script declares
 *   (§23.2), which is why it is not written into the main module.
 *
 * It is pure: text in, text and spans out, with no compiler, DOM or Node. A mapper for `tsc` is one
 * reader of it and an editor inside Studio can be another, and neither can disagree with the other
 * about what a document's types are.
 *
 * @docs framework/concepts/type-checking
 */
import { CLIENT_SCRIPT_REF, SERVER_SCRIPT_REF } from "../document-scripts";
import { classifyFunctionEntries } from "../function-role";
import type { FunctionRole } from "../function-role";
import { isFunctionDef, isJsonObject, isServerFnDef, isString, paramNames } from "../guards";
import type { JsonObject, JsonValue, JxElement } from "../../types";
import { classifyJxn } from "./classify.ts";
import { JxnError } from "./errors.ts";
import type { JxnSpan } from "./errors.ts";
import { parseJxnWithTokens, token } from "./parse.ts";
import type { JxnTokens } from "./parse.ts";
import {
  IDENTIFIER,
  parametersOf,
  propertyName,
  stateIndex,
  stateOf,
  typeOfEntry,
} from "./state-types";
import { stringPieces } from "./string-pieces.ts";
import type { OutsideState } from "./state-types";
import type { StringPiece } from "./string-pieces.ts";

export type { OutsideState } from "./state-types";

/** A stretch of a written module, and the stretch of the file it stands for. */
export interface VirtualSpan {
  /**
   * `verbatim` when the two are the same text, so a position inside one is the same position inside
   * the other. `atom` when they are not (an escape, a quoted name), so the stretch maps as a
   * whole.
   */
  kind: "atom" | "verbatim";
  originalLength: number;
  originalStart: number;
  virtualLength: number;
  virtualStart: number;
}

/** One module a checker reads. Offsets count UTF-16 code units, as a JavaScript string does. */
export interface VirtualUnit {
  /** In the order written, which is ascending in the module. */
  spans: VirtualSpan[];
  text: string;
}

/** Something wrong with the file itself, which no module can be written around. */
export interface VirtualProblem {
  length: number;
  message: string;
  offset: number;
}

/** What a checker reads for one `.jxn` file. */
export interface VirtualDocument {
  /** The module the file is to anything that imports it. */
  main: VirtualUnit;
  problems: VirtualProblem[];
  /** Modules beside it, which may import from the main one and are imported by nothing. */
  supplemental: VirtualUnit[];
}

/** What a reader knows that the file does not say. */
export interface VirtualDocumentOptions {
  /** What the document's project gives it, which makes `State` open. */
  outside?: OutsideState;
  /** How a module beside the file imports it: `./` and the file's name, extension included. */
  specifier: string;
}

/** What a file that is not a document is to a checker: a module with nothing in it. */
const EMPTY_MODULE = "export {};\n";

/** The name `State` takes when the script has a `State` of its own. */
const FALLBACK_STATE = "JxState";

/** A script that declares or imports a `State`, which ours would collide or merge with. */
const DECLARES_STATE =
  /\b(?:interface|type|class|enum|namespace|const|let|var|function)\s+State\b|\bimport\b[^;]*\bState\b/u;

/** Members of a document that hold no element and no handler. */
const NOT_WALKED: ReadonlySet<string> = new Set(["$defs", "$script", "state", "style"]);

/** One module being written. */
class Writer {
  readonly source: string;
  readonly spans: VirtualSpan[] = [];
  text = "";

  /** @param source The file every span points into. */
  constructor(source: string) {
    this.source = source;
  }

  /** Text the author did not write. */
  add(text: string): this {
    this.text += text;
    return this;
  }

  /** Text that stands for `start` to `end` of the file. */
  mapped(text: string, start: number, end: number, kind: VirtualSpan["kind"]): this {
    this.spans.push({
      kind,
      originalLength: end - start,
      originalStart: start,
      virtualLength: text.length,
      virtualStart: this.text.length,
    });
    return this.add(text);
  }

  /** A string's value, each run of it beside where it was written. */
  pieces(pieces: readonly StringPiece[]): this {
    for (const piece of pieces) {
      this.mapped(piece.text, piece.start, piece.end, piece.verbatim ? "verbatim" : "atom");
    }
    return this;
  }

  /**
   * A string's value, mapped when the file says where it is.
   *
   * @param value The value.
   * @param span Its token, when the read recorded one.
   */
  value(value: string, span: JxnSpan | undefined): this {
    return span ? this.pieces(stringPieces(this.source, span, value)) : this.add(value);
  }

  /**
   * A name. Where the file spells it exactly, the two are one name to an editor, so renaming either
   * renames both. Where it does not (a name in quotes that TypeScript writes differently), the name
   * stands for its token as a whole.
   *
   * @param name The name as the document holds it.
   * @param span Its token, when the read recorded one.
   * @param written The name as TypeScript writes it here.
   */
  name(name: string, span: JxnSpan | undefined, written = name): this {
    if (!span) {
      return this.add(written);
    }
    const [piece, ...rest] = stringPieces(this.source, span, name);
    return piece?.verbatim && rest.length === 0 && written === name
      ? this.mapped(name, piece.start, piece.end, "verbatim")
      : this.mapped(written, span.start, span.end, "atom");
  }

  /** The module, ended. */
  unit(): VirtualUnit {
    return { spans: this.spans, text: this.text };
  }
}

/** One read of a file, and what was asked about it. */
interface Reading {
  /** The document, as the JSON data it is. */
  doc: JsonObject;
  /** The index signature that closes every `State` of this document. */
  index: string;
  source: string;
  specifier: string;
  /** What `State` is called in the main module. */
  stateName: string;
  tokens: JxnTokens;
}

/** An element whose `state` a body can read, and where it is. */
interface Scope {
  node: JsonObject;
  pointer: string;
}

/** A string body, and the scopes it reads: the root first, then each element on the way down. */
interface Body {
  chain: readonly Scope[];
  definition: JsonObject;
  pointer: string;
  text: string;
}

/** The export a `state` entry names in one of the document's own modules, or null. */
function exportOf(entry: JsonValue | undefined, key: string, ref: string): string | null {
  if (!isJsonObject(entry) || entry.$src !== ref) {
    return null;
  }
  const serves = ref === SERVER_SCRIPT_REF ? isServerFnDef(entry) : isFunctionDef(entry);
  const name = isString(entry.$export) ? entry.$export : key;
  // An export named by a string literal is legal and rare, and is left to the entry's own shape.
  return serves && IDENTIFIER.test(name) ? name : null;
}

/** The token an entry's export was written as: its `$export` when it has one, or its own name. */
function exportToken(reading: Reading, pointer: string): JxnSpan | undefined {
  return reading.tokens.values.get(`${pointer}/$export`) ?? reading.tokens.names.get(pointer);
}

/** Whether the document has a module of its own on one side. */
function hasScript(doc: JsonObject, side: "client" | "server"): boolean {
  return isJsonObject(doc.$script) && isString(doc.$script[side]);
}

/** Write the type of an entry that names an export of the client script. */
function writeClientExport(
  out: Writer,
  reading: Reading,
  pointer: string,
  entry: JsonObject,
  name: string,
  role: FunctionRole | undefined,
): void {
  const open = `typeof import(${JSON.stringify(reading.specifier)}).`;
  const span = exportToken(reading, pointer);
  /* Each form names the export once, so one token carries it, and none constrains it: a constraint
     that fails is reported on text the author did not write. */
  if (role === "computed") {
    out.add(`(${open}`).name(name, span).add(") extends (...args: any[]) => infer R ? R : any");
  } else if (entry.$lazy === true) {
    // A lazy entry imports on its first call, so what it returns is a promise (§5.3 4d).
    out
      .add(`(${open}`)
      .name(name, span)
      .add(") extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : any");
  } else {
    out.add(open).name(name, span);
  }
}

/** Write the main module: the client script, then `State`. */
function writeMain(reading: Reading): VirtualUnit {
  const { doc, tokens } = reading;
  const out = new Writer(reading.source);
  const client = isJsonObject(doc.$script) ? doc.$script.client : undefined;
  if (isString(client)) {
    out.value(client, tokens.values.get("/$script/client"));
    out.add(client.endsWith("\n") ? "" : "\n");
  }
  // SAFETY: a document is an element with `$` members beside it, which the classifier ignores.
  const roles = classifyFunctionEntries(doc as JxElement);
  const served = hasScript(doc, "server");
  out.add(`export interface ${reading.stateName} {\n`);
  for (const [key, entry] of Object.entries(stateOf(doc) ?? {})) {
    const pointer = `/state/${token(key)}`;
    if (served && exportOf(entry, key, SERVER_SCRIPT_REF) !== null) {
      // The server module says what this is, because only it can see the function.
      continue;
    }
    out.add("  ").name(key, tokens.names.get(pointer), propertyName(key)).add(": ");
    const exported = exportOf(entry, key, CLIENT_SCRIPT_REF);
    if (exported !== null && isJsonObject(entry)) {
      writeClientExport(out, reading, pointer, entry, exported, roles.get(key));
    } else {
      out.add(typeOfEntry(entry, roles.get(key)));
    }
    out.add(";\n");
  }
  return out.add(`  ${reading.index}\n}\n`).unit();
}

/** Write the server module: the server script, then what its functions add to `State`. */
function writeServer(reading: Reading, script: string): VirtualUnit {
  const { doc, tokens } = reading;
  const out = new Writer(reading.source);
  out.value(script, tokens.values.get("/$script/server"));
  out.add(script.endsWith("\n") ? "" : "\n");
  out.add(`declare module ${JSON.stringify(reading.specifier)} {\n`);
  out.add(`  interface ${reading.stateName} {\n`);
  for (const [key, entry] of Object.entries(stateOf(doc) ?? {})) {
    const name = exportOf(entry, key, SERVER_SCRIPT_REF);
    if (name !== null) {
      const pointer = `/state/${token(key)}`;
      out.add("    ").name(key, tokens.names.get(pointer), propertyName(key));
      out.add(": typeof ").name(name, exportToken(reading, pointer));
      out.add(" extends (...args: any[]) => infer R ? Awaited<R> | null : any;\n");
    }
  }
  // A module with no import and no export is a script, and a script cannot augment a module.
  return out.add("  }\n}\nexport {};\n").unit();
}

/** Whether a value is a function written as a string body, which is what a body module holds. */
function isStringBody(value: JsonValue | undefined): value is JsonObject & { body: string } {
  return isFunctionDef(value) && isString(value.body) && value.$src === undefined;
}

/** Find every string body under a value, with the scopes each one reads. */
function findBodies(
  value: JsonValue | undefined,
  pointer: string,
  chain: readonly Scope[],
  found: Body[],
): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      findBodies(item, `${pointer}/${index}`, chain, found);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  const state = stateOf(value);
  // The root is a scope whether or not it has state, so every chain starts with it.
  const scopes = state && pointer !== "" ? [...chain, { node: value, pointer }] : chain;
  for (const [key, entry] of Object.entries(state ?? {})) {
    if (isStringBody(entry)) {
      const at = `${pointer}/state/${token(key)}`;
      found.push({ chain: scopes, definition: entry, pointer: at, text: entry.body });
    }
  }
  for (const [key, child] of Object.entries(value)) {
    if (NOT_WALKED.has(key)) {
      continue;
    }
    const at = `${pointer}/${token(key)}`;
    if (key.startsWith("on") && isStringBody(child)) {
      found.push({ chain: scopes, definition: child, pointer: at, text: child.body });
    } else {
      findBodies(child, at, scopes, found);
    }
  }
}

/**
 * Write the `State` a body inside a nested scope reads: the root's, under each nested element's
 * own.
 *
 * It extends the root's, so a root member is the same member here and renaming it in one place
 * renames it in both. An interface cannot extend one it disagrees with, so where a nested element
 * declares a name the root also has, the root's other members are listed by reference instead.
 */
function writeNestedState(out: Writer, reading: Reading, chain: readonly Scope[]): void {
  const [root, ...nested] = chain;
  const inherited = Object.keys(stateOf(root?.node) ?? {});
  const members = new Map<string, string>();
  let shadows = false;
  for (const scope of nested) {
    // SAFETY: a scope is an element that carries state.
    const roles = classifyFunctionEntries(scope.node as JxElement);
    for (const [key, entry] of Object.entries(stateOf(scope.node) ?? {})) {
      members.set(propertyName(key), typeOfEntry(entry, roles.get(key)));
      shadows ||= inherited.includes(key);
    }
  }
  const specifier = JSON.stringify(reading.specifier);
  out.add(`import type { ${reading.stateName} as Root } from ${specifier};\n`);
  out.add(shadows ? "interface State {\n" : "interface State extends Root {\n");
  if (shadows) {
    for (const key of inherited.filter((name) => !members.has(propertyName(name)))) {
      out.add(`  ${propertyName(key)}: Root[${JSON.stringify(key)}];\n`);
    }
  }
  for (const [name, type] of members) {
    out.add(`  ${name}: ${type};\n`);
  }
  out.add(shadows ? `  ${reading.index}\n}\n` : "}\n");
}

/** Write the module for one body: the function it is the inside of. */
function writeBody(reading: Reading, body: Body): VirtualUnit {
  const { tokens } = reading;
  const out = new Writer(reading.source);
  if (body.chain.length > 1) {
    writeNestedState(out, reading, body.chain);
  } else {
    const imported = reading.stateName === "State" ? "State" : `${reading.stateName} as State`;
    out.add(`import type { ${imported} } from ${JSON.stringify(reading.specifier)};\n`);
  }
  /* The event a handler receives is bound to a name only when the entry declares one, though the
     runtime passes it and `window.event` holds it. Not declaring it would call a working handler
     an error, so it is `any` wherever it is not a parameter. */
  out.add("declare const event: any;\n");
  out.add("export async function body(this: any");
  const params = parametersOf(body.definition);
  const written = Array.isArray(body.definition.parameters)
    ? // SAFETY: `parameters` holds bare names or CEM parameter objects, the form `paramNames` reads.
      paramNames(body.definition.parameters as Parameters<typeof paramNames>[0])
    : [];
  /* `state` is first whether or not the entry names it, and wherever it names it, so a name is not
     where it was written. The others keep their order, which finds each one's token. */
  let next = 0;
  for (const [index, name] of params.entries()) {
    const at = index === 0 ? written.indexOf("state") : written.indexOf(name, next);
    next = index > 0 && at !== -1 ? at + 1 : next;
    const span = tokens.values.get(`${body.pointer}/parameters/${at}`);
    out
      .add(", ")
      .name(name, span)
      .add(index === 0 ? ": State" : ": any");
  }
  /* A project that reports unused parameters would report these on a line the author did not
     write, for every body that does not happen to read one. */
  const named = params.filter((name) => IDENTIFIER.test(name));
  out.add(`) {\nvoid [${named.join(", ")}];\n`);
  out.value(body.text, tokens.values.get(`${body.pointer}/body`));
  return out.add("\n}\n").unit();
}

/** A file no module can be written around. */
function unreadable(problems: VirtualProblem[]): VirtualDocument {
  return { main: { spans: [], text: EMPTY_MODULE }, problems, supplemental: [] };
}

/**
 * Write the modules a checker reads for one `.jxn` file.
 *
 * @param source The file.
 * @param options What its reader knows about where it stands.
 * @returns The modules. A project file is an empty one, because it holds no code, and so is a file
 *   that is not Jx Notation, which is the one problem reported for it.
 */
export function generateVirtualDocument(
  source: string,
  options: VirtualDocumentOptions,
): VirtualDocument {
  if (classifyJxn(source) === "project") {
    return unreadable([]);
  }
  let read: ReturnType<typeof parseJxnWithTokens>;
  try {
    read = parseJxnWithTokens(source);
  } catch (error) {
    const problem = error instanceof JxnError ? error : new JxnError(String(error));
    const offset = Math.min(problem.offset ?? 0, source.length);
    return unreadable([
      { length: Math.min(1, source.length - offset), message: problem.reason, offset },
    ]);
  }
  // SAFETY: a document is JSON data; its types name what it holds.
  const doc = read.document as JsonObject;
  const scripts = isJsonObject(doc.$script) ? doc.$script : {};
  const reading: Reading = {
    doc,
    // SAFETY: a document is an element with `$` members beside it, and only `$layout` is read.
    index: stateIndex(doc as JxElement, options.outside),
    source,
    specifier: options.specifier,
    stateName:
      isString(scripts.client) && DECLARES_STATE.test(scripts.client) ? FALLBACK_STATE : "State",
    tokens: read.tokens,
  };
  const supplemental: VirtualUnit[] = [];
  if (isString(scripts.server)) {
    supplemental.push(writeServer(reading, scripts.server));
  }
  const bodies: Body[] = [];
  findBodies(doc, "", [{ node: doc, pointer: "" }], bodies);
  for (const body of bodies) {
    supplemental.push(writeBody(reading, body));
  }
  return { main: writeMain(reading), problems: [], supplemental };
}
