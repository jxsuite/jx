/**
 * JSONsx — JSON-native reactive web component runtime
 * @version 3.0.0
 * @license MIT
 *
 * Four-step pipeline:
 *   1. resolve    — fetch JSON source (or accept raw object)
 *   2. buildScope — state detection + reactive proxy construction
 *   3. render     — walk resolved tree, build DOM, wire reactive effects
 *   4. output     — append to target
 *
 * @module jsonsx
 */

import { reactive, ref, computed, effect, isRef, onEffectCleanup } from "@vue/reactivity";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mount a JSONsx document into a DOM container.
 *
 * @param {string | object} source - Path to .json file, URL, or raw document object
 * @param {HTMLElement} [target=document.body]
 * @returns {Promise<object>} Resolves with the live component scope (state reactive proxy)
 *
 * @example
 * import { JSONsx } from '@jsonsx/runtime';
 * const state = await JSONsx('./counter.json', document.getElementById('app'));
 */
export async function JSONsx(source, target = document.body, options) {
  const base = typeof source === "string" ? new URL(source, location.href).href : location.href;
  const doc = await resolve(source);

  // Register custom elements declared in $elements (depth-first)
  if (doc.$elements) {
    await registerElements(doc.$elements, base);
  }

  const state = await buildScope(doc, {}, base);
  target.appendChild(renderNode(doc, state, options));
  if (typeof state.onMount === "function") state.onMount(state);
  return state;
}

// ─── Step 1: Resolve ──────────────────────────────────────────────────────────

/**
 * Fetch and parse a JSONsx JSON source.
 * Accepts a URL string, absolute URL, or a pre-parsed object.
 *
 * @param {string | object} source
 * @returns {Promise<object>}
 */
export async function resolve(source) {
  if (typeof source !== "string") return source;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`JSONsx: failed to fetch ${source} (${res.status})`);
  return res.json();
}

// ─── Step 2: Build scope ──────────────────────────────────────────────────────

/**
 * JSON Schema keywords used to identify pure type definitions (Shape 2b).
 */
const SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "items",
  "enum",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "pattern",
  "required",
  "examples",
]);

/**
 * Build the reactive scope (state) from the document using the five-shape detection algorithm.
 *
 * @param {object} doc
 * @param {object} [parentScope={}]
 * @param {string} [base=location.href]  Base URL for resolving $src imports
 * @returns {Promise<object>} Reactive proxy (state)
 */
export async function buildScope(doc, parentScope = {}, base = location.href) {
  const raw = {};

  // Merge parent scope properties
  for (const [key, val] of Object.entries(parentScope)) {
    raw[key] = val;
  }

  const defs = doc.state ?? {};

  // First pass: collect naked values, expanded defaults, plain objects
  for (const [key, def] of Object.entries(defs)) {
    // 1. String value
    if (typeof def === "string") {
      if (!def.includes("${")) raw[key] = def; // Shape 1: naked string
      continue; // template strings handled in second pass
    }

    // 2. Number, boolean, null
    if (typeof def === "number" || typeof def === "boolean" || def === null) {
      raw[key] = def;
      continue;
    }

    // 3. Array
    if (Array.isArray(def)) {
      raw[key] = def;
      continue;
    }

    // 4. Object
    if (typeof def === "object") {
      if (def.$prototype) continue; // handled in later passes
      if (def.timing === "server" && def.$src && def.$export) continue; // handled in fifth pass
      if ("default" in def) {
        raw[key] = def.default;
        continue;
      } // Shape 2: expanded signal
      if (hasSchemaKeywords(def)) continue; // Shape 2b: pure type def
      raw[key] = def; // Shape 1: plain object
    }
  }

  // Wrap in Vue reactive proxy — deep reactivity from this point on
  const state = reactive(raw);

  // Second pass: template strings → computed
  for (const [key, def] of Object.entries(defs)) {
    if (typeof def === "string" && def.includes("${")) {
      state[key] = computed(() => evaluateTemplate(def, state));
    }
  }

  // Third pass: $prototype: "Function" entries
  for (const [key, def] of Object.entries(defs)) {
    if (typeof def === "object" && def?.$prototype === "Function") {
      state[key] = await resolveFunction(def, state, key, base);
    }
  }

  // Fourth pass: other $prototype entries (Request, Set, Map, etc.)
  for (const [key, def] of Object.entries(defs)) {
    if (typeof def === "object" && def?.$prototype && def.$prototype !== "Function") {
      state[key] = await resolvePrototype(def, state, key, base);
    }
  }

  // Fifth pass: timing: "server" entries (dev mode — execute client-side, boundary unenforced)
  for (const [key, def] of Object.entries(defs)) {
    if (
      def != null &&
      typeof def === "object" &&
      def.timing === "server" &&
      def.$src &&
      def.$export &&
      !def.$prototype
    ) {
      state[key] = await resolveServerFunction(def, state, key, base);
    }
  }

  if (doc.$media) {
    state["$media"] = doc.$media;
  }

  return state;
}

/**
 * Check whether an object contains any JSON Schema keywords.
 * Used to discriminate Shape 2b (pure type definition) from Shape 1 (naked object).
 */
function hasSchemaKeywords(obj) {
  for (const k of Object.keys(obj)) {
    if (SCHEMA_KEYWORDS.has(k)) return true;
  }
  return false;
}
export { hasSchemaKeywords };

/**
 * Evaluate a template string in the context of state and optional $map.
 * Templates use `state.varName` and `$map.item` syntax.
 */
function evaluateTemplate(str, state) {
  const fn = new Function("state", "$map", `return \`${str}\``);
  return fn(state, state?.$map);
}

// ─── Step 2b: Function resolution (Shape 4) ─────────────────────────────────

/**
 * Module cache for $src imports (shared with external class resolution).
 */
const _moduleCache = new Map();

/**
 * Resolve a $prototype: "Function" entry into a function or computed.
 *
 * Functions receive state as their first parameter at call time.
 * Functions with a return statement in their body are wrapped in computed() for reactive evaluation.
 *
 * @param {object} def   - state entry with $prototype: "Function"
 * @param {object} state - reactive scope proxy
 * @param {string} key   - def key name
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<Function|ComputedRef>}
 */
async function resolveFunction(def, state, key, base) {
  if (def.body && def.$src) {
    throw new Error(`JSONsx: '${key}' declares both body and $src — these are mutually exclusive`);
  }
  if (!def.body && !def.$src) {
    throw new Error(`JSONsx: '${key}' is a Function prototype with no body or $src`);
  }

  let fn;

  if (def.body) {
    const params = resolveParamNames(def);
    fn = new Function(...params, def.body);
    Object.defineProperty(fn, "name", { value: def.name ?? key, configurable: true });
  } else {
    // $src: dynamic import
    const src = def.$src;
    const exportName = def.$export ?? key;
    let mod;
    if (_moduleCache.has(src)) {
      mod = _moduleCache.get(src);
    } else {
      try {
        mod = await import(src);
      } catch {
        if (base) {
          const resolvedSrc = new URL(src, base).href;
          mod = await import(resolvedSrc);
        } else {
          throw new Error(`JSONsx: failed to import '$src' "${src}" for "${key}"`);
        }
      }
      _moduleCache.set(src, mod);
    }
    fn = mod[exportName] ?? mod.default?.[exportName];
    if (typeof fn !== "function") {
      throw new Error(`JSONsx: export "${exportName}" not found or not a function in "${src}"`);
    }
  }

  // Detect computed: body contains a return statement
  if (def.body && /\breturn\b/.test(def.body)) {
    return computed(() => fn(state));
  }

  return fn;
}

// ─── Step 3: Render ───────────────────────────────────────────────────────────

/**
 * Extract parameter names from a function definition.
 * Supports both legacy "arguments" (string array) and CEM-compatible "parameters" (object array).
 * Always ensures "state" is the first parameter.
 */
function resolveParamNames(def) {
  const raw = def.parameters ?? def.arguments ?? [];
  let names;
  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "object") {
    // CEM-style: [{name: "event", type: {...}}, ...]
    names = raw.map((p) => p.name ?? p.identifier ?? "arg");
  } else {
    // Legacy string array: ["state", "event"] or ["event"]
    names = raw;
  }
  return names.length > 0 && names[0] === "state" ? names : ["state", ...names];
}

/**
 * Reserved JSONsx keys — never set as DOM properties.
 * @type {Set<string>}
 */
export const RESERVED_KEYS = new Set([
  "$schema",
  "$id",
  "$defs",
  "state",
  "$ref",
  "$props",
  "$elements",
  "$switch",
  "$prototype",
  "$src",
  "$export",
  "$media",
  "$map",
  "timing",
  "default",
  "description",
  "body",
  "parameters",
  "arguments",
  "name",
  "tagName",
  "children",
  "style",
  "attributes",
  "items",
  "map",
  "filter",
  "sort",
  "cases",
  "observedAttributes",
]);

/**
 * Recursively render a JSONsx element definition into a DOM element.
 *
 * @param {object} def
 * @param {object} state - reactive scope proxy (or child scope via Object.create)
 * @returns {HTMLElement}
 */
export function renderNode(def, state, options) {
  const path = options?._path ?? [];

  // Extend scope with any $-prefixed local bindings declared on this node
  let localState = state;
  for (const [key, val] of Object.entries(def)) {
    if (key.startsWith("$") && !RESERVED_KEYS.has(key)) {
      if (localState === state) localState = Object.create(state);
      localState[key] = isRefObj(val) ? resolveRef(val.$ref, state) : val;
    }
  }

  // Custom element with $props: set JS properties on the element instance
  const tagName = def.tagName ?? "div";
  const isCustomEl = tagName.includes("-") && customElements.get(tagName);

  if (def.$props && isCustomEl) {
    return renderCustomElementWithProps(def, localState, options, path);
  }

  if (def.$props) {
    const { $props, ...rest } = def;
    return renderNode(rest, mergeProps(def, localState), options);
  }
  if (def.$switch) return renderSwitch(def, localState, options);
  if (def.children?.$prototype === "Array") return renderMappedArray(def, localState, options);

  const el = document.createElement(tagName);

  if (options?.onNodeCreated) options.onNodeCreated(el, path, def);

  applyProperties(el, def, localState);
  applyStyle(el, def.style ?? {}, localState["$media"] ?? {}, localState);
  applyAttributes(el, def.attributes ?? {}, localState);

  const children = Array.isArray(def.children) ? def.children : [];
  for (let i = 0; i < children.length; i++) {
    const childOpts = options ? { ...options, _path: [...path, "children", i] } : undefined;
    el.appendChild(renderNode(children[i], localState, childOpts));
  }

  return el;
}

// ─── Template string utilities ────────────────────────────────────────────────

/**
 * Check if a value is a template string (contains ${}).
 */
function isTemplateString(val) {
  return typeof val === "string" && val.includes("${");
}

// ─── Property / style / attribute application ─────────────────────────────────

function applyProperties(el, def, state) {
  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key.startsWith("$")) continue; // scope bindings — handled in renderNode

    if (key.startsWith("on")) {
      // Event handler: $ref to a function
      if (isRefObj(val)) {
        const handler = resolveRef(val.$ref, state);
        if (typeof handler === "function") {
          const scope = state;
          el.addEventListener(key.slice(2), (e) => handler(scope, e));
        }
        continue;
      }
      // Event handler: inline $prototype: "Function"
      if (val && typeof val === "object" && val.$prototype === "Function" && val.body) {
        const params = resolveParamNames(val);
        const fn = new Function(...params, val.body);
        const scope = state;
        el.addEventListener(key.slice(2), (e) => fn(scope, e));
        continue;
      }
    }

    bindProperty(el, key, val, state);
  }
}

function bindProperty(el, key, val, state) {
  if (isRefObj(val)) {
    if (key === "id") {
      el[key] = resolveRef(val.$ref, state);
      return;
    }
    effect(() => {
      el[key] = resolveRef(val.$ref, state);
    });
    return;
  }

  // Universal ${} reactivity — template strings in element properties
  if (isTemplateString(val)) {
    effect(() => {
      el[key] = evaluateTemplate(val, state);
    });
    return;
  }

  el[key] = val;
}

/**
 * Apply inline styles and emit a scoped <style> block for nested CSS selectors
 * and @custom-media breakpoint rules.
 *
 * @param {HTMLElement} el
 * @param {object}      styleDef
 * @param {object}      [mediaQueries={}]  Named breakpoints from root $media
 * @param {object}      [state={}]         Component scope for template string evaluation
 */
export function applyStyle(el, styleDef, mediaQueries = {}, state = {}) {
  const nested = {};
  const media = {};

  for (const [prop, val] of Object.entries(styleDef)) {
    if (prop.startsWith("@")) media[prop] = val;
    else if (isNestedSelector(prop)) nested[prop] = val;
    else if (isTemplateString(val))
      effect(() => {
        el.style[prop] = evaluateTemplate(val, state);
      });
    else el.style[prop] = val;
  }

  const hasNested = Object.keys(nested).length > 0;
  const hasMedia = Object.keys(media).length > 0;
  if (!hasNested && !hasMedia) return;

  const uid = `jsonsx-${Math.random().toString(36).slice(2, 7)}`;
  el.dataset.jsonsx = uid;

  let css = "";

  for (const [sel, rules] of Object.entries(nested)) {
    const resolved = sel.startsWith("&")
      ? sel.replace("&", `[data-jsonsx="${uid}"]`)
      : sel.startsWith("[")
        ? `[data-jsonsx="${uid}"]${sel}`
        : `[data-jsonsx="${uid}"] ${sel}`;
    css += `${resolved} { ${toCSSText(rules)} }\n`;
  }

  for (const [key, rules] of Object.entries(media)) {
    if (key === "@--") continue; // base canvas width, not a real media query
    const query = key.startsWith("@--")
      ? (mediaQueries[key.slice(1)] ?? key.slice(1))
      : key.slice(1);
    const scope = `[data-jsonsx="${uid}"]`;
    css += `@media ${query} { ${scope} { ${toCSSText(rules)} } }\n`;
    for (const [sel, nestedRules] of Object.entries(rules)) {
      if (!isNestedSelector(sel)) continue;
      const resolved = sel.startsWith("&")
        ? sel.replace("&", scope)
        : sel.startsWith("[")
          ? `${scope}${sel}`
          : `${scope} ${sel}`;
      css += `@media ${query} { ${resolved} { ${toCSSText(nestedRules)} } }\n`;
    }
  }

  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
}

function applyAttributes(el, attrs, state) {
  for (const [k, v] of Object.entries(attrs)) {
    if (isRefObj(v)) {
      effect(() => el.setAttribute(k, String(resolveRef(v.$ref, state) ?? "")));
    } else if (isTemplateString(v)) {
      effect(() => el.setAttribute(k, String(evaluateTemplate(v, state))));
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

// ─── Array mapping ────────────────────────────────────────────────────────────

function renderMappedArray(def, state, options) {
  const path = options?._path ?? [];
  const container = document.createElement(def.tagName ?? "div");

  if (options?.onNodeCreated) options.onNodeCreated(container, path, def);

  applyProperties(container, def, state);
  applyStyle(container, def.style ?? {}, state["$media"] ?? {}, state);
  applyAttributes(container, def.attributes ?? {}, state);
  const { items: itemsSrc, map: mapDef, filter: filterRef, sort: sortRef } = def.children;

  effect(() => {
    container.innerHTML = "";
    let items;
    if (isRefObj(itemsSrc)) {
      items = resolveRef(itemsSrc.$ref, state);
    } else {
      items = itemsSrc;
    }
    if (!Array.isArray(items)) return;
    if (filterRef) {
      const fn = resolveRef(filterRef.$ref, state);
      if (typeof fn === "function") items = items.filter(fn);
    }
    if (sortRef) {
      const fn = resolveRef(sortRef.$ref, state);
      if (typeof fn === "function") items = [...items].sort(fn);
    }

    items.forEach((item, index) => {
      const child = Object.create(state);
      child.$map = { item, index };
      child["$map/item"] = item;
      child["$map/index"] = index;
      const childOpts = options
        ? { ...options, _path: [...path, "children", "map", index] }
        : undefined;
      container.appendChild(renderNode(mapDef, child, childOpts));
    });
  });

  return container;
}

// ─── $switch ──────────────────────────────────────────────────────────────────

function renderSwitch(def, state, options) {
  const path = options?._path ?? [];
  const container = document.createElement(def.tagName ?? "div");

  if (options?.onNodeCreated) options.onNodeCreated(container, path, def);

  applyProperties(container, def, state);
  applyStyle(container, def.style ?? {}, state["$media"] ?? {}, state);
  applyAttributes(container, def.attributes ?? {}, state);
  let generation = 0;

  effect(() => {
    container.innerHTML = "";
    const key = resolveRef(def.$switch.$ref, state);
    const caseDef = def.cases?.[key];
    if (!caseDef) return;

    if (isRefObj(caseDef)) {
      // External $ref — fetch and render asynchronously
      const gen = ++generation;
      const href = new URL(caseDef.$ref, location.href).href;
      resolve(href)
        .then(async (doc) => {
          if (gen !== generation) return;
          const childScope = await buildScope(doc, {}, href);
          if (gen !== generation) return;
          container.innerHTML = "";
          const childOpts = options ? { ...options, _path: [...path, "cases", key] } : undefined;
          container.appendChild(renderNode(doc, childScope, childOpts));
        })
        .catch((e) =>
          console.error("JSONsx $switch: failed to load external case", caseDef.$ref, e),
        );
      return;
    }

    const childOpts = options ? { ...options, _path: [...path, "cases", key] } : undefined;
    container.appendChild(renderNode(caseDef, state, childOpts));
  });

  return container;
}

// ─── Prototype namespaces (Shape 5) ──────────────────────────────────────────

/**
 * Resolve a $prototype definition into a value for the reactive scope.
 *
 * Returns a ref() for async/persistent entries (Request, Storage, Cookie, IndexedDB),
 * or a plain value for simple entries (Set, Map, FormData, Blob).
 *
 * @param {object} def   - state entry with $prototype
 * @param {object} state - reactive scope proxy
 * @param {string} key   - def key (for diagnostics)
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<*>}
 */
export async function resolvePrototype(def, state, key, base) {
  // ── External class via $src ─────────────────────────────────────────────────
  if (def.$src) {
    return resolveExternalPrototype(def, state, key, base);
  }

  switch (def.$prototype) {
    case "Request": {
      const s = ref(null);
      const debounceMs = def.debounce ?? 0;
      let debounceTimer = null;

      if (!def.manual) {
        effect(() => {
          let url;
          if (isTemplateString(def.url)) {
            url = evaluateTemplate(def.url, state);
          } else {
            url = def.url;
          }
          if (!url || url === "undefined" || url.includes("undefined")) return;

          const controller = new AbortController();
          onEffectCleanup(() => {
            controller.abort();
            clearTimeout(debounceTimer);
          });

          const doFetch = () =>
            fetch(url, {
              signal: controller.signal,
              method: def.method ?? "GET",
              ...(def.headers && { headers: def.headers }),
              ...(def.body && {
                body: typeof def.body === "object" ? JSON.stringify(def.body) : def.body,
              }),
            })
              .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
              .then((d) => {
                s.value = d;
              })
              .catch((e) => {
                if (e.name !== "AbortError") s.value = { error: String(e) };
              });

          if (debounceMs > 0) {
            debounceTimer = setTimeout(doFetch, debounceMs);
          } else {
            doFetch();
          }
        });
      }

      return s;
    }

    case "URLSearchParams":
      return computed(() => {
        const p = {};
        for (const [k, v] of Object.entries(def)) {
          if (k !== "$prototype") {
            p[k] = isRefObj(v)
              ? resolveRef(v.$ref, state)
              : isTemplateString(v)
                ? evaluateTemplate(v, state)
                : v;
          }
        }
        return new URLSearchParams(p).toString();
      });

    case "LocalStorage":
    case "SessionStorage": {
      const store = def.$prototype === "LocalStorage" ? localStorage : sessionStorage;
      const k = def.key ?? key;
      let init;
      try {
        const s = store.getItem(k);
        init = s !== null ? JSON.parse(s) : (def.default ?? null);
      } catch {
        init = def.default ?? null;
      }
      const state = ref(init);
      // Persist on change
      effect(() => {
        const v = state.value;
        if (v === null) {
          try {
            store.removeItem(k);
          } catch {}
        } else {
          try {
            store.setItem(k, JSON.stringify(v));
          } catch {}
        }
      });
      return state;
    }

    case "Cookie": {
      const name = def.name ?? key;
      const read = () => {
        const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
        if (!m) return null;
        try {
          return JSON.parse(decodeURIComponent(m[1]));
        } catch {
          return m[1];
        }
      };
      const state = ref(read() ?? def.default ?? null);
      // Persist on change
      effect(() => {
        const v = state.value;
        let s = `${name}=${encodeURIComponent(JSON.stringify(v))}`;
        if (def.maxAge !== undefined) s += `; Max-Age=${def.maxAge}`;
        if (def.path) s += `; Path=${def.path}`;
        if (def.domain) s += `; Domain=${def.domain}`;
        if (def.secure) s += `; Secure`;
        if (def.sameSite) s += `; SameSite=${def.sameSite}`;
        document.cookie = s;
      });
      return state;
    }

    case "IndexedDB": {
      const state = ref(null);
      const {
        database,
        store,
        version = 1,
        keyPath = "id",
        autoIncrement = true,
        indexes = [],
      } = def;
      const req = indexedDB.open(database, version);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath, autoIncrement });
          for (const i of indexes) os.createIndex(i.name, i.keyPath, { unique: i.unique ?? false });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        state.value = {
          database,
          store,
          version,
          isReady: true,
          getStore: (mode = "readwrite") =>
            Promise.resolve(db.transaction(store, mode).objectStore(store)),
        };
      };
      req.onerror = () => {
        state.value = { error: req.error?.message };
      };
      return state;
    }

    case "Set":
      return new Set(def.default ?? []);

    case "Map":
      return new Map(Object.entries(def.default ?? {}));

    case "FormData": {
      const fd = new FormData();
      for (const [k, v] of Object.entries(def.fields ?? {})) fd.append(k, v);
      return fd;
    }

    case "Blob":
      return new Blob(def.parts ?? [], { type: def.type ?? "text/plain" });

    case "ReadableStream":
      return null;

    default:
      console.warn(
        `JSONsx: unknown $prototype "${def.$prototype}" for "${key}". Did you mean to add '$src'?`,
      );
      return ref(null);
  }
}

// ─── External class resolution ────────────────────────────────────────────────

/**
 * Reserved keys stripped from the config object passed to external class constructors.
 */
const EXTERNAL_RESERVED = new Set([
  "$prototype",
  "$src",
  "$export",
  "timing",
  "default",
  "description",
  "body",
  "parameters",
  "arguments",
  "name",
]);

/**
 * Resolve an external class prototype via $src.
 */
async function resolveExternalPrototype(def, state, key, base) {
  const src = def.$src;

  // .class.json: schema-defined class
  if (src.endsWith(".class.json")) {
    return resolveClassJson(def, state, key, base);
  }

  const exportName = def.$export ?? def.$prototype;

  let mod;
  if (_moduleCache.has(src)) {
    mod = _moduleCache.get(src);
  } else {
    try {
      mod = await import(src);
    } catch {
      if (base) {
        try {
          const resolvedSrc = new URL(src, base).href;
          mod = await import(resolvedSrc);
        } catch {
          // Module cannot run in the browser — fall back to dev server proxy
          return resolveViaDevProxy(def, state, key, base);
        }
      } else {
        return resolveViaDevProxy(def, state, key, base);
      }
    }
    _moduleCache.set(src, mod);
  }

  const ExportedClass = mod[exportName] ?? mod.default?.[exportName];
  if (!ExportedClass) {
    throw new Error(`JSONsx: export "${exportName}" not found in "${src}"`);
  }
  if (typeof ExportedClass !== "function") {
    throw new Error(`JSONsx: "${exportName}" from "${src}" is not a class`);
  }

  const config = {};
  for (const [k, v] of Object.entries(def)) {
    if (!EXTERNAL_RESERVED.has(k)) config[k] = v;
  }

  const instance = new ExportedClass(config);

  let value;
  if (typeof instance.resolve === "function") {
    value = await instance.resolve();
  } else if ("value" in instance) {
    value = instance.value;
  } else {
    value = instance;
  }

  // Always wrap in ref for reactivity with external classes
  const s = ref(value);
  if (typeof instance.subscribe === "function") {
    instance.subscribe((newVal) => {
      s.value = newVal;
    });
  }
  return s;
}

/**
 * Resolve a .class.json schema-defined class.
 * Fetches the schema, follows $implementation if hybrid, or constructs dynamically if self-contained.
 */
async function resolveClassJson(def, state, key, base) {
  const src = def.$src;
  let classDef;

  // Try fetching the .class.json file directly
  try {
    const url = base ? new URL(src, base).href : src;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    classDef = await res.json();
  } catch {
    // Fall back to dev proxy (server will handle .class.json resolution)
    return resolveViaDevProxy(def, state, key, base);
  }

  // Hybrid mode: $implementation points to the real JS module
  if (classDef.$implementation) {
    const schemaUrl = base ? new URL(src, base).href : new URL(src, location.href).href;
    const implSrc = new URL(classDef.$implementation, schemaUrl).href;
    const implDef = { ...def, $src: implSrc };
    // Use $export from def, or title from schema, or $prototype from def
    if (!implDef.$export) implDef.$export = classDef.title ?? def.$prototype;
    return resolveExternalPrototype(implDef, state, key, base);
  }

  // Self-contained: construct class dynamically from schema
  const DynClass = classFromSchema(classDef);
  const config = {};
  for (const [k, v] of Object.entries(def)) {
    if (!EXTERNAL_RESERVED.has(k)) config[k] = v;
  }
  const instance = new DynClass(config);

  let value;
  if (typeof instance.resolve === "function") {
    value = await instance.resolve();
  } else if ("value" in instance) {
    value = instance.value;
  } else {
    value = instance;
  }

  // Always wrap in ref for reactivity
  const s = ref(value);
  if (typeof instance.subscribe === "function") {
    instance.subscribe((newVal) => { s.value = newVal; });
  }
  return s;
}

/**
 * Dynamically construct a class from a .class.json schema definition.
 * Browser-side: maps private fields to _-prefixed public fields.
 */
function classFromSchema(classDef) {
  const fields = classDef.$defs?.fields ?? {};
  const ctor = classDef.$defs?.constructor;
  const methods = classDef.$defs?.methods ?? {};

  class DynClass {
    constructor(config = {}) {
      for (const [key, field] of Object.entries(fields)) {
        const id = field.identifier ?? key;
        const propName = field.access === "private" ? `_${id}` : id;
        if (config[id] !== undefined) this[propName] = config[id];
        else if (field.initializer !== undefined) this[propName] = field.initializer;
        else if (field.default !== undefined) this[propName] = structuredClone(field.default);
        else this[propName] = null;
      }
      if (ctor?.body) {
        const bodyStr = Array.isArray(ctor.body) ? ctor.body.join("\n") : ctor.body;
        new Function("config", bodyStr).call(this, config);
      }
    }
  }

  for (const [key, method] of Object.entries(methods)) {
    const name = method.identifier ?? key;
    const params = (method.parameters ?? []).map((p) => {
      if (p.$ref) return p.$ref.split("/").pop();
      return p.identifier ?? p.name ?? "arg";
    });
    const bodyStr = Array.isArray(method.body) ? method.body.join("\n") : (method.body ?? "");

    if (method.role === "accessor") {
      const descriptor = {};
      if (method.getter) descriptor.get = new Function(method.getter.body);
      if (method.setter) {
        const sp = (method.setter.parameters ?? []).map((p) => p.$ref?.split("/").pop() ?? "v");
        descriptor.set = new Function(...sp, method.setter.body);
      }
      Object.defineProperty(DynClass.prototype, name, { ...descriptor, configurable: true });
    } else if (method.scope === "static") {
      DynClass[name] = new Function(...params, bodyStr);
    } else {
      DynClass.prototype[name] = new Function(...params, bodyStr);
    }
  }

  Object.defineProperty(DynClass, "name", { value: classDef.title, configurable: true });
  return DynClass;
}

/**
 * Dev-mode fallback: when an $src module cannot run in the browser, proxy the
 * resolve() call through the JSONsx dev server (POST /__jsonsx_resolve__).
 * Supports reactive template strings in config values via Vue effect().
 */
async function resolveViaDevProxy(def, state, key, base) {
  const config = {};
  for (const [k, v] of Object.entries(def)) {
    if (!EXTERNAL_RESERVED.has(k)) config[k] = v;
  }

  const hasTemplates = Object.values(config).some((v) => isTemplateString(v));

  const doResolve = (resolvedConfig) =>
    fetch("/__jsonsx_resolve__", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        $src: def.$src,
        $prototype: def.$prototype,
        $export: def.$export,
        $base: base,
        ...resolvedConfig,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`JSONsx dev proxy ${r.status} for "${key}"`);
      return r.json();
    });

  // Always wrap in ref for reactivity
  const s = ref(null);
  if (hasTemplates) {
    effect(() => {
      const resolvedConfig = {};
      for (const [k, v] of Object.entries(config)) {
        resolvedConfig[k] = isTemplateString(v) ? evaluateTemplate(v, state) : v;
      }
      doResolve(resolvedConfig)
        .then((value) => {
          s.value = value;
        })
        .catch((e) => console.error("JSONsx dev proxy:", e));
    });
  } else {
    doResolve(config)
      .then((value) => {
        s.value = value;
      })
      .catch((e) => console.error("JSONsx dev proxy:", e));
  }
  return s;
}

// ─── Server function resolution (dev mode) ────────────────────────────────────

/**
 * Resolve a timing: "server" entry in dev mode by executing the function client-side.
 * In production, the compiler replaces this with a fetch to the generated server handler.
 */
async function resolveServerFunction(def, state, key, base) {
  const src = def.$src;
  const exportName = def.$export;

  let mod;
  if (_moduleCache.has(src)) {
    mod = _moduleCache.get(src);
  } else {
    try {
      mod = await import(src);
    } catch {
      if (base) {
        try {
          const resolvedSrc = new URL(src, base).href;
          mod = await import(resolvedSrc);
        } catch {
          // Module cannot run in the browser — fall back to dev server proxy
          return resolveServerFunctionViaProxy(def, state, key, base);
        }
      } else {
        return resolveServerFunctionViaProxy(def, state, key, base);
      }
    }
    _moduleCache.set(src, mod);
  }

  const fn = mod[exportName] ?? mod.default?.[exportName];
  if (!fn) throw new Error(`JSONsx: export "${exportName}" not found in "${src}" for "${key}"`);
  if (typeof fn !== "function")
    throw new Error(`JSONsx: "${exportName}" from "${src}" is not a function`);

  const rawArgs = def.arguments ?? {};
  const hasReactiveArg = Object.values(rawArgs).some((v) => isRefObj(v));
  const resolveArgs = () => {
    const args = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      args[k] = isRefObj(v) ? resolveRef(v.$ref, state) : v;
    }
    return args;
  };

  // Always wrap in ref for reactivity
  const s = ref(null);
  if (hasReactiveArg) {
    effect(() => {
      const args = resolveArgs();
      onEffectCleanup(() => {});
      fn(args)
        .then((result) => {
          s.value = result;
        })
        .catch(() => {});
    });
  } else {
    s.value = await fn(resolveArgs());
  }
  return s;
}

/**
 * Dev-mode fallback: when a timing: "server" module cannot run in the browser,
 * proxy the function call through the JSONsx dev server (POST /__jsonsx_server__).
 * Supports reactive $ref arguments via Vue effect().
 */
async function resolveServerFunctionViaProxy(def, state, key, base) {
  const rawArgs = def.arguments ?? {};
  const hasReactiveArg = Object.values(rawArgs).some((v) => isRefObj(v));

  const resolveArgs = () => {
    const args = {};
    for (const [k, v] of Object.entries(rawArgs)) {
      args[k] = isRefObj(v) ? resolveRef(v.$ref, state) : v;
    }
    return args;
  };

  const doResolve = (args) =>
    fetch("/__jsonsx_server__", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        $src: def.$src,
        $export: def.$export,
        $base: base,
        arguments: args,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`JSONsx server proxy ${r.status} for "${key}"`);
      return r.json();
    });

  // Always wrap in ref for reactivity
  const s = ref(null);
  if (hasReactiveArg) {
    effect(() => {
      const args = resolveArgs();
      onEffectCleanup(() => {});
      doResolve(args)
        .then((result) => {
          s.value = result;
        })
        .catch((e) => console.error("JSONsx server proxy:", e));
    });
  } else {
    doResolve(resolveArgs())
      .then((result) => {
        s.value = result;
      })
      .catch((e) => console.error("JSONsx server proxy:", e));
  }
  return s;
}

/**
 * Resolve a $ref string to a value in scope.
 *
 * With Vue reactivity, this reads directly from the reactive proxy.
 * When called inside a effect or computed, the read is tracked.
 *
 * @param {string} ref
 * @param {object} state - reactive scope proxy (or child scope)
 * @returns {*}
 */
export function resolveRef(ref, state) {
  if (typeof ref !== "string") return ref;
  if (ref.startsWith("$map/")) {
    const parts = ref.split("/");
    const key = parts[1]; // 'item' or 'index'
    const base = state.$map?.[key] ?? state["$map/" + key];
    return parts.length > 2 ? getPath(base, parts.slice(2).join("/")) : base;
  }
  if (ref.startsWith("#/state/")) {
    const sub = ref.slice("#/state/".length);
    const slash = sub.indexOf("/");
    if (slash < 0) return state[sub];
    return getPath(state[sub.slice(0, slash)], sub.slice(slash + 1));
  }
  if (ref.startsWith("parent#/")) return state[ref.slice("parent#/".length)];
  if (ref.startsWith("window#/")) return getPath(globalThis.window, ref.slice("window#/".length));
  if (ref.startsWith("document#/"))
    return getPath(globalThis.document, ref.slice("document#/".length));
  return state[ref] ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** Check if v is a Vue ref (including computed). */
export function isSignal(v) {
  return isRef(v);
}

function isRefObj(v) {
  return v !== null && typeof v === "object" && typeof v.$ref === "string";
}

function isNestedSelector(k) {
  return k.startsWith(":") || k.startsWith(".") || k.startsWith("&") || k.startsWith("[");
}

function getPath(obj, path) {
  return path.split(/[./]/).reduce((o, k) => o?.[k], obj);
}

function mergeProps(def, parentState) {
  const child = Object.create(parentState);
  for (const [k, v] of Object.entries(def.$props ?? {})) {
    child[k] = isRefObj(v) ? resolveRef(v.$ref, parentState) : v;
  }
  return child;
}

/**
 * Convert camelCase to kebab-case.
 * @param {string} s
 * @returns {string}
 */
export function camelToKebab(s) {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/**
 * Convert a style rules object to a CSS text string (skipping nested selectors).
 * @param {object} rules
 * @returns {string}
 */
export function toCSSText(rules) {
  return Object.entries(rules)
    .filter(([k]) => !isNestedSelector(k))
    .map(([p, v]) => `${camelToKebab(p)}: ${v}`)
    .join("; ");
}

// ─── Custom Element Registration ──────────────────────────────────────────────

const _elementDefs = new Map();

/**
 * Resolve and register $elements entries (depth-first).
 */
async function registerElements(elements, base) {
  for (const entry of elements) {
    if (!isRefObj(entry)) continue;
    const href = new URL(entry.$ref, base).href;
    const doc = await resolve(href);
    if (!doc.tagName || !doc.tagName.includes("-")) continue;
    if (customElements.get(doc.tagName)) continue;

    // Depth-first: register sub-dependencies first
    if (doc.$elements) {
      await registerElements(doc.$elements, href);
    }

    await defineElement(doc, href);
  }
}

/**
 * Register a custom element from a JSONsx document.
 *
 * @param {string|object} source - URL to .json file, or raw document object
 * @param {string} [base] - Base URL for resolving $src imports
 * @returns {Promise<void>}
 */
export async function defineElement(source, base) {
  if (typeof source === "string") {
    base = new URL(source, base ?? location.href).href;
    source = await resolve(source);
  }
  base = base ?? location.href;

  const tagName = source.tagName;
  if (!tagName || !tagName.includes("-")) {
    throw new Error(`JSONsx defineElement: tagName "${tagName}" must contain a hyphen`);
  }
  if (customElements.get(tagName)) return;

  // Register sub-dependencies first
  if (source.$elements) {
    await registerElements(source.$elements, base);
  }

  _elementDefs.set(tagName, { doc: source, base });

  const def = source;
  const observedAttrs = def.observedAttributes ?? [];

  const ElementClass = class extends HTMLElement {
    static get observedAttributes() {
      return observedAttrs;
    }

    async connectedCallback() {
      const state = await buildScope(def, {}, base);

      // Merge $props set as JS properties by parent before connection
      for (const key of Object.keys(def.state ?? {})) {
        if (key in this && this[key] !== undefined) {
          state[key] = this[key];
        }
      }
      // Set up property getters/setters that forward into reactive state
      for (const key of Object.keys(def.state ?? {})) {
        if (!(key in HTMLElement.prototype)) {
          Object.defineProperty(this, key, {
            get: () => state[key],
            set: (v) => {
              state[key] = v;
            },
            configurable: true,
          });
        }
      }

      this._state = state;

      // Capture light DOM children (for slot distribution) before rendering
      const slottedChildren = Array.from(this.childNodes);
      this.innerHTML = "";

      // Render template into light DOM (once, not in effect — inner effects handle reactivity)
      applyStyle(this, def.style ?? {}, state["$media"] ?? {}, state);
      applyAttributes(this, def.attributes ?? {}, state);

      const children = Array.isArray(def.children) ? def.children : [];
      for (const childDef of children) {
        this.appendChild(renderNode(childDef, state));
      }

      // Slot distribution (light DOM)
      distributeSlots(this, slottedChildren);

      // Lifecycle: onMount
      if (typeof state.onMount === "function") {
        queueMicrotask(() => state.onMount(state));
      }
    }

    disconnectedCallback() {
      if (typeof this._state?.onUnmount === "function") {
        this._state.onUnmount(this._state);
      }
    }

    adoptedCallback() {
      if (typeof this._state?.onAdopted === "function") {
        this._state.onAdopted(this._state);
      }
    }

    attributeChangedCallback(name, oldVal, newVal) {
      if (!this._state || oldVal === newVal) return;
      const camelKey = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const current = this._state[camelKey];
      if (typeof current === "number") this._state[camelKey] = Number(newVal);
      else if (typeof current === "boolean")
        this._state[camelKey] = newVal !== null && newVal !== "false";
      else this._state[camelKey] = newVal;
    }
  };

  customElements.define(tagName, ElementClass);
}

/**
 * Render a registered custom element with $props (property-first interface).
 */
function renderCustomElementWithProps(def, state, options, path) {
  const el = document.createElement(def.tagName);

  if (options?.onNodeCreated) options.onNodeCreated(el, path, def);

  // Set JS properties from $props (before connection)
  for (const [key, val] of Object.entries(def.$props ?? {})) {
    if (isRefObj(val)) {
      const resolved = resolveRef(val.$ref, state);
      el[key] = resolved;
      // Reactive forwarding: re-set the property when the source changes
      effect(() => {
        el[key] = resolveRef(val.$ref, state);
      });
    } else if (isTemplateString(val)) {
      effect(() => {
        el[key] = evaluateTemplate(val, state);
      });
    } else {
      el[key] = val;
    }
  }

  // Apply host-level style and attributes from the usage site
  applyStyle(el, def.style ?? {}, state["$media"] ?? {}, state);
  applyAttributes(el, def.attributes ?? {}, state);

  // Append slotted children
  const children = Array.isArray(def.children) ? def.children : [];
  for (let i = 0; i < children.length; i++) {
    el.appendChild(renderNode(children[i], state, options));
  }

  return el;
}

/**
 * Light DOM slot distribution.
 */
function distributeSlots(host, slottedChildren) {
  if (slottedChildren.length === 0) return;

  const slots = host.querySelectorAll("slot");
  if (slots.length === 0) return;

  const named = new Map();
  const unnamed = [];

  for (const child of slottedChildren) {
    if (child.nodeType === Node.ELEMENT_NODE && child.getAttribute("slot")) {
      const name = child.getAttribute("slot");
      if (!named.has(name)) named.set(name, []);
      named.get(name).push(child);
    } else {
      unnamed.push(child);
    }
  }

  for (const slot of slots) {
    const name = slot.getAttribute("name");
    const matches = name ? (named.get(name) ?? []) : unnamed;
    if (matches.length > 0) {
      slot.innerHTML = "";
      for (const child of matches) {
        slot.appendChild(child);
      }
    }
  }
}
