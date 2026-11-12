/**
 * Repeater scope resolution: what the item of a repeater (`$prototype: "Array"`) holds, deduced
 * from the document and the project without running either.
 *
 * Two surfaces ask. Inline text edited INSIDE a repeater inserts a `${item.data.title}` token, and
 * the `From data…` rung binds a `$map/item/data/title` pointer. They are the same field spelled for
 * two grammars, so there is one walk and each field carries both spellings. A third surface asks
 * for the one field that is neither text nor a value: `$children`, which an element draws by
 * holding it as computed children (spec.md §8.4).
 *
 * The canvas draws every row against its own item (studio.md §4.5), but the rows are in the frame's
 * realm and say what one list holds today, not what an item may hold. So field names are resolved
 * PARENT-SIDE from the repeater's binding + the project's content-type / state schema, keyed off
 * the selected element's document path (which carries a real `"map"` segment — see
 * canvas/path-mapping.ts `classifyRenderNode`). The same walk yields the sample item a repeater
 * with nothing to draw shows its template with ({@link repeaterSampleItems}).
 *
 * Pure and DOM-free: deps limited to `@jxsuite/schema` guards/types, the runtime's pointer grammar
 *
 * - {@link getNodeAtPath}.
 *
 * @docs studio/design/repeaters
 */

import { escapeToken, refSegments } from "@jxsuite/runtime/pointer";
import { getNodeAtPath } from "@jxsuite/schema/doc-ops";
import {
  isJsonObject,
  isMappedArray,
  isRef,
  isSchemaOnlyDef,
  isString,
} from "@jxsuite/schema/guards";

import type { JxPath } from "../state";
import type {
  JsonObject,
  JsonValue,
  JxDocumentValue,
  JxMappedArray,
  JxMutableNode,
  ProjectConfig,
} from "@jxsuite/schema/types";

/** Cap on how many inferred/declared fields we enumerate (mirrors merge-tags BREADTH_CAP breadth). */
const FIELD_CAP = 50;

/**
 * Find the repeater (`$prototype: "Array"`) that encloses the node at `path`. The stamper strips a
 * row's index from its render path, leaving `[...P, "map", …]` where `P` is the repeater's own doc
 * path, so an element inside a repeater carries a real-doc path containing a `"map"` segment. We
 * take the LAST `"map"` (innermost repeater wins for nesting) and resolve the node at the prefix
 * before it.
 *
 * @param doc - The tab's document root (`tab.doc.document`).
 * @param path - The selected element's document path.
 * @returns The enclosing `JxMappedArray` node, or `null` when the path is not inside a repeater.
 */
export function findEnclosingRepeater(
  doc: JxMutableNode,
  path: JxPath | null | undefined,
): JxMappedArray | null {
  if (!Array.isArray(path) || path.length === 0) {
    return null;
  }
  const mapIdx = path.lastIndexOf("map");
  if (mapIdx <= 0) {
    return null;
  }
  const node = getNodeAtPath(doc, path.slice(0, mapIdx));
  return isMappedArray(node) ? node : null;
}

/** One field of a repeater's item, in each grammar that can name it. */
export interface RepeaterField {
  /** The members walked from the item, unescaped. */
  path: string[];
  /** What a template reads and a person is shown: `item.data.title`. */
  token: string;
  /** What a `$ref` holds: `$map/item/data/title`, with each member escaped (RFC 6901 §3). */
  pointer: string;
  /** Whether the field holds a list, which is all a nested repeater's Items can read. */
  isArray: boolean;
  /** Whether the field holds child nodes, which only an element's computed children can draw. */
  holdsNodes: boolean;
  /** The title the field's schema declares, when it declares one: what a person calls the field. */
  title?: string;
}

/** The one `$`-prefixed member an item offers: the Jx tree a parsed body came out as. */
const NODES_MEMBER = "$children";

/** The content format whose loader parses an entry's body into {@link NODES_MEMBER}. */
const NODES_FORMAT = "Markdown";

/** What every step of the walk reads from. */
interface ItemSources {
  doc: JxMutableNode;
  config: ProjectConfig | null | undefined;
}

/** Marks a schema as an entry of this content type, so a relationship cycle can be stopped. */
const ENTRY_TYPE = "$entryType";

/** Marks an entry's `data` member, which is a level of the path rather than a field to offer. */
const ENTRY_DATA = "$entryData";

/** How many members a sample list contributes to the shape it implies. */
const SAMPLE_CAP = 20;

/** How many members deep a field path may run, so a walk of a deep schema stays a short list. */
const DEPTH_CAP = 6;

/** How many pointers a `$ref` chain may follow, so `a → b → a` ends. */
const HOP_CAP = 8;

/** The shape of what a content type's loader hands back (`ContentLoaderEntry`). */
function entrySchema(contentType: string, ctx: ItemSources): JsonObject {
  /* The `content` section is contributed by an extension and absorbed by the project config's index
     signature, so each level is checked before it is read. */
  const content: unknown = ctx.config?.content;
  const type = isJsonObject(content) ? content[contentType] : undefined;
  const data = isJsonObject(type) && isJsonObject(type.schema) ? type.schema : {};
  // A CSV row has no body to parse. A type naming no format is not known to lack one.
  const format = isJsonObject(type) ? type.format : undefined;
  const hasNodes = !isString(format) || format === NODES_FORMAT;
  // Built from entries because the order is what the picker lists: id and body, then the fields.
  const members: [string, JsonValue][] = [
    ["id", {}],
    ["body", {}],
    ...(hasNodes ? ([[NODES_MEMBER, {}]] satisfies [string, JsonValue][]) : []),
    ["data", { ...data, [ENTRY_DATA]: true }],
  ];
  return { [ENTRY_TYPE]: contentType, properties: Object.fromEntries(members) };
}

/** Whether a schema's own keys say what is inside it, so a sample has nothing to add. */
function describesFields(schema: JsonObject | null, ctx: ItemSources): boolean {
  return (
    isJsonObject(schema?.properties) || isJsonObject(followPointers(schema?.items, ctx)?.properties)
  );
}

/**
 * Follow a schema's pointers to the schema they name, or `null` for one this walk cannot read.
 *
 * Three spellings reach another schema: `{ "$ref": "#/content/authors" }` is a relationship, whose
 * value the loader resolves to the full entry; `{ "$ref": "#/$defs/Member" }` is a shared type; and
 * `{ "type": { "$ref": … } }` is a typed value naming one.
 */
function followPointers(
  schema: JxDocumentValue | undefined,
  ctx: ItemSources,
  hops = 0,
): JsonObject | null {
  if (!isJsonObject(schema) || hops > HOP_CAP) {
    return null;
  }
  const pointer = isRef(schema) ? schema.$ref : isRef(schema.type) ? schema.type.$ref : null;
  if (pointer === null) {
    return schema;
  }
  if (pointer.startsWith("#/content/")) {
    return entrySchema(pointer.slice("#/content/".length), ctx);
  }
  if (pointer.startsWith("#/$defs/")) {
    const [name, ...rest] = refSegments(pointer.slice("#/$defs/".length));
    const projectDefs: unknown = ctx.config?.$defs;
    const declared =
      name === undefined
        ? undefined
        : (ctx.doc.$defs?.[name] ?? (isJsonObject(projectDefs) ? projectDefs[name] : undefined));
    return walkSchema(followPointers(declared, ctx, hops + 1), rest, ctx);
  }
  return null;
}

/** The union of two implied shapes, so an optional field the first row lacks is still found. */
function mergeSamples(a: JsonObject, b: JsonObject): JsonObject {
  const merged: JsonObject = { ...a, ...b };
  if (isJsonObject(a.items) && isJsonObject(b.items)) {
    merged.items = mergeSamples(a.items, b.items);
  }
  if (isJsonObject(a.properties) && isJsonObject(b.properties)) {
    const properties: JsonObject = { ...a.properties, ...b.properties };
    for (const [key, left] of Object.entries(a.properties)) {
      const right = b.properties[key];
      if (isJsonObject(left) && isJsonObject(right)) {
        properties[key] = mergeSamples(left, right);
      }
    }
    merged.properties = properties;
  }
  return merged;
}

/** The shape a sample value implies. */
function sampleSchema(value: JsonValue | undefined): JsonObject {
  if (Array.isArray(value)) {
    let items: JsonObject = {};
    for (const member of value.slice(0, SAMPLE_CAP)) {
      items = mergeSamples(items, sampleSchema(member));
    }
    return { items };
  }
  if (isJsonObject(value)) {
    return {
      properties: Object.fromEntries(
        Object.entries(value).map(([key, member]) => [key, sampleSchema(member)]),
      ),
    };
  }
  return {};
}

/** The shape of a state entry's value, or `null` when only running it would say. */
function stateSchema(def: JxDocumentValue | undefined, ctx: ItemSources): JsonObject | null {
  if (Array.isArray(def)) {
    // SAFETY: a naked array state entry is the JSON value it reads as (schema/types `JxStateDefinition`).
    return sampleSchema(def as JsonValue[]);
  }
  if (!isJsonObject(def)) {
    return null;
  }
  /* Detected on the `contentType` string, not the prototype's name, so an import-aliased
     `$prototype` still matches. An `id` is what asks for one entry rather than the list. */
  if (isString(def.contentType)) {
    const entry = entrySchema(def.contentType, ctx);
    return def.$prototype === "ContentEntry" || def.id !== undefined ? entry : { items: entry };
  }
  const declared = followPointers(def, ctx);
  if (describesFields(declared, ctx)) {
    return declared;
  }
  if ("default" in def) {
    return sampleSchema(def.default);
  }
  const isNakedObject = !isSchemaOnlyDef(def) && !Object.keys(def).some((k) => k.startsWith("$"));
  return isNakedObject ? sampleSchema(def) : declared;
}

/** Follow members down a schema, or `null` where the schema stops saying. */
function walkSchema(
  schema: JsonObject | null,
  segments: readonly string[],
  ctx: ItemSources,
): JsonObject | null {
  let current = followPointers(schema, ctx);
  for (const segment of segments) {
    const member = isJsonObject(current?.properties) ? current.properties[segment] : undefined;
    current = followPointers(member ?? (/^\d+$/.test(segment) ? current?.items : undefined), ctx);
  }
  return current;
}

/** The shape of what a repeater's `items` binding reads, in the scope of the repeater itself. */
function bindingSchema(
  binding: JxMappedArray["items"],
  repeaterPath: JxPath,
  ctx: ItemSources,
): JsonObject | null {
  if (Array.isArray(binding)) {
    // SAFETY: an inline `items` list is read straight out of the JSON document.
    return sampleSchema(binding as JsonValue[]);
  }
  if (!isRef(binding)) {
    return null;
  }
  const ref = binding.$ref.replace(/^#\/\$map\//, "$map/");
  if (ref.startsWith("#/state/")) {
    const [name, ...rest] = refSegments(ref.slice("#/state/".length));
    const def = name === undefined ? undefined : ctx.doc.state?.[name];
    return walkSchema(stateSchema(def, ctx), rest, ctx);
  }
  // A nested repeater reads a member of the repeater around it, so the walk starts from that item.
  if (ref === "$map/item" || ref.startsWith("$map/item/")) {
    const rest = refSegments(ref.slice("$map/item/".length));
    return walkSchema(itemSchemaAt(repeaterPath, ctx), rest, ctx);
  }
  return null;
}

/** The shape of the item in scope at `path`, or `null` outside a repeater or past what is known. */
function itemSchemaAt(path: JxPath, ctx: ItemSources): JsonObject | null {
  const repeater = findEnclosingRepeater(ctx.doc, path);
  if (!repeater) {
    return null;
  }
  const list = bindingSchema(repeater.items, path.slice(0, path.lastIndexOf("map")), ctx);
  return followPointers(list?.items, ctx);
}

/** A field name as a template reads it: a member access where a name allows one, else a bracket. */
function fieldToken(path: readonly string[]): string {
  let token = "item";
  for (const member of path) {
    token += /^[A-Za-z_$][\w$]*$/.test(member) ? `.${member}` : `[${JSON.stringify(member)}]`;
  }
  return token;
}

/**
 * Every field the item in scope at `path` is known to hold, nearest the item first.
 *
 * Walked a level at a time so {@link FIELD_CAP} cuts the deepest fields and never a top-level one.
 * An object is offered as well as its members, because a component can take the whole value. A list
 * is offered and not entered: one of its members has no single value to bind. A relationship is
 * entered unless the branch already passed through that content type, which ends a post → author →
 * post cycle.
 *
 * `$children` is left out unless asked for: it is a tree of nodes, so a text position, an attribute
 * or a formula operand that read it would draw `[object Object]`.
 *
 * @param doc - The tab's document root (`tab.doc.document`).
 * @param path - The path of the node asking.
 * @param projectConfig - Parsed `project.json` (`projectState?.projectConfig`).
 * @param options - `withNodes` also lists the fields that hold child nodes.
 * @returns The fields, empty outside a repeater and wherever the item's shape cannot be deduced.
 */
export function repeaterItemFields(
  doc: JxMutableNode,
  path: JxPath | null | undefined,
  projectConfig: ProjectConfig | null | undefined,
  { withNodes = false }: { withNodes?: boolean } = {},
): RepeaterField[] {
  if (!Array.isArray(path)) {
    return [];
  }
  const ctx: ItemSources = { config: projectConfig, doc };
  const fields: RepeaterField[] = [];
  const pending: { at: string[]; schema: JsonObject | null; via: string[] }[] = [
    { at: [], schema: itemSchemaAt(path, ctx), via: [] },
  ];
  for (const { at, schema, via } of pending) {
    const entryType = isString(schema?.[ENTRY_TYPE]) ? schema[ENTRY_TYPE] : null;
    const passed = entryType === null ? via : [...via, entryType];
    const members = isJsonObject(schema?.properties) ? Object.entries(schema.properties) : [];
    for (const [key, member] of members) {
      const holdsNodes = key === NODES_MEMBER;
      if ((key.startsWith("$") && !(holdsNodes && withNodes)) || fields.length >= FIELD_CAP) {
        continue;
      }
      const memberPath = [...at, key];
      const resolved = followPointers(member, ctx);
      if (resolved?.[ENTRY_DATA] !== true) {
        const field: RepeaterField = {
          holdsNodes,
          isArray: resolved?.type === "array" || isJsonObject(resolved?.items),
          path: memberPath,
          pointer: `$map/item/${memberPath.map((m) => escapeToken(m)).join("/")}`,
          token: fieldToken(memberPath),
        };
        // The member's own title, then the one the schema it points at declares.
        const declared = isJsonObject(member) && isString(member.title) ? member.title : null;
        const title = declared ?? (isString(resolved?.title) ? resolved.title : null);
        if (title !== null && title.trim() !== "") {
          field.title = title.trim();
        }
        fields.push(field);
      }
      const type = isString(resolved?.[ENTRY_TYPE]) ? resolved[ENTRY_TYPE] : null;
      if (memberPath.length < DEPTH_CAP && !(type !== null && passed.includes(type))) {
        pending.push({ at: memberPath, schema: resolved, via: passed });
      }
    }
  }
  return fields;
}

/**
 * The titles the document's repeaters give their items' fields, by the field as a template reads it
 * (`item.data.date`), for naming tags (studio.md §6.9). A field two repeaters title differently
 * keeps neither title, since the key cannot say which repeater a tag stands in.
 */
export function tagTitlesOf(
  doc: JxMutableNode,
  config: ProjectConfig | null | undefined,
): Readonly<Record<string, string>> {
  const titles = new Map<string, string>();
  const refused = new Set<string>();
  const visit = (value: JxDocumentValue | undefined, path: JxPath): void => {
    if (Array.isArray(value)) {
      for (const [index, member] of value.entries()) {
        visit(member, [...path, index]);
      }
      return;
    }
    if (!isJsonObject(value)) {
      return;
    }
    if (isMappedArray(value)) {
      for (const field of repeaterItemFields(doc, [...path, "map"], config)) {
        if (field.title === undefined || refused.has(field.token)) {
          continue;
        }
        const held = titles.get(field.token);
        if (held !== undefined && held !== field.title) {
          titles.delete(field.token);
          refused.add(field.token);
        } else {
          titles.set(field.token, field.title);
        }
      }
    }
    for (const [key, member] of Object.entries(value)) {
      if (key !== "state" && key !== "$media" && key !== "$elements") {
        /* SAFETY: a member of a document object is a document value. */
        visit(member as JxDocumentValue, [...path, key]);
      }
    }
  };
  visit(doc, []);
  return Object.fromEntries(titles);
}

/**
 * The titles the fields of the item in scope at `path` are given by their schemas, by the field as
 * a template reads it: what a tag standing at `path` is named by (studio.md §6.9). Empty outside a
 * repeater. Unlike {@link tagTitlesOf} it answers for one place, so two repeaters that title a field
 * differently are each right where they stand.
 */
export function tagTitlesAt(
  doc: JxMutableNode,
  path: JxPath | null | undefined,
  config: ProjectConfig | null | undefined,
): Readonly<Record<string, string>> {
  const titles = new Map<string, string>();
  for (const field of repeaterItemFields(doc, path, config)) {
    if (field.title !== undefined) {
      titles.set(field.token, field.title);
    }
  }
  return Object.fromEntries(titles);
}

/**
 * The `children` template that draws a field's nodes. The fallback is part of it because the field
 * is only known to be possible: an entry loaded without a body has no `$children` to read.
 */
export function childrenTemplate(field: RepeaterField): string {
  return `\${${field.token} ?? []}`;
}

/**
 * The field a `children` template reads, with or without the fallback {@link childrenTemplate}
 * writes. Anything more than the bare field is the author's own expression and is left as theirs.
 */
export function fieldOfChildrenTemplate(
  template: string,
  fields: readonly RepeaterField[],
): RepeaterField | undefined {
  const token = /^\$\{\s*(.+?)\s*(?:\?\?\s*\[\s*\]\s*)?\}$/u.exec(template)?.[1];
  return fields.find((field) => field.token === token);
}

/**
 * A `$map/…` pointer in the words {@link repeaterItemFields} offers it under, or `null` for any
 * other pointer. A bound chip says the same name the picker did: `item.data.title`.
 */
export function mapRefLabel(ref: string): string | null {
  if (ref === "$map/index") {
    return "index";
  }
  if (ref === "$map/item") {
    return "item";
  }
  return ref.startsWith("$map/item/")
    ? fieldToken(refSegments(ref.slice("$map/item/".length)))
    : null;
}

/** What a schema's `type` says a value is, when it says so in a word. */
function schemaType(schema: JsonObject): string | null {
  const { type } = schema;
  if (isString(type)) {
    return type;
  }
  // `["string", "null"]`: the first that is not null is what a sample should look like.
  for (const member of Array.isArray(type) ? type : []) {
    if (isString(member) && member !== "null") {
      return member;
    }
  }
  return null;
}

/**
 * A value of the shape `schema` describes, with nothing in it: an object with every declared
 * member, an empty list, a zero, a false, and an empty string for anything else or unknown.
 *
 * Empty on purpose. The row it is drawn in is no item of the list, so it must not read as one: a
 * chip whose value is empty draws its NAME (studio.md §4.5), which is what shows a template whole.
 * A declared `default` or the first `enum` member is used where the schema gives one.
 */
function sampleValue(
  schema: JsonObject | null,
  ctx: ItemSources,
  depth: number,
  via: readonly string[],
): JsonValue {
  const resolved = followPointers(schema, ctx);
  if (!resolved || depth > DEPTH_CAP) {
    return "";
  }
  const entryType = isString(resolved[ENTRY_TYPE]) ? resolved[ENTRY_TYPE] : null;
  if (entryType !== null && via.includes(entryType)) {
    // A post's author's posts: the cycle ends on an empty entry.
    return {};
  }
  const passed = entryType === null ? via : [...via, entryType];
  if (isJsonObject(resolved.properties)) {
    return Object.fromEntries(
      Object.entries(resolved.properties).map(([key, member]) => [
        key,
        key === NODES_MEMBER
          ? []
          : sampleValue(isJsonObject(member) ? member : null, ctx, depth + 1, passed),
      ]),
    );
  }
  if (resolved.default !== undefined) {
    // SAFETY: a schema is JSON, so its `default` is a JSON value.
    return resolved.default as JsonValue;
  }
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    // SAFETY: as above, an `enum` member is a JSON value.
    return resolved.enum[0] as JsonValue;
  }
  const type = schemaType(resolved);
  if (type === "array" || isJsonObject(resolved.items)) {
    return [];
  }
  if (type === "number" || type === "integer") {
    return 0;
  }
  if (type === "boolean") {
    return false;
  }
  return type === "object" ? {} : "";
}

/**
 * Whether `schema` says anything about what an item is: its members, its type, a default, its own
 * items. A list declared as nothing more than a list (client state written `[]`, `{ "default": []
 * }`) has an item schema that says none of it, and a sample made from that would be an empty
 * string: an ITEM, whose every field reads `undefined` and is spelled that way in the row.
 */
function describesItem(schema: JsonObject | null, ctx: ItemSources): schema is JsonObject {
  const resolved = followPointers(schema, ctx);
  return (
    resolved !== null &&
    (isJsonObject(resolved.properties) ||
      resolved.default !== undefined ||
      Array.isArray(resolved.enum) ||
      schemaType(resolved) !== null ||
      isJsonObject(resolved.items))
  );
}

/** A sample item per repeater, by the repeater's serialized document path. */
export type RepeaterSamples = Record<string, JsonValue>;

/**
 * A sample item for every repeater in `doc`, by the repeater's document path as `JSON.stringify`
 * writes it: what the canvas draws one row of the template with when the list has no items, or
 * cannot be resolved (studio.md §4.5). A repeater whose item shape cannot be deduced gets `null`:
 * its template is still drawn, and every binding in it that reads the item draws nothing.
 *
 * @param doc - The tab's document root (`tab.doc.document`).
 * @param projectConfig - Parsed `project.json` (`projectState?.projectConfig`).
 */
export function repeaterSampleItems(
  doc: JxMutableNode,
  projectConfig: ProjectConfig | null | undefined,
) {
  const ctx: ItemSources = { config: projectConfig, doc };
  const samples: RepeaterSamples = {};
  const walk = (value: JxDocumentValue | undefined, path: JxPath): void => {
    if (Array.isArray(value)) {
      for (const [index, member] of value.entries()) {
        walk(member, [...path, index]);
      }
      return;
    }
    if (!isJsonObject(value)) {
      return;
    }
    if (isMappedArray(value)) {
      const template: JxPath = [...path, "map"];
      const schema = itemSchemaAt(template, ctx);
      samples[JSON.stringify(path)] = describesItem(schema, ctx)
        ? sampleValue(schema, ctx, 0, [])
        : null;
      walk(value.map, template);
      return;
    }
    walk(value.children, [...path, "children"]);
    if (isJsonObject(value.cases)) {
      for (const [key, body] of Object.entries(value.cases)) {
        walk(body, [...path, "cases", key]);
      }
    }
  };
  walk(doc, []);
  return samples;
}
