/**
 * compile-static.js — Static HTML compilation
 *
 * Compiles fully static JSONsx documents to plain HTML/CSS with zero JS.
 * Dynamic child subtrees become hydration islands (custom elements).
 */

import {
  isNodeDynamic,
  createCompileContext,
  resolveStaticValue,
  buildAttrs,
  compileStyles,
  escapeHtml,
} from "./shared.js";
import { emitElementModule } from "./compile-element.js";

/**
 * Compile a static document to HTML, with dynamic subtrees as islands.
 *
 * @param {object} raw - Raw JSON document (with $ref pointers preserved)
 * @param {object} opts
 * @param {string} opts.title - HTML document title
 * @param {string} opts.reactivitySrc - CDN URL for @vue/reactivity
 * @param {string} opts.litHtmlSrc - CDN URL for lit-html
 * @returns {{ html: string, files: Array<{ path: string, content: string, tagName: string }> }}
 */
export function compileStaticPage(raw, opts) {
  const { title, reactivitySrc, litHtmlSrc } = opts;

  const rootContext = createCompileContext(raw, null, raw.state ?? {}, raw.$media ?? {});
  const styleBlock = compileStyles(raw, raw.$media ?? {});
  const islands = [];
  const bodyContent = compileNode(raw, false, raw, rootContext, islands);

  const files = [];
  let importMap = "";
  let moduleScripts = "";
  if (islands.length > 0) {
    for (const island of islands) {
      const moduleContent = emitElementModule(island.def, island.className, []);
      files.push({ path: `_islands/${island.tagName}.js`, content: moduleContent, tagName: island.tagName });
    }
    importMap = `<script type="importmap">
  {
    "imports": {
      "@vue/reactivity": "${reactivitySrc}",
      "lit-html": "${litHtmlSrc}"
    }
  }
  </script>`;
    moduleScripts = files.map(f =>
      `<script type="module" src="./${f.path}"></script>`
    ).join("\n  ");
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${importMap}
  ${styleBlock}
</head>
<body>
  ${bodyContent}
  ${moduleScripts}
</body>
</html>`;

  return { html, files };
}

// ─── Node compilation ─────────────────────────────────────────────────────────

/**
 * Compile a single JSONsx node to an HTML string.
 * Dynamic nodes become hydration islands; static nodes become plain HTML.
 */
function compileNode(def, dynamic, raw, context, islands) {
  // String children are text nodes
  if (typeof def === "string") {
    return escapeHtml(def);
  }
  if (typeof def === "number" || typeof def === "boolean") {
    return escapeHtml(String(def));
  }
  if (!def || typeof def !== "object") return "";

  const nextContext = createCompileContext(
    raw,
    context.scope,
    raw?.state ?? context.scopeDefs,
    raw?.$media ?? context.media,
  );

  if (dynamic) {
    const n = islands.length;
    const tagName = `jsonsx-island-${n}`;
    const className = `JsonsxIsland${n}`;
    const elementDef = { ...(raw ?? def), tagName };
    islands.push({ def: elementDef, tagName, className });
    return `<${tagName}></${tagName}>`;
  }

  const tag = def.tagName ?? "div";
  const attrs = buildAttrs(def, nextContext.scope);
  const inner = buildInnerWithIslands(def, raw, nextContext, islands);

  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/**
 * Build the inner HTML (textContent or children) for a node.
 * For children, emit islands only for those that are actually dynamic.
 */
function buildInnerWithIslands(def, raw, context, islands) {
  const source = raw ?? def;

  if (source.textContent !== undefined) {
    const value = resolveStaticValue(source.textContent, context.scope);
    return value == null ? "" : escapeHtml(String(value));
  }
  if (source.innerHTML) return resolveStaticValue(source.innerHTML, context.scope) ?? "";
  if (Array.isArray(source.children)) {
    const rawChildren = raw?.children;
    return source.children
      .map((c, i) => {
        const childDynamic = isNodeDynamic(c);
        const childRaw = rawChildren?.[i] ?? c;
        return compileNode(c, childDynamic, childRaw, context, islands);
      })
      .join("\n  ");
  }
  return "";
}
