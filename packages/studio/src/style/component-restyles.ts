/**
 * Which project components restyle an element their own way (studio.md §7.4).
 *
 * An element default in Project Styles reaches every `<button>` on the site, except where a
 * component carries a rule of its own for the buttons it draws. Those are the places an edit here
 * will not show, so the Style tab names them beside the edit, each with a way to open it.
 *
 * A component restyles a tag when a style key anywhere in its definition selects that tag (the bare
 * nested key `button`, `& button`, `.cta > button:hover`), or when a node of that tag in its tree
 * carries a style of its own. The definitions are read once per component registry, which is
 * replaced whenever the project's components are re-read, so a definition saved since is read again
 * then.
 *
 * @docs studio/design/stylebook
 */

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { componentRegistry } from "../files/components";
import { reactive } from "../reactivity";
import type { ComponentEntry } from "../files/components";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

/** One component that restyles the element, as the Style tab lists it. */
export interface ComponentRestyle {
  /** Its custom element name, `site-newsletter`. */
  tagName: string;
  /** Its definition file, project-relative: what **Open** opens. */
  path: string;
}

/** Whether a selector, or a nested style key, selects `tag` somewhere in it. */
export function selectorNamesTag(selector: string, tag: string): boolean {
  const escaped = tag.replaceAll(/[.*+?^${}()|[\]\\-]/g, String.raw`\$&`);
  return new RegExp(String.raw`(?:^|[\s>+~&(,])${escaped}(?=$|[\s:.\[#>+~),])`, "u").test(selector);
}

/** Whether a style block, or any block nested in it, has a key selecting `tag`. */
function styleNamesTag(style: JsonValue | undefined, tag: string): boolean {
  if (!isJsonObject(style)) {
    return false;
  }
  return Object.entries(style).some(
    ([key, value]) =>
      isJsonObject(value) && (selectorNamesTag(key, tag) || styleNamesTag(value, tag)),
  );
}

/** Whether a style value holds at least one declaration or rule. */
function hasStyle(style: JsonValue | undefined): boolean {
  return isJsonObject(style) && Object.keys(style).length > 0;
}

/** Whether a definition's tree restyles `tag`: by a rule naming it, or a styled node of it. */
export function restylesTag(
  node: JxDocument | JsonValue | undefined,
  tag: string,
  root = true,
): boolean {
  if (!isJsonObject(node)) {
    return false;
  }
  if (styleNamesTag(node.style, tag)) {
    return true;
  }
  // The root is the component's own element, never one of the tags it draws inside.
  if (!root && node.tagName === tag && hasStyle(node.style)) {
    return true;
  }
  const { children } = node;
  return Array.isArray(children) && children.some((child) => restylesTag(child, tag, false));
}

/**
 * A definition, read the way the Site panel's previews read one. The reader is loaded when first
 * asked for rather than imported: it brings the canvas's asset resolution with it, which the Style
 * tab has no other use for. One load, shared, so concurrent reads never import it twice at once.
 */
let reader: Promise<(path: string) => Promise<JxDocument | null>> | null = null;
function readFromProject(path: string): Promise<JxDocument | null> {
  reader ??= import("../browse/library-preview").then((module) => module.readDefinition);
  return reader.then((read) => read(path));
}

/** The definitions read for one registry, by path, so a second tag asks no file twice. */
const definitions = new WeakMap<
  readonly ComponentEntry[],
  Map<string, Promise<JxDocument | null>>
>();

/**
 * What has been answered, by tag: the reactive half the Style tab reads. The registry it was
 * answered for is kept beside it, raw: a reactive copy of the array would never be the array.
 */
const answers = reactive<{ byTag: Record<string, ComponentRestyle[]> }>({ byTag: {} });
let answeredFor: readonly ComponentEntry[] | null = null;

/** The tags whose answer is being read, so a repaint while it is does not read it again. */
const pending = new Set<string>();

/**
 * Read which of a registry's components restyle `tag`, in registry order. Only a component the
 * project defines in a file is read: an npm package's definition is not the project's to change.
 */
export async function loadComponentRestyles(
  registry: readonly ComponentEntry[],
  tag: string,
  read: (path: string) => Promise<JxDocument | null> = readFromProject,
): Promise<ComponentRestyle[]> {
  let known = definitions.get(registry);
  if (!known) {
    known = new Map();
    definitions.set(registry, known);
  }
  const cache = known;
  const found = await Promise.all(
    registry.map(async (component): Promise<ComponentRestyle | null> => {
      const { path } = component;
      if (component.source === "npm" || !isString(path) || path === "") {
        return null;
      }
      let definition = cache.get(path);
      if (!definition) {
        definition = read(path).catch(() => null);
        cache.set(path, definition);
      }
      const doc = await definition;
      return doc && restylesTag(doc, tag) ? { path, tagName: component.tagName } : null;
    }),
  );
  return found.filter((entry): entry is ComponentRestyle => entry !== null);
}

/**
 * The components that restyle `tag`, for a view to draw: the answer when it is known, and an empty
 * list while it is read (the view is redrawn when it lands, because the answer is reactive).
 */
export function componentRestyles(
  tag: string,
  read?: (path: string) => Promise<JxDocument | null>,
): ComponentRestyle[] {
  const registry = componentRegistry;
  if (answeredFor !== registry) {
    answeredFor = registry;
    answers.byTag = {};
    pending.clear();
  }
  const known = answers.byTag[tag];
  if (known) {
    return known;
  }
  if (!pending.has(tag)) {
    pending.add(tag);
    void loadComponentRestyles(registry, tag, read).then((found) => {
      if (answeredFor === registry) {
        answers.byTag = { ...answers.byTag, [tag]: found };
      }
      pending.delete(tag);
    });
  }
  return [];
}
