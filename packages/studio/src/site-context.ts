/// <reference lib="dom" />
/**
 * Site context helpers - merge site-level definitions with file-level.
 *
 * When a project has a project.json, its $media and style cascade into every file. File-level
 * definitions merge on top (file wins on conflict).
 *
 * @docs framework/site/i18n
 */

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { projectState } from "./store";
import { getPlatform } from "./platform";
import { commitProjectConfig } from "./tabs/project-config";

import { canonicalizeLocale, localeOfPath, resolveI18n } from "@jxsuite/schema/locale";
import type { ResolvedI18n } from "@jxsuite/schema/locale";
import type {
  JxElement,
  JxHeadEntry,
  JxMutableNode,
  JxStyle,
  ProjectConfig,
} from "@jxsuite/schema/types";
import type { ExtensionsInfo } from "./types";

/**
 * Merge site $media with document $media. Document keys win on conflict.
 *
 * @param {Record<string, string> | undefined} docMedia - The current document's $media (may be
 *   undefined)
 * @returns {Record<string, string>}
 */
export function getEffectiveMedia(docMedia?: Record<string, string>) {
  const siteMedia = projectState?.projectConfig?.$media;
  if (!siteMedia) {
    return docMedia || {};
  }
  if (!docMedia) {
    return { ...siteMedia };
  }
  return { ...siteMedia, ...docMedia };
}

/**
 * Merge site style with document style. Document keys win on conflict. Nested selector objects
 * (e.g. `& li`) are shallow-merged individually.
 *
 * @param {JxStyle | undefined} docStyle - The current document's style (may be undefined)
 * @returns {JxStyle}
 */
export function getEffectiveStyle(docStyle?: JxStyle) {
  const siteStyle = projectState?.projectConfig?.style;
  if (!siteStyle) {
    return docStyle || {};
  }
  if (!docStyle) {
    return { ...siteStyle };
  }
  const merged = { ...siteStyle };
  for (const [k, v] of Object.entries(docStyle)) {
    const base = merged[k];
    merged[k] = isNonNullObject(v) && isNonNullObject(base) ? { ...base, ...v } : v;
  }
  return merged;
}

/**
 * Merge site imports with document imports. Document keys win on conflict.
 *
 * @param {Record<string, string> | undefined} docImports - The current document's imports (may be
 *   undefined)
 * @returns {Record<string, string>}
 */
export function getEffectiveImports(
  docImports?: Record<string, string>,
  extensions: readonly ExtensionsInfo[] = [],
) {
  /* The enabled extensions' manifest classes come last in the order the build resolves a bare
     `$prototype` in (spec.md §12.5: the document's `imports`, then the project's, then the
     extension registry), so they are the base the other two are spread over. Without them a
     layout's `{ "$prototype": "ContentEntry" }` named a class the build knows and the canvas did
     not, and the canvas warned of an unknown prototype and drew the layout with no data. The
     first extension to declare a name keeps it, as the registry's `byName` answers. */
  return {
    ...extensionClassPaths(extensions),
    ...projectState?.projectConfig?.imports,
    ...docImports,
  };
}

/**
 * The enabled extensions' manifest classes, by name, as descriptor paths: the last step of the
 * build's bare-`$prototype` resolution (spec.md §12.5). The first extension to declare a name keeps
 * it, as the registry's `byName` answers.
 */
export function extensionClassPaths(extensions: readonly ExtensionsInfo[]) {
  const classes = extensions.flatMap((extension) =>
    (extension.classes ?? [])
      .filter((cls) => cls.path.endsWith(".class.json"))
      .map((cls): [string, string] => [cls.name, cls.path]),
  );
  return Object.fromEntries(classes.toReversed());
}

/**
 * Merge site $elements with document $elements. Union with dedup by $ref or string value.
 *
 * @param {(JxElement | string)[]} [docElements] - The current document's $elements (may be
 *   undefined)
 * @returns {(JxElement | string)[]}
 */
export function getEffectiveElements(docElements?: (JxElement | string)[]) {
  const siteElements = projectState?.projectConfig?.$elements;
  if (!siteElements?.length) {
    return docElements || [];
  }
  if (!docElements?.length) {
    return [...siteElements];
  }
  const seen = new Set<string>();
  const merged: (JxElement | string)[] = [];
  for (const entry of [...siteElements, ...docElements]) {
    // A null entry in hand-edited JSON has no key, and is skipped rather than thrown on.
    const key = isString(entry) ? entry : isNonNullObject(entry) ? entry.$ref : undefined;
    if (key && !seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * Merge site $head with document $head. Union with dedup by href/src.
 *
 * @param {JxHeadEntry[]} [docHead] - The current document's $head (may be undefined)
 * @returns {JxHeadEntry[]}
 */
export function getEffectiveHead(docHead?: JxHeadEntry[]) {
  const siteHead = projectState?.projectConfig?.$head;
  if (!siteHead?.length) {
    return docHead || [];
  }
  if (!docHead?.length) {
    return [...siteHead];
  }
  const seen = new Set<string>();
  const merged: JxHeadEntry[] = [];
  for (const entry of [...siteHead, ...docHead]) {
    // A null entry in hand-edited JSON is keyed by its serialisation, like any entry without a URL.
    const attributes = isNonNullObject(entry) ? entry.attributes : undefined;
    const key = String(attributes?.href || attributes?.src || "") || JSON.stringify(entry);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

/**
 * The project's resolved locales, or null when it declares none.
 *
 * The resolution is `@jxsuite/schema/locale`'s own — literally the function the compiler runs — so
 * a tag Studio offers is a tag the build accepts, and the two cannot drift into disagreeing about
 * what `EN-us` means or which locales exist.
 *
 * Errors are dropped here on purpose. Every helper in this file answers a render, and a render has
 * nowhere to put a sentence; `settings/locales-section.ts` is where a malformed tag is refused with
 * words, before it can reach the file.
 *
 * Called at render time rather than cached: `projectState` is a plain module-level binding replaced
 * wholesale on a project switch, so a cached answer would outlive the project it described.
 *
 * @returns {ResolvedI18n | null}
 */
export function getEffectiveLocales(): ResolvedI18n | null {
  const config = projectState?.projectConfig;
  return config ? resolveI18n(config).i18n : null;
}

/**
 * The language a pane renders in (studio.md §20.2), the one answer the context bar's Language
 * segment, every artboard's `render` and the live push all read.
 *
 * The author's choice while the project declares it, else the document's own: the locale its path
 * sits under (`site-architecture.md` §13.3 puts a translation in its own directory, so
 * `pages/ar/about.json` and `content/exhibitions/ar/x.md` are Arabic), else the default locale,
 * which is what an unprefixed page renders as. Null for a project that declares no locales.
 *
 * A stored choice the project no longer declares answers as if none were made, the counterpart of
 * `i18n.switchLocale` refusing one on the way in; the stored value is left alone, so a locale that
 * is declared again comes back. Answering with the document's own language when nothing is chosen
 * is what makes an Arabic translation mirror as soon as it is opened: before, the artboard drew it
 * left to right until the author picked Arabic from a control already showing Arabic.
 *
 * @param previewLocale - The pane's choice (`session.ui.previewLocale`), or null.
 * @param documentPath - The project-relative path of the document being drawn.
 */
export function getEffectiveRenderLocale(
  previewLocale: string | null | undefined,
  documentPath: string | null | undefined,
): string | null {
  const i18n = getEffectiveLocales();
  if (i18n === null) {
    return null;
  }
  const chosen = canonicalizeLocale(previewLocale);
  if (chosen !== null && i18n.locales.includes(chosen)) {
    return chosen;
  }
  return localeOfPath(documentPath ?? "", i18n) ?? i18n.defaultLocale;
}

// ─── Layout resolution ──────────────────────────────────────────────────────

const layoutCache = new Map<string, JxMutableNode>();

export function invalidateLayoutCache() {
  layoutCache.clear();
}

/**
 * Determine the effective layout path for a document.
 *
 * @param {string | false | undefined} docLayout - The document's $layout value (string path, false,
 *   or undefined)
 * @returns {string | null} The layout path, or null if no layout applies
 */
export function getEffectiveLayoutPath(docLayout: string | false | undefined) {
  if (docLayout === false) {
    return null;
  }
  const defaultLayout = projectState?.projectConfig?.defaults?.layout;
  return docLayout || defaultLayout || null;
}

/**
 * Resolve a layout document by path. Fetches and caches the parsed JSON.
 *
 * @param {string} layoutPath - Relative path to the layout file (e.g., "./layouts/base.json")
 * @returns {Promise<JxMutableNode | null>} The parsed layout document, or null on failure
 */
export async function resolveLayoutDoc(layoutPath: string) {
  const normalized = layoutPath.replace(/^\.\//, "");
  const cached = layoutCache.get(normalized);
  if (cached !== undefined) {
    return structuredClone(cached);
  }

  try {
    const platform = getPlatform();
    const content = await platform.readFile(normalized);
    /* SAFETY: a `$layout` target is a Jx document file, which is a JSON element object; the slot
       walk that consumes it checks `children` is an array before reading any of it. */
    const doc = JSON.parse(content) as JxMutableNode;
    layoutCache.set(normalized, doc);
    return structuredClone(doc);
  } catch {
    return null;
  }
}

/**
 * Distribute page children into a layout document's <slot> elements. Returns the merged document
 * with page content injected into slots.
 *
 * @param {JxMutableNode} layoutDoc - Deep-cloned layout document
 * @param {JxMutableNode} pageDoc - The page document
 * @returns {JxMutableNode} The merged document
 */
export function distributePageIntoLayout(layoutDoc: JxMutableNode, pageDoc: JxMutableNode) {
  const pageChildren = pageDoc.children ?? [];
  const children = Array.isArray(pageChildren) ? pageChildren : [];

  const named = new Map<string, JxMutableNode[]>();
  const defaults: (JxMutableNode | string)[] = [];

  for (const child of children) {
    const slotName = isString(child) ? undefined : child.attributes?.slot;
    if (!isString(child) && isString(slotName) && slotName) {
      if (!named.has(slotName)) {
        named.set(slotName, []);
      }
      named.get(slotName)!.push(child);
    } else {
      defaults.push(child);
    }
  }

  fillSlots(layoutDoc, named, defaults);

  if (pageDoc.state) {
    layoutDoc.state = { ...layoutDoc.state, ...pageDoc.state };
  }
  if (pageDoc.$media) {
    layoutDoc.$media = { ...layoutDoc.$media, ...pageDoc.$media };
  }
  if (pageDoc.style) {
    layoutDoc.style = { ...layoutDoc.style, ...pageDoc.style };
  }
  if (pageDoc.attributes) {
    layoutDoc.attributes = { ...layoutDoc.attributes, ...pageDoc.attributes };
  }

  return layoutDoc;
}

function fillSlots(
  node: JxMutableNode,
  named: Map<string, JxMutableNode[]>,
  defaults: (JxMutableNode | string)[],
) {
  if (!Array.isArray(node.children)) {
    return;
  }

  const newChildren: (JxMutableNode | string)[] = [];
  for (const child of node.children) {
    if (isNonNullObject(child) && child.tagName === "slot") {
      const slotName = child.attributes?.name;
      if (isString(slotName) && slotName && named.has(slotName)) {
        newChildren.push(...named.get(slotName)!);
        named.delete(slotName);
      } else if (!slotName && defaults.length > 0) {
        newChildren.push(...defaults);
      } else if (Array.isArray(child.children)) {
        newChildren.push(...child.children);
      }
    } else {
      /* Only an element has slots to fill. A null child (hand-edited JSON) used to reach the
         `!node` guard this function opened with; it now stops here, with the same outcome. */
      if (isNonNullObject(child)) {
        fillSlots(child, named, defaults);
      }
      newChildren.push(child);
    }
  }
  node.children = newChildren;
}

/**
 * A `project.json` patch: each key's new value, or `undefined` to remove the key.
 *
 * `Partial<ProjectConfig>` cannot say the second half under `exactOptionalPropertyTypes` — its
 * `url` is `string` when present, never `undefined` — so clearing a setting had to be spelled as a
 * double cast at every call site that wanted to.
 */
export type ProjectConfigPatch = { [K in keyof ProjectConfig]?: ProjectConfig[K] | undefined };

/**
 * Merge a partial patch into the project's configuration and persist it.
 *
 * The patch-shaped door onto `tabs/project-config.ts` — the single chokepoint every configuration
 * write goes through. It used to serialize and write `project.json` itself, which is how this file
 * came to hold one of the two serializations in play, and how ten call sites came to change the
 * file that defines the project with no history behind them.
 *
 * **It still rejects.** `settings/general-settings.ts` and `settings/contexts-section.ts` catch the
 * rejection and park it on the control that caused it (§16.1's inline tier), and that is the right
 * treatment for a field the author is looking at. The chokepoint ALSO files the failure as a
 * Problem, because the eight other sites reach this through `void updateSiteConfig(...)` and used
 * to drop it on the floor.
 *
 * @param {ProjectConfigPatch} patch - Fields to merge into the current projectConfig; a value of
 *   `undefined` clears the key.
 * @throws {unknown} The platform's rejection, when the write fails.
 */
export async function updateSiteConfig(patch: ProjectConfigPatch) {
  /* SAFETY: `commitProjectConfig` spreads the patch over the current config and serialises the
     result with JSON.stringify, so an `undefined` member reaches disk as an absent key and the
     written file is a ProjectConfig; every other member already has its ProjectConfig type. */
  const result = await commitProjectConfig(patch as Partial<ProjectConfig>);
  if (!result.ok) {
    throw result.error;
  }
}
