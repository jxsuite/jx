# Changelog

## 0.1.0 (2026-09-13)


### Features

* **runtime,schema,ui:** the seam schema-contained styling needs ([6efce33](https://github.com/jxsuite/jx/commit/6efce3320960037c5be88922b03466bbc5d10c00))
* **runtime,ui,studio:** the canvas loads kit behaviours lazily, and a kit save reaches every frame ([e91b660](https://github.com/jxsuite/jx/commit/e91b66089adb3eb18ce3d227900b5d0ff133196a))
* **schema,studio,compiler:** accessibility rules, judged alike by Studio, jx validate and the tests ([ad744dc](https://github.com/jxsuite/jx/commit/ad744dc84c017004a828b3da26977cf40f467d75))
* **studio,ui,runtime:** the Command Bar as a Jx document, closing the C2 surfaces ([da1fc54](https://github.com/jxsuite/jx/commit/da1fc54640b55bbd50873abae03d0b70c62a0413))
* **studio,ui:** the Navigator rail as a Jx surface, on stacked action buttons ([fa5697e](https://github.com/jxsuite/jx/commit/fa5697e848bf301e210224db4d092a9bd218ab2a))
* **studio,ui:** the settings menu on the menu surface, with a submenu level and live rows ([ab4b755](https://github.com/jxsuite/jx/commit/ab4b755a1640248d15151e3130632799783ce086))
* **studio,ui:** the three dock edges are jx-split, so a keyboard can size a dock ([302d756](https://github.com/jxsuite/jx/commit/302d7562e96a37be7da8dd60516ee8be30771354))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([a31f63e](https://github.com/jxsuite/jx/commit/a31f63e1b010e96434ee76b753f6c75a5d7ae2a5))
* **studio:** Adobe Spectrum is removed ([e24e0e8](https://github.com/jxsuite/jx/commit/e24e0e8b8cc8ce7ad3244af3ec47d69b10859cdd))
* **studio:** Studio edits its own chrome — a saved surface or kit component re-mounts the shell ([46cc18b](https://github.com/jxsuite/jx/commit/46cc18b7f60bf28d6698f52d877ab250a01e1314))
* **studio:** the confirm, save-or-discard and prompt dialogs as a Jx document over jx-dialog ([66d2ca4](https://github.com/jxsuite/jx/commit/66d2ca44e43628ad0776e901a473334fed0a9968))
* **studio:** the UI kit at boot, the surface façade, and the chrome's tokens aliased to the kit ([dd1e94e](https://github.com/jxsuite/jx/commit/dd1e94e558422d295092f01b343bb5b5c1dd9a6d))
* **ui,compiler,schema:** jx-popover, jx-tooltip and jx-spinner ([10f6703](https://github.com/jxsuite/jx/commit/10f67031ca0e4ff2c6189bcfee64093ba308d906))
* **ui,studio:** jx-menu and jx-menu-item, and the element context menu as the first Jx surface ([173cf17](https://github.com/jxsuite/jx/commit/173cf175d455565a36d837097a40bbe2aa40fe4c))
* **ui,studio:** jx-menu hangs from its button by anchor positioning, submenus beside their rows ([2364faa](https://github.com/jxsuite/jx/commit/2364faabf57b0d2e1eb59d6d2f4d7e6590b420f3))
* **ui,studio:** jx-tab takes slotted content, and the pane tab strip is a document ([60fe21f](https://github.com/jxsuite/jx/commit/60fe21f6e468d6ace5589159bdc5435fb0a739e0))
* **ui,studio:** jx-toolbar and jx-split, and a workaround for a limitation that never existed ([d04f6e4](https://github.com/jxsuite/jx/commit/d04f6e461697d0b8f42d1c40596b74aa71b7b337))
* **ui,studio:** jx-tree and jx-combobox, and the five surfaces that hand-rolled them ([9bca549](https://github.com/jxsuite/jx/commit/9bca5493ed58fc62a83ce31f46d6be7bc7904702))
* **ui,studio:** the Edit column, the colour well and the credentials form finish on the kit ([66e693f](https://github.com/jxsuite/jx/commit/66e693f6af7215c9e0be5502abf58a036fd26570))
* **ui,studio:** the kit has a colour family, and Studio's last Spectrum surface is a document ([c7427a6](https://github.com/jxsuite/jx/commit/c7427a6593a957fae05583a4f5c2b342053e0202))
* **ui,studio:** the Style tab's keyword rows are jx-combobox, and ui.md's principles have evidence ([2445df2](https://github.com/jxsuite/jx/commit/2445df2c8693b6ca1a794cef59af50100fee3fd7))
* **ui:** jx-button and jx-action-button ([28902c6](https://github.com/jxsuite/jx/commit/28902c62a436639d3922c897594e08b9ce638c64))
* **ui:** jx-checkbox, jx-switch and jx-number-field, and the field-row recipes ([dc40913](https://github.com/jxsuite/jx/commit/dc40913935c7ed2c4c85f24030beddee723864a1))
* **ui:** jx-dialog and jx-textfield ([940435a](https://github.com/jxsuite/jx/commit/940435a1caacde8869068b1310aa2b54f1b2b362))
* **ui:** jx-popover is placed by CSS anchor positioning against the platform's implicit anchor ([8f1a0b5](https://github.com/jxsuite/jx/commit/8f1a0b56049c9319d04c8bb5cabdec5ad0a72ae9))
* **ui:** jx-select is a native select, and the four rules a document must not write ([79e632c](https://github.com/jxsuite/jx/commit/79e632ccf6109138a2113a0b0013a6b4b970b8a8))
* **ui:** jx-tabs, jx-accordion-item and jx-action-group ([a87ce78](https://github.com/jxsuite/jx/commit/a87ce78bbfc8f58f5e2545aebe7444880bf69b42))
* **ui:** jx-tooltip hangs from its control by anchor positioning, the arrow following the flip ([fed3c7c](https://github.com/jxsuite/jx/commit/fed3c7c6f1aa3589dc726043a34d7529f170b57f))
* **ui:** the @jxsuite/ui workspace, with the theme, jx-icon over Phosphor, and specs/ui.md ([d297bc9](https://github.com/jxsuite/jx/commit/d297bc97c537e8eda726465470f683c3dbf53c37))
* **ui:** the kit ships no CSS class ([56668e4](https://github.com/jxsuite/jx/commit/56668e4de87ddd23b1715c9c542d7845ad6adb8b))


### Bug Fixes

* **schema,runtime,studio:** the overlay tools could not see a custom element ([af93456](https://github.com/jxsuite/jx/commit/af934567e242aca87d7890dff534fc69ad07e855))
* **studio,ui,runtime,schema:** thirteen findings from the branch review ([8c21b6c](https://github.com/jxsuite/jx/commit/8c21b6cde4a90e21bc655abe10a6f3f1955e638c))
* **studio,ui:** three ways an overlay betrayed the reader ([2dfc15e](https://github.com/jxsuite/jx/commit/2dfc15ed9a62cfef64d1620869e5f630d05c413e))
* stylized font and color selectors ([26bd94b](https://github.com/jxsuite/jx/commit/26bd94b119a8553041a596cb98329ed3d6fdc58a))
* **ui,site:** the theme is one reading of one block ([9d732a7](https://github.com/jxsuite/jx/commit/9d732a709fe84931d9c4affd0cdc1de81127d6f7))
* **ui,studio,schema:** the five defects a browser found that no unit test could ([024f725](https://github.com/jxsuite/jx/commit/024f725d331236777791b1011ae8045bd33ca065))
* **ui:** a hidden menu-row chevron stays hidden, and the kit checks the rule ([8918ef8](https://github.com/jxsuite/jx/commit/8918ef8389df1559ab05c0e68bd2149d94038e6d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0

## Changelog
