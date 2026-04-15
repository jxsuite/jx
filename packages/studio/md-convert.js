/**
 * md-convert.js — Bidirectional mdast ↔ Jx conversion
 *
 * mdToJsonsx(mdast) → Jx element tree (for loading into the canvas)
 * jxToMd(jx) → mdast             (for saving back to markdown)
 *
 * Both are pure tree transformations. The remark ecosystem handles
 * all actual parsing and serialization.
 */

import { MD_ALL, MD_BLOCK, MD_INLINE } from "./md-allowlist.js";

// ─── mdast → Jx ──────────────────────────────────────────────────────────

/**
 * mdast node-type → Jx tagName mapping
 * @type {Record<string, (n: any) => string>}
 */
const MDAST_TAG_MAP = {
  heading: (/** @type {any} */ n) => `h${n.depth}`,
  paragraph: () => "p",
  text: () => "span",
  emphasis: () => "em",
  strong: () => "strong",
  delete: () => "del",
  inlineCode: () => "code",
  link: () => "a",
  image: () => "img",
  blockquote: () => "blockquote",
  list: (/** @type {any} */ n) => (n.ordered ? "ol" : "ul"),
  listItem: () => "li",
  code: () => "pre",
  thematicBreak: () => "hr",
  table: () => "table",
  tableRow: () => "tr",
  tableCell: (/** @type {any} */ n) => (n.isHeader ? "th" : "td"),
  html: () => "div",
  break: () => "br",
};

/**
 * Convert an mdast tree to a Jx element tree.
 * @param {any} mdast - Root mdast node (type: 'root')
 * @returns {any} Jx element tree
 */
export function mdToJsonsx(mdast) {
  if (mdast.type === "root") {
    return {
      tagName: "div",
      $id: "content",
      children: (mdast.children ?? [])
        .filter((/** @type {any} */ n) => n.type !== "yaml" && n.type !== "toml")
        .map(convertMdastNode)
        .filter(Boolean),
    };
  }
  return convertMdastNode(mdast);
}

/**
 * @param {any} node
 * @returns {any}
 */
function convertMdastNode(node) {
  if (!node) return null;

  // Directive nodes → custom elements
  if (
    node.type === "containerDirective" ||
    node.type === "leafDirective" ||
    node.type === "textDirective"
  ) {
    return convertDirective(node);
  }

  const tagFn = MDAST_TAG_MAP[node.type];
  if (!tagFn) return null;

  const tag = tagFn(node);
  /** @type {Record<string, any>} */
  const el = { tagName: tag };

  switch (node.type) {
    case "heading":
    case "paragraph": {
      // If contains only a single text child, flatten to textContent
      if (node.children?.length === 1 && node.children[0].type === "text") {
        el.textContent = node.children[0].value;
      } else if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      break;
    }

    case "text":
      el.textContent = node.value;
      break;

    case "emphasis":
    case "strong":
    case "delete": {
      if (node.children?.length === 1 && node.children[0].type === "text") {
        el.textContent = node.children[0].value;
      } else if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      break;
    }

    case "inlineCode":
      el.textContent = node.value;
      break;

    case "link":
      el.attributes = { href: node.url };
      if (node.title) el.attributes.title = node.title;
      if (node.children?.length === 1 && node.children[0].type === "text") {
        el.textContent = node.children[0].value;
      } else if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      break;

    case "image":
      el.attributes = { src: node.url, alt: node.alt ?? "" };
      if (node.title) el.attributes.title = node.title;
      break;

    case "blockquote":
    case "listItem":
      if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      break;

    case "list":
      if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      if (node.start != null && node.start !== 1) {
        el.attributes = { start: String(node.start) };
      }
      break;

    case "code":
      // Fenced code → pre > code
      el.children = [
        {
          tagName: "code",
          textContent: node.value,
          ...(node.lang ? { attributes: { class: `language-${node.lang}` } } : {}),
        },
      ];
      break;

    case "thematicBreak":
    case "break":
      // Void elements — no content
      break;

    case "table": {
      // Mdast tables have rows directly; split into thead/tbody
      const rows = (node.children ?? []).map(convertMdastNode).filter(Boolean);
      const thead = rows.length > 0 ? { tagName: "thead", children: [rows[0]] } : null;
      const tbody = rows.length > 1 ? { tagName: "tbody", children: rows.slice(1) } : null;
      el.children = [thead, tbody].filter(Boolean);
      break;
    }

    case "tableRow":
      if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      break;

    case "tableCell":
      if (node.children?.length === 1 && node.children[0].type === "text") {
        el.textContent = node.children[0].value;
      } else if (node.children?.length > 0) {
        el.children = node.children.map(convertMdastNode).filter(Boolean);
      }
      break;

    case "html":
      el.innerHTML = node.value;
      break;
  }

  return el;
}

/**
 * @param {any} node
 * @returns {any}
 */
function convertDirective(node) {
  /** @type {Record<string, any>} */
  const el = { tagName: node.name };
  if (node.attributes && Object.keys(node.attributes).length > 0) {
    el.attributes = { ...node.attributes };
  }
  if (node.type === "textDirective") {
    // Text directives place label as textContent
    if (node.children?.length === 1 && node.children[0].type === "text") {
      el.textContent = node.children[0].value;
    } else if (node.children?.length > 0) {
      el.children = node.children.map(convertMdastNode).filter(Boolean);
    }
  } else if (node.type === "containerDirective" && node.children?.length > 0) {
    el.children = node.children.map(convertMdastNode).filter(Boolean);
  }
  return el;
}

// ─── Jx → mdast ──────────────────────────────────────────────────────────

/**
 * Jx tagName → mdast node-type mapping (inverse of MDAST_TAG_MAP)
 * @type {Record<string, string>}
 */
const TAG_MDAST_MAP = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  p: "paragraph",
  span: "text",
  em: "emphasis",
  strong: "strong",
  del: "delete",
  code: "inlineCode",
  a: "link",
  img: "image",
  blockquote: "blockquote",
  ul: "list",
  ol: "list",
  li: "listItem",
  pre: "code",
  hr: "thematicBreak",
  table: "table",
  tr: "tableRow",
  th: "tableCell",
  td: "tableCell",
  br: "break",
};

/**
 * Convert a Jx element tree to an mdast tree.
 * @param {any} jx - Jx element tree (root content div)
 * @returns {any} mdast root node
 */
export function jxToMd(jx) {
  const children = (jx.children ?? [])
    .map((/** @type {any} */ child, /** @type {number} */ i) => convertJsonsxNode(child, true))
    .filter(Boolean);

  return { type: "root", children };
}

/**
 * Convert a single Jx element to an mdast node.
 * @param {any} el - Jx element
 * @param {boolean} isBlock - Whether this element is in a block context
 * @returns {any} mdast node
 */
function convertJsonsxNode(el, isBlock) {
  if (!el || typeof el !== "object") return null;

  const tag = el.tagName ?? "div";

  // If not in the markdown allowlist, convert to directive
  if (!MD_ALL.has(tag)) {
    return convertToDirective(el, isBlock);
  }

  const mdastType = TAG_MDAST_MAP[tag];
  if (!mdastType) return null;

  switch (mdastType) {
    case "heading":
      return {
        type: "heading",
        depth: parseInt(tag.slice(1), 10),
        children: inlineChildren(el),
      };

    case "paragraph":
      return {
        type: "paragraph",
        children: inlineChildren(el),
      };

    case "text":
      return { type: "text", value: el.textContent ?? "" };

    case "emphasis":
    case "strong":
    case "delete":
      return {
        type: mdastType,
        children: inlineChildren(el),
      };

    case "inlineCode":
      return { type: "inlineCode", value: el.textContent ?? "" };

    case "link":
      return {
        type: "link",
        url: el.attributes?.href ?? "",
        title: el.attributes?.title ?? null,
        children: inlineChildren(el),
      };

    case "image":
      return {
        type: "image",
        url: el.attributes?.src ?? "",
        alt: el.attributes?.alt ?? "",
        title: el.attributes?.title ?? null,
      };

    case "blockquote":
      return {
        type: "blockquote",
        children: blockChildren(el),
      };

    case "list":
      return {
        type: "list",
        ordered: tag === "ol",
        start: tag === "ol" ? parseInt(el.attributes?.start, 10) || 1 : null,
        spread: false,
        children: (el.children ?? []).map((/** @type {any} */ c) => convertJsonsxNode(c, true)).filter(Boolean),
      };

    case "listItem":
      return {
        type: "listItem",
        spread: false,
        children: blockChildren(el),
      };

    case "code": {
      // pre > code → fenced code block
      const codeChild = el.children?.[0];
      const langClass = codeChild?.attributes?.class ?? "";
      const lang = langClass.replace("language-", "") || null;
      return {
        type: "code",
        lang,
        value: codeChild?.textContent ?? el.textContent ?? "",
      };
    }

    case "thematicBreak":
      return { type: "thematicBreak" };

    case "break":
      return { type: "break" };

    case "table": {
      // Flatten thead/tbody back to rows
      /** @type {any[]} */
      const rows = [];
      for (const section of el.children ?? []) {
        if (section.tagName === "thead" || section.tagName === "tbody") {
          for (const row of section.children ?? []) {
            const mdRow = convertJsonsxNode(row, true);
            if (mdRow) {
              // Mark header cells
              if (section.tagName === "thead") {
                for (const cell of mdRow.children ?? []) {
                  cell.isHeader = true;
                }
              }
              rows.push(mdRow);
            }
          }
        }
      }
      return {
        type: "table",
        align: null,
        children: rows,
      };
    }

    case "tableRow":
      return {
        type: "tableRow",
        children: (el.children ?? []).map((/** @type {any} */ c) => convertJsonsxNode(c, false)).filter(Boolean),
      };

    case "tableCell":
      return {
        type: "tableCell",
        children: inlineChildren(el),
      };
  }

  return null;
}

/**
 * Get inline children from a Jx element as mdast nodes.
 * Handles both textContent shorthand and explicit children array.
 * @param {any} el
 * @returns {any[]}
 */
function inlineChildren(el) {
  if (el.textContent != null) {
    return [{ type: "text", value: String(el.textContent) }];
  }
  return (el.children ?? []).map((/** @type {any} */ c) => convertJsonsxNode(c, false)).filter(Boolean);
}

/**
 * Get block children from a Jx element as mdast nodes.
 * @param {any} el
 * @returns {any[]}
 */
function blockChildren(el) {
  if (el.textContent != null) {
    // Wrap bare text in a paragraph
    return [{ type: "paragraph", children: [{ type: "text", value: String(el.textContent) }] }];
  }
  return (el.children ?? []).map((/** @type {any} */ c) => convertJsonsxNode(c, true)).filter(Boolean);
}

/**
 * Convert a non-markdown-native Jx element to a directive node.
 * @param {any} el
 * @param {boolean} isBlock
 * @returns {any}
 */
function convertToDirective(el, isBlock) {
  const tag = el.tagName ?? "div";
  const attrs = el.attributes ? { ...el.attributes } : {};

  if (!isBlock) {
    // Inline → textDirective
    return {
      type: "textDirective",
      name: tag,
      attributes: attrs,
      children:
        el.textContent != null
          ? [{ type: "text", value: String(el.textContent) }]
          : (el.children ?? []).map((/** @type {any} */ c) => convertJsonsxNode(c, false)).filter(Boolean),
    };
  }

  // Block without children → leafDirective
  if (!el.children?.length && el.textContent == null) {
    return {
      type: "leafDirective",
      name: tag,
      attributes: attrs,
      children: [],
    };
  }

  // Block with children → containerDirective
  return {
    type: "containerDirective",
    name: tag,
    attributes: attrs,
    children:
      el.textContent != null
        ? [{ type: "paragraph", children: [{ type: "text", value: String(el.textContent) }] }]
        : (el.children ?? []).map((/** @type {any} */ c) => convertJsonsxNode(c, true)).filter(Boolean),
  };
}
