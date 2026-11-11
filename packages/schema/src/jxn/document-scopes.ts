/**
 * Where a function body stands in a document, and what that says about its types (`spec.md` §23.3):
 * the `state` it reads, the row of a map it is drawn in, and the event its handler is given.
 *
 * The two files a checker reads, one body wrapped alone (`virtual-types.ts`) and a whole `.jxn`
 * document (`virtual-document.ts`), both ask here, so neither can say of the same body what the
 * other does not.
 *
 * Every type written here is a lookup that answers `any` when it finds nothing: a project with no
 * DOM library, an element the platform does not name, a list the document does not declare. A type
 * that failed instead would be an error on a line the author did not write.
 *
 * @docs framework/concepts/type-checking
 */
import { classifyFunctionEntries } from "../function-role";
import type { FunctionRole } from "../function-role";
import { isFunctionDef, isJsonObject, isNumber, isRef, isString } from "../guards";
import type { JsonObject, JsonValue, JxElement } from "../../types";
import { propertyName, stateOf, typeOfEntry } from "./state-types";

/** An element whose `state` a body can read. */
export interface StateScope {
  node: JsonObject;
  /** The scope around it, or null at the document's root. */
  parent: StateScope | null;
  /** Where the element is. The root is `""`. */
  pointer: string;
}

/** One map a body is drawn inside: what it repeats, and where that is read. */
export interface Row {
  /** What the map's `items` holds: a list, or a `$ref` to one. */
  items: JsonValue | undefined;
  /** The map around this one, whose row `$map/item` names in `items`. */
  parent: Row | null;
  /** The scope `items` is read in. */
  scope: StateScope;
}

/** What surrounds one value of a document. */
export interface Site {
  row: Row | null;
  scope: StateScope;
  /** Whether an element here is in the SVG namespace. */
  svg: boolean;
}

/** Members of a document that hold no element and no handler. */
const NOT_WALKED: ReadonlySet<string> = new Set(["$defs", "$script", "state", "style"]);

/** The interfaces a lookup reads, declared empty so that a project without the DOM library has them. */
const EVENT_GLOBALS = [
  "declare global {",
  "  interface HTMLElementEventMap {}",
  "  interface HTMLElementTagNameMap {}",
  "  interface SVGElementTagNameMap {}",
  "}",
  "",
].join("\n");

/** A JSON Pointer one step down. */
export function pointerInto(pointer: string, key: string | number): string {
  return `${pointer}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

/** The site of a document's root, which is a scope whether or not it has `state`. */
export function rootSite(doc: JsonObject): Site {
  return { row: null, scope: { node: doc, parent: null, pointer: "" }, svg: doc.tagName === "svg" };
}

/**
 * The site of a value one step down.
 *
 * @param site The site of `parent`.
 * @param parent The value stepped from.
 * @param key The member of `parent` stepped into.
 * @param child The value there.
 * @param pointer Where `child` is.
 */
export function siteInto(
  site: Site,
  parent: JsonValue | undefined,
  key: string | number,
  child: JsonValue | undefined,
  pointer: string,
): Site {
  // A map's element is drawn once for each item, and reads the row it is drawn for (§10.2).
  const row =
    key === "map" && isJsonObject(parent) && parent.$prototype === "Array"
      ? { items: parent.items, parent: site.row, scope: site.scope }
      : site.row;
  if (!isJsonObject(child)) {
    return { ...site, row };
  }
  const scope = stateOf(child) ? { node: child, parent: site.scope, pointer } : site.scope;
  const tag = child.tagName;
  // What `foreignObject` holds is HTML again, and it is not itself an element HTML names.
  const svg = isString(tag) ? tag !== "foreignObject" && (tag === "svg" || site.svg) : site.svg;
  return { row, scope, svg };
}

/**
 * Visit every object of a document that can hold a handler or a scope, with what surrounds it.
 *
 * @param doc The document.
 * @param visit Called for the root, then for each object below it, parents first.
 */
export function eachSite(
  doc: JsonObject,
  visit: (node: JsonObject, pointer: string, site: Site) => void,
): void {
  const walk = (value: JsonValue | undefined, pointer: string, site: Site): void => {
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const at = pointerInto(pointer, index);
        walk(item, at, siteInto(site, value, index, item, at));
      }
      return;
    }
    if (!isJsonObject(value)) {
      return;
    }
    visit(value, pointer, site);
    for (const [key, child] of Object.entries(value)) {
      if (!NOT_WALKED.has(key)) {
        const at = pointerInto(pointer, key);
        walk(child, at, siteInto(site, value, key, child, at));
      }
    }
  };
  walk(doc, "", rootSite(doc));
}

/** The names a scope's body can read: its own, and every one around it. */
function visibleKeys(scope: StateScope | null): Set<string> {
  const keys = new Set<string>();
  for (let at = scope; at; at = at.parent) {
    for (const key of Object.keys(stateOf(at.node) ?? {})) {
      keys.add(key);
    }
  }
  return keys;
}

/** What one scope's interface declares. */
export interface ScopeMembers {
  /**
   * The names of the scope around it that this one does not declare, when it declares one that
   * scope has. An interface cannot extend one it disagrees with, so these are listed by reference
   * instead. Null when nothing is shadowed, and the interface extends.
   */
  inherited: string[] | null;
  /** Its own entries, each with the role its document reads it in. */
  own: { entry: JsonValue | undefined; key: string; role: FunctionRole | undefined }[];
}

/** What a scope's interface declares, and how it stands to the one around it. */
export function membersOf(scope: StateScope): ScopeMembers {
  // SAFETY: a scope is an element, or a document, which is one with `$` members beside it.
  const roles = classifyFunctionEntries(scope.node as JxElement);
  const own = Object.entries(stateOf(scope.node) ?? {}).map(([key, entry]) => ({
    entry,
    key,
    role: roles.get(key),
  }));
  const around = visibleKeys(scope.parent);
  const shadows = own.some(({ key }) => around.has(key));
  return {
    inherited: shadows ? [...around].filter((key) => !own.some((mine) => mine.key === key)) : null,
    own,
  };
}

/**
 * What a path reads off a value's type, or `any` where the type does not say.
 *
 * @param base The type the path starts from.
 * @param path The members to read, outermost first.
 * @param object Whether `base` is an interface, which is never `null`.
 */
function typeAlong(base: string, path: readonly string[], object = false): string {
  let type = base;
  for (const [index, key] of path.entries()) {
    if (type === "any") {
      break;
    }
    const from = object && index === 0 ? type : `NonNullable<${type}>`;
    type = `(${from} extends { ${propertyName(key)}: infer V } ? V : any)`;
  }
  return type;
}

/** The segments of a JSON Pointer's path, unescaped. */
function segments(path: string): string[] {
  return path.split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** The path a `$ref` names under a prefix, or null when it names something else. */
function pathUnder(ref: string, prefix: string): string[] | null {
  if (ref === prefix) {
    return [];
  }
  return ref.startsWith(`${prefix}/`) ? segments(ref.slice(prefix.length + 1)) : null;
}

/** The type of what a map repeats: the list its `items` holds or names. */
function listType(row: Row, nameOf: (scope: StateScope) => string): string {
  const { items } = row;
  if (Array.isArray(items)) {
    return typeOfEntry(items);
  }
  if (!isRef(items)) {
    return "any";
  }
  const inState = pathUnder(items.$ref, "#/state");
  if (inState) {
    return typeAlong(nameOf(row.scope), inState, true);
  }
  // A list read off the row of the map around this one.
  const inRow = pathUnder(items.$ref, "$map/item") ?? pathUnder(items.$ref, "#/$map/item");
  return inRow && row.parent ? typeAlong(itemType(row.parent, nameOf), inRow) : "any";
}

/**
 * The type of one item of a map's list.
 *
 * @param row The map.
 * @param nameOf What a scope's interface is called where this is written.
 */
export function itemType(row: Row, nameOf: (scope: StateScope) => string): string {
  const list = listType(row, nameOf);
  return list === "any" ? "any" : `(NonNullable<${list}> extends readonly (infer I)[] ? I : any)`;
}

/** Whether a body in a scope can be told what `$map` is: no `state` around it has a `$map`. */
export function readsRow(scope: StateScope): boolean {
  return !visibleKeys(scope).has("$map");
}

/**
 * Events that do not bubble (UI Events, and the HTML Standard's element and media events), so a
 * handler is given one only when it started on the handler's own element.
 */
const NOT_BUBBLING: ReadonlySet<string> = new Set([
  "blur",
  "focus",
  "mouseenter",
  "mouseleave",
  "pointerenter",
  "pointerleave",
  "load",
  "error",
  "scroll",
  "scrollend",
  "toggle",
  "invalid",
  "close",
  "canplay",
  "canplaythrough",
  "durationchange",
  "emptied",
  "ended",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "pause",
  "play",
  "playing",
  "progress",
  "ratechange",
  "seeked",
  "seeking",
  "stalled",
  "suspend",
  "timeupdate",
  "volumechange",
  "waiting",
]);

/** Whether nothing an element holds is an element, so an event on it started on it. */
function isLeaf(element: JsonObject): boolean {
  const { children } = element;
  const texts = children === undefined ? [] : Array.isArray(children) ? children : [children];
  return (
    element.innerHTML === undefined && texts.every((child) => isString(child) || isNumber(child))
  );
}

/** Whether an event a handler on an element is given can only have started on that element. */
function startsHere(element: JsonObject, name: string): boolean {
  // What a `select` holds are its choices, and a choice made is the control's own event.
  const control = element.tagName === "select" && (name === "change" || name === "input");
  return control || NOT_BUBBLING.has(name) || isLeaf(element);
}

/**
 * The type of the event an `on*` handler on an element is given.
 *
 * It is the event the platform names for the binding, on the element the platform names for the
 * tag: `any` where it names either one not at all, as for a custom element, whose events are its
 * own. Its `target` is the element too where the two cannot differ: nothing inside it is an
 * element, or the event does not bubble.
 *
 * @param element The element the handler is on.
 * @param key The binding, such as `onclick`.
 * @param site What surrounds the element.
 */
export function eventType(element: JsonObject, key: string, site: Site): string {
  const tag = element.tagName;
  if (!isString(tag)) {
    return "any";
  }
  const elements = site.svg ? "SVGElementTagNameMap" : "HTMLElementTagNameMap";
  const name = key.slice(2);
  const members = startsHere(element, name)
    ? "readonly currentTarget: T; readonly target: T"
    : "readonly currentTarget: T";
  const named = `HTMLElementEventMap extends { ${propertyName(name)}: infer E }`;
  return `(${elements} extends { ${propertyName(tag)}: infer T } ? ${named} ? E & { ${members} } : any : any)`;
}

/** How a body's event is written. */
export interface EventLines {
  /** The lines that declare `event`, before the function. */
  head: string;
  /** The type of the parameter that receives it. */
  parameter: string;
}

/**
 * How a body's event is written.
 *
 * @param event Its type.
 * @param params The names the body is called with, `state` first.
 */
export function eventLines(event: string, params: readonly string[]): EventLines {
  if (event === "any") {
    return { head: "declare const event: any;\n", parameter: "any" };
  }
  // A parameter called `event` hides the declared one, so it cannot be typed by the name it hides.
  return params[1] === "event"
    ? { head: EVENT_GLOBALS, parameter: event }
    : { head: `${EVENT_GLOBALS}declare const event: ${event};\n`, parameter: "typeof event" };
}

/** The scope that declares a name a `$ref` reads, from the innermost out. */
function declaringScope(scope: StateScope, key: string): StateScope | null {
  for (let at: StateScope | null = scope; at; at = at.parent) {
    if (Object.hasOwn(stateOf(at.node) ?? {}, key)) {
      return at;
    }
  }
  return null;
}

/** One `on*` binding that names a `state` function. */
interface Binding {
  /** The function it names, as the pointer to its entry. */
  entry: string;
  key: string;
  type: string;
}

/**
 * The event each `state` function is given, for those the document binds as handlers and nothing
 * else.
 *
 * A function a handler names by `$ref` receives that binding's event, and one bound in several
 * places receives any of theirs. A function whose name is written anywhere else in the document (a
 * body, a template, the script, another reference) may be called with something that is no event,
 * so it is left out, and its parameters stay `any`.
 *
 * @param doc The document.
 * @returns The type by the pointer to each function's entry.
 */
export function boundEvents(doc: JsonObject): Map<string, string> {
  const bindings: Binding[] = [];
  const refs = new Set<JsonValue>();
  eachSite(doc, (node, _pointer, site) => {
    for (const [key, value] of Object.entries(node)) {
      const path = key.startsWith("on") && isRef(value) ? pathUnder(value.$ref, "#/state") : null;
      const [name, ...deeper] = path ?? [];
      const declared = name === undefined ? null : declaringScope(site.scope, name);
      if (name !== undefined && declared && deeper.length === 0) {
        const entry = pointerInto(pointerInto(declared.pointer, "state"), name);
        if (isFunctionDef(stateOf(declared.node)?.[name])) {
          bindings.push({ entry, key: name, type: eventType(node, key, site) });
          refs.add(value);
        }
      }
    }
  });
  if (bindings.length === 0) {
    return new Map();
  }
  // Every string the document holds, keys and the bindings themselves left out.
  const strings: string[] = [];
  const gather = (value: JsonValue | undefined): void => {
    if (isString(value)) {
      strings.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        gather(item);
      }
    } else if (isJsonObject(value) && !refs.has(value)) {
      for (const item of Object.values(value)) {
        gather(item);
      }
    }
  };
  gather(doc);
  const said = strings.join("\n");
  const types = new Map<string, Set<string>>();
  for (const { entry, key, type } of bindings) {
    const escaped = key.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
    if (!new RegExp(String.raw`(?<![\w$])${escaped}(?![\w$])`, "u").test(said)) {
      types.set(entry, (types.get(entry) ?? new Set()).add(type));
    }
  }
  return new Map([...types].map(([entry, each]) => [entry, [...each].join(" | ")]));
}
