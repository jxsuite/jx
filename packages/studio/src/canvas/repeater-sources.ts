/**
 * The data a repeater is drawn from in Edit and Design, resolved before the canvas renders.
 *
 * Edit mode draws a repeater as one instance of its row template, with the repeater's first item as
 * that instance's sample row (`utils/edit-display.ts`). A collection is a class-backed state entry
 * (`ContentCollection`) the canvas runtime resolves through the dev proxy AFTER its first render,
 * so the instance connected with an empty row: a component that formats a date or a locale threw,
 * was reported as not rendered, and drew itself only when the data arrived. Resolving the entry
 * here, the way `page-params.ts` bakes a param-bound entry for Preview, puts the row in the state
 * the canvas builds its scope from, so the first render is a render of the data.
 *
 * The same resolution serves every mode for an entry that names an enabled extension's class by a
 * bare `$prototype` ({@link extensionClassKeys}), which the build also resolves before rendering.
 *
 * Only an entry whose configuration holds no template is baked: one that does is re-resolved by the
 * runtime whenever what it reads changes, and a baked copy would freeze it. Answers are cached by
 * the entry's configuration until the project's content changes ({@link
 * invalidateRepeaterSources}).
 *
 * @docs studio/interface/canvas
 */

import { isJsonObject, isNodeObject, isRef, isString } from "@jxsuite/schema/guards";
import { getPlatform } from "../platform";
import type {
  JsonObject,
  JsonValue,
  JxDocumentValue,
  JxMutableNode,
  JxStateDefinition,
} from "@jxsuite/schema/types";

/** What the backend answered for one entry, or `null` when it could not resolve it. */
type Resolved = JsonValue | null;

/** Resolved entries by their request body, so a re-render does not ask the backend again. */
let _cache = new Map<string, Promise<Resolved>>();

/** Forget every resolved entry; the next render asks the backend again. */
export function invalidateRepeaterSources(): void {
  _cache = new Map();
}

/** The top-level state key a `#/state/<key>/…` pointer reads, or null for any other pointer. */
function stateKeyOf(ref: string): string | null {
  if (!ref.startsWith("#/state/")) {
    return null;
  }
  const [key] = ref.slice("#/state/".length).split("/");
  return key ? key.replaceAll("~1", "/").replaceAll("~0", "~") : null;
}

/** Whether a configuration value holds a `${…}` template anywhere inside it. */
function holdsTemplate(value: JsonValue | undefined): boolean {
  if (isString(value)) {
    return value.includes("${");
  }
  if (Array.isArray(value)) {
    return value.some((member) => holdsTemplate(member));
  }
  return isJsonObject(value) && Object.values(value).some((member) => holdsTemplate(member));
}

/** Extension class names to their descriptor paths, as `getEffectiveImports` merges them. */
export type ClassPaths = Readonly<Record<string, string>>;

/**
 * The `$src` a class-backed state entry resolves from: its own, else the enabled extension class
 * its bare `$prototype` names (spec.md §12.5), else null.
 */
function classSourceOf(entry: JsonObject, classes: ClassPaths): string | null {
  if (isString(entry.$src)) {
    return entry.$src;
  }
  return isString(entry.$prototype) && Object.hasOwn(classes, entry.$prototype)
    ? (classes[entry.$prototype] ?? null)
    : null;
}

/** Whether a state entry is a class-backed source the backend can resolve once, for good. */
function isStaticClassEntry(
  entry: JxStateDefinition | undefined,
  classes: ClassPaths = {},
): entry is JsonObject {
  return (
    isJsonObject(entry) &&
    isString(entry.$prototype) &&
    classSourceOf(entry, classes) !== null &&
    !holdsTemplate(entry)
  );
}

/**
 * The state keys of `doc` that name an enabled extension's class by a bare `$prototype` (a layout's
 * `{ "$prototype": "ContentEntry", ... }`) and can be resolved once.
 *
 * The build resolves these before any template runs (`compiler/src/site/prototype-resolver.ts`).
 * Left to the canvas runtime, the class's descriptor path, a file on disk, was first fetched as a
 * URL of the canvas, answered 404, and only then asked of the dev proxy: one failed request per
 * entry per render, on every page of a site whose layout reads its navigation this way.
 */
export function extensionClassKeys(doc: JxMutableNode, classes: ClassPaths): string[] {
  return Object.entries(doc.state ?? {})
    .filter(
      ([, entry]) =>
        isJsonObject(entry) && !isString(entry.$src) && isStaticClassEntry(entry, classes),
    )
    .map(([key]) => key);
}

/**
 * The state keys `doc`'s repeaters read their items from, among them only the class-backed entries
 * {@link bakeRepeaterSources} can resolve.
 */
export function repeaterSourceKeys(doc: JxMutableNode): string[] {
  const keys = new Set<string>();
  const walk = (value: JxDocumentValue | undefined): void => {
    if (Array.isArray(value)) {
      for (const member of value) {
        walk(member);
      }
      return;
    }
    if (!isNodeObject(value)) {
      return;
    }
    if (value.$prototype === "Array" && isRef(value.items)) {
      const key = stateKeyOf(value.items.$ref);
      if (key) {
        keys.add(key);
      }
    }
    walk(value.map);
    walk(value.children);
    for (const branch of Object.values(value.cases ?? {})) {
      walk(branch);
    }
  };
  walk(doc.children);
  const state = doc.state ?? {};
  return [...keys].filter((key) => isStaticClassEntry(state[key]));
}

/** Say why an entry could not be resolved, and answer that it was not. */
function unresolved(key: string, error: Error | string): Resolved {
  console.warn(`canvas: could not resolve state.${key} before the render:`, error);
  return null;
}

/**
 * `renderDoc` with each of `keys` replaced by its resolved value, or `renderDoc` itself when there
 * is nothing to resolve. A rebuild, never a write: the render document shares its `state` with the
 * tab's source document. An entry the backend cannot resolve is left as written, and the runtime's
 * own resolution remains the fallback.
 */
export async function bakeRepeaterSources(
  renderDoc: JxMutableNode,
  keys: readonly string[],
  docBase?: string,
  classes: ClassPaths = {},
): Promise<JxMutableNode> {
  const platform = getPlatform();
  const { resolveClass } = platform;
  const source = renderDoc.state;
  if (keys.length === 0 || !resolveClass || !source) {
    return renderDoc;
  }
  const state = { ...source };
  await Promise.all(
    keys.map(async (key) => {
      const entry = state[key];
      if (!isStaticClassEntry(entry, classes)) {
        return;
      }
      const body: JsonObject = { ...entry, $src: classSourceOf(entry, classes) };
      if (docBase) {
        body.$base = docBase;
      }
      const id = JSON.stringify(body);
      let pending = _cache.get(id);
      if (!pending) {
        pending = resolveClass.call(platform, body).then(
          (value): Resolved => value ?? null,
          (error: Error | string) => {
            _cache.delete(id);
            return unresolved(key, error);
          },
        );
        _cache.set(id, pending);
      }
      const value = await pending;
      if (value !== null) {
        /* SAFETY: the backend answers with the class's resolved JSON value (no `$prototype`), which
           the runtime reads as a naked-value state entry, so it is a JxStateDefinition. */
        state[key] = value as JxStateDefinition;
      }
    }),
  );
  return { ...renderDoc, state };
}
