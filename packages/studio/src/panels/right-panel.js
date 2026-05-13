/**
 * Right panel — orchestrates Properties / Events / Style tabs. The heavy sub-templates
 * (propertiesSidebarTemplate, renderStylePanelTemplate) remain in studio.js and are passed via ctx
 * to avoid moving ~2000 lines in one step.
 */

import { html, render as litRender, nothing } from "lit-html";
import { getState, updateUi, rightPanel, subscribe } from "../store.js";
import { tabIcon } from "./activity-bar.js";
import { eventsSidebarTemplate } from "./events-panel.js";
import { isCustomElementDoc } from "./signals-panel.js";
import { ensureLitState } from "./shared.js";
import { isColorPopoverOpen } from "../ui/color-selector.js";

/** @type {any} */
let _ctx = null;

/** @type {(() => void) | null} */
let _unsub = null;

/**
 * Mount the right panel.
 *
 * @param {any} ctx — { propertiesSidebarTemplate, renderStylePanelTemplate, renderCanvas,
 *   updateForcedPseudoPreview }
 */
export function mount(ctx) {
  _ctx = ctx;
  _unsub = subscribe((change) => {
    if (!change.selection && !change.ui && !change.doc) return;

    const colorPopoverOpen = isColorPopoverOpen();
    const activeTag = document.activeElement?.tagName;
    const rightHasFocus =
      !colorPopoverOpen &&
      rightPanel.contains(document.activeElement) &&
      (activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeTag === "SP-TEXTFIELD" ||
        activeTag === "SP-NUMBER-FIELD" ||
        activeTag === "SP-PICKER" ||
        activeTag === "SP-COMBOBOX" ||
        activeTag === "SP-SEARCH");

    if (!rightHasFocus || change.selection || change.ui) {
      render();
    }
  });
}

export function unmount() {
  _unsub?.();
  _unsub = null;
  _ctx = null;
}

export function render() {
  if (!_ctx) return;
  try {
    ensureLitState(rightPanel);
    litRender(rightPanelTemplate(), rightPanel);
  } catch (e) {
    console.error("right-panel render error:", e);
    try {
      rightPanel.textContent = "";
      // @ts-ignore
      delete rightPanel["_$litPart$"];
      litRender(rightPanelTemplate(), rightPanel);
    } catch (e2) {
      console.error("right-panel retry failed:", e2);
    }
  }
  _ctx.updateForcedPseudoPreview();
}

function rightPanelTemplate() {
  const S = getState();
  const tab = S.ui.rightTab;

  const panelTabs = [
    { value: "properties", icon: "sp-icon-properties", label: "Properties" },
    { value: "events", icon: "sp-icon-event", label: "Events" },
    { value: "style", icon: "sp-icon-brush", label: "Style" },
  ];

  const tabsT = html`
    <div class="panel-tabs">
      <sp-tabs
        selected=${tab}
        quiet
        @change=${(/** @type {any} */ e) => {
          const sel = e.target.selected;
          if (sel && sel !== tab) {
            updateUi("rightTab", sel);
          }
        }}
      >
        ${panelTabs.map(
          (t) => html`
            <sp-tab value=${t.value} title=${t.label} aria-label=${t.label}>
              ${tabIcon(t.icon, "xs")}
            </sp-tab>
          `,
        )}
      </sp-tabs>
    </div>
  `;

  /** @type {any} */
  let bodyT = nothing;
  if (tab === "properties") {
    bodyT = _ctx.propertiesSidebarTemplate();
  } else if (tab === "events") {
    bodyT = eventsSidebarTemplate(S, {
      isCustomElementDoc: () => isCustomElementDoc(S),
      renderCanvas: _ctx.renderCanvas,
    });
  } else if (tab === "style") {
    try {
      bodyT = _ctx.renderStylePanelTemplate();
    } catch (/** @type {any} */ e) {
      console.error("[renderStylePanelTemplate]", e);
    }
  }

  return html`
    ${tabsT}
    <div class="panel-body">${bodyT}</div>
  `;
}
