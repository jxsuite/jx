/**
 * compile-client.js — Pre-rendered HTML with reactive bindings
 *
 * Produces clean HTML with `data-bind` marker attributes and a small JS
 * bootstrapper using @vue/reactivity's `effect` + `computed`.
 *
 * Signal functions become computed() on $defs for cross-referencing.
 * Mapped arrays ($prototype: "Array") use lit-html for efficient rendering.
 *
 * Output pattern:
 *   HTML: pre-rendered with data-bind, :prop="key", @event="key"
 *   JS:   $defs (reactive state + computed signals),
 *         bind (DOM getters), on (event handlers), hydrate()
 */

import { camelToKebab, RESERVED_KEYS } from "@jsonsx/runtime";
import {
  isSchemaOnly,
  isTemplateString,
  isRefObject,
  resolveStaticValue,
  createCompileContext,
  buildAttrs,
  compileStyles,
  escapeHtml,
  collectSrcImports,
  DEFAULT_REACTIVITY_SRC,
  DEFAULT_LIT_HTML_SRC,
} from "./shared.js";

/**
 * Compile a JSONsx document to pre-rendered HTML + reactive JS module.
 */
export function compileClient(raw, opts) {
  const {
    title,
    reactivitySrc = DEFAULT_REACTIVITY_SRC,
    litHtmlSrc = DEFAULT_LIT_HTML_SRC,
    modulePath = "app.js",
  } = opts;

  const context = createCompileContext(raw, null, raw.$defs ?? {}, raw.$media ?? {});
  const styleBlock = compileStyles(raw, raw.$media ?? {});

  // Collectors for bindings and handlers
  const counter = { t: 0, s: 0, h: 0, m: 0, sw: 0, l: 0, needsLit: false };
  const bindings = new Map(); // key → expression string
  const handlers = new Map(); // key → { body, args }

  // Classify $defs into state, computed, bind, on, and init blocks
  const stateEntries = [];     // [key, initValue]  → reactive({...})
  const computedEntries = [];  // [key, bodyExpr]   → $defs.key = computed(...)
  const bindEntries = [];      // [key, bodyExpr]   → bind = {...}
  const onEntries = [];        // [key, { args, body }] → on = {...}
  const initBlocks = [];       // lines emitted after $defs for prototype init

  // Map $src path → Set of function names to import
  const srcImportMap = new Map();

  const defs = raw.$defs ?? {};
  for (const [key, def] of Object.entries(defs)) {
    if (def === null || typeof def !== "object" || Array.isArray(def)) {
      // Naked primitive or array → reactive state
      if (typeof def === "string" && isTemplateString(def)) {
        // Template string → computed on $defs so other computeds can ref it
        computedEntries.push([key, '() => `' + def + '`']);
      } else {
        stateEntries.push([key, def]);
      }
      continue;
    }

    // $prototype: "Function"
    if (def.$prototype === "Function") {
      if (def.$src) {
        if (!srcImportMap.has(def.$src)) srcImportMap.set(def.$src, new Set());
        srcImportMap.get(def.$src).add(key);

        if (def.signal) {
          computedEntries.push([key, '() => { return ' + key + '($defs); }']);
        } else {
          onEntries.push([key, { imported: true, args: def.arguments ?? ["$defs", "event"] }]);
        }
      } else if (def.signal) {
        computedEntries.push([key, '() => { ' + def.body + ' }']);
      } else {
        onEntries.push([key, { args: def.arguments ?? ["$defs"], body: def.body }]);
      }
      continue;
    }

    // Pure schema-only type def → skip
    if (isSchemaOnly(def)) continue;

    // Expanded signal with default
    if ("default" in def && !def.$prototype) {
      stateEntries.push([key, def.default]);
      continue;
    }

    // $prototype: "LocalStorage" / "SessionStorage"
    if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
      const storeName = def.$prototype === "LocalStorage" ? "localStorage" : "sessionStorage";
      const storageKey = def.key ?? key;
      const defaultVal = def.default ?? null;
      stateEntries.push([key, null]);
      initBlocks.push(emitStorageInit(key, storeName, storageKey, defaultVal));
      continue;
    }

    // $prototype: "Request"
    if (def.$prototype === "Request") {
      stateEntries.push([key, null]);
      initBlocks.push(emitRequestInit(key, def));
      continue;
    }

    // $prototype: "Cookie"
    if (def.$prototype === "Cookie") {
      stateEntries.push([key, null]);
      initBlocks.push(emitCookieInit(key, def.name ?? key, def.default ?? null));
      continue;
    }

    // Plain object → reactive state
    stateEntries.push([key, def]);
  }

  // Build HTML tree with data-bind markers
  const bodyContent = buildClientNode(raw, raw, context, bindings, handlers, counter);

  // Merge inline-discovered bindings/handlers
  for (const [key, expr] of bindings) {
    if (!bindEntries.some(([k]) => k === key)) {
      bindEntries.push([key, expr]);
    }
  }
  for (const [key, def] of handlers) {
    if (!onEntries.some(([k]) => k === key)) {
      onEntries.push([key, def]);
    }
  }

  // Generate the JS module
  const moduleContent = emitClientModule(
    stateEntries, computedEntries, bindEntries, onEntries,
    initBlocks, srcImportMap, counter, reactivitySrc,
  );

  // Build importmap entries
  const importmapEntries = [
    `      "@vue/reactivity": "${reactivitySrc}"`,
  ];
  if (counter.needsLit) {
    importmapEntries.push(`      "lit-html": "${litHtmlSrc}"`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script type="importmap">
  {
    "imports": {
${importmapEntries.join(",\n")}
    }
  }
  </script>
  ${styleBlock}
  <script type="module" src="./${modulePath}"></script>
</head>
<body>
  ${bodyContent}
</body>
</html>`;

  return { html, files: [{ path: modulePath, content: moduleContent }] };
}

// ─── HTML tree walker ─────────────────────────────────────────────────────────

function buildClientNode(def, raw, context, bindings, handlers, counter) {
  const nextContext = createCompileContext(
    raw,
    context.scope,
    raw?.$defs ?? context.scopeDefs,
    raw?.$media ?? context.media,
  );

  const tag = def.tagName ?? "div";
  const bindAttrs = [];
  let needsBind = false;

  // textContent bindings
  if (def.textContent !== undefined) {
    const tc = raw?.textContent ?? def.textContent;
    if (isRefObject(tc)) {
      const key = refToBindingKey(tc.$ref);
      bindAttrs.push(`:text-content="${key}"`);
      addRefBinding(bindings, key, tc.$ref);
      needsBind = true;
    } else if (isTemplateString(tc)) {
      const key = `_t${counter.t++}`;
      bindAttrs.push(`:text-content="${key}"`);
      bindings.set(key, '() => `' + tc + '`');
      needsBind = true;
    }
  }

  // Event handlers (onclick, oninput, etc.)
  for (const [prop, val] of Object.entries(def)) {
    if (!prop.startsWith("on") || prop === "observedAttributes") continue;
    const eventName = prop.slice(2).toLowerCase();
    if (isRefObject(val)) {
      const key = refToBindingKey(val.$ref);
      bindAttrs.push(`@${eventName}="${key}"`);
      needsBind = true;
    } else if (val && typeof val === "object" && val.$prototype === "Function") {
      const key = `_h${counter.h++}`;
      bindAttrs.push(`@${eventName}="${key}"`);
      handlers.set(key, { args: val.arguments ?? ["$defs", "event"], body: val.body });
      needsBind = true;
    }
  }

  // Dynamic style properties
  if (def.style && typeof def.style === "object") {
    for (const [prop, val] of Object.entries(def.style)) {
      if (prop.startsWith(":") || prop.startsWith(".") || prop.startsWith("&") ||
          prop.startsWith("[") || prop.startsWith("@")) continue;
      if (val === null || typeof val === "object") continue;
      if (isTemplateString(val)) {
        const key = `_s${counter.s++}`;
        bindAttrs.push(`:style.${camelToKebab(prop)}="${key}"`);
        bindings.set(key, '() => `' + val + '`');
        needsBind = true;
      }
    }
  }

  // Dynamic attributes
  if (def.attributes && typeof def.attributes === "object") {
    for (const [attr, val] of Object.entries(def.attributes)) {
      if (isRefObject(val)) {
        const key = refToBindingKey(val.$ref);
        bindAttrs.push(`:attr.${attr}="${key}"`);
        addRefBinding(bindings, key, val.$ref);
        needsBind = true;
      } else if (isTemplateString(val)) {
        const key = `_t${counter.t++}`;
        bindAttrs.push(`:attr.${attr}="${key}"`);
        bindings.set(key, '() => `' + val + '`');
        needsBind = true;
      }
    }
  }

  // Dynamic non-reserved properties (hidden, value, etc.)
  for (const [prop, val] of Object.entries(def)) {
    if (RESERVED_KEYS.has(prop) || prop.startsWith("on") || prop.startsWith("$") ||
        prop === "tagName" || prop === "id" || prop === "className" || prop === "style" ||
        prop === "children" || prop === "textContent" || prop === "innerHTML" ||
        prop === "attributes") continue;
    if (isRefObject(val)) {
      const key = refToBindingKey(val.$ref);
      bindAttrs.push(`:${camelToKebab(prop)}="${key}"`);
      addRefBinding(bindings, key, val.$ref);
      needsBind = true;
    } else if (isTemplateString(val)) {
      const key = `_t${counter.t++}`;
      bindAttrs.push(`:${camelToKebab(prop)}="${key}"`);
      bindings.set(key, '() => `' + val + '`');
      needsBind = true;
    }
  }

  // Build static attrs
  const staticAttrs = buildAttrs(def, nextContext.scope);
  const dataBindAttr = needsBind ? " data-bind" : "";
  const bindAttrStr = bindAttrs.length > 0 ? " " + bindAttrs.join(" ") : "";

  // Inner content
  let inner = "";
  const source = raw ?? def;
  if (source.textContent !== undefined && !needsBind) {
    const value = resolveStaticValue(source.textContent, nextContext.scope);
    inner = value == null ? "" : escapeHtml(String(value));
  } else if (source.textContent !== undefined && needsBind) {
    try {
      const value = resolveStaticValue(source.textContent, nextContext.scope);
      inner = value == null ? "" : escapeHtml(String(value));
    } catch {
      inner = "";
    }
  } else if (source.innerHTML) {
    inner = resolveStaticValue(source.innerHTML, nextContext.scope) ?? "";
  } else if (source.children && typeof source.children === "object" && !Array.isArray(source.children) && source.children.$prototype === "Array") {
    // ─── Mapped array → lit-html render binding ───
    counter.needsLit = true;
    const listKey = `_list${counter.l++}`;
    const arrayDef = source.children;

    // Resolve items source expression
    let itemsExpr;
    if (isRefObject(arrayDef.items)) {
      const path = refToBindingKey(arrayDef.items.$ref);
      itemsExpr = "$defs." + path;
    } else {
      itemsExpr = JSON.stringify(arrayDef.items);
    }

    // Compile the map template to a lit-html template string
    const litTemplate = emitLitMapTemplate(arrayDef.map);
    bindings.set(listKey, '() => (' + itemsExpr + ' ?? []).map((item, index) => html`' + litTemplate + '`)');

    bindAttrs.push(`:render="${listKey}"`);
    needsBind = true;
    // Re-derive the data-bind/attr strings since we added to bindAttrs
    const dataBindAttr2 = " data-bind";
    const bindAttrStr2 = " " + bindAttrs.join(" ");
    const selfClosing = new Set(["input", "br", "hr", "img", "meta", "link"]);
    if (selfClosing.has(tag)) {
      return `<${tag}${staticAttrs}${dataBindAttr2}${bindAttrStr2}>`;
    }
    return `<${tag}${staticAttrs}${dataBindAttr2}${bindAttrStr2}></${tag}>`;
  } else if (Array.isArray(source.children)) {
    const rawChildren = raw?.children;
    inner = source.children
      .map((c, i) => {
        const childRaw = rawChildren?.[i] ?? c;
        return buildClientNode(c, childRaw, nextContext, bindings, handlers, counter);
      })
      .join("\n  ");
  }

  // Self-closing tags
  const selfClosing = new Set(["input", "br", "hr", "img", "meta", "link"]);
  if (selfClosing.has(tag)) {
    return `<${tag}${staticAttrs}${dataBindAttr}${bindAttrStr}>`;
  }

  return `<${tag}${staticAttrs}${dataBindAttr}${bindAttrStr}>${inner}</${tag}>`;
}

// ─── Lit-html map template generation ─────────────────────────────────────────

/**
 * Compile a map definition to a lit-html template string.
 * Converts $map.item → item, $map.index → index.
 */
function emitLitMapTemplate(def) {
  if (!def) return "";
  const tag = def.tagName ?? "div";
  let attrs = "";

  if (def.id) attrs += ' id="' + def.id + '"';
  if (def.className) attrs += ' class="' + mapRefsToLit(def.className) + '"';

  // attributes object
  if (def.attributes && typeof def.attributes === "object") {
    for (const [k, v] of Object.entries(def.attributes)) {
      if (typeof v === "string" && isTemplateString(v)) {
        attrs += " " + k + '="' + mapRefsToLit(v) + '"';
      } else {
        attrs += " " + k + '="' + escapeHtml(String(v)) + '"';
      }
    }
  }

  // style → inline CSS
  if (def.style && typeof def.style === "object") {
    const parts = [];
    for (const [k, v] of Object.entries(def.style)) {
      if (k.startsWith(":") || k.startsWith(".") || k.startsWith("&") ||
          k.startsWith("[") || k.startsWith("@")) continue;
      if (v === null || typeof v === "object") continue;
      const cssProp = camelToKebab(k);
      if (isTemplateString(String(v))) {
        parts.push(cssProp + ": " + mapRefsToLit(String(v)));
      } else {
        parts.push(cssProp + ": " + v);
      }
    }
    if (parts.length > 0) {
      attrs += ' style="' + parts.join("; ") + '"';
    }
  }

  // Event handlers in map template
  for (const [prop, val] of Object.entries(def)) {
    if (!prop.startsWith("on") || prop === "observedAttributes") continue;
    const eventName = prop.slice(2).toLowerCase();
    if (isRefObject(val)) {
      const key = refToBindingKey(val.$ref);
      attrs += " @" + eventName + "=${(e) => { $defs.$map = { item, index }; on." + key + "(e); }}";
    } else if (val && typeof val === "object" && val.$prototype === "Function") {
      const body = mapRefsToLit(val.body);
      attrs += " @" + eventName + "=${(e) => { " + body + " }}";
    }
  }

  // Non-reserved properties that render as attributes
  if (def.contentEditable) {
    attrs += ' contenteditable="' + def.contentEditable + '"';
  }

  // Inner content
  let inner = "";
  if (def.textContent !== undefined) {
    const tc = String(def.textContent);
    if (isTemplateString(tc)) {
      inner = mapRefsToLit(tc);
    } else if (isRefObject(def.textContent)) {
      const path = refToBindingKey(def.textContent.$ref);
      inner = "${$defs." + path + "}";
    } else {
      inner = escapeHtml(tc);
    }
  } else if (def.innerHTML) {
    inner = mapRefsToLit(String(def.innerHTML));
  } else if (Array.isArray(def.children)) {
    inner = "\n      " + def.children.map(c => emitLitMapTemplate(c)).join("\n      ") + "\n    ";
  }

  const voidTags = new Set(["input", "br", "hr", "img", "meta", "link"]);
  if (voidTags.has(tag)) return "<" + tag + attrs + ">";
  return "<" + tag + attrs + ">" + inner + "</" + tag + ">";
}

/**
 * Replace $map references: $map.item → item, $map.index → index
 */
function mapRefsToLit(str) {
  return str.replace(/\$map\./g, "");
}

// ─── JS module generation ─────────────────────────────────────────────────────

function emitClientModule(stateEntries, computedEntries, bindEntries, onEntries, initBlocks, srcImportMap, counter, reactivitySrc) {
  const lines = [];
  const needsLit = counter.needsLit;
  const needsComputed = computedEntries.length > 0;

  lines.push("// Generated by @jsonsx/compiler — do not edit manually");

  // Reactivity imports
  const reactivityImports = ["reactive", "effect"];
  if (needsComputed) reactivityImports.push("computed");
  lines.push("import { " + reactivityImports.join(", ") + " } from '@vue/reactivity';");

  // lit-html imports (only when arrays are present)
  if (needsLit) {
    lines.push("import { html, render } from 'lit-html';");
  }

  // $src imports
  for (const [src, names] of srcImportMap) {
    lines.push("import { " + [...names].join(", ") + " } from '" + src + "';");
  }

  lines.push("");

  // $defs — reactive state
  lines.push("const $defs = reactive({");
  for (const [key, val] of stateEntries) {
    lines.push("  " + key + ": " + JSON.stringify(val) + ",");
  }
  lines.push("});");
  lines.push("");

  // Prototype init blocks (Request fetch, LocalStorage read, etc.)
  if (initBlocks.length > 0) {
    for (const block of initBlocks) {
      lines.push(block);
    }
    lines.push("");
  }

  // Computed signals on $defs
  if (computedEntries.length > 0) {
    for (const [key, expr] of computedEntries) {
      lines.push("$defs." + key + " = computed(" + expr + ");");
    }
    lines.push("");
  }

  // bind — DOM getters
  if (bindEntries.length > 0) {
    lines.push("const bind = {");
    for (const [key, expr] of bindEntries) {
      lines.push("  " + key + ": " + expr + ",");
    }
    lines.push("};");
  } else {
    lines.push("const bind = {};");
  }
  lines.push("");

  // on — event handlers
  if (onEntries.length > 0) {
    lines.push("const on = {");
    for (const [key, def] of onEntries) {
      if (def.imported) {
        const argNames = def.args ?? ["$defs"];
        const callArgs = argNames.map(a => a === "$defs" ? "$defs" : "e").join(", ");
        lines.push("  " + key + ": (e) => { " + key + "(" + callArgs + "); },");
      } else {
        const argNames = def.args ?? ["$defs"];
        const callArgs = argNames.map(a => a === "$defs" ? "$defs" : "e").join(", ");
        lines.push("  " + key + ": (e) => { const fn = (" + argNames.join(", ") + ") => { " + def.body + " }; fn(" + callArgs + "); },");
      }
    }
    lines.push("};");
  } else {
    lines.push("const on = {};");
  }
  lines.push("");

  // Hydration function
  lines.push("function hydrate(root) {");
  lines.push("  root.querySelectorAll('[data-bind]').forEach(el => {");
  lines.push("    [...el.attributes].forEach(a => {");
  lines.push("      if (a.name.startsWith(':')) {");
  lines.push("        const parts = a.name.slice(1).split('.');");
  lines.push("        const key = a.value;");
  if (needsLit) {
    lines.push("        if (parts[0] === 'render') {");
    lines.push("          effect(() => { render(bind[key](), el); });");
    lines.push("        } else if (parts[0] === 'style' && parts.length > 1) {");
  } else {
    lines.push("        if (parts[0] === 'style' && parts.length > 1) {");
  }
  lines.push("          effect(() => { el.style[parts[1]] = bind[key](); });");
  lines.push("        } else if (parts[0] === 'attr' && parts.length > 1) {");
  lines.push("          effect(() => { el.setAttribute(parts[1], bind[key]()); });");
  lines.push("        } else {");
  lines.push("          const prop = parts[0].replace(/-([a-z])/g, (_, c) => c.toUpperCase());");
  lines.push("          effect(() => { el[prop] = bind[key](); });");
  lines.push("        }");
  lines.push("      } else if (a.name.startsWith('@')) {");
  lines.push("        el.addEventListener(a.name.slice(1), on[a.value]);");
  lines.push("      }");
  lines.push("    });");
  lines.push("  });");
  lines.push("}");
  lines.push("");
  lines.push("hydrate(document);");
  lines.push("");

  return lines.join("\n");
}

// ─── Prototype init emitters ─────────────────────────────────────────────────

function emitRequestInit(key, def) {
  const url = def.url;
  const method = def.method ?? "GET";
  const isTemplateUrl = isTemplateString(url);

  if (def.manual) {
    return "// " + key + ": manual Request — fetch triggered by user action";
  }

  const lines = [];
  lines.push("// " + key + ": auto-fetch from " + (isTemplateUrl ? "(dynamic URL)" : url));
  lines.push("effect(() => {");

  if (isTemplateUrl) {
    lines.push("  const url = `" + url + "`;");
    lines.push('  if (!url || url === "undefined" || url.includes("undefined")) return;');
  } else {
    lines.push("  const url = " + JSON.stringify(url) + ";");
  }

  const fetchOpts = [];
  if (method !== "GET") fetchOpts.push("method: " + JSON.stringify(method));
  if (def.headers) fetchOpts.push("headers: " + JSON.stringify(def.headers));
  if (def.body) {
    const bodyStr = typeof def.body === "object" ? JSON.stringify(JSON.stringify(def.body)) : JSON.stringify(def.body);
    fetchOpts.push("body: " + bodyStr);
  }

  const optsStr = fetchOpts.length > 0 ? ", { " + fetchOpts.join(", ") + " }" : "";
  lines.push("  fetch(url" + optsStr + ")");
  lines.push("    .then(r => r.ok ? r.json() : Promise.reject(r.statusText))");
  lines.push("    .then(d => { $defs." + key + " = d; })");
  lines.push("    .catch(e => { $defs." + key + " = { error: String(e) }; });");
  lines.push("});");

  return lines.join("\n");
}

function emitStorageInit(key, storeName, storageKey, defaultVal) {
  const lines = [];
  lines.push("// " + key + ": " + storeName + ' (key: "' + storageKey + '")');
  lines.push("try {");
  lines.push("  const _s = " + storeName + ".getItem(" + JSON.stringify(storageKey) + ");");
  lines.push("  $defs." + key + " = _s !== null ? JSON.parse(_s) : " + JSON.stringify(defaultVal) + ";");
  lines.push("} catch { $defs." + key + " = " + JSON.stringify(defaultVal) + "; }");
  lines.push("effect(() => {");
  lines.push("  const v = $defs." + key + ";");
  lines.push("  try {");
  lines.push("    if (v === null) " + storeName + ".removeItem(" + JSON.stringify(storageKey) + ");");
  lines.push("    else " + storeName + ".setItem(" + JSON.stringify(storageKey) + ", JSON.stringify(v));");
  lines.push("  } catch {}");
  lines.push("});");
  return lines.join("\n");
}

function emitCookieInit(key, cookieName, defaultVal) {
  const lines = [];
  lines.push("// " + key + ': Cookie (name: "' + cookieName + '")');
  lines.push("{");
  lines.push('  const _m = document.cookie.match(new RegExp("(?:^|; )' + cookieName + '=([^;]*)"));');
  lines.push("  try { $defs." + key + " = _m ? JSON.parse(decodeURIComponent(_m[1])) : " + JSON.stringify(defaultVal) + "; }");
  lines.push("  catch { $defs." + key + " = _m ? _m[1] : " + JSON.stringify(defaultVal) + "; }");
  lines.push("}");
  return lines.join("\n");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function refToBindingKey(ref) {
  if (ref.startsWith("#/$defs/")) {
    return ref.slice("#/$defs/".length).replace(/\//g, "_");
  }
  return ref.replace(/\//g, "_");
}

function addRefBinding(bindings, key, ref) {
  if (bindings.has(key)) return;
  if (ref.startsWith("#/$defs/")) {
    const path = ref.slice("#/$defs/".length);
    const parts = path.split("/");
    bindings.set(key, "() => $defs." + parts.join("."));
  } else {
    bindings.set(key, "() => $defs." + ref);
  }
}
