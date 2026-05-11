/**
 * Jx Markdown Transpiler — Browser-safe module
 *
 * Exports only the transpiler functions that work in browser environments
 * (no node:fs, node:path, or glob dependencies).
 *
 * Use `@jxsuite/parser/transpile` to import in browser contexts (e.g. studio).
 * Use `@jxsuite/parser` for the full parser including MarkdownFile/MarkdownCollection.
 *
 * @module @jxsuite/parser/transpile
 * @license MIT
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkFrontmatter from "remark-frontmatter";
import remarkParseFrontmatter from "remark-parse-frontmatter";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";

// ─── Dot-path expansion ─────────────────────────────────────────────────────

/**
 * Jx reserved keywords that need `$` prefix in directive attributes. Only includes keywords with no
 * DOM/HTML property collision.
 */
const JX_DOLLAR_KEYS = new Set(["prototype", "ref", "component", "props", "switch", "elements"]);

/**
 * Re-add `$` prefix to known Jx reserved keywords.
 *
 * @param {string} key
 * @returns {string}
 */
export function jxKey(key) {
  return JX_DOLLAR_KEYS.has(key) ? `$${key}` : key;
}

/**
 * Strip `$` prefix from Jx reserved keywords for markdown attribute output.
 *
 * @param {string} key
 * @returns {string}
 */
export function mdKey(key) {
  if (key.startsWith("$") && JX_DOLLAR_KEYS.has(key.slice(1))) {
    return key.slice(1);
  }
  return key;
}

/**
 * Expand dot-path attribute keys into nested objects.
 *
 * @param {Record<string, string>} attrs - Flat attribute map from remark-directive
 * @returns {Record<string, any>} Nested object
 */
export function expandDotPaths(attrs) {
  /** @type {Record<string, any>} */
  const result = {};

  for (const [key, value] of Object.entries(attrs)) {
    const dotIndex = key.indexOf(".");
    if (dotIndex === -1) {
      result[jxKey(key)] = value;
      continue;
    }

    const segments = key.split(".");
    let target = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = jxKey(segments[i]);
      if (!(seg in target) || typeof target[seg] !== "object") {
        target[seg] = {};
      }
      target = target[seg];
    }
    target[jxKey(segments[segments.length - 1])] = value;
  }

  return result;
}

/**
 * Collapse a nested object back to dot-path flat attributes (inverse of expandDotPaths).
 *
 * @param {Record<string, any>} obj - Nested object
 * @returns {Record<string, string>} Flat attribute map
 */
export function collapseDotPaths(obj) {
  /** @type {Record<string, string>} */
  const result = {};

  function walk(/** @type {Record<string, any>} */ node, /** @type {string} */ prefix) {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        walk(value, path);
      } else {
        result[path] = String(value);
      }
    }
  }

  walk(obj, "");
  return result;
}

/** CSS pseudo-class / pseudo-element names (keys that become `:` prefixed in style objects). */
const CSS_PSEUDO_NAMES = new Set([
  "hover",
  "focus",
  "active",
  "visited",
  "disabled",
  "checked",
  "valid",
  "invalid",
  "required",
  "empty",
  "first-child",
  "last-child",
  "focus-within",
  "focus-visible",
  "placeholder",
  "selection",
  "before",
  "after",
]);

/**
 * Apply CSS pseudo-class and media query key mapping to a style object's top-level keys.
 *
 * Transforms keys that cannot use `:` or `@` prefixes in remark-directive attributes: - `hover` →
 * `:hover` (for known CSS pseudo-class names) - `--dark` → `@--dark` (for custom property / media
 * query keys)
 *
 * @param {Record<string, any>} styleObj
 * @returns {Record<string, any>}
 */
export function applyStyleKeyMapping(styleObj) {
  /** @type {Record<string, any>} */
  const result = {};
  for (const [key, value] of Object.entries(styleObj)) {
    if (CSS_PSEUDO_NAMES.has(key)) {
      result[`:${key}`] = value;
    } else if (key.startsWith("--")) {
      result[`@${key}`] = value;
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Expand dot-path attributes with style-aware key mapping.
 *
 * Maps known CSS pseudo-class names → `:` prefix and `--` keys → `@` prefix, since `:` and `@`
 * cannot appear at the start of remark-directive attribute keys.
 *
 * @param {Record<string, string>} attrs
 * @returns {Record<string, any>}
 */
export function expandStylePaths(attrs) {
  return applyStyleKeyMapping(expandDotPaths(attrs));
}

/**
 * Collapse a style object back to flat dot-path attributes (inverse of expandStylePaths).
 *
 * Strips `:` prefix from pseudo-class keys and `@` prefix from media keys before flattening with
 * collapseDotPaths.
 *
 * @param {Record<string, any>} styleObj
 * @returns {Record<string, string>}
 */
export function collapseStylePaths(styleObj) {
  /** @type {Record<string, any>} */
  const normalized = {};

  for (const [key, value] of Object.entries(styleObj)) {
    if (key.startsWith(":") && CSS_PSEUDO_NAMES.has(key.slice(1))) {
      normalized[key.slice(1)] = value;
    } else if (key.startsWith("@--")) {
      normalized[key.slice(1)] = value;
    } else {
      normalized[key] = value;
    }
  }

  return collapseDotPaths(normalized);
}

// ─── Detection ──────────────────────────────────────────────────────────────

/**
 * Check if a markdown source string is a Jx component (vs content markdown). Returns true if
 * frontmatter contains a `tagName` key with a hyphen.
 *
 * @param {string} source - Raw markdown string
 * @returns {boolean}
 */
export function isJxMarkdown(source) {
  const fmMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return false;
  return /^tagName:\s*.+-.+/m.test(fmMatch[1]);
}

// ─── Transpiler ─────────────────────────────────────────────────────────────

/** HTML attributes that go into the `attributes` sub-object (not top-level DOM properties). */
const HTML_ATTR_PATTERN = /^(?:aria-|data-|slot$)/;

/**
 * Route directive attributes to their correct Jx locations.
 *
 * @param {Record<string, string>} attrs
 * @returns {{ props: Record<string, any>; attributes: Record<string, string> }}
 */
function routeAttributes(attrs) {
  const expanded = expandDotPaths(attrs);

  // Apply style-key mapping (pseudo-classes, media queries) to the style sub-object
  if (expanded.style && typeof expanded.style === "object") {
    expanded.style = applyStyleKeyMapping(expanded.style);
  }

  /** @type {Record<string, any>} */
  const props = {};
  /** @type {Record<string, string>} */
  const attributes = {};

  for (const [key, value] of Object.entries(expanded)) {
    if (HTML_ATTR_PATTERN.test(key)) {
      attributes[key] = value;
    } else {
      props[key] = value;
    }
  }

  return { props, attributes };
}

/**
 * Mdast node-type → Jx tagName mapping.
 *
 * @type {Record<string, (n: any) => string>}
 */
const JX_TAG_MAP = {
  heading: (/** @type {any} */ n) => `h${n.depth}`,
  paragraph: () => "p",
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
  break: () => "br",
  table: () => "table",
  tableRow: () => "tr",
  tableCell: (/** @type {any} */ n) => (n.isHeader ? "th" : "td"),
};

/**
 * Convert a standard mdast node to a Jx element definition.
 *
 * @param {any} node
 * @returns {any} Jx element or null
 */
function mdastNodeToJx(node) {
  if (!node || typeof node !== "object") return null;

  if (node.type === "yaml" || node.type === "toml") return null;

  if (
    node.type === "containerDirective" ||
    node.type === "leafDirective" ||
    node.type === "textDirective"
  ) {
    return directiveToJx(node);
  }

  if (node.type === "text") {
    return node.value;
  }

  const tagFn = JX_TAG_MAP[node.type];
  if (!tagFn) return null;

  const tag = tagFn(node);
  /** @type {Record<string, any>} */
  const el = { tagName: tag };

  switch (node.type) {
    case "heading":
    case "paragraph":
    case "emphasis":
    case "strong":
    case "delete":
    case "blockquote":
    case "listItem":
    case "tableRow":
    case "tableCell": {
      const children = convertChildren(node.children);
      if (children.length === 1 && typeof children[0] === "string") {
        el.textContent = children[0];
      } else if (children.length > 0) {
        el.children = children;
      }
      break;
    }

    case "inlineCode":
      el.textContent = node.value;
      break;

    case "link":
      el.attributes = { href: node.url };
      if (node.title) el.attributes.title = node.title;
      {
        const children = convertChildren(node.children);
        if (children.length === 1 && typeof children[0] === "string") {
          el.textContent = children[0];
        } else if (children.length > 0) {
          el.children = children;
        }
      }
      break;

    case "image":
      el.attributes = { src: node.url, alt: node.alt ?? "" };
      if (node.title) el.attributes.title = node.title;
      break;

    case "list":
      if (node.children?.length > 0) {
        el.children = convertChildren(node.children);
      }
      if (node.start != null && node.start !== 1) {
        el.attributes = { start: String(node.start) };
      }
      break;

    case "code":
      el.children = [
        {
          tagName: "code",
          textContent: node.value,
          ...(node.lang ? { className: `language-${node.lang}` } : {}),
        },
      ];
      break;

    case "thematicBreak":
    case "break":
      break;

    case "table": {
      const rows = convertChildren(node.children);
      const thead = rows.length > 0 ? { tagName: "thead", children: [rows[0]] } : null;
      const tbody = rows.length > 1 ? { tagName: "tbody", children: rows.slice(1) } : null;
      el.children = [thead, tbody].filter(Boolean);
      break;
    }
  }

  return el;
}

/**
 * Convert a directive mdast node to a Jx element.
 *
 * @param {any} node
 * @returns {any}
 */
function directiveToJx(node) {
  /** @type {Record<string, any>} */
  const el = { tagName: node.name };

  if (node.attributes && Object.keys(node.attributes).length > 0) {
    const { props, attributes } = routeAttributes(node.attributes);
    const isCustomElement = node.name.includes("-");
    if (isCustomElement) {
      // For custom elements, separate element-level props from component $props.
      // Element-level: style, Jx keywords ($ref, $component, etc.), textContent, innerHTML
      // Everything else becomes $props so the runtime merges them into component state.
      /** @type {Record<string, any>} */
      const componentProps = {};
      for (const [key, value] of Object.entries(props)) {
        if (
          key === "style" ||
          key === "children" ||
          key === "textContent" ||
          key === "innerHTML" ||
          key.startsWith("$")
        ) {
          el[key] = value;
        } else {
          componentProps[key] = value;
        }
      }
      if (Object.keys(componentProps).length > 0) {
        el.$props = componentProps;
      }
    } else {
      Object.assign(el, props);
    }
    if (Object.keys(attributes).length > 0) {
      el.attributes = attributes;
    }
  }

  if (node.type === "textDirective") {
    if (node.children?.length > 0) {
      const children = convertChildren(node.children);
      if (children.length === 1 && typeof children[0] === "string") {
        el.textContent = children[0];
      } else if (children.length > 0) {
        el.children = children;
      }
    }
    return el;
  }

  if (node.type === "leafDirective") {
    return el;
  }

  if (node.children?.length > 0) {
    /** @type {any[]} */
    const jxChildren = [];

    for (const child of node.children) {
      const converted = mdastNodeToJx(child);
      if (converted != null) jxChildren.push(converted);
    }

    // Don't overwrite children if already set as an object by dot-path attributes
    // (e.g. children.prototype="Array" children.items.ref="...")
    if (el.children && typeof el.children === "object" && !Array.isArray(el.children)) {
      // children was set to a descriptor object by dot-path expansion — keep it
    } else if (jxChildren.length === 1 && typeof jxChildren[0] === "string") {
      el.textContent = jxChildren[0];
    } else if (jxChildren.length > 0) {
      el.children = jxChildren;
    }
  }

  return el;
}

/**
 * Convert an array of mdast children to Jx elements/strings.
 *
 * @param {any[]} children
 * @returns {any[]}
 */
function convertChildren(children) {
  if (!children) return [];
  return children.map(mdastNodeToJx).filter((c) => c != null);
}

/**
 * Transpile a Jx Markdown source string into a complete Jx JSON document.
 *
 * Uses the standard remark-parse + remark-frontmatter + remark-directive pipeline (no rehype).
 * Walks the mdast tree and emits a Jx document with the same shape as a .json component file.
 *
 * @param {string} source - Raw markdown string
 * @returns {object} Complete Jx JSON document
 */
export function transpileJxMarkdown(source) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkParseFrontmatter)
    .use(remarkGfm)
    .use(remarkDirective);

  const tree = processor.parse(source);
  const vfile = { data: {} };
  processor.runSync(tree, vfile);

  const frontmatter = /** @type {any} */ (vfile.data)?.frontmatter ?? {};

  /** @type {Record<string, any>} */
  const doc = {};

  for (const [key, value] of Object.entries(frontmatter)) {
    doc[key] = value;
  }

  const bodyNodes = tree.children.filter(
    (/** @type {any} */ n) => n.type !== "yaml" && n.type !== "toml",
  );

  /** @type {any[]} */
  const children = [];

  for (const node of bodyNodes) {
    const converted = mdastNodeToJx(node);
    if (converted != null) children.push(converted);
  }

  if (children.length > 0) {
    doc.children = children;
  }

  return doc;
}
