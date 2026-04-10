/**
 * spectrum.js — Explicit Spectrum Web Component registration
 *
 * Bun's bundler tree-shakes bare side-effect imports (`import "..."`) because
 * the Spectrum `sp-*.js` entry files export nothing — they only call
 * `customElements.define()` as a side effect. To prevent the bundler from
 * dropping them, we import the class constructors and collect them into an
 * exported array that the main module references.
 */

import { Theme } from "@spectrum-web-components/theme/src/Theme.js";
import themeDarkCSS from "@spectrum-web-components/theme/src/theme-dark.css.js";
import scaleMediumCSS from "@spectrum-web-components/theme/src/scale-medium.css.js";
import { Tabs } from "@spectrum-web-components/tabs/src/Tabs.js";
import { Tab } from "@spectrum-web-components/tabs/src/Tab.js";
import { ActionButton } from "@spectrum-web-components/action-button/src/ActionButton.js";
import { ActionGroup } from "@spectrum-web-components/action-group/src/ActionGroup.js";
import { Search } from "@spectrum-web-components/search/src/Search.js";
import { Popover } from "@spectrum-web-components/popover/src/Popover.js";
import { Menu } from "@spectrum-web-components/menu/src/Menu.js";
import { MenuItem } from "@spectrum-web-components/menu/src/MenuItem.js";
import { MenuDivider } from "@spectrum-web-components/menu/src/MenuDivider.js";
import { Textfield } from "@spectrum-web-components/textfield/src/Textfield.js";
import { Swatch } from "@spectrum-web-components/swatch/src/Swatch.js";
import { ColorArea } from "@spectrum-web-components/color-area/src/ColorArea.js";
import { ColorSlider } from "@spectrum-web-components/color-slider/src/ColorSlider.js";
import { ColorHandle } from "@spectrum-web-components/color-handle/src/ColorHandle.js";
import { NumberField } from "@spectrum-web-components/number-field/src/NumberField.js";
import { Picker } from "@spectrum-web-components/picker/src/Picker.js";
import { FieldLabel } from "@spectrum-web-components/field-label/src/FieldLabel.js";

// Icons
import { IconFolder } from "@spectrum-web-components/icons-workflow/src/elements/IconFolder.js";
import { IconFolderOpen } from "@spectrum-web-components/icons-workflow/src/elements/IconFolderOpen.js";
import { IconDocument } from "@spectrum-web-components/icons-workflow/src/elements/IconDocument.js";
import { IconFileCode } from "@spectrum-web-components/icons-workflow/src/elements/IconFileCode.js";
import { IconFileTxt } from "@spectrum-web-components/icons-workflow/src/elements/IconFileTxt.js";
import { IconImage } from "@spectrum-web-components/icons-workflow/src/elements/IconImage.js";
import { IconRefresh } from "@spectrum-web-components/icons-workflow/src/elements/IconRefresh.js";
import { IconAdd } from "@spectrum-web-components/icons-workflow/src/elements/IconAdd.js";
import { IconLayers } from "@spectrum-web-components/icons-workflow/src/elements/IconLayers.js";
import { IconViewGrid } from "@spectrum-web-components/icons-workflow/src/elements/IconViewGrid.js";
import { IconBrackets } from "@spectrum-web-components/icons-workflow/src/elements/IconBrackets.js";
import { IconData } from "@spectrum-web-components/icons-workflow/src/elements/IconData.js";
import { IconChevronDown } from "@spectrum-web-components/icons-workflow/src/elements/IconChevronDown.js";
import { IconDelete } from "@spectrum-web-components/icons-workflow/src/elements/IconDelete.js";
import { IconClose } from "@spectrum-web-components/icons-workflow/src/elements/IconClose.js";

// Register all components. Using defineElement from Spectrum's base package
// ensures duplicate registration is handled gracefully.
import { defineElement } from "@spectrum-web-components/base/src/define-element.js";

const components = [
  ["sp-theme", Theme],
  ["sp-tabs", Tabs],
  ["sp-tab", Tab],
  ["sp-action-button", ActionButton],
  ["sp-action-group", ActionGroup],
  ["sp-search", Search],
  ["sp-popover", Popover],
  ["sp-menu", Menu],
  ["sp-menu-item", MenuItem],
  ["sp-menu-divider", MenuDivider],
  ["sp-textfield", Textfield],
  ["sp-swatch", Swatch],
  ["sp-color-area", ColorArea],
  ["sp-color-slider", ColorSlider],
  ["sp-color-handle", ColorHandle],
  ["sp-number-field", NumberField],
  ["sp-picker", Picker],
  ["sp-field-label", FieldLabel],
  ["sp-icon-folder", IconFolder],
  ["sp-icon-folder-open", IconFolderOpen],
  ["sp-icon-document", IconDocument],
  ["sp-icon-file-code", IconFileCode],
  ["sp-icon-file-txt", IconFileTxt],
  ["sp-icon-image", IconImage],
  ["sp-icon-refresh", IconRefresh],
  ["sp-icon-add", IconAdd],
  ["sp-icon-layers", IconLayers],
  ["sp-icon-view-grid", IconViewGrid],
  ["sp-icon-brackets", IconBrackets],
  ["sp-icon-data", IconData],
  ["sp-icon-chevron-down", IconChevronDown],
  ["sp-icon-delete", IconDelete],
  ["sp-icon-close", IconClose],
];

for (const [tag, ctor] of components) {
  if (!customElements.get(tag)) defineElement(tag, ctor);
}

// Register theme fragments (these are also side-effect-only in the original modules)
Theme.registerThemeFragment("dark", "color", themeDarkCSS);
Theme.registerThemeFragment("medium", "scale", scaleMediumCSS);

export { components };
