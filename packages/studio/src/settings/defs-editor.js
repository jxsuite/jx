/**
 * Definitions Editor — visual editor for project-level $defs (JSON Schema type definitions).
 *
 * Manages entries in project.json `$defs` — reusable type schemas for external datasets, API
 * responses, CMS payloads, etc. Same concept as component-level $defs but scoped to the entire
 * project.
 */

import { html, render as litRender } from "lit-html";
import { getPlatform } from "../platform.js";
import { projectState } from "../store.js";
import { fieldCardTpl, addFieldFormTpl, schemaForType } from "./schema-field-ui.js";

// ─── Module state ─────────────────────────────────────────────────────────────

/** @type {string | null} */
let selectedDef = null;
let showAddField = false;
let newFieldState = { name: "", type: "string", required: false };
let showNewDef = false;
let newDefName = "";

// ─── Persistence ──────────────────────────────────────────────────────────────

async function saveProjectConfig() {
  const platform = getPlatform();
  const config = /** @type {any} */ (projectState).projectConfig;
  await platform.writeFile("project.json", JSON.stringify(config, null, "\t"));
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** @param {() => void} rerender */
function handleNewDef(rerender) {
  const name = newDefName.trim();
  if (!name) return;

  const config = projectState?.projectConfig;
  if (!config) return;
  if (!config.$defs) config.$defs = {};
  if (config.$defs[name]) return; // already exists

  config.$defs[name] = {
    type: "object",
    properties: {},
    required: [],
  };

  selectedDef = name;
  showNewDef = false;
  newDefName = "";
  rerender();
  saveProjectConfig();
}

/** @param {() => void} rerender */
function handleAddField(rerender) {
  const name = newFieldState.name.trim();
  if (!name || !selectedDef) return;

  const config = projectState?.projectConfig;
  const def = config?.$defs?.[selectedDef];
  if (!def) return;

  if (!def.properties) def.properties = {};
  def.properties[name] = schemaForType(newFieldState.type);

  if (newFieldState.required) {
    if (!def.required) def.required = [];
    if (!def.required.includes(name)) def.required.push(name);
  }

  showAddField = false;
  newFieldState = { name: "", type: "string", required: false };
  rerender();
  saveProjectConfig();
}

/**
 * @param {string} fieldName
 * @param {() => void} rerender
 */
function handleDeleteField(fieldName, rerender) {
  if (!selectedDef) return;
  const config = projectState?.projectConfig;
  const def = config?.$defs?.[selectedDef];
  if (!def?.properties) return;

  delete def.properties[fieldName];
  if (def.required) {
    def.required = def.required.filter((/** @type {string} */ r) => r !== fieldName);
  }

  rerender();
  saveProjectConfig();
}

/**
 * @param {string} fieldName
 * @param {() => void} rerender
 */
function handleToggleRequired(fieldName, rerender) {
  if (!selectedDef) return;
  const config = projectState?.projectConfig;
  const def = config?.$defs?.[selectedDef];
  if (!def) return;
  if (!def.required) def.required = [];

  const idx = def.required.indexOf(fieldName);
  if (idx >= 0) def.required.splice(idx, 1);
  else def.required.push(fieldName);

  rerender();
  saveProjectConfig();
}

/** @param {() => void} rerender */
function handleDeleteDef(rerender) {
  if (!selectedDef) return;
  const config = projectState?.projectConfig;
  if (!config?.$defs?.[selectedDef]) return;

  delete config.$defs[selectedDef];
  selectedDef = null;

  rerender();
  saveProjectConfig();
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render the definitions editor.
 *
 * @param {HTMLElement} container
 */
export function renderDefsEditor(container) {
  const rerender = () => renderDefsEditor(container);
  const config = projectState?.projectConfig;
  const defs = config?.$defs || {};
  const defNames = Object.keys(defs);

  // Left column — def list
  const listTpl = html`
    <div class="settings-list-panel">
      ${defNames.map(
        (name) => html`
          <sp-action-button
            size="s"
            ?selected=${selectedDef === name}
            @click=${() => {
              selectedDef = name;
              showAddField = false;
              rerender();
            }}
          >
            ${name}
          </sp-action-button>
        `,
      )}
      ${showNewDef
        ? html`
            <div class="settings-inline-form">
              <sp-textfield
                size="s"
                placeholder="TypeName"
                .value=${newDefName}
                @input=${(/** @type {any} */ e) => {
                  newDefName = e.target.value;
                }}
                @keydown=${(/** @type {any} */ e) => {
                  if (e.key === "Enter") handleNewDef(rerender);
                  if (e.key === "Escape") {
                    showNewDef = false;
                    rerender();
                  }
                }}
              ></sp-textfield>
              <sp-action-button size="s" @click=${() => handleNewDef(rerender)}>
                Create
              </sp-action-button>
            </div>
          `
        : html`
            <sp-action-button
              size="s"
              quiet
              @click=${() => {
                showNewDef = true;
                rerender();
              }}
            >
              <sp-icon-add slot="icon"></sp-icon-add> New Definition
            </sp-action-button>
          `}
    </div>
  `;

  // Right column — schema editor
  let editorTpl;
  if (!selectedDef || !defs[selectedDef]) {
    editorTpl = html`<div class="settings-empty-state">Select or create a type definition</div>`;
  } else {
    const def = defs[selectedDef];
    const properties = def.properties || {};
    const required = def.required || [];

    const fieldCards = Object.entries(properties).map(([name, fieldDef]) =>
      fieldCardTpl(name, /** @type {any} */ (fieldDef), required.includes(name), {
        onDelete: (n) => handleDeleteField(n, rerender),
        onToggleRequired: (n) => handleToggleRequired(n, rerender),
      }),
    );

    editorTpl = html`
      <div class="settings-editor-panel">
        <div class="settings-editor-header">
          <h3>${selectedDef}</h3>
          <sp-action-button
            size="xs"
            quiet
            title="Delete definition"
            @click=${() => handleDeleteDef(rerender)}
          >
            <sp-icon-delete slot="icon"></sp-icon-delete>
          </sp-action-button>
        </div>
        <div class="schema-field-list">${fieldCards}</div>
        ${showAddField
          ? addFieldFormTpl(newFieldState, {
              onInput: (field, value) => {
                newFieldState = { ...newFieldState, [field]: value };
                rerender();
              },
              onConfirm: () => handleAddField(rerender),
              onCancel: () => {
                showAddField = false;
                newFieldState = { name: "", type: "string", required: false };
                rerender();
              },
            })
          : html`
              <sp-action-button
                size="s"
                quiet
                @click=${() => {
                  showAddField = true;
                  rerender();
                }}
              >
                <sp-icon-add slot="icon"></sp-icon-add> Add Field
              </sp-action-button>
            `}
      </div>
    `;
  }

  const tpl = html` <div class="settings-two-col">${listTpl} ${editorTpl}</div> `;

  litRender(tpl, container);
}
