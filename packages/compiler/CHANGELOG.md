# Changelog

## [11.1.1](https://github.com/jxsuite/jx/compare/compiler-v11.1.0...compiler-v11.1.1) (2026-11-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.8.7
    * @jxsuite/erase bumped to 0.3.6
    * @jxsuite/runtime bumped to 9.0.2
    * @jxsuite/schema bumped to 8.2.0
    * @jxsuite/site bumped to 4.1.1
  * devDependencies
    * @jxsuite/connector bumped to 0.8.15
    * @jxsuite/parser bumped to 5.2.2

## [11.1.0](https://github.com/jxsuite/jx/compare/compiler-v11.0.0...compiler-v11.1.0) (2026-11-17)


### Features

* **compiler:** csp.sources adds origins to a derived directive ([#694](https://github.com/jxsuite/jx/issues/694)) ([6a6d072](https://github.com/jxsuite/jx/commit/6a6d0725a95c41e629e38461480382ebe7868a34))
* **compiler:** state og:image:width and og:image:height from the local image file ([#691](https://github.com/jxsuite/jx/issues/691)) ([bb8d269](https://github.com/jxsuite/jx/commit/bb8d2691ed1f00213ed3f591f72158e735d3d67d))
* **site:** $page describes the page, so a layout reads its own title and description ([#699](https://github.com/jxsuite/jx/issues/699)) ([08f24b3](https://github.com/jxsuite/jx/commit/08f24b313a170dd453898f942e13ea19f2fdff1c))
* **site:** every layout in a nested chain contributes its head, and a layout cycle is an error ([#695](https://github.com/jxsuite/jx/issues/695)) ([1227f29](https://github.com/jxsuite/jx/commit/1227f295c6374221f6248fadd2170ea286381012))
* **site:** resolve project defs and default the page charset to utf-8 ([#696](https://github.com/jxsuite/jx/issues/696)) ([41b54fc](https://github.com/jxsuite/jx/commit/41b54fc23c806cee10f85e915d3f2f50d52c69a3))


### Bug Fixes

* **compiler:** negotiate a multilingual site's root under every adapter and base ([#692](https://github.com/jxsuite/jx/issues/692)) ([8e1adbe](https://github.com/jxsuite/jx/commit/8e1adbe75a22fd2bb28dd1f81ffba070825eb5f4))
* **compiler:** write no whitespace between inline siblings or beside text ([#697](https://github.com/jxsuite/jx/issues/697)) ([b6c045e](https://github.com/jxsuite/jx/commit/b6c045e2264ac6610841baa2a5ecb390ee06ba9a))
* **feed:** stamp an empty feed's updated with the build time, not 1970 ([#693](https://github.com/jxsuite/jx/issues/693)) ([6d82a6c](https://github.com/jxsuite/jx/commit/6d82a6c70960a099c1e14497f58aee4f09f53920))
* **site:** keep a page's title off its root element and warn on unrendered head keys ([#698](https://github.com/jxsuite/jx/issues/698)) ([84f1971](https://github.com/jxsuite/jx/commit/84f1971d88a8efeecf3a217daefe0e26e5bdfda1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.8.6
    * @jxsuite/erase bumped to 0.3.5
    * @jxsuite/runtime bumped to 9.0.1
    * @jxsuite/schema bumped to 8.1.0
    * @jxsuite/site bumped to 4.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.14
    * @jxsuite/parser bumped to 5.2.1

## [11.0.0](https://github.com/jxsuite/jx/compare/compiler-v10.0.0...compiler-v11.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime,compiler:** el.derivedKey = value throws a TypeError in strict code (and Reflect.set answers false) where it was silently ignored. A compiled parent's property binding to a key its child derives throws when the bound value changes; such a prop was never applied.
* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built component with no display in its base style block is now display: block, as in Studio. Write "display": "revert-layer" (or the value wanted) in the base block to opt out.
* **compiler:** a built page now carries a component definition's root attributes on each instance's host, over an attribute of the same name the page wrote, and a compiled element writes them when it connects and binds its definition's root-level event handlers.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** a compiled component module now renders its images with the project's loading attributes and optimized candidates, and the interpreter writes title="", lang="" or dir="" for a property set to the empty string where it wrote no attribute.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.
* **compiler:** built output changes for every site with live components. Their prerender now holds list rows, initial values and the selected $switch case; a component containing a $switch or a chosen tag ships its module where it was stamped static; a static component that a live one renders ships its module on every page that uses it; and a dynamic page prerenders the initial value of a binding a handler writes. buildInitialScope no longer marks handler-written entries runtime-only unless asked to with holdMutable.

### Features

* **compiler:** a compiled element binds its root handlers and writes its root attributes ([741476b](https://github.com/jxsuite/jx/commit/741476b88ed25f9477eabc6a15d0ffe16f7984b1))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **compiler:** compileElementPack compiles a component library into a distributable pack ([a5ed13d](https://github.com/jxsuite/jx/commit/a5ed13d4afa091c83b859da99ee7e79d8f6463ce)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,compiler:** a derived state key is a read-only property of its element ([0c21f4b](https://github.com/jxsuite/jx/commit/0c21f4bbe43021085dd86c6f9a78bc55c28cf1a0))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **ui:** the published kit carries an optional compiled distribution ([d65af9f](https://github.com/jxsuite/jx/commit/d65af9f15ef6f630295114d3b33aabf0b3fe6514)), closes [#304](https://github.com/jxsuite/jx/issues/304)


### Bug Fixes

* **compiler:** a compiled component stylesheet carries the display: block default ([ca40b9e](https://github.com/jxsuite/jx/commit/ca40b9ef6ae16abd9db79fc6e98ce2586df32da8))
* **compiler:** a component module draws its URLs under the deployment base path ([7414e48](https://github.com/jxsuite/jx/commit/7414e486cbd034848cb8d659ebfcf7594df0eb63)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **compiler:** a component's images and empty-string properties prerender as its module draws them ([2094579](https://github.com/jxsuite/jx/commit/209457955411e5bc45dc16cc0ee3011b26d3cd4e))
* **compiler:** a dollar sign in a head entry or an image attribute reaches the page as written ([946224d](https://github.com/jxsuite/jx/commit/946224d013ad597da8ae7411bae585ce32189a93))
* **compiler:** a live component prerenders its initial state ([24e7968](https://github.com/jxsuite/jx/commit/24e796863b76d0297d6a8e70b142d6f2a1236552)), closes [#285](https://github.com/jxsuite/jx/issues/285)
* **compiler:** a shadow element links its own stylesheet into a root it attaches ([9cee908](https://github.com/jxsuite/jx/commit/9cee9080bdb901e165a684660d46a5875aee9503)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **compiler:** a static component a live one renders stays static on a page that uses it alone ([1d88c98](https://github.com/jxsuite/jx/commit/1d88c987c5114c9a637ff20de84fc567ce74731b)), closes [#285](https://github.com/jxsuite/jx/issues/285)
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* **compiler:** escape spliced HTML with one helper instead of a replacer per call site ([910c829](https://github.com/jxsuite/jx/commit/910c8292cec14d9d1c8cd988558aea4aff2e958c))
* **compiler:** leave the two unreachable html-tag branches as they were ([8fb9ab3](https://github.com/jxsuite/jx/commit/8fb9ab3b938756b96f8177b9fde58f974599c509))


### Performance Improvements

* **runtime,compiler:** an element connects and a static page compiles at the trunk's cost ([c77a310](https://github.com/jxsuite/jx/commit/c77a310ac79fdb4eb38d8eb56ce980a3f8c3bbe3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.8.5
    * @jxsuite/erase bumped to 0.3.4
    * @jxsuite/runtime bumped to 9.0.0
    * @jxsuite/schema bumped to 8.0.0
    * @jxsuite/site bumped to 4.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.13
    * @jxsuite/parser bumped to 5.2.0

## [10.0.0](https://github.com/jxsuite/jx/compare/compiler-v9.1.0...compiler-v10.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime,compiler:** el.derivedKey = value throws a TypeError in strict code (and Reflect.set answers false) where it was silently ignored. A compiled parent's property binding to a key its child derives throws when the bound value changes; such a prop was never applied.
* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built component with no display in its base style block is now display: block, as in Studio. Write "display": "revert-layer" (or the value wanted) in the base block to opt out.
* **compiler:** a built page now carries a component definition's root attributes on each instance's host, over an attribute of the same name the page wrote, and a compiled element writes them when it connects and binds its definition's root-level event handlers.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** a compiled component module now renders its images with the project's loading attributes and optimized candidates, and the interpreter writes title="", lang="" or dir="" for a property set to the empty string where it wrote no attribute.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.
* **compiler:** built output changes for every site with live components. Their prerender now holds list rows, initial values and the selected $switch case; a component containing a $switch or a chosen tag ships its module where it was stamped static; a static component that a live one renders ships its module on every page that uses it; and a dynamic page prerenders the initial value of a binding a handler writes. buildInitialScope no longer marks handler-written entries runtime-only unless asked to with holdMutable.

### Features

* **compiler:** a compiled element binds its root handlers and writes its root attributes ([741476b](https://github.com/jxsuite/jx/commit/741476b88ed25f9477eabc6a15d0ffe16f7984b1))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **compiler:** compileElementPack compiles a component library into a distributable pack ([a5ed13d](https://github.com/jxsuite/jx/commit/a5ed13d4afa091c83b859da99ee7e79d8f6463ce)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,compiler:** a derived state key is a read-only property of its element ([0c21f4b](https://github.com/jxsuite/jx/commit/0c21f4bbe43021085dd86c6f9a78bc55c28cf1a0))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **ui:** the published kit carries an optional compiled distribution ([d65af9f](https://github.com/jxsuite/jx/commit/d65af9f15ef6f630295114d3b33aabf0b3fe6514)), closes [#304](https://github.com/jxsuite/jx/issues/304)


### Bug Fixes

* **compiler:** a compiled component stylesheet carries the display: block default ([ca40b9e](https://github.com/jxsuite/jx/commit/ca40b9ef6ae16abd9db79fc6e98ce2586df32da8))
* **compiler:** a component module draws its URLs under the deployment base path ([7414e48](https://github.com/jxsuite/jx/commit/7414e486cbd034848cb8d659ebfcf7594df0eb63)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **compiler:** a component's images and empty-string properties prerender as its module draws them ([2094579](https://github.com/jxsuite/jx/commit/209457955411e5bc45dc16cc0ee3011b26d3cd4e))
* **compiler:** a dollar sign in a head entry or an image attribute reaches the page as written ([946224d](https://github.com/jxsuite/jx/commit/946224d013ad597da8ae7411bae585ce32189a93))
* **compiler:** a live component prerenders its initial state ([24e7968](https://github.com/jxsuite/jx/commit/24e796863b76d0297d6a8e70b142d6f2a1236552)), closes [#285](https://github.com/jxsuite/jx/issues/285)
* **compiler:** a shadow element links its own stylesheet into a root it attaches ([9cee908](https://github.com/jxsuite/jx/commit/9cee9080bdb901e165a684660d46a5875aee9503)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **compiler:** a static component a live one renders stays static on a page that uses it alone ([1d88c98](https://github.com/jxsuite/jx/commit/1d88c987c5114c9a637ff20de84fc567ce74731b)), closes [#285](https://github.com/jxsuite/jx/issues/285)
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* **compiler:** escape spliced HTML with one helper instead of a replacer per call site ([910c829](https://github.com/jxsuite/jx/commit/910c8292cec14d9d1c8cd988558aea4aff2e958c))
* **compiler:** leave the two unreachable html-tag branches as they were ([8fb9ab3](https://github.com/jxsuite/jx/commit/8fb9ab3b938756b96f8177b9fde58f974599c509))


### Performance Improvements

* **runtime,compiler:** an element connects and a static page compiles at the trunk's cost ([c77a310](https://github.com/jxsuite/jx/commit/c77a310ac79fdb4eb38d8eb56ce980a3f8c3bbe3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.8.4
    * @jxsuite/erase bumped to 0.3.3
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/site bumped to 3.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.12
    * @jxsuite/parser bumped to 5.1.0

## [9.1.0](https://github.com/jxsuite/jx/compare/compiler-v9.0.1...compiler-v9.1.0) (2026-11-14)


### Features

* **compiler:** a compiled element runs every lifecycle hook and observes its declared attributes ([867b61c](https://github.com/jxsuite/jx/commit/867b61cd703d443d781840100980baef77b3dec0))
* **compiler:** a compiled element takes every prop its instance supplies, at connection and after ([e0a66d7](https://github.com/jxsuite/jx/commit/e0a66d75b1bc9afcd4fabb619bc73c952daf4e94))
* **compiler:** a site build runs every external class a page or component names ([6971a9f](https://github.com/jxsuite/jx/commit/6971a9f4a18d859d56d8edac7cd0b3942f6996d9))
* **compiler:** a static build comments each style rule with its $description ([82d9381](https://github.com/jxsuite/jx/commit/82d93815e8faaf3e0704af978268d2ae6849a990))
* **compiler:** a template text child is baked at build time or bound on a dynamic page ([ca9de1d](https://github.com/jxsuite/jx/commit/ca9de1d298e64262cd81053bab045ae6691385f9))
* **compiler:** one build can leave images alone, and a Pages preview does ([544adbe](https://github.com/jxsuite/jx/commit/544adbe8f56eb3d7af34a4bfe2e0188cc5f46297))
* **compiler:** the image pipeline is stated once, and its cache, formats and Markdown images match ([9e1d1e8](https://github.com/jxsuite/jx/commit/9e1d1e8acc9f6f90091fcfdab8013d97f64f8665))


### Bug Fixes

* **compiler:** a derived sizes takes the narrower of an element's literal width and max-width ([a5a5f70](https://github.com/jxsuite/jx/commit/a5a5f70e84657f137173ba0c42a721e3dfb1b25c))
* **compiler:** every class module route 0 writes loads, and compiler.md §5 matches it ([7a4456b](https://github.com/jxsuite/jx/commit/7a4456bc427e4760b1c56cfffba335f4d3a8ac61))
* **compiler:** every styled element gets a generated class of its own as its style handle ([3c19450](https://github.com/jxsuite/jx/commit/3c19450096f9d884580fd536a0ee5ed23c3b9aec))
* keep CI green on the dependency bumps ([97000ad](https://github.com/jxsuite/jx/commit/97000adb60a24f7ff073df267a4c8d76900bbf04))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler-binding bumped to 0.3.0
    * @jxsuite/create bumped to 1.8.3
    * @jxsuite/erase bumped to 0.3.2
    * @jxsuite/runtime bumped to 7.1.0
    * @jxsuite/schema bumped to 6.0.2
    * @jxsuite/site bumped to 2.8.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.11
    * @jxsuite/parser bumped to 5.0.2

## [9.0.1](https://github.com/jxsuite/jx/compare/compiler-v9.0.0...compiler-v9.0.1) (2026-11-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler-binding bumped to 0.2.1

## [9.0.0](https://github.com/jxsuite/jx/compare/compiler-v8.7.0...compiler-v9.0.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* **compiler:** the default image formats are avif and jpeg instead of webp and avif, WebP output is lossless, sharp is no longer a dependency, and variant file names change. A project that lists webp should list avif and jpeg instead.

### Features

* **compiler:** images are encoded by the compiler's own Rust core ([8e929a7](https://github.com/jxsuite/jx/commit/8e929a7520b95fc661e55f64c5b6f7ce3fd333e4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler-binding bumped to 0.2.0
    * @jxsuite/create bumped to 1.8.2
    * @jxsuite/erase bumped to 0.3.1
    * @jxsuite/runtime bumped to 7.0.1
    * @jxsuite/schema bumped to 6.0.1
    * @jxsuite/site bumped to 2.7.1
  * devDependencies
    * @jxsuite/connector bumped to 0.8.10
    * @jxsuite/parser bumped to 5.0.1

## [8.7.0](https://github.com/jxsuite/jx/compare/compiler-v8.6.0...compiler-v8.7.0) (2026-11-12)


### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* **compiler:** a build compiles every component a document declares, wherever it lives ([#616](https://github.com/jxsuite/jx/issues/616)) ([ae26149](https://github.com/jxsuite/jx/commit/ae26149538631b0bfef7dd6ef83659759d90c65e))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,compiler:** $lazy loads on first call in every tier ([#617](https://github.com/jxsuite/jx/issues/617)) ([3392082](https://github.com/jxsuite/jx/commit/33920822a65b8f186306af4f05eb8f3452932da0))
* **server,compiler:** jx format formats the code a .jxn file holds, as Studio does ([#637](https://github.com/jxsuite/jx/issues/637)) ([46c388b](https://github.com/jxsuite/jx/commit/46c388bcb2726bade8fe5627a8f8b86c03f32f94))
* **site:** site state stops making every built page dynamic, and never replaces $site's own names ([#619](https://github.com/jxsuite/jx/issues/619)) ([3cdcae4](https://github.com/jxsuite/jx/commit/3cdcae4cba94cd639defaa157b1299a9f6a287b7))


### Bug Fixes

* **compiler:** a compiled element moved in the DOM keeps what it drew ([#620](https://github.com/jxsuite/jx/issues/620)) ([532065f](https://github.com/jxsuite/jx/commit/532065f36ca0f629eb0add3e4bb089a3d1719b30))
* **security:** generic 500s, sign-out cache clearing, consistent framing, hashed speculation rules ([#624](https://github.com/jxsuite/jx/issues/624)) ([0048a69](https://github.com/jxsuite/jx/commit/0048a69ffd81b2e1adae1f0d6c88288c80623b5c))
* **server:** the site worker refuses cross-site calls and its answers stay out of caches ([#621](https://github.com/jxsuite/jx/issues/621)) ([0a6ba0d](https://github.com/jxsuite/jx/commit/0a6ba0dd614c3f0d26b43ba37547d785398ec3c6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.8.1
    * @jxsuite/erase bumped to 0.3.0
    * @jxsuite/runtime bumped to 7.0.0
    * @jxsuite/schema bumped to 6.0.0
    * @jxsuite/site bumped to 2.7.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.9
    * @jxsuite/parser bumped to 5.0.0

## [8.6.0](https://github.com/jxsuite/jx/compare/compiler-v8.5.0...compiler-v8.6.0) (2026-11-11)


### Features

* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **studio,compiler:** a picture's focal point lives in the picture ([#591](https://github.com/jxsuite/jx/issues/591)) ([d87ce76](https://github.com/jxsuite/jx/commit/d87ce76d12805d0d5b217629a37f4639a16def49))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.8.0
    * @jxsuite/erase bumped to 0.2.0
    * @jxsuite/runtime bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0
    * @jxsuite/site bumped to 2.6.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.8
    * @jxsuite/parser bumped to 4.3.4

## [8.5.0](https://github.com/jxsuite/jx/compare/compiler-v8.4.0...compiler-v8.5.0) (2026-11-08)


### Features

* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.7.0
    * @jxsuite/erase bumped to 0.1.0
    * @jxsuite/runtime bumped to 6.2.2
    * @jxsuite/schema bumped to 5.5.0
    * @jxsuite/site bumped to 2.5.1
  * devDependencies
    * @jxsuite/connector bumped to 0.8.7
    * @jxsuite/parser bumped to 4.3.3

## [8.4.0](https://github.com/jxsuite/jx/compare/compiler-v8.3.0...compiler-v8.4.0) (2026-11-08)


### Features

* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))


### Bug Fixes

* **compiler:** encode image variant URLs, and key the image cache on the file name ([#566](https://github.com/jxsuite/jx/issues/566)) ([17fbe13](https://github.com/jxsuite/jx/commit/17fbe13b40a0bf09ae05274a519fd49315d871ea))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.6.0
    * @jxsuite/runtime bumped to 6.2.1
    * @jxsuite/schema bumped to 5.4.0
    * @jxsuite/site bumped to 2.5.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.6
    * @jxsuite/parser bumped to 4.3.2

## [8.3.0](https://github.com/jxsuite/jx/compare/compiler-v8.2.0...compiler-v8.3.0) (2026-11-07)


### Features

* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.5.5
    * @jxsuite/runtime bumped to 6.2.0
    * @jxsuite/schema bumped to 5.3.0
    * @jxsuite/site bumped to 2.4.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.5
    * @jxsuite/parser bumped to 4.3.1

## [8.2.0](https://github.com/jxsuite/jx/compare/compiler-v8.1.0...compiler-v8.2.0) (2026-11-06)


### Features

* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.5.4
    * @jxsuite/runtime bumped to 6.1.0
    * @jxsuite/schema bumped to 5.2.0
    * @jxsuite/site bumped to 2.3.1
  * devDependencies
    * @jxsuite/connector bumped to 0.8.4
    * @jxsuite/parser bumped to 4.3.0

## [8.1.0](https://github.com/jxsuite/jx/compare/compiler-v8.0.2...compiler-v8.1.0) (2026-11-04)


### Features

* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.5.3
    * @jxsuite/runtime bumped to 6.0.2
    * @jxsuite/schema bumped to 5.1.0
    * @jxsuite/site bumped to 2.3.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.3
    * @jxsuite/parser bumped to 4.2.0

## [8.0.2](https://github.com/jxsuite/jx/compare/compiler-v8.0.1...compiler-v8.0.2) (2026-11-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.5.2

## [8.0.1](https://github.com/jxsuite/jx/compare/compiler-v8.0.0...compiler-v8.0.1) (2026-10-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.5.1

## [8.0.0](https://github.com/jxsuite/jx/compare/compiler-v7.0.0...compiler-v8.0.0) (2026-10-29)


### ⚠ BREAKING CHANGES

* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))

### Features

* **compiler:** the bundler backend follows the runtime, esbuild on Node and Bun.build on Bun ([92c85db](https://github.com/jxsuite/jx/commit/92c85db1d3617ba9915de38aa7eb5888ddc6fa6d))
* **desktop:** the backend runs on Electron's Node in a utility process, and the app no longer ships Bun ([92c85db](https://github.com/jxsuite/jx/commit/92c85db1d3617ba9915de38aa7eb5888ddc6fa6d))
* **schema:** a runtime-neutral which ([92c85db](https://github.com/jxsuite/jx/commit/92c85db1d3617ba9915de38aa7eb5888ddc6fa6d))
* **server:** package operations run on npm's Arborist and write package-lock.json, and a lockfile-only package service serves the cloud ([92c85db](https://github.com/jxsuite/jx/commit/92c85db1d3617ba9915de38aa7eb5888ddc6fa6d))
* **server:** serve, file responses and globbing run on Node as well as Bun ([92c85db](https://github.com/jxsuite/jx/commit/92c85db1d3617ba9915de38aa7eb5888ddc6fa6d))
* **studio:** the cloud editor adds, removes and updates packages through the package service ([92c85db](https://github.com/jxsuite/jx/commit/92c85db1d3617ba9915de38aa7eb5888ddc6fa6d))


### Bug Fixes

* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* the release PR's smoke test installs this checkout, and npm can no longer hang a build ([#515](https://github.com/jxsuite/jx/issues/515)) ([66208f7](https://github.com/jxsuite/jx/commit/66208f7e27eab9535537d1de63a8bb8e897a04d8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.5.0
    * @jxsuite/runtime bumped to 6.0.1
    * @jxsuite/schema bumped to 5.0.0
    * @jxsuite/site bumped to 2.2.2
  * devDependencies
    * @jxsuite/connector bumped to 0.8.2
    * @jxsuite/parser bumped to 4.1.2

## [7.0.0](https://github.com/jxsuite/jx/compare/compiler-v6.1.0...compiler-v7.0.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))

### Features

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))


### Bug Fixes

* **runtime:** an & after a context in a nested style key is the scope ([#497](https://github.com/jxsuite/jx/issues/497)) ([c1e6119](https://github.com/jxsuite/jx/commit/c1e6119bf27bdc70b5df0177145773f196ad07e2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.4.1
    * @jxsuite/runtime bumped to 6.0.0
    * @jxsuite/schema bumped to 4.1.0
    * @jxsuite/site bumped to 2.2.1
  * devDependencies
    * @jxsuite/connector bumped to 0.8.1
    * @jxsuite/parser bumped to 4.1.1

## [6.1.0](https://github.com/jxsuite/jx/compare/compiler-v6.0.2...compiler-v6.1.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.4.0
    * @jxsuite/runtime bumped to 5.2.0
    * @jxsuite/site bumped to 2.2.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.0
    * @jxsuite/parser bumped to 4.1.0

## [6.0.2](https://github.com/jxsuite/jx/compare/compiler-v6.0.1...compiler-v6.0.2) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.17
    * @jxsuite/runtime bumped to 5.1.0
    * @jxsuite/site bumped to 2.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.7.0
    * @jxsuite/parser bumped to 4.0.1

## [6.0.1](https://github.com/jxsuite/jx/compare/compiler-v6.0.0...compiler-v6.0.1) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.16
  * devDependencies
    * @jxsuite/parser bumped to 4.0.0

## [6.0.0](https://github.com/jxsuite/jx/compare/compiler-v5.1.3...compiler-v6.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.15
    * @jxsuite/runtime bumped to 5.0.0
    * @jxsuite/schema bumped to 4.0.0
    * @jxsuite/site bumped to 2.0.5
  * devDependencies
    * @jxsuite/connector bumped to 0.6.3
    * @jxsuite/parser bumped to 3.0.0

## [5.1.3](https://github.com/jxsuite/jx/compare/compiler-v5.1.2...compiler-v5.1.3) (2026-10-16)


### Bug Fixes

* **compiler:** re-root the $src import URLs of component and page modules on the base path ([#454](https://github.com/jxsuite/jx/issues/454)) ([9ec4815](https://github.com/jxsuite/jx/commit/9ec481525d63e283982d138b08d11cbb530557a9))

## [5.1.2](https://github.com/jxsuite/jx/compare/compiler-v5.1.1...compiler-v5.1.2) (2026-10-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.14
    * @jxsuite/runtime bumped to 4.1.0
    * @jxsuite/site bumped to 2.0.4
  * devDependencies
    * @jxsuite/parser bumped to 2.0.1

## [5.1.1](https://github.com/jxsuite/jx/compare/compiler-v5.1.0...compiler-v5.1.1) (2026-10-07)


### Bug Fixes

* **compiler:** write no Markdown twin for the not-found page ([#438](https://github.com/jxsuite/jx/issues/438)) ([26a4657](https://github.com/jxsuite/jx/commit/26a4657c06a859cbafd4ee038343eb1a98fd8a28))

## [5.1.0](https://github.com/jxsuite/jx/compare/compiler-v5.0.0...compiler-v5.1.0) (2026-10-07)


### Features

* **compiler:** advertise each page's Markdown twin with a link rel=alternate ([#435](https://github.com/jxsuite/jx/issues/435)) ([0f4b89b](https://github.com/jxsuite/jx/commit/0f4b89be8819bd9b00dc7ea51a4e29c3224492de))


### Bug Fixes

* **compiler:** canonical and sitemap URLs follow trailingSlash; write the 404 page to 404.html ([#433](https://github.com/jxsuite/jx/issues/433)) ([f467fa2](https://github.com/jxsuite/jx/commit/f467fa293b88ad9a78e701f7eaa12cbe7e37d5e0))
* **compiler:** load extension implementations under Node, so jx build runs without bun ([#432](https://github.com/jxsuite/jx/issues/432)) ([c223ad9](https://github.com/jxsuite/jx/commit/c223ad95f9b54ce0b0da3cc79d494c0fe6d9fdb0))

## [5.0.0](https://github.com/jxsuite/jx/compare/compiler-v4.0.3...compiler-v5.0.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.13
    * @jxsuite/runtime bumped to 4.0.3
    * @jxsuite/schema bumped to 3.0.0
    * @jxsuite/site bumped to 2.0.3
  * devDependencies
    * @jxsuite/connector bumped to 0.6.2
    * @jxsuite/parser bumped to 2.0.0

## [4.0.3](https://github.com/jxsuite/jx/compare/compiler-v4.0.2...compiler-v4.0.3) (2026-10-06)


### Bug Fixes

* **compiler:** declare the import map in head ahead of the modulepreload hints ([0433318](https://github.com/jxsuite/jx/commit/0433318a328c557d74972f58973c87b95ccf7cb6))
* **compiler:** declare the import map in head ahead of the modulepreload hints ([88ca901](https://github.com/jxsuite/jx/commit/88ca9018bfbc311186227a29e62a93751c928e1f))

## [4.0.2](https://github.com/jxsuite/jx/compare/compiler-v4.0.1...compiler-v4.0.2) (2026-09-29)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.12
    * @jxsuite/runtime bumped to 4.0.2
    * @jxsuite/schema bumped to 2.3.0
    * @jxsuite/site bumped to 2.0.2
  * devDependencies
    * @jxsuite/connector bumped to 0.6.1
    * @jxsuite/parser bumped to 1.8.2

## [4.0.1](https://github.com/jxsuite/jx/compare/compiler-v4.0.0...compiler-v4.0.1) (2026-09-14)


### Bug Fixes

* **compiler,site:** compileStyles delegates the project block to buildSiteStyleCSS ([0911986](https://github.com/jxsuite/jx/commit/0911986e7db670541d46fb06077fc4972e043489))
* **compiler,site:** compileStyles delegates the project block to buildSiteStyleCSS ([0fd80c1](https://github.com/jxsuite/jx/commit/0fd80c1d69059aeb76a7c9b7dc2de1eb0f0a974f)), closes [#329](https://github.com/jxsuite/jx/issues/329)
* **compiler:** a shared component dependency is inlined and loaded once per page ([36237bd](https://github.com/jxsuite/jx/commit/36237bdaacd36ab5db24bbe0f37d5860eff5ae6b))
* **compiler:** a shared component dependency is inlined and loaded once per page ([d0437ec](https://github.com/jxsuite/jx/commit/d0437ec4c35c2a7f4258f3ffc4a0f6bd00ec8f94)), closes [#330](https://github.com/jxsuite/jx/issues/330)
* **runtime:** a definition that instantiates its own tag is refused instead of hanging ([a48a040](https://github.com/jxsuite/jx/commit/a48a040ca73a5fa74bc7655191ec87c519ccfb5f))
* **runtime:** a definition that instantiates its own tag is refused instead of hanging ([722a091](https://github.com/jxsuite/jx/commit/722a0914144c1d287182ec3954155dc22983ba2a)), closes [#320](https://github.com/jxsuite/jx/issues/320)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.11
    * @jxsuite/runtime bumped to 4.0.1
    * @jxsuite/site bumped to 2.0.1
  * devDependencies
    * @jxsuite/parser bumped to 1.8.1

## [4.0.0](https://github.com/jxsuite/jx/compare/compiler-v3.1.0...compiler-v4.0.0) (2026-09-14)


### ⚠ BREAKING CHANGES

* **runtime,compiler,site,studio:** `@jxsuite/runtime` no longer writes authored declarations to `el.style`, so code reading them back off an element after `applyStyle` sees nothing. The `elementStyleTags` export is replaced by `releaseElementStyles` and `resetDocumentStyles`, which refcount a shared rule set rather than handing out an element to remove by hand; `documentStyleText` reads back what was written.

### Features

* popovers become a first-class thing the canvas can open, and a rule it can check ([63e5916](https://github.com/jxsuite/jx/commit/63e5916c7aa1b41771bed4029960192582b52c0f))
* **runtime,compiler,site,studio:** authored styles become adopted CSS rules ([d3a4fe1](https://github.com/jxsuite/jx/commit/d3a4fe19cbd50322a08a4230d8c62f811d0d256f))
* **runtime,studio:** dialogs, invoker commands and inert on the canvas ([4a1455e](https://github.com/jxsuite/jx/commit/4a1455ee6d0b86228c840529998d9fbed62e4442))
* **schema,runtime,compiler,site:** a style value may read state ([01e74c7](https://github.com/jxsuite/jx/commit/01e74c7f2d43cdcc9a3107b4ab30de4f769922d1))
* **schema,studio,compiler:** accessibility rules, judged alike by Studio, jx validate and the tests ([c14d121](https://github.com/jxsuite/jx/commit/c14d121e128bf64c041c401b8b0514f6133e133c))
* **studio,server,protocol:** one toggle installs an extension and enables it ([1fe5f67](https://github.com/jxsuite/jx/commit/1fe5f6731c00c9421e8dcd8d1ca100d2b06f740e))
* **studio,server,protocol:** one toggle installs an extension and enables it ([17b2627](https://github.com/jxsuite/jx/commit/17b26270db18e23f2f66f7bb15e67db64b2eac22))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **ui,compiler,schema:** jx-popover, jx-tooltip and jx-spinner ([21bc6ba](https://github.com/jxsuite/jx/commit/21bc6ba29f3304ddc3c56ee54de36d5b95fa69f1))


### Bug Fixes

* **compiler:** a component nested inside another component's definition prerenders ([0ccf6d3](https://github.com/jxsuite/jx/commit/0ccf6d303fb43cc96e50aac6ffb6b78bfb8fe554))
* **compiler:** a component nested inside another component's definition prerenders ([f42a1b2](https://github.com/jxsuite/jx/commit/f42a1b2b826e8cab4083d6ca71e4fe3f11a1c234)), closes [#286](https://github.com/jxsuite/jx/issues/286)
* **compiler:** a selector list in a component's own style loses every member but the first ([dedb2d6](https://github.com/jxsuite/jx/commit/dedb2d68bd7eddf1f1cb94d005c900c1c47eb932))
* **compiler:** every boolean-attribute writer defers to booleanAttrValue ([95a6c6a](https://github.com/jxsuite/jx/commit/95a6c6ae2a87fd14a44ccb075f23346987ba5cef))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.10
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0
    * @jxsuite/site bumped to 2.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.6.0
    * @jxsuite/parser bumped to 1.8.0

## [3.1.0](https://github.com/jxsuite/jx/compare/compiler-v3.0.0...compiler-v3.1.0) (2026-08-30)


### Features

* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([c97617a](https://github.com/jxsuite/jx/commit/c97617a27563a776f038e82c3b0bafb5696996da))
* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([e65e1cf](https://github.com/jxsuite/jx/commit/e65e1cf3feed747822e46fc460ff3d978e1e3131)), closes [#235](https://github.com/jxsuite/jx/issues/235)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.9
    * @jxsuite/runtime bumped to 3.1.0
    * @jxsuite/schema bumped to 2.1.0
    * @jxsuite/site bumped to 1.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.7
    * @jxsuite/parser bumped to 1.7.0

## [3.0.0](https://github.com/jxsuite/jx/compare/compiler-v2.0.8...compiler-v3.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* **import:** the site-import workflow, end to end ([f701f33](https://github.com/jxsuite/jx/commit/f701f33bc035a8e5ce331530ff9886d25236da64))
* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))
* **site,compiler:** the docs sidebar folds into accordions that open to the current page ([3bb554c](https://github.com/jxsuite/jx/commit/3bb554c006591ba0a77396c3600e558301f63432))
* **site,compiler:** the docs sidebar folds into accordions that open to the current page ([92c342d](https://github.com/jxsuite/jx/commit/92c342d0bca15994bd3b170dd298d134c32c5239))
* **site,compiler:** the docs sidebar folds into accordions that open to the current page ([3934d00](https://github.com/jxsuite/jx/commit/3934d002307ddc61d0f930b95aa2dc4d569148d9))


### Bug Fixes

* **compiler:** write the runtime bundles every emitted import map names ([af43b6f](https://github.com/jxsuite/jx/commit/af43b6fde25fe3f9f69c0e82f1a2b46f09044161)), closes [#227](https://github.com/jxsuite/jx/issues/227)
* **runtime,compiler:** one boolean-attribute rule, and it knows the two families ([6ef3a24](https://github.com/jxsuite/jx/commit/6ef3a243bc2ca18ed08aefbc95a3f50f49c5d824))
* **runtime,compiler:** one boolean-attribute rule, and it knows the two families ([0853bd6](https://github.com/jxsuite/jx/commit/0853bd6b09a730e425067cd45d4d57a7b9709394))


### Performance Improvements

* **compiler:** minify bundles, inline component CSS, preload the runtime ([502238b](https://github.com/jxsuite/jx/commit/502238baa06c81b02fcc2853017c54de6a23526c))
* **compiler:** minify bundles, inline component CSS, preload the runtime ([78dcc89](https://github.com/jxsuite/jx/commit/78dcc89496ad90f6fa0f9369f1c6e6b9d2538641))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.8
    * @jxsuite/runtime bumped to 3.0.0
    * @jxsuite/schema bumped to 2.0.0
    * @jxsuite/site bumped to 1.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.6
    * @jxsuite/parser bumped to 1.6.0

## [2.0.8](https://github.com/jxsuite/jx/compare/compiler-v2.0.7...compiler-v2.0.8) (2026-08-26)


### Bug Fixes

* **compiler,runtime,studio:** a bare media type in an at-key emits without parentheses ([79b6fd6](https://github.com/jxsuite/jx/commit/79b6fd69bfbdec9de399790c51cbc874614f6c57))
* **compiler,runtime:** a component whose content is root textContent renders it ([fef0ef1](https://github.com/jxsuite/jx/commit/fef0ef15211af9ceccd47f176ae18b608457cc3f))
* **compiler:** a non-static component instance keeps its props through hydration ([c36b32f](https://github.com/jxsuite/jx/commit/c36b32faa41b41663c5b4afecd3e9e0131185dc9))
* **compiler:** a template with more than one interpolation resolves instead of emptying ([c3af8ed](https://github.com/jxsuite/jx/commit/c3af8edf8a5b31633e60891bcf0331c326c5a4db))
* **compiler:** the client runtime resolves under Node, so builds stop reaching for a CDN ([3b8a914](https://github.com/jxsuite/jx/commit/3b8a914d8d7dc745edab8e01efe055989462fa56))
* six output-correctness defects, two of them live on jxsuite.com ([67663a9](https://github.com/jxsuite/jx/commit/67663a97b062313b3dc419e99fef556ed70539e5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.7
    * @jxsuite/runtime bumped to 2.1.0
    * @jxsuite/schema bumped to 1.9.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.5
    * @jxsuite/parser bumped to 1.5.6

## [2.0.7](https://github.com/jxsuite/jx/compare/compiler-v2.0.6...compiler-v2.0.7) (2026-08-25)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.6
    * @jxsuite/runtime bumped to 2.0.5
    * @jxsuite/schema bumped to 1.8.1
  * devDependencies
    * @jxsuite/connector bumped to 0.5.4
    * @jxsuite/parser bumped to 1.5.5

## [2.0.6](https://github.com/jxsuite/jx/compare/compiler-v2.0.5...compiler-v2.0.6) (2026-08-24)


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @jxsuite/connector bumped to 0.5.3

## [2.0.5](https://github.com/jxsuite/jx/compare/compiler-v2.0.4...compiler-v2.0.5) (2026-08-24)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.5
    * @jxsuite/runtime bumped to 2.0.4
  * devDependencies
    * @jxsuite/parser bumped to 1.5.4

## [2.0.4](https://github.com/jxsuite/jx/compare/compiler-v2.0.3...compiler-v2.0.4) (2026-08-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.4
    * @jxsuite/runtime bumped to 2.0.3
  * devDependencies
    * @jxsuite/parser bumped to 1.5.3

## [2.0.3](https://github.com/jxsuite/jx/compare/compiler-v2.0.2...compiler-v2.0.3) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.3

## [2.0.2](https://github.com/jxsuite/jx/compare/compiler-v2.0.1...compiler-v2.0.2) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.2
    * @jxsuite/runtime bumped to 2.0.2
    * @jxsuite/schema bumped to 1.8.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.2
    * @jxsuite/parser bumped to 1.5.2

## [2.0.1](https://github.com/jxsuite/jx/compare/compiler-v2.0.0...compiler-v2.0.1) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.1
    * @jxsuite/runtime bumped to 2.0.1
    * @jxsuite/schema bumped to 1.7.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.1
    * @jxsuite/parser bumped to 1.5.1

## [2.0.0](https://github.com/jxsuite/jx/compare/compiler-v1.5.0...compiler-v2.0.0) (2026-08-19)


### ⚠ BREAKING CHANGES

* **runtime:** #/state/a/b.c addresses member "b.c" of "a" rather than walking three levels. 451 of 452 pointers in the corpus are pure-slash and the one dotted ref was in the spec sentence describing the behavior.

### Features

* **compiler:** an optional service worker, and the tombstone that removes it ([e7a1bae](https://github.com/jxsuite/jx/commit/e7a1baeb9daac3f271a7e3e926e1a37fc58f646a))
* **compiler:** check link relations against the IANA registry ([ffdca1c](https://github.com/jxsuite/jx/commit/ffdca1ca5df0129140272b759c0727e689158d56))
* **compiler:** compile $switch on a dynamic page ([#127](https://github.com/jxsuite/jx/issues/127)) ([98304e0](https://github.com/jxsuite/jx/commit/98304e0685878b172ba1e7b77252c4a606578e22))
* **compiler:** date a generated route by its entry, not by the template ([a3afe54](https://github.com/jxsuite/jx/commit/a3afe54d59a7cf487947e0fca31c9f6b97db8c92))
* **compiler:** emit a Content-Security-Policy derived from the built pages ([ce4f8dd](https://github.com/jxsuite/jx/commit/ce4f8dd41cd622aec2affe5663476480bd835f4c))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** generate manifest.webmanifest and .well-known/security.txt ([c77685e](https://github.com/jxsuite/jx/commit/c77685eba7af7774b2df18d296ecf330fd2b3dd4))
* **compiler:** locale routing — the i18n config finally has a reader ([c5151e0](https://github.com/jxsuite/jx/commit/c5151e0265d5befff04503a511b7cecc15b11f4d))
* **compiler:** negotiate a locale, expand {locale} sources, and check prefix-always ([8477348](https://github.com/jxsuite/jx/commit/84773489bcef6cbb4c820351ca9d379c8e97fe77))
* **compiler:** opt into a shadow root with $shadow ([ca5188b](https://github.com/jxsuite/jx/commit/ca5188ba741844c6001c2b500b343cde9f24ddd0))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* **compiler:** serve the client runtime from the site, not from esm.sh ([b57f3bf](https://github.com/jxsuite/jx/commit/b57f3bf750fe1fec5c64a2b0f856968e8e861e2f))
* **compiler:** translated pages advertise each other ([57dde13](https://github.com/jxsuite/jx/commit/57dde1343fe301a633fc5577f3249ff161603240))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a collection is localized end to end, and a starter proves it ([22661a6](https://github.com/jxsuite/jx/commit/22661a6845f211362280bba71b3cee0bb5d7f809))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** a page can render its own language switcher, and formats in its own language ([035970d](https://github.com/jxsuite/jx/commit/035970d6cf99cdec9bce11b2c9dddae5e09a2cef))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **runtime:** enforce private state against $props (spec.md §5.6) ([5e9b029](https://github.com/jxsuite/jx/commit/5e9b0299ad116be4ff61af4e1d3569ad0a6323e9))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** parse media types, and enforce I-JSON at the document boundary ([068811e](https://github.com/jxsuite/jx/commit/068811e83278b0b55d82dd2e88ff838bfabfd05e))
* **schema:** serve markdown and YAML under the media types their RFCs register ([8e8c1f9](https://github.com/jxsuite/jx/commit/8e8c1f9f418a6e516f7e64745fd5c87a64c8b642))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler,starters:** a project's own node_modules stops answering for the Jx schema ([7e28247](https://github.com/jxsuite/jx/commit/7e282471d989bb2622eaa7c4ee3c1cceef4c1917))
* **compiler:** a runtime subpath asset that imports itself (site-architecture.md §8.7) ([4fd3f03](https://github.com/jxsuite/jx/commit/4fd3f03424f2693feffdcac84ab9c362d05f52c4))
* **compiler:** emit IDL properties, and hoist shared branch subtrees ([#121](https://github.com/jxsuite/jx/issues/121), [#126](https://github.com/jxsuite/jx/issues/126)) ([356d762](https://github.com/jxsuite/jx/commit/356d7624a42959404935e83eac0bf9c3d7ea69a8))
* **compiler:** emit project style on the custom-element route ([#123](https://github.com/jxsuite/jx/issues/123)) ([6705c20](https://github.com/jxsuite/jx/commit/6705c20beaa7ff2cfdcd773dfea289ea3ead55b2))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* **compiler:** keep array state a runtime reader still needs ([#122](https://github.com/jxsuite/jx/issues/122)) ([c122b58](https://github.com/jxsuite/jx/commit/c122b587bc9009462b758c8cb4c52ba2d126abf3))
* **compiler:** keep prerender from baking over mutable state ([#124](https://github.com/jxsuite/jx/issues/124), [#125](https://github.com/jxsuite/jx/issues/125)) ([54a9931](https://github.com/jxsuite/jx/commit/54a9931e90a79f38a094bff21a15bc3c9c39c587))
* **compiler:** make npm web components work in a built site ([8209fe4](https://github.com/jxsuite/jx/commit/8209fe409a2cf184e05b2eb64caa3a6760c2f6de))
* **compiler:** package files in $head and $elements land in /assets/, not /node_modules/ ([ae4f2bd](https://github.com/jxsuite/jx/commit/ae4f2bd503e07863af51acac60d49b07520d9437))
* **compiler:** resolve the open issue sweep ([#121](https://github.com/jxsuite/jx/issues/121)–[#127](https://github.com/jxsuite/jx/issues/127)) ([fd220b8](https://github.com/jxsuite/jx/commit/fd220b8db68c132039b59f229d2a53194791395d))
* **compiler:** sitemap lastmod is a full RFC 3339 timestamp ([c726108](https://github.com/jxsuite/jx/commit/c726108e3f3eb3d2d25d532abb59376efe9e2a97))
* **desktop:** the Nix bundle deleted the extension packages it depends on ([b3fc5bb](https://github.com/jxsuite/jx/commit/b3fc5bbe1a22fdd506a81f3b0339c619f29ec760))
* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **runtime:** one $ref tokenizer, so every lowered ref parses ([23cdfdd](https://github.com/jxsuite/jx/commit/23cdfdd67cd788764a9256475be7f76e71dc08e0))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **studio,compiler:** the disagree-with-itself families, and a computed the compiler never compiled ([675a69e](https://github.com/jxsuite/jx/commit/675a69e65b5c79a294f90a40e633477f21dd3e2a))


### Reverts

* **studio:** stop reporting Trusted Types violations nobody can act on ([6bab956](https://github.com/jxsuite/jx/commit/6bab956c0142b9bd1935a4d6da70f96fc01e8ccd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.0
    * @jxsuite/runtime bumped to 2.0.0
    * @jxsuite/schema bumped to 1.6.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.0
    * @jxsuite/parser bumped to 1.5.0

## [1.5.0](https://github.com/jxsuite/jx/compare/compiler-v1.4.0...compiler-v1.5.0) (2026-07-30)


### Features

* better search results ([df8bb65](https://github.com/jxsuite/jx/commit/df8bb65572a88356690bc85825b6e73e63c243de))
* **schema:** make per-project schema composition host-agnostic ([70e4580](https://github.com/jxsuite/jx/commit/70e4580f6f49d254cfd431585ae577ee9f111a67))
* **schema:** make per-project schema composition host-agnostic ([32d5cbd](https://github.com/jxsuite/jx/commit/32d5cbd05c7c6a303ae454d3c11057aa1e74a123))


### Bug Fixes

* **compiler:** close eight element-target and prerender conformance gaps ([a0fb927](https://github.com/jxsuite/jx/commit/a0fb9271886b81f7b074149403cc5cc962edca0d))
* **compiler:** close five adjacent element-target defects found while fixing [#106](https://github.com/jxsuite/jx/issues/106)-113 ([1fd607a](https://github.com/jxsuite/jx/commit/1fd607a8bcfc86fc6e26a060b966db64591f44ca))
* **compiler:** proper handling of white-space: pre ([3d2db4e](https://github.com/jxsuite/jx/commit/3d2db4e6e477c9c42c32e25050d28978bf9effff))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.2.2
    * @jxsuite/runtime bumped to 1.3.2
    * @jxsuite/schema bumped to 1.5.0
  * devDependencies
    * @jxsuite/connector bumped to 0.4.2
    * @jxsuite/parser bumped to 1.4.1

## [1.4.0](https://github.com/jxsuite/jx/compare/compiler-v1.3.0...compiler-v1.4.0) (2026-07-24)


### Features

* support external/relative asset files ([7cbe138](https://github.com/jxsuite/jx/commit/7cbe138a1f2ecaa77599ca7112162b526e7bd5bc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.2.1
    * @jxsuite/runtime bumped to 1.3.1
    * @jxsuite/schema bumped to 1.4.0
  * devDependencies
    * @jxsuite/connector bumped to 0.4.1
    * @jxsuite/parser bumped to 1.4.0

## [1.3.0](https://github.com/jxsuite/jx/compare/compiler-v1.2.0...compiler-v1.3.0) (2026-07-22)


### Features

* **compiler:** bundled entry documents and whole-project jx validate ([a213bab](https://github.com/jxsuite/jx/commit/a213babf7fc492cf8f8fd81b7f2035f5a2a9ae89))
* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Bug Fixes

* harden dev server and unify runtime/compiler evaluation ([775c393](https://github.com/jxsuite/jx/commit/775c393b5010a304c2a5bf6759b2dfc5ca3bcc80))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.2.0
    * @jxsuite/runtime bumped to 1.3.0
    * @jxsuite/schema bumped to 1.3.0
  * devDependencies
    * @jxsuite/connector bumped to 0.4.0
    * @jxsuite/parser bumped to 1.3.0

## [1.2.0](https://github.com/jxsuite/jx/compare/compiler-v1.1.0...compiler-v1.2.0) (2026-07-18)


### Features

* color scheme support ([6334a09](https://github.com/jxsuite/jx/commit/6334a09694aa742e11082b386bcf93305df60477))
* **compiler:** bundle the site worker self-contained per adapter ([da0e3d3](https://github.com/jxsuite/jx/commit/da0e3d3b03d07e041de7ee30b55158b34ea2315a))
* **compiler:** sidecar bundling, extension emit capability, heading anchors ([a360333](https://github.com/jxsuite/jx/commit/a3603333937364ba7753b72ec6bf77138cbe7e42))
* search package ([e8966f3](https://github.com/jxsuite/jx/commit/e8966f35ba0e1b6dd0da23526ef1a00631ad80d6))
* **styling:** forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script ([3f7a046](https://github.com/jxsuite/jx/commit/3f7a04690d34cd803e9fd00dd87ae7e1a2d9389e))


### Bug Fixes

* **ci:** green the Test workflow — type-aware lint, coverage gates, docs drift ([5d72f0f](https://github.com/jxsuite/jx/commit/5d72f0f9f49734142b80df155ba5c74987d25a97))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.1.1
    * @jxsuite/runtime bumped to 1.2.0
    * @jxsuite/schema bumped to 1.2.0
  * devDependencies
    * @jxsuite/connector bumped to 0.3.1
    * @jxsuite/parser bumped to 1.2.0

## [1.1.0](https://github.com/jxsuite/jx/compare/compiler-v1.0.0...compiler-v1.1.0) (2026-07-17)


### Features

* **compiler,server,create:** jx dev and jx preview — the scaffolded scripts now work ([94c9c15](https://github.com/jxsuite/jx/commit/94c9c156a4ad5d65c2282502212fbd3c22e6130a))
* **docs,parser:** /docs platform — nested ids, nav sidebar, traceability, generated references ([9282436](https://github.com/jxsuite/jx/commit/9282436f0e91ef7b8c11039f6a11aabf5147dafa))
* image pruning for persistent site build cache + github ci cache ([5c995a8](https://github.com/jxsuite/jx/commit/5c995a8a7204ea632940ff0b3c3db65239133c00))
* **runtime,compiler:** named formulas — call operator, $args scheme, blessed globals ([ae4ad2d](https://github.com/jxsuite/jx/commit/ae4ad2ddfab8601bd101a46830fff6e10f4a999c))
* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))


### Bug Fixes

* **studio,compiler,parser,protocol,auth:** keep the promises the docs audit surfaced ([86740a9](https://github.com/jxsuite/jx/commit/86740a9364079016dd411682bc67ac75bc39e89a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.1.0
    * @jxsuite/runtime bumped to 1.1.0
    * @jxsuite/schema bumped to 1.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.3.0
    * @jxsuite/parser bumped to 1.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/compiler-v0.35.0...compiler-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- hosts switch to the extension model; migrate all projects to content sections

### Features

- **auth:** Better Auth extension — sessions, permissions, auth-gated data ([32c871e](https://github.com/jxsuite/jx/commit/32c871e9fe48fdeed62e030354cc05adbf6efd19))
- **connector:** dynamic data tables extension — Kysely core, /_jx/data mount, db push ([65e0d35](https://github.com/jxsuite/jx/commit/65e0d35bf99924b2cd7aa548d02e29e8441ba6ed))
- hosts switch to the extension model; migrate all projects to content sections ([b2c0e27](https://github.com/jxsuite/jx/commit/b2c0e27c08e649af334fdf67ccf6abbb73c480dc))
- **markup:** shared markup-conversion core package; sever studio/import from parser ([41141a1](https://github.com/jxsuite/jx/commit/41141a15ba51aa6f58ba1dee78731f15893eaff8))
- **studio:** descriptor-contributed settings + fetched project schemas ([b85afaf](https://github.com/jxsuite/jx/commit/b85afaf9f6d340e1d916ad399fc758df36ced2e1))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/create bumped to 1.0.0
    - @jxsuite/runtime bumped to 1.0.0
    - @jxsuite/schema bumped to 1.0.0
  - devDependencies
    - @jxsuite/connector bumped to 0.2.0
    - @jxsuite/parser bumped to 1.0.0

## [0.35.0](https://github.com/jxsuite/jx/compare/compiler-v0.34.1...compiler-v0.35.0) (2026-07-07)

### Features

- **schema:** build.deploy tracking block; fix stale adapter enum ([c531f46](https://github.com/jxsuite/jx/commit/c531f462658da2e4805ec686f3c7ca27c7334970))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/parser bumped to 0.35.1
    - @jxsuite/runtime bumped to 0.34.2
    - @jxsuite/schema bumped to 0.35.0

## [0.34.1](https://github.com/jxsuite/jx/compare/compiler-v0.34.0...compiler-v0.34.1) (2026-07-06)

### Bug Fixes

- **compiler:** proper handling of default content ([39fe2ed](https://github.com/jxsuite/jx/commit/39fe2ed34ce82aafd6459d7452be4b0b8650bc0f))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/parser bumped to 0.35.0
    - @jxsuite/runtime bumped to 0.34.1
