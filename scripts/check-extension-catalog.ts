#!/usr/bin/env bun
/**
 * Check-catalog.ts — `packages/catalog/catalog.json` is what its generator produces from the
 * `extensions/` tree.
 *
 * The catalogue is the list of first-party extensions Studio advertises as "available", and every
 * byte of it is derived: each package's own `jx-extension.json` supplies the identity, the class
 * descriptors it names supply the project sections and file formats, and its `package.json`
 * supplies the intra-extension `requires` edges. Nobody authors it, so the policy is the schema
 * policy — a generator produces the bytes and a human reviews the meaning.
 *
 *     bun run catalog:verify   # the gate: regenerate, report drift, restore nothing, exit 1
 *     bun run catalog:sync     # regenerate and KEEP the result, exit 0 — the fixer
 *
 * WHY THIS IS ITS OWN GATE. `check-schema-freshness.ts` derives its file set from every tracked
 * `*schema.json`, and this artifact is not one — it would pass unseen there forever. Reporting is
 * shared rather than reimplemented: the drift is rendered as the JSON Pointers that moved, using
 * that script's own `pointerDelta`.
 *
 * WHY IT READS PATHS, NEVER SPECIFIERS. Core may not depend on an extension (specs/extensions.md
 * §2). This script opens `extensions/<name>/jx-extension.json` as a FILE and imports nothing, so
 * the rule holds structurally rather than by exemption — and `scripts/` is outside the tree
 * `check-dep-rules.ts` walks in any case.
 *
 * It also enforces, across the whole tree at once, the three things each extension's own
 * `tests/extension-manifest.test.ts` asserts for itself: the manifest name matches `package.json`,
 * `"jx"` points at the manifest, and `exports["./jx-extension.json"]` is present. That last one is
 * load-bearing rather than tidy — it is the only path by which a host resolves the manifest, so a
 * package missing it is one the registry cannot load at all.
 *
 * @docs extending/contributing/monorepo
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionCatalogMeta } from "@jxsuite/catalog";
import type { ExtensionSectionInfo } from "@jxsuite/protocol";
import { EXTENSION_MANIFEST } from "@jxsuite/schema/extension-registry";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";
import { deltaSize, pointerDelta } from "./check-schema-freshness.ts";
import { headingsOf } from "./docs/lib/headings.ts";

/** Where the extension packages live, relative to the repo root. */
const EXTENSIONS_DIR = "extensions";

/** The committed artifact this script owns. */
export const CATALOG_PATH = "packages/catalog/catalog.json";

/** Docs page every catalogue entry deep-links into, and the slug it publishes under. */
const DOCS_PAGE = "docs/extending/extensions/first-party.md";
const DOCS_SLUG = "extending/extensions/first-party";

/** Read and parse a JSON file, naming the file in any failure. */
function readJson(path: string): JsonValue {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
}

/**
 * A JSON file read for its members. An array or a primitive has none of the members the catalogue
 * reads, so it yields an empty object and the field checks below reject it by name; `null` has no
 * members to read at all and is refused here.
 */
function readJsonObject(path: string): JsonObject {
  const value = readJson(path);
  if (value === null) {
    throw new TypeError(`${path}: must hold a JSON object, not null`);
  }
  return isJsonObject(value) ? value : {};
}

/**
 * The published deep link for one extension, read from the docs page rather than guessed.
 *
 * The anchor is `slugifyHeading` applied to a heading's RENDERED text, so it cannot be derived from
 * a package name — `@jxsuite/parser: content and Markdown` publishes
 * `jxsuiteparser-content-and-markdown`. Finding the heading instead means two things: the link is
 * right by construction, and an extension the page never documents fails this gate by name. That
 * second property is the point. `@jxsuite/feed` shipped and the page still said "Four".
 *
 * @param {Map<string, string>} anchors - Heading slug by the package name it opens with
 * @param {string} name - Package name
 * @returns {string}
 */
function docsLink(anchors: Map<string, string>, name: string): string {
  const anchor = anchors.get(name);
  if (anchor === undefined) {
    throw new Error(
      `${DOCS_PAGE} documents no section for "${name}" — every catalogue entry deep-links to its ` +
        `own heading, so add a "## ${name}: <what it does>" section (and update the page's count ` +
        `and its \`code:\` frontmatter) before this extension can be advertised`,
    );
  }
  return `/docs/${DOCS_SLUG}#${anchor}`;
}

/**
 * Heading slug by the package name its text opens with, for every `##` on the first-party page.
 *
 * @param {string} root - Repo root
 * @returns {Map<string, string>}
 */
function docsAnchors(root: string): Map<string, string> {
  const path = resolve(root, DOCS_PAGE);
  if (!existsSync(path)) {
    throw new Error(`${DOCS_PAGE} does not exist — every catalogue entry links to it`);
  }
  const anchors = new Map<string, string>();
  for (const heading of headingsOf(readFileSync(path, "utf8"))) {
    const match = /^(@[a-z\d][\w.-]*\/[a-z\d][\w.-]*)\b/.exec(heading.text);
    if (heading.depth === 2 && match?.[1]) {
      anchors.set(match[1], heading.slug);
    }
  }
  return anchors;
}

/**
 * Build the catalogue from the `extensions/` tree.
 *
 * Pure over `root`: it reads files and returns data, so a test can point it at a fixture tree.
 *
 * @param {string} root - Repo root
 * @returns {ExtensionCatalogMeta[]} Entries sorted by package name
 */
export function buildCatalog(root = "."): ExtensionCatalogMeta[] {
  const extensionsRoot = resolve(root, EXTENSIONS_DIR);
  if (!existsSync(extensionsRoot)) {
    throw new Error(`No ${EXTENSIONS_DIR}/ directory at ${extensionsRoot}`);
  }
  const anchors = docsAnchors(root);
  const dirs = readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

  // First pass: identity, so `requires` can be filtered to catalogue members in the second.
  const built: { entry: ExtensionCatalogMeta; deps: string[] }[] = [];
  for (const dir of dirs) {
    const packagePath = join(extensionsRoot, dir, "package.json");
    const manifestPath = join(extensionsRoot, dir, EXTENSION_MANIFEST);
    if (!existsSync(manifestPath) || !existsSync(packagePath)) {
      continue;
    }
    const pkg = readJsonObject(packagePath);
    const manifest = readJsonObject(manifestPath);

    if (!isString(manifest.name)) {
      throw new TypeError(`${manifestPath}: must declare a string "name"`);
    }
    if (manifest.name !== pkg.name) {
      throw new Error(
        `${manifestPath}: manifest name "${manifest.name}" does not match package.json "${pkg.name}"`,
      );
    }
    if (pkg.jx !== `./${EXTENSION_MANIFEST}`) {
      throw new Error(
        `${packagePath}: must declare "jx": "./${EXTENSION_MANIFEST}" (found ${JSON.stringify(pkg.jx)})`,
      );
    }
    if (!(isJsonObject(pkg.exports) && pkg.exports[`./${EXTENSION_MANIFEST}`])) {
      throw new Error(
        `${packagePath}: exports must include "./${EXTENSION_MANIFEST}" — it is the only path by which a ` +
          `host resolves the manifest, so without it the extension cannot be enabled at all`,
      );
    }
    if (!isString(manifest.title) || !isString(manifest.description)) {
      throw new TypeError(
        `${manifestPath}: must declare a "title" and a "description" for studio surfaces`,
      );
    }

    const sections: ExtensionSectionInfo[] = [];
    const formats = new Set<string>();
    const { classes } = manifest;
    const refs = isJsonObject(classes) || Array.isArray(classes) ? Object.values(classes) : [];
    for (const ref of refs) {
      if (!isString(ref)) {
        throw new TypeError(
          `${manifestPath}: class descriptor ${JSON.stringify(ref)} is not a path`,
        );
      }
      const classPath = resolve(join(extensionsRoot, dir), ref);
      if (!existsSync(classPath)) {
        throw new Error(`${manifestPath}: class descriptor ${ref} does not exist at ${classPath}`);
      }
      const descriptor = readJsonObject(classPath);
      const { format, project } = descriptor;
      if (isJsonObject(project) && isString(project.key)) {
        const section: ExtensionSectionInfo = { key: project.key };
        if (isString(project.title)) {
          section.title = project.title;
        }
        sections.push(section);
      }
      const extensions = isJsonObject(format) ? format.extensions : undefined;
      for (const ext of Array.isArray(extensions) ? extensions : []) {
        if (!isString(ext)) {
          throw new TypeError(`${classPath}: format.extensions must list strings`);
        }
        formats.add(ext);
      }
    }

    const entry: ExtensionCatalogMeta = {
      description: manifest.description,
      docs: docsLink(anchors, manifest.name),
      name: manifest.name,
      sections,
      title: manifest.title,
    };
    if (formats.size > 0) {
      entry.formats = [...formats].toSorted();
    }
    built.push({ deps: Object.keys(pkg.dependencies ?? {}), entry });
  }

  const members = new Set(built.map((b) => b.entry.name));
  const catalog: ExtensionCatalogMeta[] = [];
  for (const { deps, entry } of built) {
    const requires = deps.filter((dep) => members.has(dep)).toSorted();
    if (requires.length > 0) {
      entry.requires = requires;
    }
    catalog.push(entry);
  }

  // Two extensions claiming one section key is a registry error at load time (extensions.md §3.1).
  // Catching it here turns "the user's project fails to open" into "the pull request is red".
  const owner = new Map<string, string>();
  for (const entry of catalog) {
    for (const { key } of entry.sections) {
      const previous = owner.get(key);
      if (previous !== undefined) {
        throw new Error(`Section key "${key}" is claimed by both ${previous} and ${entry.name}`);
      }
      owner.set(key, entry.name);
    }
  }

  return catalog.toSorted((a, b) => a.name.localeCompare(b.name));
}

/** Serialise the catalogue exactly as the committed file holds it (trailing newline included). */
export function serializeCatalog(catalog: ExtensionCatalogMeta[]): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function main(): Promise<void> {
  const fix = process.argv.includes("--fix");
  const root = resolve(import.meta.dirname, "..");
  const target = resolve(root, CATALOG_PATH);

  const catalog = buildCatalog(root);
  const generated = serializeCatalog(catalog);
  const committed = existsSync(target) ? readFileSync(target, "utf8") : null;

  if (committed === generated) {
    console.log(`✓ ${CATALOG_PATH} is up to date (${catalog.length} extensions)`);
    return;
  }

  // Both sides are compared as parsed JSON, exactly as the committed file and `generated` hold them.
  const before: JsonValue = committed === null ? [] : JSON.parse(committed);
  const delta = pointerDelta(before, JSON.parse(generated));

  if (fix) {
    writeFileSync(target, generated);
    console.log(
      `✓ wrote ${CATALOG_PATH} (${catalog.length} extensions, ${deltaSize(delta)} pointers moved)`,
    );
    for (const line of [
      ...delta.added.map((p) => `  + ${p}`),
      ...delta.removed.map((p) => `  - ${p}`),
      ...delta.changed.map((p) => `  ~ ${p}`),
    ]) {
      console.log(line);
    }
    return;
  }

  if (deltaSize(delta) === 0) {
    /*
     * Same content, different bytes: something other than the generator rewrote the file. That is
     * a second writer on one artifact, and the fix is to stop it rather than to regenerate — which
     * is why `.oxfmtrc.json` ignores this path, exactly as it ignores the generated schemas.
     */
    console.error(
      `✗ ${CATALOG_PATH} has the right CONTENT but not the generator's bytes.\n\n` +
        `  Something reformatted it. Check that the path is still ignored by .oxfmtrc.json, ` +
        `then run \`bun run catalog:sync\`.`,
    );
    process.exitCode = 1;
    return;
  }

  console.error(`✗ ${CATALOG_PATH} is stale — ${deltaSize(delta)} pointer(s) moved:\n`);
  for (const pointer of delta.added) {
    console.error(`  + ${pointer}`);
  }
  for (const pointer of delta.removed) {
    console.error(`  - ${pointer}`);
  }
  for (const pointer of delta.changed) {
    console.error(`  ~ ${pointer}`);
  }
  console.error(`\nRun \`bun run catalog:sync\` and commit the result.`);
  process.exitCode = 1;
}

if (import.meta.main) {
  await main();
}
