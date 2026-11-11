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
 *   and renaming the function renames the entry. After it comes one interface for each element
 *   below the root that has `state` of its own, and one for each map a body is drawn in, so that
 *   every name a body reads is declared once, in one module, at the place its author wrote it.
 * - **The server module** is the server script, followed by what it adds to those interfaces: each
 *   `(server)` entry is what its function resolves to, or `null` before it has answered.
 * - **One module for each body**: the function a string `body` is the inside of, with the `State` of
 *   where it stands, the event its handler is given, and the names the runtime binds (`spec.md`
 *   §5.3 4d). A body does not see what the script declares (§23.2), which is why it is not written
 *   into the main module.
 * - **One module for each template**: the function a `${}` string is the value of, given the names
 *   the runtime gives one. It is JavaScript and not TypeScript, because that is what the runtime
 *   compiles it as, so a type written inside one is an error here as it is a blank on the page.
 * - **One module for every `$ref`** into `state` or the row of a map: each path read off the `State`
 *   of where it stands, so a name that is not there is an error at the name, and renaming an entry
 *   renames what refers to it. An `on*` member's is checked as the handler it binds.
 * - **What a component is given** is checked in that module too. The main module ends with
 *   `$elements`: the tag the document defines, and its `State`. Each value an instance passes as
 *   `$props` is held against the `State` of the component its tag names, which is found among the
 *   document itself, the `.jxn` files its `$elements` names and the components its project keeps. A
 *   prop the component does not declare is an error at its name, a value of the wrong type is one
 *   at the value, and renaming a component's entry renames the prop.
 *
 * It is pure: text in, text and spans out, with no compiler, DOM or Node. A mapper for `tsc` is one
 * reader of it and an editor inside Studio can be another, and neither can disagree with the other
 * about what a document's types are.
 *
 * @docs framework/concepts/type-checking
 */
import { CLIENT_SCRIPT_REF, SERVER_SCRIPT_REF } from "../document-scripts";
import type { FunctionRole } from "../function-role";
import {
  isBoolean,
  isFunctionDef,
  isJsonObject,
  isNumber,
  isRef,
  isServerFnDef,
  isString,
  paramNames,
} from "../guards";
import type { JsonObject, JsonValue, JxElement } from "../../types";
import { classifyJxn } from "./classify.ts";
import { JxnError } from "./errors.ts";
import type { JxnSpan } from "./errors.ts";
import { parseJxnWithTokens, token } from "./parse.ts";
import type { JxnTokens } from "./parse.ts";
import {
  boundEvents,
  eachSite,
  EVENT_GLOBALS,
  eventLines,
  eventType,
  expressionsAt,
  itemType,
  membersOf,
  readsRow,
} from "./document-scopes";
import type { RefSite, Row, Site, StateScope } from "./document-scopes";
import {
  DEFINITIONS,
  definitionParts,
  definitionsOf,
  IDENTIFIER,
  propertyName,
} from "./schema-types";
import { entryParts, parametersOf, stateIndex, stateOf } from "./state-types";
import { stringPieces } from "./string-pieces.ts";
import type { TypePart } from "./schema-types";
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
  /** What the module is written in. A template is JavaScript, as the runtime compiles it. */
  extension: ".js" | ".ts";
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

/** What a file that is not a document is to a checker: a module that defines no element. */
const EMPTY_MODULE = "export interface $elements {}\n";

/** The name `State` takes when the script has a `State` of its own. */
const FALLBACK_STATE = "JxState";

/** A script that declares or imports a `State`, which ours would collide or merge with. */
const DECLARES_STATE =
  /\b(?:interface|type|class|enum|namespace|const|let|var|function)\s+State\b|\bimport\b[^;]*\bState\b/u;

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

  /**
   * Text that stands for a whole token, when the file says where it is.
   *
   * @param text What the module says.
   * @param span The token, when the read recorded one.
   */
  whole(text: string, span: JxnSpan | undefined): this {
    return span ? this.mapped(text, span.start, span.end, "atom") : this.add(text);
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

  /**
   * Part of a string's value, written as itself or as something that stands for it.
   *
   * @param written What the module says.
   * @param span The string's token, which the part stands for whole when no piece of it does.
   * @param pieces The string's pieces.
   * @param from Where the part starts in the value.
   * @param to One past where it ends.
   */
  part(
    written: string,
    span: JxnSpan,
    pieces: readonly StringPiece[],
    from: number,
    to: number,
  ): this {
    let { end, start } = span;
    let met = false;
    let offset = 0;
    for (const piece of pieces) {
      const next = offset + piece.text.length;
      if (next > from && offset < to) {
        // A piece that is not the source character for character is indivisible.
        const first = piece.verbatim ? piece.start + Math.max(0, from - offset) : piece.start;
        start = met ? start : first;
        end = piece.verbatim ? piece.start + Math.min(piece.text.length, to - offset) : piece.end;
        met = true;
      }
      offset = next;
    }
    const kind = this.source.slice(start, end) === written ? "verbatim" : "atom";
    return this.mapped(written, start, end, kind);
  }

  /** The module, ended. */
  unit(extension: VirtualUnit["extension"] = ".ts"): VirtualUnit {
    return { extension, spans: this.spans, text: this.text };
  }
}

/** One read of a file, and what was asked about it. */
interface Reading {
  /** The document, as the JSON data it is. */
  doc: JsonObject;
  /** The definitions it holds, when it has `$defs`. */
  defs: JsonObject | null;
  /** The file each component of the document's project is, by its tag. */
  components: Readonly<Record<string, string>>;
  /** The index signature that closes every `State` of this document. */
  index: string;
  source: string;
  specifier: string;
  /** What `State` is called in the main module. */
  stateName: string;
  tokens: JxnTokens;
}

/** The `State` of a body inside a map: its scope's, and the row it is drawn for. */
interface RowView {
  name: string;
  row: Row;
  scope: StateScope;
}

/** A string body, and what the main module says of where it stands. */
interface Body {
  definition: JsonObject;
  /** The type of the event it is given. */
  event: string;
  pointer: string;
  /** The interface its `state` is, by the name the main module exports it under. */
  state: string;
  text: string;
}

/** A `${}` string, and what the main module says of where it stands. */
interface Template {
  /** Its token. */
  span: JxnSpan;
  /** The interface its `state` is, by the name the main module exports it under. */
  state: string;
  text: string;
}

/** A `$ref` into `state` or a row, and what the main module says of where it stands. */
interface Reference extends RefSite {
  /** The token of the string it is written as. */
  span: JxnSpan;
  /** The interface it reads, by the name the main module exports it under. */
  state: string;
}

/** One value an element with a component's tag passes as `$props`. */
interface Prop {
  key: string;
  /** Where the value is. */
  pointer: string;
  tag: string;
  value: JsonValue | undefined;
}

/** A `.jxn` file a document's `$elements` names. */
interface DeclaredElement {
  /** The token of the string it is written as. */
  span: JxnSpan | undefined;
  specifier: string;
}

/** What a document's elements declare, in the order the main module writes it. */
interface Layout {
  bodies: Body[];
  /** What each scope's interface is called. The root's is `State`. */
  names: Map<StateScope, string>;
  props: Prop[];
  refs: Reference[];
  templates: Template[];
  views: RowView[];
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

/**
 * Write a type, each name in it beside where the document wrote it. The definition a `$ref` ends in
 * is the end of that reference's string, so renaming a definition rewrites every reference to it.
 */
function writeParts(out: Writer, reading: Reading, parts: readonly TypePart[]): void {
  const { tokens } = reading;
  for (const part of parts) {
    if (isString(part)) {
      out.add(part);
    } else if (part.kind === "member") {
      out.name(part.name, tokens.names.get(part.pointer), part.written);
    } else {
      // Written `(ref)"…"` the string is the member's own value, and in a block it is its `$ref`.
      const span = tokens.values.get(part.pointer) ?? tokens.values.get(`${part.pointer}/$ref`);
      const ref = `#/${DEFINITIONS}/${part.name}`;
      if (span) {
        const from = ref.length - part.name.length;
        out.part(part.written, span, stringPieces(out.source, span, ref), from, ref.length);
      } else {
        out.add(part.written);
      }
    }
  }
}

/** Write one scope's interface: the root's `State`, or a nested element's under the one around it. */
function writeScope(out: Writer, reading: Reading, layout: Layout, scope: StateScope): void {
  const { tokens } = reading;
  const { inherited, own } = membersOf(scope);
  const around = scope.parent ? layout.names.get(scope.parent) : undefined;
  /* It extends the one around it, so a member declared there is the same member here and renaming
     it in one place renames it in both. Where it cannot (see `membersOf`), it is closed itself. */
  const closed = around === undefined || inherited !== null;
  out.add(`export interface ${layout.names.get(scope)}${closed ? "" : ` extends ${around}`} {\n`);
  for (const key of inherited ?? []) {
    out.add(`  ${propertyName(key)}: ${around}[${JSON.stringify(key)}];\n`);
  }
  const served = hasScript(reading.doc, "server");
  for (const { entry, key, role } of own) {
    const pointer = `${scope.pointer}/state/${token(key)}`;
    if (served && exportOf(entry, key, SERVER_SCRIPT_REF) !== null) {
      // The server module says what this is, because only it can see the function.
      continue;
    }
    out.add("  ").name(key, tokens.names.get(pointer), propertyName(key)).add(": ");
    const exported = exportOf(entry, key, CLIENT_SCRIPT_REF);
    if (exported !== null && isJsonObject(entry)) {
      writeClientExport(out, reading, pointer, entry, exported, role);
    } else {
      writeParts(out, reading, entryParts(entry, role, { defs: reading.defs !== null, pointer }));
    }
    out.add(";\n");
  }
  out.add(closed ? `  ${reading.index}\n}\n` : "}\n");
}

/** Write the main module: the client script, then `State` and each interface under it. */
function writeMain(reading: Reading, layout: Layout): VirtualUnit {
  const { doc, tokens } = reading;
  const out = new Writer(reading.source);
  const client = isJsonObject(doc.$script) ? doc.$script.client : undefined;
  if (isString(client)) {
    out.value(client, tokens.values.get("/$script/client"));
    out.add(client.endsWith("\n") ? "" : "\n");
  }
  for (const scope of layout.names.keys()) {
    writeScope(out, reading, layout, scope);
  }
  const nameOf = (scope: StateScope): string => layout.names.get(scope) ?? "any";
  for (const view of layout.views) {
    out.add(`export interface ${view.name} extends ${nameOf(view.scope)} {\n`);
    out.add(`  $map: { item: ${itemType(view.row, nameOf)}; index: number };\n}\n`);
  }
  if (reading.defs) {
    writeParts(out, reading, definitionParts(reading.defs, true));
    out.add("\n");
  }
  /* Every document says which element it defines, a page that defines none included, so that a
     document naming this one among its `$elements` can always ask. */
  const tag = doc.tagName;
  const defined = isComponentTag(tag) ? ` ${JSON.stringify(tag)}: ${reading.stateName} ` : "";
  return out.add(`export interface $elements {${defined}}\n`).unit();
}

/** Write the server module: the server script, then what its functions add to each interface. */
function writeServer(reading: Reading, layout: Layout, script: string): VirtualUnit {
  const { tokens } = reading;
  const out = new Writer(reading.source);
  out.value(script, tokens.values.get("/$script/server"));
  out.add(script.endsWith("\n") ? "" : "\n");
  out.add(`declare module ${JSON.stringify(reading.specifier)} {\n`);
  for (const [scope, name] of layout.names) {
    const served = Object.entries(stateOf(scope.node) ?? {}).flatMap(([key, entry]) => {
      const exported = exportOf(entry, key, SERVER_SCRIPT_REF);
      return exported === null ? [] : [{ exported, key }];
    });
    // The root's is written whatever it holds, so the module always says what it is for.
    if (served.length === 0 && scope.parent) {
      continue;
    }
    out.add(`  interface ${name} {\n`);
    for (const { exported, key } of served) {
      const pointer = `${scope.pointer}/state/${token(key)}`;
      out.add("    ").name(key, tokens.names.get(pointer), propertyName(key));
      out.add(": typeof ").name(exported, exportToken(reading, pointer));
      out.add(" extends (...args: any[]) => infer R ? Awaited<R> | null : any;\n");
    }
    out.add("  }\n");
  }
  // A module with no import and no export is a script, and a script cannot augment a module.
  return out.add("}\nexport {};\n").unit();
}

/** Whether a tag is one a component can be registered under, which a name with a hyphen is. */
function isComponentTag(tag: JsonValue | undefined): tag is string {
  return isString(tag) && tag.includes("-") && !tag.includes("${");
}

/** Whether a value is a function written as a string body, which is what a body module holds. */
function isStringBody(value: JsonValue | undefined): value is JsonObject & { body: string } {
  return isFunctionDef(value) && isString(value.body) && value.$src === undefined;
}

/** Read what a document's elements declare: its scopes, the rows its bodies read, and its bodies. */
function layoutOf(reading: Reading): Layout {
  const { doc, stateName } = reading;
  const layout: Layout = {
    bodies: [],
    names: new Map(),
    props: [],
    refs: [],
    templates: [],
    views: [],
  };
  const { values } = reading.tokens;
  const bound = boundEvents(doc);
  let declared = 0;
  /** What a scope's interface is called, decided the first time it is met. */
  const scopeName = (scope: StateScope): string => {
    let name = layout.names.get(scope);
    if (name === undefined) {
      declared += scope.parent ? 1 : 0;
      name = scope.parent ? `${stateName}$${declared}` : stateName;
      layout.names.set(scope, name);
    }
    return name;
  };
  /** The interface a body at a site reads, declared the first time one does. */
  const stateAt = (site: Site): string => {
    const { row, scope } = site;
    if (!row || !readsRow(scope)) {
      return scopeName(scope);
    }
    let view = layout.views.find((made) => made.row === row && made.scope === scope);
    if (!view) {
      declared += 1;
      view = { name: `${stateName}$${declared}`, row, scope };
      layout.views.push(view);
    }
    return view.name;
  };
  eachSite(doc, (node, pointer, site) => {
    // Each scope is met first at its own element, so the root is first and a parent before a child.
    scopeName(site.scope);
    for (const [key, entry] of Object.entries(stateOf(node) ?? {})) {
      if (isStringBody(entry)) {
        const at = `${pointer}/state/${token(key)}`;
        layout.bodies.push({
          definition: entry,
          event: bound.get(at) ?? "any",
          pointer: at,
          state: stateAt(site),
          text: entry.body,
        });
      }
    }
    for (const [key, entry] of Object.entries(node)) {
      if (key.startsWith("on") && isStringBody(entry)) {
        layout.bodies.push({
          definition: entry,
          event: eventType(node, key, site),
          pointer: `${pointer}/${token(key)}`,
          state: stateAt(site),
          text: entry.body,
        });
      }
    }
    const { $props: given, tagName: tag } = node;
    if (isComponentTag(tag) && isJsonObject(given)) {
      for (const [key, value] of Object.entries(given)) {
        layout.props.push({ key, pointer: `${pointer}/$props/${token(key)}`, tag, value });
      }
    }
    /* One the file does not place is left out: an error in it would be shown at a place in a
       module nobody wrote, which is worse than not being told. */
    const said = expressionsAt(node, pointer, site);
    for (const template of said.templates) {
      const span = values.get(template.pointer);
      if (span) {
        layout.templates.push({ span, state: stateAt(site), text: template.text });
      }
    }
    for (const ref of said.refs) {
      // Written `(ref)name "…"` the string is the member's own, and in a block it is its `$ref`.
      const span = values.get(ref.pointer) ?? values.get(`${ref.pointer}/$ref`);
      if (span) {
        const row = ref.path[0]?.key === "$map";
        layout.refs.push({ ...ref, span, state: row ? stateAt(site) : scopeName(site.scope) });
      }
    }
  });
  return layout;
}

/** Write the module for one body: the function it is the inside of. */
function writeBody(reading: Reading, body: Body): VirtualUnit {
  const { tokens } = reading;
  const out = new Writer(reading.source);
  const imported = body.state === "State" ? "State" : `${body.state} as State`;
  out.add(`import type { ${imported} } from ${JSON.stringify(reading.specifier)};\n`);
  const params = parametersOf(body.definition);
  /* The event a handler receives is bound to a name only when the entry declares one, though the
     runtime passes it and `window.event` holds it. Not declaring it would call a working handler
     an error, so it is declared wherever it is not a parameter. */
  const event = eventLines(body.event, params);
  out.add(event.head);
  out.add("export async function body(this: any");
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
    // A handler is called with its state and the event, in that order (§5.3 4d).
    const type = index === 0 ? "State" : index === 1 ? event.parameter : "any";
    out.add(", ").name(name, span).add(`: ${type}`);
  }
  /* A project that reports unused parameters would report these on a line the author did not
     write, for every body that does not happen to read one. */
  const named = params.filter((name) => IDENTIFIER.test(name));
  out.add(`) {\nvoid [${named.join(", ")}];\n`);
  out.value(body.text, tokens.values.get(`${body.pointer}/body`));
  return out.add("\n}\n").unit();
}

/** What every template module says before the template: the names the runtime gives one. */
const TEMPLATE_HEAD = [
  "/**",
  " * @param {State} state",
  ' * @param {State["$map"]} $map',
  ' * @param {State["$map"] extends { item: infer I } ? I : any} item',
  ' * @param {State["$map"] extends { index: infer I } ? I : any} index',
  ' * @param {State["$site"]} $site',
  ' * @param {State["$page"]} $page',
  " */",
  "export function template(state, $map, item, index, $site, $page) {",
  // A template that does not read one of them is not an error.
  "void [state, $map, item, index, $site, $page];",
  "return ",
].join("\n");

/** Write the module for one template: the function it is the value of. */
function writeTemplate(reading: Reading, template: Template): VirtualUnit {
  const { span } = template;
  const out = new Writer(reading.source);
  const imported = template.state === "State" ? "State" : `${template.state} as State`;
  // Without this line a JavaScript module is not checked at all.
  out.add("// @ts-check\n");
  out.add(`/** @import { ${imported} } from ${JSON.stringify(reading.specifier)} */\n`);
  out.add(TEMPLATE_HEAD);
  /* The quotes stand for the backticks, so a template that does not end is reported on the string
     it is, and not at the end of a module nobody wrote. */
  out.mapped("`", span.start, span.start + 1, "atom");
  out.value(template.text, span);
  return out.mapped("`;\n}\n", span.end - 1, span.end, "atom").unit(".js");
}

/** What the references module declares when it checks a handler: what a binding calls one with. */
const BOUND = "declare function bound<E>(handler: (state: any, event: E) => unknown): void;\n";

/** Whether a reference is the handler of the `on*` member it is written at. */
function bindsHandler(ref: Reference): boolean {
  return ref.binding !== null && ref.prefix === "#/state/" && ref.path.length === 1;
}

/** Write what a reference reads: its path off the interface it stands in. */
function writePath(out: Writer, ref: Reference, receiver: string): void {
  const { span } = ref;
  const pieces = stringPieces(out.source, span, ref.ref);
  for (const [index, { end, key, start }] of ref.path.entries()) {
    const plain = IDENTIFIER.test(key);
    const member = plain ? key : `[${JSON.stringify(key)}]`;
    if (index > 0) {
      // A token that matches nothing reads as nothing (§7.1), so each step after the first asks.
      out.part("?.", span, pieces, start - 1, start).part(member, span, pieces, start, end);
    } else if (ref.prefix === "") {
      out.part(`${receiver}${plain ? "." : ""}${member}`, span, pieces, start, end);
    } else {
      out.part(`${receiver}${plain ? "." : ""}`, span, pieces, 0, ref.prefix.length);
      out.part(member, span, pieces, start, end);
    }
  }
}

/** Write one reference that is read for itself: a value, or the handler an `on*` member binds. */
function writeReference(out: Writer, ref: Reference, receiver: string): void {
  const { binding, site } = ref;
  const handler = binding !== null && bindsHandler(ref);
  out.add(handler ? `bound<${eventType(binding.element, binding.key, site)}>(` : "void ");
  writePath(out, ref, receiver);
  out.add(handler ? ");\n" : ";\n");
}

/** A path from one document to another beside or below a folder above it, as `$elements` writes one. */
const RELATIVE_NOTATION = /^\.{1,2}\/.*\.jxn$/u;

/** The `.jxn` files a document's `$elements` names. A package, or a `.json` file, says no types. */
function declaredElements(reading: Reading): DeclaredElement[] {
  const { doc, tokens } = reading;
  const entries = Array.isArray(doc.$elements) ? doc.$elements : [];
  return entries.flatMap((entry, index) => {
    if (!isRef(entry) || !RELATIVE_NOTATION.test(entry.$ref)) {
      return [];
    }
    // Written `(ref)"…"` the string is the item's own, and in a block it is its `$ref`.
    const at = `/$elements/${index}`;
    return [
      { span: tokens.values.get(at) ?? tokens.values.get(`${at}/$ref`), specifier: entry.$ref },
    ];
  });
}

/**
 * What the references module declares when a document passes props: what a tag may be given, which
 * is any of its component's `State`, or anything at all for a tag no document read here defines. A
 * prop may be empty, because a reference that finds nothing passes nothing (`spec.md` §7.1).
 */
const PROPS = [
  "type Props<S> = { [K in keyof S]?: S[K] | null | undefined };",
  "declare function props<T extends string>(",
  "  given: T extends keyof Elements ? Props<Elements[T]> : any,",
  "): void;",
  "declare const unchecked: any;",
  "",
].join("\n");

/**
 * Write which documents define the elements this one uses: itself, each `.jxn` file its `$elements`
 * names, and each component of its project that an instance names by its tag.
 */
function writeElements(
  out: Writer,
  reading: Reading,
  layout: Layout,
  declared: readonly DeclaredElement[],
): void {
  const from = new Map<string, JxnSpan | undefined>([[reading.specifier, undefined]]);
  for (const { span, specifier } of declared) {
    from.set(specifier, span);
  }
  for (const { tag } of layout.props) {
    const specifier = reading.components[tag];
    if (specifier !== undefined && !from.has(specifier)) {
      from.set(specifier, undefined);
    }
  }
  const names = [...from].map(([specifier, span], index) => {
    // A file that is not there is an error at the entry that names it.
    out.add(`import type { $elements as e${index} } from `);
    out.whole(JSON.stringify(specifier), span).add(";\n");
    return `e${index}`;
  });
  // Exported, so that a document which names components and gives them nothing leaves none unused.
  out.add(`export type Elements = ${names.join(" & ")};\n`);
}

/**
 * Write one prop: its name and its value, held against what the component its tag names takes.
 *
 * @param out The module.
 * @param reading The file.
 * @param prop The prop.
 * @param read Writes the path the prop's value reads, when it is a reference into `state`.
 */
function writeProp(out: Writer, reading: Reading, prop: Prop, read: (() => void) | null): void {
  const { key, pointer, value } = prop;
  const { tokens } = reading;
  out.add(`props<${JSON.stringify(prop.tag)}>({ `);
  out.name(key, tokens.names.get(pointer), propertyName(key)).add(": ");
  if (read) {
    read();
  } else if (isBoolean(value) || isNumber(value) || (isString(value) && !value.includes("${"))) {
    out.whole(JSON.stringify(value), tokens.values.get(pointer));
  } else {
    /* A template is checked as the function it is, and what it makes is not known here. Anything
       else (a list, an object, a reference to another document) is not held against a type. */
    out.add("unchecked");
  }
  out.add(" });\n");
}

/**
 * Write the module for a document's references and the props it passes, or nothing when it has
 * neither and names no component.
 */
function writeReferences(reading: Reading, layout: Layout): VirtualUnit[] {
  const { props, refs } = layout;
  const declared = declaredElements(reading);
  if (refs.length === 0 && props.length === 0 && declared.length === 0) {
    return [];
  }
  const out = new Writer(reading.source);
  const states = [...new Set(refs.map((ref) => ref.state))];
  if (states.length > 0) {
    out.add(`import type { ${states.join(", ")} } from ${JSON.stringify(reading.specifier)};\n`);
  }
  if (props.length > 0 || declared.length > 0) {
    writeElements(out, reading, layout, declared);
  }
  if (refs.some((ref) => bindsHandler(ref))) {
    out.add(EVENT_GLOBALS).add(BOUND);
  }
  out.add(props.length > 0 ? PROPS : "");
  for (const [index, state] of states.entries()) {
    out.add(`declare const s${index}: ${state};\n`);
  }
  const receiver = (ref: Reference): string => `s${states.indexOf(ref.state)}`;
  const given = new Set(props.map((prop) => prop.pointer));
  for (const ref of refs) {
    // One that is a prop is written as the prop's value, so that it is told of once.
    if (!given.has(ref.pointer)) {
      writeReference(out, ref, receiver(ref));
    }
  }
  for (const prop of props) {
    const ref = refs.find((made) => made.pointer === prop.pointer);
    writeProp(out, reading, prop, ref ? () => writePath(out, ref, receiver(ref)) : null);
  }
  return [out.unit()];
}

/** A file no module can be written around. */
function unreadable(problems: VirtualProblem[]): VirtualDocument {
  return { main: { extension: ".ts", spans: [], text: EMPTY_MODULE }, problems, supplemental: [] };
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
    components: options.outside?.components ?? {},
    defs: definitionsOf(doc),
    doc,
    // SAFETY: a document is an element with `$` members beside it, and only `$layout` is read.
    index: stateIndex(doc as JxElement, options.outside),
    source,
    specifier: options.specifier,
    stateName:
      isString(scripts.client) && DECLARES_STATE.test(scripts.client) ? FALLBACK_STATE : "State",
    tokens: read.tokens,
  };
  const layout = layoutOf(reading);
  const supplemental: VirtualUnit[] = [];
  if (isString(scripts.server)) {
    supplemental.push(writeServer(reading, layout, scripts.server));
  }
  for (const body of layout.bodies) {
    supplemental.push(writeBody(reading, body));
  }
  for (const template of layout.templates) {
    supplemental.push(writeTemplate(reading, template));
  }
  supplemental.push(...writeReferences(reading, layout));
  return { main: writeMain(reading, layout), problems: [], supplemental };
}
