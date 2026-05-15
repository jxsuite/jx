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
      el.attributes = hastPropsToAttributes(node.properties);
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
 * @returns {Record<string, string>}
 */
function hastPropsToAttributes(properties) {
  /** @type {Record<string, string>} */
  const attrs = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === false || value === undefined || value === null) continue;

    const info = find(htmlInfo, key);
    const name = info.attribute;

    if (value === true) {
      attrs[name] = "";
    } else if (Array.isArray(value)) {
      attrs[name] = value.join(info.commaSeparated ? ", " : " ");
    } else {
      attrs[name] = String(value);
    }
  }
  return attrs;
}
