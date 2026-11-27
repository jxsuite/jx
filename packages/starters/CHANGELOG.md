# Changelog

## [5.2.2](https://github.com/jxsuite/jx/compare/starters-v5.2.1...starters-v5.2.2) (2026-11-27)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 7.1.0
  * devDependencies
    * @jxsuite/parser bumped to 5.3.0
    * @jxsuite/runtime bumped to 9.1.0
    * @jxsuite/schema bumped to 8.3.0

## [5.2.1](https://github.com/jxsuite/jx/compare/starters-v5.2.0...starters-v5.2.1) (2026-11-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 7.0.0
  * devDependencies
    * @jxsuite/parser bumped to 5.2.3
    * @jxsuite/runtime bumped to 9.0.3
    * @jxsuite/schema bumped to 8.2.1

## [5.2.0](https://github.com/jxsuite/jx/compare/starters-v5.1.0...starters-v5.2.0) (2026-11-23)


### Features

* **studio:** convert a whole project between .json and .jxn from Project settings ([#717](https://github.com/jxsuite/jx/issues/717)) ([8d25ea7](https://github.com/jxsuite/jx/commit/8d25ea780feca9cc8623c1741037de20b735035c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.7.0
  * devDependencies
    * @jxsuite/parser bumped to 5.2.2
    * @jxsuite/runtime bumped to 9.0.2
    * @jxsuite/schema bumped to 8.2.0

## [5.1.0](https://github.com/jxsuite/jx/compare/starters-v5.0.0...starters-v5.1.0) (2026-11-17)


### Features

* **compiler:** csp.sources adds origins to a derived directive ([#694](https://github.com/jxsuite/jx/issues/694)) ([6a6d072](https://github.com/jxsuite/jx/commit/6a6d0725a95c41e629e38461480382ebe7868a34))
* **site:** resolve project defs and default the page charset to utf-8 ([#696](https://github.com/jxsuite/jx/issues/696)) ([41b54fc](https://github.com/jxsuite/jx/commit/41b54fc23c806cee10f85e915d3f2f50d52c69a3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.6.1
  * devDependencies
    * @jxsuite/parser bumped to 5.2.1
    * @jxsuite/runtime bumped to 9.0.1
    * @jxsuite/schema bumped to 8.1.0

## [5.0.0](https://github.com/jxsuite/jx/compare/starters-v4.0.0...starters-v5.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.

### Features

* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.6.0
  * devDependencies
    * @jxsuite/parser bumped to 5.2.0
    * @jxsuite/runtime bumped to 9.0.0
    * @jxsuite/schema bumped to 8.0.0

## [4.0.0](https://github.com/jxsuite/jx/compare/starters-v3.7.1...starters-v4.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.

### Features

* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.5.0
  * devDependencies
    * @jxsuite/parser bumped to 5.1.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0

## [3.7.1](https://github.com/jxsuite/jx/compare/starters-v3.7.0...starters-v3.7.1) (2026-11-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.4.2
  * devDependencies
    * @jxsuite/parser bumped to 5.0.2
    * @jxsuite/runtime bumped to 7.1.0
    * @jxsuite/schema bumped to 6.0.2

## [3.7.0](https://github.com/jxsuite/jx/compare/starters-v3.6.0...starters-v3.7.0) (2026-11-13)


### Features

* **starters:** every starter asks for AVIF and JPEG images ([4aead95](https://github.com/jxsuite/jx/commit/4aead95a6c001e13c68cd1d3fbb86e732dfa6416))


### Bug Fixes

* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.4.1
  * devDependencies
    * @jxsuite/parser bumped to 5.0.1
    * @jxsuite/runtime bumped to 7.0.1
    * @jxsuite/schema bumped to 6.0.1

## [3.6.0](https://github.com/jxsuite/jx/compare/starters-v3.5.0...starters-v3.6.0) (2026-11-12)


### Features

* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,content-mapper:** tsc checks the props a .jxn document gives a component ([#632](https://github.com/jxsuite/jx/issues/632)) ([e7834a1](https://github.com/jxsuite/jx/commit/e7834a132bf1f24bcbce25f285d1d25a45883631))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.4.0
  * devDependencies
    * @jxsuite/parser bumped to 5.0.0
    * @jxsuite/runtime bumped to 7.0.0
    * @jxsuite/schema bumped to 6.0.0

## [3.5.0](https://github.com/jxsuite/jx/compare/starters-v3.4.0...starters-v3.5.0) (2026-11-11)


### Features

* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.3.0
  * devDependencies
    * @jxsuite/parser bumped to 4.3.4
    * @jxsuite/runtime bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0

## [3.4.0](https://github.com/jxsuite/jx/compare/starters-v3.3.2...starters-v3.4.0) (2026-11-08)


### Features

* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.2.5
  * devDependencies
    * @jxsuite/parser bumped to 4.3.3
    * @jxsuite/runtime bumped to 6.2.2
    * @jxsuite/schema bumped to 5.5.0

## [3.3.2](https://github.com/jxsuite/jx/compare/starters-v3.3.1...starters-v3.3.2) (2026-11-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.2.4
  * devDependencies
    * @jxsuite/parser bumped to 4.3.2
    * @jxsuite/runtime bumped to 6.2.1
    * @jxsuite/schema bumped to 5.4.0

## [3.3.1](https://github.com/jxsuite/jx/compare/starters-v3.3.0...starters-v3.3.1) (2026-11-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.2.3
  * devDependencies
    * @jxsuite/parser bumped to 4.3.1
    * @jxsuite/runtime bumped to 6.2.0
    * @jxsuite/schema bumped to 5.3.0

## [3.3.0](https://github.com/jxsuite/jx/compare/starters-v3.2.0...starters-v3.3.0) (2026-11-06)


### Features

* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.2.2
  * devDependencies
    * @jxsuite/parser bumped to 4.3.0
    * @jxsuite/runtime bumped to 6.1.0
    * @jxsuite/schema bumped to 5.2.0

## [3.2.0](https://github.com/jxsuite/jx/compare/starters-v3.1.4...starters-v3.2.0) (2026-11-04)


### Features

* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.2.1
  * devDependencies
    * @jxsuite/parser bumped to 4.2.0
    * @jxsuite/runtime bumped to 6.0.2
    * @jxsuite/schema bumped to 5.1.0

## [3.1.4](https://github.com/jxsuite/jx/compare/starters-v3.1.3...starters-v3.1.4) (2026-11-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.2.0

## [3.1.3](https://github.com/jxsuite/jx/compare/starters-v3.1.2...starters-v3.1.3) (2026-10-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.1.0

## [3.1.2](https://github.com/jxsuite/jx/compare/starters-v3.1.1...starters-v3.1.2) (2026-10-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 6.0.0
  * devDependencies
    * @jxsuite/parser bumped to 4.1.2
    * @jxsuite/runtime bumped to 6.0.1
    * @jxsuite/schema bumped to 5.0.0

## [3.1.1](https://github.com/jxsuite/jx/compare/starters-v3.1.0...starters-v3.1.1) (2026-10-27)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 5.0.0
  * devDependencies
    * @jxsuite/parser bumped to 4.1.1
    * @jxsuite/runtime bumped to 6.0.0
    * @jxsuite/schema bumped to 4.1.0

## [3.1.0](https://github.com/jxsuite/jx/compare/starters-v3.0.1...starters-v3.1.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 4.1.0
    * @jxsuite/runtime bumped to 5.2.0

## [3.0.1](https://github.com/jxsuite/jx/compare/starters-v3.0.0...starters-v3.0.1) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 4.0.1
    * @jxsuite/runtime bumped to 5.1.0

## [3.0.0](https://github.com/jxsuite/jx/compare/starters-v2.0.2...starters-v3.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 4.0.0
  * devDependencies
    * @jxsuite/parser bumped to 4.0.0

## [2.0.2](https://github.com/jxsuite/jx/compare/starters-v2.0.1...starters-v2.0.2) (2026-10-17)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 3.0.0
  * devDependencies
    * @jxsuite/parser bumped to 3.0.0
    * @jxsuite/runtime bumped to 5.0.0
    * @jxsuite/schema bumped to 4.0.0

## [2.0.1](https://github.com/jxsuite/jx/compare/starters-v2.0.0...starters-v2.0.1) (2026-10-11)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 2.0.1
    * @jxsuite/runtime bumped to 4.1.0

## [2.0.0](https://github.com/jxsuite/jx/compare/starters-v1.8.2...starters-v2.0.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 2.0.0
    * @jxsuite/runtime bumped to 4.0.3
    * @jxsuite/schema bumped to 3.0.0

## [1.8.2](https://github.com/jxsuite/jx/compare/starters-v1.8.1...starters-v1.8.2) (2026-09-29)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.8.2
    * @jxsuite/runtime bumped to 4.0.2
    * @jxsuite/schema bumped to 2.3.0

## [1.8.1](https://github.com/jxsuite/jx/compare/starters-v1.8.0...starters-v1.8.1) (2026-09-14)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.8.1
    * @jxsuite/runtime bumped to 4.0.1

## [1.8.0](https://github.com/jxsuite/jx/compare/starters-v1.7.0...starters-v1.8.0) (2026-09-14)


### Features

* **runtime,schema:** a declaration at-rule may be written more than once ([9c37c39](https://github.com/jxsuite/jx/commit/9c37c3900b340ff70f6001588a2cbc0228fbc201))
* **runtime,studio:** a style block may document itself, and forced-colors.css is generated from one ([269f4c0](https://github.com/jxsuite/jx/commit/269f4c01b3f60209743a81eb60992fdd85b860ca))
* **schema,runtime,compiler,site:** a style value may read state ([01e74c7](https://github.com/jxsuite/jx/commit/01e74c7f2d43cdcc9a3107b4ab30de4f769922d1))
* **schema,runtime:** keyed $map with per-row scopes, and a $switch that owns its case ([4917ec8](https://github.com/jxsuite/jx/commit/4917ec82f829f2cb39e64268440af9665822a801))
* **schema,studio,compiler:** accessibility rules, judged alike by Studio, jx validate and the tests ([c14d121](https://github.com/jxsuite/jx/commit/c14d121e128bf64c041c401b8b0514f6133e133c))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **ui,studio:** jx-menu and jx-menu-item, and the element context menu as the first Jx surface ([07bb458](https://github.com/jxsuite/jx/commit/07bb458d7b02b1fc4683f876123a51a241c01414))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.8.0
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0

## [1.7.0](https://github.com/jxsuite/jx/compare/starters-v1.6.5...starters-v1.7.0) (2026-08-30)


### Features

* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([d61c756](https://github.com/jxsuite/jx/commit/d61c756ae3366d24769967be2b2057715bb73179))
* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([3bb1c59](https://github.com/jxsuite/jx/commit/3bb1c5965a54a4371cdad856d6119cd752c12721)), closes [#246](https://github.com/jxsuite/jx/issues/246)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.7.0
    * @jxsuite/runtime bumped to 3.1.0
    * @jxsuite/schema bumped to 2.1.0

## [1.6.5](https://github.com/jxsuite/jx/compare/starters-v1.6.4...starters-v1.6.5) (2026-08-27)


### Performance Improvements

* **compiler:** minify bundles, inline component CSS, preload the runtime ([502238b](https://github.com/jxsuite/jx/commit/502238baa06c81b02fcc2853017c54de6a23526c))
* **compiler:** minify bundles, inline component CSS, preload the runtime ([78dcc89](https://github.com/jxsuite/jx/commit/78dcc89496ad90f6fa0f9369f1c6e6b9d2538641))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.6.0
    * @jxsuite/runtime bumped to 3.0.0
    * @jxsuite/schema bumped to 2.0.0

## [1.6.4](https://github.com/jxsuite/jx/compare/starters-v1.6.3...starters-v1.6.4) (2026-08-26)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.6
    * @jxsuite/runtime bumped to 2.1.0
    * @jxsuite/schema bumped to 1.9.0

## [1.6.3](https://github.com/jxsuite/jx/compare/starters-v1.6.2...starters-v1.6.3) (2026-08-25)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.5
    * @jxsuite/runtime bumped to 2.0.5
    * @jxsuite/schema bumped to 1.8.1

## [1.6.2](https://github.com/jxsuite/jx/compare/starters-v1.6.1...starters-v1.6.2) (2026-08-24)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.4
    * @jxsuite/runtime bumped to 2.0.4

## [1.6.1](https://github.com/jxsuite/jx/compare/starters-v1.6.0...starters-v1.6.1) (2026-08-23)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.3
    * @jxsuite/runtime bumped to 2.0.3

## [1.6.0](https://github.com/jxsuite/jx/compare/starters-v1.5.0...starters-v1.6.0) (2026-08-21)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a collection is localized end to end, and a starter proves it ([22661a6](https://github.com/jxsuite/jx/commit/22661a6845f211362280bba71b3cee0bb5d7f809))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler,starters:** a project's own node_modules stops answering for the Jx schema ([7e28247](https://github.com/jxsuite/jx/commit/7e282471d989bb2622eaa7c4ee3c1cceef4c1917))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* defects surfaced by fact-checking the new package READMEs ([1d3a125](https://github.com/jxsuite/jx/commit/1d3a125051350ee10de2906f6dede52509c8bbe3))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **starters,examples:** repair documents the schema correctly rejected ([7917b2b](https://github.com/jxsuite/jx/commit/7917b2b231e5f4ed6d3818d19c5f8fb477fe02c1))
* **starters:** pin template dependency ranges to the versions that released ([fb28b27](https://github.com/jxsuite/jx/commit/fb28b2785e582c5ab1bb7e5661abf60e2cd55988))

## [1.5.0](https://github.com/jxsuite/jx/compare/starters-v1.4.0...starters-v1.5.0) (2026-08-21)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a collection is localized end to end, and a starter proves it ([22661a6](https://github.com/jxsuite/jx/commit/22661a6845f211362280bba71b3cee0bb5d7f809))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler,starters:** a project's own node_modules stops answering for the Jx schema ([7e28247](https://github.com/jxsuite/jx/commit/7e282471d989bb2622eaa7c4ee3c1cceef4c1917))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* defects surfaced by fact-checking the new package READMEs ([1d3a125](https://github.com/jxsuite/jx/commit/1d3a125051350ee10de2906f6dede52509c8bbe3))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **starters,examples:** repair documents the schema correctly rejected ([7917b2b](https://github.com/jxsuite/jx/commit/7917b2b231e5f4ed6d3818d19c5f8fb477fe02c1))
* **starters:** pin template dependency ranges to the versions that released ([fb28b27](https://github.com/jxsuite/jx/commit/fb28b2785e582c5ab1bb7e5661abf60e2cd55988))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.2
    * @jxsuite/runtime bumped to 2.0.2
    * @jxsuite/schema bumped to 1.8.0

## [1.4.0](https://github.com/jxsuite/jx/compare/starters-v1.3.0...starters-v1.4.0) (2026-08-21)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a collection is localized end to end, and a starter proves it ([22661a6](https://github.com/jxsuite/jx/commit/22661a6845f211362280bba71b3cee0bb5d7f809))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler,starters:** a project's own node_modules stops answering for the Jx schema ([7e28247](https://github.com/jxsuite/jx/commit/7e282471d989bb2622eaa7c4ee3c1cceef4c1917))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* defects surfaced by fact-checking the new package READMEs ([1d3a125](https://github.com/jxsuite/jx/commit/1d3a125051350ee10de2906f6dede52509c8bbe3))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **starters,examples:** repair documents the schema correctly rejected ([7917b2b](https://github.com/jxsuite/jx/commit/7917b2b231e5f4ed6d3818d19c5f8fb477fe02c1))
* **starters:** pin template dependency ranges to the versions that released ([fb28b27](https://github.com/jxsuite/jx/commit/fb28b2785e582c5ab1bb7e5661abf60e2cd55988))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.1
    * @jxsuite/runtime bumped to 2.0.1
    * @jxsuite/schema bumped to 1.7.0

## [1.3.0](https://github.com/jxsuite/jx/compare/starters-v1.2.2...starters-v1.3.0) (2026-08-19)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a collection is localized end to end, and a starter proves it ([22661a6](https://github.com/jxsuite/jx/commit/22661a6845f211362280bba71b3cee0bb5d7f809))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler,starters:** a project's own node_modules stops answering for the Jx schema ([7e28247](https://github.com/jxsuite/jx/commit/7e282471d989bb2622eaa7c4ee3c1cceef4c1917))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **starters:** pin template dependency ranges to the versions that released ([fb28b27](https://github.com/jxsuite/jx/commit/fb28b2785e582c5ab1bb7e5661abf60e2cd55988))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/parser bumped to 1.5.0
    * @jxsuite/runtime bumped to 2.0.0
    * @jxsuite/schema bumped to 1.6.0

## [1.2.2](https://github.com/jxsuite/jx/compare/starters-v1.2.1...starters-v1.2.2) (2026-07-30)


### Bug Fixes

* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/schema bumped to 1.5.0

## [1.2.1](https://github.com/jxsuite/jx/compare/starters-v1.2.0...starters-v1.2.1) (2026-07-24)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/schema bumped to 1.4.0

## [1.2.0](https://github.com/jxsuite/jx/compare/starters-v1.1.1...starters-v1.2.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Bug Fixes

* **starters,examples:** repair documents the schema correctly rejected ([7917b2b](https://github.com/jxsuite/jx/commit/7917b2b231e5f4ed6d3818d19c5f8fb477fe02c1))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/schema bumped to 1.3.0

## [1.1.1](https://github.com/jxsuite/jx/compare/starters-v1.1.0...starters-v1.1.1) (2026-07-18)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/schema bumped to 1.2.0

## [1.1.0](https://github.com/jxsuite/jx/compare/starters-v1.0.0...starters-v1.1.0) (2026-07-17)


### Features

* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/schema bumped to 1.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/starters-v0.35.1...starters-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- hosts switch to the extension model; migrate all projects to content sections

### Features

- hosts switch to the extension model; migrate all projects to content sections ([b2c0e27](https://github.com/jxsuite/jx/commit/b2c0e27c08e649af334fdf67ccf6abbb73c480dc))

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @jxsuite/schema bumped to 1.0.0

## [0.35.1](https://github.com/jxsuite/jx/compare/starters-v0.35.0...starters-v0.35.1) (2026-07-07)

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @jxsuite/schema bumped to 0.35.0

## [0.35.0](https://github.com/jxsuite/jx/compare/starters-v0.34.0...starters-v0.35.0) (2026-07-06)

### Features

- **starters:** init starter sites ([be19be6](https://github.com/jxsuite/jx/commit/be19be613e365ad26e804f99ecce95032d2419fc))
- use site screenshots for template selector ([09333d4](https://github.com/jxsuite/jx/commit/09333d42dff4aa556bafd18c2a95f3542df2af66))
