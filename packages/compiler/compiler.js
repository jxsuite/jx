/**
 * jx-compiler.js — Compiler orchestrator
 * @version 3.0.0
 * @license MIT
 *
 * Routes Jx documents to the appropriate compilation target:
 *   - Fully static         → compile-static.js  (plain HTML/CSS, zero JS)
 *   - Custom element (-)   → compile-element.js  (lit-html web component)
 *   - Dynamic (standard)   → compile-client.js   (pre-rendered HTML + reactive bindings)
 *   - Server               → compile-server.js   (Hono server handler)
 *
 * Usage (CLI):
 *   bun packages/compiler/compiler.js <source.json> [output.html]
 */

import { readFileSync } from "node:fs";
import {
  isDynamic,
  compileStyles,
  escapeHtml,
  titleToTagName,
  tagNameToClassName,
  DEFAULT_REACTIVITY_SRC,
  DEFAULT_LIT_HTML_SRC,
} from "./shared.js";
import { compileServer } from "./compile-server.js";
import { compileElement, compileElementPage, emitElementModule } from "./compile-element.js";
import { compileStaticPage } from "./compile-static.js";
import { compileClient } from "./compile-client.js";

// Re-exports for consumers
export { isDynamic, compileServer, compileElement, compileElementPage, compileClient };

// ─── Entry ────────────────────────────────────────────────────────────────────

/**
 * Compile a Jx document to HTML (+ optional JS module files).
 *
 * Routing:
 *   1. Not dynamic → static HTML/CSS, zero JS
 *   2. tagName contains hyphen → custom element (lit-html)
 *   3. Otherwise → pre-rendered HTML with reactive bindings
 *
 * @param {string | any} sourcePath - Path to .json file, URL, or raw object
 * @param {any}          [opts]
 * @returns {Promise<{ html: string, files: { path: string, content: string, tagName?: string }[] }>}
 */
export async function compile(sourcePath, opts = {}) {
  const {
    title = "Jx App",
    reactivitySrc = DEFAULT_REACTIVITY_SRC,
    litHtmlSrc = DEFAULT_LIT_HTML_SRC,
  } = opts;

  const raw =
    typeof sourcePath === "string" ? JSON.parse(readFileSync(sourcePath, "utf8")) : sourcePath;

  // Route 0: .class.json schema-defined class → JS class module
  if (raw.$prototype === "Class") {
    const { compileClassJson } = await import("./compile-class.js");
    const jsContent = compileClassJson(raw, opts);
    const outputPath = typeof sourcePath === "string"
      ? sourcePath.replace(/\.class\.json$/, ".js")
      : `${raw.title}.js`;
    return { html: "", files: [{ path: outputPath, content: jsContent }] };
  }

  // Route 1: Fully static → plain HTML/CSS
  if (!isDynamic(raw)) {
    return compileStaticPage(raw, { title, reactivitySrc, litHtmlSrc });
  }

  // Route 2: Custom element tagName (contains hyphen) → lit-html web component
  if (raw.tagName && raw.tagName.includes("-")) {
    const tagName = raw.tagName;
    const className = tagNameToClassName(tagName);
    const moduleContent = emitElementModule(raw, className, []);
    const moduleFile = { path: `${tagName}.js`, content: moduleContent, tagName };
    const styleBlock = compileStyles(raw, raw.$media ?? {});

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

    return { html, files: [moduleFile] };
  }

  // Route 3: Dynamic with standard tagName → pre-rendered HTML + reactive bindings
  return compileClient(raw, { title, reactivitySrc, litHtmlSrc });
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const isMainModule = process.argv[1]?.endsWith("compiler.js");
if (isMainModule && process.argv[2]) {
  const [, , src, out] = process.argv;

  Promise.all([compile(src), compileServer(src)])
    .then(async ([result, server]) => {
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
      if (server && out) {
        const serverOut = out.replace(/(\.[^.]+)?$/, "-server.js");
        writeFileSync(serverOut, /** @type {string} */ (server), "utf8");
        console.error(`Server handler written to ${serverOut}`);
      }
    })
    .catch((/** @type {any} */ err) => {
      console.error(err);
      process.exit(1);
    });
}
