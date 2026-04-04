/**
 * DDOM — Declarative Document Object Model runtime
 * @version 0.8.0
 * @license MIT
 *
 * Four-step pipeline:
 *   1. resolve    — fetch JSON source (or accept raw object)
 *   2. buildScope — Signal.State / Signal.Computed / Web API namespaces + handlers
 *   3. render     — walk resolved tree, build DOM, wire reactive effects
 *   4. output     — append to target
 *
 * @module ddom
 */

import { Signal } from 'signal-polyfill';
import jsonata from 'jsonata';
import { effect } from './effect.js';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Mount a DDOM JSON document into a DOM container.
 *
 * @param {string | object} source - Path to .json file, URL, or raw document object
 * @param {HTMLElement} [target=document.body]
 * @returns {Promise<object>} Resolves with the live component scope
 *
 * @example
 * import { DDOM } from './ddom.js';
 * const scope = await DDOM('./counter.json', document.getElementById('app'));
 */
export async function DDOM(source, target = document.body) {
  const base  = typeof source === 'string'
    ? new URL(source, location.href).href
    : location.href;
  const doc   = await resolve(source);
  const scope = await buildScope(doc, {}, base);
  target.appendChild(renderNode(doc, scope));
  return scope;
}

// ─── Step 1: Resolve ──────────────────────────────────────────────────────────

/**
 * Fetch and parse a DDOM JSON source.
 * Accepts a URL string, absolute URL, or a pre-parsed object.
 *
 * @param {string | object} source
 * @returns {Promise<object>}
 */
export async function resolve(source) {
  if (typeof source !== 'string') return source;
  const res = await fetch(source);
  if (!res.ok) throw new Error(`DDOM: failed to fetch ${source} (${res.status})`);
  return res.json();
}

// ─── Step 2: Build scope ──────────────────────────────────────────────────────

/**
 * Build the reactive scope from $defs and $handlers.
 *
 * @param {object} doc
 * @param {object} [parentScope={}]
 * @param {string} [base=location.href]  Base URL for resolving $handlers import
 * @returns {Promise<object>}
 */
export async function buildScope(doc, parentScope = {}, base = location.href) {
  const scope = { ...parentScope };

  for (const [key, def] of Object.entries(doc.$defs ?? {})) {
    if (def.$handler) continue;

    if (def.signal) {
      if (def.$compute) {
        scope[key] = makeComputedSignal(def.$compute, def.$deps ?? [], scope);
      } else if (def.$prototype) {
        scope[key] = resolvePrototype(def, scope, key);
      } else {
        scope[key] = new Signal.State(def.default ?? null);
      }
    } else if (def.$prototype) {
      scope[key] = resolvePrototype(def, scope, key);
    }
  }

  if (doc.$handlers) {
    const handlersUrl = new URL(doc.$handlers, base).href;
    const mod = await import(handlersUrl);
    for (const [key, fn] of Object.entries(mod.default ?? mod)) {
      scope[key] = fn;
    }
  }

  return scope;
}

/**
 * Bridge async JSONata evaluation into a Signal.State.
 * The effect re-runs whenever any listed dep signal changes, then pushes
 * the new value into the state asynchronously.
 *
 * @param {string}   expression - JSONata expression string
 * @param {string[]} depKeys    - Array of "#/$defs/$key" dep references
 * @param {object}   scope
 * @returns {Signal.State}
 */
function makeComputedSignal(expression, depKeys, scope) {
  const expr  = jsonata(expression);
  const state = new Signal.State(null);

  effect(() => {
    const bindings = {};
    for (const ref of depKeys) {
      const key  = ref.split('/').pop();                       // e.g. '$name'
      const sig  = scope[key];
      const bKey = key.startsWith('$') ? key.slice(1) : key;  // JSONata bindings omit the $
      bindings[bKey] = isSignal(sig) ? sig.get() : sig;
    }
    expr.evaluate(undefined, bindings).then(v => state.set(v ?? null)).catch(() => {});
  });

  return state;
}

// ─── Step 3: Render ───────────────────────────────────────────────────────────

/**
 * Reserved DDOM keys — never set as DOM properties.
 * @type {Set<string>}
 */
export const RESERVED_KEYS = new Set([
  '$schema', '$id', '$defs', '$handlers', '$ref', '$props',
  '$switch', '$prototype', '$handler', '$compute', '$deps',
  'signal', 'timing', 'default', 'description',
  'tagName', 'children', 'style', 'attributes',
  'items', 'map', 'filter', 'sort', 'cases',
]);

/**
 * Recursively render a DDOM element definition into a DOM element.
 *
 * @param {object} def
 * @param {object} scope
 * @returns {HTMLElement}
 */
export function renderNode(def, scope) {
  // Extend scope with any $-prefixed local bindings declared on this node
  // (e.g. "$todoIndex": { "$ref": "$map/index" } in a map template)
  let localScope = scope;
  for (const [key, val] of Object.entries(def)) {
    if (key.startsWith('$') && !RESERVED_KEYS.has(key)) {
      if (localScope === scope) localScope = { ...scope };
      localScope[key] = isRefObj(val) ? resolveRef(val.$ref, scope) : val;
    }
  }

  if (def.$props)                           return renderNode(def, mergeProps(def, localScope));
  if (def.$switch)                          return renderSwitch(def, localScope);
  if (def.children?.$prototype === 'Array') return renderMappedArray(def, localScope);

  const el = document.createElement(def.tagName ?? 'div');

  applyProperties(el, def, localScope);
  applyStyle(el, def.style ?? {});
  applyAttributes(el, def.attributes ?? {}, localScope);

  for (const child of (Array.isArray(def.children) ? def.children : [])) {
    el.appendChild(renderNode(child, localScope));
  }

  return el;
}

// ─── Property / style / attribute application ─────────────────────────────────

function applyProperties(el, def, scope) {
  for (const [key, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key.startsWith('$')) continue;   // scope bindings — handled in renderNode

    if (key.startsWith('on') && isRefObj(val)) {
      const handler = resolveRef(val.$ref, scope);
      if (typeof handler === 'function') el.addEventListener(key.slice(2), handler.bind(scope));
      continue;
    }

    bindProperty(el, key, val, scope);
  }
}

function bindProperty(el, key, val, scope) {
  if (isRefObj(val)) {
    const resolved = resolveRef(val.$ref, scope);
    if (isSignal(resolved)) {
      if (key === 'id' || key === 'tagName') { el[key] = resolved.get(); return; }
      effect(() => { el[key] = resolved.get(); });
    } else {
      el[key] = resolved;
    }
    return;
  }
  el[key] = val;
}

/**
 * Apply inline styles and emit a scoped <style> block for nested CSS selectors.
 *
 * @param {HTMLElement} el
 * @param {object}      styleDef
 */
export function applyStyle(el, styleDef) {
  const nested = {};
  for (const [prop, val] of Object.entries(styleDef)) {
    if (isNestedSelector(prop)) nested[prop] = val;
    else el.style[prop] = val;
  }
  if (!Object.keys(nested).length) return;

  const uid = `ddom-${Math.random().toString(36).slice(2, 7)}`;
  el.dataset.ddom = uid;

  let css = '';
  for (const [sel, rules] of Object.entries(nested)) {
    const resolved = sel.startsWith('&')
      ? sel.replace('&', `[data-ddom="${uid}"]`)
      : sel.startsWith('[')
        ? `[data-ddom="${uid}"]${sel}`
        : `[data-ddom="${uid}"] ${sel}`;
    css += `${resolved} { ${toCSSText(rules)} }\n`;
  }

  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

function applyAttributes(el, attrs, scope) {
  for (const [k, v] of Object.entries(attrs)) {
    if (isRefObj(v)) {
      const resolved = resolveRef(v.$ref, scope);
      if (isSignal(resolved)) effect(() => el.setAttribute(k, String(resolved.get())));
      else el.setAttribute(k, String(resolved ?? ''));
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

// ─── Array mapping ────────────────────────────────────────────────────────────

function renderMappedArray(def, scope) {
  const container = document.createElement(def.tagName ?? 'div');
  const { items: itemsSrc, map: mapDef, filter: filterRef, sort: sortRef } = def.children;

  const getItems = () => {
    let items;
    if (isRefObj(itemsSrc)) {
      const sig = resolveRef(itemsSrc.$ref, scope);
      items = isSignal(sig) ? sig.get() : sig;
    } else { items = itemsSrc; }
    if (!Array.isArray(items)) return [];
    if (filterRef) { const fn = resolveRef(filterRef.$ref, scope); if (typeof fn === 'function') items = items.filter(fn); }
    if (sortRef)   { const fn = resolveRef(sortRef.$ref, scope);   if (typeof fn === 'function') items = [...items].sort(fn); }
    return items;
  };

  const render = () => {
    container.innerHTML = '';
    getItems().forEach((item, index) => {
      const child = { ...scope, '$map/item': item, '$map/index': index };
      container.appendChild(renderNode(mapDef, child));
    });
  };

  const sig = isRefObj(itemsSrc) && resolveRef(itemsSrc.$ref, scope);
  if (isSignal(sig)) effect(render);
  else render();

  return container;
}

// ─── $switch ──────────────────────────────────────────────────────────────────

function renderSwitch(def, scope) {
  const container = document.createElement(def.tagName ?? 'div');
  const sig = resolveRef(def.$switch.$ref, scope);
  const getKey = () => isSignal(sig) ? sig.get() : sig;

  const render = () => {
    container.innerHTML = '';
    const caseDef = def.cases?.[getKey()];
    if (caseDef) container.appendChild(renderNode(caseDef, scope));
  };

  if (isSignal(sig)) effect(render);
  else render();

  return container;
}

// ─── Prototype namespaces ─────────────────────────────────────────────────────

/**
 * Resolve a $prototype definition into a reactive signal wrapping a Web API.
 *
 * @param {object} def   - $defs entry with $prototype
 * @param {object} scope
 * @param {string} key   - def key (for diagnostics)
 * @returns {Signal.State}
 */
export function resolvePrototype(def, scope, key) {
  switch (def.$prototype) {

    case 'Request': {
      const state = new Signal.State(null);
      const doFetch = () => {
        const url = interpolateRef(def.url, scope);
        if (!url || url === 'undefined') return;
        fetch(url, {
          method: def.method ?? 'GET',
          ...(def.headers && { headers: def.headers }),
          ...(def.body    && { body: typeof def.body === 'object' ? JSON.stringify(def.body) : def.body }),
        })
          .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
          .then(d => state.set(d))
          .catch(e => state.set({ error: String(e) }));
      };
      if (!def.manual) doFetch();
      state.fetch = doFetch;
      return state;
    }

    case 'URLSearchParams':
      return new Signal.Computed(() => {
        const p = {};
        for (const [k, v] of Object.entries(def)) {
          if (k !== '$prototype' && k !== 'signal') p[k] = interpolateRef(v, scope);
        }
        return new URLSearchParams(p).toString();
      });

    case 'LocalStorage':
    case 'SessionStorage': {
      const store = def.$prototype === 'LocalStorage' ? localStorage : sessionStorage;
      const k = def.key ?? key;
      let init;
      try { const s = store.getItem(k); init = s !== null ? JSON.parse(s) : (def.default ?? null); }
      catch { init = def.default ?? null; }
      const sig = new Signal.State(init);
      const orig = sig.set.bind(sig);
      sig.set   = v => { try { store.setItem(k, JSON.stringify(v)); } catch {} orig(v); };
      sig.clear = () => { try { store.removeItem(k); } catch {} orig(null); };
      return sig;
    }

    case 'Cookie': {
      const name = def.name ?? key;
      const read = () => { const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)')); if (!m) return null; try { return JSON.parse(decodeURIComponent(m[1])); } catch { return m[1]; } };
      const write = v => { let s = `${name}=${encodeURIComponent(JSON.stringify(v))}`; if (def.maxAge !== undefined) s += `; Max-Age=${def.maxAge}`; if (def.path) s += `; Path=${def.path}`; if (def.domain) s += `; Domain=${def.domain}`; if (def.secure) s += `; Secure`; if (def.sameSite) s += `; SameSite=${def.sameSite}`; document.cookie = s; };
      const sig = new Signal.State(read() ?? def.default ?? null);
      const orig = sig.set.bind(sig);
      sig.set   = v => { write(v); orig(v); };
      sig.clear = () => { document.cookie = `${name}=; Max-Age=-99999999`; orig(null); };
      return sig;
    }

    case 'IndexedDB': {
      const state = new Signal.State(null);
      const { database, store, version = 1, keyPath = 'id', autoIncrement = true, indexes = [] } = def;
      const req = indexedDB.open(database, version);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(store)) {
          const os = db.createObjectStore(store, { keyPath, autoIncrement });
          for (const i of indexes) os.createIndex(i.name, i.keyPath, { unique: i.unique ?? false });
        }
      };
      req.onsuccess = e => {
        const db = e.target.result;
        state.set({ database, store, version, isReady: true, getStore: (mode = 'readwrite') => Promise.resolve(db.transaction(store, mode).objectStore(store)) });
      };
      req.onerror = () => state.set({ error: req.error?.message });
      return state;
    }

    case 'Set': {
      const sig = new Signal.State(new Set(def.default ?? []));
      const orig = sig.set.bind(sig);
      sig.add    = v => orig(new Set([...sig.get(), v]));
      sig.delete = v => { const s = new Set(sig.get()); s.delete(v); orig(s); };
      sig.clear  = () => orig(new Set());
      return sig;
    }

    case 'Map': {
      const sig = new Signal.State(new Map(Object.entries(def.default ?? {})));
      const orig = sig.set.bind(sig);
      sig.put    = (k, v) => orig(new Map([...sig.get(), [k, v]]));
      sig.remove = k => { const m = new Map(sig.get()); m.delete(k); orig(m); };
      sig.clear  = () => orig(new Map());
      return sig;
    }

    case 'FormData': {
      const fd = new FormData();
      for (const [k, v] of Object.entries(def.fields ?? {})) fd.append(k, v);
      return new Signal.State(fd);
    }

    case 'Blob':
      return new Signal.State(new Blob(def.parts ?? [], { type: def.type ?? 'text/plain' }));

    case 'ReadableStream':
      return new Signal.State(null);

    default:
      console.warn(`DDOM: unknown $prototype "${def.$prototype}" for "${key}"`);
      return new Signal.State(null);
  }
}

// ─── $ref resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a $ref string to a value in scope or on window/document.
 *
 * @param {string} ref
 * @param {object} scope
 * @returns {*}
 */
export function resolveRef(ref, scope) {
  if (typeof ref !== 'string') return ref;
  if (ref.startsWith('$map/')) {
    // '$map/item' or '$map/index' → direct scope lookup
    // '$map/item/text' → scope['$map/item'].text
    const parts = ref.split('/');
    const baseKey = parts[0] + '/' + parts[1];   // '$map/item' | '$map/index'
    const base = scope[baseKey];
    return parts.length > 2 ? getPath(base, parts.slice(2).join('/')) : base;
  }
  if (ref.startsWith('#/$defs/'))    return scope[ref.slice('#/$defs/'.length)];
  if (ref.startsWith('parent#/'))    return scope[ref.slice('parent#/'.length)];
  if (ref.startsWith('window#/'))    return getPath(globalThis.window,   ref.slice('window#/'.length));
  if (ref.startsWith('document#/')) return getPath(globalThis.document, ref.slice('document#/'.length));
  return scope[ref] ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/** @param {*} v @returns {boolean} */
export function isSignal(v) {
  return v instanceof Signal.State || v instanceof Signal.Computed;
}

function isRefObj(v) {
  return v !== null && typeof v === 'object' && typeof v.$ref === 'string';
}

function isNestedSelector(k) {
  return k.startsWith(':') || k.startsWith('.') || k.startsWith('&') || k.startsWith('[');
}

function getPath(obj, path) {
  return path.split(/[./]/).reduce((o, k) => o?.[k], obj);
}

function mergeProps(def, parentScope) {
  const scope = { ...parentScope };
  for (const [k, v] of Object.entries(def.$props ?? {})) {
    scope[k] = isRefObj(v) ? resolveRef(v.$ref, parentScope) : new Signal.State(v);
  }
  return scope;
}

function interpolateRef(val, scope) {
  if (isRefObj(val)) { const r = resolveRef(val.$ref, scope); return isSignal(r) ? r.get() : r; }
  if (typeof val !== 'string') return val;
  return val.replace(/\$\{([^}]+)\}/g, (_, e) => { const r = resolveRef(e.trim(), scope); return isSignal(r) ? r.get() : (r ?? ''); });
}

/**
 * Convert camelCase to kebab-case.
 * @param {string} s
 * @returns {string}
 */
export function camelToKebab(s) {
  return s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
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
    .join('; ');
}

export { Signal };
