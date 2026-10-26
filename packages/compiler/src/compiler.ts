/**
 * Jx-compiler.js — Compiler orchestrator
 *
 * Routes Jx documents to the appropriate compilation target:
 *
 * - Fully static → compile-static.js (plain HTML/CSS, zero JS)
 * - Custom element (-) → compile-element.js (lit-html web component)
 * - Dynamic (standard) → compile-client.js (pre-rendered HTML + reactive bindings)
 *
 * Usage (CLI): `bun packages/compiler/src/compile-cli.js <source.json> [output.html]`
 *
 * @license MIT
 * @version 3.0.0
 */

import { readFileSync } from "node:fs";
import {
  DEFAULT_LIT_HTML_SRC,
  DEFAULT_REACTIVITY_SRC,
  compileStyles,
  escapeHtml,
  isDynamic,
  tagNameToClassName,
} from "./shared.ts";

import { emitElementModule } from "./targets/compile-element.ts";
import { compileStaticPage } from "./targets/compile-static.ts";
import { compileClient } from "./targets/compile-client.ts";
import { isClassDef, isString } from "@jxsuite/schema/guards";
import { parseJxDocument } from "@jxsuite/schema/parse";
import type { JxDocument, JxStyle } from "@jxsuite/schema/types";
import type { FormatRegistry } from "@jxsuite/schema/format-registry";

// Re-exports for consumers
export { isDynamic } from "./shared.ts";
export { compileSiteServer } from "./targets/compile-server.ts";
export { compileElement, compileElementPage } from "./targets/compile-element.ts";
export { compileClient } from "./targets/compile-client.ts";

// ─── Entry ────────────────────────────────────────────────────────────────────

export interface CompileOptions {
  title?: string;
  reactivitySrc?: string;
  litHtmlSrc?: string;
  projectStyle?: JxStyle | null;
  formats?: FormatRegistry;
  /** Rewrite Function-def `$src` specifiers to served URLs (see CompileElementOptions). */
  rewriteSrc?: (specifier: string) => string;
  /**
   * The route prefix a `timing: "server"` entry posts to, deployment base included
   * (`serverRoutePrefix`). Default `"/_jx/server"`, for a site served from its origin root.
   */
  serverBaseUrl?: string;
  /**
   * Inject the color-scheme pre-paint script when `$media` declares a pure scheme query (default
   * true). The site pipeline disables this and injects via the merged <head> instead.
   */
  prePaintScheme?: boolean;
  /**
   * The page language the site pipeline passes alongside the other options. No compile target reads
   * it today: the document's own `lang` is what reaches the emitted markup.
   */
  lang?: string;
}

/** The page-target options {@link compile} forwards only when its caller set them. */
interface PageTargetOverrides {
  prePaintScheme?: false;
  rewriteSrc?: (specifier: string) => string;
}

/**
 * Compile a Jx document to HTML (+ optional JS module files).
 *
 * Routing: 1. Not dynamic → static HTML/CSS, zero JS 2. tagName contains hyphen → custom element
 * (lit-html) 3. Otherwise → pre-rendered HTML with reactive bindings
 *
 * @param {string | JxDocument} sourcePath - Path to .json file, URL, or raw document object
 * @param {CompileOptions} [opts]
 * @returns {Promise<{
 *   html: string;
 *   files: { path: string; content: string; tagName?: string }[];
 * }>}
 */
export async function compile(sourcePath: string | JxDocument, opts: CompileOptions = {}) {
  const {
    title = "Jx App",
    reactivitySrc = DEFAULT_REACTIVITY_SRC,
    litHtmlSrc = DEFAULT_LIT_HTML_SRC,
    projectStyle = null,
  } = opts;

  let raw: JxDocument;
  if (isString(sourcePath)) {
    const source = readFileSync(sourcePath, "utf8");
    if (sourcePath.endsWith(".json")) {
      raw = parseJxDocument(source, sourcePath);
    } else {
      const { extname } = await import("node:path");
      const ext = extname(sourcePath).toLowerCase();
      const entry = opts.formats?.byExtension(ext, "parse");
      if (!entry) {
        const { unknownFormatError } = await import("./site/format-host.ts");
        throw unknownFormatError(sourcePath, ext);
      }
      raw = await entry.parseDocument(source);
    }
  } else {
    raw = sourcePath;
  }

  // Route 0: .class.json schema-defined class → JS class module
  if (isClassDef(raw)) {
    const { compileClassJson } = await import("./targets/compile-class.js");
    const jsContent = compileClassJson(raw);
    const outputPath = isString(sourcePath)
      ? sourcePath.replace(/\.class\.json$/, ".js")
      : `${raw.title}.js`;
    return { files: [{ content: jsContent, path: outputPath }], html: "" };
  }

  // Route 1: Fully static → plain HTML/CSS
  if (!isDynamic(raw)) {
    return compileStaticPage(raw, {
      litHtmlSrc,
      projectStyle,
      reactivitySrc,
      ...pageTargetOverrides(opts),
      title,
    });
  }

  // Route 2: Custom element tagName (contains hyphen) → lit-html web component
  if (raw.tagName && raw.tagName.includes("-")) {
    const { tagName } = raw;
    const className = tagNameToClassName(tagName);
    const moduleContent = emitElementModule(
      raw,
      className,
      [],
      opts.rewriteSrc,
      null,
      opts.serverBaseUrl,
    );
    const moduleFile = {
      content: moduleContent,
      path: `${tagName}.js`,
      tagName,
    };
    const styleBlock = compileStyles(raw, raw.$media ?? {}, projectStyle);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script type="importmap">
  {
    "imports": {
      "@vue/reactivity": "${reactivitySrc}",
      "lit-html": "${litHtmlSrc}"
    }
  }
  </script>
  ${styleBlock}
</head>
<body>
  <${tagName}></${tagName}>
  <script type="module" src="./${tagName}.js"></script>
</body>
</html>`;

    return { files: [moduleFile], html };
  }

  // Route 3: Dynamic with standard tagName → pre-rendered HTML + reactive bindings
  const clientOptions: Parameters<typeof compileClient>[1] = {
    litHtmlSrc,
    projectStyle,
    reactivitySrc,
    ...pageTargetOverrides(opts),
    title,
  };
  if (opts.serverBaseUrl !== undefined) {
    clientOptions.serverBaseUrl = opts.serverBaseUrl;
  }
  return compileClient(raw, clientOptions);
}

/**
 * The `prePaintScheme` and `rewriteSrc` options a page target receives, each present only when the
 * caller set it, so the target's own default applies otherwise.
 */
function pageTargetOverrides(opts: CompileOptions): PageTargetOverrides {
  const overrides: PageTargetOverrides = {};
  if (opts.prePaintScheme === false) {
    overrides.prePaintScheme = false;
  }
  if (opts.rewriteSrc) {
    overrides.rewriteSrc = opts.rewriteSrc;
  }
  return overrides;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

/**
 * @param {string} src
 * @param {string} [out]
 */
export async function runCli(src: string, out?: string) {
  const result = await compile(src);
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  if (out) {
    writeFileSync(out, result.html, "utf8");
    console.error(`Written to ${out}`);
    const outDir = dirname(out);
    for (const f of result.files) {
      const filePath = join(outDir, f.path);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, f.content, "utf8");
      console.error(`Written to ${filePath}`);
    }
  } else {
    process.stdout.write(result.html);
  }
}
