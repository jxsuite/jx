# Changelog

## [9.0.3](https://github.com/jxsuite/jx/compare/runtime-v9.0.2...runtime-v9.0.3) (2026-11-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 8.2.1
  * devDependencies
    * @jxsuite/erase bumped to 0.3.7

## [9.0.2](https://github.com/jxsuite/jx/compare/runtime-v9.0.1...runtime-v9.0.2) (2026-11-23)


### Bug Fixes

* **studio,desktop,server,runtime:** project state stays current after open, install and edits ([#721](https://github.com/jxsuite/jx/issues/721)) ([b096332](https://github.com/jxsuite/jx/commit/b09633266ab45d19abd3c722bcfa43ee1b97b1e3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 8.2.0
  * devDependencies
    * @jxsuite/erase bumped to 0.3.6

## [9.0.1](https://github.com/jxsuite/jx/compare/runtime-v9.0.0...runtime-v9.0.1) (2026-11-17)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 8.1.0
  * devDependencies
    * @jxsuite/erase bumped to 0.3.5

## [9.0.0](https://github.com/jxsuite/jx/compare/runtime-v8.0.0...runtime-v9.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime,compiler:** el.derivedKey = value throws a TypeError in strict code (and Reflect.set answers false) where it was silently ignored. A compiled parent's property binding to a key its child derives throws when the bound value changes; such a prop was never applied.
* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** a compiled component module now renders its images with the project's loading attributes and optimized candidates, and the interpreter writes title="", lang="" or dir="" for a property set to the empty string where it wrote no attribute.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.

### Features

* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,compiler:** a derived state key is a read-only property of its element ([0c21f4b](https://github.com/jxsuite/jx/commit/0c21f4bbe43021085dd86c6f9a78bc55c28cf1a0))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))


### Bug Fixes

* **compiler:** a component's images and empty-string properties prerender as its module draws them ([2094579](https://github.com/jxsuite/jx/commit/209457955411e5bc45dc16cc0ee3011b26d3cd4e))
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))


### Performance Improvements

* **runtime,compiler:** an element connects and a static page compiles at the trunk's cost ([c77a310](https://github.com/jxsuite/jx/commit/c77a310ac79fdb4eb38d8eb56ce980a3f8c3bbe3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 8.0.0
  * devDependencies
    * @jxsuite/erase bumped to 0.3.4

## [8.0.0](https://github.com/jxsuite/jx/compare/runtime-v7.1.0...runtime-v8.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime,compiler:** el.derivedKey = value throws a TypeError in strict code (and Reflect.set answers false) where it was silently ignored. A compiled parent's property binding to a key its child derives throws when the bound value changes; such a prop was never applied.
* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** a compiled component module now renders its images with the project's loading attributes and optimized candidates, and the interpreter writes title="", lang="" or dir="" for a property set to the empty string where it wrote no attribute.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.

### Features

* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,compiler:** a derived state key is a read-only property of its element ([0c21f4b](https://github.com/jxsuite/jx/commit/0c21f4bbe43021085dd86c6f9a78bc55c28cf1a0))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))


### Bug Fixes

* **compiler:** a component's images and empty-string properties prerender as its module draws them ([2094579](https://github.com/jxsuite/jx/commit/209457955411e5bc45dc16cc0ee3011b26d3cd4e))
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))


### Performance Improvements

* **runtime,compiler:** an element connects and a static page compiles at the trunk's cost ([c77a310](https://github.com/jxsuite/jx/commit/c77a310ac79fdb4eb38d8eb56ce980a3f8c3bbe3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
  * devDependencies
    * @jxsuite/erase bumped to 0.3.3

## [7.1.0](https://github.com/jxsuite/jx/compare/runtime-v7.0.1...runtime-v7.1.0) (2026-11-14)


### Features

* **compiler:** a compiled element runs every lifecycle hook and observes its declared attributes ([867b61c](https://github.com/jxsuite/jx/commit/867b61cd703d443d781840100980baef77b3dec0))
* **compiler:** a compiled element takes every prop its instance supplies, at connection and after ([e0a66d7](https://github.com/jxsuite/jx/commit/e0a66d75b1bc9afcd4fabb619bc73c952daf4e94))
* **compiler:** a static build comments each style rule with its $description ([82d9381](https://github.com/jxsuite/jx/commit/82d93815e8faaf3e0704af978268d2ae6849a990))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 6.0.2
  * devDependencies
    * @jxsuite/erase bumped to 0.3.2

## [7.0.1](https://github.com/jxsuite/jx/compare/runtime-v7.0.0...runtime-v7.0.1) (2026-11-13)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 6.0.1
  * devDependencies
    * @jxsuite/erase bumped to 0.3.1

## [7.0.0](https://github.com/jxsuite/jx/compare/runtime-v6.3.0...runtime-v7.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))

### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* **runtime,studio:** a prop edit writes the prop into the live instance ([#645](https://github.com/jxsuite/jx/issues/645)) ([e037910](https://github.com/jxsuite/jx/commit/e0379102f9d67ef80815568d48bffa79732a9cbb))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,compiler:** $lazy loads on first call in every tier ([#617](https://github.com/jxsuite/jx/issues/617)) ([3392082](https://github.com/jxsuite/jx/commit/33920822a65b8f186306af4f05eb8f3452932da0))
* **schema,runtime,studio:** quote-aware template scan, and a commit keeps its binding ([#638](https://github.com/jxsuite/jx/issues/638)) ([5a1f8d8](https://github.com/jxsuite/jx/commit/5a1f8d878d3e6f824a254421174bdf656eba3b7a))
* **studio:** a repeater draws every row on the editing canvas, and any row is editable ([#648](https://github.com/jxsuite/jx/issues/648)) ([8a97e95](https://github.com/jxsuite/jx/commit/8a97e956921410f4b0477afa577202058b034546))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **studio:** the canvas fetches remote data once, marks what did not resolve, takes a state value ([#649](https://github.com/jxsuite/jx/issues/649)) ([ff1a103](https://github.com/jxsuite/jx/commit/ff1a10311206a2a8de803a64a78e4b4311327a67))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 6.0.0
  * devDependencies
    * @jxsuite/erase bumped to 0.3.0

## [6.3.0](https://github.com/jxsuite/jx/compare/runtime-v6.2.2...runtime-v6.3.0) (2026-11-11)


### Features

* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.6.0
  * devDependencies
    * @jxsuite/erase bumped to 0.2.0

## [6.2.2](https://github.com/jxsuite/jx/compare/runtime-v6.2.1...runtime-v6.2.2) (2026-11-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.5.0

## [6.2.1](https://github.com/jxsuite/jx/compare/runtime-v6.2.0...runtime-v6.2.1) (2026-11-08)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.4.0

## [6.2.0](https://github.com/jxsuite/jx/compare/runtime-v6.1.0...runtime-v6.2.0) (2026-11-07)


### Features

* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))


### Bug Fixes

* **runtime:** let a write from a child scope reach the state it names ([#556](https://github.com/jxsuite/jx/issues/556)) ([e32df97](https://github.com/jxsuite/jx/commit/e32df970084e8a7f604a8fbf7934f8f234d2433a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.3.0

## [6.1.0](https://github.com/jxsuite/jx/compare/runtime-v6.0.2...runtime-v6.1.0) (2026-11-06)


### Features

* **runtime,studio:** hold template warnings for data in flight, and render-check pages as built ([#544](https://github.com/jxsuite/jx/issues/544)) ([6a47d72](https://github.com/jxsuite/jx/commit/6a47d72fde7e10100c8b4e01f51e82b0ee8d9b7f))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.2.0

## [6.0.2](https://github.com/jxsuite/jx/compare/runtime-v6.0.1...runtime-v6.0.2) (2026-11-04)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.1.0

## [6.0.1](https://github.com/jxsuite/jx/compare/runtime-v6.0.0...runtime-v6.0.1) (2026-10-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 5.0.0

## [6.0.0](https://github.com/jxsuite/jx/compare/runtime-v5.2.0...runtime-v6.0.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))

### Features

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))


### Bug Fixes

* **runtime:** an & after a context in a nested style key is the scope ([#497](https://github.com/jxsuite/jx/issues/497)) ([c1e6119](https://github.com/jxsuite/jx/commit/c1e6119bf27bdc70b5df0177145773f196ad07e2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 4.1.0

## [5.2.0](https://github.com/jxsuite/jx/compare/runtime-v5.1.0...runtime-v5.2.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))

## [5.1.0](https://github.com/jxsuite/jx/compare/runtime-v5.0.0...runtime-v5.1.0) (2026-10-21)


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

## [5.0.0](https://github.com/jxsuite/jx/compare/runtime-v4.1.0...runtime-v5.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 4.0.0

## [4.1.0](https://github.com/jxsuite/jx/compare/runtime-v4.0.3...runtime-v4.1.0) (2026-10-11)


### Features

* **runtime:** call a server-timed entry only through the host's proxy ([#445](https://github.com/jxsuite/jx/issues/445)) ([2305f8e](https://github.com/jxsuite/jx/commit/2305f8e32e88974fe7f8842641d08a62284b6759))

## [4.0.3](https://github.com/jxsuite/jx/compare/runtime-v4.0.2...runtime-v4.0.3) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 3.0.0

## [4.0.2](https://github.com/jxsuite/jx/compare/runtime-v4.0.1...runtime-v4.0.2) (2026-09-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 2.3.0

## [4.0.1](https://github.com/jxsuite/jx/compare/runtime-v4.0.0...runtime-v4.0.1) (2026-09-14)


### Bug Fixes

* **runtime:** a definition that instantiates its own tag is refused instead of hanging ([a48a040](https://github.com/jxsuite/jx/commit/a48a040ca73a5fa74bc7655191ec87c519ccfb5f))
* **runtime:** a definition that instantiates its own tag is refused instead of hanging ([722a091](https://github.com/jxsuite/jx/commit/722a0914144c1d287182ec3954155dc22983ba2a)), closes [#320](https://github.com/jxsuite/jx/issues/320)

## [4.0.0](https://github.com/jxsuite/jx/compare/runtime-v3.1.0...runtime-v4.0.0) (2026-09-14)


### ⚠ BREAKING CHANGES

* **runtime,compiler,site,studio:** `@jxsuite/runtime` no longer writes authored declarations to `el.style`, so code reading them back off an element after `applyStyle` sees nothing. The `elementStyleTags` export is replaced by `releaseElementStyles` and `resetDocumentStyles`, which refcount a shared rule set rather than handing out an element to remove by hand; `documentStyleText` reads back what was written.

### Features

* popovers become a first-class thing the canvas can open, and a rule it can check ([63e5916](https://github.com/jxsuite/jx/commit/63e5916c7aa1b41771bed4029960192582b52c0f))
* **runtime,compiler,site,studio:** authored styles become adopted CSS rules ([d3a4fe1](https://github.com/jxsuite/jx/commit/d3a4fe19cbd50322a08a4230d8c62f811d0d256f))
* **runtime,schema,ui:** the seam schema-contained styling needs ([164f5a2](https://github.com/jxsuite/jx/commit/164f5a242cbbc4442e9af5a7d18dd6a041318b94))
* **runtime,schema:** a declaration at-rule may be written more than once ([9c37c39](https://github.com/jxsuite/jx/commit/9c37c3900b340ff70f6001588a2cbc0228fbc201))
* **runtime,site:** [@keyframes](https://github.com/keyframes) is a third at-rule body shape ([be15a9f](https://github.com/jxsuite/jx/commit/be15a9fb0dd0dfb2baf5ce2d6c29e362cda640f2))
* **runtime,studio:** a style block may document itself, and forced-colors.css is generated from one ([269f4c0](https://github.com/jxsuite/jx/commit/269f4c01b3f60209743a81eb60992fdd85b860ca))
* **runtime,studio:** dialogs, invoker commands and inert on the canvas ([4a1455e](https://github.com/jxsuite/jx/commit/4a1455ee6d0b86228c840529998d9fbed62e4442))
* **runtime,ui,studio:** the canvas loads kit behaviours lazily, and a kit save reaches every frame ([08df54c](https://github.com/jxsuite/jx/commit/08df54c2c3e6229d3ccfeaf0433a7ed3fc65e07e))
* **runtime:** declaration-body at-rules, and the canvas hooks a popover needs ([bf35a22](https://github.com/jxsuite/jx/commit/bf35a2235d7e0995463e7a9d46f715914b8054b2))
* **runtime:** mount() with dispose, per-mount context, host scope and call contract ([d6ce7c9](https://github.com/jxsuite/jx/commit/d6ce7c9f2c846877744dc9527637f8151efe8ec3))
* **runtime:** redefineElement, and a definition read through the registry at connection ([c45033d](https://github.com/jxsuite/jx/commit/c45033d935b43cb3e0d041ab2fdc020804fee998))
* **schema,runtime,compiler,site:** a style value may read state ([01e74c7](https://github.com/jxsuite/jx/commit/01e74c7f2d43cdcc9a3107b4ab30de4f769922d1))
* **schema,runtime:** keyed $map with per-row scopes, and a $switch that owns its case ([4917ec8](https://github.com/jxsuite/jx/commit/4917ec82f829f2cb39e64268440af9665822a801))
* **studio,ui,runtime:** the Command Bar as a Jx document, closing the C2 surfaces ([f3f4fe2](https://github.com/jxsuite/jx/commit/f3f4fe2d39904bde5e5877946dc95ef6942d77a1))
* **studio,ui:** the settings menu on the menu surface, with a submenu level and live rows ([f9933d1](https://github.com/jxsuite/jx/commit/f9933d1fc3dc42381d6baa3dcba643b20f22326f))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **ui,compiler,schema:** jx-popover, jx-tooltip and jx-spinner ([21bc6ba](https://github.com/jxsuite/jx/commit/21bc6ba29f3304ddc3c56ee54de36d5b95fa69f1))
* **ui,studio:** jx-menu and jx-menu-item, and the element context menu as the first Jx surface ([07bb458](https://github.com/jxsuite/jx/commit/07bb458d7b02b1fc4683f876123a51a241c01414))
* **ui:** the @jxsuite/ui workspace, with the theme, jx-icon over Phosphor, and specs/ui.md ([d26e2b2](https://github.com/jxsuite/jx/commit/d26e2b2a54054bf03a3bc21cccc8f7447f0a91b5))


### Bug Fixes

* **runtime:** removing an observed attribute restores the declared default ([3900b63](https://github.com/jxsuite/jx/commit/3900b63540257da7f2e17ddd275875f2d7965a90))
* **schema,runtime,studio:** the overlay tools could not see a custom element ([bc57e9f](https://github.com/jxsuite/jx/commit/bc57e9f89f2030fcd0b5b5bdeffda2178683908f))
* **studio,ui,runtime,schema:** thirteen findings from the branch review ([9f80e82](https://github.com/jxsuite/jx/commit/9f80e82d245c7e2124a21828d97518dcac49f02a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 2.2.0

## [3.1.0](https://github.com/jxsuite/jx/compare/runtime-v3.0.0...runtime-v3.1.0) (2026-08-30)


### Features

* **runtime:** @jxsuite/runtime/css, so composing a stylesheet costs no renderer ([2a245eb](https://github.com/jxsuite/jx/commit/2a245ebcdc7dc85d94c40ec433d7525d089641c1))
* **runtime:** @jxsuite/runtime/css, so composing a stylesheet costs no renderer ([f1426c4](https://github.com/jxsuite/jx/commit/f1426c4d4cbbb1200d6f8565e06cf3e95adab2cf))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 2.1.0

## [3.0.0](https://github.com/jxsuite/jx/compare/runtime-v2.1.0...runtime-v3.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))
* **server:** the working tree, browsable at real routes, on its own origin ([d862f2f](https://github.com/jxsuite/jx/commit/d862f2f71fd0579b6435fa6f48d69f029ac6c5dc))
* **site,compiler:** the docs sidebar folds into accordions that open to the current page ([92c342d](https://github.com/jxsuite/jx/commit/92c342d0bca15994bd3b170dd298d134c32c5239))


### Bug Fixes

* **runtime,compiler:** one boolean-attribute rule, and it knows the two families ([6ef3a24](https://github.com/jxsuite/jx/commit/6ef3a243bc2ca18ed08aefbc95a3f50f49c5d824))
* **runtime,compiler:** one boolean-attribute rule, and it knows the two families ([0853bd6](https://github.com/jxsuite/jx/commit/0853bd6b09a730e425067cd45d4d57a7b9709394))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 2.0.0

## [2.1.0](https://github.com/jxsuite/jx/compare/runtime-v2.0.5...runtime-v2.1.0) (2026-08-26)


### Features

* **runtime:** a canvas asset resolver, default-off ([3ddc650](https://github.com/jxsuite/jx/commit/3ddc65019f3e6e8191fb70cf38d8d48151da4e60))
* **schema,runtime,studio:** the shared path math and a default-off canvas asset resolver ([4aad802](https://github.com/jxsuite/jx/commit/4aad80220632ac4ef415172c00ecbbd1a5e95642))
* **studio:** declare assetSpace, and resolve media in the canvas realm ([9be7db9](https://github.com/jxsuite/jx/commit/9be7db9151e520caf2f65826968956f25304710b))
* **studio:** declare assetSpace, and resolve media in the canvas realm ([2344271](https://github.com/jxsuite/jx/commit/2344271d5f96728af1a2b3c00bd1e326e0ba1582))


### Bug Fixes

* **compiler,runtime,studio:** a bare media type in an at-key emits without parentheses ([79b6fd6](https://github.com/jxsuite/jx/commit/79b6fd69bfbdec9de399790c51cbc874614f6c57))
* **compiler,runtime:** a component whose content is root textContent renders it ([fef0ef1](https://github.com/jxsuite/jx/commit/fef0ef15211af9ceccd47f176ae18b608457cc3f))
* **compiler:** a non-static component instance keeps its props through hydration ([c36b32f](https://github.com/jxsuite/jx/commit/c36b32faa41b41663c5b4afecd3e9e0131185dc9))
* **runtime:** svg elements render, because nodes are created in the right namespace ([91636a1](https://github.com/jxsuite/jx/commit/91636a1c9465a074ab9a5683bd2c0083919e2e76))
* six output-correctness defects, two of them live on jxsuite.com ([67663a9](https://github.com/jxsuite/jx/commit/67663a97b062313b3dc419e99fef556ed70539e5))
* **studio:** a translated entry has a mount, and one predicate decides a media field ([582a03e](https://github.com/jxsuite/jx/commit/582a03e52580437a0e3144d10717f5f1b09ab481))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.9.0

## [2.0.5](https://github.com/jxsuite/jx/compare/runtime-v2.0.4...runtime-v2.0.5) (2026-08-25)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.8.1

## [2.0.4](https://github.com/jxsuite/jx/compare/runtime-v2.0.3...runtime-v2.0.4) (2026-08-24)


### Bug Fixes

* **runtime:** a reflected property name no longer clobbers a declared default ([#188](https://github.com/jxsuite/jx/issues/188)) ([1cb85a4](https://github.com/jxsuite/jx/commit/1cb85a43dfe8389307588f77e7ea27bee9b3bfe2))

## [2.0.3](https://github.com/jxsuite/jx/compare/runtime-v2.0.2...runtime-v2.0.3) (2026-08-23)


### Bug Fixes

* **canvas:** project files load on a host that does not serve them at its root ([#176](https://github.com/jxsuite/jx/issues/176)) ([d6545da](https://github.com/jxsuite/jx/commit/d6545dae6fc801731519210e698a40d37d76023f))

## [2.0.2](https://github.com/jxsuite/jx/compare/runtime-v2.0.1...runtime-v2.0.2) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.8.0

## [2.0.1](https://github.com/jxsuite/jx/compare/runtime-v2.0.0...runtime-v2.0.1) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.7.0

## [2.0.0](https://github.com/jxsuite/jx/compare/runtime-v1.3.2...runtime-v2.0.0) (2026-08-19)


### ⚠ BREAKING CHANGES

* **runtime:** #/state/a/b.c addresses member "b.c" of "a" rather than walking three levels. 451 of 452 pointers in the corpus are pure-slash and the one dotted ref was in the spec sentence describing the behavior.

### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **i18n:** a page can render its own language switcher, and formats in its own language ([035970d](https://github.com/jxsuite/jx/commit/035970d6cf99cdec9bce11b2c9dddae5e09a2cef))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **runtime:** enforce private state against $props (spec.md §5.6) ([5e9b029](https://github.com/jxsuite/jx/commit/5e9b0299ad116be4ff61af4e1d3569ad0a6323e9))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **studio:** a Trusted Types policy that refuses, and two CSP profiles stated as permanent ([b2d449b](https://github.com/jxsuite/jx/commit/b2d449beb0c6b83b27bb90b099e1368c1fc2c44a))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **runtime:** one $ref tokenizer, so every lowered ref parses ([23cdfdd](https://github.com/jxsuite/jx/commit/23cdfdd67cd788764a9256475be7f76e71dc08e0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.6.0

## [1.3.2](https://github.com/jxsuite/jx/compare/runtime-v1.3.1...runtime-v1.3.2) (2026-07-30)


### Performance Improvements

* **studio,runtime:** stop refetching on every canvas render, narrow the splice escalation ([e1bc3c1](https://github.com/jxsuite/jx/commit/e1bc3c141fac22d269823558db379e1d09dbacc4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.5.0

## [1.3.1](https://github.com/jxsuite/jx/compare/runtime-v1.3.0...runtime-v1.3.1) (2026-07-24)


### Bug Fixes

* **runtime:** trigger-independent proper component mapping ([9731fa4](https://github.com/jxsuite/jx/commit/9731fa4b21c6a698b836036c48604dce1844a683))
* **runtime:** trigger-independent proper component mapping ([c6afb16](https://github.com/jxsuite/jx/commit/c6afb164feb9e7410c043a9af9c31724524b22c0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.4.0

## [1.3.0](https://github.com/jxsuite/jx/compare/runtime-v1.2.0...runtime-v1.3.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Bug Fixes

* harden dev server and unify runtime/compiler evaluation ([775c393](https://github.com/jxsuite/jx/commit/775c393b5010a304c2a5bf6759b2dfc5ca3bcc80))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.3.0

## [1.2.0](https://github.com/jxsuite/jx/compare/runtime-v1.1.0...runtime-v1.2.0) (2026-07-18)


### Features

* color scheme support ([6334a09](https://github.com/jxsuite/jx/commit/6334a09694aa742e11082b386bcf93305df60477))
* **styling:** forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script ([3f7a046](https://github.com/jxsuite/jx/commit/3f7a04690d34cd803e9fd00dd87ae7e1a2d9389e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.2.0

## [1.1.0](https://github.com/jxsuite/jx/compare/runtime-v1.0.0...runtime-v1.1.0) (2026-07-17)


### Features

* **runtime,compiler:** named formulas — call operator, $args scheme, blessed globals ([ae4ad2d](https://github.com/jxsuite/jx/commit/ae4ad2ddfab8601bd101a46830fff6e10f4a999c))
* **runtime,schema,formulas:** pure method operators and the composite formula catalog (spec §19.4d) ([39303e6](https://github.com/jxsuite/jx/commit/39303e6004cdeecce27dd77ee6e3c3faf34e4bc3))
* **runtime,schema,studio:** blessed Intl helpers and object-literal expression operands ([cb1c018](https://github.com/jxsuite/jx/commit/cb1c018585869c7a456c22dad602afe724fb4f11))
* **schema,runtime,studio:** structured function bodies and the statement editor (spec §20) ([e418fbb](https://github.com/jxsuite/jx/commit/e418fbb10cd858f7800f3d3fc42a99f2db24296f))
* **schema,runtime:** conditional operators and editor evaluation trace (spec §19.4b, §19.9) ([6cae3e8](https://github.com/jxsuite/jx/commit/6cae3e8abc312f4c44304b76e1c783594e3ff9ab))
* **studio:** inline editing of component property bound text ([91b8c87](https://github.com/jxsuite/jx/commit/91b8c873f89bbc4143287f3a70c2d29fbd1d29a2))
* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 1.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/runtime-v0.34.2...runtime-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- move @jxsuite/parser to the extensions/ tree

### Features

- move @jxsuite/parser to the extensions/ tree ([4157381](https://github.com/jxsuite/jx/commit/4157381e83719359c2980e1f9cded4a5c907c463))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/schema bumped to 1.0.0

## [0.34.2](https://github.com/jxsuite/jx/compare/runtime-v0.34.1...runtime-v0.34.2) (2026-07-07)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/schema bumped to 0.35.0

## [0.34.1](https://github.com/jxsuite/jx/compare/runtime-v0.34.0...runtime-v0.34.1) (2026-07-06)

### Bug Fixes

- **runtime:** proper handling of default content ([5daae0f](https://github.com/jxsuite/jx/commit/5daae0fba53911eb25dae558bedd50602adba189))
- **studio:** proper handling of relative component references ([6d99771](https://github.com/jxsuite/jx/commit/6d99771eed1e2a87518cbf90e3700305056f3666))
