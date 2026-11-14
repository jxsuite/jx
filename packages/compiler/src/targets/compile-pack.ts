/**
 * Compile-pack — a directory of component documents as one distributable element pack.
 *
 * `compileElement` compiles one definition (and the `$elements` it names). A component library is
 * many definitions that name each other, shipped together and used without a site build around
 * them, so the pieces a site build would have written beside the modules have to come from the same
 * call: each definition's stylesheet, one entry that registers them all, and the Custom Elements
 * Manifest that says what each one takes (spec.md §16.8).
 *
 * It writes nothing. The result is a list of files with paths relative to the pack's own directory,
 * which `writeElementPack` lays out, or which a caller hands to a bundler first (the `@jxsuite/ui`
 * distribution does, to compile its TypeScript behaviour modules into the pack).
 *
 * @docs framework/build
 */

import { cemManifest, cemManifestText } from "@jxsuite/schema/cem-manifest";
import type { CemDefinition, CemPackageOut } from "@jxsuite/schema/cem-manifest";
import { isString } from "@jxsuite/schema/guards";
import { isNativeDocumentPath, parseNativeDocument } from "@jxsuite/schema/jxn";
import type { JxDocument, ProjectConfig } from "@jxsuite/schema/types";
import { resolveShadowMode } from "../shadow.ts";
import type { GeneratedFile } from "../site/well-known.ts";
import { buildComponentCSS, orderComponentTags, tagNameToClassName } from "../shared.ts";
import { compileElement } from "./compile-element.ts";
import type { CompileElementOptions } from "./compile-element.ts";

/** Options accepted by {@link compileElementPack}. */
export interface ElementPackOptions {
  /**
   * The component documents: a directory, of which every document directly inside is compiled, or
   * the files themselves. A file with no hyphenated `tagName` is not a component and is refused.
   */
  components: string | readonly string[];
  /**
   * The pack's own directory, relative to the package root, with `/` separators: where the caller
   * will serve or publish the files from. It prefixes each module path in the manifest, whose paths
   * are read against the package root (spec.md §16.8). Default `"dist"`.
   */
  packDir?: string;
  /**
   * Rewrite a Function entry's `$src` specifier to the specifier the compiled module imports.
   * Receives the directory of the declaring document. Identity when omitted, so a relative `$src`
   * must then be reachable from the pack's directory as written.
   */
  rewriteSrc?: (specifier: string, docDir: string | null) => string;
  /** Named media queries every definition resolves its `@--name` blocks against. */
  $media?: Record<string, string>;
  /** Project `defaults`, read for `defaults.shadow` (spec.md §16.6). */
  defaults?: ProjectConfig["defaults"];
}

/** A compiled pack: what {@link writeElementPack} lays out. */
export interface ElementPack {
  /**
   * Each with its path relative to the pack's directory: `<tag>.js` per definition, `<tag>.css` per
   * definition that has styles, `index.js`, `elements.css` and `custom-elements.json`.
   */
  files: GeneratedFile[];
  /** The tags compiled, each after the tags it renders. */
  tags: string[];
  manifest: CemPackageOut;
  /** The manifest generator's warnings (spec.md §16.8). */
  warnings: string[];
}

/** The name of the module that registers every element of a pack. */
export const PACK_ENTRY = "index.js";

/** The name of the stylesheet holding every light-DOM definition's rules. */
export const PACK_STYLESHEET = "elements.css";

/** The name of the pack's Custom Elements Manifest. */
export const PACK_MANIFEST = "custom-elements.json";

/** The component documents a pack is compiled from, as absolute paths in a stable order. */
async function componentPaths(components: string | readonly string[]): Promise<string[]> {
  const { readdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  if (!isString(components)) {
    return components.map((path) => resolve(path));
  }
  return readdirSync(components)
    .filter((name) => isNativeDocumentPath(name))
    .toSorted()
    .map((name) => resolve(components, name));
}

/** A component document as its file holds it. A pack compiles native documents only. */
async function readComponent(path: string) {
  const { readFileSync } = await import("node:fs");
  if (!isNativeDocumentPath(path)) {
    throw new Error(
      `compileElementPack: ${path} is not a .json or .jxn document, the two a pack compiles`,
    );
  }
  return parseNativeDocument(readFileSync(path, "utf8"), path);
}

/**
 * Compile every component document of a library into one pack (compiler.md §4.9): a module per
 * definition, a stylesheet per definition, the entry that registers them all, and their Custom
 * Elements Manifest.
 *
 * Each module is the one `compileElement` emits, importing the definitions it names in `$elements`
 * as its siblings (`./<tag>.js`), so importing one element registers what it renders, and importing
 * the entry registers the pack in dependency order.
 *
 * @param options
 */
export async function compileElementPack(options: ElementPackOptions): Promise<ElementPack> {
  const { resolve } = await import("node:path");
  const packDir = (options.packDir ?? "dist").replaceAll(/^\.?\/+|\/+$/gu, "");
  const paths = await componentPaths(options.components);

  // Every definition by tag first: a module names its siblings by tag, wherever their files are.
  const definitions = new Map<string, JxDocument>();
  const tagByPath = new Map<string, string>();
  for (const path of paths) {
    const doc = await readComponent(path);
    const { tagName } = doc;
    if (!isString(tagName) || !tagName.includes("-")) {
      throw new Error(
        `compileElementPack: ${path} is not a component: its tagName must contain a hyphen`,
      );
    }
    const earlier = [...tagByPath].find(([, tag]) => tag === tagName);
    if (earlier) {
      throw new Error(
        `compileElementPack: ${earlier[0]} and ${path} both declare the tagName "${tagName}"`,
      );
    }
    definitions.set(tagName, doc);
    tagByPath.set(path, tagName);
  }

  const elementOptions: CompileElementOptions = {
    resolveElementPath: (refPath, currentDir) => {
      const target = currentDir === null ? resolve(refPath) : resolve(currentDir, refPath);
      const tag = tagByPath.get(target);
      if (tag === undefined) {
        throw new Error(
          `compileElementPack: "${refPath}" names a component outside the pack (${target})`,
        );
      }
      return `./${tag}.js`;
    },
  };
  if (options.rewriteSrc) {
    elementOptions.rewriteSrc = options.rewriteSrc;
  }
  if (options.$media) {
    elementOptions.$media = options.$media;
  }
  if (options.defaults) {
    elementOptions.defaults = options.defaults;
  }

  const modules = new Map<string, string>();
  for (const path of paths) {
    const { files } = await compileElement(path, elementOptions);
    // A definition's `$elements` come back with it; each is the same module whoever asked.
    for (const file of files) {
      if (!modules.has(file.tagName)) {
        modules.set(file.tagName, file.content);
      }
    }
  }

  const tags = orderComponentTags([...definitions.keys()], definitions);
  const files: GeneratedFile[] = [];
  const lightSheets: string[] = [];
  const manifestDefinitions: CemDefinition[] = [];
  for (const tag of tags) {
    const doc = definitions.get(tag);
    const module = modules.get(tag);
    // `tags` orders `definitions`' own keys, each compiled above; the guard is for the types.
    if (!doc || module === undefined) {
      continue;
    }
    files.push({ content: module, path: `${tag}.js` });
    const shadow = resolveShadowMode(doc, options.defaults);
    const css = buildComponentCSS(tag, doc.style, doc, options.$media ?? doc.$media ?? {}, shadow);
    if (css !== "") {
      files.push({ content: css, path: `${tag}.css` });
      /* A shadow definition's sheet is linked from inside its own root, where the document's
         stylesheets do not reach, so it stays out of the one a page links. */
      if (shadow === null) {
        lightSheets.push(css);
      }
    }
    manifestDefinitions.push({
      className: tagNameToClassName(tag),
      doc,
      modulePath: packDir === "" ? `${tag}.js` : `${packDir}/${tag}.js`,
      shadow: shadow !== null,
      tagName: tag,
    });
  }

  const { manifest, warnings } = cemManifest(manifestDefinitions);
  files.push(
    {
      content: `// Generated by @jxsuite/compiler — do not edit manually\n${tags
        .map((tag) => `import './${tag}.js';`)
        .join("\n")}\n`,
      path: PACK_ENTRY,
    },
    { content: lightSheets.join(""), path: PACK_STYLESHEET },
    { content: cemManifestText(manifest), path: PACK_MANIFEST },
  );
  return { files, manifest, tags, warnings };
}

/**
 * Write a pack's files under a directory, creating it as needed.
 *
 * @param pack
 * @param outDir
 * @returns The absolute path of each file written, in the pack's order
 */
export async function writeElementPack(pack: ElementPack, outDir: string): Promise<string[]> {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  return pack.files.map((file) => {
    const target = resolve(outDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
    return target;
  });
}
