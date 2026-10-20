/**
 * What a component's live preview is drawn with.
 *
 * A preview instance used to be given nothing, so it drew its definition's DEFAULTS, and a starter
 * component's defaults are empty strings: a page header with no title, a band with no label, a card
 * with no name. A component is only ever seen with props, so the preview asks where it has been
 * given some, in this order:
 *
 * 1. The definition's own `examples`: the JSON Schema keyword a typed state entry may carry (`spec.md`
 *    §5.3, Shape 2), whose first value is the author's own sample.
 * 2. Its first use in the project that passes literal values: the reference index names the files that
 *    use the tag, and the instance among them that passes the most literal props is the likeliest
 *    to draw the component as the author meant it. A bound prop (`${…}`, `$ref`) has no value
 *    outside the page that binds it, so it is not one.
 * 3. A list that draws it ({@link componentSampleRow}): a component used only as a repeater's row,
 *    every prop bound to the row, is drawn as that list's first row, with the list's data.
 *
 * Only a prop the definition declares, and that is not private (`spec.md` §5.6), is taken. Files in
 * the project's default language are read before translations, so a preview reads in the language
 * the site is written in first.
 *
 * @docs studio/interface
 */

import {
  isJsonObject,
  isNodeObject,
  isPrivateStateKey,
  isRef,
  isString,
} from "@jxsuite/schema/guards";
import { localeOfPath, resolveI18n } from "@jxsuite/schema/locale";
import { getPlatform } from "../platform";
import { formatForPath, loadFormats } from "../format/format-host";
import { parseSourceForPath } from "../files/file-ops";
import { loadUsages } from "../services/references";
import { documentBase } from "../canvas/canvas-origin";
import { bakeRepeaterSources } from "../canvas/repeater-sources";
import { pageContextFor } from "../canvas/canvas-page-context";
import { projectState } from "../store";
import type { JsonValue, JxDocument, JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/** A component's sample props, by state key. */
export type ExampleProps = Map<string, JsonValue>;

/** How many of the files that use a component are read for an instance to draw it from. */
const USAGE_FILES_READ = 4;

/** Whether a value is plain data a prop can hold outside any page: no template, no binding. */
export function isLiteralProp(value: JxDocumentValue | undefined): value is JsonValue {
  if (value === undefined) {
    return false;
  }
  if (isString(value)) {
    return !value.includes("${");
  }
  if (Array.isArray(value)) {
    return value.every((member) => isLiteralProp(member));
  }
  if (isJsonObject(value)) {
    return (
      !("$ref" in value) &&
      !("$prototype" in value) &&
      !("$expression" in value) &&
      Object.values(value).every((member) => isLiteralProp(member))
    );
  }
  return true;
}

/** The definition's public prop keys: its state entries, without the private ones. */
function propKeys(definition: JxDocument): Set<string> {
  return new Set(Object.keys(definition.state ?? {}).filter((key) => !isPrivateStateKey(key)));
}

/** The first `examples` value of each typed state entry that declares one. */
export function declaredExamples(definition: JxDocument): ExampleProps {
  const out: ExampleProps = new Map();
  for (const [key, entry] of Object.entries(definition.state ?? {})) {
    if (isPrivateStateKey(key) || !isJsonObject(entry) || !Array.isArray(entry.examples)) {
      continue;
    }
    const [first] = entry.examples;
    if (isLiteralProp(first)) {
      out.set(key, first);
    }
  }
  return out;
}

/** Every node of a tree, each with the repeater (if any) whose row template holds it. */
function eachNode(
  tree: JxDocumentValue | undefined,
  visit: (node: JxMutableNode, repeater: JxMutableNode | null) => void,
): void {
  const walk = (value: JxDocumentValue | undefined, repeater: JxMutableNode | null): void => {
    if (Array.isArray(value)) {
      for (const member of value) {
        walk(member, repeater);
      }
      return;
    }
    if (!isNodeObject(value)) {
      return;
    }
    visit(value, repeater);
    walk(value.children, repeater);
    walk(value.map, value.$prototype === "Array" ? value : repeater);
    for (const branch of Object.values(value.cases ?? {})) {
      walk(branch, repeater);
    }
  };
  walk(tree, null);
}

/**
 * The literal props of the instance of `tagName` in `tree` that passes the most of them, among the
 * keys the definition declares; empty when no instance passes any.
 */
export function literalUsageProps(
  tree: JxDocumentValue | undefined,
  tagName: string,
  keys: ReadonlySet<string>,
): ExampleProps {
  let best: ExampleProps = new Map();
  eachNode(tree, (node) => {
    if (node.tagName !== tagName || !isJsonObject(node.$props)) {
      return;
    }
    const found: ExampleProps = new Map();
    for (const [key, prop] of Object.entries(node.$props)) {
      if (keys.has(key) && isLiteralProp(prop)) {
        found.set(key, prop);
      }
    }
    if (found.size > best.size) {
      best = found;
    }
  });
  return best;
}

/** One project document as a tree, or null when it cannot be read or parsed. */
async function readTree(path: string): Promise<JxMutableNode | null> {
  try {
    const content = await getPlatform().readFile(path);
    await loadFormats();
    let tree: JxDocumentValue;
    if (formatForPath(path)) {
      const parsed = await parseSourceForPath(path, content);
      tree = parsed.document;
    } else if (path.endsWith(".json")) {
      /* SAFETY: a `.json` project document is JSON, and every read of it below is guarded. */
      tree = JSON.parse(content) as JxDocumentValue;
    } else {
      return null;
    }
    return isNodeObject(tree) ? tree : null;
  } catch {
    return null;
  }
}

/** The files that use a component, default language first, at most {@link USAGE_FILES_READ}. */
async function usageFiles(path: string, tagName: string): Promise<string[]> {
  const usages = await loadUsages({ path, tagName });
  if (usages.status !== "ready") {
    return [];
  }
  const { i18n } = resolveI18n(projectState?.projectConfig ?? {});
  const translated = (file: string): boolean => {
    const locale = localeOfPath(file, i18n);
    return locale !== null && locale !== i18n?.defaultLocale;
  };
  const files = usages.result.files.map((file) => file.path);
  return [
    ...files.filter((file) => !translated(file)),
    ...files.filter((file) => translated(file)),
  ].slice(0, USAGE_FILES_READ);
}

/** The props a component's preview instance is given (sources 1 and 2 of the module comment). */
export async function componentExampleProps(
  definition: JxDocument,
  path: string,
): Promise<ExampleProps> {
  const keys = propKeys(definition);
  const tagName = isString(definition.tagName) ? definition.tagName : null;
  const examples = declaredExamples(definition);
  if (!tagName || keys.size === 0) {
    return examples;
  }
  let best: ExampleProps = new Map();
  for (const file of await usageFiles(path, tagName)) {
    const found = literalUsageProps(await readTree(file), tagName, keys);
    if (found.size > best.size) {
      best = found;
    }
  }
  // The author's own sample wins over a page's value for the same prop.
  return new Map([...best, ...examples]);
}

/** A sample-row document, and the file whose list it draws (its relative refs resolve there). */
export interface SampleRow {
  doc: JxDocument;
  file: string;
}

/** The state key a repeater reads its whole list from (`#/state/shows`), or null. */
function listKeyOf(repeater: JxMutableNode): string | null {
  const { items } = repeater;
  if (!isRef(items) || !items.$ref.startsWith("#/state/")) {
    return null;
  }
  const key = items.$ref.slice("#/state/".length);
  return key !== "" && !key.includes("/") ? key : null;
}

/**
 * A document that draws the first row of a list using the component (source 3 of the module
 * comment), or null when no file that uses it has one: the list's repeater, its data resolved the
 * way the canvas resolves it for Edit (`canvas/repeater-sources.ts`) and cut to its first item, in
 * the page's own state and `$site` / `$page`.
 */
export async function componentSampleRow(
  definition: JxDocument,
  path: string,
): Promise<SampleRow | null> {
  const tagName = isString(definition.tagName) ? definition.tagName : null;
  if (!tagName) {
    return null;
  }
  for (const file of await usageFiles(path, tagName)) {
    const tree = await readTree(file);
    const lists: JxMutableNode[] = [];
    eachNode(tree, (node, repeater) => {
      if (node.tagName === tagName && repeater && listKeyOf(repeater)) {
        lists.push(repeater);
      }
    });
    const [list] = lists;
    const key = list ? listKeyOf(list) : null;
    if (!tree || !list || !key) {
      continue;
    }
    const baked = await bakeRepeaterSources(
      tree,
      [key],
      new URL(file, documentBase(projectState?.projectRoot)).href,
    );
    const rows = baked.state?.[key];
    if (!Array.isArray(rows) || rows.length === 0) {
      continue;
    }
    const context = file.startsWith("pages/")
      ? await pageContextFor(
          { documentPath: file, isEntry: false, lang: tree.$lang, title: tree.title },
          projectState?.projectConfig,
        )
      : null;
    return {
      doc: {
        children: [list],
        state: { ...baked.state, [key]: rows.slice(0, 1), ...context },
        tagName: "div",
      },
      file,
    };
  }
  return null;
}
