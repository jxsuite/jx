/**
 * Shared.js — Shared compiler utilities
 *
 * Detection, scope resolution, HTML building, CSS extraction, and naming utilities used across all
 * compilation targets (static, client, element, server).
 */

import { camelToKebab, toCSSText, RESERVED_KEYS } from "@jxsuite/runtime";

// Re-export runtime utilities used by submodules
export { camelToKebab, toCSSText, RESERVED_KEYS };

// CDN defaults
export const DEFAULT_REACTIVITY_SRC = "https://esm.sh/@vue/reactivity@3.5.32";
export const DEFAULT_LIT_HTML_SRC = "https://esm.sh/lit-html@3.3.0";

// ─── Schema keywords ─────────────────────────────────────────────────────────

/**
 * Schema-only keywords used to detect pure type definitions (Shape 2b). An object with ONLY these
 * keys and no `default` is a type def, not a signal.
 */
export const SCHEMA_KEYWORDS = new Set([
  "type",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "items",
  "properties",
  "required",
  "description",
  "title",
  "$comment",
]);

// ─── Detection ────────────────────────────────────────────────────────────────

/**
 * Returns true if a $src path points to a .class.json schema-defined class.
 *
 * @param {any} src
 * @returns {boolean}
 */
export function isClassJsonSrc(src) {
  return typeof src === "string" && src.endsWith(".class.json");
}

/**
 * Returns true if an object contains only schema keywords (no `default`, no `$prototype`).
 *
 * @param {any} obj
 * @returns {boolean}
 */
export function isSchemaOnly(obj) {
  for (const k of Object.keys(obj)) {
    if (!SCHEMA_KEYWORDS.has(k)) return false;
  }
  return true;
}

/**
 * Returns true if a string contains a ${} template expression.
 *
 * @param {any} val
 * @returns {boolean}
 */
export function isTemplateString(val) {
  return typeof val === "string" && val.includes("${");
}

/**
 * Determine whether a node (or any of its descendants) requires client-side JavaScript.
 *
 * @param {any} def
 * @returns {boolean}
 */
export function isDynamic(def) {
  if (!def || typeof def !== "object") return false;

  if (def.state) {
    for (const [k, d] of Object.entries(def.state)) {
      // Skip injected context (read-only, not reactive)
      if (k === "$site" || k === "$page") continue;
      // Skip timing: "compiler" entries — resolved at build time, baked into static HTML
      if (
        d &&
        typeof d === "object" &&
        !Array.isArray(d) &&
        /** @type {any} */ (d).timing === "compiler"
      )
        continue;
      if (typeof d !== "object" || d === null || Array.isArray(d)) return true;
      if (/** @type {any} */ (d).$prototype) return true;
      if ("default" in /** @type {any} */ (d)) return true;
      if (isSchemaOnly(d)) continue;
      return true;
    }
  }

  if (def.$switch) return true;
  if (def.children?.$prototype === "Array") return true;

  if (Array.isArray(def.children)) {
    if (def.children.some(/** @param {any} c */ (c) => isDynamic(c))) return true;
  }

  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (
      val !== null &&
      typeof val === "object" &&
      typeof (/** @type {any} */ (val).$ref) === "string"
    )
      return true;
    if (isTemplateString(val)) return true;
  }

  if (def.style && typeof def.style === "object") {
    for (const val of Object.values(def.style)) {
      if (isTemplateString(val)) return true;
    }
  }

  if (def.attributes && typeof def.attributes === "object") {
    for (const val of Object.values(def.attributes)) {
      if (isTemplateString(val)) return true;
    }
  }

  return false;
}

/**
 * Shallow variant of isDynamic — checks only this node's own properties, not its children.
 *
 * @param {any} def
 * @returns {boolean}
 */
export function isNodeDynamic(def) {
  if (!def || typeof def !== "object") return false;

  if (def.$switch) return true;
  if (def.children?.$prototype === "Array") return true;

  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (
      val !== null &&
      typeof val === "object" &&
      typeof (/** @type {any} */ (val).$ref) === "string"
    )
      return true;
    if (isTemplateString(val)) return true;
  }

  if (def.style && typeof def.style === "object") {
    for (const val of Object.values(def.style)) {
      if (isTemplateString(val)) return true;
    }
  }

  if (def.attributes && typeof def.attributes === "object") {
    for (const val of Object.values(def.attributes)) {
      if (isTemplateString(val)) return true;
    }
  }

  return false;
}

/**
 * Returns true if any node in the tree will need dynamic handling.
 *
 * @param {any} def
 * @returns {boolean}
 */
export function hasAnyIsland(def) {
  if (!def || typeof def !== "object") return false;
  if (isDynamic(def)) return true;
  if (Array.isArray(def.children))
    return def.children.some(/** @param {any} c */ (c) => hasAnyIsland(c));
  return false;
}

// ─── Scope / value resolution ─────────────────────────────────────────────────

/**
 * @param {any} raw
 * @param {any} [parentScope]
 * @param {Record<string, any>} [scopeDefs]
 * @param {Record<string, any>} [media]
 * @returns {{ scope: any; scopeDefs: Record<string, any>; media: Record<string, any> }}
 */
export function createCompileContext(raw, parentScope = null, scopeDefs = {}, media = {}) {
  const scope = raw?.state
    ? buildInitialScope(raw.state, parentScope)
    : (parentScope ?? Object.create(null));
  return { scope, scopeDefs, media };
}

/**
 * @param {Record<string, any>} [defs]
 * @param {any} [parentScope]
 * @returns {any}
 */
export function buildInitialScope(defs = {}, parentScope = null) {
  const scope = Object.create(parentScope ?? null);

  for (const [key, def] of Object.entries(defs)) {
    if (typeof def !== "object" || def === null || Array.isArray(def)) {
      setOwnScopeValue(scope, key, cloneValue(def));
      continue;
    }
    if ("default" in def) {
      setOwnScopeValue(scope, key, cloneValue(def.default));
      continue;
    }
    if (!def.$prototype && !isSchemaOnly(def)) {
      setOwnScopeValue(scope, key, cloneValue(def));
    }
  }

  for (const [key, def] of Object.entries(defs)) {
    if (typeof def === "string" && isTemplateString(def)) {
      defineLazyScopeValue(scope, key, () => evaluateStaticTemplate(def, scope));
      continue;
    }
    if (!def || typeof def !== "object") continue;
    if (def.$prototype === "Function") {
      if (def.body) {
        const fn = new Function("state", ...(def.parameters ?? def.arguments ?? []), def.body);
        if (def.body.includes("return")) {
          defineLazyScopeValue(scope, key, () => fn(scope));
        } else {
          setOwnScopeValue(scope, key, fn);
        }
      } else if (!def.body?.includes("return")) {
        setOwnScopeValue(scope, key, () => {});
      }
      continue;
    }
    if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
      setOwnScopeValue(scope, key, cloneValue(def.default ?? null));
    }
  }

  return scope;
}

/**
 * @param {any} scope
 * @param {string} key
 * @param {any} value
 */
export function setOwnScopeValue(scope, key, value) {
  Object.defineProperty(scope, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * @param {any} scope
 * @param {string} key
 * @param {() => any} getter
 */
export function defineLazyScopeValue(scope, key, getter) {
  Object.defineProperty(scope, key, {
    enumerable: true,
    configurable: true,
    get: getter,
  });
}

/**
 * @param {any} value
 * @param {any} scope
 * @returns {any}
 */
export function resolveStaticValue(value, scope) {
  if (isRefObject(value)) return resolveRefValue(value.$ref, scope);
  if (isTemplateString(value)) return evaluateStaticTemplate(value, scope);
  return value;
}

/**
 * @param {any} value
 * @returns {boolean}
 */
export function isRefObject(value) {
  return value !== null && typeof value === "object" && typeof value.$ref === "string";
}

/**
 * @param {any} refValue
 * @param {any} scope
 * @returns {any}
 */
export function resolveRefValue(refValue, scope) {
  if (typeof refValue !== "string") return refValue;
  if (refValue.startsWith("$map/")) {
    const parts = refValue.split("/");
    const key = parts[1];
    const base = scope.$map?.[key] ?? scope["$map/" + key];
    return parts.length > 2 ? getPathValue(base, parts.slice(2).join("/")) : base;
  }
  if (refValue.startsWith("#/state/")) {
    const sub = refValue.slice("#/state/".length);
    const slash = sub.indexOf("/");
    if (slash < 0) return scope[sub];
    return getPathValue(scope[sub.slice(0, slash)], sub.slice(slash + 1));
  }
  return scope[refValue] ?? null;
}

/**
 * @param {string} str
 * @param {any} scope
 * @returns {any}
 */
export function evaluateStaticTemplate(str, scope) {
  const fn = new Function("state", "$map", `return \`${str}\``);
  return fn(scope, scope?.$map);
}

/**
 * @param {any} base
 * @param {string} path
 * @returns {any}
 */
export function getPathValue(base, path) {
  if (!path) return base;
  return path
    .split("/")
    .reduce(
      (/** @type {any} */ acc, /** @type {string} */ key) => (acc == null ? undefined : acc[key]),
      base,
    );
}

/**
 * @param {any} value
 * @returns {any}
 */
export function cloneValue(value) {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

// ─── HTML building ────────────────────────────────────────────────────────────

/**
 * Build an HTML attribute string from a static element definition.
 *
 * @param {any} def
 * @param {any} scope
 * @returns {string}
 */
export function buildAttrs(def, scope) {
  let out = "";

  const id = resolveStaticValue(def.id, scope);
  const className = resolveStaticValue(def.className, scope);
  const hidden = resolveStaticValue(def.hidden, scope);
  const tabIndex = resolveStaticValue(def.tabIndex, scope);
  const title = resolveStaticValue(def.title, scope);
  const lang = resolveStaticValue(def.lang, scope);
  const dir = resolveStaticValue(def.dir, scope);

  if (id) out += ` id="${escapeHtml(id)}"`;
  if (className) out += ` class="${escapeHtml(className)}"`;
  if (hidden) out += " hidden";
  if (tabIndex !== undefined && tabIndex !== null)
    out += ` tabindex="${escapeHtml(String(tabIndex))}"`;
  if (title) out += ` title="${escapeHtml(title)}"`;
  if (lang) out += ` lang="${escapeHtml(lang)}"`;
  if (dir) out += ` dir="${escapeHtml(dir)}"`;

  if (def.style) {
    // Collect properties that have @media overrides — these must NOT be inline
    // because inline styles (specificity 1,0,0,0) always beat stylesheet @media rules.
    const mediaOverriddenProps = new Set();
    for (const [k, v] of Object.entries(def.style)) {
      if (k.startsWith("@") && v && typeof v === "object") {
        for (const prop of Object.keys(/** @type {Record<string, any>} */ (v))) {
          if (
            !prop.startsWith(":") &&
            !prop.startsWith(".") &&
            !prop.startsWith("&") &&
            !prop.startsWith("[")
          ) {
            mediaOverriddenProps.add(prop);
          }
        }
      }
    }

    const inline = Object.entries(def.style)
      .filter(
        ([k, v]) =>
          !k.startsWith(":") &&
          !k.startsWith(".") &&
          !k.startsWith("&") &&
          !k.startsWith("[") &&
          !k.startsWith("@") &&
          !mediaOverriddenProps.has(k) &&
          v !== null &&
          typeof v !== "object",
      )
      .map(([k, v]) => {
        const value = resolveStaticValue(v, scope);
        return value == null ? null : `${camelToKebab(k)}: ${value}`;
      })
      .filter(Boolean)
      .join("; ");
    if (inline) out += ` style="${inline}"`;
  }

  if (def.attributes) {
    for (const [k, v] of Object.entries(def.attributes)) {
      const value = resolveStaticValue(v, scope);
      if (
        value !== null &&
        value !== undefined &&
        (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      ) {
        out += ` ${k}="${escapeHtml(String(value))}"`;
      }
    }
  }

  return out;
}

/**
 * Build the inner HTML (textContent or children) for a node.
 *
 * @param {any} def
 * @param {any} raw
 * @param {{ scope: any; scopeDefs: Record<string, any>; media: Record<string, any> }} context
 * @param {(def: any, raw: any, context: any) => string} childCompiler
 * @returns {string}
 */
export function buildInner(def, raw, context, childCompiler) {
  const source = raw ?? def;

  if (source.textContent !== undefined) {
    const value = resolveStaticValue(source.textContent, context.scope);
    return value == null ? "" : escapeHtml(String(value));
  }
  if (source.innerHTML) return resolveStaticValue(source.innerHTML, context.scope) ?? "";
  if (Array.isArray(source.children)) {
    const rawChildren = raw?.children;
    return source.children
      .map((/** @type {any} */ c, /** @type {number} */ i) => {
        const childRaw = rawChildren?.[i] ?? c;
        return childCompiler(c, childRaw, context);
      })
      .join("\n  ");
  }
  return "";
}

// ─── CSS extraction ───────────────────────────────────────────────────────────

/**
 * Walk the entire document tree and collect all static nested CSS rules.
 *
 * @param {any} doc
 * @param {Record<string, any>} [mediaQueries]
 * @returns {string}
 */
export function compileStyles(doc, mediaQueries = {}) {
  /** @type {string[]} */
  const rules = [];
  collectStyles(doc, rules, mediaQueries, "");
  if (rules.length === 0) return "";
  return `<style>\n${rules.join("\n")}\n</style>`;
}

/**
 * @param {any} def
 * @param {string[]} rules
 * @param {Record<string, any>} mediaQueries
 * @param {string} [_parentSel]
 */
export function collectStyles(def, rules, mediaQueries, _parentSel = "") {
  if (!def || typeof def !== "object") return;

  const selector = def.id
    ? `#${def.id}`
    : def.className
      ? `.${def.className.split(" ")[0]}`
      : (def.tagName ?? "*");

  if (def.style) {
    // Collect properties that have @media overrides — these are excluded from
    // inline styles in buildAttrs(), so we emit them as base CSS rules here.
    const mediaOverriddenProps = new Set();
    for (const [k, v] of Object.entries(def.style)) {
      if (k.startsWith("@") && v && typeof v === "object") {
        for (const p of Object.keys(/** @type {Record<string, any>} */ (v))) {
          if (
            !p.startsWith(":") &&
            !p.startsWith(".") &&
            !p.startsWith("&") &&
            !p.startsWith("[")
          ) {
            mediaOverriddenProps.add(p);
          }
        }
      }
    }

    // Emit base CSS rules for media-overridden properties
    if (mediaOverriddenProps.size > 0) {
      const baseDecls = [];
      for (const p of mediaOverriddenProps) {
        const v = def.style[p];
        if (v !== null && v !== undefined && typeof v !== "object") {
          baseDecls.push(`${camelToKebab(p)}: ${v}`);
        }
      }
      if (baseDecls.length > 0) {
        rules.push(`${selector} { ${baseDecls.join("; ")} }`);
      }
    }

    for (const [prop, val] of Object.entries(def.style)) {
      if (prop.startsWith("@")) {
        const query = prop.startsWith("@--")
          ? (mediaQueries[prop.slice(1)] ?? prop.slice(1))
          : prop.slice(1);
        rules.push(`@media ${query} { ${selector} { ${toCSSText(/** @type {any} */ (val))} } }`);
        for (const [sel, nestedRules] of Object.entries(/** @type {Record<string, any>} */ (val))) {
          if (
            !(
              sel.startsWith(":") ||
              sel.startsWith(".") ||
              sel.startsWith("&") ||
              sel.startsWith("[")
            )
          )
            continue;
          const resolved = sel.startsWith("&") ? sel.replace("&", selector) : `${selector}${sel}`;
          rules.push(
            `@media ${query} { ${resolved} { ${toCSSText(/** @type {any} */ (nestedRules))} } }`,
          );
        }
      } else if (
        prop.startsWith(":") ||
        prop.startsWith(".") ||
        prop.startsWith("&") ||
        prop.startsWith("[")
      ) {
        const resolved = prop.startsWith("&") ? prop.replace("&", selector) : `${selector}${prop}`;
        rules.push(`${resolved} { ${toCSSText(/** @type {any} */ (val))} }`);
      }
    }
  }

  if (Array.isArray(def.children)) {
    def.children.forEach((/** @type {any} */ c) => {
      collectStyles(c, rules, mediaQueries, selector);
    });
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * HTML-escape a string for safe attribute and text content embedding.
 *
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Convert a page title to a valid custom element tag name.
 *
 * @param {string} title
 * @returns {string}
 */
export function titleToTagName(title) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.includes("-") ? slug : `jx-${slug}`;
}

/**
 * @param {string} tagName
 * @returns {string}
 */
export function tagNameToClassName(tagName) {
  return tagName
    .split("-")
    .map((/** @type {string} */ s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

/**
 * Recursively collect unique $src values from $prototype: "Function" entries.
 *
 * @param {any} doc
 * @returns {string[]}
 */
export function collectSrcImports(doc) {
  /** @type {Set<string>} */
  const srcs = new Set();
  _walkSrc(doc, srcs);
  return [...srcs];
}

/**
 * @param {any} def
 * @param {Set<string>} srcs
 */
function _walkSrc(def, srcs) {
  if (!def || typeof def !== "object") return;
  if (def.state) {
    for (const d of Object.values(def.state)) {
      if (
        d &&
        typeof d === "object" &&
        /** @type {any} */ (d).$prototype === "Function" &&
        /** @type {any} */ (d).$src
      ) {
        srcs.add(/** @type {any} */ (d).$src);
      }
    }
  }
  if (Array.isArray(def.children)) {
    def.children.forEach((/** @type {any} */ c) => _walkSrc(c, srcs));
  }
}

/**
 * Recursively collect all `timing: "server"` entries from the document tree.
 *
 * @param {any} doc
 * @returns {any[]}
 */
export function collectServerEntries(doc) {
  /** @type {Map<string, any>} */
  const entries = new Map();
  _walkServerEntries(doc, entries);
  return [...entries.values()];
}

/**
 * @param {any} def
 * @param {Map<string, any>} entries
 */
function _walkServerEntries(def, entries) {
  if (!def || typeof def !== "object") return;
  if (def.state) {
    for (const [key, d] of Object.entries(def.state)) {
      const entry = /** @type {any} */ (d);
      if (
        entry &&
        typeof entry === "object" &&
        entry.timing === "server" &&
        entry.$src &&
        entry.$export &&
        !entry.$prototype
      ) {
        entries.set(entry.$export, { key, exportName: entry.$export, src: entry.$src });
      }
    }
  }
  if (Array.isArray(def.children)) {
    def.children.forEach((/** @type {any} */ c) => _walkServerEntries(c, entries));
  }
}
