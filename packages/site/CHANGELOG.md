# Changelog

## [4.2.0](https://github.com/jxsuite/jx/compare/site-v4.1.2...site-v4.2.0) (2026-11-27)


### Features

* **site:** rank routes segment by segment and build a URL two pages generate once ([#788](https://github.com/jxsuite/jx/issues/788)) ([7875d07](https://github.com/jxsuite/jx/commit/7875d0773f8b5ab5bf5631f2b2cc8d6f3fd5d242))
* **site:** refuse page file names that derive a route URLPattern misreads ([#779](https://github.com/jxsuite/jx/issues/779)) ([6a4c774](https://github.com/jxsuite/jx/commit/6a4c774cece9b9bc5d4cd58d8a077776c0612797))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 9.1.0
    * @jxsuite/schema bumped to 8.3.0

## [4.1.2](https://github.com/jxsuite/jx/compare/site-v4.1.1...site-v4.1.2) (2026-11-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 9.0.3
    * @jxsuite/schema bumped to 8.2.1

## [4.1.1](https://github.com/jxsuite/jx/compare/site-v4.1.0...site-v4.1.1) (2026-11-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 9.0.2
    * @jxsuite/schema bumped to 8.2.0

## [4.1.0](https://github.com/jxsuite/jx/compare/site-v4.0.0...site-v4.1.0) (2026-11-17)


### Features

* **site:** $page describes the page, so a layout reads its own title and description ([#699](https://github.com/jxsuite/jx/issues/699)) ([08f24b3](https://github.com/jxsuite/jx/commit/08f24b313a170dd453898f942e13ea19f2fdff1c))
* **site:** every layout in a nested chain contributes its head, and a layout cycle is an error ([#695](https://github.com/jxsuite/jx/issues/695)) ([1227f29](https://github.com/jxsuite/jx/commit/1227f295c6374221f6248fadd2170ea286381012))
* **site:** resolve project defs and default the page charset to utf-8 ([#696](https://github.com/jxsuite/jx/issues/696)) ([41b54fc](https://github.com/jxsuite/jx/commit/41b54fc23c806cee10f85e915d3f2f50d52c69a3))


### Bug Fixes

* **site:** keep a page's title off its root element and warn on unrendered head keys ([#698](https://github.com/jxsuite/jx/issues/698)) ([84f1971](https://github.com/jxsuite/jx/commit/84f1971d88a8efeecf3a217daefe0e26e5bdfda1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 9.0.1
    * @jxsuite/schema bumped to 8.1.0

## [4.0.0](https://github.com/jxsuite/jx/compare/site-v3.0.0...site-v4.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.

### Features

* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 9.0.0
    * @jxsuite/schema bumped to 8.0.0

## [3.0.0](https://github.com/jxsuite/jx/compare/site-v2.8.0...site-v3.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.

### Features

* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0

## [2.8.0](https://github.com/jxsuite/jx/compare/site-v2.7.1...site-v2.8.0) (2026-11-14)


### Features

* **compiler:** a static build comments each style rule with its $description ([82d9381](https://github.com/jxsuite/jx/commit/82d93815e8faaf3e0704af978268d2ae6849a990))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 7.1.0
    * @jxsuite/schema bumped to 6.0.2

## [2.7.1](https://github.com/jxsuite/jx/compare/site-v2.7.0...site-v2.7.1) (2026-11-13)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 7.0.1
    * @jxsuite/schema bumped to 6.0.1

## [2.7.0](https://github.com/jxsuite/jx/compare/site-v2.6.0...site-v2.7.0) (2026-11-12)


### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* **site:** site state stops making every built page dynamic, and never replaces $site's own names ([#619](https://github.com/jxsuite/jx/issues/619)) ([3cdcae4](https://github.com/jxsuite/jx/commit/3cdcae4cba94cd639defaa157b1299a9f6a287b7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 7.0.0
    * @jxsuite/schema bumped to 6.0.0

## [2.6.0](https://github.com/jxsuite/jx/compare/site-v2.5.1...site-v2.6.0) (2026-11-11)


### Features

* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **studio,compiler:** a picture's focal point lives in the picture ([#591](https://github.com/jxsuite/jx/issues/591)) ([d87ce76](https://github.com/jxsuite/jx/commit/d87ce76d12805d0d5b217629a37f4639a16def49))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0

## [2.5.1](https://github.com/jxsuite/jx/compare/site-v2.5.0...site-v2.5.1) (2026-11-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.2.2
    * @jxsuite/schema bumped to 5.5.0

## [2.5.0](https://github.com/jxsuite/jx/compare/site-v2.4.0...site-v2.5.0) (2026-11-08)


### Features

* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **studio:** open, find, save and convert .jxn documents, solo and shared ([#567](https://github.com/jxsuite/jx/issues/567)) ([2be9af7](https://github.com/jxsuite/jx/commit/2be9af7ea7e5ab645a8e3d39c03bbfd4ea6566c2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.2.1
    * @jxsuite/schema bumped to 5.4.0

## [2.4.0](https://github.com/jxsuite/jx/compare/site-v2.3.1...site-v2.4.0) (2026-11-07)


### Features

* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.2.0
    * @jxsuite/schema bumped to 5.3.0

## [2.3.1](https://github.com/jxsuite/jx/compare/site-v2.3.0...site-v2.3.1) (2026-11-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.1.0
    * @jxsuite/schema bumped to 5.2.0

## [2.3.0](https://github.com/jxsuite/jx/compare/site-v2.2.2...site-v2.3.0) (2026-11-04)


### Features

* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.0.2
    * @jxsuite/schema bumped to 5.1.0

## [2.2.2](https://github.com/jxsuite/jx/compare/site-v2.2.1...site-v2.2.2) (2026-10-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.0.1
    * @jxsuite/schema bumped to 5.0.0

## [2.2.1](https://github.com/jxsuite/jx/compare/site-v2.2.0...site-v2.2.1) (2026-10-27)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 6.0.0
    * @jxsuite/schema bumped to 4.1.0

## [2.2.0](https://github.com/jxsuite/jx/compare/site-v2.1.0...site-v2.2.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 5.2.0

## [2.1.0](https://github.com/jxsuite/jx/compare/site-v2.0.5...site-v2.1.0) (2026-10-21)


### Features

* **connector:** settings contributions name their group, intro sentence and item noun ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **runtime:** npm specifiers resolve through a host resolver installed with setNpmModuleResolver ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **runtime:** templates read $site and $page without a state prefix, and an instance whose render throws is reported as not rendered ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **studio:** a Site panel, one Add new dialog, and a Page, Element and Assistant inspector replace the Library and the Document Header card ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **studio:** five top-bar workspaces, Design, Content, Media, Styles and Publish, replace the named layouts ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **studio:** Media, Styles and Publish workspaces, Project settings as a dialog, and a Styles panel that lists variables first ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **studio:** the Content workspace writes collection entries on the canvas inside their template, with fields in the Inspector ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))


### Bug Fixes

* **runtime:** a disposed subtree leaves the document before its effects stop, so releasing styles no longer writes to live nodes ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))
* **site:** a page's own description property becomes its description meta, ahead of the page head ([9839cbb](https://github.com/jxsuite/jx/commit/9839cbbd9c17118685db02e8eeb69df8744a9fe0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 5.1.0

## [2.0.5](https://github.com/jxsuite/jx/compare/site-v2.0.4...site-v2.0.5) (2026-10-17)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 5.0.0
    * @jxsuite/schema bumped to 4.0.0

## [2.0.4](https://github.com/jxsuite/jx/compare/site-v2.0.3...site-v2.0.4) (2026-10-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.1.0

## [2.0.3](https://github.com/jxsuite/jx/compare/site-v2.0.2...site-v2.0.3) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.3
    * @jxsuite/schema bumped to 3.0.0

## [2.0.2](https://github.com/jxsuite/jx/compare/site-v2.0.1...site-v2.0.2) (2026-09-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.2
    * @jxsuite/schema bumped to 2.3.0

## [2.0.1](https://github.com/jxsuite/jx/compare/site-v2.0.0...site-v2.0.1) (2026-09-14)


### Bug Fixes

* **compiler,site:** compileStyles delegates the project block to buildSiteStyleCSS ([0911986](https://github.com/jxsuite/jx/commit/0911986e7db670541d46fb06077fc4972e043489))
* **compiler,site:** compileStyles delegates the project block to buildSiteStyleCSS ([0fd80c1](https://github.com/jxsuite/jx/commit/0fd80c1d69059aeb76a7c9b7dc2de1eb0f0a974f)), closes [#329](https://github.com/jxsuite/jx/issues/329)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.1

## [2.0.0](https://github.com/jxsuite/jx/compare/site-v1.1.0...site-v2.0.0) (2026-09-14)


### ⚠ BREAKING CHANGES

* **runtime,compiler,site,studio:** `@jxsuite/runtime` no longer writes authored declarations to `el.style`, so code reading them back off an element after `applyStyle` sees nothing. The `elementStyleTags` export is replaced by `releaseElementStyles` and `resetDocumentStyles`, which refcount a shared rule set rather than handing out an element to remove by hand; `documentStyleText` reads back what was written.

### Features

* **runtime,compiler,site,studio:** authored styles become adopted CSS rules ([d3a4fe1](https://github.com/jxsuite/jx/commit/d3a4fe19cbd50322a08a4230d8c62f811d0d256f))
* **runtime,site:** [@keyframes](https://github.com/keyframes) is a third at-rule body shape ([be15a9f](https://github.com/jxsuite/jx/commit/be15a9fb0dd0dfb2baf5ce2d6c29e362cda640f2))
* **schema,runtime,compiler,site:** a style value may read state ([01e74c7](https://github.com/jxsuite/jx/commit/01e74c7f2d43cdcc9a3107b4ab30de4f769922d1))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))


### Bug Fixes

* **site:** the canvas site-style sheet is byte-for-byte what jx build writes, element rules included ([d126fad](https://github.com/jxsuite/jx/commit/d126fad77fe9a7841cdbb02ff06be528ecdacce7))
* **site:** the canvas site-style sheet is byte-for-byte what jx build writes, element rules included ([f66c99f](https://github.com/jxsuite/jx/commit/f66c99f39e56bad45762a9afb11432a1e82007e3)), closes [#296](https://github.com/jxsuite/jx/issues/296)
* **ui,site:** the theme is one reading of one block ([6e606dd](https://github.com/jxsuite/jx/commit/6e606dd4d58c56a6ab181258ac3df088887f2c82))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0

## [1.1.0](https://github.com/jxsuite/jx/compare/site-v1.0.0...site-v1.1.0) (2026-08-30)


### Features

* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([c97617a](https://github.com/jxsuite/jx/commit/c97617a27563a776f038e82c3b0bafb5696996da))
* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([e65e1cf](https://github.com/jxsuite/jx/commit/e65e1cf3feed747822e46fc460ff3d978e1e3131)), closes [#235](https://github.com/jxsuite/jx/issues/235)
* **runtime:** @jxsuite/runtime/css, so composing a stylesheet costs no renderer ([2a245eb](https://github.com/jxsuite/jx/commit/2a245ebcdc7dc85d94c40ec433d7525d089641c1))
* **runtime:** @jxsuite/runtime/css, so composing a stylesheet costs no renderer ([f1426c4](https://github.com/jxsuite/jx/commit/f1426c4d4cbbb1200d6f8565e06cf3e95adab2cf))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 3.1.0
    * @jxsuite/schema bumped to 2.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/site-v0.1.0...site-v1.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))
* **site:** compose a page at a route, and the document that boots it ([f90e1c2](https://github.com/jxsuite/jx/commit/f90e1c2522cd25d4d018c71b0f01e7d297a86fcf))


### Bug Fixes

* **desktop,import:** the two gates the live preview left red, and the coverage it owed ([c9d56d2](https://github.com/jxsuite/jx/commit/c9d56d2495f1da84997768e6144718be7380de07))
* **site:** the composer discovers the components a page uses, not only the ones it declares ([69983e1](https://github.com/jxsuite/jx/commit/69983e15f3fb372f82fae502966715763398e5b5))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 3.0.0
    * @jxsuite/schema bumped to 2.0.0
