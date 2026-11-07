/**
 * Gen-webdata.ts — extract web platform data from the @webref packages.
 *
 * Writes `data/webdata.json`: the Insert palette's HTML elements by category, CSS property names
 * with their initial values for autocomplete, event handler names from IDL, and every non-obsolete
 * tag name. The file is committed after `oxfmt`, which the commit hook runs on every staged JSON
 * file.
 *
 * Usage: `bun run gen:webdata` (from packages/studio)
 */

import { listAll } from "@webref/elements";
import css from "@webref/css";
import idl from "@webref/idl";
import { writeFileSync } from "node:fs";

// ─── The Insert palette's categories ─────────────────────────────────────────

/**
 * The Insert palette draws these groups in this key order (studio.md §5.3), most-used first, so a
 * newcomer meets headings, paragraphs and images before form controls and table parts. Each key is
 * a stable id, not a caption: the name a reader sees comes from the locale catalog
 * (`data/locales/<lang>/elements.json`), so a translation never touches this table. A tag
 * `@webref/elements` no longer lists as current is dropped.
 */
const CATEGORIES = {
  text: ["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "pre", "hr", "address"],
  lists: ["ul", "ol", "li", "dl", "dt", "dd", "menu"],
  media: ["img", "figure", "figcaption", "video", "audio", "picture", "source", "track", "iframe"],
  layout: [
    "section",
    "div",
    "header",
    "footer",
    "main",
    "nav",
    "article",
    "aside",
    "search",
    "hgroup",
  ],
  interactive: ["a", "button", "details", "summary", "dialog"],
  forms: [
    "form",
    "label",
    "input",
    "textarea",
    "select",
    "option",
    "optgroup",
    "datalist",
    "fieldset",
    "legend",
    "output",
    "progress",
    "meter",
  ],
  tables: ["table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col"],
  inline: [
    "span",
    "strong",
    "em",
    "b",
    "i",
    "u",
    "s",
    "small",
    "mark",
    "code",
    "kbd",
    "samp",
    "var",
    "sub",
    "sup",
    "q",
    "cite",
    "abbr",
    "dfn",
    "time",
    "data",
    "del",
    "ins",
    "br",
    "wbr",
    "bdi",
    "bdo",
    "ruby",
    "rt",
    "rp",
  ],
} satisfies Record<string, string[]>;

/** The last group: every current HTML element no named group holds and {@link NOT_OFFERED} keeps. */
const REMAINDER = "advanced";

/**
 * HTML elements the palette does not offer at all, because none of them belongs in a page's body.
 * `html`, `head` and `body` are the document itself, which a Jx page already is. `base`, `link`,
 * `meta`, `title`, `script` and `style` belong in the head, which the Page tab edits as `$head`
 * (§6); a Jx document styles itself through `style` and the stylebook and behaves through its
 * functions, not through a tag that runs or applies.
 */
const NOT_OFFERED = new Set([
  "html",
  "head",
  "body",
  "base",
  "link",
  "meta",
  "title",
  "script",
  "style",
]);

// ─── What the @webref packages hand back (they ship no types) ─────────────────

/** One property entry in @webref/css. */
interface WebrefCssProperty {
  legacyAliasOf?: string;
  styleDeclaration?: string[];
  initial?: string;
}

/** The part of @webref/css's `listAll()` result this script reads. */
interface WebrefCss {
  properties: WebrefCssProperty[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [elementsData, cssData, idlData] = await Promise.all([
    listAll(),
    css.listAll(),
    idl.parseAll(),
  ]);

  /* @webref/elements ships no declarations; the repo's types.d.ts declares its listAll() result,
     spec shortname → { elements: [{ name, obsolete? }] }, as its README documents. */
  const specs = new Map(Object.entries(elementsData));
  /* SAFETY: @webref/css's listAll() resolves to { properties: [...] } whose entries carry the
     members WebrefCssProperty names, as its README documents; it ships no declarations either. */
  const cssProperties = (cssData as WebrefCss).properties;

  // 1. Collect all non-obsolete tags
  const tagSet = new Set<string>();
  for (const { elements } of specs.values()) {
    for (const el of elements) {
      if (!el.obsolete) {
        tagSet.add(el.name);
      }
    }
  }
  const allTags = [...tagSet].toSorted();

  // 2. Build categorized elements — only include tags that actually exist in @webref
  const categorized = new Set<string>();
  /** @type {Record<string, { tag: string }[]>} */
  const elements = {};
  for (const [category, tags] of Object.entries(CATEGORIES)) {
    const valid = tags.filter((t) => tagSet.has(t));
    if (valid.length > 0) {
      elements[category] = valid.map((t) => ({ tag: t }));
      for (const t of valid) {
        categorized.add(t);
      }
    }
  }

  // Every other current HTML element the palette offers goes into the last group
  const htmlTags = new Set<string>();
  const html = specs.get("html");
  if (html) {
    for (const el of html.elements) {
      if (!el.obsolete) {
        htmlTags.add(el.name);
      }
    }
  }
  const remainder = [...htmlTags]
    .filter((t) => !categorized.has(t) && !NOT_OFFERED.has(t))
    .toSorted();
  if (remainder.length > 0) {
    elements[REMAINDER] = remainder.map((t) => ({ tag: t }));
  }

  // 3. Extract CSS properties (non-legacy, with camelCase name)
  const cssProps: [string, string][] = [];
  for (const prop of cssProperties) {
    if (prop.legacyAliasOf) {
      continue;
    }
    // Find the lowerCamelCase styleDeclaration entry
    const decls = prop.styleDeclaration ?? [];
    const camel = decls.find((n: string) => !n.includes("-") && !/^[A-Z]/.test(n));
    if (!camel) {
      continue;
    }
    cssProps.push([camel, prop.initial || ""]);
  }
  cssProps.sort((a, b) => a[0].localeCompare(b[0]));

  // 4. Extract event handlers from IDL
  const handlerSet = new Set<string>();
  for (const ast of Object.values(/** @type {Record<string, any>} */ (idlData))) {
    for (const def of /** @type {any[]} */ (ast)) {
      if (def.type !== "interface" && def.type !== "interface mixin") {
        continue;
      }
      for (const member of def.members) {
        if (
          member.type === "attribute" &&
          member.name?.startsWith("on") &&
          // A union type's `idlType` is an array, which never equals the name.
          member.idlType?.idlType === "EventHandler"
        ) {
          handlerSet.add(member.name);
        }
      }
    }
  }
  const eventHandlers = [...handlerSet].toSorted();

  // 5. Write output
  const output = { allTags, cssProps, elements, eventHandlers };
  const json = JSON.stringify(output, null, 2);
  writeFileSync(new URL("../data/webdata.json", import.meta.url), `${json}\n`);

  // Stats
  const cats = Object.entries(elements)
    .map(([k, v]) => `${k}: ${v.length}`)
    .join(", ");
  console.log(`Elements: ${cats}`);
  console.log(`CSS properties: ${cssProps.length}`);
  console.log(`Event handlers: ${eventHandlers.length}`);
  console.log(`All tags: ${allTags.length}`);
  console.log(`Written → data/webdata.json (${(json.length / 1024).toFixed(1)} KB)`);
}

await main();
