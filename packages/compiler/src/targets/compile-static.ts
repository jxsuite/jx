/**
 * Compile-static.js — Static HTML compilation
 *
 * Compiles fully static Jx documents to plain HTML/CSS with zero JS. Dynamic child subtrees become
 * hydration islands (custom elements).
 */

import {
  buildAttrs,
  childSeparator,
  colorSchemePrePaintScript,
  compileStyles,
  createCompileContext,
  escapeHtml,
  isNodeDynamic,
  PREFORMATTED_TAGS,
  pureSchemeOf,
  resolveStaticTagName,
  resolveStaticValue,
  SELF_CLOSING,
} from "../shared.ts";
import type { CompileContext } from "../shared.ts";
import { emitElementModule } from "./compile-element.ts";
import { isBoolean, isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonPrimitive, JxDocument, JxMutableNode, JxStyle } from "@jxsuite/schema/types";

/**
 * A member of a node's `children` as a parsed document holds it: an element, a text string, or —
 * since the document is JSON — a number, boolean or `null` the walk renders as text or skips.
 */
type StaticChild = JxMutableNode | JsonPrimitive;

/** A dynamic subtree lifted out of the static page, emitted as its own element module. */
interface Island {
  def: JxDocument;
  tagName: string;
  className: string;
}

/**
 * Compile a static document to HTML, with dynamic subtrees as islands.
 *
 * @param {JxDocument} raw - Raw JSON document (with $ref pointers preserved)
 * @param opts - Page title, CDN sources, project style, pre-paint switch and island `$src`
 *   rewriting
 * @returns {{ html: string; files: { path: string; content: string; tagName: string }[] }}
 */
export function compileStaticPage(
  raw: JxDocument,
  opts: {
    title?: string;
    reactivitySrc?: string;
    litHtmlSrc?: string;
    projectStyle?: JxStyle | null;
    prePaintScheme?: boolean;
    /** Rewrite an island's Function-def `$src` specifier to its served URL. */
    rewriteSrc?: (specifier: string) => string;
  },
) {
  const { title = "Jx App", reactivitySrc, litHtmlSrc } = opts;

  const rootContext = createCompileContext(raw, null, raw.state ?? {}, raw.$media ?? {});
  const styleBlock = compileStyles(raw, raw.$media ?? {}, opts.projectStyle ?? null);
  const islands: Island[] = [];
  const bodyContent = compileNode(raw, false, rootContext, islands);

  /** @type {{ path: string; content: string; tagName: string }[]} */
  const files = [];
  let importMap = "";
  let moduleScripts = "";
  if (islands.length > 0) {
    for (const island of islands) {
      const moduleContent = emitElementModule(island.def, island.className, [], opts.rewriteSrc);
      files.push({
        content: moduleContent,
        path: `_islands/${island.tagName}.js`,
        tagName: island.tagName,
      });
    }
    importMap = `<script type="importmap">
  {
    "imports": {
      "@vue/reactivity": "${reactivitySrc}",
      "lit-html": "${litHtmlSrc}"
    }
  }
  </script>`;
    moduleScripts = files
      .map(
        (/** @type {{ path: string }} */ f) => `<script type="module" src="./${f.path}"></script>`,
      )
      .join("\n  ");
  }

  // Forced-scheme contract (spec §9.5): restore the persisted scheme before any styles apply
  const prePaint =
    opts.prePaintScheme !== false &&
    Object.values(raw.$media ?? {}).some((q) => pureSchemeOf(String(q)) !== null)
      ? `<script>${colorSchemePrePaintScript()}</script>\n  `
      : "";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  ${prePaint}${importMap}
  ${styleBlock}
</head>
<body>
  ${bodyContent}
  ${moduleScripts}
</body>
</html>`;

  return { files, html };
}

// ─── Node compilation ─────────────────────────────────────────────────────────

/**
 * Compile a single Jx node to an HTML string. Dynamic nodes become hydration islands; static nodes
 * become plain HTML.
 *
 * The node is read as authored — `$ref` pointers preserved — because an island's element module
 * resolves them itself at runtime.
 *
 * @param {StaticChild} def
 * @param {boolean} dynamic
 * @param {CompileContext} context
 * @param {Island[]} islands
 * @returns {string}
 */
function compileNode(
  def: StaticChild,
  dynamic: boolean,
  context: CompileContext,
  islands: Island[],
): string {
  // String children are text nodes
  if (isString(def)) {
    return escapeHtml(def);
  }
  if (isNumber(def) || isBoolean(def)) {
    return escapeHtml(String(def));
  }
  if (!isNonNullObject(def)) {
    return "";
  }

  const nextContext = createCompileContext(
    def,
    context.scope,
    def.state ?? context.scopeDefs,
    def.$media ?? context.media,
  );

  if (dynamic) {
    const n = islands.length;
    const tagName = `jx-island-${n}`;
    const className = `JxIsland${n}`;
    /* SAFETY: JxDocument is the element-node shape with `tagName` narrowed to a literal string,
       and the island's `tagName` is the literal `jx-island-N` assigned here; every other member is
       the authored node's own, carried over unchanged. */
    const elementDef = { ...def, tagName } as JxDocument;
    islands.push({ className, def: elementDef, tagName });
    return `<${tagName}></${tagName}>`;
  }

  // Resolved against the same scope the attributes are, so the prerendered element and its
  // Attributes come from one decision rather than two.
  const tag = resolveStaticTagName(def.tagName, nextContext.scope);
  const attrs = buildAttrs(def, nextContext.scope);

  // Void elements (br, hr, img, …) have no closing tag.
  // Emitting `<br></br>` makes HTML parsers read `</br>` as a second `<br>`.
  if (SELF_CLOSING.has(tag)) {
    return `<${tag}${attrs}>`;
  }

  // `white-space` inherits, so once inside a <pre> the whole subtree stays whitespace-significant.
  const preformatted = context.preformatted === true || PREFORMATTED_TAGS.has(tag);
  const inner = buildInnerWithIslands(def, { ...nextContext, preformatted }, islands);

  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/**
 * Build the inner HTML (textContent or children) for a node. For children, emit islands only for
 * those that are actually dynamic.
 *
 * @param {JxMutableNode} def
 * @param {CompileContext} context
 * @param {Island[]} islands
 * @returns {string}
 */
function buildInnerWithIslands(
  def: JxMutableNode,
  context: CompileContext,
  islands: Island[],
): string {
  if (def.textContent !== undefined) {
    const value = resolveStaticValue(def.textContent, context.scope);
    return value == null ? "" : escapeHtml(String(value));
  }
  if (def.innerHTML) {
    // Raw HTML may itself be a template; one that resolves to nothing keeps its authored text.
    const resolved = resolveStaticValue(def.innerHTML, context.scope);
    return resolved == null ? def.innerHTML : String(resolved);
  }
  if (Array.isArray(def.children)) {
    return def.children
      .map((child) => compileNode(child, isNodeDynamic(child), context, islands))
      .join(childSeparator(context.preformatted));
  }
  return "";
}
