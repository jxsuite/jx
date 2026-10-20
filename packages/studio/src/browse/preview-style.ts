/// <reference lib="dom" />
/**
 * The project's stylesheet, as a live preview's root adopts it.
 *
 * A component card or a page card in the Site panel and the Content home draws a part of a page in
 * Studio's own window, inside a shadow root of its box (`preview-root.ts`). It drew that part with
 * the runtime's rules alone: none of the site's tokens, typography or linked stylesheets, which is
 * where most of a component's look lives, so a museum card or a site header drew as an empty white
 * box. A page draws with two things this module supplies: `project.json`'s `style`, emitted by the
 * builder the canvas and the build share (`@jxsuite/site/site-style`), and the stylesheets the
 * project's `$head` links.
 *
 * Both address the page's `:root` and `body`, which a shadow root does not have: inside it the box
 * the preview is drawn in is `:host`. The project block is emitted with `:host` as its root and
 * body, and a linked sheet's own `:root`, `html` and `body` selectors are re-pointed at `:host`
 * through the CSSOM, rule by rule, so a site's custom properties and body typography reach the
 * preview the way they reach the page. A web font is the one thing that does not: `@font-face` is
 * not honoured inside a shadow root, so a preview draws in the fallback face.
 *
 * Built once per project configuration and shared by every preview of it.
 *
 * @docs studio/interface
 */

import { buildSiteStyleCSS } from "@jxsuite/site/site-style";
import { isFunction, isNonNullObject, isString } from "@jxsuite/schema/guards";
import { previewAssetSrcFor } from "../canvas/asset-refs";
import { projectState } from "../store";
import type { JxHeadEntry, ProjectConfig } from "@jxsuite/schema/types";

/** The preview box, as a project sheet names the page's root and body inside a shadow root. */
const HOST_ROOTS = { body: ":host", root: ":host" };

/** Every sheet built for a configuration, settled or in flight. */
const _sheets = new WeakMap<ProjectConfig, Promise<CSSStyleSheet[]>>();
/** The settled answers, for the synchronous mount. */
const _settled = new WeakMap<ProjectConfig, CSSStyleSheet[]>();

/** A selector of the page's root or body re-pointed at the preview box; `null` when unchanged. */
export function hostSelector(selector: string): string | null {
  const rewritten = selector
    .replaceAll(/:root\b/g, ":host")
    .replaceAll(/(^|[\s,>+~(])(?:html|body)(?![\w-])/g, "$1:host")
    .replaceAll(/:host(?:\s*>?\s*:host)+/g, ":host");
  return rewritten === selector ? null : rewritten;
}

/** What holds rules: a sheet, or a grouping rule (`@media`, `@supports`, a nesting style rule). */
type RuleContainer = CSSStyleSheet | CSSGroupingRule;

/**
 * Re-point every style rule under `container` (at any depth of grouping or nesting) at the box.
 *
 * A rule is REPLACED by its own text under the new selector rather than assigned a new
 * `selectorText`: the assignment is settable in browsers but not in every CSSOM, and replacing it
 * keeps its declarations, its nested rules and its place in source order either way. A rewritten
 * selector the engine cannot parse keeps the rule as it was.
 */
function rehostRules(container: RuleContainer): void {
  for (let index = 0; index < container.cssRules.length; index += 1) {
    const rule = container.cssRules[index];
    const rewritten = rule instanceof CSSStyleRule ? hostSelector(rule.selectorText) : null;
    if (rule instanceof CSSStyleRule && rewritten !== null) {
      const text = `${rewritten}${rule.cssText.slice(rule.cssText.indexOf("{"))}`;
      try {
        container.insertRule(text, index);
        container.deleteRule(index + 1);
      } catch {
        // Unparseable under the new selector: the original stays.
      }
    }
    const current = container.cssRules[index];
    if (current instanceof CSSGroupingRule) {
      rehostRules(current);
    }
  }
}

/** The stylesheet `href`s the project's `$head` links, in order. */
export function headStylesheetHrefs(head: readonly JxHeadEntry[] | undefined): string[] {
  const hrefs: string[] = [];
  for (const entry of head ?? []) {
    if (!isNonNullObject(entry) || String(entry.tagName).toLowerCase() !== "link") {
      continue;
    }
    const { href, rel } = entry.attributes ?? {};
    if (isString(href) && href !== "" && isString(rel) && rel.split(/\s+/).includes("stylesheet")) {
      hrefs.push(href);
    }
  }
  return hrefs;
}

/** One linked stylesheet as a preview sheet, or null when it cannot be read. */
async function linkedSheet(href: string): Promise<CSSStyleSheet | null> {
  const url = previewAssetSrcFor(href, "project.json");
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    const absolute = new URL(url, location.href).href;
    // Its own URL as the base, so the sheet's relative `url()` references resolve as they do on the
    // Page and not against Studio's address.
    const sheet = new CSSStyleSheet({ baseURL: absolute });
    sheet.replaceSync(await response.text());
    rehostRules(sheet);
    return sheet;
  } catch {
    return null;
  }
}

/** Build every sheet for one configuration: the linked sheets in `$head` order, then the block. */
async function buildSheets(config: ProjectConfig): Promise<CSSStyleSheet[]> {
  const linked = await Promise.all(
    headStylesheetHrefs(config.$head).map((href) => linkedSheet(href)),
  );
  const sheets = linked.filter((sheet): sheet is CSSStyleSheet => sheet !== null);
  const { style } = config;
  if (isNonNullObject(style)) {
    const block = new CSSStyleSheet();
    block.replaceSync(
      buildSiteStyleCSS(style, config.$media ?? {}, (value) => value, undefined, HOST_ROOTS),
    );
    sheets.push(block);
  }
  return sheets;
}

/**
 * Read the open project's preview sheets, building them on first ask. A preview awaits this before
 * it is shown, so {@link projectPreviewSheets} has the answer by the time a box is filled.
 */
export function loadProjectPreviewSheets(): Promise<CSSStyleSheet[]> {
  const config = projectState?.projectConfig;
  if (!config || !isFunction(globalThis.CSSStyleSheet)) {
    return Promise.resolve([]);
  }
  let pending = _sheets.get(config);
  if (!pending) {
    pending = buildSheets(config).then((sheets) => {
      _settled.set(config, sheets);
      return sheets;
    });
    _sheets.set(config, pending);
  }
  return pending;
}

/** The open project's preview sheets as far as they are built: none until the first read lands. */
export function projectPreviewSheets(): readonly CSSStyleSheet[] {
  const config = projectState?.projectConfig;
  return (config && _settled.get(config)) ?? [];
}
