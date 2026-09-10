/**
 * Spectrum.js — Explicit Spectrum Web Component registration
 *
 * Bun's bundler tree-shakes bare side-effect imports (`import "..."`) because the Spectrum
 * `sp-*.js` entry files export nothing — they only call `customElements.define()` as a side effect.
 * To prevent the bundler from dropping them, we import the class constructors and collect them into
 * an exported array that the main module references.
 */

import { Theme } from "@spectrum-web-components/theme/src/Theme.js";
import themeSpectrumCSS from "@spectrum-web-components/theme/src/theme.css.js";
import themeDarkCSS from "@spectrum-web-components/theme/src/theme-dark.css.js";
import themeLightCSS from "@spectrum-web-components/theme/src/theme-light.css.js";
import scaleMediumCSS from "@spectrum-web-components/theme/src/scale-medium.css.js";
import { jxTheme } from "./jx-theme";
import { Tabs } from "@spectrum-web-components/tabs/src/Tabs.js";
import { Tab } from "@spectrum-web-components/tabs/src/Tab.js";
import { TabPanel } from "@spectrum-web-components/tabs/src/TabPanel.js";
import { ActionButton } from "@spectrum-web-components/action-button/src/ActionButton.js";
import { ActionGroup } from "@spectrum-web-components/action-group/src/ActionGroup.js";
import { Search } from "@spectrum-web-components/search/src/Search.js";
import { Popover } from "@spectrum-web-components/popover/src/Popover.js";
import { Menu } from "@spectrum-web-components/menu/src/Menu.js";
import { MenuItem } from "@spectrum-web-components/menu/src/MenuItem.js";
import { MenuDivider } from "@spectrum-web-components/menu/src/MenuDivider.js";
import { MenuGroup } from "@spectrum-web-components/menu/src/MenuGroup.js";
import { Textfield } from "@spectrum-web-components/textfield/src/Textfield.js";
import { Swatch } from "@spectrum-web-components/swatch/src/Swatch.js";
import { SwatchGroup } from "@spectrum-web-components/swatch/src/SwatchGroup.js";
import { ColorArea } from "@spectrum-web-components/color-area/src/ColorArea.js";
import { ColorSlider } from "@spectrum-web-components/color-slider/src/ColorSlider.js";
import { ColorHandle } from "@spectrum-web-components/color-handle/src/ColorHandle.js";
import { NumberField } from "@spectrum-web-components/number-field/src/NumberField.js";
import { Picker } from "@spectrum-web-components/picker/src/Picker.js";
import { Combobox } from "@spectrum-web-components/combobox/src/Combobox.js";
import { FieldLabel } from "@spectrum-web-components/field-label/src/FieldLabel.js";
import { Checkbox } from "@spectrum-web-components/checkbox/src/Checkbox.js";
import { Switch as SpSwitch } from "@spectrum-web-components/switch/src/Switch.js";
import { Divider } from "@spectrum-web-components/divider/src/Divider.js";
/* SIDE-EFFECT IMPORT, deliberately unlike every other row in this file.
   Registering `sp-tooltip` ourselves from the class-only module made Studio the first definer, and
   the package's OWN registering entry is reached later by a dynamic import (the textfield's
   truncated-value controller) — which then calls `customElements.define` for a name we already
   took, and throws `NotSupportedError` in the console during ordinary panel use. Our loop's
   `customElements.get` guard cannot help: the second define is Spectrum's own call inside
   node_modules. The tooltip package declares `sideEffects: ["./sp-*.js", …]`, so this import
   survives bundling, and putting Spectrum's module in the static graph makes it the single definer
   while the later dynamic import hits the module cache. */
import "@spectrum-web-components/tooltip/sp-tooltip.js";
import { Overlay } from "@spectrum-web-components/overlay/src/Overlay.js";
import { OverlayTrigger } from "@spectrum-web-components/overlay/src/OverlayTrigger.js";
import { Dialog } from "@spectrum-web-components/dialog/src/Dialog.js";
import { DialogWrapper } from "@spectrum-web-components/dialog/src/DialogWrapper.js";
import { HelpText } from "@spectrum-web-components/help-text/src/HelpText.js";
import { Button } from "@spectrum-web-components/button/src/Button.js";
import { Underlay } from "@spectrum-web-components/underlay/src/Underlay.js";
import { PickerButton } from "@spectrum-web-components/picker-button/src/PickerButton.js";
import { Accordion } from "@spectrum-web-components/accordion/src/Accordion.js";
import { AccordionItem } from "@spectrum-web-components/accordion/src/AccordionItem.js";
import { ActionBar } from "@spectrum-web-components/action-bar/src/ActionBar.js";
import { Toast } from "@spectrum-web-components/toast/src/Toast.js";
import { ProgressCircle } from "@spectrum-web-components/progress-circle/src/ProgressCircle.js";
import { Table } from "@spectrum-web-components/table/src/Table.js";
import { TableHead } from "@spectrum-web-components/table/src/TableHead.js";
import { TableHeadCell } from "@spectrum-web-components/table/src/TableHeadCell.js";
import { TableBody } from "@spectrum-web-components/table/src/TableBody.js";
import { TableRow } from "@spectrum-web-components/table/src/TableRow.js";
import { TableCell } from "@spectrum-web-components/table/src/TableCell.js";

// Icons
import { IconFileSingleWebPage } from "@spectrum-web-components/icons-workflow/src/elements/IconFileSingleWebPage.js";
import { IconCopy } from "@spectrum-web-components/icons-workflow/src/elements/IconCopy.js";
import { IconPreview } from "@spectrum-web-components/icons-workflow/src/elements/IconPreview.js";
import { IconBrush } from "@spectrum-web-components/icons-workflow/src/elements/IconBrush.js";
import { IconInfo } from "@spectrum-web-components/icons-workflow/src/elements/IconInfo.js";
import { IconProperties } from "@spectrum-web-components/icons-workflow/src/elements/IconProperties.js";

// Layout / alignment icons
import { IconDistributeSpaceVert } from "@spectrum-web-components/icons-workflow/src/elements/IconDistributeSpaceVert.js";
import { IconDistributeBottomEdge } from "@spectrum-web-components/icons-workflow/src/elements/IconDistributeBottomEdge.js";
import { IconDistributeTopEdge } from "@spectrum-web-components/icons-workflow/src/elements/IconDistributeTopEdge.js";
import { IconFullScreen } from "@spectrum-web-components/icons-workflow/src/elements/IconFullScreen.js";
import { IconVisibility } from "@spectrum-web-components/icons-workflow/src/elements/IconVisibility.js";
import { IconArtboard } from "@spectrum-web-components/icons-workflow/src/elements/IconArtboard.js";
import { IconChat } from "@spectrum-web-components/icons-workflow/src/elements/IconChat.js";
import { IconViewList } from "@spectrum-web-components/icons-workflow/src/elements/IconViewList.js";

// Inline formatting icons
import { IconCheckmark } from "@spectrum-web-components/icons-workflow/src/elements/IconCheckmark.js";

// Custom studio components
import { JxValueSelector } from "./value-selector";

// UI icons (used internally by Spectrum components like accordion, picker, combobox)
import { IconChevron100 } from "@spectrum-web-components/icons-ui/src/elements/IconChevron100.js";

// Register all components. Using defineElement from Spectrum's base package
// Ensures duplicate registration is handled gracefully.
import { defineElement } from "@spectrum-web-components/base/src/define-element.js";

const components = [
  ["sp-theme", Theme],
  ["sp-tabs", Tabs],
  ["sp-tab", Tab],
  ["sp-tab-panel", TabPanel],
  ["sp-action-button", ActionButton],
  ["sp-action-group", ActionGroup],
  ["sp-search", Search],
  ["sp-popover", Popover],
  ["sp-menu", Menu],
  ["sp-menu-item", MenuItem],
  ["sp-menu-divider", MenuDivider],
  ["sp-menu-group", MenuGroup],
  ["sp-textfield", Textfield],
  ["sp-swatch", Swatch],
  ["sp-swatch-group", SwatchGroup],
  ["sp-color-area", ColorArea],
  ["sp-color-slider", ColorSlider],
  ["sp-color-handle", ColorHandle],
  ["sp-number-field", NumberField],
  ["sp-picker", Picker],
  ["sp-combobox", Combobox],
  ["sp-field-label", FieldLabel],
  ["sp-checkbox", Checkbox],
  ["sp-switch", SpSwitch],
  ["sp-divider", Divider],
  ["sp-overlay", Overlay],
  ["overlay-trigger", OverlayTrigger],
  ["sp-dialog", Dialog],
  ["sp-dialog-wrapper", DialogWrapper],
  ["sp-help-text", HelpText],
  ["sp-button", Button],
  ["sp-underlay", Underlay],
  ["sp-picker-button", PickerButton],
  ["sp-accordion", Accordion],
  ["sp-accordion-item", AccordionItem],
  ["sp-action-bar", ActionBar],
  ["sp-toast", Toast],
  ["sp-progress-circle", ProgressCircle],
  ["sp-table", Table],
  ["sp-table-head", TableHead],
  ["sp-table-head-cell", TableHeadCell],
  ["sp-table-body", TableBody],
  ["sp-table-row", TableRow],
  ["sp-table-cell", TableCell],
  ["sp-icon-file-single-web-page", IconFileSingleWebPage],
  ["sp-icon-copy", IconCopy],
  ["sp-icon-preview", IconPreview],
  ["sp-icon-brush", IconBrush],
  ["sp-icon-info", IconInfo],
  ["sp-icon-properties", IconProperties],
  ["sp-icon-distribute-space-vert", IconDistributeSpaceVert],
  ["sp-icon-distribute-bottom-edge", IconDistributeBottomEdge],
  ["sp-icon-distribute-top-edge", IconDistributeTopEdge],
  ["sp-icon-full-screen", IconFullScreen],
  ["sp-icon-checkmark", IconCheckmark],
  ["sp-icon-visibility", IconVisibility],
  ["sp-icon-artboard", IconArtboard],
  ["sp-icon-chat", IconChat],
  ["sp-icon-view-list", IconViewList],
  // UI icons (internal component chrome)
  ["sp-icon-chevron100", IconChevron100],
  // Custom studio components
  ["jx-value-selector", JxValueSelector],
];

for (const [tag, ctor] of components as [string, CustomElementConstructor][]) {
  if (!customElements.get(tag)) {
    defineElement(tag, ctor);
  }
}

/* Register theme fragments (these are also side-effect-only in the original modules).

   BOTH colour fragments, because `<sp-theme color>` adopts the fragment REGISTERED UNDER THAT NAME
   and silently adopts none when the name is unknown. Only "dark" was registered here, so
   Preferences → Appearance → Light set a valid attribute onto a theme that had no light stops:
   every `--spectrum-*` colour token went undefined at once, the studio semantic layer in
   `styles/tokens.css` collapsed to its dark hex fallbacks, and the chrome did not change. Spectrum
   itself said so — "you have set color='light' but the associated system fragment has not been
   loaded" — into a console nobody was reading. A colour declared in `CHROME_THEMES` must have its
   fragment registered here. */
Theme.registerThemeFragment("spectrum", "system", themeSpectrumCSS);
Theme.registerThemeFragment("dark", "color", themeDarkCSS);
Theme.registerThemeFragment("light", "color", themeLightCSS);
Theme.registerThemeFragment("medium", "scale", scaleMediumCSS);
/* Jx brand overrides. The 'app' kind must be registered under the literal
   name "app" and, registered last, is adopted after the fragments above so
   its :host declarations win the cascade (see src/ui/jx-theme.ts). */
Theme.registerThemeFragment("app", "app", jxTheme);

export { components };
