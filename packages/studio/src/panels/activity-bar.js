/** Activity bar — tab icons for switching left panel views. */

import { html, render as litRender, nothing } from "lit-html";
import { activityBar, update, getState, renderOnly } from "../../store.js";

/**
 * @param {any} tag
 * @param {any} size
 */
export function tabIcon(tag, size) {
  /** @type {Record<string, any>} */
  const m = {
    "sp-icon-folder": (/** @type {any} */ s) =>
      html`<sp-icon-folder slot="icon" size=${s}></sp-icon-folder>`,
    "sp-icon-layers": (/** @type {any} */ s) =>
      html`<sp-icon-layers slot="icon" size=${s}></sp-icon-layers>`,
    "sp-icon-view-grid": (/** @type {any} */ s) =>
      html`<sp-icon-view-grid slot="icon" size=${s}></sp-icon-view-grid>`,
    "sp-icon-brackets": (/** @type {any} */ s) =>
      html`<sp-icon-brackets slot="icon" size=${s}></sp-icon-brackets>`,
    "sp-icon-data": (/** @type {any} */ s) =>
      html`<sp-icon-data slot="icon" size=${s}></sp-icon-data>`,
    "sp-icon-properties": (/** @type {any} */ s) =>
      html`<sp-icon-properties slot="icon" size=${s}></sp-icon-properties>`,
    "sp-icon-event": (/** @type {any} */ s) =>
      html`<sp-icon-event slot="icon" size=${s}></sp-icon-event>`,
    "sp-icon-brush": (/** @type {any} */ s) =>
      html`<sp-icon-brush slot="icon" size=${s}></sp-icon-brush>`,
    "sp-icon-artboard": (/** @type {any} */ s) =>
      html`<sp-icon-artboard slot="icon" size=${s}></sp-icon-artboard>`,
    "sp-icon-box": (/** @type {any} */ s) =>
      html`<sp-icon-box slot="icon" size=${s}></sp-icon-box>`,
  };
  const fn = m[tag];
  return fn ? fn(size || "s") : nothing;
}

/** @param {any} S — current studio state */
export function renderActivityBar(S) {
  const tabs = [
    { value: "files", icon: "sp-icon-folder", label: "Files" },
    { value: "layers", icon: "sp-icon-layers", label: "Layers" },
    { value: "components", icon: "sp-icon-box", label: "Components" },
    { value: "blocks", icon: "sp-icon-view-grid", label: "Blocks" },
    { value: "state", icon: "sp-icon-brackets", label: "State" },
    { value: "data", icon: "sp-icon-data", label: "Data" },
  ];
  const tpl = html`
    <sp-tabs
      selected=${S.ui.leftTab}
      direction="vertical"
      quiet
      @change=${(/** @type {any} */ e) => {
        const current = getState();
        update({ ...current, ui: { ...current.ui, leftTab: e.target.selected } });
        renderOnly("activityBar", "leftPanel");
      }}
    >
      ${tabs.map(
        (t) => html`
          <sp-tab value=${t.value} title=${t.label} aria-label=${t.label}>
            ${tabIcon(t.icon, "m")}
          </sp-tab>
        `,
      )}
    </sp-tabs>
  `;
  litRender(tpl, /** @type {any} */ (activityBar));
}
