/**
 * Collections Editor — visual schema builder for project content collections.
 *
 * Renders inside the Settings view "Collections" tab. Two-column layout: left column lists
 * collection names, right column edits the selected collection's schema.
 */

import { html, render as litRender } from "lit-html";
import { getPlatform } from "../platform.js";
import { projectState } from "../store.js";
import { fieldCardTpl, addFieldFormTpl, schemaForType } from "./schema-field-ui.js";

// ─── Module state ─────────────────────────────────────────────────────────────

/** @type {string | null} */
let selectedCollection = null;
let showAddField = false;
let newFieldState = { name: "", type: "string", required: false };
let showNewCollection = false;
let newCollectionName = "";

// ─── Persistence ──────────────────────────────────────────────────────────────

async function saveProjectConfig() {
  const platform = getPlatform();
  const config = /** @type {any} */ (projectState).projectConfig;
  await platform.writeFile("project.json", JSON.stringify(config, null, "\t"));
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** @param {() => void} rerender */
function handleNewCollection(rerender) {
  const slug = newCollectionName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  if (!slug) return;

  const config = projectState?.projectConfig;
  if (!config) return;
  if (!config.collections) config.collections = {};
  if (config.collections[slug]) return; // already exists

  config.collections[slug] = {
    source: `./${slug}/**/*.md`,
    schema: { type: "object", properties: {}, required: [] },
  };

  selectedCollection = slug;
  showNewCollection = false;
  newCollectionName = "";
  rerender();

  // Persist in background
  saveProjectConfig().then(async () => {
    const platform = getPlatform();
    await platform.writeFile(`${slug}/.gitkeep`, "");
  });
}

/** @param {() => void} rerender */
function handleAddField(rerender) {
  const name = newFieldState.name.trim();
  if (!name || !selectedCollection) return;

  const config = projectState?.projectConfig;
  const col = config?.collections?.[selectedCollection];
  if (!col?.schema) return;

  if (!col.schema.properties) col.schema.properties = {};
  col.schema.properties[name] = schemaForType(newFieldState.type);

  if (newFieldState.required) {
    if (!col.schema.required) col.schema.required = [];
    if (!col.schema.required.includes(name)) col.schema.required.push(name);
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
  if (!selectedCollection) return;
  const config = projectState?.projectConfig;
  const col = config?.collections?.[selectedCollection];
  if (!col?.schema?.properties) return;

  delete col.schema.properties[fieldName];
  if (col.schema.required) {
    col.schema.required = col.schema.required.filter((/** @type {string} */ r) => r !== fieldName);
  }

  rerender();
  saveProjectConfig();
}

/**
 * @param {string} fieldName
 * @param {() => void} rerender
 */
function handleToggleRequired(fieldName, rerender) {
  if (!selectedCollection) return;
  const config = projectState?.projectConfig;
  const col = config?.collections?.[selectedCollection];
  if (!col?.schema) return;
  if (!col.schema.required) col.schema.required = [];

  const idx = col.schema.required.indexOf(fieldName);
  if (idx >= 0) col.schema.required.splice(idx, 1);
  else col.schema.required.push(fieldName);

  rerender();
  saveProjectConfig();
}

/** @param {() => void} rerender */
function handleDeleteCollection(rerender) {
  if (!selectedCollection) return;
  const config = projectState?.projectConfig;
  if (!config?.collections?.[selectedCollection]) return;

  delete config.collections[selectedCollection];
  selectedCollection = null;

  rerender();
  saveProjectConfig();
}

// ─── Render ───────────────────────────────────────────────────────────────────

/**
 * Render the collections editor.
 *
 * @param {HTMLElement} container
 */
export function renderCollectionsEditor(container) {
  const rerender = () => renderCollectionsEditor(container);
  const config = projectState?.projectConfig;
  const collections = config?.collections || {};
  const collectionNames = Object.keys(collections);

  // Left column — collection list
  const listTpl = html`
    <div class="settings-list-panel">
      ${collectionNames.map(
        (name) => html`
          <sp-action-button
            size="s"
            ?selected=${selectedCollection === name}
            @click=${() => {
              selectedCollection = name;
              showAddField = false;
              rerender();
            }}
          >
            ${name}
          </sp-action-button>
        `,
      )}
      ${showNewCollection
        ? html`
            <div class="settings-inline-form">
              <sp-textfield
                size="s"
                placeholder="collection-name"
                .value=${newCollectionName}
                @input=${(/** @type {any} */ e) => {
                  newCollectionName = e.target.value;
                }}
                @keydown=${(/** @type {any} */ e) => {
                  if (e.key === "Enter") handleNewCollection(rerender);
                  if (e.key === "Escape") {
                    showNewCollection = false;
                    rerender();
                  }
                }}
              ></sp-textfield>
              <sp-action-button size="s" @click=${() => handleNewCollection(rerender)}>
                Create
              </sp-action-button>
            </div>
          `
        : html`
            <sp-action-button
              size="s"
              quiet
              @click=${() => {
                showNewCollection = true;
                rerender();
              }}
            >
              <sp-icon-add slot="icon"></sp-icon-add> New Collection
            </sp-action-button>
          `}
    </div>
  `;

  // Right column — schema editor
  let editorTpl;
  if (!selectedCollection || !collections[selectedCollection]) {
    editorTpl = html`<div class="settings-empty-state">Select or create a collection</div>`;
  } else {
    const col = collections[selectedCollection];
    const schema = col.schema || {};
    const properties = schema.properties || {};
    const required = schema.required || [];

    const fieldCards = Object.entries(properties).map(([name, def]) =>
      fieldCardTpl(name, /** @type {any} */ (def), required.includes(name), {
        onDelete: (n) => handleDeleteField(n, rerender),
        onToggleRequired: (n) => handleToggleRequired(n, rerender),
      }),
    );

    editorTpl = html`
      <div class="settings-editor-panel">
        <div class="settings-editor-header">
          <h3>${selectedCollection}</h3>
          <sp-field-label size="s">Source: ${col.source || "—"}</sp-field-label>
          <sp-action-button
            size="xs"
            quiet
            title="Delete collection"
            @click=${() => handleDeleteCollection(rerender)}
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
