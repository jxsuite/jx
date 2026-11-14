/**
 * Compile-static.js — Static HTML compilation
 *
 * Compiles a document `isDynamic` judged static to plain HTML/CSS with zero JS. `compile()` routes
 * nothing else here: a document with any dynamic node, at any depth, is compiled whole by
 * `compile-client.ts` (compiler.md §8.1, §9.1).
 */

import {
  buildAttrs,
  childSeparator,
  colorSchemePrePaintScript,
  compileStyles,
  createCompileContext,
  escapeHtml,
  PREFORMATTED_TAGS,
  pureSchemeOf,
  resolveStaticTagName,
  resolveStaticValue,
  SELF_CLOSING,
} from "../shared.ts";
import type { CompileContext } from "../shared.ts";
import { isBoolean, isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonPrimitive, JxDocument, JxMutableNode, JxStyle } from "@jxsuite/schema/types";

/**
 * A member of a node's `children` as a parsed document holds it: an element, a text string, or —
 * since the document is JSON — a number, boolean or `null` the walk renders as text or skips.
 */
type StaticChild = JxMutableNode | JsonPrimitive;

/** A file a compilation emits beside its HTML; the static target emits none. */
interface EmittedFile {
  path: string;
  content: string;
  tagName: string;
}

/**
 * Compile a static document to HTML. The page carries no module, import map or script: `files` is
 * always empty, and is returned so every route of `compile()` has one shape.
 *
 * @param {JxDocument} raw - Raw JSON document (with $ref pointers preserved)
 * @param opts - Page title, project style and pre-paint switch
 * @returns {{ html: string; files: { path: string; content: string; tagName: string }[] }}
 */
export function compileStaticPage(
  raw: JxDocument,
  opts: {
    title?: string;
    projectStyle?: JxStyle | null;
    prePaintScheme?: boolean;
  },
) {
  const { title = "Jx App" } = opts;

  const rootContext = createCompileContext(raw, null, raw.state ?? {}, raw.$media ?? {});
  const styleBlock = compileStyles(raw, raw.$media ?? {}, opts.projectStyle ?? null);
  const bodyContent = compileNode(raw, rootContext);

  const files: EmittedFile[] = [];

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
  ${prePaint}
  ${styleBlock}
</head>
<body>
  ${bodyContent}
</body>
</html>`;

  return { files, html };
}

// ─── Node compilation ─────────────────────────────────────────────────────────

/**
 * Compile a single Jx node to an HTML string.
 *
 * @param {StaticChild} def
 * @param {CompileContext} context
 * @returns {string}
 */
function compileNode(def: StaticChild, context: CompileContext): string {
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
  const inner = buildStaticInner(def, { ...nextContext, preformatted });

  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/**
 * Build the inner HTML (textContent, innerHTML or children) for a node.
 *
 * @param {JxMutableNode} def
 * @param {CompileContext} context
 * @returns {string}
 */
function buildStaticInner(def: JxMutableNode, context: CompileContext): string {
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
      .map((child) => compileNode(child, context))
      .join(childSeparator(context.preformatted));
  }
  return "";
}
