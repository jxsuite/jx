/**
 * compile-element.js — Custom element compilation with lit-html
 *
 * Compiles JSONsx documents into self-registering custom element ES modules
 * using @vue/reactivity for state and lit-html for rendering.
 */

import { camelToKebab, RESERVED_KEYS } from "@jsonsx/runtime";
import {
  escapeHtml,
  titleToTagName,
  tagNameToClassName,
  isSchemaOnly,
} from "./shared.js";

/**
 * Compile a JSONsx custom element document to a JS module string.
 *
 * @param {string | object} sourcePath - Path to .json file or raw object
 * @param {object}          [opts]
 * @param {string}          [opts.basePath]   - Base directory for resolving $elements refs
 * @param {Function}        [opts.resolveElementPath] - Custom resolver for $elements paths
 * @returns {Promise<{ files: Array<{ path: string, content: string, tagName: string }> }>}
 */
export async function compileElement(sourcePath, opts = {}) {
  const { resolveElementPath } = opts;
  const files = [];
  const visited = new Set();

  async function processElement(srcPath, parentDir) {
    let doc, filePath;
    if (typeof srcPath === "string") {
      const { readFileSync } = await import("node:fs");
      const { resolve, dirname, basename } = await import("node:path");
      filePath = parentDir ? resolve(parentDir, srcPath) : resolve(srcPath);
      if (visited.has(filePath)) return;
      visited.add(filePath);
      doc = JSON.parse(readFileSync(filePath, "utf8"));
    } else {
      doc = srcPath;
      filePath = null;
      if (visited.has(doc.tagName)) return;
      visited.add(doc.tagName);
    }

    const tagName = doc.tagName;
    if (!tagName || !tagName.includes("-")) {
      throw new Error(`compileElement: tagName "${tagName}" must contain a hyphen`);
    }

    const { dirname: dn, basename: bn } = await import("node:path");
    const currentDir = filePath ? dn(filePath) : null;

    // Process $elements dependencies depth-first
    const elementImports = [];
    if (Array.isArray(doc.$elements)) {
      for (const elRef of doc.$elements) {
        const refPath = elRef.$ref ?? elRef;
        if (typeof refPath !== "string") continue;

        if (currentDir) {
          await processElement(refPath, currentDir);
        }

        let importPath;
        if (resolveElementPath) {
          importPath = resolveElementPath(refPath, currentDir);
        } else {
          importPath = refPath.replace(/\.json$/, ".js");
        }
        elementImports.push(importPath);
      }
    }

    const className = tagNameToClassName(tagName);
    const jsContent = emitElementModule(doc, className, elementImports);
    const outputPath = filePath ? filePath.replace(/\.json$/, ".js") : `${tagName}.js`;
    files.push({ path: outputPath, content: jsContent, tagName });
  }

  await processElement(sourcePath, opts.basePath ?? null);
  return { files };
}

/**
 * Compile a JSONsx custom element document to a complete HTML page
 * with an import map for CDN dependencies.
 */
export async function compileElementPage(sourcePath, opts = {}) {
  const {
    title = "JSONsx App",
    reactivitySrc = "https://esm.sh/@vue/reactivity@3.5.13",
    litHtmlSrc = "https://esm.sh/lit-html@3.3.0",
  } = opts;

  const result = await compileElement(sourcePath, opts);
  const root = result.files[result.files.length - 1];

  const { basename } = await import("node:path");
  const rootScript = basename(root.path);

  const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <script type="importmap">
  {
    "imports": {
      "@vue/reactivity": "${reactivitySrc}",
      "lit-html": "${litHtmlSrc}"
    }
  }
  </script>
</head>
<body>
  <${root.tagName}></${root.tagName}>
  <script type="module" src="./${rootScript}"></script>
</body>
</html>`;

  return { html: htmlContent, files: result.files };
}

// ─── Element code generation helpers ──────────────────────────────────────────

/**
 * Extract the initial value for a state entry to use in reactive({}).
 * Bug fix: expanded signals like { type, default, description } now
 * correctly extract the `default` value instead of dumping the whole object.
 */
function extractInitialValue(def) {
  if (def === null || typeof def !== "object" || Array.isArray(def)) {
    return JSON.stringify(def);
  }
  // Expanded signal with explicit default
  if ("default" in def) {
    return JSON.stringify(def.default);
  }
  // Pure schema-only type definitions — skip (no runtime value)
  if (isSchemaOnly(def)) {
    return undefined; // caller should skip this entry
  }
  // $prototype entries (LocalStorage, SessionStorage, Request, etc.)
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
    return JSON.stringify(def.default ?? null);
  }
  if (def.$prototype === "Request") {
    return "null";
  }
  // Plain object → treat as initial state value
  return JSON.stringify(def);
}

/**
 * Generate a complete ES module string for a custom element.
 */
export function emitElementModule(doc, className, elementImports) {
  const lines = [];

  lines.push("// Generated by @jsonsx/compiler — do not edit manually");
  if (doc.$id) lines.push(`// Source: ${doc.$id}`);

  for (const imp of elementImports) {
    lines.push(`import '${imp}';`);
  }

  lines.push(`import { reactive, computed, effect } from '@vue/reactivity';`);
  lines.push(`import { render, html } from 'lit-html';`);
  lines.push("");
  lines.push(`class ${className} extends HTMLElement {`);
  lines.push("  #dispose = null;");
  lines.push("");

  // Constructor: build reactive state
  lines.push("  constructor() {");
  lines.push("    super();");

  const defs = doc.state ?? {};
  const stateEntries = [];
  const computedEntries = [];
  const functionEntries = [];

  for (const [key, def] of Object.entries(defs)) {
    if (def && typeof def === "object" && !Array.isArray(def) && def.$prototype === "Function") {
      if (typeof def.body === "string" && def.body.includes("return")) {
        computedEntries.push([key, def]);
      } else {
        functionEntries.push([key, def]);
      }
    } else {
      // Use extractInitialValue to get the correct initial value
      const initVal = extractInitialValue(def);
      if (initVal !== undefined) {
        stateEntries.push([key, initVal]);
      }
    }
  }

  // Emit reactive({...}) with initial state values
  lines.push("    this.state = reactive({");
  for (const [key, initVal] of stateEntries) {
    lines.push(`      ${key}: ${initVal},`);
  }
  lines.push("    });");

  // Emit functions: this.state.fnName = (state) => { body }
  for (const [key, def] of functionEntries) {
    lines.push("");
    const args = def.parameters ?? def.arguments ?? ["state"];
    const paramList = args.join(", ");
    lines.push(`    this.state.${key} = (${paramList}) => {`);
    lines.push(`      ${def.body}`);
    lines.push("    };");
  }

  // Emit computed signals
  for (const [key, def] of computedEntries) {
    lines.push("");
    lines.push(`    this.state.${key} = computed(() => {`);
    const body = def.body.replace(/state\./g, "this.state.");
    lines.push(`      ${body}`);
    lines.push("    });");
  }

  lines.push("  }"); // end constructor
  lines.push("");

  // Template method
  lines.push("  template() {");
  lines.push("    const s = this.state;");
  lines.push("    return html`");
  lines.push(emitLitChildren(doc.children, doc.style, "      "));
  lines.push("    `;");
  lines.push("  }");
  lines.push("");

  // connectedCallback
  lines.push("  connectedCallback() {");
  lines.push("    for (const key of Object.keys(this.state)) {");
  lines.push("      if (key in this && this[key] !== undefined) {");
  lines.push("        this.state[key] = this[key];");
  lines.push("      }");
  lines.push("    }");
  if (doc.style && typeof doc.style === "object") {
    const staticStyles = [];
    const dynamicStyles = [];
    for (const [prop, value] of Object.entries(doc.style)) {
      if (
        prop.startsWith(":") || prop.startsWith(".") || prop.startsWith("&") ||
        prop.startsWith("[") || prop.startsWith("@")
      ) continue;
      if (value === null || typeof value === "object") continue;
      const cssProp = camelToKebab(prop);
      if (typeof value === "string" && value.includes("${")) {
        dynamicStyles.push([cssProp, value]);
      } else {
        staticStyles.push([cssProp, value]);
      }
    }
    if (staticStyles.length > 0) {
      for (const [cssProp, value] of staticStyles) {
        lines.push(`    this.style['${cssProp}'] = ${JSON.stringify(value)};`);
      }
    }
    if (dynamicStyles.length > 0) {
      lines.push("    effect(() => {");
      for (const [cssProp, value] of dynamicStyles) {
        const expr = value.replace(/\$\{([^}]+)\}/g, (_, e) =>
          "${" + e.replace(/state\./g, "this.state.") + "}"
        );
        lines.push(`      this.style['${cssProp}'] = \`${expr}\`;`);
      }
      lines.push("    });");
    }
  }
  lines.push("    this.#dispose = effect(() => render(this.template(), this));");
  lines.push("  }");
  lines.push("");

  // disconnectedCallback
  lines.push("  disconnectedCallback() {");
  lines.push("    if (this.#dispose) { this.#dispose(); this.#dispose = null; }");
  lines.push("  }");

  lines.push("}");
  lines.push("");
  lines.push(`customElements.define('${doc.tagName}', ${className});`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Convert JSONsx children to lit-html template content.
 */
function emitLitChildren(children, parentStyle, indent) {
  if (!children) return "";

  if (children.$prototype === "Array") {
    return emitMappedArray(children, indent);
  }

  if (!Array.isArray(children)) return "";

  return children.map((child) => emitLitNode(child, indent)).join("\n");
}

function emitLitNode(def, indent) {
  const tag = def.tagName ?? "div";

  const parts = [];

  if (def.attributes) {
    for (const [key, val] of Object.entries(def.attributes)) {
      if (typeof val === "string" && val.includes("${")) {
        parts.push(`${key}="${toLitExpr(val)}"`);
      } else {
        parts.push(`${key}="${val}"`);
      }
    }
  }

  if (def.id) parts.push(`id="${def.id}"`);
  if (def.className) parts.push(`class="${def.className}"`);

  for (const [key, val] of Object.entries(def)) {
    if (
      RESERVED_KEYS.has(key) ||
      key.startsWith("$") ||
      key.startsWith("on") ||
      key === "tagName" ||
      key === "id" ||
      key === "className" ||
      key === "style" ||
      key === "children" ||
      key === "textContent" ||
      key === "innerHTML" ||
      key === "attributes"
    )
      continue;

    if (val && typeof val === "object" && val.$ref) {
      parts.push(`.${key}="\${${refToExpr(val.$ref)}}"`);
    } else if (typeof val === "string" && val.includes("${")) {
      parts.push(`.${key}="${toLitExpr(val)}"`);
    }
  }

  if (def.$props) {
    for (const [key, val] of Object.entries(def.$props)) {
      if (val && typeof val === "object" && val.$ref) {
        parts.push(`.${key}="\${${refToExpr(val.$ref)}}"`);
      } else {
        parts.push(`.${key}="\${${JSON.stringify(val)}}"`);
      }
    }
  }

  for (const [key, val] of Object.entries(def)) {
    if (!key.startsWith("on") || key === "observedAttributes") continue;
    const eventName = key.slice(2).toLowerCase();
    if (val && typeof val === "object" && val.$ref) {
      parts.push(`@${eventName}="\${(e) => ${refToExpr(val.$ref)}(s, e)}"`);
    } else if (val && typeof val === "object" && val.$prototype === "Function") {
      parts.push(`@${eventName}="\${(e) => { ${inlineHandlerBody(val)} }}"`);
    }
  }

  const styleStr = emitStyleString(def.style);
  if (styleStr) parts.push(`style="${styleStr}"`);

  const attrsStr = parts.length > 0 ? "\n" + indent + "  " + parts.join("\n" + indent + "  ") : "";

  const selfClosing = new Set(["input", "br", "hr", "img", "meta", "link"]);
  if (selfClosing.has(tag)) {
    return `${indent}<${tag}${attrsStr}\n${indent}>`;
  }

  let inner = "";
  if (def.textContent !== undefined) {
    inner = toLitTextContent(def.textContent);
  } else if (def.innerHTML !== undefined) {
    inner = def.innerHTML;
  } else if (def.children) {
    inner = "\n" + emitLitChildren(def.children, def.style, indent + "  ") + "\n" + indent;
  }

  return `${indent}<${tag}${attrsStr}\n${indent}>${inner}</${tag}>`;
}

function emitMappedArray(arrayDef, indent) {
  const itemsExpr = arrayDef.items?.$ref ? refToExpr(arrayDef.items.$ref) : "ITEMS";
  const mapDef = arrayDef.map;

  if (!mapDef) return "";

  const tag = mapDef.tagName ?? "div";
  const parts = [];

  if (mapDef.$props) {
    for (const [key, val] of Object.entries(mapDef.$props)) {
      if (val && typeof val === "object" && val.$ref) {
        parts.push(`.${key}="\${${mapRefToExpr(val.$ref)}}"`);
      } else {
        parts.push(`.${key}="\${${JSON.stringify(val)}}"`);
      }
    }
  }

  const styleStr = emitStyleString(mapDef.style);
  if (styleStr) parts.push(`style="${styleStr}"`);

  for (const [key, val] of Object.entries(mapDef)) {
    if (!key.startsWith("on")) continue;
    const eventName = key.slice(2).toLowerCase();
    if (val && typeof val === "object" && val.$ref) {
      parts.push(`@${eventName}="\${(e) => ${refToExpr(val.$ref)}(s, e)}"`);
    }
  }

  const attrsStr =
    parts.length > 0 ? "\n" + indent + "    " + parts.join("\n" + indent + "    ") : "";

  let inner = "";
  if (mapDef.textContent !== undefined) {
    inner = toLitTextContent(mapDef.textContent);
  } else if (mapDef.children) {
    inner =
      "\n" + emitLitChildren(mapDef.children, null, indent + "      ") + "\n" + indent + "    ";
  }

  return `${indent}\${${itemsExpr}.map((item, index) => html\`\n${indent}  <${tag}${attrsStr}\n${indent}  >${inner}</${tag}>\n${indent}\`)}`;
}

/**
 * Convert a $ref string to a JS expression using `s` (this.state alias).
 */
function refToExpr(ref) {
  if (ref.startsWith("#/state/")) {
    const path = ref.slice("#/state/".length);
    return "s." + path.replace(/\//g, ".");
  }
  if (ref.startsWith("$map/")) {
    const path = ref.slice("$map/".length);
    return path.replace(/\//g, ".");
  }
  return "s." + ref;
}

function mapRefToExpr(ref) {
  if (ref.startsWith("$map/")) {
    return ref.slice("$map/".length).replace(/\//g, ".");
  }
  return refToExpr(ref);
}

function toLitExpr(str) {
  return str.replace(/state\./g, "s.");
}

/**
 * Convert textContent value to lit-html text content.
 * Bug fix: handles $ref objects, which previously produced [object Object].
 */
function toLitTextContent(value) {
  // Handle $ref objects → emit as lit expression
  if (value !== null && typeof value === "object" && typeof value.$ref === "string") {
    return `\${${refToExpr(value.$ref)}}`;
  }
  if (typeof value === "string" && value.includes("${")) {
    return toLitExpr(value);
  }
  return String(value);
}

function inlineHandlerBody(def) {
  const body = def.body ?? "";
  return body.replace(/(?<!this\.)state\./g, "s.").replace(/(?<!this\.)state(?!\.)/g, "s");
}

function emitStyleString(styleDef) {
  if (!styleDef || typeof styleDef !== "object") return "";

  const parts = [];
  for (const [prop, value] of Object.entries(styleDef)) {
    if (
      prop.startsWith(":") ||
      prop.startsWith(".") ||
      prop.startsWith("&") ||
      prop.startsWith("[") ||
      prop.startsWith("@")
    )
      continue;

    if (value === null || typeof value === "object") continue;

    const cssProp = camelToKebab(prop);
    if (typeof value === "string" && value.includes("${")) {
      parts.push(`${cssProp}: ${toLitExpr(value)}`);
    } else {
      parts.push(`${cssProp}: ${value}`);
    }
  }

  return parts.join("; ");
}
