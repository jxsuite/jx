# Changelog

## [0.14.0](https://github.com/jxsuite/jx/compare/ui-v0.13.0...ui-v0.14.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.

### Features

* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **ui,studio:** jx-table ships, and Studio's Packages and Library tables are drawn with it ([31b1313](https://github.com/jxsuite/jx/commit/31b1313f6a2f4945bc3c329a40d124dba86897e4)), closes [#301](https://github.com/jxsuite/jx/issues/301)
* **ui:** a jx-action-group or jx-tabs inside a jx-toolbar is one tab stop ([14f22ec](https://github.com/jxsuite/jx/commit/14f22eccdf78645327e564ae9db0b3884812e600)), closes [#302](https://github.com/jxsuite/jx/issues/302)
* **ui:** the kit's element documents can be loaded one at a time ([71a14b5](https://github.com/jxsuite/jx/commit/71a14b5209f0a28ab33a43dec0b693a2171542e4)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **ui:** the published kit carries an optional compiled distribution ([d65af9f](https://github.com/jxsuite/jx/commit/d65af9f15ef6f630295114d3b33aabf0b3fe6514)), closes [#304](https://github.com/jxsuite/jx/issues/304)


### Bug Fixes

* **ui:** the kit's build finds its package on Windows ([6b9db81](https://github.com/jxsuite/jx/commit/6b9db81c9e249db7d923666d2e0c2bf18d40b03c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 9.0.0
    * @jxsuite/schema bumped to 8.0.0

## [0.13.0](https://github.com/jxsuite/jx/compare/ui-v0.12.2...ui-v0.13.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.

### Features

* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **ui,studio:** jx-table ships, and Studio's Packages and Library tables are drawn with it ([31b1313](https://github.com/jxsuite/jx/commit/31b1313f6a2f4945bc3c329a40d124dba86897e4)), closes [#301](https://github.com/jxsuite/jx/issues/301)
* **ui:** a jx-action-group or jx-tabs inside a jx-toolbar is one tab stop ([14f22ec](https://github.com/jxsuite/jx/commit/14f22eccdf78645327e564ae9db0b3884812e600)), closes [#302](https://github.com/jxsuite/jx/issues/302)
* **ui:** the kit's element documents can be loaded one at a time ([71a14b5](https://github.com/jxsuite/jx/commit/71a14b5209f0a28ab33a43dec0b693a2171542e4)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **ui:** the published kit carries an optional compiled distribution ([d65af9f](https://github.com/jxsuite/jx/commit/d65af9f15ef6f630295114d3b33aabf0b3fe6514)), closes [#304](https://github.com/jxsuite/jx/issues/304)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0

## [0.12.2](https://github.com/jxsuite/jx/compare/ui-v0.12.1...ui-v0.12.2) (2026-11-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 7.1.0
    * @jxsuite/schema bumped to 6.0.2

## [0.12.1](https://github.com/jxsuite/jx/compare/ui-v0.12.0...ui-v0.12.1) (2026-11-13)


### Bug Fixes

* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 7.0.1
    * @jxsuite/schema bumped to 6.0.1

## [0.12.0](https://github.com/jxsuite/jx/compare/ui-v0.11.0...ui-v0.12.0) (2026-11-12)


### Features

* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))


### Bug Fixes

* **ui:** composition guard on combobox, forced-colours option highlight, dialog scroll containment ([#622](https://github.com/jxsuite/jx/issues/622)) ([3a4da4b](https://github.com/jxsuite/jx/commit/3a4da4bf392e1d8e6e6b067c9655e9123fe6f77f))
* **ui:** forward form attributes, draw invalid state and guard composition keys ([#626](https://github.com/jxsuite/jx/issues/626)) ([0649c13](https://github.com/jxsuite/jx/commit/0649c1310e329df5c9f34b5f0c8415fb816d3658))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 7.0.0
    * @jxsuite/schema bumped to 6.0.0

## [0.11.0](https://github.com/jxsuite/jx/compare/ui-v0.10.4...ui-v0.11.0) (2026-11-11)


### Features

* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **ui:** a jx-field in a narrow container stacks its label above the control ([#600](https://github.com/jxsuite/jx/issues/600)) ([18cf26e](https://github.com/jxsuite/jx/commit/18cf26e6a2819e9240fe9029d73b552171768f9e))
* **ui:** section headings are one recipe, and the accordion draws it ([#601](https://github.com/jxsuite/jx/issues/601)) ([fc12fa6](https://github.com/jxsuite/jx/commit/fc12fa686eea1c2fcae5cac274120114bb1a3992))


### Bug Fixes

* **studio:** zoom in the status bar, collapsed outline, reliable twisty, diff Code view back ([#605](https://github.com/jxsuite/jx/issues/605)) ([e4cc01d](https://github.com/jxsuite/jx/commit/e4cc01d17353b1e3749c5257fb09383ca6a505dd))
* **ui:** 11px is the type floor, in the kit and in Studio's chrome ([#599](https://github.com/jxsuite/jx/issues/599)) ([ad305fe](https://github.com/jxsuite/jx/commit/ad305fe0da3e0b3b68b03ba9c3c7dda2afcae9e9))
* **ui:** muted text meets 4.5:1 on every surface, in both schemes ([#598](https://github.com/jxsuite/jx/issues/598)) ([83190e3](https://github.com/jxsuite/jx/commit/83190e30880ed5e0cc8ded9f64fcc95856b20120))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0

## [0.10.4](https://github.com/jxsuite/jx/compare/ui-v0.10.3...ui-v0.10.4) (2026-11-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.2.2
    * @jxsuite/schema bumped to 5.5.0

## [0.10.3](https://github.com/jxsuite/jx/compare/ui-v0.10.2...ui-v0.10.3) (2026-11-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.2.1
    * @jxsuite/schema bumped to 5.4.0

## [0.10.2](https://github.com/jxsuite/jx/compare/ui-v0.10.1...ui-v0.10.2) (2026-11-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.2.0
    * @jxsuite/schema bumped to 5.3.0

## [0.10.1](https://github.com/jxsuite/jx/compare/ui-v0.10.0...ui-v0.10.1) (2026-11-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.1.0
    * @jxsuite/schema bumped to 5.2.0

## [0.10.0](https://github.com/jxsuite/jx/compare/ui-v0.9.0...ui-v0.10.0) (2026-11-04)


### Features

* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.0.2
    * @jxsuite/schema bumped to 5.1.0

## [0.9.0](https://github.com/jxsuite/jx/compare/ui-v0.8.2...ui-v0.9.0) (2026-11-04)


### Features

* **studio:** edit an image where it is opened ([#531](https://github.com/jxsuite/jx/issues/531)) ([0e2b90e](https://github.com/jxsuite/jx/commit/0e2b90e9a2deb20a542fc33803adbe31a20673ec))

## [0.8.2](https://github.com/jxsuite/jx/compare/ui-v0.8.1...ui-v0.8.2) (2026-10-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.0.1
    * @jxsuite/schema bumped to 5.0.0

## [0.8.1](https://github.com/jxsuite/jx/compare/ui-v0.8.0...ui-v0.8.1) (2026-10-27)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.0.0
    * @jxsuite/schema bumped to 4.1.0

## [0.8.0](https://github.com/jxsuite/jx/compare/ui-v0.7.1...ui-v0.8.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 5.2.0

## [0.7.1](https://github.com/jxsuite/jx/compare/ui-v0.7.0...ui-v0.7.1) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 5.1.0

## [0.7.0](https://github.com/jxsuite/jx/compare/ui-v0.6.0...ui-v0.7.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))

## [0.6.0](https://github.com/jxsuite/jx/compare/ui-v0.5.1...ui-v0.6.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.

### Bug Fixes

* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 5.0.0
    * @jxsuite/schema bumped to 4.0.0

## [0.5.1](https://github.com/jxsuite/jx/compare/ui-v0.5.0...ui-v0.5.1) (2026-10-11)


### Bug Fixes

* **studio:** cursor-anchored zoom, dirty-gated Save, Library rail button, and four more fixes ([#444](https://github.com/jxsuite/jx/issues/444)) ([72670f0](https://github.com/jxsuite/jx/commit/72670f0ea73eccde8259775a3a802318ce0ed2fc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.1.0

## [0.5.0](https://github.com/jxsuite/jx/compare/ui-v0.4.1...ui-v0.5.0) (2026-10-07)


### Features

* **studio:** open a cloud project from a repository subfolder ([#429](https://github.com/jxsuite/jx/issues/429)) ([bf467a7](https://github.com/jxsuite/jx/commit/bf467a7f4b987dc03fb6bb7db145dfa48c130280))

## [0.4.1](https://github.com/jxsuite/jx/compare/ui-v0.4.0...ui-v0.4.1) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.3
    * @jxsuite/schema bumped to 3.0.0

## [0.4.0](https://github.com/jxsuite/jx/compare/ui-v0.3.0...ui-v0.4.0) (2026-09-29)


### Features

* **studio:** batch modulepreload links, cache scroller/track resolution ([7d181d2](https://github.com/jxsuite/jx/commit/7d181d20b1599d1978f00b5380b0c90802ceae55))


### Bug Fixes

* **studio:** resolve three canvas/chrome stacking-order defects ([72b0b53](https://github.com/jxsuite/jx/commit/72b0b532a35f9faf6b7e75b9320af284e84105fa))
* **studio:** resolve three canvas/chrome stacking-order defects ([040fb5b](https://github.com/jxsuite/jx/commit/040fb5b40886b8f9c3ad937b1f9b178f7aee7acb))
* **studio:** Source Control, Document Header, button groups, and eight more chrome fixes ([b99443f](https://github.com/jxsuite/jx/commit/b99443fa3fbb930a5681d5ce030836b722a70475))
* **ui:** a compact action group draws one segmented line, and outset hit areas cannot clip ([5842a3f](https://github.com/jxsuite/jx/commit/5842a3f64d9f32a99905176f1ffd9e15391c8024))
* **ui:** pin the empty error region's size instead of inferring it ([ed788c1](https://github.com/jxsuite/jx/commit/ed788c1c5e1bdb7d1b5f3aa89f04f9d55d782417))
* **ui:** segmented compact action groups, inert empty error region, contained hit areas ([bad8f17](https://github.com/jxsuite/jx/commit/bad8f17760cc937240154aee106682193d102fa8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.2
    * @jxsuite/schema bumped to 2.3.0

## [0.3.0](https://github.com/jxsuite/jx/compare/ui-v0.2.0...ui-v0.3.0) (2026-09-22)


### Features

* **studio:** batch modulepreload links, cache scroller/track resolution ([d6bdfae](https://github.com/jxsuite/jx/commit/d6bdfaef7e714952d6153796f7be0ee3f3bd05f2))

## [0.2.0](https://github.com/jxsuite/jx/compare/ui-v0.1.0...ui-v0.2.0) (2026-09-14)


### Features

* **ui,studio:** jx-switch's hint is a tooltip while enabled, and the commandbar passes hint ([9ba4213](https://github.com/jxsuite/jx/commit/9ba4213e385a638e47a81725c36ad2288d32b831))
* **ui,studio:** jx-switch's hint is a tooltip while enabled, and the commandbar passes hint ([#332](https://github.com/jxsuite/jx/issues/332)) ([b2c9c6b](https://github.com/jxsuite/jx/commit/b2c9c6b582804626ffa30527db184fa5518cc035))
* **ui:** size=sm controls accept the pointer over the 24px floor without growing ([b59b39e](https://github.com/jxsuite/jx/commit/b59b39e4a1083f4bd694ad64d086703e24163444))
* **ui:** size=sm controls accept the pointer over the 24px floor without growing ([#324](https://github.com/jxsuite/jx/issues/324)) ([4c475dd](https://github.com/jxsuite/jx/commit/4c475dded66562b63c518d97ba99e1bf77859d2f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.1

## 0.1.0 (2026-09-14)


### Features

* **runtime,schema,ui:** the seam schema-contained styling needs ([164f5a2](https://github.com/jxsuite/jx/commit/164f5a242cbbc4442e9af5a7d18dd6a041318b94))
* **runtime,ui,studio:** the canvas loads kit behaviours lazily, and a kit save reaches every frame ([08df54c](https://github.com/jxsuite/jx/commit/08df54c2c3e6229d3ccfeaf0433a7ed3fc65e07e))
* **schema,studio,compiler:** accessibility rules, judged alike by Studio, jx validate and the tests ([c14d121](https://github.com/jxsuite/jx/commit/c14d121e128bf64c041c401b8b0514f6133e133c))
* **studio,ui,runtime:** the Command Bar as a Jx document, closing the C2 surfaces ([f3f4fe2](https://github.com/jxsuite/jx/commit/f3f4fe2d39904bde5e5877946dc95ef6942d77a1))
* **studio,ui:** the Navigator rail as a Jx surface, on stacked action buttons ([3219ac7](https://github.com/jxsuite/jx/commit/3219ac72878b081b98e3d87ac308adc65e8dcd81))
* **studio,ui:** the settings menu on the menu surface, with a submenu level and live rows ([f9933d1](https://github.com/jxsuite/jx/commit/f9933d1fc3dc42381d6baa3dcba643b20f22326f))
* **studio,ui:** the three dock edges are jx-split, so a keyboard can size a dock ([181a641](https://github.com/jxsuite/jx/commit/181a641430515a6d28136a62838e38db931d6af0))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **studio:** Adobe Spectrum is removed ([5474e07](https://github.com/jxsuite/jx/commit/5474e0788a637089aead2c94f43b12fce0237fb1))
* **studio:** Studio edits its own chrome — a saved surface or kit component re-mounts the shell ([e16676d](https://github.com/jxsuite/jx/commit/e16676d7d254a5f2c0a725ce18da36eaefd0ee13))
* **studio:** the confirm, save-or-discard and prompt dialogs as a Jx document over jx-dialog ([277a225](https://github.com/jxsuite/jx/commit/277a225b47ceea1698878590eaa904571543a7ad))
* **studio:** the UI kit at boot, the surface façade, and the chrome's tokens aliased to the kit ([1fda8c4](https://github.com/jxsuite/jx/commit/1fda8c4f256aa6d9195002822784d9ea79784bf9))
* **ui,compiler,schema:** jx-popover, jx-tooltip and jx-spinner ([21bc6ba](https://github.com/jxsuite/jx/commit/21bc6ba29f3304ddc3c56ee54de36d5b95fa69f1))
* **ui,studio:** a button's hint is a jx-tooltip while it can act and a title while it cannot ([8315a23](https://github.com/jxsuite/jx/commit/8315a23d5ec5065496c58ecc72833b086c6df2d4)), closes [#299](https://github.com/jxsuite/jx/issues/299)
* **ui,studio:** jx-menu and jx-menu-item, and the element context menu as the first Jx surface ([07bb458](https://github.com/jxsuite/jx/commit/07bb458d7b02b1fc4683f876123a51a241c01414))
* **ui,studio:** jx-menu hangs from its button by anchor positioning, submenus beside their rows ([4407877](https://github.com/jxsuite/jx/commit/440787789c3e96a9ea223d3606fe54da1e4e16fe))
* **ui,studio:** jx-tab takes slotted content, and the pane tab strip is a document ([5c10bff](https://github.com/jxsuite/jx/commit/5c10bff2ad8c8d061b0e27a2b48955598a933b2c))
* **ui,studio:** jx-toolbar and jx-split, and a workaround for a limitation that never existed ([2d738b1](https://github.com/jxsuite/jx/commit/2d738b12e4142c25c4d98e2c56e9836b6e5c1de9))
* **ui,studio:** jx-tree and jx-combobox, and the five surfaces that hand-rolled them ([b3363cf](https://github.com/jxsuite/jx/commit/b3363cfe2c9ffb5fe83058d62f83c5b55a95e55f))
* **ui,studio:** the Edit column, the colour well and the credentials form finish on the kit ([d6565a7](https://github.com/jxsuite/jx/commit/d6565a7bed4b494d6eba52e676fcc74b0014e05c))
* **ui,studio:** the kit has a colour family, and Studio's last Spectrum surface is a document ([30cb78a](https://github.com/jxsuite/jx/commit/30cb78a017b61b02d92eb116ec87d69c26271e6c))
* **ui,studio:** the Style tab's keyword rows are jx-combobox, and ui.md's principles have evidence ([bbf30c8](https://github.com/jxsuite/jx/commit/bbf30c8ab712b44dd3239ec4f0ebbd1499b1e573))
* **ui:** compact density draws 24px controls, and a button's hint is a jx-tooltip while it can act ([3930b0b](https://github.com/jxsuite/jx/commit/3930b0b244264f2eca551753550804d19bfb4f1e))
* **ui:** compact density draws 24px controls, the WCAG 2.2 SC 2.5.8 floor at every density ([9b9f99f](https://github.com/jxsuite/jx/commit/9b9f99f6d800c6ad38a4d0850030d2ea109f4b47)), closes [#309](https://github.com/jxsuite/jx/issues/309)
* **ui:** jx-button and jx-action-button ([93a18cc](https://github.com/jxsuite/jx/commit/93a18cc31d47a16b0e4dad8abecf3bc588c49d42))
* **ui:** jx-checkbox, jx-switch and jx-number-field, and the field-row recipes ([c9ae3f0](https://github.com/jxsuite/jx/commit/c9ae3f0b22c1e0d7e8c61999d0a2e7296eb6e2c4))
* **ui:** jx-dialog and jx-textfield ([c94fdb5](https://github.com/jxsuite/jx/commit/c94fdb50065362ef686cc210a6dc7cab1a9e0bdb))
* **ui:** jx-popover is placed by CSS anchor positioning against the platform's implicit anchor ([9fbcc75](https://github.com/jxsuite/jx/commit/9fbcc75a1f66150cacf470ae015e9ecb6b604d35))
* **ui:** jx-select is a native select, and the four rules a document must not write ([4a1b6af](https://github.com/jxsuite/jx/commit/4a1b6af073a5a36f35c3e4f9c888b00f88b01004))
* **ui:** jx-tabs, jx-accordion-item and jx-action-group ([b72014c](https://github.com/jxsuite/jx/commit/b72014c5d59e70b1b7c4fcc7874a3f9cd1602cd7))
* **ui:** jx-tooltip hangs from its control by anchor positioning, the arrow following the flip ([e81f318](https://github.com/jxsuite/jx/commit/e81f318e11e98e9b1b6e02bb86a934a743540644))
* **ui:** the @jxsuite/ui workspace, with the theme, jx-icon over Phosphor, and specs/ui.md ([d26e2b2](https://github.com/jxsuite/jx/commit/d26e2b2a54054bf03a3bc21cccc8f7447f0a91b5))
* **ui:** the kit ships no CSS class ([155146b](https://github.com/jxsuite/jx/commit/155146b3444ae900b2ee3f1730d6fb08a0c7e7fe))


### Bug Fixes

* **schema,runtime,studio:** the overlay tools could not see a custom element ([bc57e9f](https://github.com/jxsuite/jx/commit/bc57e9f89f2030fcd0b5b5bdeffda2178683908f))
* **studio,ui,runtime,schema:** thirteen findings from the branch review ([9f80e82](https://github.com/jxsuite/jx/commit/9f80e82d245c7e2124a21828d97518dcac49f02a))
* **studio,ui:** three ways an overlay betrayed the reader ([68888ec](https://github.com/jxsuite/jx/commit/68888ec1eca0872ed784b77aca7cffb081d130bf))
* stylized font and color selectors ([376798d](https://github.com/jxsuite/jx/commit/376798df96e47524054967afd0263e5be31314a7))
* **ui,site:** the theme is one reading of one block ([6e606dd](https://github.com/jxsuite/jx/commit/6e606dd4d58c56a6ab181258ac3df088887f2c82))
* **ui,studio,schema:** the five defects a browser found that no unit test could ([06e8d00](https://github.com/jxsuite/jx/commit/06e8d0045b3ad6bec99d777f11f9f0fc5570c512))
* **ui:** a hidden menu-row chevron stays hidden, and the kit checks the rule ([ccdb5bf](https://github.com/jxsuite/jx/commit/ccdb5bfa36498d487075dc6ccab20f9397e0cc1a))
* **ui:** an anchored tooltip's arrow follows a flip the platform makes while the tip is up ([484a603](https://github.com/jxsuite/jx/commit/484a603a1fc0a417381dd467656947fb08bcac69))
* **ui:** an anchored tooltip's arrow follows a flip the platform makes while the tip is up ([91fbe02](https://github.com/jxsuite/jx/commit/91fbe0285aaec81ca5a87529521d12a9e2b408db)), closes [#310](https://github.com/jxsuite/jx/issues/310)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0

## Changelog
