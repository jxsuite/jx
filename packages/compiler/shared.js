/**
 * shared.js — Shared compiler utilities
 *
 * Detection, scope resolution, HTML building, CSS extraction, and naming
 * utilities used across all compilation targets (static, client, element, server).
 */

import { camelToKebab, toCSSText, RESERVED_KEYS } from "@jsonsx/runtime";

// Re-export runtime utilities used by submodules
export { camelToKebab, toCSSText, RESERVED_KEYS };

// CDN defaults
export const DEFAULT_REACTIVITY_SRC = "https://esm.sh/@vue/reactivity@3.5.32";
export const DEFAULT_LIT_HTML_SRC = "https://esm.sh/lit-html@3.3.0";

// ─── Schema keywords ─────────────────────────────────────────────────────────

/**
 * Schema-only keywords used to detect pure type definitions (Shape 2b).
 * An object with ONLY these keys and no `default` is a type def, not a signal.
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
 */
export function isClassJsonSrc(src) {
  return typeof src === "string" && src.endsWith(".class.json");
}

/**
 * Returns true if an object contains only schema keywords (no `default`, no `$prototype`).
 */
export function isSchemaOnly(obj) {
	for (const k of Object.keys(obj)) {
		if (!SCHEMA_KEYWORDS.has(k)) return false;
	}
	return true;
}

/**
 * Returns true if a string contains a ${} template expression.
 */
export function isTemplateString(val) {
	return typeof val === "string" && val.includes("${");
}

/**
 * Determine whether a node (or any of its descendants) requires client-side
 * JavaScript.
 */
export function isDynamic(def) {
	if (!def || typeof def !== "object") return false;

	if (def.state) {
		for (const [k, d] of Object.entries(def.state)) {
			// Skip injected context (read-only, not reactive)
			if (k === "$site" || k === "$page") continue;
			if (typeof d !== "object" || d === null || Array.isArray(d)) return true;
			if (d.$prototype) return true;
			if ("default" in d) return true;
			if (isSchemaOnly(d)) continue;
			return true;
		}
	}

	if (def.$switch) return true;
	if (def.children?.$prototype === "Array") return true;

	if (Array.isArray(def.children)) {
		if (def.children.some(isDynamic)) return true;
	}

	for (const [key, val] of Object.entries(def)) {
		if (RESERVED_KEYS.has(key)) continue;
		if (val !== null && typeof val === "object" && typeof val.$ref === "string") return true;
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
 * Shallow variant of isDynamic — checks only this node's own properties,
 * not its children.
 */
export function isNodeDynamic(def) {
	if (!def || typeof def !== "object") return false;

	if (def.$switch) return true;
	if (def.children?.$prototype === "Array") return true;

	for (const [key, val] of Object.entries(def)) {
		if (RESERVED_KEYS.has(key)) continue;
		if (val !== null && typeof val === "object" && typeof val.$ref === "string") return true;
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
 */
export function hasAnyIsland(def) {
	if (!def || typeof def !== "object") return false;
	if (isDynamic(def)) return true;
	if (Array.isArray(def.children)) return def.children.some(hasAnyIsland);
	return false;
}

// ─── Scope / value resolution ─────────────────────────────────────────────────

export function createCompileContext(raw, parentScope = null, scopeDefs = {}, media = {}) {
	const scope = raw?.state
		? buildInitialScope(raw.state, parentScope)
		: (parentScope ?? Object.create(null));
	return { scope, scopeDefs, media };
}

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

export function setOwnScopeValue(scope, key, value) {
	Object.defineProperty(scope, key, {
		value,
		enumerable: true,
		configurable: true,
		writable: true,
	});
}

export function defineLazyScopeValue(scope, key, getter) {
	Object.defineProperty(scope, key, {
		enumerable: true,
		configurable: true,
		get: getter,
	});
}

export function resolveStaticValue(value, scope) {
	if (isRefObject(value)) return resolveRefValue(value.$ref, scope);
	if (isTemplateString(value)) return evaluateStaticTemplate(value, scope);
	return value;
}

export function isRefObject(value) {
	return value !== null && typeof value === "object" && typeof value.$ref === "string";
}

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

export function evaluateStaticTemplate(str, scope) {
	const fn = new Function("state", "$map", `return \`${str}\``);
	return fn(scope, scope?.$map);
}

export function getPathValue(base, path) {
	if (!path) return base;
	return path.split("/").reduce((acc, key) => (acc == null ? undefined : acc[key]), base);
}

export function cloneValue(value) {
	if (value === null || typeof value !== "object") return value;
	return JSON.parse(JSON.stringify(value));
}

// ─── HTML building ────────────────────────────────────────────────────────────

/**
 * Build an HTML attribute string from a static element definition.
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
		const inline = Object.entries(def.style)
			.filter(
				([k, v]) =>
					!k.startsWith(":") &&
					!k.startsWith(".") &&
					!k.startsWith("&") &&
					!k.startsWith("[") &&
					!k.startsWith("@") &&
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
			.map((c, i) => {
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
 */
export function compileStyles(doc, mediaQueries = {}) {
	const rules = [];
	collectStyles(doc, rules, mediaQueries, "");
	if (rules.length === 0) return "";
	return `<style>\n${rules.join("\n")}\n</style>`;
}

export function collectStyles(def, rules, mediaQueries, _parentSel = "") {
	if (!def || typeof def !== "object") return;

	const selector = def.id
		? `#${def.id}`
		: def.className
			? `.${def.className.split(" ")[0]}`
			: (def.tagName ?? "*");

	if (def.style) {
		for (const [prop, val] of Object.entries(def.style)) {
			if (prop.startsWith("@")) {
				const query = prop.startsWith("@--")
					? (mediaQueries[prop.slice(1)] ?? prop.slice(1))
					: prop.slice(1);
				rules.push(`@media ${query} { ${selector} { ${toCSSText(val)} } }`);
				for (const [sel, nestedRules] of Object.entries(val)) {
					if (!(sel.startsWith(":") || sel.startsWith(".") || sel.startsWith("&") || sel.startsWith("["))) continue;
					const resolved = sel.startsWith("&") ? sel.replace("&", selector) : `${selector}${sel}`;
					rules.push(`@media ${query} { ${resolved} { ${toCSSText(nestedRules)} } }`);
				}
			} else if (
				prop.startsWith(":") ||
				prop.startsWith(".") ||
				prop.startsWith("&") ||
				prop.startsWith("[")
			) {
				const resolved = prop.startsWith("&") ? prop.replace("&", selector) : `${selector}${prop}`;
				rules.push(`${resolved} { ${toCSSText(val)} }`);
			}
		}
	}

	if (Array.isArray(def.children)) {
		def.children.forEach((c) => {
			collectStyles(c, rules, mediaQueries, selector);
		});
	}
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * HTML-escape a string for safe attribute and text content embedding.
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
 */
export function titleToTagName(title) {
	const slug = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
	return slug.includes("-") ? slug : `jsonsx-${slug}`;
}

export function tagNameToClassName(tagName) {
	return tagName
		.split("-")
		.map((s) => s.charAt(0).toUpperCase() + s.slice(1))
		.join("");
}

/**
 * Recursively collect unique $src values from $prototype: "Function" entries.
 */
export function collectSrcImports(doc) {
	const srcs = new Set();
	_walkSrc(doc, srcs);
	return [...srcs];
}

function _walkSrc(def, srcs) {
	if (!def || typeof def !== "object") return;
	if (def.state) {
		for (const d of Object.values(def.state)) {
			if (d && typeof d === "object" && d.$prototype === "Function" && d.$src) {
				srcs.add(d.$src);
			}
		}
	}
	if (Array.isArray(def.children)) {
		def.children.forEach((c) => _walkSrc(c, srcs));
	}
}

/**
 * Recursively collect all `timing: "server"` entries from the document tree.
 */
export function collectServerEntries(doc) {
	const entries = new Map();
	_walkServerEntries(doc, entries);
	return [...entries.values()];
}

function _walkServerEntries(def, entries) {
	if (!def || typeof def !== "object") return;
	if (def.state) {
		for (const [key, d] of Object.entries(def.state)) {
			if (
				d &&
				typeof d === "object" &&
				d.timing === "server" &&
				d.$src &&
				d.$export &&
				!d.$prototype
			) {
				entries.set(d.$export, { key, exportName: d.$export, src: d.$src });
			}
		}
	}
	if (Array.isArray(def.children)) {
		def.children.forEach((c) => _walkServerEntries(c, entries));
	}
}
