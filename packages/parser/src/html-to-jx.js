import { fromHtml } from "hast-util-from-html";
import { whitespace } from "hast-util-whitespace";
import { find, html as htmlInfo } from "property-information";

/**
 * Convert an HTML string into an array of Jx tree nodes.
 *
 * @param {string} htmlString
 * @returns {any[]}
 */
export function htmlToJx(htmlString) {
  const hast = fromHtml(htmlString, { fragment: true });
  return convertHastChildren(hast.children);
}

/**
 * @param {any[]} children
 * @returns {any[]}
 */
function convertHastChildren(children) {
  /** @type {any[]} */
  const result = [];
  for (const child of children) {
    const converted = convertHastNode(child);
    if (converted != null) result.push(converted);
  }
  return result;
}

/**
 * @param {any} node
 * @returns {any}
 */
function convertHastNode(node) {
  if (node.type === "text") {
    if (whitespace(node)) return null;
    return node.value;
  }

  if (node.type === "element") {
    /** @type {Record<string, any>} */
    const el = { tagName: node.tagName };

    if (node.properties && Object.keys(node.properties).length > 0) {
      const { style, attrs } = hastPropsToJx(node.properties);
      if (Object.keys(attrs).length > 0) el.attributes = attrs;
      if (Object.keys(style).length > 0) el.style = style;
    }

    const kids = node.children ? convertHastChildren(node.children) : [];

    if (kids.length === 1 && typeof kids[0] === "string") {
      el.textContent = kids[0];
    } else if (kids.length > 0) {
      el.children = kids;
    }

    return el;
  }

  return null;
}

/**
 * @param {Record<string, any>} properties
 * @returns {{ style: Record<string, string>; attrs: Record<string, string> }}
 */
function hastPropsToJx(properties) {
  /** @type {Record<string, string>} */
  const attrs = {};
  /** @type {Record<string, string>} */
  const style = {};

  for (const [key, value] of Object.entries(properties)) {
    if (value === false || value === undefined || value === null) continue;

    const info = find(htmlInfo, key);
    const name = info.attribute;

    if (name === "style" && typeof value === "string") {
      parseInlineStyle(value, style);
      continue;
    }

    if (value === true) {
      attrs[name] = "";
    } else if (Array.isArray(value)) {
      attrs[name] = value.join(info.commaSeparated ? ", " : " ");
    } else {
      attrs[name] = String(value);
    }
  }
  return { style, attrs };
}

/**
 * @param {string} styleStr
 * @param {Record<string, string>} out
 */
function parseInlineStyle(styleStr, out) {
  for (const decl of styleStr.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim();
    const val = decl.slice(colon + 1).trim();
    if (prop && val) out[prop] = val;
  }
}
