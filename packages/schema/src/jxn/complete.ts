/**
 * What a `.jxn` file may hold at a position, from the schema it is validated against (`spec.md`
 * §22.6).
 *
 * One reader for every editor, so Studio's Code view and an editor extension offer the same. It is
 * given the text as it stands, which is rarely Jx Notation while it is being typed, so the position
 * is found by `outline.ts` and not by the parser. What a position means is then `spec.md` §22.1 and
 * §22.5 read downwards: each node on the way to it is an element, a JSON block, a `style` block, a
 * `$array` row or the holder of one element, and a JSON block carries the schema of the member it
 * is.
 *
 * Nothing here says a file is wrong. An offer is what the schema lists, and a name it does not list
 * (a custom element's tag, a state entry, an attribute) is as valid as it was.
 *
 * @docs framework/concepts/jxn-files
 */
import { isJsonObject, isString } from "../guards.ts";
import type { JsonObject, JsonPrimitive } from "../../types.ts";
import { classifyJxn } from "./classify.ts";
import type { JxnSpan } from "./errors.ts";
import { outlineJxn } from "./outline.ts";
import type { OutlineCursor, OutlineEntry, OutlineNode } from "./outline.ts";
import { token } from "./parse.ts";
import type { ComposedProjectSchemas } from "../project-schemas.ts";
import { descriptionOf, itemsOf, leavesOf, memberOf, namesOf, valuesOf } from "./schema-walk.ts";
import type { RootedSchema } from "./schema-walk.ts";
import { scalar, writeName } from "./serialize.ts";

/** What an offer is, for an editor to draw it by. */
export type JxnCompletionKind = "annotation" | "element" | "member" | "value";

/** One thing that may be written at the position. */
export interface JxnCompletion {
  /** What the schema says it is for, where it says. */
  detail?: string;
  /** The text accepting it writes. */
  insert: string;
  kind: JxnCompletionKind;
  /** What it is listed as. */
  label: string;
}

/** What may be written at a position, and the stretch of the text accepting an offer replaces. */
export interface JxnCompletions extends JxnSpan {
  /** In the order they are best listed. Empty where nothing is offered. */
  items: JxnCompletion[];
}

/**
 * How `spec.md` §22.1 reads a node: `only` holds one element (`.map`, a value of `.cases`,
 * `.children`), `value` is a JSON block, and `none` is anything nothing is offered in.
 */
type ReadingKind =
  | "array"
  | "cases"
  | "document"
  | "element"
  | "head"
  | "none"
  | "only"
  | "project"
  | "script"
  | "style"
  | "value";

/** One node as it is read, with the schema of what it holds. */
interface Reading {
  kind: ReadingKind;
  /** Whether this is the document's root element, which holds the document's own members too. */
  root: boolean;
  schema: RootedSchema | null;
}

/** A name a schema declares, with its schema. */
type Named = [name: string, schema: RootedSchema];

/** One entry of a `state` block. */
interface StateName {
  /** Whether it is written as a function, which is what a handler may point at. */
  fn: boolean;
  name: string;
}

const reading = (kind: ReadingKind, schema: RootedSchema | null = null, root = false): Reading => ({
  kind,
  root,
  schema,
});

/** Read as nothing an offer is made in: code, text, a name the reader gives no schema. */
const NOTHING = reading("none");

/** The annotations whose row holds code. */
const CODE = new Set(["export", "fn", "server"]);

/** The members of an element that are child nodes of their own, or its name. */
const WRITTEN_PLAINLY = new Set(["attributes", "state", "style", "tagName"]);

/** What a string must not hold to be written inside quotes as it is. */
const NEEDS_ESCAPING = /["\\\n]/u;

/** The annotations of `spec.md` §22.1. */
type Annotation = "array" | "export" | "fn" | "object" | "on" | "ref" | "server";

/** What each annotation says, in the words of `spec.md` §22.1. */
const ANNOTATIONS = {
  array: "A JSON block that is a list, where its contents would not say so.",
  export: "A function the document's client module exports.",
  fn: "A function. Its last string is the body.",
  object: "A JSON block that is an object, where its contents would not say so.",
  on: "An event handler written as a JSON block.",
  ref: "A pointer to another value, such as #/state/name.",
  server: "A function of the document's server module.",
} satisfies Record<Annotation, string>;

/** The annotations a node may carry, by how the block it is in is read. */
const NODE_ANNOTATIONS: Partial<Record<ReadingKind, Annotation[]>> = {
  document: ["object", "array"],
  element: ["fn", "on", "object", "array"],
  project: ["object", "array"],
  style: ["array"],
  value: ["fn", "export", "server", "object", "array"],
};

/** A value as the writer spells it. A primitive always fits one token. */
const spelled = (value: JsonPrimitive): string => scalar(value, "", "") ?? "";

/** An offer, with what its schema says it is for. */
function offer(
  kind: JxnCompletionKind,
  label: string,
  insert: string,
  schema: RootedSchema | null = null,
): JxnCompletion {
  const detail = schema ? descriptionOf(schema) : null;
  return detail === null ? { insert, kind, label } : { detail, insert, kind, label };
}

/** A node's name. */
const nodeOffer = ([name, schema]: Named): JxnCompletion =>
  offer("member", name, writeName(name, ""), schema);

/** A name on a node's line, which its `=` follows. */
const keyOffer = ([name, schema]: Named): JxnCompletion =>
  offer("member", `${name}=`, `${writeName(name, "")}=`, schema);

/** Values, as offers: inside quotes the text alone, and otherwise as the writer spells each. */
function valueOffers(
  values: readonly JsonPrimitive[],
  quoted: boolean,
  kind: JxnCompletionKind = "value",
): JxnCompletion[] {
  return values.flatMap((value) => {
    if (!quoted) {
      return [offer(kind, spelled(value), spelled(value))];
    }
    return isString(value) && !NEEDS_ESCAPING.test(value) ? [offer(kind, value, value)] : [];
  });
}

/** The annotations named, as offers. */
const annotationOffers = (names: readonly Annotation[]): JxnCompletion[] =>
  names.map((name) => ({
    detail: ANNOTATIONS[name],
    insert: name,
    kind: "annotation",
    label: name,
  }));

/** The first value written alone on a node's line, or null. */
const firstAlone = (node: OutlineNode): OutlineEntry | null =>
  node.entries.find((entry) => entry.key === null) ?? null;

/** One file, read against its schemas. */
class Completer {
  /** The schema of a `$array` row. */
  readonly array: RootedSchema | null;
  readonly document: RootedSchema;
  /** The schema of an element. */
  readonly element: RootedSchema | null;
  readonly nodes: OutlineNode[];
  /** The project file's schema, where the file is one. */
  readonly project: RootedSchema | null;
  /** The schema of the file's top level: the project file's, or the document's. */
  readonly top: RootedSchema;

  constructor(nodes: OutlineNode[], schemas: ComposedProjectSchemas, project: boolean) {
    this.nodes = nodes;
    this.document = { root: schemas.document, schema: schemas.document };
    this.project = project ? { root: schemas.project, schema: schemas.project } : null;
    this.top = this.project ?? this.document;
    // Found by what they are and not by a definition's name, which a composed schema nests.
    const children = memberOf(this.document, "children");
    const items = children && itemsOf(children);
    const made = [...(children ? leavesOf(children) : []), ...(items ? leavesOf(items) : [])];
    const declaring = (
      name: string,
      test: (schema: JsonObject) => boolean,
    ): RootedSchema | null => {
      const found = made.find((leaf) => {
        const declared = isJsonObject(leaf.properties) ? leaf.properties[name] : undefined;
        return isJsonObject(declared) && test(declared);
      });
      return found ? { root: schemas.document, schema: found } : null;
    };
    this.element = declaring("tagName", () => true);
    this.array = declaring("$prototype", (schema) => schema.const === "Array");
  }

  /** The tag names the schema lists. */
  tags(): JsonPrimitive[] {
    const tagName = memberOf(this.document, "tagName");
    return tagName ? valuesOf(tagName) : [];
  }

  /** The schema of a member of an element, which for the root may be the document's own. */
  elementMember(root: boolean, key: string): RootedSchema | null {
    const own = root ? namesOf(this.document).get(key) : undefined;
    return own ?? (this.element ? memberOf(this.element, key) : null);
  }

  /** The members an element is declared to have: its own and, for the root, the document's. */
  elementNames(root: boolean): Named[] {
    const own = this.element ? [...namesOf(this.element)] : [];
    const documents = root
      ? [...namesOf(this.document)].filter(([name]) => !name.startsWith("$"))
      : [];
    return [...new Map([...own, ...documents])];
  }

  /** An element's `$` members, as a node or a line may name them. */
  jxMembers(root: boolean): Named[] {
    return this.elementNames(root).filter(([name]) => name.startsWith("$") && !name.includes("/"));
  }

  /** An element's handlers. */
  handlers(root: boolean): Named[] {
    return this.elementNames(root).filter(([name]) => name.startsWith("on"));
  }

  /** An element's other members, each under the `.name` it is written as. */
  dotted(root: boolean): Named[] {
    return this.elementNames(root).flatMap(([name, schema]): Named[] =>
      name.startsWith("$") || name.startsWith("on") || WRITTEN_PLAINLY.has(name)
        ? []
        : [[`.${name}`, schema]],
    );
  }

  /** How a top-level node is read. */
  atTop(node: OutlineNode): Reading {
    const { name } = node;
    if (name === "$head") {
      return reading("head");
    }
    if (this.project) {
      if (name === "project") {
        return NOTHING;
      }
      const kind = name === "style" || name === "$media" ? "style" : "value";
      return reading(kind, memberOf(this.project, name));
    }
    if (name === "$array") {
      return reading("array", this.array);
    }
    if (name.startsWith("$") && name !== "$element") {
      return reading("value", memberOf(this.document, name));
    }
    return reading("element", this.element, true);
  }

  /** How a child node of an element is read. */
  inElement(parent: Reading, node: OutlineNode): Reading {
    const { annotation, name } = node;
    if (annotation === "fn" || annotation === "on" || name === "-") {
      return NOTHING;
    }
    if (name === "script") {
      return parent.root ? reading("script") : NOTHING;
    }
    if (name === "style") {
      return reading("style", this.elementMember(parent.root, name));
    }
    if (name === "state" || name === "attributes") {
      return reading("value", this.elementMember(true, name));
    }
    if (name === "$array") {
      return reading("array", this.array);
    }
    if (name === ".map" || (name === ".children" && annotation !== "array" && node.children)) {
      return reading("only");
    }
    if (name === ".cases") {
      return reading("cases");
    }
    if (name.startsWith(".")) {
      return reading("value", this.elementMember(parent.root, name.slice(1)));
    }
    if (name.startsWith("$") && name !== "$element") {
      return reading("value", this.elementMember(parent.root, name));
    }
    return reading("element", this.element);
  }

  /** How a node is read, given how the block it is in is. */
  readingOf(parent: Reading, node: OutlineNode): Reading {
    const { schema } = parent;
    switch (parent.kind) {
      case "document":
      case "project": {
        return this.atTop(node);
      }
      case "element": {
        return this.inElement(parent, node);
      }
      case "only": {
        return node.name === "$array"
          ? reading("array", this.array)
          : reading("element", this.element);
      }
      case "cases": {
        return reading("only");
      }
      case "array": {
        return reading("element", this.element);
      }
      case "style": {
        return reading("style", schema && memberOf(schema, node.name));
      }
      case "value": {
        if (CODE.has(node.annotation ?? "")) {
          return NOTHING;
        }
        const held = (of: RootedSchema): RootedSchema | null =>
          node.name === "-" ? itemsOf(of) : memberOf(of, node.name);
        return reading("value", schema && held(schema));
      }
      default: {
        return NOTHING;
      }
    }
  }

  /** The entries of the file's own `state`: the root element's in a document. */
  state(): StateName[] {
    const root = this.nodes.find((node) => !node.name.startsWith("$") || node.name === "$element");
    const holders = this.project ? this.nodes : (root?.children ?? []);
    const block = holders.find((node) => node.name === "state");
    return (block?.children ?? []).map((node) => ({
      fn: CODE.has(node.annotation ?? ""),
      name: node.name,
    }));
  }

  /** Pointers into the file's `state`, as offers. */
  pointers(functions: boolean, quoted: boolean, annotated: boolean): JxnCompletion[] {
    return this.state().flatMap(({ fn, name }) => {
      if (name === "" || (functions && !fn)) {
        return [];
      }
      const pointer = `#/state/${token(name)}`;
      if (quoted) {
        return valueOffers([pointer], true);
      }
      return [offer("value", pointer, `${annotated ? "" : "(ref)"}${spelled(pointer)}`)];
    });
  }

  /** The names a node may have in a block read as `container`. */
  names(cursor: OutlineCursor, container: Reading): JxnCompletion[] {
    const siblings = (cursor.path.at(-1)?.children ?? this.nodes).filter(
      (node) => node !== cursor.node,
    );
    const taken = new Set(siblings.map((node) => node.name));
    const free = (names: Iterable<Named>): JxnCompletion[] =>
      [...names].flatMap((named) => (taken.has(named[0]) ? [] : [nodeOffer(named)]));
    const plain = (...names: string[]): JxnCompletion[] =>
      names.flatMap((name) => (taken.has(name) ? [] : [offer("member", name, name)]));
    const tags = (): JxnCompletion[] => valueOffers(this.tags(), false, "element");
    const { schema } = container;
    switch (container.kind) {
      case "document": {
        const members = free([...namesOf(this.document)].filter(([name]) => name.startsWith("$")));
        const rooted = siblings.some(
          (node) =>
            !node.name.startsWith("$") || node.name === "$element" || node.name === "$array",
        );
        return rooted ? members : [...tags(), ...members];
      }
      case "project": {
        // The project's name is the value of the `project` node, and has no node of its own.
        const members = [...namesOf(this.top)].filter(([name]) => name !== "name");
        return [...plain("project"), ...free(members)];
      }
      case "element": {
        const { root } = container;
        if (cursor.node?.annotation === "fn" || cursor.node?.annotation === "on") {
          return free(this.handlers(root));
        }
        return [
          ...plain("state", "style", "attributes"),
          ...(root ? plain("script") : []),
          ...tags(),
          offer("member", "-", "-"),
          offer("member", "$array", "$array"),
          offer("member", "$element", "$element"),
          ...free(this.jxMembers(root)),
          ...free(this.dotted(root)),
        ];
      }
      case "only": {
        return [
          ...tags(),
          offer("member", "$array", "$array"),
          offer("member", "$element", "$element"),
        ];
      }
      case "array": {
        return [...tags(), offer("member", "$element", "$element")];
      }
      case "style":
      case "value": {
        if (!schema) {
          return [];
        }
        // A block is a list or an object, and says which by its annotation or by what it holds.
        const holder = cursor.path.at(-1)?.annotation ?? null;
        const dashed = siblings.some((node) => node.name === "-");
        const list = holder === "array" || (holder !== "object" && dashed);
        const object = holder === "object" || (!list && siblings.length > 0);
        // `$ref` is a member the notation spells `(ref)`.
        const members = list ? [] : free([...namesOf(schema)].filter(([name]) => name !== "$ref"));
        return itemsOf(schema) && !object ? [offer("member", "-", "-"), ...members] : members;
      }
      default: {
        return [];
      }
    }
  }

  /** What may be written on a node's line, where no name has its `=` yet. */
  entries(cursor: OutlineCursor, node: OutlineNode, line: Reading): JxnCompletion[] {
    const taken = new Set(
      node.entries.flatMap((entry) =>
        entry === cursor.entry || entry.key === null ? [] : [entry.key],
      ),
    );
    const free = (names: Iterable<Named>): JxnCompletion[] =>
      [...names].flatMap((named) => (taken.has(named[0]) ? [] : [keyOffer(named)]));
    const { schema } = line;
    switch (line.kind) {
      case "element": {
        const tag =
          node.name === "$element" && firstAlone(node) === cursor.entry
            ? valueOffers(this.tags(), false, "element")
            : [];
        return [
          ...tag,
          ...free(this.dotted(line.root)),
          ...free(this.jxMembers(line.root)),
          ...free(this.handlers(line.root)),
        ];
      }
      case "array": {
        const keys = schema ? [...namesOf(schema)] : [];
        return free(keys.filter(([name]) => name !== "$prototype" && name !== "map"));
      }
      case "script": {
        return taken.has("timing") ? [] : [offer("member", "timing=server", "timing=server")];
      }
      case "style":
      case "value": {
        if (!schema) {
          return [];
        }
        const items = itemsOf(schema);
        return [
          ...free([...namesOf(schema)].filter(([name]) => name !== "$ref")),
          ...valueOffers([...valuesOf(schema), ...(items ? valuesOf(items) : [])], false),
        ];
      }
      default: {
        return [];
      }
    }
  }

  /** The values the schema names for one value of a node's line. */
  valuesAt(node: OutlineNode, line: Reading, entry: OutlineEntry | null): JsonPrimitive[] {
    const key = entry?.key ?? null;
    const { schema } = line;
    if (line.kind === "element") {
      if (key === null) {
        return node.name === "$element" && firstAlone(node) === entry ? this.tags() : [];
      }
      // Any other name is an attribute's, which is free.
      const member = key.startsWith(".") ? key.slice(1) : key;
      const named = key.startsWith(".") || key.startsWith("$");
      const declared = named ? this.elementMember(line.root, member) : null;
      return declared ? valuesOf(declared) : [];
    }
    if (line.kind === "script") {
      return key === "timing" ? ["server"] : [];
    }
    if ((line.kind !== "value" && line.kind !== "style") || !schema) {
      return [];
    }
    if (key !== null) {
      const member = memberOf(schema, key);
      return member ? valuesOf(member) : [];
    }
    const items = itemsOf(schema);
    return [...valuesOf(schema), ...(items ? valuesOf(items) : [])];
  }

  /** What one value of a node's line may be. */
  values(cursor: OutlineCursor, node: OutlineNode, line: Reading): JxnCompletion[] {
    const { entry, quoted } = cursor;
    const annotation = entry?.annotation ?? null;
    const key = entry?.key ?? null;
    if (annotation !== null && annotation !== "ref") {
      return [];
    }
    const handler = line.kind === "element" && key?.startsWith("on") === true;
    const row = line.kind === "array" && key !== null && key !== "key";
    if (handler || row || annotation === "ref") {
      return this.pointers(handler, quoted, annotation === "ref");
    }
    return valueOffers(this.valuesAt(node, line, entry), quoted);
  }

  /** What may be written at the position. */
  at(cursor: OutlineCursor): JxnCompletion[] {
    const top = reading(this.project ? "project" : "document");
    let container = top;
    for (const node of cursor.path) {
      container = this.readingOf(container, node);
    }
    const { node } = cursor;
    if (!node || cursor.slot === "name") {
      return this.names(cursor, container);
    }
    if (cursor.slot === "annotation") {
      return annotationOffers(cursor.entry ? ["ref"] : (NODE_ANNOTATIONS[container.kind] ?? []));
    }
    const line = this.readingOf(container, node);
    return cursor.slot === "entry"
      ? this.entries(cursor, node, line)
      : this.values(cursor, node, line);
  }
}

/**
 * What may be written at a position in a `.jxn` file.
 *
 * @param text The file as it stands. It need not parse.
 * @param offset The position, as an offset in `text`.
 * @param schemas The schemas a document and a project file are validated against. Each `$ref` in
 *   one is a pointer from its own root, which is how `composeProjectSchemas` returns the pair and
 *   how `flattenSchema` leaves any other.
 * @returns The offers, and the stretch of `text` accepting one replaces. Where nothing is offered
 *   the list is empty and the stretch is the position itself.
 */
export function completeJxn(
  text: string,
  offset: number,
  schemas: ComposedProjectSchemas,
): JxnCompletions {
  const { cursor, nodes } = outlineJxn(text, offset);
  if (!cursor) {
    return { end: offset, items: [], start: offset };
  }
  const completer = new Completer(nodes, schemas, classifyJxn(text) === "project");
  return { end: cursor.end, items: completer.at(cursor), start: cursor.start };
}
