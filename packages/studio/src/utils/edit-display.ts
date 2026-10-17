/// <reference lib="dom" />
/**
 * Edit-mode display transforms — extracted from studio.js (Phase 4i). Pure stateless functions that
 * convert document trees for visual editing (template expressions, $map, $switch, empty
 * placeholders).
 *
 * @docs studio/interface/modes
 */

import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";
import { displayTagName, isNodeObject, isNonNullObject, isString } from "@jxsuite/schema/guards";
import { isDocumentContainer } from "./strip-events";
import type { RebuiltNode } from "./strip-events";

const mediaTags = new Set(["img", "video", "source", "iframe", "audio"]);
/** A 1×1 transparent GIF: what an unresolvable `src` binding shows in edit mode. */
export const TRANSPARENT_PX =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
// A neutral, visible gray placeholder for image-like bindings in edit mode (e.g. a component `image`
// Prop bound to ${...}). The component renders <img src={prop}> internally, so a transparent pixel
// Would collapse to nothing — a gray SVG box reads as an intentional placeholder instead.
export const PLACEHOLDER_IMG =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='32'%20height='32'%3E%3Crect%20width='32'%20height='32'%20fill='%23d0d0d0'/%3E%3C/svg%3E";

/**
 * Swap every image under `host` that fails to load for {@link PLACEHOLDER_IMG}, until `signal`
 * aborts.
 *
 * For previews drawn in the PARENT realm, where nothing ran {@link prepareForEditMode}: a library
 * card's file, a component whose image prop is a `${}` binding with nothing to bind it, a document
 * whose `src` is empty. The browser drew each as its broken-image glyph. `error` does not bubble,
 * so the listener captures — which also covers images a preview renders after it is mounted. An
 * empty `src` fires `error` too, so it needs no separate test; an image already showing the
 * placeholder is left alone, so a placeholder that cannot load (it always can) does not loop.
 *
 * @param {Element} host
 * @param {AbortSignal} signal
 */
export function placeholderBrokenImages(host: Element, signal: AbortSignal): void {
  host.addEventListener(
    "error",
    (event) => {
      const { target } = event;
      if (target instanceof HTMLImageElement && target.getAttribute("src") !== PLACEHOLDER_IMG) {
        target.setAttribute("src", PLACEHOLDER_IMG);
        target.removeAttribute("srcset");
        target.dataset.placeholder = "";
      }
    },
    { capture: true, signal },
  );
}

// Prop/attribute names that feed an <img>/background, so a ${...} binding would otherwise render a
// Broken image in edit mode. Matched by exact name or common camelCase suffix (featuredImage, heroBg).
const IMAGE_KEY_RE =
  /(src|poster|image|bg|background|icon|logo|photo|avatar|thumbnail|cover|banner)$/i;
function isImageUrlKey(key: string): boolean {
  return IMAGE_KEY_RE.test(key);
}

/** A template that reads the repeater row (`item`, `index`, `$map`), which edit mode cannot supply. */
const ROW_BINDING_RE = /(?<![\w$.])(?:item|index|\$map)\b/u;

/** Whether a value is a template or `$ref` that reads the repeater row. */
export function isRowBound(value: JxDocumentValue | undefined): boolean {
  if (isString(value)) {
    return value.includes("${") && ROW_BINDING_RE.test(value);
  }
  return isNodeObject(value) && isString(value.$ref) && /^(?:#\/)?\$map\//u.test(value.$ref);
}

/**
 * What a row-bound value shows in the perimeter: link targets are inert, image-like keys the
 * placeholder image, anything else its readable binding text.
 *
 * @param {string} key
 * @param {JxDocumentValue | undefined} value
 */
function rowBoundDisplay(key: string, value: JxDocumentValue | undefined): string {
  if (key === "href" || key === "action") {
    return "";
  }
  if (isImageUrlKey(key)) {
    return PLACEHOLDER_IMG;
  }
  if (isString(value)) {
    return templateToEditDisplay(value);
  }
  return isNodeObject(value) && isString(value.$ref) ? refDisplayLabel(value.$ref) : "";
}

const textTags = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
  "dt",
  "dd",
  "th",
  "td",
  "span",
  "strong",
  "em",
  "small",
  "mark",
  "code",
  "abbr",
  "q",
  "sub",
  "sup",
  "time",
  "a",
  "button",
  "label",
  "legend",
  "caption",
  "summary",
  "pre",
  "option",
]);

const containerTags = new Set([
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "figure",
  "figcaption",
  "details",
  "fieldset",
  "form",
  "ul",
  "ol",
  "dl",
  "table",
]);

/** All placeholder classes prepareForEditMode may add to an empty element. */
export const EMPTY_PLACEHOLDER_CLASSES = [
  "empty-text-placeholder",
  "empty-container-placeholder",
] as const;

/**
 * The empty-placeholder class prepareForEditMode would add for this node, or null. Used by the
 * canvas patcher to keep placeholder classes in sync when patching text without a full render.
 *
 * @param {JxMutableNode} node
 */
export function computeEmptyPlaceholderClass(node: JxMutableNode): string | null {
  if (!node.tagName || node.textContent || node.innerHTML) {
    return null;
  }
  // Layout-originated nodes ($__layout, set by markLayoutNodes) are read-only in page context;
  // Edit affordances like "Click here to add text" don't apply to them.
  if (node.$__layout) {
    return null;
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    return null;
  }
  if (textTags.has(displayTagName(node.tagName))) {
    return "empty-text-placeholder";
  }
  if (containerTags.has(displayTagName(node.tagName))) {
    return "empty-container-placeholder";
  }
  return null;
}

/**
 * Convert a template string to a displayable expression for edit mode. Replaces ${expr} with ❮ expr
 * ❯ so the runtime renders it as literal text.
 *
 * @param {string} str
 */
export function templateToEditDisplay(str: string) {
  return str.replaceAll(/\$\{([^}]+)\}/g, "\u276A $1 \u276B");
}

/**
 * Reverse templateToEditDisplay: walk all text nodes in `el` and replace ❪ expr ❫ back to ${expr}
 * so the user edits raw template syntax.
 *
 * @param {HTMLElement} el
 */
export function restoreTemplateExpressions(el: HTMLElement) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    // SAFETY: the walker was created with NodeFilter.SHOW_TEXT, so every node it stops on is Text.
    const node = walker.currentNode as Text;
    if (node.data.includes("\u276A")) {
      node.data = node.data.replaceAll(/\u276A\s*(.*?)\s*\u276B/g, "${$1}");
    }
  }
}

/**
 * Build the edit-mode visual for a mapped array: a `<div class="repeater-perimeter">` wrapping a
 * single prepared instance of the map template. Always one element (an empty perimeter when the
 * template is missing) so the array keeps a 1:1 DOM node at its sibling index. The perimeter is an
 * edit-only device — it is never compiled or rendered in preview.
 *
 * @param {JxMutableNode} arrayObj
 * @returns {JxMutableNode}
 */
function arrayToPerimeter(arrayObj: JxMutableNode): JxMutableNode {
  const template = arrayObj.map;
  return {
    children: isNonNullObject(template) ? [prepareForEditMode(template)] : [],
    className: "repeater-perimeter",
    tagName: "div",
  };
}

/**
 * The text a `$ref` binding shows in edit mode: its pointer, with the `#/state/` prefix dropped.
 *
 * @param {string} ref
 */
function refDisplayLabel(ref: string): string {
  const label = ref.startsWith("#/state/") ? ref.slice(8) : ref;
  return `{${label}}`;
}

/**
 * Prepare a document for edit-mode rendering. Replaces template strings with readable literal text,
 * $prototype:Array with placeholders, and $ref bindings with display labels. Preserves state so the
 * runtime can still initialise scope. Arrays are prepared member by member, and primitives and a
 * cleared (`undefined`) key return unchanged, so the walker can recurse through any document
 * value.
 *
 * @param {JxMutableNode} node
 * @returns {JxMutableNode}
 */
export function prepareForEditMode(node: JxMutableNode): JxMutableNode;
export function prepareForEditMode(node: JxDocumentValue): JxDocumentValue;
export function prepareForEditMode(node: JxDocumentValue | undefined): JxDocumentValue | undefined;
export function prepareForEditMode(node: JxDocumentValue | undefined): JxDocumentValue | undefined {
  if (Array.isArray(node)) {
    // Arrays of nodes round-trip element-wise; the array itself is not a node.
    return node.map((n) => prepareForEditMode(n));
  }
  if (!isNodeObject(node)) {
    return node;
  }

  // A mapped-array node itself → its edit-mode perimeter (e.g. when the patcher re-renders an
  // Array node directly). Members inside a children array funnel here via the children branch.
  if (node.$prototype === "Array") {
    return arrayToPerimeter(node);
  }

  const obj = node;

  const out: RebuiltNode = {};
  let needsMediaPlaceholder = false;
  const isMediaElement = isString(obj.tagName) && mediaTags.has(obj.tagName);

  // Check if this media element lacks a resolvable src (top-level or in attributes)
  if (isMediaElement) {
    const attrs = obj.attributes;
    const topSrc = obj.src;
    const attrSrc = attrs?.src;
    const topPoster = obj.poster;
    const attrPoster = attrs?.poster;
    const hasSrc = (topSrc && topSrc !== "") || (attrSrc && attrSrc !== "");
    const hasPoster = (topPoster && topPoster !== "") || (attrPoster && attrPoster !== "");
    if (!hasSrc && !hasPoster) {
      needsMediaPlaceholder = true;
    }
  }

  for (const [k, v] of Object.entries(obj)) {
    if (k === "state" || k === "$media" || k === "$elements") {
      out[k] = v; // Preserve as-is for runtime resolution
    } else if (k === "$props" && isDocumentContainer(v)) {
      /* A component's inputs render LIVE. They are its configuration, not text the author edits in
         place (a template-valued prop is refused by inline prop editing), and showing their binding
         text instead fed it to the component as a value: a header's `variant` became the literal
         `❪ state.headerVariant ❫` and matched none of its styles. A prop that reads the repeater
         row is the exception — the perimeter draws one row with no row to read — so it keeps the
         readable binding text, or the placeholder image for an image-like key. */
      const propsOut: RebuiltNode = {};
      for (const [pk, pv] of Object.entries(v)) {
        propsOut[pk] = isRowBound(pv) ? rowBoundDisplay(pk, pv) : pv;
      }
      out[k] = propsOut;
    } else if (k === "children") {
      if (Array.isArray(v)) {
        // Each member recurses; array pseudo-elements become a single repeater-perimeter element
        // (via the top-level array case) so they stay a 1:1 DOM node among their siblings.
        out.children = v.map((c) => prepareForEditMode(c));
      } else if (isNodeObject(v) && v.$prototype === "Array") {
        // Legacy whole-children repeater → a single perimeter as the sole child.
        out.children = [prepareForEditMode(v)];
      } else {
        out.children = prepareForEditMode(v);
      }
    } else if (k === "cases" && obj.$switch && isDocumentContainer(v)) {
      // Replace $switch cases with a placeholder showing the first case or a label
      const [firstEntry] = Object.entries(v);
      if (firstEntry) {
        const [, firstCase] = firstEntry;
        out.children =
          isDocumentContainer(firstCase) && !(isNodeObject(firstCase) && firstCase.$ref)
            ? [prepareForEditMode(firstCase)]
            : [
                {
                  style: {
                    background: "color-mix(in srgb, var(--danger) 8%, transparent)",
                    border: "1px dashed color-mix(in srgb, var(--danger) 40%, transparent)",
                    borderRadius: "4px",
                    color: "var(--danger)",
                    fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
                    fontSize: "11px",
                    fontStyle: "italic",
                    padding: "6px 10px",
                  },
                  tagName: "div",
                  textContent: `[$switch: ${Object.keys(v).join(" | ")}]`,
                },
              ];
      }
    } else if (k === "attributes" && isMediaElement && isDocumentContainer(v)) {
      // A media element's src/poster: live, unless it reads the repeater row or names nothing.
      const processed: RebuiltNode = {};
      for (const [ak, av] of Object.entries(v)) {
        if ((ak === "src" || ak === "poster") && (av === "" || av == null || isRowBound(av))) {
          needsMediaPlaceholder = true;
          processed[ak] = TRANSPARENT_PX;
        } else {
          processed[ak] = isRowBound(av) ? rowBoundDisplay(ak, av) : av;
        }
      }
      out.attributes = processed;
    } else if (k === "attributes" && isDocumentContainer(v)) {
      const processed: RebuiltNode = {};
      for (const [ak, av] of Object.entries(v)) {
        processed[ak] = isRowBound(av) ? rowBoundDisplay(ak, av) : av;
      }
      out.attributes = processed;
    } else if (k === "style") {
      /* Live, like every binding but text: state IS live on the canvas. Only a declaration that
         reads the repeater row is omitted — the perimeter has no row — and omitted rather than
         blanked, because `color: ` is a malformed declaration in a rule where the cascade answers
         an absent one. Mirrored by iframe-patch's editModeStyle. */
      if (isDocumentContainer(v)) {
        const s: RebuiltNode = {};
        for (const [sk, sv] of Object.entries(v)) {
          if (!isRowBound(sv)) {
            s[sk] = sv;
          }
        }
        out.style = s;
      } else {
        out.style = v;
      }
    } else if (k === "$switch" && isString(v) && v.includes("${")) {
      /* Not a render input any more: `cases` is replaced by the first case above, so a live
         expression would hand the runtime a switch with nothing to choose from. */
      out[k] = templateToEditDisplay(v);
    } else if (k === "textContent" && isString(v) && v.includes("${")) {
      // The author's text: shown as its binding, so editing it in place edits the template.
      out[k] = templateToEditDisplay(v);
    } else if (k === "textContent" && isNodeObject(v) && v.$ref) {
      out[k] = refDisplayLabel(v.$ref);
    } else if (isMediaElement && (k === "src" || k === "poster")) {
      if (v === "" || v == null || isRowBound(v)) {
        needsMediaPlaceholder = true;
        out[k] = TRANSPARENT_PX;
      } else {
        out[k] = v;
      }
    } else if (isRowBound(v)) {
      out[k] = rowBoundDisplay(k, v);
    } else if (isString(v) || (isNodeObject(v) && v.$ref)) {
      // Any other bound or literal property renders as the page will.
      out[k] = v;
    } else {
      out[k] = prepareForEditMode(v);
    }
  }

  // Mark empty elements with placeholder classes for design-mode visibility
  const placeholderClass = computeEmptyPlaceholderClass(out);
  if (placeholderClass) {
    out.className = out.className ? `${out.className} ${placeholderClass}` : placeholderClass;
  }

  // Media elements with missing/dynamic src get a placeholder class
  if (needsMediaPlaceholder) {
    const cls = isString(out.className) ? out.className : "";
    if (!cls.includes("empty-media-placeholder")) {
      out.className = cls ? `${cls} empty-media-placeholder` : "empty-media-placeholder";
    }
  }

  return out;
}
