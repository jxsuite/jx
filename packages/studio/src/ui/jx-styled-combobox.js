/**
 * Jx-styled-combobox — Dual-mode styled combobox custom element.
 *
 * Renders as sp-picker when the current value matches a predefined option, or as a textfield +
 * dropdown overlay (manual combobox) when it doesn't. Both modes share identical styled menu items,
 * ensuring visual consistency.
 *
 * Usage: html`<jx-styled-combobox size="s" .value=${"italic"} placeholder="normal" .options=${[{
 * value: "italic", label: "Italic", style: "font-style: italic" }]} @change=${handler}
 * @input=${handler}
 *
 * > </jx-styled-combobox>`
 *
 * Options format: { value: string, label: string, style?: string } — menu item { divider: true } —
 * menu divider
 */

import { LitElement, html } from "lit";
import { live } from "lit/directives/live.js";

/** @typedef {{ value: string; label: string; style?: string } | { divider: true }} ComboOption */

export class JxStyledCombobox extends LitElement {
  static properties = {
    value: { type: String },
    placeholder: { type: String },
    size: { type: String },
    options: { attribute: false },
  };

  constructor() {
    super();
    /** @type {string} */ this.value = "";
    /** @type {string} */ this.placeholder = "";
    /** @type {string} */ this.size = "s";
    /** @type {ComboOption[]} */ this.options = [];
    /** @type {string} */
    this._menuId = "jx-combo-" + Math.random().toString(36).slice(2, 8);
  }

  /** No shadow DOM — render directly into light DOM */
  createRenderRoot() {
    return this;
  }

  /** Check if current value matches a predefined option */
  get _isPicker() {
    return (
      !!this.value &&
      this.options.some((/** @type {any} */ o) => !o.divider && o.value === this.value)
    );
  }

  /** Get the selected option's style string for the picker button preview */
  get _selectedStyle() {
    if (!this._isPicker) return "";
    const opt = this.options.find((/** @type {any} */ o) => !o.divider && o.value === this.value);
    return /** @type {any} */ (opt)?.style || "";
  }

  /** Render menu items from options array */
  _renderMenuItems() {
    return this.options.map((/** @type {any} */ opt) =>
      opt.divider
        ? html`<sp-menu-divider></sp-menu-divider>`
        : html`<sp-menu-item value=${opt.value} style=${opt.style || ""}
            >${opt.label}</sp-menu-item
          >`,
    );
  }

  /** Picker mode: sp-picker @change handler */
  _handlePickerChange(/** @type {any} */ e) {
    e.stopPropagation(); // prevent sp-picker's raw event from reaching consumer
    this.value = e.target.value;
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  /** Combobox mode: sp-menu @change handler */
  _handleMenuChange(/** @type {any} */ e) {
    e.stopPropagation(); // prevent sp-menu's raw event from reaching consumer
    if (!e.target.value) return;
    this.value = e.target.value;
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  /** Combobox mode: textfield @input handler */
  _handleInput(/** @type {any} */ e) {
    e.stopPropagation(); // prevent sp-textfield's raw event from reaching consumer
    this.value = e.target.value;
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  /** Set popover min-width to match trigger width (replicates sp-picker behavior) */
  _setPopoverWidth(/** @type {any} */ e) {
    const group = this.querySelector(".jx-combobox-group");
    const w = group ? /** @type {HTMLElement} */ (group).offsetWidth : 0;
    const popover = e.target.querySelector("sp-popover");
    if (popover && w) popover.style.minWidth = `${w}px`;
  }

  render() {
    if (this._isPicker) {
      return html`
        <sp-picker
          class="jx-combobox-picker"
          size=${this.size}
          style=${this._selectedStyle}
          .value=${live(this.value)}
          @change=${this._handlePickerChange}
        >
          ${this._renderMenuItems()}
        </sp-picker>
      `;
    }

    return html`
      <div class="jx-combobox-group" id=${this._menuId}>
        <sp-textfield
          size=${this.size}
          placeholder=${this.placeholder}
          .value=${live(this.value || "")}
          @input=${this._handleInput}
          @click=${(/** @type {Event} */ e) => e.stopPropagation()}
        ></sp-textfield>
        <sp-picker-button size=${this.size}></sp-picker-button>
        <sp-overlay
          trigger="${this._menuId}@click"
          placement="bottom-start"
          type="auto"
          @sp-opened=${this._setPopoverWidth}
        >
          <sp-popover class="jx-combobox-popover">
            <sp-menu @change=${this._handleMenuChange}> ${this._renderMenuItems()} </sp-menu>
          </sp-popover>
        </sp-overlay>
      </div>
    `;
  }
}
