/**
 * Schema field UI — shared field-card and add-field-dialog templates for the collections and
 * definitions editors.
 */

import { html, nothing } from "lit-html";

export const FIELD_TYPES = ["string", "number", "boolean", "array", "object", "date"];

/**
 * @typedef {{
 *   type?: string;
 *   properties?: Record<string, SchemaProperty>;
 *   required?: string[];
 *   items?: any;
 *   format?: string;
 * }} SchemaProperty
 */

/**
 * Render a single schema field as a compact row card.
 *
 * @param {string} fieldName
 * @param {SchemaProperty} fieldSchema — JSON Schema property definition
 * @param {boolean} isRequired
 * @param {{ onDelete: (name: string) => void; onToggleRequired: (name: string) => void }} handlers
 * @returns {any}
 */
export function fieldCardTpl(fieldName, fieldSchema, isRequired, handlers) {
  const type = fieldSchema.type || "string";
  const isNested = type === "object" && fieldSchema.properties;

  return html`
    <div class="schema-field-card">
      <div class="schema-field-row">
        <span class="schema-field-name">${fieldName}</span>
        <span class="schema-field-type">${type}</span>
        ${isRequired ? html`<span class="schema-field-required">required</span>` : nothing}
        <sp-action-button
          size="xs"
          quiet
          title="Toggle required"
          @click=${() => handlers.onToggleRequired(fieldName)}
        >
          ${isRequired ? "★" : "☆"}
        </sp-action-button>
        <sp-action-button
          size="xs"
          quiet
          title="Delete field"
          @click=${() => handlers.onDelete(fieldName)}
        >
          <sp-icon-delete slot="icon"></sp-icon-delete>
        </sp-action-button>
      </div>
      ${isNested && fieldSchema.properties
        ? html`
            <div class="schema-field-nested">
              ${Object.entries(fieldSchema.properties).map(([name, sub]) =>
                fieldCardTpl(name, sub, (fieldSchema.required || []).includes(name), handlers),
              )}
            </div>
          `
        : nothing}
    </div>
  `;
}

/**
 * Render the type picker as an sp-picker dropdown.
 *
 * @param {string} value
 * @param {(type: string) => void} onChange
 * @returns {any}
 */
export function typePickerTpl(value, onChange) {
  return html`
    <sp-picker
      size="s"
      label="Type"
      value=${value}
      @change=${(/** @type {any} */ e) => onChange(e.target.value)}
    >
      ${FIELD_TYPES.map((t) => html`<sp-menu-item value=${t}>${t}</sp-menu-item>`)}
    </sp-picker>
  `;
}

/**
 * Render the add-field form (inline, not a dialog).
 *
 * @param {{ name: string; type: string; required: boolean }} state
 * @param {{
 *   onInput: (field: string, value: any) => void;
 *   onConfirm: () => void;
 *   onCancel: () => void;
 * }} handlers
 * @returns {any}
 */
export function addFieldFormTpl(state, handlers) {
  return html`
    <div class="schema-add-field">
      <sp-textfield
        size="s"
        placeholder="Field name"
        .value=${state.name}
        @input=${(/** @type {any} */ e) => handlers.onInput("name", e.target.value)}
      ></sp-textfield>
      ${typePickerTpl(state.type, (t) => handlers.onInput("type", t))}
      <sp-switch
        size="s"
        ?checked=${state.required}
        @change=${(/** @type {any} */ e) => handlers.onInput("required", e.target.checked)}
      >
        Required
      </sp-switch>
      <sp-action-button size="s" @click=${handlers.onConfirm}>Add</sp-action-button>
      <sp-action-button size="s" quiet @click=${handlers.onCancel}>Cancel</sp-action-button>
    </div>
  `;
}

/**
 * Build a JSON Schema property definition from a type string.
 *
 * @param {string} type
 * @returns {object}
 */
export function schemaForType(type) {
  switch (type) {
    case "number":
      return { type: "number" };
    case "boolean":
      return { type: "boolean" };
    case "array":
      return { type: "array", items: { type: "string" } };
    case "object":
      return { type: "object", properties: {}, required: [] };
    case "date":
      return { type: "string", format: "date" };
    default:
      return { type: "string" };
  }
}

/**
 * Generate a YAML frontmatter default value for a given schema type.
 *
 * @param {string} type
 * @param {string} [format]
 * @returns {string}
 */
export function yamlDefault(type, format) {
  if (format === "date") return new Date().toISOString().split("T")[0];
  switch (type) {
    case "boolean":
      return "false";
    case "number":
      return "0";
    case "array":
      return "[]";
    case "object":
      return "{}";
    default:
      return '""';
  }
}
