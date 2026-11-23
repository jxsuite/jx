# Changelog

## [13.2.0](https://github.com/jxsuite/jx/compare/studio-v13.1.0...studio-v13.2.0) (2026-11-23)


### Features

* **protocol,studio:** the cloud binding of project state, and Studio's half of it ([#732](https://github.com/jxsuite/jx/issues/732)) ([7206f61](https://github.com/jxsuite/jx/commit/7206f614d16d9807952c4073c68064b226aa4d93))
* **server:** a rename is one operation that completes or rolls back ([#731](https://github.com/jxsuite/jx/issues/731)) ([5fb6a0a](https://github.com/jxsuite/jx/commit/5fb6a0a35b6e91fd98641c261e9084e78f25400f))
* **server:** the dev server serves project state and keys collab rooms by document ([#728](https://github.com/jxsuite/jx/issues/728)) ([bf16222](https://github.com/jxsuite/jx/commit/bf162221a5b26a169ab36a6fc378b9bd974c85df))
* **studio:** convert a whole project between .json and .jxn from Project settings ([#717](https://github.com/jxsuite/jx/issues/717)) ([8d25ea7](https://github.com/jxsuite/jx/commit/8d25ea780feca9cc8623c1741037de20b735035c))
* **studio:** every bindable row carries the value-source switcher ([#733](https://github.com/jxsuite/jx/issues/733)) ([936a693](https://github.com/jxsuite/jx/commit/936a693550dea6482cb19e2558b2c3c50e15fde5))
* **studio:** one content store keyed by document and hash, with buffers held against a base ([#729](https://github.com/jxsuite/jx/issues/729)) ([0db299c](https://github.com/jxsuite/jx/commit/0db299cdcb24c3ee3a490b10039a5fc28560be72))
* **studio:** previews draw in one isolated preview realm ([#730](https://github.com/jxsuite/jx/issues/730)) ([3121fd9](https://github.com/jxsuite/jx/commit/3121fd928e6cb9a711fd20486d8bc88c01a9dc2b))
* **studio:** progress view while a project opens, and a dialog when it fails ([#707](https://github.com/jxsuite/jx/issues/707)) ([517588a](https://github.com/jxsuite/jx/commit/517588a5e8db46ceff237ecd20c86b6549627b0b))


### Bug Fixes

* **studio,desktop,server,runtime:** project state stays current after open, install and edits ([#721](https://github.com/jxsuite/jx/issues/721)) ([b096332](https://github.com/jxsuite/jx/commit/b09633266ab45d19abd3c722bcfa43ee1b97b1e3))
* **studio,desktop:** report a missing recent project, and open no blank Untitled tab ([#713](https://github.com/jxsuite/jx/issues/713)) ([1d825c2](https://github.com/jxsuite/jx/commit/1d825c22dbadf437130ddf61676de4a4d2ef5f29))
* **studio:** a preview is bounded by its card ([#734](https://github.com/jxsuite/jx/issues/734)) ([099bcf2](https://github.com/jxsuite/jx/commit/099bcf2f150d8bf44c46b0e31eb57282cd67ac2e))
* **studio:** Convert to Component wraps the selection instead of replacing its root ([#720](https://github.com/jxsuite/jx/issues/720)) ([0589a29](https://github.com/jxsuite/jx/commit/0589a2979df4b3091b9bc1ffed75fc8845566fb0))
* **studio:** grid paste marks cells dirty; Download/Upload in Grid and Code views ([#716](https://github.com/jxsuite/jx/issues/716)) ([ab80820](https://github.com/jxsuite/jx/commit/ab808205d154ad20577cf0190260daf13428143a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.2
    * @jxsuite/collab bumped to 0.13.0
    * @jxsuite/create bumped to 1.8.7
    * @jxsuite/erase bumped to 0.3.6
    * @jxsuite/formulas bumped to 0.0.39
    * @jxsuite/markup bumped to 1.0.15
    * @jxsuite/protocol bumped to 6.7.0
    * @jxsuite/runtime bumped to 9.0.2
    * @jxsuite/schema bumped to 8.2.0
    * @jxsuite/site bumped to 4.1.1
    * @jxsuite/ui bumped to 0.16.0

## [13.1.0](https://github.com/jxsuite/jx/compare/studio-v13.0.0...studio-v13.1.0) (2026-11-17)


### Features

* **compiler:** csp.sources adds origins to a derived directive ([#694](https://github.com/jxsuite/jx/issues/694)) ([6a6d072](https://github.com/jxsuite/jx/commit/6a6d0725a95c41e629e38461480382ebe7868a34))
* **site:** $page describes the page, so a layout reads its own title and description ([#699](https://github.com/jxsuite/jx/issues/699)) ([08f24b3](https://github.com/jxsuite/jx/commit/08f24b313a170dd453898f942e13ea19f2fdff1c))
* **site:** every layout in a nested chain contributes its head, and a layout cycle is an error ([#695](https://github.com/jxsuite/jx/issues/695)) ([1227f29](https://github.com/jxsuite/jx/commit/1227f295c6374221f6248fadd2170ea286381012))
* **site:** resolve project defs and default the page charset to utf-8 ([#696](https://github.com/jxsuite/jx/issues/696)) ([41b54fc](https://github.com/jxsuite/jx/commit/41b54fc23c806cee10f85e915d3f2f50d52c69a3))


### Bug Fixes

* **site:** keep a page's title off its root element and warn on unrendered head keys ([#698](https://github.com/jxsuite/jx/issues/698)) ([84f1971](https://github.com/jxsuite/jx/commit/84f1971d88a8efeecf3a217daefe0e26e5bdfda1))
* **studio:** refresh source control after every assistant tool call ([#689](https://github.com/jxsuite/jx/issues/689)) ([7358425](https://github.com/jxsuite/jx/commit/73584251b87e1cf02e65ff0f95a6a5a1bf59bdc1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.1
    * @jxsuite/collab bumped to 0.12.5
    * @jxsuite/create bumped to 1.8.6
    * @jxsuite/erase bumped to 0.3.5
    * @jxsuite/formulas bumped to 0.0.38
    * @jxsuite/markup bumped to 1.0.14
    * @jxsuite/protocol bumped to 6.6.1
    * @jxsuite/runtime bumped to 9.0.1
    * @jxsuite/schema bumped to 8.1.0
    * @jxsuite/site bumped to 4.1.0
    * @jxsuite/ui bumped to 0.15.0

## [13.0.0](https://github.com/jxsuite/jx/compare/studio-v12.0.0...studio-v13.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.

### Features

* **ai:** a conversation too long for Claude is summarized, not cut ([36175f8](https://github.com/jxsuite/jx/commit/36175f8937566a7585a5e688d9b47acfaf2ec559))
* **ai:** a persisted conversation behind one session store contract ([231c085](https://github.com/jxsuite/jx/commit/231c085deaf8631ded3b148db4ea9a279912216c))
* **ai:** a suspended turn resumes from a checkpoint ([b8f774e](https://github.com/jxsuite/jx/commit/b8f774ec0a22988d64943dd09dfc159da6d0268e))
* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** native Anthropic Messages with signed thinking replayed where it binds ([9e64acf](https://github.com/jxsuite/jx/commit/9e64acf22c03952e3a31295aa0276fc89a801b53))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))
* **ai:** portable file tools over a ProjectHost, and schema-checked arguments ([80f1b33](https://github.com/jxsuite/jx/commit/80f1b336f97ebb761009eddf9e3d2b83ee95c3ef))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **studio:** a Studio surface opens on the canvas as a realistic instance, drawn with its specimen ([31369f3](https://github.com/jxsuite/jx/commit/31369f3941cd8645df5dc0becb2e61e9117fceef)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **studio:** the assistant asks before a call undo cannot take back ([6edb36a](https://github.com/jxsuite/jx/commit/6edb36aa7c88a45d35c4dcd41777f43a6b4a60aa))
* **ui,studio:** jx-table ships, and Studio's Packages and Library tables are drawn with it ([31b1313](https://github.com/jxsuite/jx/commit/31b1313f6a2f4945bc3c329a40d124dba86897e4)), closes [#301](https://github.com/jxsuite/jx/issues/301)


### Bug Fixes

* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* **studio:** a $switch case that is another document is fetched from the document's folder ([b130d36](https://github.com/jxsuite/jx/commit/b130d36cb94ed0c91e42fc97ae65006973c19acf)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **studio:** a class the backend never resolves holds a canvas render 30 seconds, not for good ([e26831f](https://github.com/jxsuite/jx/commit/e26831f32c804a8f713103015ea15590b6632767)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **studio:** prop-bound text is editable on the canvas wherever the instance delivers the prop ([8ef773f](https://github.com/jxsuite/jx/commit/8ef773f6841e7c24d8624d84e55bc9b6cf1b20ab))
* **studio:** show a failed model listing wherever the catalogue is offered ([1269cb8](https://github.com/jxsuite/jx/commit/1269cb8596ef842835d57f135ccfa4d53013e709))
* **ui:** the kit's build finds its package on Windows ([6b9db81](https://github.com/jxsuite/jx/commit/6b9db81c9e249db7d923666d2e0c2bf18d40b03c))


### Performance Improvements

* **studio:** the Library table writes its table roles on its own boxes again ([4b87c8e](https://github.com/jxsuite/jx/commit/4b87c8e78002217aa38e1a8e4afe5bf002fd2d3d)), closes [#301](https://github.com/jxsuite/jx/issues/301)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.0
    * @jxsuite/collab bumped to 0.12.4
    * @jxsuite/create bumped to 1.8.5
    * @jxsuite/erase bumped to 0.3.4
    * @jxsuite/formulas bumped to 0.0.37
    * @jxsuite/markup bumped to 1.0.13
    * @jxsuite/protocol bumped to 6.6.0
    * @jxsuite/runtime bumped to 9.0.0
    * @jxsuite/schema bumped to 8.0.0
    * @jxsuite/site bumped to 4.0.0
    * @jxsuite/ui bumped to 0.14.0

## [12.0.0](https://github.com/jxsuite/jx/compare/studio-v11.1.0...studio-v12.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.

### Features

* **ai:** a conversation too long for Claude is summarized, not cut ([36175f8](https://github.com/jxsuite/jx/commit/36175f8937566a7585a5e688d9b47acfaf2ec559))
* **ai:** a persisted conversation behind one session store contract ([231c085](https://github.com/jxsuite/jx/commit/231c085deaf8631ded3b148db4ea9a279912216c))
* **ai:** a suspended turn resumes from a checkpoint ([b8f774e](https://github.com/jxsuite/jx/commit/b8f774ec0a22988d64943dd09dfc159da6d0268e))
* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** native Anthropic Messages with signed thinking replayed where it binds ([9e64acf](https://github.com/jxsuite/jx/commit/9e64acf22c03952e3a31295aa0276fc89a801b53))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))
* **ai:** portable file tools over a ProjectHost, and schema-checked arguments ([80f1b33](https://github.com/jxsuite/jx/commit/80f1b336f97ebb761009eddf9e3d2b83ee95c3ef))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **studio:** a Studio surface opens on the canvas as a realistic instance, drawn with its specimen ([31369f3](https://github.com/jxsuite/jx/commit/31369f3941cd8645df5dc0becb2e61e9117fceef)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **studio:** the assistant asks before a call undo cannot take back ([6edb36a](https://github.com/jxsuite/jx/commit/6edb36aa7c88a45d35c4dcd41777f43a6b4a60aa))
* **ui,studio:** jx-table ships, and Studio's Packages and Library tables are drawn with it ([31b1313](https://github.com/jxsuite/jx/commit/31b1313f6a2f4945bc3c329a40d124dba86897e4)), closes [#301](https://github.com/jxsuite/jx/issues/301)


### Bug Fixes

* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* **studio:** a $switch case that is another document is fetched from the document's folder ([b130d36](https://github.com/jxsuite/jx/commit/b130d36cb94ed0c91e42fc97ae65006973c19acf)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **studio:** a class the backend never resolves holds a canvas render 30 seconds, not for good ([e26831f](https://github.com/jxsuite/jx/commit/e26831f32c804a8f713103015ea15590b6632767)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **studio:** prop-bound text is editable on the canvas wherever the instance delivers the prop ([8ef773f](https://github.com/jxsuite/jx/commit/8ef773f6841e7c24d8624d84e55bc9b6cf1b20ab))
* **studio:** show a failed model listing wherever the catalogue is offered ([1269cb8](https://github.com/jxsuite/jx/commit/1269cb8596ef842835d57f135ccfa4d53013e709))


### Performance Improvements

* **studio:** the Library table writes its table roles on its own boxes again ([4b87c8e](https://github.com/jxsuite/jx/commit/4b87c8e78002217aa38e1a8e4afe5bf002fd2d3d)), closes [#301](https://github.com/jxsuite/jx/issues/301)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.44.0
    * @jxsuite/collab bumped to 0.12.3
    * @jxsuite/create bumped to 1.8.4
    * @jxsuite/erase bumped to 0.3.3
    * @jxsuite/formulas bumped to 0.0.36
    * @jxsuite/markup bumped to 1.0.12
    * @jxsuite/protocol bumped to 6.5.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/site bumped to 3.0.0
    * @jxsuite/ui bumped to 0.13.0

## [11.1.0](https://github.com/jxsuite/jx/compare/studio-v11.0.2...studio-v11.1.0) (2026-11-14)


### Features

* **compiler:** one build can leave images alone, and a Pages preview does ([544adbe](https://github.com/jxsuite/jx/commit/544adbe8f56eb3d7af34a4bfe2e0188cc5f46297))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.7
    * @jxsuite/collab bumped to 0.12.2
    * @jxsuite/create bumped to 1.8.3
    * @jxsuite/erase bumped to 0.3.2
    * @jxsuite/formulas bumped to 0.0.35
    * @jxsuite/markup bumped to 1.0.11
    * @jxsuite/protocol bumped to 6.4.2
    * @jxsuite/runtime bumped to 7.1.0
    * @jxsuite/schema bumped to 6.0.2
    * @jxsuite/site bumped to 2.8.0
    * @jxsuite/ui bumped to 0.12.2

## [11.0.2](https://github.com/jxsuite/jx/compare/studio-v11.0.1...studio-v11.0.2) (2026-11-13)


### Bug Fixes

* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.6
    * @jxsuite/collab bumped to 0.12.1
    * @jxsuite/create bumped to 1.8.2
    * @jxsuite/erase bumped to 0.3.1
    * @jxsuite/formulas bumped to 0.0.34
    * @jxsuite/markup bumped to 1.0.10
    * @jxsuite/protocol bumped to 6.4.1
    * @jxsuite/runtime bumped to 7.0.1
    * @jxsuite/schema bumped to 6.0.1
    * @jxsuite/site bumped to 2.7.1
    * @jxsuite/ui bumped to 0.12.1

## [11.0.1](https://github.com/jxsuite/jx/compare/studio-v11.0.0...studio-v11.0.1) (2026-11-13)


### Bug Fixes

* **studio:** an edit to an innerHTML block stores nodes and removes the markup ([#654](https://github.com/jxsuite/jx/issues/654)) ([b36ca79](https://github.com/jxsuite/jx/commit/b36ca795aec6c2ad4ff6de2601d4f892a4255c77))

## [11.0.0](https://github.com/jxsuite/jx/compare/studio-v10.9.0...studio-v11.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))

### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* **content-mapper,schema:** tsc and a language server check the code in a .jxn document ([#629](https://github.com/jxsuite/jx/issues/629)) ([9efac0a](https://github.com/jxsuite/jx/commit/9efac0a72297f677af688f120ef6caa586dc35a4))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* Open in Browser runs a component or a layout on its own ([#644](https://github.com/jxsuite/jx/issues/644)) ([dd6e18d](https://github.com/jxsuite/jx/commit/dd6e18df227e1c78cd0f8e296051b201fd808854))
* **runtime,studio:** a prop edit writes the prop into the live instance ([#645](https://github.com/jxsuite/jx/issues/645)) ([e037910](https://github.com/jxsuite/jx/commit/e0379102f9d67ef80815568d48bffa79732a9cbb))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,studio:** quote-aware template scan, and a commit keeps its binding ([#638](https://github.com/jxsuite/jx/issues/638)) ([5a1f8d8](https://github.com/jxsuite/jx/commit/5a1f8d878d3e6f824a254421174bdf656eba3b7a))
* **schema,studio:** the Code view completes a .jxn file from its schemas ([#643](https://github.com/jxsuite/jx/issues/643)) ([38e28e3](https://github.com/jxsuite/jx/commit/38e28e32bf7c9856a77ed059f59fe6af148d39f6))
* **studio,schema:** the Code view of a .jxn file marks type errors in the whole file ([#639](https://github.com/jxsuite/jx/issues/639)) ([506ec44](https://github.com/jxsuite/jx/commit/506ec445bf6583e5bfada9a6506e21c775cb8d90))
* **studio:** a dynamic tag opens a popover to pick its source, format and fallback ([#650](https://github.com/jxsuite/jx/issues/650)) ([918a6b5](https://github.com/jxsuite/jx/commit/918a6b5e53a62262b0eeaa3b147dc3a930bae260))
* **studio:** a repeater draws every row on the editing canvas, and any row is editable ([#648](https://github.com/jxsuite/jx/issues/648)) ([8a97e95](https://github.com/jxsuite/jx/commit/8a97e956921410f4b0477afa577202058b034546))
* **studio:** bound text draws its value on the editing canvas, as a chip the caret cannot enter ([#647](https://github.com/jxsuite/jx/issues/647)) ([ecc06ad](https://github.com/jxsuite/jx/commit/ecc06adf5f9011777d9b8a1fca2862f068602f4f))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **studio:** the canvas fetches remote data once, marks what did not resolve, takes a state value ([#649](https://github.com/jxsuite/jx/issues/649)) ([ff1a103](https://github.com/jxsuite/jx/commit/ff1a10311206a2a8de803a64a78e4b4311327a67))
* **vscode:** a VS Code extension highlights, completes and type checks a .jxn file ([#646](https://github.com/jxsuite/jx/issues/646)) ([2a34cb9](https://github.com/jxsuite/jx/commit/2a34cb94e7c227d5e762ab475a5b78c29ed791ef))


### Bug Fixes

* **schema,content-mapper,studio:** the state a project gives a document is seen by every reader ([#635](https://github.com/jxsuite/jx/issues/635)) ([c506085](https://github.com/jxsuite/jx/commit/c506085f0397155c3e9e5e9fed62d9ca98e5c87b))
* **studio:** a one-line raw string in a .jxn file ends where it closes ([#641](https://github.com/jxsuite/jx/issues/641)) ([c4fdd5c](https://github.com/jxsuite/jx/commit/c4fdd5c2d77d735c7f3273992edef1c0304078bb))
* **studio:** a popover panel is shown on its own jx-ready, not a descendant's ([#623](https://github.com/jxsuite/jx/issues/623)) ([7bc0898](https://github.com/jxsuite/jx/commit/7bc0898a52c98ddc736e74101724e68d2fcb6f07))
* **studio:** Component Settings shows and edits a prop wherever the instance delivers it ([#651](https://github.com/jxsuite/jx/issues/651)) ([8e5b0f9](https://github.com/jxsuite/jx/commit/8e5b0f955bd45a95c73e67a615d984e1dbb21005))
* **ui:** forward form attributes, draw invalid state and guard composition keys ([#626](https://github.com/jxsuite/jx/issues/626)) ([0649c13](https://github.com/jxsuite/jx/commit/0649c1310e329df5c9f34b5f0c8415fb816d3658))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.5
    * @jxsuite/collab bumped to 0.12.0
    * @jxsuite/create bumped to 1.8.1
    * @jxsuite/erase bumped to 0.3.0
    * @jxsuite/formulas bumped to 0.0.33
    * @jxsuite/markup bumped to 1.0.9
    * @jxsuite/protocol bumped to 6.4.0
    * @jxsuite/runtime bumped to 7.0.0
    * @jxsuite/schema bumped to 6.0.0
    * @jxsuite/site bumped to 2.7.0
    * @jxsuite/ui bumped to 0.12.0

## [10.9.0](https://github.com/jxsuite/jx/compare/studio-v10.8.0...studio-v10.9.0) (2026-11-11)


### Features

* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema,studio:** a component setting with an enum is a select ([#606](https://github.com/jxsuite/jx/issues/606)) ([88c9a2f](https://github.com/jxsuite/jx/commit/88c9a2f47647332a9e1f90e88407d7714f1ffbdc))
* **schema,studio:** report type errors in a function body ([#603](https://github.com/jxsuite/jx/issues/603)) ([9fb47c5](https://github.com/jxsuite/jx/commit/9fb47c53d8c86c63b4fb5d6dcdc3608d09f76607))
* **studio,compiler:** a picture's focal point lives in the picture ([#591](https://github.com/jxsuite/jx/issues/591)) ([d87ce76](https://github.com/jxsuite/jx/commit/d87ce76d12805d0d5b217629a37f4639a16def49))
* **studio:** a placed picture starts with its file's alt text ([#589](https://github.com/jxsuite/jx/issues/589)) ([6ac042a](https://github.com/jxsuite/jx/commit/6ac042a2e67853bb26ce6a51593b1d8fef6d0f19))
* **studio:** the Command Bar's controls draw at the full 24px ([#602](https://github.com/jxsuite/jx/issues/602)) ([15637d1](https://github.com/jxsuite/jx/commit/15637d19ba46716ac6b515ef612597c61689b991))
* **ui:** a jx-field in a narrow container stacks its label above the control ([#600](https://github.com/jxsuite/jx/issues/600)) ([18cf26e](https://github.com/jxsuite/jx/commit/18cf26e6a2819e9240fe9029d73b552171768f9e))
* **ui:** section headings are one recipe, and the accordion draws it ([#601](https://github.com/jxsuite/jx/issues/601)) ([fc12fa6](https://github.com/jxsuite/jx/commit/fc12fa686eea1c2fcae5cac274120114bb1a3992))


### Bug Fixes

* **studio:** an Inspector edit patches the canvas, and a full render keeps the page styled ([#609](https://github.com/jxsuite/jx/issues/609)) ([8021ccf](https://github.com/jxsuite/jx/commit/8021ccf1b9b64916d3b60068cffd957e4b326ef3))
* **studio:** the quick-insert menu stays frozen over the + that opened it ([#608](https://github.com/jxsuite/jx/issues/608)) ([bb10fb9](https://github.com/jxsuite/jx/commit/bb10fb99c1ecfc3e10cab685bf57fe4ed515342a))
* **studio:** zoom in the status bar, collapsed outline, reliable twisty, diff Code view back ([#605](https://github.com/jxsuite/jx/issues/605)) ([e4cc01d](https://github.com/jxsuite/jx/commit/e4cc01d17353b1e3749c5257fb09383ca6a505dd))
* **ui:** 11px is the type floor, in the kit and in Studio's chrome ([#599](https://github.com/jxsuite/jx/issues/599)) ([ad305fe](https://github.com/jxsuite/jx/commit/ad305fe0da3e0b3b68b03ba9c3c7dda2afcae9e9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.4
    * @jxsuite/collab bumped to 0.11.10
    * @jxsuite/create bumped to 1.8.0
    * @jxsuite/erase bumped to 0.2.0
    * @jxsuite/formulas bumped to 0.0.32
    * @jxsuite/markup bumped to 1.0.8
    * @jxsuite/protocol bumped to 6.3.0
    * @jxsuite/runtime bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0
    * @jxsuite/site bumped to 2.6.0
    * @jxsuite/ui bumped to 0.11.0

## [10.8.0](https://github.com/jxsuite/jx/compare/studio-v10.7.0...studio-v10.8.0) (2026-11-08)


### Features

* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* **studio:** a picture's alt text and tags live in the picture ([#588](https://github.com/jxsuite/jx/issues/588)) ([79be4bf](https://github.com/jxsuite/jx/commit/79be4bf53d5daf0146e74d028c38e443067e4636))
* **studio:** Applies to in Design's Style tab ([#584](https://github.com/jxsuite/jx/issues/584)) ([343aa08](https://github.com/jxsuite/jx/commit/343aa08b7dbf8626211050a83dbbb7cc571a7127))
* **studio:** Content Table: Cover column, row selection, and what each page is ([#585](https://github.com/jxsuite/jx/issues/585)) ([0ecf1d0](https://github.com/jxsuite/jx/commit/0ecf1d0fd5d270f13ee39dea1fe1e6ee5762225b))
* **studio:** design a collection's page with a real entry in it ([#574](https://github.com/jxsuite/jx/issues/574)) ([18fc53f](https://github.com/jxsuite/jx/commit/18fc53f2772fe75c47049a661a3a8ffffca36272))
* **studio:** offer a branch and pull request when a protected branch refuses a push ([#572](https://github.com/jxsuite/jx/issues/572)) ([bb21d4a](https://github.com/jxsuite/jx/commit/bb21d4a7df3fb2b12c5b7e526270c0e6e64dd1d2))
* **studio:** Project Settings › Overview sets the default template for new pages ([#586](https://github.com/jxsuite/jx/issues/586)) ([fa87ae5](https://github.com/jxsuite/jx/commit/fa87ae5a8fe0bb635749ae8382c161fb4b24afb0))
* **studio:** Project Styles draws each interactive element in every state ([#582](https://github.com/jxsuite/jx/issues/582)) ([8f742ce](https://github.com/jxsuite/jx/commit/8f742cedbb0e3ce725e67f35834e0379076938e4))
* **studio:** quick publish hangs from its chevron and names changes as the site does ([#580](https://github.com/jxsuite/jx/issues/580)) ([d8ebb1e](https://github.com/jxsuite/jx/commit/d8ebb1e4d6fb0c9361063029cb910f05041668b1))
* **studio:** regroup the Page tab, and give a collection's page its fields ([#579](https://github.com/jxsuite/jx/issues/579)) ([6aefd21](https://github.com/jxsuite/jx/commit/6aefd219da276bb8709677337e948fcf40cc432c))
* **studio:** Review changes says where the site is hosted, and Hosting numbers its setup steps ([#587](https://github.com/jxsuite/jx/issues/587)) ([62b0d93](https://github.com/jxsuite/jx/commit/62b0d93fa209827017746c561958e9fc51037aeb))
* **studio:** the Style tab names the components that restyle a Project Styles element ([#583](https://github.com/jxsuite/jx/issues/583)) ([6bb8c95](https://github.com/jxsuite/jx/commit/6bb8c955364b3de77fccbc38e194512991a1f9a6))
* **studio:** the Variables view draws the palette as swatches ([#581](https://github.com/jxsuite/jx/issues/581)) ([7889269](https://github.com/jxsuite/jx/commit/788926964166e2b448c12954df44019aed9b76a4))
* **studio:** write an entry inside its collection's page ([#577](https://github.com/jxsuite/jx/issues/577)) ([f99d8b9](https://github.com/jxsuite/jx/commit/f99d8b9dec5d9452120404576eeb38e78958728f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.3
    * @jxsuite/collab bumped to 0.11.9
    * @jxsuite/create bumped to 1.7.0
    * @jxsuite/formulas bumped to 0.0.31
    * @jxsuite/markup bumped to 1.0.7
    * @jxsuite/protocol bumped to 6.2.5
    * @jxsuite/runtime bumped to 6.2.2
    * @jxsuite/schema bumped to 5.5.0
    * @jxsuite/site bumped to 2.5.1
    * @jxsuite/ui bumped to 0.10.4

## [10.7.0](https://github.com/jxsuite/jx/compare/studio-v10.6.0...studio-v10.7.0) (2026-11-08)


### Features

* **desktop:** declare .jxn on every channel that can register a file type ([#570](https://github.com/jxsuite/jx/issues/570)) ([2b19f27](https://github.com/jxsuite/jx/commit/2b19f278c90857d4684c407a102a756f54468665))
* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **studio:** open, find, save and convert .jxn documents, solo and shared ([#567](https://github.com/jxsuite/jx/issues/567)) ([2be9af7](https://github.com/jxsuite/jx/commit/2be9af7ea7e5ab645a8e3d39c03bbfd4ea6566c2))
* **studio:** Review changes compares the picked change in its centre ([#568](https://github.com/jxsuite/jx/issues/568)) ([c1e8e89](https://github.com/jxsuite/jx/commit/c1e8e89e7363677560828e9e0cd02655025b40de))


### Bug Fixes

* **studio:** discard a superseded package-lock.json when pulling ([#564](https://github.com/jxsuite/jx/issues/564)) ([a49ee6f](https://github.com/jxsuite/jx/commit/a49ee6f08c9889131f83a8c33b1d667fb93ca770))
* **studio:** grid row-header contrast, persistent checkboxes, Publish count after save ([#569](https://github.com/jxsuite/jx/issues/569)) ([5c8baa7](https://github.com/jxsuite/jx/commit/5c8baa7dd367b0d8f4ecd6a4612f02fb5c11c2f9))
* **studio:** register every Monaco feature before the first editor exists ([#571](https://github.com/jxsuite/jx/issues/571)) ([6e88e9c](https://github.com/jxsuite/jx/commit/6e88e9cd9c94b2283b453e8518220697d0c83671))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.2
    * @jxsuite/collab bumped to 0.11.8
    * @jxsuite/create bumped to 1.6.0
    * @jxsuite/formulas bumped to 0.0.30
    * @jxsuite/markup bumped to 1.0.6
    * @jxsuite/protocol bumped to 6.2.4
    * @jxsuite/runtime bumped to 6.2.1
    * @jxsuite/schema bumped to 5.4.0
    * @jxsuite/site bumped to 2.5.0
    * @jxsuite/ui bumped to 0.10.3

## [10.6.0](https://github.com/jxsuite/jx/compare/studio-v10.5.0...studio-v10.6.0) (2026-11-07)


### Features

* **desktop:** open what the OS hands over, after asking to run a folder's code ([#549](https://github.com/jxsuite/jx/issues/549)) ([7aa3f08](https://github.com/jxsuite/jx/commit/7aa3f08a14b663886949d9dea2ff9227832bcae6))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* saving a .jxn file keeps what did not change ([#555](https://github.com/jxsuite/jx/issues/555)) ([af1197e](https://github.com/jxsuite/jx/commit/af1197e84162fd6376f1053ebebb114c2b3ae7f5))
* **studio:** persistent Insert panel with named cards and tabs ([#559](https://github.com/jxsuite/jx/issues/559)) ([a4babb7](https://github.com/jxsuite/jx/commit/a4babb717481a51e7e044cb11229c414a78048d9))


### Bug Fixes

* **runtime:** let a write from a child scope reach the state it names ([#556](https://github.com/jxsuite/jx/issues/556)) ([e32df97](https://github.com/jxsuite/jx/commit/e32df970084e8a7f604a8fbf7934f8f234d2433a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.1
    * @jxsuite/collab bumped to 0.11.7
    * @jxsuite/create bumped to 1.5.5
    * @jxsuite/formulas bumped to 0.0.29
    * @jxsuite/markup bumped to 1.0.5
    * @jxsuite/protocol bumped to 6.2.3
    * @jxsuite/runtime bumped to 6.2.0
    * @jxsuite/schema bumped to 5.3.0
    * @jxsuite/site bumped to 2.4.0
    * @jxsuite/ui bumped to 0.10.2

## [10.5.0](https://github.com/jxsuite/jx/compare/studio-v10.4.0...studio-v10.5.0) (2026-11-06)


### Features

* **ai:** give a turn room to work, and a closing round to reply ([#545](https://github.com/jxsuite/jx/issues/545)) ([59b1c95](https://github.com/jxsuite/jx/commit/59b1c95ed2d7999c2b46d6b70aa78ff47387b826))
* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **runtime,studio:** hold template warnings for data in flight, and render-check pages as built ([#544](https://github.com/jxsuite/jx/issues/544)) ([6a47d72](https://github.com/jxsuite/jx/commit/6a47d72fde7e10100c8b4e01f51e82b0ee8d9b7f))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.0
    * @jxsuite/collab bumped to 0.11.6
    * @jxsuite/create bumped to 1.5.4
    * @jxsuite/formulas bumped to 0.0.28
    * @jxsuite/markup bumped to 1.0.4
    * @jxsuite/protocol bumped to 6.2.2
    * @jxsuite/runtime bumped to 6.1.0
    * @jxsuite/schema bumped to 5.2.0
    * @jxsuite/site bumped to 2.3.1
    * @jxsuite/ui bumped to 0.10.1

## [10.4.0](https://github.com/jxsuite/jx/compare/studio-v10.3.0...studio-v10.4.0) (2026-11-04)


### Features

* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))


### Bug Fixes

* **studio:** let the Style sidebar scroll again ([#536](https://github.com/jxsuite/jx/issues/536)) ([8e1d0d8](https://github.com/jxsuite/jx/commit/8e1d0d834161fb76972e3407d7d2986cec8a19f8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.42.1
    * @jxsuite/collab bumped to 0.11.5
    * @jxsuite/create bumped to 1.5.3
    * @jxsuite/formulas bumped to 0.0.27
    * @jxsuite/markup bumped to 1.0.3
    * @jxsuite/protocol bumped to 6.2.1
    * @jxsuite/runtime bumped to 6.0.2
    * @jxsuite/schema bumped to 5.1.0
    * @jxsuite/site bumped to 2.3.0
    * @jxsuite/ui bumped to 0.10.0

## [10.3.0](https://github.com/jxsuite/jx/compare/studio-v10.2.0...studio-v10.3.0) (2026-11-04)


### Features

* **studio:** edit an image where it is opened ([#531](https://github.com/jxsuite/jx/issues/531)) ([0e2b90e](https://github.com/jxsuite/jx/commit/0e2b90e9a2deb20a542fc33803adbe31a20673ec))
* **studio:** rename and duplicate a media file from the Media workspace ([#533](https://github.com/jxsuite/jx/issues/533)) ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))


### Bug Fixes

* **server:** a rename drops the usage cache before it answers, so the new name's ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))
* **studio:** stop renames and moves overwriting files, and keep the Files panel live ([#534](https://github.com/jxsuite/jx/issues/534)) ([b29a7bd](https://github.com/jxsuite/jx/commit/b29a7bdb1b8eda6c4c6352d8bcc3059e5eaf9920))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ui bumped to 0.9.0

## [10.2.0](https://github.com/jxsuite/jx/compare/studio-v10.1.0...studio-v10.2.0) (2026-11-03)


### Features

* **ai:** support anthropic messages api ([#526](https://github.com/jxsuite/jx/issues/526)) ([d6eefc3](https://github.com/jxsuite/jx/commit/d6eefc364a7e2097f08336c54298f5d8d85fb3d6))
* **studio:** Project Settings is a workspace, not a dialog ([#528](https://github.com/jxsuite/jx/issues/528)) ([e8ca05d](https://github.com/jxsuite/jx/commit/e8ca05d55619c56d3779a975d135c835872af196))


### Bug Fixes

* **studio:** list a page once when a collection lives in an ancestor of the project ([#527](https://github.com/jxsuite/jx/issues/527)) ([460c775](https://github.com/jxsuite/jx/commit/460c77545988e54068732b623cd8c61a1f6e63d4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.42.0
    * @jxsuite/create bumped to 1.5.2
    * @jxsuite/protocol bumped to 6.2.0

## [10.1.0](https://github.com/jxsuite/jx/compare/studio-v10.0.0...studio-v10.1.0) (2026-10-31)


### Features

* **studio:** publish to a new branch when a hosted branch moved under your edits ([#522](https://github.com/jxsuite/jx/issues/522)) ([8941481](https://github.com/jxsuite/jx/commit/894148177a3199db7a1dbd20c225a09a2250ea3f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.41.2
    * @jxsuite/create bumped to 1.5.1
    * @jxsuite/protocol bumped to 6.1.0

## [10.0.0](https://github.com/jxsuite/jx/compare/studio-v9.0.0...studio-v10.0.0) (2026-10-29)


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

* desktop backend paths, right-click menus, and the Media tile menu ([#513](https://github.com/jxsuite/jx/issues/513)) ([80dac1b](https://github.com/jxsuite/jx/commit/80dac1b38b2aaecf954ca0033bc170629022973d))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* **studio:** a right-click on the canvas selects without starting an edit ([#514](https://github.com/jxsuite/jx/issues/514)) ([c3d9384](https://github.com/jxsuite/jx/commit/c3d938468a1adb91d3376b4b191b746547bb5729))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.41.1
    * @jxsuite/collab bumped to 0.11.4
    * @jxsuite/create bumped to 1.5.0
    * @jxsuite/formulas bumped to 0.0.26
    * @jxsuite/markup bumped to 1.0.2
    * @jxsuite/protocol bumped to 6.0.0
    * @jxsuite/runtime bumped to 6.0.1
    * @jxsuite/schema bumped to 5.0.0
    * @jxsuite/site bumped to 2.2.2
    * @jxsuite/ui bumped to 0.8.2

## [9.0.0](https://github.com/jxsuite/jx/compare/studio-v8.1.0...studio-v9.0.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501))

### Features

* **ai:** interactions and approvals run before the tool body ([#502](https://github.com/jxsuite/jx/issues/502)) ([0b14ea4](https://github.com/jxsuite/jx/commit/0b14ea4ea8df16a1c34b7437328d69866b0abd8d))
* **ai:** the assistant's tools are one catalog in @jxsuite/ai/catalog ([#499](https://github.com/jxsuite/jx/issues/499)) ([a63f9bb](https://github.com/jxsuite/jx/commit/a63f9bb8228e7ba28e0737106a5fb4c61d58f092))
* **ai:** the tree tools are portable producers in @jxsuite/ai/jx-tools ([#493](https://github.com/jxsuite/jx/issues/493)) ([40e7c27](https://github.com/jxsuite/jx/commit/40e7c27a1abedab5a22f20ade9d1e1e03297e984))
* **studio:** document tools refuse corrupting or no-op edits ([#492](https://github.com/jxsuite/jx/issues/492)) ([7134466](https://github.com/jxsuite/jx/commit/7134466b21d23ba1e8ab79d63890474d84f74e24))
* **studio:** per-actor batch lanes replace the global undo batch ([#489](https://github.com/jxsuite/jx/issues/489)) ([32b1f25](https://github.com/jxsuite/jx/commit/32b1f2589e5981171c85db1319d477f6304060d2))
* **studio:** Restore undoes the turn across every document it wrote ([#490](https://github.com/jxsuite/jx/issues/490)) ([243986b](https://github.com/jxsuite/jx/commit/243986b3a7b646878c6b115459c42cdf6c37d700))


### Code Refactoring

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501)) ([604b254](https://github.com/jxsuite/jx/commit/604b2540a667bf2ed5adbdadddf532b1e8dfaa9b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.41.0
    * @jxsuite/collab bumped to 0.11.3
    * @jxsuite/create bumped to 1.4.1
    * @jxsuite/formulas bumped to 0.0.25
    * @jxsuite/markup bumped to 1.0.1
    * @jxsuite/protocol bumped to 5.0.0
    * @jxsuite/runtime bumped to 6.0.0
    * @jxsuite/schema bumped to 4.1.0
    * @jxsuite/site bumped to 2.2.1
    * @jxsuite/ui bumped to 0.8.1

## [8.1.0](https://github.com/jxsuite/jx/compare/studio-v8.0.1...studio-v8.1.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))
* **studio:** segmented Editor and Context axes, implicit Diff, scrollable Variables view ([#485](https://github.com/jxsuite/jx/issues/485)) ([009e798](https://github.com/jxsuite/jx/commit/009e7988e0cc15bd23832b7f886b38076505a2a8))


### Bug Fixes

* **studio:** outline, action bar and caret for display: contents components ([#486](https://github.com/jxsuite/jx/issues/486)) ([b7dcea8](https://github.com/jxsuite/jx/commit/b7dcea8172574afcc410998d1f63bfa4712904ba))


### Performance Improvements

* **studio:** stop sweeping the project for component previews and template counts ([#484](https://github.com/jxsuite/jx/issues/484)) ([b7081a4](https://github.com/jxsuite/jx/commit/b7081a4b74d38a02f17e4a5d8e285944c6100590))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.40.0
    * @jxsuite/create bumped to 1.4.0
    * @jxsuite/formulas bumped to 0.0.24
    * @jxsuite/runtime bumped to 5.2.0
    * @jxsuite/site bumped to 2.2.0
    * @jxsuite/ui bumped to 0.8.0

## [8.0.1](https://github.com/jxsuite/jx/compare/studio-v8.0.0...studio-v8.0.1) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.17
    * @jxsuite/formulas bumped to 0.0.23
    * @jxsuite/runtime bumped to 5.1.0
    * @jxsuite/site bumped to 2.1.0
    * @jxsuite/ui bumped to 0.7.1

## [8.0.0](https://github.com/jxsuite/jx/compare/studio-v7.0.0...studio-v8.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.5
    * @jxsuite/create bumped to 1.3.16
    * @jxsuite/markup bumped to 1.0.0
    * @jxsuite/protocol bumped to 4.0.0
    * @jxsuite/ui bumped to 0.7.0

## [7.0.0](https://github.com/jxsuite/jx/compare/studio-v6.1.2...studio-v7.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.4
    * @jxsuite/collab bumped to 0.11.2
    * @jxsuite/create bumped to 1.3.15
    * @jxsuite/formulas bumped to 0.0.22
    * @jxsuite/markup bumped to 0.4.13
    * @jxsuite/protocol bumped to 3.0.0
    * @jxsuite/runtime bumped to 5.0.0
    * @jxsuite/schema bumped to 4.0.0
    * @jxsuite/site bumped to 2.0.5
    * @jxsuite/ui bumped to 0.6.0

## [6.1.2](https://github.com/jxsuite/jx/compare/studio-v6.1.1...studio-v6.1.2) (2026-10-16)


### Bug Fixes

* **studio:** record project directories on every door into a project ([#451](https://github.com/jxsuite/jx/issues/451)) ([3f5faa7](https://github.com/jxsuite/jx/commit/3f5faa71a507e64846f1425f94823de497e951cd))

## [6.1.1](https://github.com/jxsuite/jx/compare/studio-v6.1.0...studio-v6.1.1) (2026-10-11)


### Bug Fixes

* **studio:** cursor-anchored zoom, dirty-gated Save, Library rail button, and four more fixes ([#444](https://github.com/jxsuite/jx/issues/444)) ([72670f0](https://github.com/jxsuite/jx/commit/72670f0ea73eccde8259775a3a802318ce0ed2fc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.14
    * @jxsuite/formulas bumped to 0.0.21
    * @jxsuite/runtime bumped to 4.1.0
    * @jxsuite/site bumped to 2.0.4
    * @jxsuite/ui bumped to 0.5.1

## [6.1.0](https://github.com/jxsuite/jx/compare/studio-v6.0.0...studio-v6.1.0) (2026-10-07)


### Features

* **studio:** open a cloud project from a repository subfolder ([#429](https://github.com/jxsuite/jx/issues/429)) ([bf467a7](https://github.com/jxsuite/jx/commit/bf467a7f4b987dc03fb6bb7db145dfa48c130280))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ui bumped to 0.5.0

## [6.0.0](https://github.com/jxsuite/jx/compare/studio-v5.7.0...studio-v6.0.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.3
    * @jxsuite/collab bumped to 0.11.1
    * @jxsuite/create bumped to 1.3.13
    * @jxsuite/formulas bumped to 0.0.20
    * @jxsuite/markup bumped to 0.4.12
    * @jxsuite/protocol bumped to 2.6.1
    * @jxsuite/runtime bumped to 4.0.3
    * @jxsuite/schema bumped to 3.0.0
    * @jxsuite/site bumped to 2.0.3
    * @jxsuite/ui bumped to 0.4.1

## [5.7.0](https://github.com/jxsuite/jx/compare/studio-v5.6.0...studio-v5.7.0) (2026-10-06)


### Features

* **studio:** breadcrumb trail in the status bar ([ae24c2c](https://github.com/jxsuite/jx/commit/ae24c2ceb2212a3d21d0cc21963ef9e9d7fac742))
* **studio:** breadcrumb trail in the status bar ([95cf2e1](https://github.com/jxsuite/jx/commit/95cf2e17d1ab07cbcde7aec9b803550aa3db0524))


### Bug Fixes

* **ai:** repair tool-call pairs per request, in @jxsuite/ai/messages ([ac8a809](https://github.com/jxsuite/jx/commit/ac8a80973a8d146bef596a8a2015808177505a14))
* **ai:** repair tool-call pairs per request, in @jxsuite/ai/messages ([518d4a8](https://github.com/jxsuite/jx/commit/518d4a8b09930d487af0e390e2b2704b9f76cdec))
* **studio:** one writer per action button's drawn state ([#425](https://github.com/jxsuite/jx/issues/425)) ([7ae7773](https://github.com/jxsuite/jx/commit/7ae777384af3d04b5dfc83b0479080e52ed1cec4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.2

## [5.6.0](https://github.com/jxsuite/jx/compare/studio-v5.5.0...studio-v5.6.0) (2026-10-03)


### Features

* backend-directed access: action-required refusals, offered actions, platform account rows ([8b8f2df](https://github.com/jxsuite/jx/commit/8b8f2dfcde78178921188e3f68da8010a831bb03))
* offer a hosted platform's plan when it refuses with subscription-required ([f4c860d](https://github.com/jxsuite/jx/commit/f4c860dccf31f502afb1db64f83e92869cb2b675))
* replace the hosted-plan client with backend-directed access ([8add52b](https://github.com/jxsuite/jx/commit/8add52b18e4a5d728a0f3db220503939804f1727))
* **studio:** address repo-space media by content version, so unchanged images repaint from cache ([74c7fd5](https://github.com/jxsuite/jx/commit/74c7fd53c9abcde63963717571a460a74506e24c))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([88eb919](https://github.com/jxsuite/jx/commit/88eb919810d7ab7fc1c8f479769e0f1fa6e2fe0c))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([de3512b](https://github.com/jxsuite/jx/commit/de3512bea3ec36871b24dd63d64885d90c9d5b07))
* **studio:** put the assistant's static prompt first, so its prefix caches ([78c04ce](https://github.com/jxsuite/jx/commit/78c04ceff9bb51f6874cfe16f11f32e02666580e))
* **studio:** put the assistant's static prompt first, so its prefix caches ([ae7dfa9](https://github.com/jxsuite/jx/commit/ae7dfa97bbe42b84ab6ec09a8183087aea00d97a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.1
    * @jxsuite/collab bumped to 0.11.0
    * @jxsuite/protocol bumped to 2.6.0

## [5.5.0](https://github.com/jxsuite/jx/compare/studio-v5.4.0...studio-v5.5.0) (2026-10-01)


### Features

* **ai:** prompt-cache hints, keyed per chat session ([50e119c](https://github.com/jxsuite/jx/commit/50e119c841fe7929c9e15da7923e987e47cbbcf4))
* **ai:** prompt-cache hints, keyed per chat session ([9f2ac83](https://github.com/jxsuite/jx/commit/9f2ac83a265b48caceb78b2f3d4a6555c728c374))
* **studio:** coalesce the cloud adapter's file reads into one batch request ([a38389a](https://github.com/jxsuite/jx/commit/a38389aaec445c005c943ee212dc73bc12b8447d))
* **studio:** coalesce the cloud adapter's file reads into one batch request ([e0fa49e](https://github.com/jxsuite/jx/commit/e0fa49eef4effc10f7178918ba322f5ed8f9ead9))
* **studio:** collapsable document panel ([2a5f2d4](https://github.com/jxsuite/jx/commit/2a5f2d4134f2d75ee9ae1a3c768a14d5ecf65327))
* **studio:** collapsable document panel ([2f93c66](https://github.com/jxsuite/jx/commit/2f93c660a720fdc43325119c6ad9425c748aba44))
* **studio:** minified release bundles and modulepreload hints for the editor's boot chunks ([6960620](https://github.com/jxsuite/jx/commit/69606200afb44c8c61d847030426b80562d0c5fd))
* **studio:** minified release bundles and modulepreload hints for the editor's boot chunks ([9e0da5b](https://github.com/jxsuite/jx/commit/9e0da5b8f72d4c40b24f3fb7186ade3867c9a07c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.0
    * @jxsuite/protocol bumped to 2.5.0

## [5.4.0](https://github.com/jxsuite/jx/compare/studio-v5.3.0...studio-v5.4.0) (2026-09-29)


### Features

* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **schema:** document ops and the JSON serializer as portable @jxsuite/schema subpaths (harness J1.1) ([5d88928](https://github.com/jxsuite/jx/commit/5d88928460938bb626e5314b6cbd29e1d9311913))
* **schema:** the document-op vocabulary and its inverse, as @jxsuite/schema/doc-ops ([5a686cf](https://github.com/jxsuite/jx/commit/5a686cfce193596284bd5eebf3dc37e3056adb6f))
* **schema:** the layout-preserving JSON serializer, as @jxsuite/schema/json-layout ([2e221fe](https://github.com/jxsuite/jx/commit/2e221fe9115e19c458dfe7622c680e149c54acd3))
* **studio:** batch modulepreload links, cache scroller/track resolution ([7d181d2](https://github.com/jxsuite/jx/commit/7d181d20b1599d1978f00b5380b0c90802ceae55))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))


### Bug Fixes

* **ai:** run streamed tool calls on any finish but not after Stop, and forward usage ([2dfb312](https://github.com/jxsuite/jx/commit/2dfb312a7190c978c11447b4aad063096da24467))
* **desktop,studio:** 5.x desktop windows booted without their backend; fail loud and report Browse errors ([3f50ec9](https://github.com/jxsuite/jx/commit/3f50ec92d68ee010aedeb35955c1ff673362fac1))
* **desktop:** gate the shared AI proxy with the per-process service token ([e565e9e](https://github.com/jxsuite/jx/commit/e565e9ea2c7fddb68442aa21b29a4d4884ef1338))
* **desktop:** stop loading a second copy of Lit in the same window ([85e9d72](https://github.com/jxsuite/jx/commit/85e9d7242889893ace30171970435e8a9296a5d6))
* **desktop:** stop loading a second copy of Lit in the same window ([3891648](https://github.com/jxsuite/jx/commit/3891648a30130f159c8db73a0955e96c2b1d9c43))
* **desktop:** the launcher's handlers mock needs the member the launcher imports ([c2279e1](https://github.com/jxsuite/jx/commit/c2279e19befbaea7aad80f57c3c2706949e8b1b7))
* **evals:** the harnesses reach their provider, and a trial that never did does not pass ([60a7b10](https://github.com/jxsuite/jx/commit/60a7b10352cf9dce2ba4ccaa2cc154be7989e080))
* **evals:** the harnesses reach their provider, and a trial that never did does not pass ([221a5dc](https://github.com/jxsuite/jx/commit/221a5dcbbe22c545766c94ab60e0fb36f7f5e613))
* **evals:** the headless eval scores a run instead of throwing on its document ([54131c2](https://github.com/jxsuite/jx/commit/54131c22b9be8e19ece3b94056c2b7bbb6a38bf9))
* Jx harness phase 0 — gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* normalize Bun.Glob paths to forward slashes on Windows ([d89903a](https://github.com/jxsuite/jx/commit/d89903ac9ab807d48373d8b5dc2489dbf560cd41))
* **studio,desktop:** Browse reports why it could not choose a folder ([2e1a1cc](https://github.com/jxsuite/jx/commit/2e1a1cc7aa2e03b125afeeef29ea7ae6609cd310))
* **studio,desktop:** refuse the dev-server fallback when a launcher failed to start ([521803b](https://github.com/jxsuite/jx/commit/521803b2863cc6fdaa3612e54a4fa5572aa1e8b3))
* **studio:** a hand-off waits for the turn New Chat stopped, instead of being lost ([8551590](https://github.com/jxsuite/jx/commit/85515902182ec3b9f1545663575c58e6f06996a7))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([f9fba4f](https://github.com/jxsuite/jx/commit/f9fba4f991d09a7b28026baa68c7c20a16394655))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([c73b161](https://github.com/jxsuite/jx/commit/c73b1616f09e0031df5bddf67aa00f1e6c435ddc))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([4ba9e30](https://github.com/jxsuite/jx/commit/4ba9e30967849112892d4af3744f8231d3b54a95))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([5936082](https://github.com/jxsuite/jx/commit/5936082f9519f486814e78a1d96ce4e2eb6bbdc1))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([311d58b](https://github.com/jxsuite/jx/commit/311d58b7547e3bc3a45243733e7c76879aaf5134))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([f6bda72](https://github.com/jxsuite/jx/commit/f6bda72f9af177fe74913dce644127c28e834ad9))
* **studio:** account for the persistent formula-palette mount in expression-editor.test.ts ([006851f](https://github.com/jxsuite/jx/commit/006851f23066c54e72ba37f16f9e4a5de4aa7c17))
* **studio:** contain create_page paths and drop the write ledger with its chat ([c733b4f](https://github.com/jxsuite/jx/commit/c733b4f7397b66f0d4b30baef9cfcd9257727fa0))
* **studio:** contain create_page paths and drop the write ledger with its chat ([1fd6482](https://github.com/jxsuite/jx/commit/1fd64822cc77773fa23cc8f3b07f3a9aa1161e78))
* **studio:** lower the functions coverage floor to match reality, not a regression ([6daee00](https://github.com/jxsuite/jx/commit/6daee00b5da1532e64f294479a98feb2af294847))
* **studio:** mark Command Bar controls no-drag in a form Electrobun can see ([f182eb9](https://github.com/jxsuite/jx/commit/f182eb9a720463a23c59a5fc6b18621372e752e5))
* **studio:** offer the account picker when Cloudflare names no account ([1337bc9](https://github.com/jxsuite/jx/commit/1337bc94b07d90c3ce481d1462cee4db197766f7))
* **studio:** one turn per window, and Stop stays on offer for all of it ([e426bd3](https://github.com/jxsuite/jx/commit/e426bd3a72ab81a9eaa5a24e5434a02e37f4e930))
* **studio:** one turn per window, and Stop stays on offer for all of it ([104f296](https://github.com/jxsuite/jx/commit/104f2963547d03dde1fe8ca676a148b8dae9df4c))
* **studio:** open a newly created project into a new window when one is already open ([5bdd74d](https://github.com/jxsuite/jx/commit/5bdd74d5b72d1a0603844d7cb71efd448c48bb55))
* **studio:** record the assistant's text and state edits as document ops ([b091a68](https://github.com/jxsuite/jx/commit/b091a6893e32689159ee8db4f76cb5ac16ddac26))
* **studio:** resolve three canvas/chrome stacking-order defects ([72b0b53](https://github.com/jxsuite/jx/commit/72b0b532a35f9faf6b7e75b9320af284e84105fa))
* **studio:** resolve three canvas/chrome stacking-order defects ([040fb5b](https://github.com/jxsuite/jx/commit/040fb5b40886b8f9c3ad937b1f9b178f7aee7acb))
* **studio:** responsive Source Control, Edit-only Document Header, chrome polish ([db68119](https://github.com/jxsuite/jx/commit/db68119d345637005d1bbe3de000640b42000f41))
* **studio:** Source Control, Document Header, button groups, and eight more chrome fixes ([b99443f](https://github.com/jxsuite/jx/commit/b99443fa3fbb930a5681d5ce030836b722a70475))
* **studio:** Stop is armed before the send path's first wait ([b0144cc](https://github.com/jxsuite/jx/commit/b0144cc20011a5c5bc777671adfbd90505c9c205))
* **studio:** Stop is armed before the send path's first wait ([be3d363](https://github.com/jxsuite/jx/commit/be3d36325c065218b2e155b7141c67543c842b12))
* **studio:** the docked header answers the wheel, the bar flips, and no label is an abbreviation ([837807f](https://github.com/jxsuite/jx/commit/837807fc5133a54a51178167c19695425b2719fc))
* **studio:** the merge's collisions, and a skip that could not fire ([195e0bc](https://github.com/jxsuite/jx/commit/195e0bc5c168775140d1b772505cab03493de6d1))
* **studio:** wrap-reverse is an overflow row, so no keyword is ever truncated ([d14da19](https://github.com/jxsuite/jx/commit/d14da19cd674474b89a9781a173f792dd6bc0b7b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.38.0
    * @jxsuite/collab bumped to 0.10.0
    * @jxsuite/create bumped to 1.3.12
    * @jxsuite/formulas bumped to 0.0.19
    * @jxsuite/markup bumped to 0.4.11
    * @jxsuite/protocol bumped to 2.4.0
    * @jxsuite/runtime bumped to 4.0.2
    * @jxsuite/schema bumped to 2.3.0
    * @jxsuite/site bumped to 2.0.2
    * @jxsuite/ui bumped to 0.4.0

## [5.3.0](https://github.com/jxsuite/jx/compare/studio-v5.2.0...studio-v5.3.0) (2026-09-22)


### Features

* **studio:** batch modulepreload links, cache scroller/track resolution ([d6bdfae](https://github.com/jxsuite/jx/commit/d6bdfaef7e714952d6153796f7be0ee3f3bd05f2))


### Bug Fixes

* **studio:** account for the persistent formula-palette mount in expression-editor.test.ts ([aa76f06](https://github.com/jxsuite/jx/commit/aa76f06a0745ecdf4da8aecd6044347ba2bd77ad))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ui bumped to 0.3.0

## [5.2.0](https://github.com/jxsuite/jx/compare/studio-v5.1.0...studio-v5.2.0) (2026-09-18)


### Features

* **studio:** tabs move between panes by drag, split, or Open to the Side ([befb5c1](https://github.com/jxsuite/jx/commit/befb5c1f95de36d855847acfe85a99a98914ab16))
* **studio:** tabs move between panes by drag, split, or Open to the Side ([3c8f96b](https://github.com/jxsuite/jx/commit/3c8f96b5b3f743752e94dc6be045c6e257058234))


### Bug Fixes

* **ai:** parse Cloudflare's array-shaped error envelope for BYOK providers ([e8158b6](https://github.com/jxsuite/jx/commit/e8158b680ec5dbbb016de784010768ca360cdd8a))
* **ai:** parse Cloudflare's array-shaped error envelope for BYOK providers ([172f061](https://github.com/jxsuite/jx/commit/172f06194f500312b4b8792839aa999ec9bc67b0))
* **studio:** mark Command Bar controls no-drag in a form Electrobun can see ([1c6753e](https://github.com/jxsuite/jx/commit/1c6753ea70dc9ebf4accc6984962f3a1791bd1f9))
* **studio:** mark Command Bar controls no-drag in a form Electrobun can see ([fc1349c](https://github.com/jxsuite/jx/commit/fc1349cecf4a44cd651314ebc5f06f0f2c32e9fe))
* **studio:** stub proxyModelsErrorMessage in the ai-models test doubles ([cd9dc69](https://github.com/jxsuite/jx/commit/cd9dc69f928d6619ee156d6fd9710b0c38e834d2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.37.2
    * @jxsuite/protocol bumped to 2.3.1

## [5.1.0](https://github.com/jxsuite/jx/compare/studio-v5.0.0...studio-v5.1.0) (2026-09-14)


### Features

* **studio:** open_document and set_canvas_mode are projections; project writes get a witness ([3429eee](https://github.com/jxsuite/jx/commit/3429eee49cccb7411e80200c6183dd8a61c1e652))
* **studio:** open_document and set_canvas_mode are projections; project writes get a witness ([8fd492d](https://github.com/jxsuite/jx/commit/8fd492dea8fb3e1b7833ad5b1893ba81aa7bd154)), closes [#334](https://github.com/jxsuite/jx/issues/334)
* **ui,studio:** jx-switch's hint is a tooltip while enabled, and the commandbar passes hint ([9ba4213](https://github.com/jxsuite/jx/commit/9ba4213e385a638e47a81725c36ad2288d32b831))
* **ui,studio:** jx-switch's hint is a tooltip while enabled, and the commandbar passes hint ([#332](https://github.com/jxsuite/jx/issues/332)) ([b2c9c6b](https://github.com/jxsuite/jx/commit/b2c9c6b582804626ffa30527db184fa5518cc035))


### Bug Fixes

* **desktop:** the first changed file's path no longer loses its first character ([b364aa9](https://github.com/jxsuite/jx/commit/b364aa9910f8af236a3f4c5e5b61af125fd04c94))
* **studio:** every surface runs a command through runReported, and the shot check matches coercion ([b6f0192](https://github.com/jxsuite/jx/commit/b6f019236fc6679ba14859249e24ee1ca95c9025))
* **studio:** every surface runs a command through runReported, and the shot check matches coercion ([12e5f06](https://github.com/jxsuite/jx/commit/12e5f062085477ff39feb661d74968d85abaebe8)), closes [#333](https://github.com/jxsuite/jx/issues/333)
* **studio:** saving a component definition updates its registry entry for the instances ([975f175](https://github.com/jxsuite/jx/commit/975f175f72d2ddb37998a01693f93eef02b6e5a6))
* **studio:** saving a component definition updates its registry entry for the instances ([ea195a3](https://github.com/jxsuite/jx/commit/ea195a3aa0e377a688593a6eadac2309a3520368))
* **studio:** the layout record and key order travel with the assistant's project.json write ([6f56385](https://github.com/jxsuite/jx/commit/6f56385dd0380ae65d9471109a7b3c28380e795a))
* **studio:** the layout record and key order travel with the assistant's project.json write ([afd601d](https://github.com/jxsuite/jx/commit/afd601d99b34b730ab1d07769880b72e7b59d31c)), closes [#331](https://github.com/jxsuite/jx/issues/331)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.11
    * @jxsuite/formulas bumped to 0.0.18
    * @jxsuite/runtime bumped to 4.0.1
    * @jxsuite/site bumped to 2.0.1
    * @jxsuite/ui bumped to 0.2.0

## [5.0.0](https://github.com/jxsuite/jx/compare/studio-v4.1.0...studio-v5.0.0) (2026-09-14)


### ⚠ BREAKING CHANGES

* **runtime,compiler,site,studio:** `@jxsuite/runtime` no longer writes authored declarations to `el.style`, so code reading them back off an element after `applyStyle` sees nothing. The `elementStyleTags` export is replaced by `releaseElementStyles` and `resetDocumentStyles`, which refcount a shared rule set rather than handing out an element to remove by hand; `documentStyleText` reads back what was written.

### Features

* popovers become a first-class thing the canvas can open, and a rule it can check ([63e5916](https://github.com/jxsuite/jx/commit/63e5916c7aa1b41771bed4029960192582b52c0f))
* **runtime,compiler,site,studio:** authored styles become adopted CSS rules ([d3a4fe1](https://github.com/jxsuite/jx/commit/d3a4fe19cbd50322a08a4230d8c62f811d0d256f))
* **runtime,site:** [@keyframes](https://github.com/keyframes) is a third at-rule body shape ([be15a9f](https://github.com/jxsuite/jx/commit/be15a9fb0dd0dfb2baf5ce2d6c29e362cda640f2))
* **runtime,studio:** a style block may document itself, and forced-colors.css is generated from one ([269f4c0](https://github.com/jxsuite/jx/commit/269f4c01b3f60209743a81eb60992fdd85b860ca))
* **runtime,studio:** dialogs, invoker commands and inert on the canvas ([4a1455e](https://github.com/jxsuite/jx/commit/4a1455ee6d0b86228c840529998d9fbed62e4442))
* **runtime,ui,studio:** the canvas loads kit behaviours lazily, and a kit save reaches every frame ([08df54c](https://github.com/jxsuite/jx/commit/08df54c2c3e6229d3ccfeaf0433a7ed3fc65e07e))
* **schema,runtime,compiler,site:** a style value may read state ([01e74c7](https://github.com/jxsuite/jx/commit/01e74c7f2d43cdcc9a3107b4ab30de4f769922d1))
* **schema,studio,compiler:** accessibility rules, judged alike by Studio, jx validate and the tests ([c14d121](https://github.com/jxsuite/jx/commit/c14d121e128bf64c041c401b8b0514f6133e133c))
* **schema:** dialog and invoker-command rules, beside the popover ones (spec §8.7) ([2d6f9ae](https://github.com/jxsuite/jx/commit/2d6f9ae79dce6caf33ccf07790d81151fa6a12aa))
* **studio,server,protocol:** one toggle installs an extension and enables it ([1fe5f67](https://github.com/jxsuite/jx/commit/1fe5f6731c00c9421e8dcd8d1ca100d2b06f740e))
* **studio,server,protocol:** one toggle installs an extension and enables it ([17b2627](https://github.com/jxsuite/jx/commit/17b26270db18e23f2f66f7bb15e67db64b2eac22))
* **studio,ui,runtime:** the Command Bar as a Jx document, closing the C2 surfaces ([f3f4fe2](https://github.com/jxsuite/jx/commit/f3f4fe2d39904bde5e5877946dc95ef6942d77a1))
* **studio,ui:** the Navigator rail as a Jx surface, on stacked action buttons ([3219ac7](https://github.com/jxsuite/jx/commit/3219ac72878b081b98e3d87ac308adc65e8dcd81))
* **studio,ui:** the settings menu on the menu surface, with a submenu level and live rows ([f9933d1](https://github.com/jxsuite/jx/commit/f9933d1fc3dc42381d6baa3dcba643b20f22326f))
* **studio,ui:** the three dock edges are jx-split, so a keyboard can size a dock ([181a641](https://github.com/jxsuite/jx/commit/181a641430515a6d28136a62838e38db931d6af0))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **studio:** Adobe Spectrum is removed ([5474e07](https://github.com/jxsuite/jx/commit/5474e0788a637089aead2c94f43b12fce0237fb1))
* **studio:** declaring aiTool makes the assistant's tool, and nothing else can ([51f279a](https://github.com/jxsuite/jx/commit/51f279ae1156788dff14113b22898661a0bce684))
* **studio:** declaring aiTool makes the assistant's tool, and nothing else can ([c182243](https://github.com/jxsuite/jx/commit/c182243e5d08c915343f9c292529b70f0df3699f)), closes [#273](https://github.com/jxsuite/jx/issues/273)
* **studio:** four more surfaces are documents, and two report why they cannot be ([a1e667d](https://github.com/jxsuite/jx/commit/a1e667d142a4e7e384b4cf877d66ee16a45b0afd))
* **studio:** four settings sections are documents, and mixed sections stop fighting over one host ([bd99313](https://github.com/jxsuite/jx/commit/bd9931304d0de97844a8a7546fdbe8a9a9a66f65))
* **studio:** highlight what changed in a diff, and open every changed file ([c87b2f3](https://github.com/jxsuite/jx/commit/c87b2f38bf97ec4f339cd9ac136885dd07d8ac7b))
* **studio:** highlight what changed in a diff, and open every changed file ([34a5dc8](https://github.com/jxsuite/jx/commit/34a5dc868f4863f929966bceca3562991222ea18))
* **studio:** registry.run coerces every command's args against its schema before run ([75244f6](https://github.com/jxsuite/jx/commit/75244f6e2af9926003dfe8f79ace8247f1585c5f))
* **studio:** registry.run coerces every command's args against its schema before run ([6bad59a](https://github.com/jxsuite/jx/commit/6bad59af181dbbdf1eda6428e9e578d65ba85dfc)), closes [#273](https://github.com/jxsuite/jx/issues/273)
* **studio:** six navigator and dock panels are documents ([698454a](https://github.com/jxsuite/jx/commit/698454a22f891a8f587a49d381dcaea6f68554f8))
* **studio:** Studio edits its own chrome — a saved surface or kit component re-mounts the shell ([e16676d](https://github.com/jxsuite/jx/commit/e16676d7d254a5f2c0a725ce18da36eaefd0ee13))
* **studio:** the About dialog is a document, and the pattern slice 13 follows ([c64d7ab](https://github.com/jxsuite/jx/commit/c64d7ab6193d77453aef63792100c2dc0a25707e))
* **studio:** the AI forms, publish, SEO, stylebook and the document header are documents ([6142111](https://github.com/jxsuite/jx/commit/6142111857976095e1ecc3daf809fe41354d586f))
* **studio:** the application frame is a Jx document ([7d551f7](https://github.com/jxsuite/jx/commit/7d551f750c84063f65dc93f08a729ca5132dc317))
* **studio:** the canvas chrome, both trees, the grid and the docks are documents ([7f36eac](https://github.com/jxsuite/jx/commit/7f36eac8a241f72f3519503c0522864a17443eda))
* **studio:** the canvas opens a popover in place, and reports the ones it cannot fix ([510c548](https://github.com/jxsuite/jx/commit/510c548cea7a4ebac21233663bda89bfc22e235f))
* **studio:** the command palette as a Jx document ([31f276d](https://github.com/jxsuite/jx/commit/31f276d5dbdcb186b3c47fab083b391f3062d3d4))
* **studio:** the confirm, save-or-discard and prompt dialogs as a Jx document over jx-dialog ([277a225](https://github.com/jxsuite/jx/commit/277a225b47ceea1698878590eaa904571543a7ad))
* **studio:** the Edit canvas resizes by dragging, and the breakpoint follows the width ([f3c072b](https://github.com/jxsuite/jx/commit/f3c072be6b33df857b9067b01cbf15168b4beb43))
* **studio:** the Edit canvas resizes by dragging, and the breakpoint follows the width ([d2a0a10](https://github.com/jxsuite/jx/commit/d2a0a1013f71100266530fb59a2d50b3594705c5))
* **studio:** the form engine, New Project, Preferences, the assistant and git are documents ([b13033b](https://github.com/jxsuite/jx/commit/b13033bd31d26964e94f1b09dc82169de6880c59))
* **studio:** the last lit surfaces are documents, and the stylesheets are 1,650 lines ([72fb5b1](https://github.com/jxsuite/jx/commit/72fb5b15ed4ed934f96120c9fdf7bda603e2ac72))
* **studio:** the Library, the formula palette and the repo picker are documents ([c326071](https://github.com/jxsuite/jx/commit/c3260714630cf48413e1049b94aaa668b9ab43a9))
* **studio:** the settings family is documents — six more sections, and the family is done ([3f70bee](https://github.com/jxsuite/jx/commit/3f70bee03322df10caea3a6a96a5a12c678ca975))
* **studio:** the shell frame's stylesheet is generated from a style block ([2fd55ef](https://github.com/jxsuite/jx/commit/2fd55ef8aa714f41d8f7b89405d1d545d9c5972f))
* **studio:** the Start pane as a Jx surface — the first whole pane as a document ([6e31a75](https://github.com/jxsuite/jx/commit/6e31a75a8be57f674ba43a85ad1a676cf343ceff))
* **studio:** the status bar as a Jx surface ([9318191](https://github.com/jxsuite/jx/commit/9318191fad42e55266e27758db61871dfdeee7da))
* **studio:** the styling gate reads a surface's style object, before there are surfaces to lose ([77c7942](https://github.com/jxsuite/jx/commit/77c7942079e1146634dd7925e125c1be292fa9b0))
* **studio:** the toast stack as a Jx document ([772ca71](https://github.com/jxsuite/jx/commit/772ca71687d761f47474cdf6f76c09edc52eb31d))
* **studio:** the UI kit at boot, the surface façade, and the chrome's tokens aliased to the kit ([1fda8c4](https://github.com/jxsuite/jx/commit/1fda8c4f256aa6d9195002822784d9ea79784bf9))
* **studio:** the whole Inspector is documents, and its dead lit helpers are gone ([5157337](https://github.com/jxsuite/jx/commit/5157337df85544194cefaca6a022f2b9bae7c376))
* **studio:** tokens.css is generated from a Jx style block, and the styling gate finally runs in CI ([7cea1d5](https://github.com/jxsuite/jx/commit/7cea1d5b43135472c26e17700c3aa1cef2c40f1c))
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
* **ui:** jx-popover is placed by CSS anchor positioning against the platform's implicit anchor ([9fbcc75](https://github.com/jxsuite/jx/commit/9fbcc75a1f66150cacf470ae015e9ecb6b604d35))


### Bug Fixes

* **ai:** stop sending an empty assistant turn, and replay a model's reasoning ([1aaa1d3](https://github.com/jxsuite/jx/commit/1aaa1d371862ed0f2d26fe9588ab3dd0d0fea838))
* **ai:** stop sending an empty assistant turn, and replay a model's reasoning ([01cc65d](https://github.com/jxsuite/jx/commit/01cc65d2cfe7b7e0f34cd1fcf0ec96a32f53677a))
* restore three spec releases the merge dropped, and one type-aware lint ([ec7a1d1](https://github.com/jxsuite/jx/commit/ec7a1d1888cfcfba994f458a0c6503738bf7f531))
* **runtime:** removing an observed attribute restores the declared default ([3900b63](https://github.com/jxsuite/jx/commit/3900b63540257da7f2e17ddd275875f2d7965a90))
* **schema,runtime,studio:** the overlay tools could not see a custom element ([bc57e9f](https://github.com/jxsuite/jx/commit/bc57e9f89f2030fcd0b5b5bdeffda2178683908f))
* **studio,server:** the diff view drew line numbers and no text ([4618933](https://github.com/jxsuite/jx/commit/46189330c881097ad1fe4db2ee24dda9f2aea744))
* **studio,ui,runtime,schema:** thirteen findings from the branch review ([9f80e82](https://github.com/jxsuite/jx/commit/9f80e82d245c7e2124a21828d97518dcac49f02a))
* **studio,ui:** three ways an overlay betrayed the reader ([68888ec](https://github.com/jxsuite/jx/commit/68888ec1eca0872ed784b77aca7cffb081d130bf))
* **studio:** a cloud recent project opens the project it names ([4789f56](https://github.com/jxsuite/jx/commit/4789f560d3c7ba0d7f375972b9837428175dc702))
* **studio:** a cloud recent project opens the project it names ([5a95d3f](https://github.com/jxsuite/jx/commit/5a95d3f7e66e3797140ac12c63afa332f83d6eda))
* **studio:** a JSON save keeps the file's layout, so one edit is a one-line diff ([9c49f7a](https://github.com/jxsuite/jx/commit/9c49f7a78101881294fa93d5f0d553b1ac8d11c5))
* **studio:** a JSON save keeps the file's layout, so one edit is a one-line diff ([505f28c](https://github.com/jxsuite/jx/commit/505f28cfa45fb1d4eb0d6c993f179412ae4bc9ba)), closes [#308](https://github.com/jxsuite/jx/issues/308)
* **studio:** a media tab has no document, so Save must not write one over the file ([1eaa960](https://github.com/jxsuite/jx/commit/1eaa960a442127691b339b9f4d811f5e889312b3))
* **studio:** the four gates the change-review branch broke ([2308029](https://github.com/jxsuite/jx/commit/23080297b22ab96de2f7bbcec55d41dc8997be6a))
* **studio:** the prompt's format choice is jx-select, and names a value rather than marking a row ([bd0abce](https://github.com/jxsuite/jx/commit/bd0abcea73d586a73dadde80ab8cd3827363671f))
* **studio:** three overlay regions ride on the node that has a box, so the lane can crop them ([42cb0d2](https://github.com/jxsuite/jx/commit/42cb0d2492f08229b12306dd3da18f647d5592de))
* stylized font and color selectors ([376798d](https://github.com/jxsuite/jx/commit/376798df96e47524054967afd0263e5be31314a7))
* **ui,studio,schema:** the five defects a browser found that no unit test could ([06e8d00](https://github.com/jxsuite/jx/commit/06e8d0045b3ad6bec99d777f11f9f0fc5570c512))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.37.1
    * @jxsuite/collab bumped to 0.9.0
    * @jxsuite/create bumped to 1.3.10
    * @jxsuite/formulas bumped to 0.0.17
    * @jxsuite/markup bumped to 0.4.10
    * @jxsuite/protocol bumped to 2.3.0
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0
    * @jxsuite/site bumped to 2.0.0
    * @jxsuite/ui bumped to 0.1.0

## [4.1.0](https://github.com/jxsuite/jx/compare/studio-v4.0.0...studio-v4.1.0) (2026-08-30)


### Features

* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([d61c756](https://github.com/jxsuite/jx/commit/d61c756ae3366d24769967be2b2057715bb73179))
* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([3bb1c59](https://github.com/jxsuite/jx/commit/3bb1c5965a54a4371cdad856d6119cd752c12721)), closes [#246](https://github.com/jxsuite/jx/issues/246)
* **studio,ai:** the assistant uses the backend's per-model capabilities ([24c7fcd](https://github.com/jxsuite/jx/commit/24c7fcd34eaf765d3905a0faa7676a8de0b9b0a9))
* **studio:** a hosted backend can import a site into a repository ([7ee546f](https://github.com/jxsuite/jx/commit/7ee546f46bbcab7227c51ae740b722394f8af8fe))
* **studio:** link About dialog in the Studio menu, add desktop window favicon ([58c666a](https://github.com/jxsuite/jx/commit/58c666a250348702f144f9583cf456160a577e7a))
* **studio:** link About dialog in the Studio menu, add desktop window favicon ([f8e8f9c](https://github.com/jxsuite/jx/commit/f8e8f9c887ad93530c47a90ed83719d572179d54))


### Bug Fixes

* **studio:** a lapsed Cloudflare grant no longer ends the connect flow before it starts ([3b0da9b](https://github.com/jxsuite/jx/commit/3b0da9bac30cf5b56cb86a871496df42a0a153aa))
* **studio:** a lapsed Cloudflare grant no longer ends the connect flow before it starts ([49fed18](https://github.com/jxsuite/jx/commit/49fed181a088cc91b4454a9fb8eaf1ef5f101e42))
* **studio:** drop the class the Verify switch never needed ([e6b5302](https://github.com/jxsuite/jx/commit/e6b5302679e3112cbb3c70726bc38f07d7be9a79))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.37.0
    * @jxsuite/collab bumped to 0.8.5
    * @jxsuite/create bumped to 1.3.9
    * @jxsuite/formulas bumped to 0.0.16
    * @jxsuite/markup bumped to 0.4.9
    * @jxsuite/protocol bumped to 2.2.0
    * @jxsuite/runtime bumped to 3.1.0
    * @jxsuite/schema bumped to 2.1.0
    * @jxsuite/site bumped to 1.1.0

## [4.0.0](https://github.com/jxsuite/jx/compare/studio-v3.0.0...studio-v4.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* **desktop:** both launchers can preview the working tree live ([a3349a3](https://github.com/jxsuite/jx/commit/a3349a3be4be33a99aa69b3dcd5ed291478f3b90))
* **import:** make jx-import --verify able to fail ([b7f7634](https://github.com/jxsuite/jx/commit/b7f7634fa26cedb5b8ac28c9a2daf4feb3783ae2)), closes [#232](https://github.com/jxsuite/jx/issues/232)
* **import:** the site-import workflow, end to end ([f701f33](https://github.com/jxsuite/jx/commit/f701f33bc035a8e5ce331530ff9886d25236da64))
* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))
* **server,studio:** the import stream says what the run found, and can check its own fidelity ([367f374](https://github.com/jxsuite/jx/commit/367f3740a42d90e0f769ad21097c555e25d88b4d))
* **studio,ai:** the assistant can stop and ask, and the turn waits for the answer ([d0ccbae](https://github.com/jxsuite/jx/commit/d0ccbae4da8c6442ece071243e9f143e1bf1b24d))
* **studio:** a backend may satisfy Open in Browser by rendering, not only by building ([8b599cf](https://github.com/jxsuite/jx/commit/8b599cf56792b70f82efb8e47050abf638cbc05e))
* **studio:** a prompt dialog can own a choice beside its field ([0ec5606](https://github.com/jxsuite/jx/commit/0ec5606bcf4056ac5663225d2526cb84f18cf3a8))
* **studio:** choose a format on New File, convert between formats, and inherit a collection's ([b206983](https://github.com/jxsuite/jx/commit/b2069834dc6f586aef9eed5c620e4378d5c46c22))
* **studio:** convert a document between formats, in place ([86d3cb5](https://github.com/jxsuite/jx/commit/86d3cb5ad0b320f48c897824206fe346093b9828))
* **studio:** New File chooses a format, and a collection folder fixes it ([17593d6](https://github.com/jxsuite/jx/commit/17593d6a807bdf10e7ea0b719886e7725046204b))
* **studio:** Open in Browser previews the canvas, and Build Site keeps the compiler ([b834eef](https://github.com/jxsuite/jx/commit/b834eefd1107663832695e99335919ccec42e9a4))
* **studio:** set the import's fidelity minimum in the New Project dialog ([ce1c05d](https://github.com/jxsuite/jx/commit/ce1c05d09336f8eb8e767988a119b517e625f6fa))
* **studio:** the Files tree hides what .gitignore masks ([da8b7e3](https://github.com/jxsuite/jx/commit/da8b7e3f55aa4a4e09e1d156854bf6fd4e3c033e))
* **studio:** the Files tree hides what .gitignore masks ([ef6d14b](https://github.com/jxsuite/jx/commit/ef6d14be9f84997e3d1118fb9f963f55c08b07ea))
* **studio:** the Import source chooses its own model, and states what to do with the site ([9355b2f](https://github.com/jxsuite/jx/commit/9355b2f2066ec66bc55ccb609b67494533f6b813))
* **studio:** the rail foot is a Settings menu over both settings families ([3202ba1](https://github.com/jxsuite/jx/commit/3202ba19c4ba32b96dfac496a63861c7af84c7fa))
* **studio:** the rail foot is a Settings menu over both settings families ([1bed4d6](https://github.com/jxsuite/jx/commit/1bed4d6d59dcdff3679a4ce4cb632728f8f6e0fe))
* **studio:** the site import is an agent turn — model, brief, live status, and a pause to ask ([3afd38c](https://github.com/jxsuite/jx/commit/3afd38c254e368f95eccbe01ca6f1168fe279aac))
* **studio:** the site import runs in the assistant, where it can be watched and questioned ([2f586f9](https://github.com/jxsuite/jx/commit/2f586f924ea4893d2ecc5d457582701b4864eb49))
* **studio:** watch an import in the project, in a feed that outlives the run ([5fe22e2](https://github.com/jxsuite/jx/commit/5fe22e29a4eb32e9c3c87f5fbc503f4183ee0060))


### Bug Fixes

* **desktop,import:** the two gates the live preview left red, and the coverage it owed ([c9d56d2](https://github.com/jxsuite/jx/commit/c9d56d2495f1da84997768e6144718be7380de07))
* **docs,studio:** satisfy the prose gate and the type-aware lint ([0d3712a](https://github.com/jxsuite/jx/commit/0d3712a01ae6803f04d7de5b619c60f921cd1d9e))
* **screenshots:** stop the screenshot lane churning, and fix the three defects underneath it ([b0d5f57](https://github.com/jxsuite/jx/commit/b0d5f570db2d8aa839469ad846eced8cf3051067))
* **server,studio:** findReferences answers about every reference, and the rename keeps its promise ([ce3266f](https://github.com/jxsuite/jx/commit/ce3266f3966363ef602201a864047d3a7314c22f))
* **studio:** a nested style path that empties takes its emptied parents with it ([b81cbcb](https://github.com/jxsuite/jx/commit/b81cbcb3a0abb81dff6f50b8a38400214840bd12))
* **studio:** close the settings-submenu rule, which swallowed 22 rules after it ([244525d](https://github.com/jxsuite/jx/commit/244525d84cd06969a31d85e2f36a0a82dd1e30a0))
* **studio:** double the lazy converter, so the test asserts and the coverage record survives ([844d0f8](https://github.com/jxsuite/jx/commit/844d0f89518dd00a87ae0df92576ad5118bf4b81))
* **studio:** double the lazy converter, so the test asserts and the record survives ([a8c1f41](https://github.com/jxsuite/jx/commit/a8c1f41d6ff073c693eaba53ab50794353cfd006))
* **studio:** re-read the format registry after installing a project's dependencies ([af2d65a](https://github.com/jxsuite/jx/commit/af2d65a208a1358000a88eb2b6644f134eaab679))
* **studio:** report the references a move could not rewrite ([833d4be](https://github.com/jxsuite/jx/commit/833d4beeca6de9c85b0cd18cc999724cab837534)), closes [#239](https://github.com/jxsuite/jx/issues/239)
* **studio:** stop stripping the project root off a reply that is already in it ([fd2c913](https://github.com/jxsuite/jx/commit/fd2c9136b746f88d49694a7ac0cfb7feaacbe88d)), closes [#239](https://github.com/jxsuite/jx/issues/239)
* **studio:** the agent's create path initialises a repository, and a stopped tool cannot poison history ([b8b5478](https://github.com/jxsuite/jx/commit/b8b547826f95481f48374eaa150962a8f1dd351f))
* **studio:** the empty-text placeholder disappears when you type into the block ([190762d](https://github.com/jxsuite/jx/commit/190762d9059af7c699374b98c7f3d6c611a8630b))
* **studio:** the empty-text placeholder disappears when you type into the block ([a2baaf0](https://github.com/jxsuite/jx/commit/a2baaf07a82b00054669f191f88923bd65c08154))
* **studio:** the Packages table shows each dependency's own npm latest ([fe75f46](https://github.com/jxsuite/jx/commit/fe75f46c08b31ffc8fee3bce51edbe98e10ec772))
* **studio:** the Packages table shows each dependency's own npm latest ([e6610a8](https://github.com/jxsuite/jx/commit/e6610a859613c40ff6f4cb2c20652dc267cb234f))
* **studio:** the Packages table shows each dependency's own npm latest ([30d997b](https://github.com/jxsuite/jx/commit/30d997b3d25cad7b00ab8c2fdc4413d728b7e124))
* **studio:** wait for the grid's range outline, not just its range model ([b1d128a](https://github.com/jxsuite/jx/commit/b1d128a124d74300ae89392421553d53731199b5))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.36.5
    * @jxsuite/collab bumped to 0.8.4
    * @jxsuite/create bumped to 1.3.8
    * @jxsuite/formulas bumped to 0.0.15
    * @jxsuite/markup bumped to 0.4.8
    * @jxsuite/protocol bumped to 2.1.0
    * @jxsuite/runtime bumped to 3.0.0
    * @jxsuite/schema bumped to 2.0.0
    * @jxsuite/site bumped to 1.0.0

## [3.0.0](https://github.com/jxsuite/jx/compare/studio-v2.4.3...studio-v3.0.0) (2026-08-26)


### ⚠ BREAKING CHANGES

* **studio,desktop:** StudioPlatform's `saveSettings` is replaced by `patchSettings`, which takes a set/remove patch and answers with the resulting store. It stays optional, so an adapter that implements neither degrades to cache-only rather than throwing.

### Features

* **protocol:** type what an upload answers, and what a backend will accept ([d7d64e9](https://github.com/jxsuite/jx/commit/d7d64e9784dfcfabda28e44826ed6509660add6f))
* **schema,runtime,studio:** the shared path math and a default-off canvas asset resolver ([4aad802](https://github.com/jxsuite/jx/commit/4aad80220632ac4ef415172c00ecbbd1a5e95642))
* **studio:** declare assetSpace, and resolve media in the canvas realm ([9be7db9](https://github.com/jxsuite/jx/commit/9be7db9151e520caf2f65826968956f25304710b))
* **studio:** declare assetSpace, and resolve media in the canvas realm ([2344271](https://github.com/jxsuite/jx/commit/2344271d5f96728af1a2b3c00bd1e326e0ba1582))


### Bug Fixes

* **compiler,runtime,studio:** a bare media type in an at-key emits without parentheses ([79b6fd6](https://github.com/jxsuite/jx/commit/79b6fd69bfbdec9de399790c51cbc874614f6c57))
* **screenshots:** re-capture only when the picture actually moved ([f8e749a](https://github.com/jxsuite/jx/commit/f8e749a415aa0a381e70101132839ac3fed9efa7))
* six output-correctness defects, two of them live on jxsuite.com ([67663a9](https://github.com/jxsuite/jx/commit/67663a97b062313b3dc419e99fef556ed70539e5))
* **studio,desktop:** settings are patches, and a blank field never deletes ([7e73fa9](https://github.com/jxsuite/jx/commit/7e73fa9c6d45e53a30f82b08148f9a7547fd22bc))
* **studio:** a collection grid opens in the same order, and reports when it is drawn ([060e981](https://github.com/jxsuite/jx/commit/060e9819b4d2f2a21e0f7932486c1f6cc6cf142d))
* **studio:** a translated entry has a mount, and one predicate decides a media field ([582a03e](https://github.com/jxsuite/jx/commit/582a03e52580437a0e3144d10717f5f1b09ab481))
* **studio:** keep the canvas iframe out of the editor shell ([7e8f6ba](https://github.com/jxsuite/jx/commit/7e8f6baf516c72c9685d56b76c12eeeeb34fcb1d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.36.4
    * @jxsuite/collab bumped to 0.8.3
    * @jxsuite/create bumped to 1.3.7
    * @jxsuite/formulas bumped to 0.0.14
    * @jxsuite/markup bumped to 0.4.7
    * @jxsuite/protocol bumped to 2.0.0
    * @jxsuite/runtime bumped to 2.1.0
    * @jxsuite/schema bumped to 1.9.0

## [2.4.3](https://github.com/jxsuite/jx/compare/studio-v2.4.2...studio-v2.4.3) (2026-08-25)


### Bug Fixes

* **cloud:** discover components by reading them, so the canvas can register any ([#200](https://github.com/jxsuite/jx/issues/200)) ([45f650a](https://github.com/jxsuite/jx/commit/45f650a2554b6b8547fe69c72e73e1920bd65dfa))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.36.3
    * @jxsuite/collab bumped to 0.8.2
    * @jxsuite/create bumped to 1.3.6
    * @jxsuite/formulas bumped to 0.0.13
    * @jxsuite/markup bumped to 0.4.6
    * @jxsuite/protocol bumped to 1.2.1
    * @jxsuite/runtime bumped to 2.0.5
    * @jxsuite/schema bumped to 1.8.1

## [2.4.2](https://github.com/jxsuite/jx/compare/studio-v2.4.1...studio-v2.4.2) (2026-08-24)


### Bug Fixes

* **canvas:** a prop slot refuses a value the node delivers another way ([435a679](https://github.com/jxsuite/jx/commit/435a679a700ece78bda81eab93f418ecb92d6729))
* **canvas:** a prop slot refuses a value the node delivers another way ([6c793c2](https://github.com/jxsuite/jx/commit/6c793c210fcb10da9109ae46e688ea72ef07ebae))
* **canvas:** the document base is absolute, so the canvas mounts ([#189](https://github.com/jxsuite/jx/issues/189)) ([052363a](https://github.com/jxsuite/jx/commit/052363aed431dd93dbce69475f277ebfbaf0ae3d))
* **ci:** keep bun.lock at lockfileVersion 1 and declare the bun types ([919e1a1](https://github.com/jxsuite/jx/commit/919e1a11ebda150ed869439da472f54321fb0925))
* **studio:** make the reachability harness agree with TypeScript about paths ([a93416f](https://github.com/jxsuite/jx/commit/a93416fd30378ee789ffd96b51a160ddd27d6abc))
* **tests:** make the Windows suites runnable ([b18435d](https://github.com/jxsuite/jx/commit/b18435dcf1162be38a01c5c48c4ae310be88c4d2))
* the last two Windows-only test failures ([eb9c587](https://github.com/jxsuite/jx/commit/eb9c587a64bc3f42095392a746bd6d4edcdf030d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/formulas bumped to 0.0.12

## [2.4.1](https://github.com/jxsuite/jx/compare/studio-v2.4.0...studio-v2.4.1) (2026-08-24)


### Bug Fixes

* **canvas:** a component-slot session writes only what you typed, and hands the host back ([#182](https://github.com/jxsuite/jx/issues/182)) ([9934e0c](https://github.com/jxsuite/jx/commit/9934e0cbdaf1e3f9f3af37dc9c6f63127f15a2c0))
* **canvas:** a prop slot survives the rebuild, and refuses a value it does not own ([#187](https://github.com/jxsuite/jx/issues/187)) ([76919ca](https://github.com/jxsuite/jx/commit/76919ca6f47192227ec4f01d7bf23dcfb9a9e0b2))
* **canvas:** keystrokes land in a component slot, not just the caret ([#181](https://github.com/jxsuite/jx/issues/181)) ([80abd59](https://github.com/jxsuite/jx/commit/80abd593eccc65349af6c2f0d8e3b9b5170d7b83))
* **canvas:** prose slotted into a component is editable again ([#179](https://github.com/jxsuite/jx/issues/179)) ([be0f7df](https://github.com/jxsuite/jx/commit/be0f7df9f3b0f804c3a646cfc201406e0fd93847))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.5
    * @jxsuite/formulas bumped to 0.0.11
    * @jxsuite/runtime bumped to 2.0.4

## [2.4.0](https://github.com/jxsuite/jx/compare/studio-v2.3.0...studio-v2.4.0) (2026-08-23)


### Features

* **studio:** Cloudflare is the lead AI recommendation, and can be reconnected ([#174](https://github.com/jxsuite/jx/issues/174)) ([01015f4](https://github.com/jxsuite/jx/commit/01015f496f8e13d9b06076de701cd1feccaaf2be))


### Bug Fixes

* **canvas:** project files load on a host that does not serve them at its root ([#176](https://github.com/jxsuite/jx/issues/176)) ([d6545da](https://github.com/jxsuite/jx/commit/d6545dae6fc801731519210e698a40d37d76023f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.36.2
    * @jxsuite/create bumped to 1.3.4
    * @jxsuite/formulas bumped to 0.0.10
    * @jxsuite/protocol bumped to 1.2.0
    * @jxsuite/runtime bumped to 2.0.3

## [2.3.0](https://github.com/jxsuite/jx/compare/studio-v2.2.2...studio-v2.3.0) (2026-08-23)


### Features

* **studio:** gate the two rules that make a template the only writer ([e1fff3d](https://github.com/jxsuite/jx/commit/e1fff3d22595240feeacfdec657560b3740a57b3))
* **studio:** the package states its own layout, and generates its documents ([e48eb70](https://github.com/jxsuite/jx/commit/e48eb706fab2b4aec7695ae9b98857d3958ed962))
* **studio:** the package states its own layout, and hosts itself ([b94f87b](https://github.com/jxsuite/jx/commit/b94f87b5daa1788090be957302ea224504a743cd))


### Bug Fixes

* **studio:** make the template the only writer where two writers diverged ([3f1d28d](https://github.com/jxsuite/jx/commit/3f1d28db4664134a043143ec1aafe4e5ed928b28))
* **studio:** resolve Monaco workers against the entry, not the chunk ([91983e9](https://github.com/jxsuite/jx/commit/91983e9991ae65f5068484a152de9bc69c7d372f))
* **studio:** the hosting contract compiles under a consumer's flags ([9feeca3](https://github.com/jxsuite/jx/commit/9feeca338798525a06fc4ee5a91aee8054a9c51d))

## [2.2.2](https://github.com/jxsuite/jx/compare/studio-v2.2.1...studio-v2.2.2) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/create bumped to 1.3.3

## [2.2.1](https://github.com/jxsuite/jx/compare/studio-v2.2.0...studio-v2.2.1) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.36.1
    * @jxsuite/collab bumped to 0.8.1
    * @jxsuite/create bumped to 1.3.2
    * @jxsuite/formulas bumped to 0.0.9
    * @jxsuite/markup bumped to 0.4.5
    * @jxsuite/protocol bumped to 1.1.2
    * @jxsuite/runtime bumped to 2.0.2
    * @jxsuite/schema bumped to 1.8.0

## [2.2.0](https://github.com/jxsuite/jx/compare/studio-v2.1.0...studio-v2.2.0) (2026-08-21)


### Features

* **desktop:** bring the chromium launcher to PAL parity with electrobun ([595d413](https://github.com/jxsuite/jx/commit/595d41325c4d81322dc5fe927161e07af51d35a2))
* **desktop:** bring the chromium launcher to PAL parity with electrobun ([9f13748](https://github.com/jxsuite/jx/commit/9f137482449ba887279aeb838b2c4c275c37a494))
* **studio:** own the Monaco↔Y.Text binding, and move to monaco-editor 0.56 ([e8e8a93](https://github.com/jxsuite/jx/commit/e8e8a93b6c27173fefcc73e63b244c1e96b5a49a))
* **studio:** own the Monaco↔Y.Text binding, and move to monaco-editor 0.56 ([b61866d](https://github.com/jxsuite/jx/commit/b61866ddc7b601605a6717ea4f68e11f47bcdabb))


### Bug Fixes

* **ci:** make the coverage manifest gate prove its accusation ([bcef12c](https://github.com/jxsuite/jx/commit/bcef12cd2e12cc7ed300c170ab9128ada09076e6))
* **ci:** make the coverage manifest gate prove its accusation ([b5d99cc](https://github.com/jxsuite/jx/commit/b5d99cc0e5a6292fcbb14e4221bd590609e3f913))
* defects surfaced by fact-checking the new package READMEs ([1d3a125](https://github.com/jxsuite/jx/commit/1d3a125051350ee10de2906f6dede52509c8bbe3))
* **studio:** make the light chrome theme actually apply ([f19d85a](https://github.com/jxsuite/jx/commit/f19d85a34318a799c01714d5fe8c264325b5fdeb))
* **studio:** make the light chrome theme actually apply ([735993d](https://github.com/jxsuite/jx/commit/735993d3bc9e30f26ab3f662237525b4e8043731))
* **studio:** point the bundle budget at the studio.js the lane actually builds ([35e41fb](https://github.com/jxsuite/jx/commit/35e41fb927484b076401f9bce3e0e5fca6db3b77))
* **studio:** stop four tests depending on the working directory and a tick count ([4fb37a7](https://github.com/jxsuite/jx/commit/4fb37a712b37964456dfdbd06516e104106cc47a))
* **studio:** stop the canvas source-mode tests racing the Monaco load ([0f02535](https://github.com/jxsuite/jx/commit/0f025351a924e72f9c68e89be840c9a868908ec8))
* **studio:** the two Test-workflow failures on the tip of main ([42ad70a](https://github.com/jxsuite/jx/commit/42ad70a63c9076bd1b89b0d0b2ebeaec820fa445))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.36.0
    * @jxsuite/collab bumped to 0.8.0
    * @jxsuite/create bumped to 1.3.1
    * @jxsuite/formulas bumped to 0.0.8
    * @jxsuite/markup bumped to 0.4.4
    * @jxsuite/protocol bumped to 1.1.1
    * @jxsuite/runtime bumped to 2.0.1
    * @jxsuite/schema bumped to 1.7.0

## [2.1.0](https://github.com/jxsuite/jx/compare/studio-v2.0.1...studio-v2.1.0) (2026-08-19)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **collab:** negotiate the wire envelope on the handshake — jx.collab.v1 ([25c3cf3](https://github.com/jxsuite/jx/commit/25c3cf31feeb4087797e7d9f182cb4f7345c4fcb))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **protocol:** one failure shape — RFC 9457 problem details ([e2598da](https://github.com/jxsuite/jx/commit/e2598dab57d672d3c0f805d1d5789ad955c9df2f))
* **runtime:** enforce private state against $props (spec.md §5.6) ([5e9b029](https://github.com/jxsuite/jx/commit/5e9b0299ad116be4ff61af4e1d3569ad0a6323e9))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** parse media types, and enforce I-JSON at the document boundary ([068811e](https://github.com/jxsuite/jx/commit/068811e83278b0b55d82dd2e88ff838bfabfd05e))
* **server:** read Fetch Metadata, and close the three ungated project-server routes ([0e69837](https://github.com/jxsuite/jx/commit/0e698374ba5f251548d293f8553b12d308e07463))
* **server:** ship the Trusted Types observation stage (spec.md §21.5) ([fd616c5](https://github.com/jxsuite/jx/commit/fd616c5b566ea3fb1903f8d67a38c844a66f0ebb))
* **server:** the live-reload stream reconnects, and the import stream stops hiding drops ([8d5aff6](https://github.com/jxsuite/jx/commit/8d5aff63aec49499459b8d1b80d2510d02f3be93))
* **studio,desktop:** P0 wave A — enforcement rails and three dead RPCs ([da8071d](https://github.com/jxsuite/jx/commit/da8071d93d783fa80a48e73fe6e6093c10461f2c))
* **studio,screenshots:** P0 2b S0+S1 — deterministic capture, and a rename is now a red X ([21db6b0](https://github.com/jxsuite/jx/commit/21db6b0d901e1b8d65f6195d5d2386dccc3627b4))
* **studio,screenshots:** P0 2b S2 — the shot contract, and the app stops carrying the camera ([d3189f7](https://github.com/jxsuite/jx/commit/d3189f77bb739d69595cc1fef1a5c63469b9d336))
* **studio,server,desktop:** P4 wave A — the app can say what happened ([c319576](https://github.com/jxsuite/jx/commit/c3195762c0dd76472355dd3ae0eb9ba6fc12c0d3))
* **studio:** "resolving with" becomes a popover, and its values become commands ([aaafef6](https://github.com/jxsuite/jx/commit/aaafef65222031d50c9e7f78142d8fa4b4673a9c))
* **studio:** a project reopens with the documents it was left with ([7d16fc2](https://github.com/jxsuite/jx/commit/7d16fc230eb5cc4f9df2d8e6ea90ba9f102dca99))
* **studio:** a Trusted Types policy that refuses, and two CSP profiles stated as permanent ([b2d449b](https://github.com/jxsuite/jx/commit/b2d449beb0c6b83b27bb90b099e1368c1fc2c44a))
* **studio:** check the author's own content — ATAG Part B, filed as Problems ([6247668](https://github.com/jxsuite/jx/commit/6247668da1f8c45fb50a82eb47b7039deb893565))
* **studio:** clicking into a pane focuses it, and the rule that guards panes parses ([5bee90f](https://github.com/jxsuite/jx/commit/5bee90fddf2e37d8df3f66618498bca99f8c1065))
* **studio:** event names are typed, and a bound chip opens its source on every tab ([6497c5e](https://github.com/jxsuite/jx/commit/6497c5ef31e5c85082367ec6414f6e260f492f66))
* **studio:** one keymap, two realms — and every capability with a chord is a record ([d25d669](https://github.com/jxsuite/jx/commit/d25d6693659e7c945fdd09ebc350b1d2a3a82d86))
* **studio:** P1 First Contact — make the first ten minutes work ([8ed764c](https://github.com/jxsuite/jx/commit/8ed764c230ae847c801fbcd29ec45809339b2cbd))
* **studio:** P2 wave 1 — a reactive shell record and the command registry ([9872ba5](https://github.com/jxsuite/jx/commit/9872ba5cffb92d4af405b47bf0474e6d2db7f5c6))
* **studio:** P2 wave 2 — the keyboard, menus and toolbars become renderings ([ac8bcc3](https://github.com/jxsuite/jx/commit/ac8bcc33f463da8c69674f56c4fafa10521f0189))
* **studio:** P3 complete — the frontmatter band and the tab bar are gone ([6af2311](https://github.com/jxsuite/jx/commit/6af231119e2eac1ebb72c4d02e7a24da4d1a546c))
* **studio:** P3 wave A — panels become records, the chrome becomes a rendering ([9b51ccf](https://github.com/jxsuite/jx/commit/9b51ccfd8f9ea0e67dfaa76d12b681936a094a81))
* **studio:** P3 wave B (part) — the Assistant folds in, Preferences exist, panes are real ([ff4269a](https://github.com/jxsuite/jx/commit/ff4269a6187cb878d152d2c6270f4e105d8aec8f))
* **studio:** P4 wave B — the dock, one definition site for contexts, and two layers that stop lying ([e0e769c](https://github.com/jxsuite/jx/commit/e0e769ce04436d847cef2b91693291dfd540d1d2))
* **studio:** P5 — the inspector states what it edits and where the edit lands ([9ab7b5a](https://github.com/jxsuite/jx/commit/9ab7b5a8553eaa29fbd4507bed64aa619a9b2d86))
* **studio:** P6 — configuration is a document, so a settings mistake is recoverable ([a538e45](https://github.com/jxsuite/jx/commit/a538e45a5c51f218e70490d49af7a4f654597400))
* **studio:** P7 — the Library, entries and drafts, safe delete, redirects and shipping ([32a5079](https://github.com/jxsuite/jx/commit/32a5079a992b316f19152c84abcb179b278bf388))
* **studio:** P8 — panes, the jump bar, and the editors that stopped hiding the page ([88b3053](https://github.com/jxsuite/jx/commit/88b3053d0e05e1538a3ba2f59cd9a6d37e61a0c9))
* **studio:** P8 workstream 2 — two live panes, and a grid that is a lit template ([ac3a70a](https://github.com/jxsuite/jx/commit/ac3a70a5a8614f8ca3430603331a73858bf4ddb7))
* **studio:** P8 workstreams 3 and 6 — the derived pane, and a gate that states its own boundary ([cfc79a7](https://github.com/jxsuite/jx/commit/cfc79a78837b06e3dd1a6ce881a205989d9f42e6))
* **studio:** Preview is a toggle over Edit and Design, and it scrolls ([b7cb17c](https://github.com/jxsuite/jx/commit/b7cb17ceff3011f56bf6aadaacc4b5a518bb7e51))
* **studio:** Problems leaves the Navigator rail ([b426cec](https://github.com/jxsuite/jx/commit/b426cec456ff0a4dd3ffa54c35ea79948490ead7))
* **studio:** say it out loud — one live region, and the affordances high contrast deletes ([e5fffdf](https://github.com/jxsuite/jx/commit/e5fffdff8f7107e7d98aaa51a81e7b1f93cf9ca1))
* **studio:** Search appearance leaves the card and becomes a room of its own ([ca9478b](https://github.com/jxsuite/jx/commit/ca9478b819a51b5474d62d79966e9554e1b38090))
* **studio:** the context budget is shown, and the Library gets its chord ([96dcedf](https://github.com/jxsuite/jx/commit/96dcedf5b49b9aac0f3654ca8d4e286d0c55701d))
* **studio:** the Data row's other two clauses — real expand actions, a real loading state ([f902d8a](https://github.com/jxsuite/jx/commit/f902d8ac67502144965e492baa1eed9122b6356f))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))
* **studio:** the rendering context becomes three commands, and the canvas margin gets its menu back ([b71afaa](https://github.com/jxsuite/jx/commit/b71afaa45ae30b0f3220038e7f54039262689584))
* **studio:** the size switcher resizes the Edit canvas ([eea452b](https://github.com/jxsuite/jx/commit/eea452b683fce9d3c0b02f9da55d7492d03df7e6))
* **studio:** the State panel comes back, as the Data panel ([af5beed](https://github.com/jxsuite/jx/commit/af5beed35d498aa171573063f0145a8f0a7e7125))
* **studio:** work in more than one language ([9425736](https://github.com/jxsuite/jx/commit/94257368a13c70b73cfd3afd955e2229c7d6cc99))


### Bug Fixes

* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **screenshots:** the four red shots were the stale starter pins, not the shots ([fc9ec72](https://github.com/jxsuite/jx/commit/fc9ec72f24237aa19004ba8afe88ac2e5b2b1ec3))
* **server:** give the previewed site its own origin, so Open in Browser is the real site ([fcbaa0b](https://github.com/jxsuite/jx/commit/fcbaa0bc7679727cc20caf50e86ac10cf6aca911))
* **studio,compiler:** the disagree-with-itself families, and a computed the compiler never compiled ([675a69e](https://github.com/jxsuite/jx/commit/675a69e65b5c79a294f90a40e633477f21dd3e2a))
* **studio:** a refused write stops reporting success, and every exit settles the buffer ([de2386a](https://github.com/jxsuite/jx/commit/de2386ad4682fe6e32d83e946436e2f6e8ab94d7))
* **studio:** a surface drawn for a pane may not write through focus ([674a6ac](https://github.com/jxsuite/jx/commit/674a6acd572d7f8380272d815192886545bd19b3))
* **studio:** an uncommitted draft belongs to a node, not to a field name ([a730e78](https://github.com/jxsuite/jx/commit/a730e78ee11e754c43d4382a3c03bff8a2492104))
* **studio:** don't prompt for dependency updates during automation ([83e22d7](https://github.com/jxsuite/jx/commit/83e22d74337dd385c5d72d132c2fdab7489405e6))
* **studio:** editing a component is not editing an instance of it ([db016c4](https://github.com/jxsuite/jx/commit/db016c4547be5f56289b0e2dae6187a4f083cf62))
* **studio:** eleven icons that rendered as empty boxes, and the gate that finds the twelfth ([8d41338](https://github.com/jxsuite/jx/commit/8d41338d546e649ff1a0665efc8303cc08902923))
* **studio:** four defects the coverage sweep walked into ([39172b3](https://github.com/jxsuite/jx/commit/39172b3335b7e78e94ef4664b7a8f3ae689b434e))
* **studio:** let a self-scrolling stage take the wheel, and block page zoom on it ([6f9b16b](https://github.com/jxsuite/jx/commit/6f9b16b695521e445bb486c172e808bfa5a35919))
* **studio:** let a self-scrolling stage take the wheel, and block page zoom on it ([72cb776](https://github.com/jxsuite/jx/commit/72cb776cdf36f9ffb9f19f7e8bc3b7db2be711bd))
* **studio:** lift the progress modal above its own scrim ([b349fd8](https://github.com/jxsuite/jx/commit/b349fd8e85518c60fb78a082cd9efe1583eafd75))
* **studio:** Open Project's "New Window" opened in this window ([6427bbf](https://github.com/jxsuite/jx/commit/6427bbfe9122d3e6688d09b7c3854bdba6b3f1f3))
* **studio:** Open Project's "New Window" opened in this window ([9ac528f](https://github.com/jxsuite/jx/commit/9ac528f80b1d6937fd3dfa426dc344ddf9979d79))
* **studio:** stop the mutation gate reading a full pipe as a Ctrl-C ([0cfaaf4](https://github.com/jxsuite/jx/commit/0cfaaf49dcdee03ce9b358f039b61e387c191f2b))
* **studio:** the action bar steps aside, and a form row wraps instead of leaving the panel ([48a9952](https://github.com/jxsuite/jx/commit/48a99523a57b8902a2c551efda07f5129517e8ac))
* **studio:** the agent's gate and the human's gate become one predicate ([c8cff49](https://github.com/jxsuite/jx/commit/c8cff49b12e94653cba68f96425c2f907ba07818))
* **studio:** the eighteen promise-safety errors this branch put in lint:typecheck ([80201d0](https://github.com/jxsuite/jx/commit/80201d0107d6614887bdf36fe8355bb04a8b7014))
* **studio:** the icon I deleted, the two I never fixed, and the checker that approved all three ([4747bff](https://github.com/jxsuite/jx/commit/4747bff6c22a92e7356090ea52c3039a218f4967))
* **studio:** the Outline's tag badge, and a sweep so this is the last round of finding these ([7183071](https://github.com/jxsuite/jx/commit/7183071a26dcafb0ca7f53c9420ede848a39c39f))
* **studio:** the pane cell is one column, the splitter is auto-placed, and the shots are recaptured ([1d7e4e2](https://github.com/jxsuite/jx/commit/1d7e4e25d5f5fc37618037b1402da5145ad456ce))
* **studio:** the pane count counts panes, and a caret belongs to the pane that owes it ([9ecf356](https://github.com/jxsuite/jx/commit/9ecf35697f5672e45ff736cd44042ed2c2475e29))
* **studio:** the pane rule sees the seams it was blind to, and five more focus reads ([68e44df](https://github.com/jxsuite/jx/commit/68e44dfb2f9438d0d498e5ce489166632c54a405))
* **studio:** the slash menu had no working trigger, and now it has two ([a33f139](https://github.com/jxsuite/jx/commit/a33f13912dd892da69bb118ee20802db2cb8198d))
* **studio:** the Tag row joins the value-source ladder instead of hand-rolling one ([9ede409](https://github.com/jxsuite/jx/commit/9ede409f0d6f1b0d65d4cc22a94093a04c0ea238))
* **studio:** the three ways out of an editor that were still outside the gate ([4b8b636](https://github.com/jxsuite/jx/commit/4b8b6363748db888f021edb7d3a380556947e042))
* **studio:** the update prompt asks the registry, not this build's version number ([05b28e0](https://github.com/jxsuite/jx/commit/05b28e073c34475367e204c9079aadf2f002569c))
* **studio:** three surfaces that named something the app no longer has ([80c6e31](https://github.com/jxsuite/jx/commit/80c6e31049d5eeffe9169abe1bf7c6de6c53e3a9))
* **studio:** Write gets its 80%, and a value at rest stops pretending to load ([3509ae7](https://github.com/jxsuite/jx/commit/3509ae748e590cfd5ea528bd1a406c043c5e8ca5))
* **types:** repair the two typecheck errors the workspace tsconfigs see ([908f661](https://github.com/jxsuite/jx/commit/908f6614ea8cfffe06ed82b6dfe7f1ae979f79ab))


### Reverts

* **studio:** stop reporting Trusted Types violations nobody can act on ([6bab956](https://github.com/jxsuite/jx/commit/6bab956c0142b9bd1935a4d6da70f96fc01e8ccd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.35.0
    * @jxsuite/collab bumped to 0.7.0
    * @jxsuite/create bumped to 1.3.0
    * @jxsuite/formulas bumped to 0.0.7
    * @jxsuite/markup bumped to 0.4.3
    * @jxsuite/protocol bumped to 1.1.0
    * @jxsuite/runtime bumped to 2.0.0
    * @jxsuite/schema bumped to 1.6.0

## [2.0.1](https://github.com/jxsuite/jx/compare/studio-v2.0.0...studio-v2.0.1) (2026-07-31)


### Bug Fixes

* **studio:** offer Cloudflare AI enablement wherever credentials are gated ([f419b84](https://github.com/jxsuite/jx/commit/f419b84250510ce386a52217f100e6027a21a37c))
* **studio:** offer Cloudflare AI enablement wherever credentials are gated ([41fd8f5](https://github.com/jxsuite/jx/commit/41fd8f5ff039e2fdb61fc0aa7f3644b08d7bf298))

## [2.0.0](https://github.com/jxsuite/jx/compare/studio-v1.5.0...studio-v2.0.0) (2026-07-30)


### ⚠ BREAKING CHANGES

* **studio:** `StudioPlatform` implementations must declare `createDestination` and honor `createProject`'s `destination`. `POST /__studio/create-project` rejects a request without one, and returns an absolute `root` for projects created outside the server root.

### Features

* **schema:** make per-project schema composition host-agnostic ([70e4580](https://github.com/jxsuite/jx/commit/70e4580f6f49d254cfd431585ae577ee9f111a67))
* **schema:** make per-project schema composition host-agnostic ([32d5cbd](https://github.com/jxsuite/jx/commit/32d5cbd05c7c6a303ae454d3c11057aa1e74a123))
* **studio:** a preview link opens the real page in a real browser tab ([aec02e9](https://github.com/jxsuite/jx/commit/aec02e974698ce016bae42c7c65a3eca129986d2))
* **studio:** commit while typing, without moving the caret ([fe89ea5](https://github.com/jxsuite/jx/commit/fe89ea55f066f10546866356a6a003a47743c6a7))
* **studio:** derive the caret's editable tags from the document ([e45e2a0](https://github.com/jxsuite/jx/commit/e45e2a0e358121ba4cc080b481e49653632517cb))
* **studio:** edit across block boundaries ([d6af3ee](https://github.com/jxsuite/jx/commit/d6af3ee0133a872eecd2445f9f9028b5c730eedb))
* **studio:** give the canvas a document-wide caret ([cd362f1](https://github.com/jxsuite/jx/commit/cd362f13cd874cd3ffeeb96b0848da57b0b38a75))
* **studio:** join blocks at their boundaries ([461518b](https://github.com/jxsuite/jx/commit/461518bf0c30598c8621a8fe621edf0cd4160e1b))
* **studio:** let the repo picker widen GitHub App repository access ([735cff8](https://github.com/jxsuite/jx/commit/735cff8610344399ac6e39be55d56fbc8c195c28))
* **studio:** require a user-chosen destination for new projects ([0046d68](https://github.com/jxsuite/jx/commit/0046d68c4268489fadef9c9f37f414889fd88f4f))
* **studio:** upload and drop media from every editing surface ([3a58962](https://github.com/jxsuite/jx/commit/3a58962bf5225b31ec2476cba7c91f9d6a6231eb))


### Bug Fixes

* **desktop,studio,server,collab:** typecheck the desktop package, and hold the coverage gates ([f1e40e5](https://github.com/jxsuite/jx/commit/f1e40e5c813d4f7ec508859faddb4faef76e2c03))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **server:** let Studio open a project it does not already contain ([4b69a74](https://github.com/jxsuite/jx/commit/4b69a7434b184c28c4ec3787bdbb4a6909222102))
* **studio,server,desktop:** dev server bypassed the build; Monaco still loaded at startup ([0b98da6](https://github.com/jxsuite/jx/commit/0b98da64aa34e49d2c18276359f50c119706f9c1))
* **studio:** clickable insertion helper target ([9200406](https://github.com/jxsuite/jx/commit/9200406f9573ea7f206db474afcce826a022e687))
* **studio:** keep an anchor's URL when its block is edited ([1dc1b99](https://github.com/jxsuite/jx/commit/1dc1b99efe7765306a57d1e6c7664fc94e5451a3))
* **studio:** keep the Data panel's Refresh able to fetch, and stop happy-dom loading canvas iframes ([8d73c00](https://github.com/jxsuite/jx/commit/8d73c0005e8671ae693363a225bf47ad07d379a5))
* **studio:** keep the welcome screen up until a project is opened ([47246d6](https://github.com/jxsuite/jx/commit/47246d6755414e83c804b6d2ab111f98a4bef45a))
* **studio:** keep undo and the collab mirror usable at typing cadence ([27a1434](https://github.com/jxsuite/jx/commit/27a1434943cec07137ddbbbaa1908aedd80d9a36))
* **studio:** preview content-relative media at its mounted URL ([2ad537f](https://github.com/jxsuite/jx/commit/2ad537f4ded4cd05b48e19537f920deb7e0dc5bc))
* **studio:** register cloud platform inside studio.js for single-yjs collab ([4ce0327](https://github.com/jxsuite/jx/commit/4ce0327b65446d7d3f86f761cad4d6bbe7389c85))
* **studio:** register cloud platform inside studio.js for single-yjs collab ([8eca5c2](https://github.com/jxsuite/jx/commit/8eca5c21103ea83ab098b81bdf9c3baab1ea31a2))
* **studio:** register cloud platform inside studio.js for single-yjs collab ([62a80ca](https://github.com/jxsuite/jx/commit/62a80cae6a612fbe19c34e7838336471e8cc5618))
* **studio:** replace native prompts with a Spectrum prompt dialog ([229178e](https://github.com/jxsuite/jx/commit/229178e30452da0ac830cac847787c5d72f31d05))
* **studio:** replace native prompts with a Spectrum prompt dialog ([d8a97e6](https://github.com/jxsuite/jx/commit/d8a97e6c338301b920f12c3628adf9e8d16f2827))
* **studio:** resolve project schemas offline and ship Monaco's workers everywhere ([367cefa](https://github.com/jxsuite/jx/commit/367cefa437f79ebd36623341833209d684f81ae4))
* **studio:** stop the idle commit cancelling IME compositions; label the editable region ([2d89a1f](https://github.com/jxsuite/jx/commit/2d89a1f32a826246da319d6b7debcca8aa80fb16))
* **studio:** undo a typing run that changed the block's shape ([69046a7](https://github.com/jxsuite/jx/commit/69046a75cbda77ce12c0c2ca04d5bcfda61fc850))


### Performance Improvements

* **studio,runtime:** stop refetching on every canvas render, narrow the splice escalation ([e1bc3c1](https://github.com/jxsuite/jx/commit/e1bc3c141fac22d269823558db379e1d09dbacc4))
* **studio:** build layer-row actions for the selected row, flatten the tree without spreads ([c98044f](https://github.com/jxsuite/jx/commit/c98044f6d93cf00a356e34709835252e616ddee9))
* **studio:** coalesce canvas pointermove into a frame, drop the double-rAF ([c5a17ea](https://github.com/jxsuite/jx/commit/c5a17ea806f3bc5358afbbd100bffb43c13ab813))
* **studio:** code-split the bundle and load Monaco on demand ([369e702](https://github.com/jxsuite/jx/commit/369e70287a5a32cbe3f6ef922ee0f647d48d755e))
* **studio:** instrument the render hot path, de-duplicate Monaco, stop shipping stale dist ([adda7dc](https://github.com/jxsuite/jx/commit/adda7dcf778763f9f75c984484964449af309c02))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.6.0
    * @jxsuite/create bumped to 1.2.2
    * @jxsuite/formulas bumped to 0.0.6
    * @jxsuite/markup bumped to 0.4.2
    * @jxsuite/protocol bumped to 1.0.0
    * @jxsuite/runtime bumped to 1.3.2
    * @jxsuite/schema bumped to 1.5.0

## [1.5.0](https://github.com/jxsuite/jx/compare/studio-v1.4.0...studio-v1.5.0) (2026-07-24)


### Features

* **studio:** Open Project repo picker + ship the editor shell in the npm package ([a59811b](https://github.com/jxsuite/jx/commit/a59811b0d64e689cd4768fc2e0b7ade4a4606522))


### Bug Fixes

* **studio:** make New Project errors visible; add example entry point ([6b1a043](https://github.com/jxsuite/jx/commit/6b1a043826a8c2884b5ff9b8acbb0c1f72d3ba08))
* **studio:** show validation errors in convert dialogs ([fcdbffc](https://github.com/jxsuite/jx/commit/fcdbffc9b398a8a829b866d21554cbbaf08c0e24))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.5.1
    * @jxsuite/create bumped to 1.2.1
    * @jxsuite/formulas bumped to 0.0.5
    * @jxsuite/markup bumped to 0.4.1
    * @jxsuite/protocol bumped to 0.6.1
    * @jxsuite/runtime bumped to 1.3.1
    * @jxsuite/schema bumped to 1.4.0

## [1.4.0](https://github.com/jxsuite/jx/compare/studio-v1.3.0...studio-v1.4.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.34.0
    * @jxsuite/collab bumped to 0.5.0
    * @jxsuite/create bumped to 1.2.0
    * @jxsuite/formulas bumped to 0.0.4
    * @jxsuite/markup bumped to 0.4.0
    * @jxsuite/protocol bumped to 0.6.0
    * @jxsuite/runtime bumped to 1.3.0
    * @jxsuite/schema bumped to 1.3.0

## [1.3.0](https://github.com/jxsuite/jx/compare/studio-v1.2.0...studio-v1.3.0) (2026-07-20)


### Features

* **screenshots,studio:** staged captures for AI, data, publish, and collab docs ([24207c2](https://github.com/jxsuite/jx/commit/24207c25db41288319b4375e14b3ee10c18fa5a5))
* **screenshots,studio:** tranche-2 interaction captures + runner and palette fixes ([bafff5e](https://github.com/jxsuite/jx/commit/bafff5e1f013e2376e80335c9b0932ecae3d403b))


### Bug Fixes

* **studio:** add !project guard to cloud PAL adapter's subscribeFileEvents ([8e0726f](https://github.com/jxsuite/jx/commit/8e0726f5ab68b051ed033294a59998676b7a38f8))

## [1.2.0](https://github.com/jxsuite/jx/compare/studio-v1.1.0...studio-v1.2.0) (2026-07-18)


### Features

* **studio:** color-scheme canvas preview — Auto/Light/Dark tab-bar control ([0c61f90](https://github.com/jxsuite/jx/commit/0c61f90266885f203113e48b3cee07b314a7fbb9))
* **studio:** color-scheme canvas preview — Auto/Light/Dark tab-bar control ([d637631](https://github.com/jxsuite/jx/commit/d6376318d94db6b6902589d50b866f39a2cdc0f7))
* **studio:** scheme-variant editing — token overrides, scheme-layer routing, live feedback ([6aad3cf](https://github.com/jxsuite/jx/commit/6aad3cfeba702204c20b1e3f04b7358562f3a32c))


### Bug Fixes

* **tests:** tsc errors — typed children access in highlight tests, colorScheme in stylebook message ([e8c3dc1](https://github.com/jxsuite/jx/commit/e8c3dc156f4ab894db2c24b9682256319bac3a72))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.4.1
    * @jxsuite/create bumped to 1.1.1
    * @jxsuite/formulas bumped to 0.0.3
    * @jxsuite/markup bumped to 0.3.1
    * @jxsuite/protocol bumped to 0.5.1
    * @jxsuite/runtime bumped to 1.2.0
    * @jxsuite/schema bumped to 1.2.0

## [1.1.0](https://github.com/jxsuite/jx/compare/studio-v1.0.0...studio-v1.1.0) (2026-07-17)


### Features

* **formulas:** packaging, docs, and studio copy-in consumption ([0db9c34](https://github.com/jxsuite/jx/commit/0db9c343bd256655ea29f1b56bb0a00ffd039d44))
* **runtime,schema,formulas:** pure method operators and the composite formula catalog (spec §19.4d) ([39303e6](https://github.com/jxsuite/jx/commit/39303e6004cdeecce27dd77ee6e3c3faf34e4bc3))
* **runtime,schema,studio:** blessed Intl helpers and object-literal expression operands ([cb1c018](https://github.com/jxsuite/jx/commit/cb1c018585869c7a456c22dad602afe724fb4f11))
* **schema,runtime,studio:** structured function bodies and the statement editor (spec §20) ([e418fbb](https://github.com/jxsuite/jx/commit/e418fbb10cd858f7800f3d3fc42a99f2db24296f))
* **studio:** collection grids with rich cells — bulk frontmatter editing ([eb87187](https://github.com/jxsuite/jx/commit/eb87187d37f29233b532f53ac81d4ed908d2fc47))
* **studio:** consolidated field mode switcher ([c309cb2](https://github.com/jxsuite/jx/commit/c309cb2f09b2cc9ed93b5454e5482919f71e7e95))
* **studio:** dedicated zoom level on editor mode ([5a380bd](https://github.com/jxsuite/jx/commit/5a380bdecbc3e0fc1615bd78782f6cea11c9ff9a))
* **studio:** dynamic-slot control and live expression value badges ([b005d22](https://github.com/jxsuite/jx/commit/b005d22a1cc092295de490df2f27af64dbe37575))
* **studio:** formula catalog, search palette, chip pipeline, fx everywhere ([0c6a301](https://github.com/jxsuite/jx/commit/0c6a301e798a7a88b8a86e16eef6265dfd1007ac))
* **studio:** full-screen formula workspace ([a3f2f6e](https://github.com/jxsuite/jx/commit/a3f2f6eb68365630ae14d6047b0322da08d9df76))
* **studio:** grid polish — find & replace, column layout persistence ([d847ed3](https://github.com/jxsuite/jx/commit/d847ed3f83031a165ea5b928f046b67e1e9c661f))
* **studio:** inline editing of component property bound text ([91b8c87](https://github.com/jxsuite/jx/commit/91b8c873f89bbc4143287f3a70c2d29fbd1d29a2))
* **studio:** live-context expression previews and component test props ([715072c](https://github.com/jxsuite/jx/commit/715072c63098d9e1516dacb5036c0a2b86337f4d))
* **studio:** pages + connector grid tabs; the modal data grid retires ([3deed25](https://github.com/jxsuite/jx/commit/3deed25ca465c08636c78e07c9d21c630a88180d))
* **studio:** persistent ai sidebar + project bootstrap capabilities ([2e956a8](https://github.com/jxsuite/jx/commit/2e956a82905143184b70428cf80fe6ba42ae35cf))
* **studio:** properties panel for content type frontmatter/metadata ([b52edc4](https://github.com/jxsuite/jx/commit/b52edc47d698ed7ee26ab31e4cd884f71e749fb0))
* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))
* **studio:** wheel-scrollable tab strip + active-tab reveal ([9e5694f](https://github.com/jxsuite/jx/commit/9e5694f9795218d75a49918384a8904dc04cb32d))


### Bug Fixes

* **studio,compiler,parser,protocol,auth:** keep the promises the docs audit surfaced ([86740a9](https://github.com/jxsuite/jx/commit/86740a9364079016dd411682bc67ac75bc39e89a))
* **studio:** component registry regression ([b3b550d](https://github.com/jxsuite/jx/commit/b3b550d8c5a906cdb4e6f411b97c73c4c89d6f9b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.4.0
    * @jxsuite/create bumped to 1.1.0
    * @jxsuite/formulas bumped to 0.0.2
    * @jxsuite/markup bumped to 0.3.0
    * @jxsuite/protocol bumped to 0.5.0
    * @jxsuite/runtime bumped to 1.1.0
    * @jxsuite/schema bumped to 1.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/studio-v0.37.1...studio-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- hosts switch to the extension model; migrate all projects to content sections

### Features

- **auth:** Better Auth extension — sessions, permissions, auth-gated data ([32c871e](https://github.com/jxsuite/jx/commit/32c871e9fe48fdeed62e030354cc05adbf6efd19))
- **connector:** dynamic data tables extension — Kysely core, /_jx/data mount, db push ([65e0d35](https://github.com/jxsuite/jx/commit/65e0d35bf99924b2cd7aa548d02e29e8441ba6ed))
- hosts switch to the extension model; migrate all projects to content sections ([b2c0e27](https://github.com/jxsuite/jx/commit/b2c0e27c08e649af334fdf67ccf6abbb73c480dc))
- **markup:** shared markup-conversion core package; sever studio/import from parser ([41141a1](https://github.com/jxsuite/jx/commit/41141a15ba51aa6f58ba1dee78731f15893eaff8))
- **studio:** add/open existing repositories from the welcome screen ([1857642](https://github.com/jxsuite/jx/commit/18576421369944062d6831d65f3d1a4cad0257d8))
- **studio:** data console — connections, schema push, secrets, data grid ([de02861](https://github.com/jxsuite/jx/commit/de02861a03c94460f0d332ac909438decbd4fd9d))
- **studio:** descriptor-contributed settings + fetched project schemas ([b85afaf](https://github.com/jxsuite/jx/commit/b85afaf9f6d340e1d916ad399fc758df36ced2e1))
- **studio:** instant CF connect handshake + Connect-Cloudflare option in the AI gate ([2a183ea](https://github.com/jxsuite/jx/commit/2a183ea08355bba3bab19595fafab83f74887653))
- **studio:** prompt for GitHub App installation from the project UI ([2915d98](https://github.com/jxsuite/jx/commit/2915d983e6f3b92f899ce79357b75f6d9fd1e070))
- **studio:** reusable schema-form engine, context resolver, settings registry ([e488e84](https://github.com/jxsuite/jx/commit/e488e845db3739dc062b84d643a8c2938921f50e))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/collab bumped to 0.3.0
    - @jxsuite/create bumped to 1.0.0
    - @jxsuite/markup bumped to 0.2.0
    - @jxsuite/protocol bumped to 0.4.0
    - @jxsuite/runtime bumped to 1.0.0
    - @jxsuite/schema bumped to 1.0.0

## [0.37.1](https://github.com/jxsuite/jx/compare/studio-v0.37.0...studio-v0.37.1) (2026-07-08)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/collab bumped to 0.2.1
    - @jxsuite/protocol bumped to 0.3.1

## [0.37.0](https://github.com/jxsuite/jx/compare/studio-v0.36.0...studio-v0.37.0) (2026-07-08)

### Features

- **collab:** @jxsuite/collab — Y.Doc schema, op bridge, differ, wire envelope ([9389419](https://github.com/jxsuite/jx/commit/93894198d039dbb7656b611ab02842e415940fcb))
- **collab:** the wire — ws client/room core, devserver endpoint, adapter members ([dc53b5d](https://github.com/jxsuite/jx/commit/dc53b5dcf24069ca6bc30051e330c8ccdcda0fe6))
- **studio:** adopt y-monaco for source co-editing ([e54bd21](https://github.com/jxsuite/jx/commit/e54bd21a845541e3a318526be488ebd0e63e9e9b))
- **studio:** collab seams in the transact pipeline ([300a16b](https://github.com/jxsuite/jx/commit/300a16bbc550cd47b8803f9163609b1f954afcaf))
- **studio:** CollabSession — realtime co-editing behind platform.collab ([c07b788](https://github.com/jxsuite/jx/commit/c07b78845dcc017cdfebf13481d0c7cabf6a5a71))
- **studio:** presence UX — chips, remote selection overlays, sync status ([2fcb9be](https://github.com/jxsuite/jx/commit/2fcb9be7dfc12324292e51d02a8d53ee6b3e358e))
- **studio:** source-mode co-editing under the canonical lock ([ff4ff55](https://github.com/jxsuite/jx/commit/ff4ff5505c033bfc55e3ff8a7841896eca918252))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/collab bumped to 0.2.0
    - @jxsuite/protocol bumped to 0.3.0

## [0.36.0](https://github.com/jxsuite/jx/compare/studio-v0.35.0...studio-v0.36.0) (2026-07-07)

### Features

- **protocol:** @jxsuite/protocol — the Studio Backend Protocol package ([1c836b2](https://github.com/jxsuite/jx/commit/1c836b257aeffc9aad142b66c3d806daddf44f6f))
- **studio:** AI managed mode — unlock the assistant from proxy state ([077cd1d](https://github.com/jxsuite/jx/commit/077cd1d63e3bd048b6520c2f3a897e0408198e9d))
- **studio:** cloud platform adapter — @jxsuite/studio/platforms/cloud ([eb468a6](https://github.com/jxsuite/jx/commit/eb468a6172526782705de5b54a4e30c1b420356f))
- **studio:** one-click Cloudflare Pages publish surface ([9eebc15](https://github.com/jxsuite/jx/commit/9eebc154a0d77a0f347d0efd47bed3b9a643e89c))
- **studio:** platform project catalogue on the welcome screen ([f508aa2](https://github.com/jxsuite/jx/commit/f508aa2175cd0bed5f05152f3d626905b69b3998))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/create bumped to 0.36.0
    - @jxsuite/parser bumped to 0.35.1
    - @jxsuite/protocol bumped to 0.2.0
    - @jxsuite/runtime bumped to 0.34.2
    - @jxsuite/schema bumped to 0.35.0

## [0.35.0](https://github.com/jxsuite/jx/compare/studio-v0.34.0...studio-v0.35.0) (2026-07-06)

### Features

- automated screenshot framework ([2cb35a7](https://github.com/jxsuite/jx/commit/2cb35a765b4f88c5ea2da29016e800a063d87ecd))
- **desktop:** persistent cross-platform user settings ([348f704](https://github.com/jxsuite/jx/commit/348f704452570c898cc26f865088b88b5bb75649))
- site import package, ui + starter templates & wizard ([700e432](https://github.com/jxsuite/jx/commit/700e432faeb6c30ef2b1859b0a12fa00457ff508))
- **starters:** init starter sites ([be19be6](https://github.com/jxsuite/jx/commit/be19be613e365ad26e804f99ecce95032d2419fc))
- **studio:** agentic ai history switcher, modern UI/UX ([ee60066](https://github.com/jxsuite/jx/commit/ee6006649568f1ea5a2cebb0c1bfe5a4e8ac8044))
- **studio:** auto-sync and package conflict resolution ([876a5fb](https://github.com/jxsuite/jx/commit/876a5fbf630aeebcabb7b4d0915629c6ab9da544))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/parser bumped to 0.35.0
    - @jxsuite/runtime bumped to 0.34.1
