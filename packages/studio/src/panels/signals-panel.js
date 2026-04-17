/**
 * Signals panel — signal/def helpers, signals template, CEM editors, plugin schema forms.
 *
 * Extracted from studio.js to reduce file size.
 */

import { html, nothing } from "lit-html";
import { addDef, removeDef, updateDef, renameDef, update } from "../../store.js";
import { fetchPluginSchema, pluginSchemaCache } from "../services/code-services.js";

// ─── Module-local state ─────────────────────────────────────────────────────

/** Expanded signal editor state (persists across renders). */
/** @type {any} */
let expandedSignal = null;

/** Track which functions have the advanced param editor open. */
const advancedParamOpen = new Set();

/** Default templates for creating new signal definitions. */
const DEF_TEMPLATES = /** @type {Record<string, any>} */ ({
  state: { type: "string", default: "" },
  computed: { $compute: "", $deps: [] },
  request: { $prototype: "Request", url: "", method: "GET", timing: "client" },
  localStorage: { $prototype: "LocalStorage", key: "", default: null },
  sessionStorage: { $prototype: "SessionStorage", key: "", default: null },
  indexedDB: { $prototype: "IndexedDB", database: "", store: "", version: 1 },
  cookie: { $prototype: "Cookie", name: "", default: "" },
  set: { $prototype: "Set", default: [] },
  map: { $prototype: "Map", default: {} },
  formData: { $prototype: "FormData", fields: {} },
  function: { $prototype: "Function", body: "", parameters: [] },
  external: { $prototype: "", $src: "" },
});

/** Keys handled by the framework — skip when rendering schema fields. */
const STUDIO_RESERVED_KEYS = new Set([
  "$prototype",
  "$src",
  "$export",
  "signal",
  "timing",
  "default",
  "description",
  "body",
  "parameters",
  "name",
  "attribute",
  "reflects",
  "deprecated",
  "emits",
]);

// ─── Signals / defs helpers ──────────────────────────────────────────────────

/**
 * Classify a state entry into a category string.
 *
 * @param {any} def
 */
export function defCategory(def) {
  if (!def) return "state";
  if (def.$handler || def.$prototype === "Function") return "function";
  if (def.$compute) return "computed";
  if (def.$prototype) return "data";
  return "state";
}

/**
 * Badge label for a def category.
 *
 * @param {any} def
 */
export function defBadgeLabel(def) {
  if (!def) return "S";
  if (def.$handler || def.$prototype === "Function") return "F";
  if (def.$compute) return "C";
  if (def.$prototype) return def.$prototype.charAt(0);
  return "S";
}

/**
 * Hint text for a signal row.
 *
 * @param {any} name
 * @param {any} def
 */
export function defHint(name, def) {
  if (!def) return "";
  if (def.$prototype === "Function") {
    if (def.body) return def.body.length > 20 ? def.body.slice(0, 20) + "..." : def.body;
    if (def.$src) return def.$src;
    return "function";
  }
  if (def.$handler) return "handler (legacy)";
  if (def.$compute)
    return "=" + (def.$compute.length > 20 ? def.$compute.slice(0, 20) + "..." : def.$compute);
  if (def.$prototype === "Request") return def.method + " " + (def.url || "").slice(0, 20);
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage")
    return def.key || "";
  if (def.$prototype === "IndexedDB") return def.database || "";
  if (def.$prototype === "Cookie") return def.name || "";
  if (def.$prototype) return def.$prototype;
  if (def.attribute) return `[${def.attribute}] ${def.type || ""}`;
  return def.type || "";
}

/**
 * Whether the current document defines a custom element (hyphenated tagName).
 *
 * @param {any} S
 */
export function isCustomElementDoc(S) {
  return (S.document.tagName || "").includes("-");
}

/**
 * Recursively collect CSS `part` attributes from the document tree.
 *
 * @param {any} node
 * @param {any[]} [parts]
 */
export function collectCssParts(node, parts = []) {
  if (node?.attributes?.part)
    parts.push({ name: node.attributes.part, tag: node.tagName || "div" });
  if (Array.isArray(node?.children))
    node.children.forEach((/** @type {any} */ c) => collectCssParts(c, parts));
  return parts;
}

/**
 * Resolve a $ref value to a display string using signal defaults. Used by the canvas to show real
 * values instead of raw refs.
 *
 * @param {any} value
 * @param {any} defs
 */
export function resolveDefaultForCanvas(value, defs) {
  if (!value || typeof value !== "object" || !value.$ref) return value;
  const ref = value.$ref;
  /** @type {any} */
  let defName;
  if (ref.startsWith("#/state/")) defName = ref.slice(8);
  else if (ref.startsWith("$")) defName = ref;
  else return `{${ref}}`;

  const def = defs?.[defName];
  if (!def) return `{${defName}}`;

  // State signal → use default
  if (!def.$compute && !def.$prototype) {
    if (def.default !== undefined && def.default !== null) {
      if (typeof def.default === "object") return JSON.stringify(def.default);
      return String(def.default);
    }
    return "";
  }
  // Computed → expression indicator
  if (def.$compute) return `\u0192(${defName})`;
  // Request → URL hint
  if (def.$prototype === "Request") return `\u27F3 ${def.url || "fetch"}`;
  // Storage → use default or key
  if (def.$prototype === "LocalStorage" || def.$prototype === "SessionStorage") {
    if (def.default !== undefined && def.default !== null) {
      if (typeof def.default === "object") return JSON.stringify(def.default);
      return String(def.default);
    }
    return `[${def.key || "storage"}]`;
  }
  if (def.$prototype) return `{${def.$prototype}}`;
  return `{${defName}}`;
}

// ─── Simple field row ────────────────────────────────────────────────────────

/** Simple field row for signal editors. */
export function signalFieldRow(
  /** @type {any} */ label,
  /** @type {any} */ value,
  /** @type {any} */ onChange,
) {
  /** @type {any} */
  let debounce;
  return html`
    <div class="field-row">
      <sp-field-label size="s">${label}</sp-field-label>
      <sp-textfield
        size="s"
        value=${value}
        @input=${(/** @type {any} */ e) => {
          clearTimeout(debounce);
          debounce = setTimeout(() => onChange(e.target.value), 400);
        }}
      ></sp-textfield>
    </div>
  `;
}

/** Normalize a parameter entry to a CEM object. */
export function normParam(/** @type {any} */ p) {
  return typeof p === "string" ? { name: p } : p;
}

// ─── Left panel: Signals ─────────────────────────────────────────────────────

/**
 * @param {any} S
 * @param {{ renderLeftPanel: Function; renderCanvas: Function }} ctx
 */
export function renderSignalsTemplate(S, { renderLeftPanel, renderCanvas }) {
  const defs = S.document.state || {};
  const entries = Object.entries(defs);

  // Group by category
  const groups = /** @type {Record<string, any[]>} */ ({
    state: [],
    computed: [],
    data: [],
    function: [],
  });
  for (const [name, def] of entries) {
    groups[defCategory(def)].push([name, def]);
  }

  const categories = [
    { key: "state", label: "State", items: groups.state },
    { key: "computed", label: "Computed", items: groups.computed },
    { key: "data", label: "Data", items: groups.data },
    { key: "function", label: "Functions", items: groups.function },
  ];

  const collapsedCats = S._collapsedSignalCats || (S._collapsedSignalCats = new Set());

  const catTemplates = categories
    .filter((c) => c.items.length > 0)
    .map(
      ({ key, label, items }) => html`
        <div
          class="signal-category${collapsedCats.has(key) ? " collapsed" : ""}"
          @click=${() => {
            if (collapsedCats.has(key)) collapsedCats.delete(key);
            else collapsedCats.add(key);
            renderLeftPanel();
          }}
        >
          ${label} (${items.length})
        </div>
        ${collapsedCats.has(key)
          ? nothing
          : items.map(([name, def]) => {
              /** @type {any} */
              const isExpanded = expandedSignal === name;
              return html`
                <div
                  class="signal-row${isExpanded ? " expanded" : ""}"
                  @click=${() => {
                    expandedSignal = isExpanded ? null : name;
                    renderLeftPanel();
                  }}
                >
                  <span class="signal-badge ${defCategory(def)}">${defBadgeLabel(def)}</span>
                  <span class="signal-name">${name}</span>
                  <span class="signal-hint">${defHint(name, def)}</span>
                  <sp-action-button
                    quiet
                    size="xs"
                    class="signal-del"
                    @click=${(/** @type {any} */ e) => {
                      e.stopPropagation();
                      update(removeDef(S, name));
                    }}
                  >
                    <sp-icon-delete slot="icon"></sp-icon-delete>
                  </sp-action-button>
                </div>
                ${isExpanded
                  ? html`<div class="signal-editor">
                      ${renderSignalEditorTemplate(S, name, def, { renderLeftPanel, renderCanvas })}
                    </div>`
                  : nothing}
              `;
            })}
      `,
    );

  return html`
    ${catTemplates}
    ${entries.length === 0 ? html`<div class="empty-state">No state defined</div>` : nothing}
    <div class="signals-add">
      <sp-picker
        size="s"
        label="+ Add…"
        placeholder="+ Add…"
        @change=${(/** @type {any} */ e) => {
          const type = e.target.value;
          if (!type) return;
          const template = DEF_TEMPLATES[type];
          if (!template) return;
          const isFunction = type === "function";
          let nameBase = isFunction ? "newFunction" : "$newSignal";
          let n = nameBase;
          let i = 1;
          while (S.document.state && S.document.state[n]) {
            n = nameBase + i++;
          }
          update(addDef(S, n, structuredClone(template)));
          expandedSignal = n;
          renderLeftPanel();
        }}
      >
        <sp-menu-item value="state">State Signal</sp-menu-item>
        <sp-menu-item value="computed">Computed</sp-menu-item>
        <sp-menu-divider></sp-menu-divider>
        <sp-menu-item value="request">Fetch (Request)</sp-menu-item>
        <sp-menu-item value="localStorage">LocalStorage</sp-menu-item>
        <sp-menu-item value="sessionStorage">SessionStorage</sp-menu-item>
        <sp-menu-item value="indexedDB">IndexedDB</sp-menu-item>
        <sp-menu-item value="cookie">Cookie</sp-menu-item>
        <sp-menu-item value="set">Set</sp-menu-item>
        <sp-menu-item value="map">Map</sp-menu-item>
        <sp-menu-item value="formData">FormData</sp-menu-item>
        <sp-menu-item value="external">External Module…</sp-menu-item>
        <sp-menu-divider></sp-menu-divider>
        <sp-menu-item value="function">Function</sp-menu-item>
      </sp-picker>
    </div>
  `;
}

/** Render inline editor fields for a specific signal/def type. */
function renderSignalEditorTemplate(
  /** @type {any} */ S,
  /** @type {any} */ name,
  /** @type {any} */ def,
  /** @type {{ renderLeftPanel: Function; renderCanvas: Function }} */ ctx,
) {
  const cat = defCategory(def);

  // Helper for picker rows
  const pickerRow = (
    /** @type {any} */ label,
    /** @type {any} */ options,
    /** @type {any} */ currentVal,
    /** @type {any} */ onChange,
  ) => {
    return html`
      <div class="field-row">
        <label class="field-label">${label}</label>
        <sp-picker
          size="s"
          class="field-input"
          value=${currentVal}
          @change=${(/** @type {any} */ e) => onChange(e.target.value)}
        >
          ${options.map(
            (/** @type {any} */ opt) => html`<sp-menu-item value=${opt}>${opt}</sp-menu-item>`,
          )}
        </sp-picker>
      </div>
    `;
  };

  // Helper for textarea rows
  const textareaRow = (
    /** @type {any} */ label,
    /** @type {any} */ value,
    /** @type {any} */ onChange,
    /** @type {any} */ opts = {},
  ) => {
    /** @type {any} */
    let debounce;
    return html`
      <div class="field-row">
        <label class="field-label">${label}</label>
        <textarea
          class="field-input"
          style="min-height:${opts.minHeight || "40px"};${opts.mono
            ? "font-family:'SF Mono','Fira Code','Consolas',monospace;font-size:11px;"
            : ""}"
          .value=${value}
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => onChange(e.target.value), 500);
          }}
        ></textarea>
      </div>
    `;
  };

  // Name field (common to all)
  const nameField = signalFieldRow("name", name, (/** @type {any} */ v) => {
    if (v && v !== name && !(S.document.state && S.document.state[v])) {
      expandedSignal = v;
      update(renameDef(S, name, v));
    }
  });

  /** @type {any} */
  let fields = nothing;

  if (cat === "state") {
    const defaultVal =
      def.default !== undefined && def.default !== null
        ? typeof def.default === "object"
          ? JSON.stringify(def.default)
          : String(def.default)
        : "";

    const cemFields = isCustomElementDoc(S)
      ? html`
          ${signalFieldRow("attribute", def.attribute || "", (/** @type {any} */ v) =>
            update(updateDef(S, name, { attribute: v || undefined })),
          )}
          <div class="field-row">
            <label class="field-label">reflects</label>
            <sp-checkbox
              class="field-check"
              ?checked=${!!def.reflects}
              @change=${(/** @type {any} */ e) =>
                update(updateDef(S, name, { reflects: e.target.checked || undefined }))}
            ></sp-checkbox>
          </div>
          ${signalFieldRow(
            "deprecated",
            typeof def.deprecated === "string" ? def.deprecated : "",
            (/** @type {any} */ v) => update(updateDef(S, name, { deprecated: v || undefined })),
          )}
        `
      : nothing;

    fields = html`
      ${pickerRow(
        "type",
        ["string", "integer", "number", "boolean", "array", "object"],
        def.type || "string",
        (/** @type {any} */ v) => update(updateDef(S, name, { type: v })),
      )}
      ${signalFieldRow("default", defaultVal, (/** @type {any} */ v) => {
        let parsed = v;
        if (def.type === "integer") parsed = parseInt(v, 10) || 0;
        else if (def.type === "number") parsed = parseFloat(v) || 0;
        else if (def.type === "boolean") parsed = v === "true";
        else if (def.type === "array" || def.type === "object") {
          try {
            parsed = JSON.parse(v);
          } catch {
            parsed = v;
          }
        }
        update(updateDef(S, name, { default: parsed }));
      })}
      ${signalFieldRow("desc", def.description || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { description: v || undefined })),
      )}
      ${cemFields}
    `;
  } else if (cat === "computed") {
    /** @type {any} */
    let debounce;
    fields = html`
      <div class="field-row">
        <label class="field-label">expr</label>
        <textarea
          class="field-input"
          style="min-height:40px"
          .value=${def.$compute || ""}
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              const expr = e.target.value;
              const depMatches = expr.match(/\$[a-zA-Z_]\w*/g) || [];
              const deps = [...new Set(depMatches)].map((d) => `#/state/${d}`);
              update(updateDef(S, name, { $compute: expr, $deps: deps }));
            }, 500);
          }}
        ></textarea>
      </div>
      ${def.$deps && def.$deps.length > 0
        ? html`
            <div class="field-row">
              <label class="field-label">deps</label>
              <span class="signal-hint" style="flex:1;max-width:none"
                >${def.$deps
                  .map((/** @type {any} */ d) => d.replace("#/state/", ""))
                  .join(", ")}</span
              >
            </div>
          `
        : nothing}
    `;
  } else if (cat === "data") {
    fields = renderDataSourceFields(S, name, def, textareaRow, pickerRow, ctx);
  } else if (cat === "function") {
    fields = renderFunctionFields(S, name, def, textareaRow, ctx);
  }

  return html`${nameField}${fields}`;
}

/** Data source fields for signal editor */
function renderDataSourceFields(
  /** @type {any} */ S,
  /** @type {any} */ name,
  /** @type {any} */ def,
  /** @type {any} */ textareaRow,
  /** @type {any} */ pickerRow,
  /** @type {{ renderLeftPanel: Function; renderCanvas: Function }} */ ctx,
) {
  const proto = def.$prototype;

  if (proto === "Request") {
    return html`
      ${signalFieldRow("url", def.url || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { url: v })),
      )}
      ${pickerRow(
        "method",
        ["GET", "POST", "PUT", "DELETE", "PATCH"],
        def.method || "GET",
        (/** @type {any} */ v) => update(updateDef(S, name, { method: v })),
      )}
      ${pickerRow("timing", ["client", "server"], def.timing || "client", (/** @type {any} */ v) =>
        update(updateDef(S, name, { timing: v })),
      )}
    `;
  }
  if (proto === "LocalStorage" || proto === "SessionStorage") {
    const defaultStr =
      def.default !== undefined && def.default !== null
        ? typeof def.default === "object"
          ? JSON.stringify(def.default, null, 2)
          : String(def.default)
        : "";
    return html`
      ${signalFieldRow("key", def.key || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { key: v })),
      )}
      ${textareaRow("default", defaultStr, (/** @type {any} */ v) => {
        try {
          update(updateDef(S, name, { default: JSON.parse(v) }));
        } catch {
          update(updateDef(S, name, { default: v }));
        }
      })}
    `;
  }
  if (proto === "IndexedDB") {
    return html`
      ${signalFieldRow("database", def.database || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { database: v })),
      )}
      ${signalFieldRow("store", def.store || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { store: v })),
      )}
      ${signalFieldRow("version", String(def.version || 1), (/** @type {any} */ v) =>
        update(updateDef(S, name, { version: parseInt(v, 10) || 1 })),
      )}
    `;
  }
  if (proto === "Cookie") {
    return html`
      ${signalFieldRow("cookie", def.name || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { name: v })),
      )}
      ${signalFieldRow("default", def.default || "", (/** @type {any} */ v) =>
        update(updateDef(S, name, { default: v })),
      )}
    `;
  }
  if (proto === "Set" || proto === "Map" || proto === "FormData") {
    const fieldName = proto === "FormData" ? "fields" : "default";
    const defaultStr =
      def.default !== undefined && def.default !== null
        ? JSON.stringify(def.default, null, 2)
        : proto === "FormData"
          ? JSON.stringify(def.fields || {}, null, 2)
          : "";
    return textareaRow(fieldName, defaultStr, (/** @type {any} */ v) => {
      try {
        update(updateDef(S, name, { [fieldName]: JSON.parse(v) }));
      } catch {}
    });
  }
  // Schema-driven fallback
  return renderExternalPrototypeEditorTemplate(S, name, def, ctx);
}

/** Function fields for signal editor */
function renderFunctionFields(
  /** @type {any} */ S,
  /** @type {any} */ name,
  /** @type {any} */ def,
  /** @type {any} */ textareaRow,
  /** @type {{ renderLeftPanel: Function; renderCanvas: Function }} */ ctx,
) {
  const srcFields = def.$src
    ? html`
        ${signalFieldRow("$src", def.$src || "", (/** @type {any} */ v) =>
          update(updateDef(S, name, { $src: v || undefined })),
        )}
        ${signalFieldRow("$export", def.$export || "", (/** @type {any} */ v) =>
          update(updateDef(S, name, { $export: v || undefined })),
        )}
      `
    : textareaRow(
        "body",
        def.body || "",
        (/** @type {any} */ v) => update(updateDef(S, name, { body: v })),
        { minHeight: "60px", mono: true },
      );

  return html`
    ${srcFields} ${renderParameterEditorTemplate(S, name, def, ctx)}
    ${isCustomElementDoc(S) ? renderEmitsEditorTemplate(S, name, def) : nothing}
    ${!def.$src
      ? html`
          <button
            class="kv-add"
            style="margin-top:4px"
            @click=${() => {
              S = { ...S, ui: { ...S.ui, editingFunction: { type: "def", defName: name } } };
              ctx.renderCanvas();
            }}
          >
            Open in editor
          </button>
        `
      : nothing}
    ${signalFieldRow("desc", def.description || "", (/** @type {any} */ v) =>
      update(updateDef(S, name, { description: v || undefined })),
    )}
  `;
}

// ─── CEM Editors ─────────────────────────────────────────────────────────────

/** Render CEM parameter editor with basic/advanced toggle. */
function renderParameterEditorTemplate(
  /** @type {any} */ S,
  /** @type {any} */ name,
  /** @type {any} */ def,
  /** @type {{ renderLeftPanel: Function; renderCanvas: Function }} */ ctx,
) {
  const params = (def.parameters || []).map(normParam);
  const isAdvanced = advancedParamOpen.has(name);

  if (!isAdvanced) {
    // Basic mode: name chips
    return html`
      <div class="field-row" style="flex-wrap:wrap">
        <label class="field-label">params</label>
        <div style="display:flex;flex-wrap:wrap;gap:4px;flex:1;align-items:center">
          ${params.map(
            (/** @type {any} */ p, /** @type {any} */ i) => html`
              <span
                style="display:inline-flex;align-items:center;gap:2px;padding:1px 6px;border-radius:3px;background:var(--bg-hover);font-size:11px;font-family:monospace"
              >
                ${p.name || "?"}
                <span
                  style="cursor:pointer;opacity:0.5;margin-left:2px"
                  @click=${() => {
                    update(
                      updateDef(S, name, {
                        parameters: params.filter(
                          (/** @type {any} */ _, /** @type {any} */ j) => j !== i,
                        ).length
                          ? params.filter((/** @type {any} */ _, /** @type {any} */ j) => j !== i)
                          : undefined,
                      }),
                    );
                  }}
                  >×</span
                >
              </span>
            `,
          )}
          <input
            class="field-input"
            style="width:60px;flex:0 0 auto;font-size:11px"
            placeholder="+"
            @keydown=${(/** @type {any} */ e) => {
              if (e.key === "Enter" && e.target.value.trim()) {
                update(
                  updateDef(S, name, { parameters: [...params, { name: e.target.value.trim() }] }),
                );
              }
            }}
          />
        </div>
        <span
          style="font-size:10px;color:var(--fg-dim);cursor:pointer;width:100%;margin-top:2px"
          @click=${() => {
            advancedParamOpen.add(name);
            ctx.renderLeftPanel();
          }}
          >▸ Advanced</span
        >
      </div>
    `;
  }

  // Advanced mode: full rows
  return html`
    <div class="field-row" style="flex-wrap:wrap">
      <label class="field-label">params</label>
      <div style="flex:1;display:flex;flex-direction:column;gap:4px">
        ${params.map(
          (/** @type {any} */ p, /** @type {any} */ i) => html`
            <div style="display:flex;gap:4px;align-items:center">
              <input
                class="field-input"
                .value=${p.name || ""}
                placeholder="name"
                style="flex:1"
                @change=${(/** @type {any} */ e) => {
                  const next = [...params];
                  next[i] = { ...next[i], name: e.target.value };
                  update(updateDef(S, name, { parameters: next }));
                }}
              />
              <input
                class="field-input"
                .value=${p.type?.text || ""}
                placeholder="type"
                style="flex:1"
                @change=${(/** @type {any} */ e) => {
                  const next = [...params];
                  next[i] = {
                    ...next[i],
                    type: e.target.value ? { text: e.target.value } : undefined,
                  };
                  update(updateDef(S, name, { parameters: next }));
                }}
              />
              <input
                class="field-input"
                .value=${p.description || ""}
                placeholder="desc"
                style="flex:2"
                @change=${(/** @type {any} */ e) => {
                  const next = [...params];
                  next[i] = { ...next[i], description: e.target.value || undefined };
                  update(updateDef(S, name, { parameters: next }));
                }}
              />
              <input
                type="checkbox"
                title="optional"
                .checked=${!!p.optional}
                @change=${(/** @type {any} */ e) => {
                  const next = [...params];
                  next[i] = { ...next[i], optional: e.target.checked || undefined };
                  update(updateDef(S, name, { parameters: next }));
                }}
              />
              <span
                style="cursor:pointer;opacity:0.5"
                @click=${() => {
                  const next = params.filter(
                    (/** @type {any} */ _, /** @type {any} */ j) => j !== i,
                  );
                  update(updateDef(S, name, { parameters: next.length ? next : undefined }));
                }}
                >×</span
              >
            </div>
          `,
        )}
        <button
          class="kv-add"
          @click=${() => update(updateDef(S, name, { parameters: [...params, { name: "" }] }))}
        >
          + Add parameter
        </button>
      </div>
      <span
        style="font-size:10px;color:var(--fg-dim);cursor:pointer;width:100%;margin-top:2px"
        @click=${() => {
          advancedParamOpen.delete(name);
          ctx.renderLeftPanel();
        }}
        >▾ Basic</span
      >
    </div>
  `;
}

/** Render CEM emits editor for function state entries. */
function renderEmitsEditorTemplate(
  /** @type {any} */ S,
  /** @type {any} */ name,
  /** @type {any} */ def,
) {
  const emits = def.emits || [];
  if (emits.length === 0 && !isCustomElementDoc(S)) return nothing;

  return html`
    <div
      style="font-size:11px;font-weight:600;color:var(--fg-dim);margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em"
    >
      Emits
    </div>
    ${emits.map(
      (/** @type {any} */ ev, /** @type {any} */ i) => html`
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
          <input
            class="field-input"
            .value=${ev.name || ""}
            placeholder="event name"
            style="flex:1"
            @change=${(/** @type {any} */ e) => {
              const next = [...emits];
              next[i] = { ...next[i], name: e.target.value };
              update(updateDef(S, name, { emits: next }));
            }}
          />
          <input
            class="field-input"
            .value=${ev.type?.text || ""}
            placeholder="type"
            style="flex:1"
            @change=${(/** @type {any} */ e) => {
              const next = [...emits];
              next[i] = { ...next[i], type: e.target.value ? { text: e.target.value } : undefined };
              update(updateDef(S, name, { emits: next }));
            }}
          />
          <input
            class="field-input"
            .value=${ev.description || ""}
            placeholder="description"
            style="flex:2"
            @change=${(/** @type {any} */ e) => {
              const next = [...emits];
              next[i] = { ...next[i], description: e.target.value || undefined };
              update(updateDef(S, name, { emits: next }));
            }}
          />
          <span
            style="cursor:pointer;opacity:0.5"
            @click=${() => {
              update(
                updateDef(S, name, {
                  emits: emits.filter((/** @type {any} */ _, /** @type {any} */ j) => j !== i)
                    .length
                    ? emits.filter((/** @type {any} */ _, /** @type {any} */ j) => j !== i)
                    : undefined,
                }),
              );
            }}
            >×</span
          >
        </div>
      `,
    )}
    <button
      class="kv-add"
      @click=${() => update(updateDef(S, name, { emits: [...emits, { name: "" }] }))}
    >
      + Add event
    </button>
  `;
}

// ─── Plugin schema-driven form rendering ────────────────────────────────────

/**
 * Render config form fields from a JSON Schema `properties` object. Maps schema types to
 * appropriate form controls.
 */
export function renderSchemaFieldsTemplate(
  /** @type {any} */ schema,
  /** @type {any} */ def,
  /** @type {any} */ name,
  /** @type {any} */ S,
) {
  if (!schema?.properties) return nothing;

  const required = new Set(schema.required ?? []);

  return Object.entries(schema.properties)
    .filter(([prop]) => !STUDIO_RESERVED_KEYS.has(prop))
    .map(([prop, ps]) => {
      const currentValue = def[prop];
      const labelText = prop + (required.has(prop) ? " *" : "");

      let control;
      if (ps.enum) {
        control = html`
          <sp-picker
            size="s"
            value=${currentValue !== undefined
              ? String(currentValue)
              : ps.default !== undefined
                ? String(ps.default)
                : "__none__"}
            @change=${(/** @type {any} */ e) =>
              update(
                updateDef(S, name, {
                  [prop]: e.target.value === "__none__" ? undefined : e.target.value,
                }),
              )}
          >
            ${!required.has(prop) ? html`<sp-menu-item value="__none__">—</sp-menu-item>` : nothing}
            ${ps.enum.map(
              (/** @type {any} */ val) => html`<sp-menu-item value=${val}>${val}</sp-menu-item>`,
            )}
          </sp-picker>
        `;
      } else if (ps.type === "boolean") {
        control = html`<sp-checkbox
          ?checked=${currentValue ?? ps.default ?? false}
          @change=${(/** @type {any} */ e) =>
            update(updateDef(S, name, { [prop]: e.target.checked }))}
        ></sp-checkbox>`;
      } else if (ps.type === "integer" || ps.type === "number") {
        /** @type {any} */
        let debounce;
        control = html`<sp-number-field
          size="s"
          min=${ps.minimum !== undefined ? ps.minimum : nothing}
          max=${ps.maximum !== undefined ? ps.maximum : nothing}
          step=${ps.type === "integer" ? "1" : nothing}
          .value=${currentValue !== undefined ? currentValue : nothing}
          placeholder=${ps.default !== undefined ? String(ps.default) : nothing}
          @change=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              const parsed =
                ps.type === "integer" ? parseInt(e.target.value, 10) : parseFloat(e.target.value);
              update(updateDef(S, name, { [prop]: isNaN(parsed) ? undefined : parsed }));
            }, 400);
          }}
        ></sp-number-field>`;
      } else if (ps.format === "json-schema") {
        const hasValue =
          currentValue && typeof currentValue === "object" && Object.keys(currentValue).length > 0;
        const isRef = currentValue && typeof currentValue === "object" && currentValue.$ref;
        /** @type {any} */
        let debounce;
        control = html`
          <div class="schema-param-editor">
            ${hasValue && !isRef && currentValue.properties
              ? html`
                  <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:4px">
                    ${Object.entries(currentValue.properties).map(
                      ([k, v]) => html`
                        <span
                          style="background:var(--bg-alt);padding:1px 6px;border-radius:3px;font-size:10px;color:var(--fg-dim)"
                          >${k}: ${v.type ?? "any"}</span
                        >
                      `,
                    )}
                  </div>
                `
              : nothing}
            <sp-textfield
              multiline
              size="s"
              style="min-height:${hasValue ? "80px" : "40px"};font-family:monospace;font-size:11px"
              .value=${currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : ""}
              placeholder=${ps.description ?? "JSON Schema defining the data shape\u2026"}
              @input=${(/** @type {any} */ e) => {
                clearTimeout(debounce);
                debounce = setTimeout(() => {
                  try {
                    update(updateDef(S, name, { [prop]: JSON.parse(e.target.value) }));
                  } catch {}
                }, 500);
              }}
            ></sp-textfield>
          </div>
        `;
      } else if (ps.type === "array" || ps.type === "object") {
        /** @type {any} */
        let debounce;
        control = html`<sp-textfield
          multiline
          size="s"
          style="min-height:40px"
          .value=${currentValue !== undefined ? JSON.stringify(currentValue, null, 2) : ""}
          placeholder=${ps.default !== undefined ? JSON.stringify(ps.default) : nothing}
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(() => {
              try {
                update(updateDef(S, name, { [prop]: JSON.parse(e.target.value) }));
              } catch {}
            }, 500);
          }}
        ></sp-textfield>`;
      } else {
        /** @type {any} */
        let debounce;
        const ph = ps.default !== undefined ? String(ps.default) : (ps.examples?.[0] ?? "");
        control = html`<sp-textfield
          size="s"
          .value=${currentValue ?? ""}
          placeholder=${ph || nothing}
          title=${ps.description || nothing}
          @input=${(/** @type {any} */ e) => {
            clearTimeout(debounce);
            debounce = setTimeout(
              () => update(updateDef(S, name, { [prop]: e.target.value || undefined })),
              400,
            );
          }}
        ></sp-textfield>`;
      }

      return html`
        <div class="field-row">
          <sp-field-label size="s" title=${ps.description || nothing}>${labelText}</sp-field-label>
          ${control}
        </div>
      `;
    });
}

/**
 * Render editor fields for an external $prototype + $src plugin. Shows $src/$export inputs plus
 * schema-driven config fields.
 */
export function renderExternalPrototypeEditorTemplate(
  /** @type {any} */ S,
  /** @type {any} */ name,
  /** @type {any} */ def,
  /** @type {{ renderLeftPanel: Function; renderCanvas: Function }} */ ctx,
) {
  // Schema-driven config fields (async with cache)
  /** @type {any} */
  let schemaContent = nothing;
  if (def.$src && def.$prototype) {
    const cacheKey = `${def.$src}::${def.$prototype}`;
    if (pluginSchemaCache.has(cacheKey)) {
      const schema = pluginSchemaCache.get(cacheKey);
      if (schema) {
        schemaContent = html`
          ${schema.description
            ? html`<div class="signal-hint" style="padding:4px 0 8px">${schema.description}</div>`
            : nothing}
          ${renderSchemaFieldsTemplate(schema, def, name, S)}
        `;
      }
    } else {
      // Trigger async load — will re-render when cached
      schemaContent = html`<div
        style="padding:4px 0;font-size:11px;color:var(--fg-dim);font-style:italic"
      >
        Loading schema…
      </div>`;
      fetchPluginSchema(def, S).then((schema) => {
        if (schema) ctx.renderLeftPanel();
      });
    }
  }

  return html`
    ${signalFieldRow("$src", def.$src || "", (/** @type {any} */ v) => {
      update(updateDef(S, name, { $src: v || undefined }));
      pluginSchemaCache.delete(`${v}::${def.$prototype}`);
    })}
    ${signalFieldRow("$prototype", def.$prototype || "", (/** @type {any} */ v) => {
      update(updateDef(S, name, { $prototype: v || undefined }));
      pluginSchemaCache.delete(`${def.$src}::${v}`);
    })}
    ${def.$export
      ? signalFieldRow("$export", def.$export || "", (/** @type {any} */ v) =>
          update(updateDef(S, name, { $export: v || undefined })),
        )
      : nothing}
    ${schemaContent}
  `;
}
