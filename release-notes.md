:robot: I have created a release *beep* *boop*
---


<details><summary>ai: 0.44.0</summary>

## [0.44.0](https://github.com/jxsuite/jx/compare/ai-v0.43.7...ai-v0.44.0) (2026-11-15)


### Features

* **ai:** a conversation too long for Claude is summarized, not cut ([36175f8](https://github.com/jxsuite/jx/commit/36175f8937566a7585a5e688d9b47acfaf2ec559))
* **ai:** a persisted conversation behind one session store contract ([231c085](https://github.com/jxsuite/jx/commit/231c085deaf8631ded3b148db4ea9a279912216c))
* **ai:** a suspended turn resumes from a checkpoint ([b8f774e](https://github.com/jxsuite/jx/commit/b8f774ec0a22988d64943dd09dfc159da6d0268e))
* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** give a turn room to work, and a closing round to reply ([#545](https://github.com/jxsuite/jx/issues/545)) ([59b1c95](https://github.com/jxsuite/jx/commit/59b1c95ed2d7999c2b46d6b70aa78ff47387b826))
* **ai:** interactions and approvals run before the tool body ([#502](https://github.com/jxsuite/jx/issues/502)) ([0b14ea4](https://github.com/jxsuite/jx/commit/0b14ea4ea8df16a1c34b7437328d69866b0abd8d))
* **ai:** native Anthropic Messages with signed thinking replayed where it binds ([9e64acf](https://github.com/jxsuite/jx/commit/9e64acf22c03952e3a31295aa0276fc89a801b53))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))
* **ai:** portable file tools over a ProjectHost, and schema-checked arguments ([80f1b33](https://github.com/jxsuite/jx/commit/80f1b336f97ebb761009eddf9e3d2b83ee95c3ef))
* **ai:** prompt-cache hints, keyed per chat session ([50e119c](https://github.com/jxsuite/jx/commit/50e119c841fe7929c9e15da7923e987e47cbbcf4))
* **ai:** prompt-cache hints, keyed per chat session ([9f2ac83](https://github.com/jxsuite/jx/commit/9f2ac83a265b48caceb78b2f3d4a6555c728c374))
* **ai:** support anthropic messages api ([#526](https://github.com/jxsuite/jx/issues/526)) ([d6eefc3](https://github.com/jxsuite/jx/commit/d6eefc364a7e2097f08336c54298f5d8d85fb3d6))
* **ai:** the assistant's tools are one catalog in @jxsuite/ai/catalog ([#499](https://github.com/jxsuite/jx/issues/499)) ([a63f9bb](https://github.com/jxsuite/jx/commit/a63f9bb8228e7ba28e0737106a5fb4c61d58f092))
* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **ai:** the tree tools are portable producers in @jxsuite/ai/jx-tools ([#493](https://github.com/jxsuite/jx/issues/493)) ([40e7c27](https://github.com/jxsuite/jx/commit/40e7c27a1abedab5a22f20ade9d1e1e03297e984))
* **studio:** per-actor batch lanes replace the global undo batch ([#489](https://github.com/jxsuite/jx/issues/489)) ([32b1f25](https://github.com/jxsuite/jx/commit/32b1f2589e5981171c85db1319d477f6304060d2))
* **studio:** the assistant asks before a call undo cannot take back ([6edb36a](https://github.com/jxsuite/jx/commit/6edb36aa7c88a45d35c4dcd41777f43a6b4a60aa))


### Bug Fixes

* **ai:** repair tool-call pairs per request, in @jxsuite/ai/messages ([ac8a809](https://github.com/jxsuite/jx/commit/ac8a80973a8d146bef596a8a2015808177505a14))
* **ai:** repair tool-call pairs per request, in @jxsuite/ai/messages ([518d4a8](https://github.com/jxsuite/jx/commit/518d4a8b09930d487af0e390e2b2704b9f76cdec))
* **ai:** run streamed tool calls on any finish but not after Stop, and forward usage ([2dfb312](https://github.com/jxsuite/jx/commit/2dfb312a7190c978c11447b4aad063096da24467))
* Jx harness phase 0  gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([f9fba4f](https://github.com/jxsuite/jx/commit/f9fba4f991d09a7b28026baa68c7c20a16394655))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([c73b161](https://github.com/jxsuite/jx/commit/c73b1616f09e0031df5bddf67aa00f1e6c435ddc))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([4ba9e30](https://github.com/jxsuite/jx/commit/4ba9e30967849112892d4af3744f8231d3b54a95))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([5936082](https://github.com/jxsuite/jx/commit/5936082f9519f486814e78a1d96ce4e2eb6bbdc1))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([311d58b](https://github.com/jxsuite/jx/commit/311d58b7547e3bc3a45243733e7c76879aaf5134))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([f6bda72](https://github.com/jxsuite/jx/commit/f6bda72f9af177fe74913dce644127c28e834ad9))
* **studio:** one turn per window, and Stop stays on offer for all of it ([e426bd3](https://github.com/jxsuite/jx/commit/e426bd3a72ab81a9eaa5a24e5434a02e37f4e930))
* **studio:** one turn per window, and Stop stays on offer for all of it ([104f296](https://github.com/jxsuite/jx/commit/104f2963547d03dde1fe8ca676a148b8dae9df4c))
* **studio:** Stop is armed before the send path's first wait ([b0144cc](https://github.com/jxsuite/jx/commit/b0144cc20011a5c5bc777671adfbd90505c9c205))
* **studio:** Stop is armed before the send path's first wait ([be3d363](https://github.com/jxsuite/jx/commit/be3d36325c065218b2e155b7141c67543c842b12))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>auth: 0.8.12</summary>

## [0.8.12](https://github.com/jxsuite/jx/compare/auth-v0.8.11...auth-v0.8.12) (2026-11-15)


### Bug Fixes

* **security:** generic 500s, sign-out cache clearing, consistent framing, hashed speculation rules ([#624](https://github.com/jxsuite/jx/issues/624)) ([0048a69](https://github.com/jxsuite/jx/commit/0048a69ffd81b2e1adae1f0d6c88288c80623b5c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/connector bumped to 0.8.12
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>catalog: 0.1.16</summary>

## [0.1.16](https://github.com/jxsuite/jx/compare/catalog-v0.1.15...catalog-v0.1.16) (2026-11-15)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 7.0.0
</details>

<details><summary>collab: 0.13.0</summary>

## [0.13.0](https://github.com/jxsuite/jx/compare/collab-v0.12.2...collab-v0.13.0) (2026-11-15)


### Features

* backend-directed access: action-required refusals, offered actions, platform account rows ([8b8f2df](https://github.com/jxsuite/jx/commit/8b8f2dfcde78178921188e3f68da8010a831bb03))
* offer a hosted platform's plan when it refuses with subscription-required ([f4c860d](https://github.com/jxsuite/jx/commit/f4c860dccf31f502afb1db64f83e92869cb2b675))
* replace the hosted-plan client with backend-directed access ([8add52b](https://github.com/jxsuite/jx/commit/8add52b18e4a5d728a0f3db220503939804f1727))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema:** document ops and the JSON serializer as portable @jxsuite/schema subpaths (harness J1.1) ([5d88928](https://github.com/jxsuite/jx/commit/5d88928460938bb626e5314b6cbd29e1d9311913))
* **schema:** the document-op vocabulary and its inverse, as @jxsuite/schema/doc-ops ([5a686cf](https://github.com/jxsuite/jx/commit/5a686cfce193596284bd5eebf3dc37e3056adb6f))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([88eb919](https://github.com/jxsuite/jx/commit/88eb919810d7ab7fc1c8f479769e0f1fa6e2fe0c))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([de3512b](https://github.com/jxsuite/jx/commit/de3512bea3ec36871b24dd63d64885d90c9d5b07))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>compiler: 10.0.0</summary>

## [10.0.0](https://github.com/jxsuite/jx/compare/compiler-v9.1.0...compiler-v10.0.0) (2026-11-15)


###   BREAKING CHANGES

* **runtime,compiler:** el.derivedKey = value throws a TypeError in strict code (and Reflect.set answers false) where it was silently ignored. A compiled parent's property binding to a key its child derives throws when the bound value changes; such a prop was never applied.
* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built component with no display in its base style block is now display: block, as in Studio. Write "display": "revert-layer" (or the value wanted) in the base block to opt out.
* **compiler:** a built page now carries a component definition's root attributes on each instance's host, over an attribute of the same name the page wrote, and a compiled element writes them when it connects and binds its definition's root-level event handlers.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** a compiled component module now renders its images with the project's loading attributes and optimized candidates, and the interpreter writes title="", lang="" or dir="" for a property set to the empty string where it wrote no attribute.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.
* **compiler:** built output changes for every site with live components. Their prerender now holds list rows, initial values and the selected $switch case; a component containing a $switch or a chosen tag ships its module where it was stamped static; a static component that a live one renders ships its module on every page that uses it; and a dynamic page prerenders the initial value of a binding a handler writes. buildInitialScope no longer marks handler-written entries runtime-only unless asked to with holdMutable.
* **compiler:** the default image formats are avif and jpeg instead of webp and avif, WebP output is lossless, sharp is no longer a dependency, and variant file names change. A project that lists webp should list avif and jpeg instead.
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))
* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.
* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* **compiler:** a build compiles every component a document declares, wherever it lives ([#616](https://github.com/jxsuite/jx/issues/616)) ([ae26149](https://github.com/jxsuite/jx/commit/ae26149538631b0bfef7dd6ef83659759d90c65e))
* **compiler:** a compiled element binds its root handlers and writes its root attributes ([741476b](https://github.com/jxsuite/jx/commit/741476b88ed25f9477eabc6a15d0ffe16f7984b1))
* **compiler:** a compiled element runs every lifecycle hook and observes its declared attributes ([867b61c](https://github.com/jxsuite/jx/commit/867b61cd703d443d781840100980baef77b3dec0))
* **compiler:** a compiled element takes every prop its instance supplies, at connection and after ([e0a66d7](https://github.com/jxsuite/jx/commit/e0a66d75b1bc9afcd4fabb619bc73c952daf4e94))
* **compiler:** a site build runs every external class a page or component names ([6971a9f](https://github.com/jxsuite/jx/commit/6971a9f4a18d859d56d8edac7cd0b3942f6996d9))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** a static build comments each style rule with its $description ([82d9381](https://github.com/jxsuite/jx/commit/82d93815e8faaf3e0704af978268d2ae6849a990))
* **compiler:** a template text child is baked at build time or bound on a dynamic page ([ca9de1d](https://github.com/jxsuite/jx/commit/ca9de1d298e64262cd81053bab045ae6691385f9))
* **compiler:** advertise each page's Markdown twin with a link rel=alternate ([#435](https://github.com/jxsuite/jx/issues/435)) ([0f4b89b](https://github.com/jxsuite/jx/commit/0f4b89be8819bd9b00dc7ea51a4e29c3224492de))
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))
* **compiler:** compileElementPack compiles a component library into a distributable pack ([a5ed13d](https://github.com/jxsuite/jx/commit/a5ed13d4afa091c83b859da99ee7e79d8f6463ce)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** images are encoded by the compiler's own Rust core ([8e929a7](https://github.com/jxsuite/jx/commit/8e929a7520b95fc661e55f64c5b6f7ce3fd333e4))
* **compiler:** one build can leave images alone, and a Pages preview does ([544adbe](https://github.com/jxsuite/jx/commit/544adbe8f56eb3d7af34a4bfe2e0188cc5f46297))
* **compiler:** the image pipeline is stated once, and its cache, formats and Markdown images match ([9e1d1e8](https://github.com/jxsuite/jx/commit/9e1d1e8acc9f6f90091fcfdab8013d97f64f8665))
* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,compiler:** a derived state key is a read-only property of its element ([0c21f4b](https://github.com/jxsuite/jx/commit/0c21f4bbe43021085dd86c6f9a78bc55c28cf1a0))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,compiler:** $lazy loads on first call in every tier ([#617](https://github.com/jxsuite/jx/issues/617)) ([3392082](https://github.com/jxsuite/jx/commit/33920822a65b8f186306af4f05eb8f3452932da0))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **server,compiler:** jx format formats the code a .jxn file holds, as Studio does ([#637](https://github.com/jxsuite/jx/issues/637)) ([46c388b](https://github.com/jxsuite/jx/commit/46c388bcb2726bade8fe5627a8f8b86c03f32f94))
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **site:** site state stops making every built page dynamic, and never replaces $site's own names ([#619](https://github.com/jxsuite/jx/issues/619)) ([3cdcae4](https://github.com/jxsuite/jx/commit/3cdcae4cba94cd639defaa157b1299a9f6a287b7))
* **studio,compiler:** a picture's focal point lives in the picture ([#591](https://github.com/jxsuite/jx/issues/591)) ([d87ce76](https://github.com/jxsuite/jx/commit/d87ce76d12805d0d5b217629a37f4639a16def49))
* **ui:** the published kit carries an optional compiled distribution ([d65af9f](https://github.com/jxsuite/jx/commit/d65af9f15ef6f630295114d3b33aabf0b3fe6514)), closes [#304](https://github.com/jxsuite/jx/issues/304)


### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **compiler:** a compiled component stylesheet carries the display: block default ([ca40b9e](https://github.com/jxsuite/jx/commit/ca40b9ef6ae16abd9db79fc6e98ce2586df32da8))
* **compiler:** a compiled element moved in the DOM keeps what it drew ([#620](https://github.com/jxsuite/jx/issues/620)) ([532065f](https://github.com/jxsuite/jx/commit/532065f36ca0f629eb0add3e4bb089a3d1719b30))
* **compiler:** a component module draws its URLs under the deployment base path ([7414e48](https://github.com/jxsuite/jx/commit/7414e486cbd034848cb8d659ebfcf7594df0eb63)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **compiler:** a component's images and empty-string properties prerender as its module draws them ([2094579](https://github.com/jxsuite/jx/commit/209457955411e5bc45dc16cc0ee3011b26d3cd4e))
* **compiler:** a derived sizes takes the narrower of an element's literal width and max-width ([a5a5f70](https://github.com/jxsuite/jx/commit/a5a5f70e84657f137173ba0c42a721e3dfb1b25c))
* **compiler:** a dollar sign in a head entry or an image attribute reaches the page as written ([946224d](https://github.com/jxsuite/jx/commit/946224d013ad597da8ae7411bae585ce32189a93))
* **compiler:** a live component prerenders its initial state ([24e7968](https://github.com/jxsuite/jx/commit/24e796863b76d0297d6a8e70b142d6f2a1236552)), closes [#285](https://github.com/jxsuite/jx/issues/285)
* **compiler:** a shadow element links its own stylesheet into a root it attaches ([9cee908](https://github.com/jxsuite/jx/commit/9cee9080bdb901e165a684660d46a5875aee9503)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **compiler:** a static component a live one renders stays static on a page that uses it alone ([1d88c98](https://github.com/jxsuite/jx/commit/1d88c987c5114c9a637ff20de84fc567ce74731b)), closes [#285](https://github.com/jxsuite/jx/issues/285)
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* **compiler:** canonical and sitemap URLs follow trailingSlash; write the 404 page to 404.html ([#433](https://github.com/jxsuite/jx/issues/433)) ([f467fa2](https://github.com/jxsuite/jx/commit/f467fa293b88ad9a78e701f7eaa12cbe7e37d5e0))
* **compiler:** declare the import map in head ahead of the modulepreload hints ([0433318](https://github.com/jxsuite/jx/commit/0433318a328c557d74972f58973c87b95ccf7cb6))
* **compiler:** declare the import map in head ahead of the modulepreload hints ([88ca901](https://github.com/jxsuite/jx/commit/88ca9018bfbc311186227a29e62a93751c928e1f))
* **compiler:** encode image variant URLs, and key the image cache on the file name ([#566](https://github.com/jxsuite/jx/issues/566)) ([17fbe13](https://github.com/jxsuite/jx/commit/17fbe13b40a0bf09ae05274a519fd49315d871ea))
* **compiler:** escape spliced HTML with one helper instead of a replacer per call site ([910c829](https://github.com/jxsuite/jx/commit/910c8292cec14d9d1c8cd988558aea4aff2e958c))
* **compiler:** every class module route 0 writes loads, and compiler.md §5 matches it ([7a4456b](https://github.com/jxsuite/jx/commit/7a4456bc427e4760b1c56cfffba335f4d3a8ac61))
* **compiler:** every styled element gets a generated class of its own as its style handle ([3c19450](https://github.com/jxsuite/jx/commit/3c19450096f9d884580fd536a0ee5ed23c3b9aec))
* **compiler:** leave the two unreachable html-tag branches as they were ([8fb9ab3](https://github.com/jxsuite/jx/commit/8fb9ab3b938756b96f8177b9fde58f974599c509))
* **compiler:** load extension implementations under Node, so jx build runs without bun ([#432](https://github.com/jxsuite/jx/issues/432)) ([c223ad9](https://github.com/jxsuite/jx/commit/c223ad95f9b54ce0b0da3cc79d494c0fe6d9fdb0))
* **compiler:** re-root the $src import URLs of component and page modules on the base path ([#454](https://github.com/jxsuite/jx/issues/454)) ([9ec4815](https://github.com/jxsuite/jx/commit/9ec481525d63e283982d138b08d11cbb530557a9))
* **compiler:** write no Markdown twin for the not-found page ([#438](https://github.com/jxsuite/jx/issues/438)) ([26a4657](https://github.com/jxsuite/jx/commit/26a4657c06a859cbafd4ee038343eb1a98fd8a28))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* keep CI green on the dependency bumps ([97000ad](https://github.com/jxsuite/jx/commit/97000adb60a24f7ff073df267a4c8d76900bbf04))
* **runtime:** an & after a context in a nested style key is the scope ([#497](https://github.com/jxsuite/jx/issues/497)) ([c1e6119](https://github.com/jxsuite/jx/commit/c1e6119bf27bdc70b5df0177145773f196ad07e2))
* **security:** generic 500s, sign-out cache clearing, consistent framing, hashed speculation rules ([#624](https://github.com/jxsuite/jx/issues/624)) ([0048a69](https://github.com/jxsuite/jx/commit/0048a69ffd81b2e1adae1f0d6c88288c80623b5c))
* **server:** the site worker refuses cross-site calls and its answers stay out of caches ([#621](https://github.com/jxsuite/jx/issues/621)) ([0a6ba0d](https://github.com/jxsuite/jx/commit/0a6ba0dd614c3f0d26b43ba37547d785398ec3c6))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))
* the release PR's smoke test installs this checkout, and npm can no longer hang a build ([#515](https://github.com/jxsuite/jx/issues/515)) ([66208f7](https://github.com/jxsuite/jx/commit/66208f7e27eab9535537d1de63a8bb8e897a04d8))


### Performance Improvements

* **runtime,compiler:** an element connects and a static page compiles at the trunk's cost ([c77a310](https://github.com/jxsuite/jx/commit/c77a310ac79fdb4eb38d8eb56ce980a3f8c3bbe3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler-binding bumped to 0.4.0
    * @jxsuite/create bumped to 1.9.0
    * @jxsuite/erase bumped to 0.4.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/site bumped to 3.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.8.12
    * @jxsuite/parser bumped to 6.0.0
</details>

<details><summary>compiler-binding: 0.4.0</summary>

## [0.4.0](https://github.com/jxsuite/jx/compare/compiler-binding-v0.3.0...compiler-binding-v0.4.0) (2026-11-15)


###   BREAKING CHANGES

* **compiler:** the default image formats are avif and jpeg instead of webp and avif, WebP output is lossless, sharp is no longer a dependency, and variant file names change. A project that lists webp should list avif and jpeg instead.

### Features

* **compiler:** images are encoded by the compiler's own Rust core ([8e929a7](https://github.com/jxsuite/jx/commit/8e929a7520b95fc661e55f64c5b6f7ce3fd333e4))
* **compiler:** the image pipeline is stated once, and its cache, formats and Markdown images match ([9e1d1e8](https://github.com/jxsuite/jx/commit/9e1d1e8acc9f6f90091fcfdab8013d97f64f8665))


### Bug Fixes

* **compiler-binding:** the loader finds a checkout's addon from the compiler's CLI bundle ([c0dcf74](https://github.com/jxsuite/jx/commit/c0dcf744f58697ac962bcef73cb836ef046190ea))
* **compiler-binding:** the musl and Windows arm64 addons build, and a pull request proves all eight ([b6c36ae](https://github.com/jxsuite/jx/commit/b6c36ae6544accc3044449a05ce3ee4b1d954109))
</details>

<details><summary>connector: 0.8.12</summary>

## [0.8.12](https://github.com/jxsuite/jx/compare/connector-v0.8.11...connector-v0.8.12) (2026-11-15)


### Bug Fixes

* **security:** generic 500s, sign-out cache clearing, consistent framing, hashed speculation rules ([#624](https://github.com/jxsuite/jx/issues/624)) ([0048a69](https://github.com/jxsuite/jx/commit/0048a69ffd81b2e1adae1f0d6c88288c80623b5c))
* **server:** the site worker refuses cross-site calls and its answers stay out of caches ([#621](https://github.com/jxsuite/jx/issues/621)) ([0a6ba0d](https://github.com/jxsuite/jx/commit/0a6ba0dd614c3f0d26b43ba37547d785398ec3c6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>content-mapper: 0.2.0</summary>

## [0.2.0](https://github.com/jxsuite/jx/compare/content-mapper-v0.1.2...content-mapper-v0.2.0) (2026-11-15)


### Features

* **content-mapper,schema:** tsc and a language server check the code in a .jxn document ([#629](https://github.com/jxsuite/jx/issues/629)) ([9efac0a](https://github.com/jxsuite/jx/commit/9efac0a72297f677af688f120ef6caa586dc35a4))
* **schema,content-mapper,studio:** a body's event and its mapped row are typed by where it stands ([#630](https://github.com/jxsuite/jx/issues/630)) ([fdf059f](https://github.com/jxsuite/jx/commit/fdf059f977788e72c9d7ba32060f22be9496481b))
* **schema,content-mapper:** a parameter that declares a type is checked as that type ([#636](https://github.com/jxsuite/jx/issues/636)) ([754a6ea](https://github.com/jxsuite/jx/commit/754a6ea21272cea0dc05c90be0b5c64f21469f53))
* **schema,content-mapper:** a typed entry and a document's $defs are checked as types ([#633](https://github.com/jxsuite/jx/issues/633)) ([63cf576](https://github.com/jxsuite/jx/commit/63cf5765f561915e8696a3ef970d2f45705759fe))
* **schema,content-mapper:** tsc checks a .jxn document's templates and its references into state ([#631](https://github.com/jxsuite/jx/issues/631)) ([c82dda8](https://github.com/jxsuite/jx/commit/c82dda858ebc49eb48d1410262c34102d1db5fe3))
* **schema,content-mapper:** tsc checks the props a .jxn document gives a component ([#632](https://github.com/jxsuite/jx/issues/632)) ([e7834a1](https://github.com/jxsuite/jx/commit/e7834a132bf1f24bcbce25f285d1d25a45883631))
* **vscode:** a VS Code extension highlights, completes and type checks a .jxn file ([#646](https://github.com/jxsuite/jx/issues/646)) ([2a34cb9](https://github.com/jxsuite/jx/commit/2a34cb94e7c227d5e762ab475a5b78c29ed791ef))


### Bug Fixes

* **schema,content-mapper,studio:** the state a project gives a document is seen by every reader ([#635](https://github.com/jxsuite/jx/issues/635)) ([c506085](https://github.com/jxsuite/jx/commit/c506085f0397155c3e9e5e9fed62d9ca98e5c87b))
* **schema,content-mapper:** a rename reaches an (export) entry and a scope that redeclares a name ([#634](https://github.com/jxsuite/jx/issues/634)) ([444d1c6](https://github.com/jxsuite/jx/commit/444d1c67d202a3f72d0c7de492504bd6d425c926))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>create: 1.9.0</summary>

## [1.9.0](https://github.com/jxsuite/jx/compare/create-v1.8.3...create-v1.9.0) (2026-11-15)


### Features

* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/starters bumped to 4.0.0
</details>

<details><summary>desktop: 10.0.0</summary>

## [10.0.0](https://github.com/jxsuite/jx/compare/desktop-v9.3.0...desktop-v10.0.0) (2026-11-15)


###   BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))
* **desktop:** declare .jxn on every channel that can register a file type ([#570](https://github.com/jxsuite/jx/issues/570)) ([2b19f27](https://github.com/jxsuite/jx/commit/2b19f278c90857d4684c407a102a756f54468665))
* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))
* **desktop:** open what the OS hands over, after asking to run a folder's code ([#549](https://github.com/jxsuite/jx/issues/549)) ([7aa3f08](https://github.com/jxsuite/jx/commit/7aa3f08a14b663886949d9dea2ff9227832bcae6))
* **desktop:** publish Jx Studio to the Snap Store, and ship a 66% smaller Nix package ([e607f31](https://github.com/jxsuite/jx/commit/e607f31b58da211f85e30c1f93a578859bb605e0))
* **desktop:** publish Jx Studio to the Snap Store, and ship a 66% smaller Nix package ([6b2c8ad](https://github.com/jxsuite/jx/commit/6b2c8ade4fd030117c8682fb433e3fdcd0872b8b))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* **desktop:** submit the Mac App Store build to App Review from CI ([4239514](https://github.com/jxsuite/jx/commit/42395147cdcf382769576bb65cb3d680c39730b4))
* **desktop:** the compiler's native addon is staged beside the backend bundle ([d895662](https://github.com/jxsuite/jx/commit/d89566238364be7d69357068eddd5d4602a218ee))
* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([88eb919](https://github.com/jxsuite/jx/commit/88eb919810d7ab7fc1c8f479769e0f1fa6e2fe0c))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([de3512b](https://github.com/jxsuite/jx/commit/de3512bea3ec36871b24dd63d64885d90c9d5b07))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))


### Bug Fixes

* **ci:** publish to the Microsoft Store the official way, and unblock the snap review ([9db85c4](https://github.com/jxsuite/jx/commit/9db85c4221abb5123cf8f924e568e4257d8e7ded))
* **ci:** publish to the Microsoft Store the official way, and unblock the snap review ([e2b27e6](https://github.com/jxsuite/jx/commit/e2b27e638766d3a6241518c5fde90004b943cab4))
* desktop backend paths, right-click menus, and the Media tile menu ([#513](https://github.com/jxsuite/jx/issues/513)) ([80dac1b](https://github.com/jxsuite/jx/commit/80dac1b38b2aaecf954ca0033bc170629022973d))
* **desktop,server:** keep git paths and commits inside a nested project ([#540](https://github.com/jxsuite/jx/issues/540)) ([5a11efc](https://github.com/jxsuite/jx/commit/5a11efcf7772dc71a82a3c2974418a170dc9876e))
* **desktop,studio:** 5.x desktop windows booted without their backend; fail loud and report Browse errors ([3f50ec9](https://github.com/jxsuite/jx/commit/3f50ec92d68ee010aedeb35955c1ff673362fac1))
* **desktop:** add sharp's RPATH with patchelfUnstable so the Nix build loads it ([#656](https://github.com/jxsuite/jx/issues/656)) ([8992d82](https://github.com/jxsuite/jx/commit/8992d82d88a31fb0e13b1fe6f170455d91080a4d))
* **desktop:** build init.js from the vendored Electrobun SDK in every release lane ([6fc779b](https://github.com/jxsuite/jx/commit/6fc779be16ac93e64b59f6191eec95f26cabd094))
* **desktop:** externalize the Astro compiler the oxfmt bump made a static import ([#458](https://github.com/jxsuite/jx/issues/458)) ([5f891ed](https://github.com/jxsuite/jx/commit/5f891ed1e776caf9f19cc18d7ec4b3ac1f0d8470))
* **desktop:** gate the shared AI proxy with the per-process service token ([e565e9e](https://github.com/jxsuite/jx/commit/e565e9ea2c7fddb68442aa21b29a4d4884ef1338))
* **desktop:** keep the Nix build's Electron bundle flat so jx-studio starts ([#508](https://github.com/jxsuite/jx/issues/508)) ([91094c1](https://github.com/jxsuite/jx/commit/91094c1c453b8ab1670b90a34afa88001cc8a5be))
* **desktop:** promise the Linux x64 AppImage under the name electron-builder gives it ([#512](https://github.com/jxsuite/jx/issues/512)) ([5b6b47d](https://github.com/jxsuite/jx/commit/5b6b47dd3bb3ba4d4d855f31e8c6a790fe7fac4e))
* **desktop:** sandboxed Mac App Store build opens the folders the user picks ([#481](https://github.com/jxsuite/jx/issues/481)) ([8a52af8](https://github.com/jxsuite/jx/commit/8a52af8369010e30ec8bcaeb8a8503ad401d2e41))
* **desktop:** ship the backend's node_modules, and smoke-test the packaged app honestly ([#506](https://github.com/jxsuite/jx/issues/506)) ([9118317](https://github.com/jxsuite/jx/commit/91183172999983fb8d5e663432dc15da6ca5394d))
* **desktop:** stop loading a second copy of Lit in the same window ([85e9d72](https://github.com/jxsuite/jx/commit/85e9d7242889893ace30171970435e8a9296a5d6))
* **desktop:** stop loading a second copy of Lit in the same window ([3891648](https://github.com/jxsuite/jx/commit/3891648a30130f159c8db73a0955e96c2b1d9c43))
* **desktop:** stop taking over .json on install ([#547](https://github.com/jxsuite/jx/issues/547)) ([5addb19](https://github.com/jxsuite/jx/commit/5addb19cefb6acd9308b3ca7b482521d84baba2a))
* **desktop:** the launcher's handlers mock needs the member the launcher imports ([c2279e1](https://github.com/jxsuite/jx/commit/c2279e19befbaea7aad80f57c3c2706949e8b1b7))
* **desktop:** the Store MSIX launched nothing - patched launcher called an undefined __require ([cff91b4](https://github.com/jxsuite/jx/commit/cff91b4276fc8f75c14062b3185e47e510195773))
* **desktop:** the Store MSIX launched nothing - patched launcher called an undefined __require ([6c0e78b](https://github.com/jxsuite/jx/commit/6c0e78b2cbf04faaa91f7407d11cfae260bcc423))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* Jx harness phase 0  gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* normalize Bun.Glob paths to forward slashes on Windows ([d89903a](https://github.com/jxsuite/jx/commit/d89903ac9ab807d48373d8b5dc2489dbf560cd41))
* **studio,desktop:** Browse reports why it could not choose a folder ([2e1a1cc](https://github.com/jxsuite/jx/commit/2e1a1cc7aa2e03b125afeeef29ea7ae6609cd310))
* **studio,desktop:** refuse the dev-server fallback when a launcher failed to start ([521803b](https://github.com/jxsuite/jx/commit/521803b2863cc6fdaa3612e54a4fa5572aa1e8b3))
* the release PR's smoke test installs this checkout, and npm can no longer hang a build ([#515](https://github.com/jxsuite/jx/issues/515)) ([66208f7](https://github.com/jxsuite/jx/commit/66208f7e27eab9535537d1de63a8bb8e897a04d8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 10.0.0
    * @jxsuite/create bumped to 1.9.0
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/server bumped to 10.0.0
    * @jxsuite/starters bumped to 4.0.0
    * @jxsuite/studio bumped to 12.0.0
  * devDependencies
    * @jxsuite/server bumped to 10.0.0
    * @jxsuite/ui bumped to 0.13.0
</details>

<details><summary>erase: 0.4.0</summary>

## [0.4.0](https://github.com/jxsuite/jx/compare/erase-v0.3.2...erase-v0.4.0) (2026-11-15)


### Features

* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>feed: 0.6.0</summary>

## [0.6.0](https://github.com/jxsuite/jx/compare/feed-v0.5.9...feed-v0.6.0) (2026-11-15)


###   BREAKING CHANGES

* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* **studio:** Project Settings is a workspace, not a dialog ([#528](https://github.com/jxsuite/jx/issues/528)) ([e8ca05d](https://github.com/jxsuite/jx/commit/e8ca05d55619c56d3779a975d135c835872af196))


### Bug Fixes

* **compiler:** load extension implementations under Node, so jx build runs without bun ([#432](https://github.com/jxsuite/jx/issues/432)) ([c223ad9](https://github.com/jxsuite/jx/commit/c223ad95f9b54ce0b0da3cc79d494c0fe6d9fdb0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>formulas: 0.0.36</summary>

## [0.0.36](https://github.com/jxsuite/jx/compare/formulas-v0.0.35...formulas-v0.0.36) (2026-11-15)


### Features

* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
  * devDependencies
    * @jxsuite/runtime bumped to 8.0.0
</details>

<details><summary>import: 0.45.0</summary>

## [0.45.0](https://github.com/jxsuite/jx/compare/import-v0.44.5...import-v0.45.0) (2026-11-15)


### Features

* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/markup bumped to 2.0.0
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/schema bumped to 7.0.0
  * optionalDependencies
    * @jxsuite/compiler bumped to 10.0.0
</details>

<details><summary>markup: 2.0.0</summary>

## [2.0.0](https://github.com/jxsuite/jx/compare/markup-v1.0.11...markup-v2.0.0) (2026-11-15)


###   BREAKING CHANGES

* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>parser: 6.0.0</summary>

## [6.0.0](https://github.com/jxsuite/jx/compare/parser-v5.0.2...parser-v6.0.0) (2026-11-15)


###   BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.
* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))


### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* keep CI green on the dependency bumps ([97000ad](https://github.com/jxsuite/jx/commit/97000adb60a24f7ff073df267a4c8d76900bbf04))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/markup bumped to 2.0.0
    * @jxsuite/schema bumped to 7.0.0
  * devDependencies
    * @jxsuite/runtime bumped to 8.0.0
</details>

<details><summary>protocol: 7.0.0</summary>

## [7.0.0](https://github.com/jxsuite/jx/compare/protocol-v6.4.2...protocol-v7.0.0) (2026-11-15)


###   BREAKING CHANGES

* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501))
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.
* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.

### Features

* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))
* **ai:** support anthropic messages api ([#526](https://github.com/jxsuite/jx/issues/526)) ([d6eefc3](https://github.com/jxsuite/jx/commit/d6eefc364a7e2097f08336c54298f5d8d85fb3d6))
* backend-directed access: action-required refusals, offered actions, platform account rows ([8b8f2df](https://github.com/jxsuite/jx/commit/8b8f2dfcde78178921188e3f68da8010a831bb03))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* offer a hosted platform's plan when it refuses with subscription-required ([f4c860d](https://github.com/jxsuite/jx/commit/f4c860dccf31f502afb1db64f83e92869cb2b675))
* Open in Browser runs a component or a layout on its own ([#644](https://github.com/jxsuite/jx/issues/644)) ([dd6e18d](https://github.com/jxsuite/jx/commit/dd6e18df227e1c78cd0f8e296051b201fd808854))
* replace the hosted-plan client with backend-directed access ([8add52b](https://github.com/jxsuite/jx/commit/8add52b18e4a5d728a0f3db220503939804f1727))
* **studio:** address repo-space media by content version, so unchanged images repaint from cache ([74c7fd5](https://github.com/jxsuite/jx/commit/74c7fd53c9abcde63963717571a460a74506e24c))
* **studio:** coalesce the cloud adapter's file reads into one batch request ([a38389a](https://github.com/jxsuite/jx/commit/a38389aaec445c005c943ee212dc73bc12b8447d))
* **studio:** coalesce the cloud adapter's file reads into one batch request ([e0fa49e](https://github.com/jxsuite/jx/commit/e0fa49eef4effc10f7178918ba322f5ed8f9ead9))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([88eb919](https://github.com/jxsuite/jx/commit/88eb919810d7ab7fc1c8f479769e0f1fa6e2fe0c))
* **studio:** publish to a new branch when a hosted branch moved under your edits ([#522](https://github.com/jxsuite/jx/issues/522)) ([8941481](https://github.com/jxsuite/jx/commit/894148177a3199db7a1dbd20c225a09a2250ea3f))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))


### Bug Fixes

* **desktop,server:** keep git paths and commits inside a nested project ([#540](https://github.com/jxsuite/jx/issues/540)) ([5a11efc](https://github.com/jxsuite/jx/commit/5a11efcf7772dc71a82a3c2974418a170dc9876e))
* **desktop,studio:** 5.x desktop windows booted without their backend; fail loud and report Browse errors ([3f50ec9](https://github.com/jxsuite/jx/commit/3f50ec92d68ee010aedeb35955c1ff673362fac1))
* **desktop:** the launcher's handlers mock needs the member the launcher imports ([c2279e1](https://github.com/jxsuite/jx/commit/c2279e19befbaea7aad80f57c3c2706949e8b1b7))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* Jx harness phase 0  gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* **studio,desktop:** Browse reports why it could not choose a folder ([2e1a1cc](https://github.com/jxsuite/jx/commit/2e1a1cc7aa2e03b125afeeef29ea7ae6609cd310))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))
* **studio:** offer the account picker when Cloudflare names no account ([1337bc9](https://github.com/jxsuite/jx/commit/1337bc94b07d90c3ce481d1462cee4db197766f7))
* **studio:** show a failed model listing wherever the catalogue is offered ([1269cb8](https://github.com/jxsuite/jx/commit/1269cb8596ef842835d57f135ccfa4d53013e709))


### Code Refactoring

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501)) ([604b254](https://github.com/jxsuite/jx/commit/604b2540a667bf2ed5adbdadddf532b1e8dfaa9b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>runtime: 8.0.0</summary>

## [8.0.0](https://github.com/jxsuite/jx/compare/runtime-v7.1.0...runtime-v8.0.0) (2026-11-15)


###   BREAKING CHANGES

* **runtime,compiler:** el.derivedKey = value throws a TypeError in strict code (and Reflect.set answers false) where it was silently ignored. A compiled parent's property binding to a key its child derives throws when the bound value changes; such a prop was never applied.
* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** a compiled component module now renders its images with the project's loading attributes and optimized candidates, and the interpreter writes title="", lang="" or dir="" for a property set to the empty string where it wrote no attribute.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))
* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* **compiler:** a compiled element runs every lifecycle hook and observes its declared attributes ([867b61c](https://github.com/jxsuite/jx/commit/867b61cd703d443d781840100980baef77b3dec0))
* **compiler:** a compiled element takes every prop its instance supplies, at connection and after ([e0a66d7](https://github.com/jxsuite/jx/commit/e0a66d75b1bc9afcd4fabb619bc73c952daf4e94))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** a static build comments each style rule with its $description ([82d9381](https://github.com/jxsuite/jx/commit/82d93815e8faaf3e0704af978268d2ae6849a990))
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,compiler:** a derived state key is a read-only property of its element ([0c21f4b](https://github.com/jxsuite/jx/commit/0c21f4bbe43021085dd86c6f9a78bc55c28cf1a0))
* **runtime,studio:** a prop edit writes the prop into the live instance ([#645](https://github.com/jxsuite/jx/issues/645)) ([e037910](https://github.com/jxsuite/jx/commit/e0379102f9d67ef80815568d48bffa79732a9cbb))
* **runtime,studio:** hold template warnings for data in flight, and render-check pages as built ([#544](https://github.com/jxsuite/jx/issues/544)) ([6a47d72](https://github.com/jxsuite/jx/commit/6a47d72fde7e10100c8b4e01f51e82b0ee8d9b7f))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **runtime:** call a server-timed entry only through the host's proxy ([#445](https://github.com/jxsuite/jx/issues/445)) ([2305f8e](https://github.com/jxsuite/jx/commit/2305f8e32e88974fe7f8842641d08a62284b6759))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,compiler:** $lazy loads on first call in every tier ([#617](https://github.com/jxsuite/jx/issues/617)) ([3392082](https://github.com/jxsuite/jx/commit/33920822a65b8f186306af4f05eb8f3452932da0))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema,runtime,studio:** quote-aware template scan, and a commit keeps its binding ([#638](https://github.com/jxsuite/jx/issues/638)) ([5a1f8d8](https://github.com/jxsuite/jx/commit/5a1f8d878d3e6f824a254421174bdf656eba3b7a))
* **studio:** a repeater draws every row on the editing canvas, and any row is editable ([#648](https://github.com/jxsuite/jx/issues/648)) ([8a97e95](https://github.com/jxsuite/jx/commit/8a97e956921410f4b0477afa577202058b034546))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **studio:** the canvas fetches remote data once, marks what did not resolve, takes a state value ([#649](https://github.com/jxsuite/jx/issues/649)) ([ff1a103](https://github.com/jxsuite/jx/commit/ff1a10311206a2a8de803a64a78e4b4311327a67))


### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **compiler:** a component's images and empty-string properties prerender as its module draws them ([2094579](https://github.com/jxsuite/jx/commit/209457955411e5bc45dc16cc0ee3011b26d3cd4e))
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* **runtime:** an & after a context in a nested style key is the scope ([#497](https://github.com/jxsuite/jx/issues/497)) ([c1e6119](https://github.com/jxsuite/jx/commit/c1e6119bf27bdc70b5df0177145773f196ad07e2))
* **runtime:** let a write from a child scope reach the state it names ([#556](https://github.com/jxsuite/jx/issues/556)) ([e32df97](https://github.com/jxsuite/jx/commit/e32df970084e8a7f604a8fbf7934f8f234d2433a))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))


### Performance Improvements

* **runtime,compiler:** an element connects and a static page compiles at the trunk's cost ([c77a310](https://github.com/jxsuite/jx/commit/c77a310ac79fdb4eb38d8eb56ce980a3f8c3bbe3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
  * devDependencies
    * @jxsuite/erase bumped to 0.4.0
</details>

<details><summary>schema: 7.0.0</summary>

## [7.0.0](https://github.com/jxsuite/jx/compare/schema-v6.0.2...schema-v7.0.0) (2026-11-15)


###   BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.
* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **ai:** the tree tools are portable producers in @jxsuite/ai/jx-tools ([#493](https://github.com/jxsuite/jx/issues/493)) ([40e7c27](https://github.com/jxsuite/jx/commit/40e7c27a1abedab5a22f20ade9d1e1e03297e984))
* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **content-mapper,schema:** tsc and a language server check the code in a .jxn document ([#629](https://github.com/jxsuite/jx/issues/629)) ([9efac0a](https://github.com/jxsuite/jx/commit/9efac0a72297f677af688f120ef6caa586dc35a4))
* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **desktop:** declare .jxn on every channel that can register a file type ([#570](https://github.com/jxsuite/jx/issues/570)) ([2b19f27](https://github.com/jxsuite/jx/commit/2b19f278c90857d4684c407a102a756f54468665))
* **desktop:** open what the OS hands over, after asking to run a folder's code ([#549](https://github.com/jxsuite/jx/issues/549)) ([7aa3f08](https://github.com/jxsuite/jx/commit/7aa3f08a14b663886949d9dea2ff9227832bcae6))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* saving a .jxn file keeps what did not change ([#555](https://github.com/jxsuite/jx/issues/555)) ([af1197e](https://github.com/jxsuite/jx/commit/af1197e84162fd6376f1053ebebb114c2b3ae7f5))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,content-mapper,studio:** a body's event and its mapped row are typed by where it stands ([#630](https://github.com/jxsuite/jx/issues/630)) ([fdf059f](https://github.com/jxsuite/jx/commit/fdf059f977788e72c9d7ba32060f22be9496481b))
* **schema,content-mapper:** a parameter that declares a type is checked as that type ([#636](https://github.com/jxsuite/jx/issues/636)) ([754a6ea](https://github.com/jxsuite/jx/commit/754a6ea21272cea0dc05c90be0b5c64f21469f53))
* **schema,content-mapper:** a typed entry and a document's $defs are checked as types ([#633](https://github.com/jxsuite/jx/issues/633)) ([63cf576](https://github.com/jxsuite/jx/commit/63cf5765f561915e8696a3ef970d2f45705759fe))
* **schema,content-mapper:** tsc checks a .jxn document's templates and its references into state ([#631](https://github.com/jxsuite/jx/issues/631)) ([c82dda8](https://github.com/jxsuite/jx/commit/c82dda858ebc49eb48d1410262c34102d1db5fe3))
* **schema,content-mapper:** tsc checks the props a .jxn document gives a component ([#632](https://github.com/jxsuite/jx/issues/632)) ([e7834a1](https://github.com/jxsuite/jx/commit/e7834a132bf1f24bcbce25f285d1d25a45883631))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema,runtime,studio:** quote-aware template scan, and a commit keeps its binding ([#638](https://github.com/jxsuite/jx/issues/638)) ([5a1f8d8](https://github.com/jxsuite/jx/commit/5a1f8d878d3e6f824a254421174bdf656eba3b7a))
* **schema,studio:** a component setting with an enum is a select ([#606](https://github.com/jxsuite/jx/issues/606)) ([88c9a2f](https://github.com/jxsuite/jx/commit/88c9a2f47647332a9e1f90e88407d7714f1ffbdc))
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **schema,studio:** report type errors in a function body ([#603](https://github.com/jxsuite/jx/issues/603)) ([9fb47c5](https://github.com/jxsuite/jx/commit/9fb47c53d8c86c63b4fb5d6dcdc3608d09f76607))
* **schema,studio:** the Code view completes a .jxn file from its schemas ([#643](https://github.com/jxsuite/jx/issues/643)) ([38e28e3](https://github.com/jxsuite/jx/commit/38e28e32bf7c9856a77ed059f59fe6af148d39f6))
* **schema:** document ops and the JSON serializer as portable @jxsuite/schema subpaths (harness J1.1) ([5d88928](https://github.com/jxsuite/jx/commit/5d88928460938bb626e5314b6cbd29e1d9311913))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **schema:** read and write Jx Notation ([#553](https://github.com/jxsuite/jx/issues/553)) ([e033c82](https://github.com/jxsuite/jx/commit/e033c8221b915c0775794108c69949132feab047))
* **schema:** the document-op vocabulary and its inverse, as @jxsuite/schema/doc-ops ([5a686cf](https://github.com/jxsuite/jx/commit/5a686cfce193596284bd5eebf3dc37e3056adb6f))
* **schema:** the layout-preserving JSON serializer, as @jxsuite/schema/json-layout ([2e221fe](https://github.com/jxsuite/jx/commit/2e221fe9115e19c458dfe7622c680e149c54acd3))
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **studio,schema:** the Code view of a .jxn file marks type errors in the whole file ([#639](https://github.com/jxsuite/jx/issues/639)) ([506ec44](https://github.com/jxsuite/jx/commit/506ec445bf6583e5bfada9a6506e21c775cb8d90))
* **studio:** a dynamic tag opens a popover to pick its source, format and fallback ([#650](https://github.com/jxsuite/jx/issues/650)) ([918a6b5](https://github.com/jxsuite/jx/commit/918a6b5e53a62262b0eeaa3b147dc3a930bae260))
* **studio:** document tools refuse corrupting or no-op edits ([#492](https://github.com/jxsuite/jx/issues/492)) ([7134466](https://github.com/jxsuite/jx/commit/7134466b21d23ba1e8ab79d63890474d84f74e24))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **vscode:** a VS Code extension highlights, completes and type checks a .jxn file ([#646](https://github.com/jxsuite/jx/issues/646)) ([2a34cb9](https://github.com/jxsuite/jx/commit/2a34cb94e7c227d5e762ab475a5b78c29ed791ef))


### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* keep CI green on the dependency bumps ([97000ad](https://github.com/jxsuite/jx/commit/97000adb60a24f7ff073df267a4c8d76900bbf04))
* **schema,content-mapper,studio:** the state a project gives a document is seen by every reader ([#635](https://github.com/jxsuite/jx/issues/635)) ([c506085](https://github.com/jxsuite/jx/commit/c506085f0397155c3e9e5e9fed62d9ca98e5c87b))
* **schema,content-mapper:** a rename reaches an (export) entry and a scope that redeclares a name ([#634](https://github.com/jxsuite/jx/issues/634)) ([444d1c6](https://github.com/jxsuite/jx/commit/444d1c67d202a3f72d0c7de492504bd6d425c926))
* **schema:** make which answer what Bun.which answers on Windows ([#511](https://github.com/jxsuite/jx/issues/511)) ([a3eaa1b](https://github.com/jxsuite/jx/commit/a3eaa1b420729077366b6d6d387255d7bb13ce01))
* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))
</details>

<details><summary>search: 0.7.0</summary>

## [0.7.0](https://github.com/jxsuite/jx/compare/search-v0.6.3...search-v0.7.0) (2026-11-15)


###   BREAKING CHANGES

* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **search:** a scope filter searches one part of a site from one index ([#518](https://github.com/jxsuite/jx/issues/518)) ([ab86b6f](https://github.com/jxsuite/jx/commit/ab86b6f1d74df5a0fcdda9eba3bc290face19493))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>server: 10.0.0</summary>

## [10.0.0](https://github.com/jxsuite/jx/compare/server-v9.0.3...server-v10.0.0) (2026-11-15)


###   BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **server:** document the runtime-neutral server and upgrading to 8.0 ([#505](https://github.com/jxsuite/jx/issues/505))
* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Features

* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))
* **ai:** prompt-cache hints, keyed per chat session ([50e119c](https://github.com/jxsuite/jx/commit/50e119c841fe7929c9e15da7923e987e47cbbcf4))
* **ai:** prompt-cache hints, keyed per chat session ([9f2ac83](https://github.com/jxsuite/jx/commit/9f2ac83a265b48caceb78b2f3d4a6555c728c374))
* **ai:** support anthropic messages api ([#526](https://github.com/jxsuite/jx/issues/526)) ([d6eefc3](https://github.com/jxsuite/jx/commit/d6eefc364a7e2097f08336c54298f5d8d85fb3d6))
* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))
* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **desktop:** publish Jx Studio to the Snap Store, and ship a 66% smaller Nix package ([e607f31](https://github.com/jxsuite/jx/commit/e607f31b58da211f85e30c1f93a578859bb605e0))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* Open in Browser runs a component or a layout on its own ([#644](https://github.com/jxsuite/jx/issues/644)) ([dd6e18d](https://github.com/jxsuite/jx/commit/dd6e18df227e1c78cd0f8e296051b201fd808854))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **runtime:** call a server-timed entry only through the host's proxy ([#445](https://github.com/jxsuite/jx/issues/445)) ([2305f8e](https://github.com/jxsuite/jx/commit/2305f8e32e88974fe7f8842641d08a62284b6759))
* saving a .jxn file keeps what did not change ([#555](https://github.com/jxsuite/jx/issues/555)) ([af1197e](https://github.com/jxsuite/jx/commit/af1197e84162fd6376f1053ebebb114c2b3ae7f5))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **server,compiler:** jx format formats the code a .jxn file holds, as Studio does ([#637](https://github.com/jxsuite/jx/issues/637)) ([46c388b](https://github.com/jxsuite/jx/commit/46c388bcb2726bade8fe5627a8f8b86c03f32f94))
* **studio:** open, find, save and convert .jxn documents, solo and shared ([#567](https://github.com/jxsuite/jx/issues/567)) ([2be9af7](https://github.com/jxsuite/jx/commit/2be9af7ea7e5ab645a8e3d39c03bbfd4ea6566c2))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **studio:** rename and duplicate a media file from the Media workspace ([#533](https://github.com/jxsuite/jx/issues/533)) ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))


### Bug Fixes

* **ai:** run streamed tool calls on any finish but not after Stop, and forward usage ([2dfb312](https://github.com/jxsuite/jx/commit/2dfb312a7190c978c11447b4aad063096da24467))
* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* desktop backend paths, right-click menus, and the Media tile menu ([#513](https://github.com/jxsuite/jx/issues/513)) ([80dac1b](https://github.com/jxsuite/jx/commit/80dac1b38b2aaecf954ca0033bc170629022973d))
* **desktop,server:** keep git paths and commits inside a nested project ([#540](https://github.com/jxsuite/jx/issues/540)) ([5a11efc](https://github.com/jxsuite/jx/commit/5a11efcf7772dc71a82a3c2974418a170dc9876e))
* **desktop:** gate the shared AI proxy with the per-process service token ([e565e9e](https://github.com/jxsuite/jx/commit/e565e9ea2c7fddb68442aa21b29a4d4884ef1338))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* Jx harness phase 0  gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* **server:** a rename drops the usage cache before it answers, so the new name's ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))
* **server:** declare oxfmt, which the code services import ([e91bf5c](https://github.com/jxsuite/jx/commit/e91bf5cd05a775032e3244b0f4d54563f551d435))
* **server:** judge the provider base URL by range, and follow no redirect ([8c4964e](https://github.com/jxsuite/jx/commit/8c4964e0b333d2d45e72d5ad537d540cd57f1887))
* **server:** resolve a relative class from the base Studio's canvas sends ([#543](https://github.com/jxsuite/jx/issues/543)) ([cc47155](https://github.com/jxsuite/jx/commit/cc471559777afcda7d689544e3789dbc0e8cf7ea))
* **server:** the site worker refuses cross-site calls and its answers stay out of caches ([#621](https://github.com/jxsuite/jx/issues/621)) ([0a6ba0d](https://github.com/jxsuite/jx/commit/0a6ba0dd614c3f0d26b43ba37547d785398ec3c6))
* **studio:** Source Control, Document Header, button groups, and eight more chrome fixes ([b99443f](https://github.com/jxsuite/jx/commit/b99443fa3fbb930a5681d5ce030836b722a70475))
* **studio:** stop renames and moves overwriting files, and keep the Files panel live ([#534](https://github.com/jxsuite/jx/issues/534)) ([b29a7bd](https://github.com/jxsuite/jx/commit/b29a7bdb1b8eda6c4c6352d8bcc3059e5eaf9920))
* **studio:** the merge's collisions, and a skip that could not fire ([195e0bc](https://github.com/jxsuite/jx/commit/195e0bc5c168775140d1b772505cab03493de6d1))


### Documentation

* **server:** document the runtime-neutral server and upgrading to 8.0 ([#505](https://github.com/jxsuite/jx/issues/505)) ([fa3bba3](https://github.com/jxsuite/jx/commit/fa3bba3f234655bdd3cf0910af13a4c781560b58))


### Code Refactoring

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501)) ([604b254](https://github.com/jxsuite/jx/commit/604b2540a667bf2ed5adbdadddf532b1e8dfaa9b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.44.0
    * @jxsuite/catalog bumped to 0.1.16
    * @jxsuite/collab bumped to 0.13.0
    * @jxsuite/compiler bumped to 10.0.0
    * @jxsuite/create bumped to 1.9.0
    * @jxsuite/erase bumped to 0.4.0
    * @jxsuite/import bumped to 0.45.0
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/site bumped to 3.0.0
    * @jxsuite/starters bumped to 4.0.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.12
    * @jxsuite/connector bumped to 0.8.12
    * @jxsuite/parser bumped to 6.0.0
</details>

<details><summary>site: 3.0.0</summary>

## [3.0.0](https://github.com/jxsuite/jx/compare/site-v2.8.0...site-v3.0.0) (2026-11-15)


###   BREAKING CHANGES

* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.

### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* **compiler:** a static build comments each style rule with its $description ([82d9381](https://github.com/jxsuite/jx/commit/82d93815e8faaf3e0704af978268d2ae6849a990))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **site:** site state stops making every built page dynamic, and never replaces $site's own names ([#619](https://github.com/jxsuite/jx/issues/619)) ([3cdcae4](https://github.com/jxsuite/jx/commit/3cdcae4cba94cd639defaa157b1299a9f6a287b7))
* **studio,compiler:** a picture's focal point lives in the picture ([#591](https://github.com/jxsuite/jx/issues/591)) ([d87ce76](https://github.com/jxsuite/jx/commit/d87ce76d12805d0d5b217629a37f4639a16def49))
* **studio:** open, find, save and convert .jxn documents, solo and shared ([#567](https://github.com/jxsuite/jx/issues/567)) ([2be9af7](https://github.com/jxsuite/jx/commit/2be9af7ea7e5ab645a8e3d39c03bbfd4ea6566c2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>starters: 4.0.0</summary>

## [4.0.0](https://github.com/jxsuite/jx/compare/starters-v3.7.1...starters-v4.0.0) (2026-11-15)


###   BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.
* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,content-mapper:** tsc checks the props a .jxn document gives a component ([#632](https://github.com/jxsuite/jx/issues/632)) ([e7834a1](https://github.com/jxsuite/jx/commit/e7834a132bf1f24bcbce25f285d1d25a45883631))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **starters:** every starter asks for AVIF and JPEG images ([4aead95](https://github.com/jxsuite/jx/commit/4aead95a6c001e13c68cd1d3fbb86e732dfa6416))


### Bug Fixes

* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 7.0.0
  * devDependencies
    * @jxsuite/parser bumped to 6.0.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
</details>

<details><summary>studio: 12.0.0</summary>

## [12.0.0](https://github.com/jxsuite/jx/compare/studio-v11.1.0...studio-v12.0.0) (2026-11-15)


###   BREAKING CHANGES

* **runtime:** the interpreter (live preview, mount()) renders a component with $shadow, or under defaults.shadow, into a shadow root where it rendered light. In a built shadow component a key such as ":hover" or ".wide" is emitted as :host(:hover) and now applies, a color-scheme block follows the OS preference only, and a bare element key at the top level of a component style is a descendant rule where it was dropped.
* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **compiler:** built HTML now carries attributes the static emitter used to drop (href, src, alt, value, placeholder, type, checked, disabled, name, selected and every other reflected property), a title, lang or dir set to the empty string is written as an empty attribute, and an attributes entry now replaces a property that writes the same attribute (id included) where both were written before. A client page's repeater row binds contentEditable as a property instead of writing the contenteditable attribute. name is no longer in RESERVED_KEYS: on an element it is the DOM property, in every tier.
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501))
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.
* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.
* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* a project's pure formulas are callable in its components ([#642](https://github.com/jxsuite/jx/issues/642)) ([d1981bf](https://github.com/jxsuite/jx/commit/d1981bf4b7e44fe69c95c7b21aaeb02818b42d70))
* **ai:** a conversation too long for Claude is summarized, not cut ([36175f8](https://github.com/jxsuite/jx/commit/36175f8937566a7585a5e688d9b47acfaf2ec559))
* **ai:** a persisted conversation behind one session store contract ([231c085](https://github.com/jxsuite/jx/commit/231c085deaf8631ded3b148db4ea9a279912216c))
* **ai:** a suspended turn resumes from a checkpoint ([b8f774e](https://github.com/jxsuite/jx/commit/b8f774ec0a22988d64943dd09dfc159da6d0268e))
* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** give a turn room to work, and a closing round to reply ([#545](https://github.com/jxsuite/jx/issues/545)) ([59b1c95](https://github.com/jxsuite/jx/commit/59b1c95ed2d7999c2b46d6b70aa78ff47387b826))
* **ai:** interactions and approvals run before the tool body ([#502](https://github.com/jxsuite/jx/issues/502)) ([0b14ea4](https://github.com/jxsuite/jx/commit/0b14ea4ea8df16a1c34b7437328d69866b0abd8d))
* **ai:** native Anthropic Messages with signed thinking replayed where it binds ([9e64acf](https://github.com/jxsuite/jx/commit/9e64acf22c03952e3a31295aa0276fc89a801b53))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))
* **ai:** portable file tools over a ProjectHost, and schema-checked arguments ([80f1b33](https://github.com/jxsuite/jx/commit/80f1b336f97ebb761009eddf9e3d2b83ee95c3ef))
* **ai:** prompt-cache hints, keyed per chat session ([50e119c](https://github.com/jxsuite/jx/commit/50e119c841fe7929c9e15da7923e987e47cbbcf4))
* **ai:** prompt-cache hints, keyed per chat session ([9f2ac83](https://github.com/jxsuite/jx/commit/9f2ac83a265b48caceb78b2f3d4a6555c728c374))
* **ai:** support anthropic messages api ([#526](https://github.com/jxsuite/jx/issues/526)) ([d6eefc3](https://github.com/jxsuite/jx/commit/d6eefc364a7e2097f08336c54298f5d8d85fb3d6))
* **ai:** the assistant's tools are one catalog in @jxsuite/ai/catalog ([#499](https://github.com/jxsuite/jx/issues/499)) ([a63f9bb](https://github.com/jxsuite/jx/commit/a63f9bb8228e7ba28e0737106a5fb4c61d58f092))
* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **ai:** the tree tools are portable producers in @jxsuite/ai/jx-tools ([#493](https://github.com/jxsuite/jx/issues/493)) ([40e7c27](https://github.com/jxsuite/jx/commit/40e7c27a1abedab5a22f20ade9d1e1e03297e984))
* backend-directed access: action-required refusals, offered actions, platform account rows ([8b8f2df](https://github.com/jxsuite/jx/commit/8b8f2dfcde78178921188e3f68da8010a831bb03))
* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **compiler:** one build can leave images alone, and a Pages preview does ([544adbe](https://github.com/jxsuite/jx/commit/544adbe8f56eb3d7af34a4bfe2e0188cc5f46297))
* **content-mapper,schema:** tsc and a language server check the code in a .jxn document ([#629](https://github.com/jxsuite/jx/issues/629)) ([9efac0a](https://github.com/jxsuite/jx/commit/9efac0a72297f677af688f120ef6caa586dc35a4))
* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **desktop:** declare .jxn on every channel that can register a file type ([#570](https://github.com/jxsuite/jx/issues/570)) ([2b19f27](https://github.com/jxsuite/jx/commit/2b19f278c90857d4684c407a102a756f54468665))
* **desktop:** open what the OS hands over, after asking to run a folder's code ([#549](https://github.com/jxsuite/jx/issues/549)) ([7aa3f08](https://github.com/jxsuite/jx/commit/7aa3f08a14b663886949d9dea2ff9227832bcae6))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* new documents and the starters are Jx Notation ([#596](https://github.com/jxsuite/jx/issues/596)) ([eb2d2b5](https://github.com/jxsuite/jx/commit/eb2d2b5910939cc06b4ec07fb4a8d3fa943de2ca))
* offer a hosted platform's plan when it refuses with subscription-required ([f4c860d](https://github.com/jxsuite/jx/commit/f4c860dccf31f502afb1db64f83e92869cb2b675))
* Open in Browser runs a component or a layout on its own ([#644](https://github.com/jxsuite/jx/issues/644)) ([dd6e18d](https://github.com/jxsuite/jx/commit/dd6e18df227e1c78cd0f8e296051b201fd808854))
* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))
* replace the hosted-plan client with backend-directed access ([8add52b](https://github.com/jxsuite/jx/commit/8add52b18e4a5d728a0f3db220503939804f1727))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **runtime,studio:** a prop edit writes the prop into the live instance ([#645](https://github.com/jxsuite/jx/issues/645)) ([e037910](https://github.com/jxsuite/jx/commit/e0379102f9d67ef80815568d48bffa79732a9cbb))
* **runtime,studio:** hold template warnings for data in flight, and render-check pages as built ([#544](https://github.com/jxsuite/jx/issues/544)) ([6a47d72](https://github.com/jxsuite/jx/commit/6a47d72fde7e10100c8b4e01f51e82b0ee8d9b7f))
* **runtime:** $shadow means the same thing in the interpreter, the module and the prerender ([267dec9](https://github.com/jxsuite/jx/commit/267dec908784e3055c6d8bb64319bdea771892ad))
* saving a .jxn file keeps what did not change ([#555](https://github.com/jxsuite/jx/issues/555)) ([af1197e](https://github.com/jxsuite/jx/commit/af1197e84162fd6376f1053ebebb114c2b3ae7f5))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema,runtime,studio:** quote-aware template scan, and a commit keeps its binding ([#638](https://github.com/jxsuite/jx/issues/638)) ([5a1f8d8](https://github.com/jxsuite/jx/commit/5a1f8d878d3e6f824a254421174bdf656eba3b7a))
* **schema,studio:** a component setting with an enum is a select ([#606](https://github.com/jxsuite/jx/issues/606)) ([88c9a2f](https://github.com/jxsuite/jx/commit/88c9a2f47647332a9e1f90e88407d7714f1ffbdc))
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **schema,studio:** report type errors in a function body ([#603](https://github.com/jxsuite/jx/issues/603)) ([9fb47c5](https://github.com/jxsuite/jx/commit/9fb47c53d8c86c63b4fb5d6dcdc3608d09f76607))
* **schema,studio:** the Code view completes a .jxn file from its schemas ([#643](https://github.com/jxsuite/jx/issues/643)) ([38e28e3](https://github.com/jxsuite/jx/commit/38e28e32bf7c9856a77ed059f59fe6af148d39f6))
* **schema:** document ops and the JSON serializer as portable @jxsuite/schema subpaths (harness J1.1) ([5d88928](https://github.com/jxsuite/jx/commit/5d88928460938bb626e5314b6cbd29e1d9311913))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **schema:** the document-op vocabulary and its inverse, as @jxsuite/schema/doc-ops ([5a686cf](https://github.com/jxsuite/jx/commit/5a686cfce193596284bd5eebf3dc37e3056adb6f))
* **schema:** the layout-preserving JSON serializer, as @jxsuite/schema/json-layout ([2e221fe](https://github.com/jxsuite/jx/commit/2e221fe9115e19c458dfe7622c680e149c54acd3))
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **studio,compiler:** a picture's focal point lives in the picture ([#591](https://github.com/jxsuite/jx/issues/591)) ([d87ce76](https://github.com/jxsuite/jx/commit/d87ce76d12805d0d5b217629a37f4639a16def49))
* **studio,schema:** the Code view of a .jxn file marks type errors in the whole file ([#639](https://github.com/jxsuite/jx/issues/639)) ([506ec44](https://github.com/jxsuite/jx/commit/506ec445bf6583e5bfada9a6506e21c775cb8d90))
* **studio:** a dynamic tag opens a popover to pick its source, format and fallback ([#650](https://github.com/jxsuite/jx/issues/650)) ([918a6b5](https://github.com/jxsuite/jx/commit/918a6b5e53a62262b0eeaa3b147dc3a930bae260))
* **studio:** a picture's alt text and tags live in the picture ([#588](https://github.com/jxsuite/jx/issues/588)) ([79be4bf](https://github.com/jxsuite/jx/commit/79be4bf53d5daf0146e74d028c38e443067e4636))
* **studio:** a placed picture starts with its file's alt text ([#589](https://github.com/jxsuite/jx/issues/589)) ([6ac042a](https://github.com/jxsuite/jx/commit/6ac042a2e67853bb26ce6a51593b1d8fef6d0f19))
* **studio:** a repeater draws every row on the editing canvas, and any row is editable ([#648](https://github.com/jxsuite/jx/issues/648)) ([8a97e95](https://github.com/jxsuite/jx/commit/8a97e956921410f4b0477afa577202058b034546))
* **studio:** a Studio surface opens on the canvas as a realistic instance, drawn with its specimen ([31369f3](https://github.com/jxsuite/jx/commit/31369f3941cd8645df5dc0becb2e61e9117fceef)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **studio:** address repo-space media by content version, so unchanged images repaint from cache ([74c7fd5](https://github.com/jxsuite/jx/commit/74c7fd53c9abcde63963717571a460a74506e24c))
* **studio:** Applies to in Design's Style tab ([#584](https://github.com/jxsuite/jx/issues/584)) ([343aa08](https://github.com/jxsuite/jx/commit/343aa08b7dbf8626211050a83dbbb7cc571a7127))
* **studio:** bound text draws its value on the editing canvas, as a chip the caret cannot enter ([#647](https://github.com/jxsuite/jx/issues/647)) ([ecc06ad](https://github.com/jxsuite/jx/commit/ecc06adf5f9011777d9b8a1fca2862f068602f4f))
* **studio:** breadcrumb trail in the status bar ([ae24c2c](https://github.com/jxsuite/jx/commit/ae24c2ceb2212a3d21d0cc21963ef9e9d7fac742))
* **studio:** breadcrumb trail in the status bar ([95cf2e1](https://github.com/jxsuite/jx/commit/95cf2e17d1ab07cbcde7aec9b803550aa3db0524))
* **studio:** coalesce the cloud adapter's file reads into one batch request ([a38389a](https://github.com/jxsuite/jx/commit/a38389aaec445c005c943ee212dc73bc12b8447d))
* **studio:** coalesce the cloud adapter's file reads into one batch request ([e0fa49e](https://github.com/jxsuite/jx/commit/e0fa49eef4effc10f7178918ba322f5ed8f9ead9))
* **studio:** collapsable document panel ([2a5f2d4](https://github.com/jxsuite/jx/commit/2a5f2d4134f2d75ee9ae1a3c768a14d5ecf65327))
* **studio:** collapsable document panel ([2f93c66](https://github.com/jxsuite/jx/commit/2f93c660a720fdc43325119c6ad9425c748aba44))
* **studio:** Content Table: Cover column, row selection, and what each page is ([#585](https://github.com/jxsuite/jx/issues/585)) ([0ecf1d0](https://github.com/jxsuite/jx/commit/0ecf1d0fd5d270f13ee39dea1fe1e6ee5762225b))
* **studio:** design a collection's page with a real entry in it ([#574](https://github.com/jxsuite/jx/issues/574)) ([18fc53f](https://github.com/jxsuite/jx/commit/18fc53f2772fe75c47049a661a3a8ffffca36272))
* **studio:** document tools refuse corrupting or no-op edits ([#492](https://github.com/jxsuite/jx/issues/492)) ([7134466](https://github.com/jxsuite/jx/commit/7134466b21d23ba1e8ab79d63890474d84f74e24))
* **studio:** edit an image where it is opened ([#531](https://github.com/jxsuite/jx/issues/531)) ([0e2b90e](https://github.com/jxsuite/jx/commit/0e2b90e9a2deb20a542fc33803adbe31a20673ec))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([88eb919](https://github.com/jxsuite/jx/commit/88eb919810d7ab7fc1c8f479769e0f1fa6e2fe0c))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([de3512b](https://github.com/jxsuite/jx/commit/de3512bea3ec36871b24dd63d64885d90c9d5b07))
* **studio:** minified release bundles and modulepreload hints for the editor's boot chunks ([6960620](https://github.com/jxsuite/jx/commit/69606200afb44c8c61d847030426b80562d0c5fd))
* **studio:** minified release bundles and modulepreload hints for the editor's boot chunks ([9e0da5b](https://github.com/jxsuite/jx/commit/9e0da5b8f72d4c40b24f3fb7186ade3867c9a07c))
* **studio:** offer a branch and pull request when a protected branch refuses a push ([#572](https://github.com/jxsuite/jx/issues/572)) ([bb21d4a](https://github.com/jxsuite/jx/commit/bb21d4a7df3fb2b12c5b7e526270c0e6e64dd1d2))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))
* **studio:** open a cloud project from a repository subfolder ([#429](https://github.com/jxsuite/jx/issues/429)) ([bf467a7](https://github.com/jxsuite/jx/commit/bf467a7f4b987dc03fb6bb7db145dfa48c130280))
* **studio:** open, find, save and convert .jxn documents, solo and shared ([#567](https://github.com/jxsuite/jx/issues/567)) ([2be9af7](https://github.com/jxsuite/jx/commit/2be9af7ea7e5ab645a8e3d39c03bbfd4ea6566c2))
* **studio:** per-actor batch lanes replace the global undo batch ([#489](https://github.com/jxsuite/jx/issues/489)) ([32b1f25](https://github.com/jxsuite/jx/commit/32b1f2589e5981171c85db1319d477f6304060d2))
* **studio:** persistent Insert panel with named cards and tabs ([#559](https://github.com/jxsuite/jx/issues/559)) ([a4babb7](https://github.com/jxsuite/jx/commit/a4babb717481a51e7e044cb11229c414a78048d9))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **studio:** Project Settings : Overview sets the default template for new pages ([#586](https://github.com/jxsuite/jx/issues/586)) ([fa87ae5](https://github.com/jxsuite/jx/commit/fa87ae5a8fe0bb635749ae8382c161fb4b24afb0))
* **studio:** Project Settings is a workspace, not a dialog ([#528](https://github.com/jxsuite/jx/issues/528)) ([e8ca05d](https://github.com/jxsuite/jx/commit/e8ca05d55619c56d3779a975d135c835872af196))
* **studio:** Project Styles draws each interactive element in every state ([#582](https://github.com/jxsuite/jx/issues/582)) ([8f742ce](https://github.com/jxsuite/jx/commit/8f742cedbb0e3ce725e67f35834e0379076938e4))
* **studio:** publish to a new branch when a hosted branch moved under your edits ([#522](https://github.com/jxsuite/jx/issues/522)) ([8941481](https://github.com/jxsuite/jx/commit/894148177a3199db7a1dbd20c225a09a2250ea3f))
* **studio:** put the assistant's static prompt first, so its prefix caches ([78c04ce](https://github.com/jxsuite/jx/commit/78c04ceff9bb51f6874cfe16f11f32e02666580e))
* **studio:** put the assistant's static prompt first, so its prefix caches ([ae7dfa9](https://github.com/jxsuite/jx/commit/ae7dfa97bbe42b84ab6ec09a8183087aea00d97a))
* **studio:** quick publish hangs from its chevron and names changes as the site does ([#580](https://github.com/jxsuite/jx/issues/580)) ([d8ebb1e](https://github.com/jxsuite/jx/commit/d8ebb1e4d6fb0c9361063029cb910f05041668b1))
* **studio:** regroup the Page tab, and give a collection's page its fields ([#579](https://github.com/jxsuite/jx/issues/579)) ([6aefd21](https://github.com/jxsuite/jx/commit/6aefd219da276bb8709677337e948fcf40cc432c))
* **studio:** rename and duplicate a media file from the Media workspace ([#533](https://github.com/jxsuite/jx/issues/533)) ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))
* **studio:** Restore undoes the turn across every document it wrote ([#490](https://github.com/jxsuite/jx/issues/490)) ([243986b](https://github.com/jxsuite/jx/commit/243986b3a7b646878c6b115459c42cdf6c37d700))
* **studio:** Review changes compares the picked change in its centre ([#568](https://github.com/jxsuite/jx/issues/568)) ([c1e8e89](https://github.com/jxsuite/jx/commit/c1e8e89e7363677560828e9e0cd02655025b40de))
* **studio:** Review changes says where the site is hosted, and Hosting numbers its setup steps ([#587](https://github.com/jxsuite/jx/issues/587)) ([62b0d93](https://github.com/jxsuite/jx/commit/62b0d93fa209827017746c561958e9fc51037aeb))
* **studio:** segmented Editor and Context axes, implicit Diff, scrollable Variables view ([#485](https://github.com/jxsuite/jx/issues/485)) ([009e798](https://github.com/jxsuite/jx/commit/009e7988e0cc15bd23832b7f886b38076505a2a8))
* **studio:** the assistant asks before a call undo cannot take back ([6edb36a](https://github.com/jxsuite/jx/commit/6edb36aa7c88a45d35c4dcd41777f43a6b4a60aa))
* **studio:** the canvas fetches remote data once, marks what did not resolve, takes a state value ([#649](https://github.com/jxsuite/jx/issues/649)) ([ff1a103](https://github.com/jxsuite/jx/commit/ff1a10311206a2a8de803a64a78e4b4311327a67))
* **studio:** the Command Bar's controls draw at the full 24px ([#602](https://github.com/jxsuite/jx/issues/602)) ([15637d1](https://github.com/jxsuite/jx/commit/15637d19ba46716ac6b515ef612597c61689b991))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))
* **studio:** the Style tab names the components that restyle a Project Styles element ([#583](https://github.com/jxsuite/jx/issues/583)) ([6bb8c95](https://github.com/jxsuite/jx/commit/6bb8c955364b3de77fccbc38e194512991a1f9a6))
* **studio:** the Variables view draws the palette as swatches ([#581](https://github.com/jxsuite/jx/issues/581)) ([7889269](https://github.com/jxsuite/jx/commit/788926964166e2b448c12954df44019aed9b76a4))
* **studio:** write an entry inside its collection's page ([#577](https://github.com/jxsuite/jx/issues/577)) ([f99d8b9](https://github.com/jxsuite/jx/commit/f99d8b9dec5d9452120404576eeb38e78958728f))
* **ui,studio:** jx-table ships, and Studio's Packages and Library tables are drawn with it ([31b1313](https://github.com/jxsuite/jx/commit/31b1313f6a2f4945bc3c329a40d124dba86897e4)), closes [#301](https://github.com/jxsuite/jx/issues/301)
* **ui:** a jx-field in a narrow container stacks its label above the control ([#600](https://github.com/jxsuite/jx/issues/600)) ([18cf26e](https://github.com/jxsuite/jx/commit/18cf26e6a2819e9240fe9029d73b552171768f9e))
* **ui:** section headings are one recipe, and the accordion draws it ([#601](https://github.com/jxsuite/jx/issues/601)) ([fc12fa6](https://github.com/jxsuite/jx/commit/fc12fa686eea1c2fcae5cac274120114bb1a3992))
* **vscode:** a VS Code extension highlights, completes and type checks a .jxn file ([#646](https://github.com/jxsuite/jx/issues/646)) ([2a34cb9](https://github.com/jxsuite/jx/commit/2a34cb94e7c227d5e762ab475a5b78c29ed791ef))


### Bug Fixes

* **ai:** repair tool-call pairs per request, in @jxsuite/ai/messages ([ac8a809](https://github.com/jxsuite/jx/commit/ac8a80973a8d146bef596a8a2015808177505a14))
* **ai:** repair tool-call pairs per request, in @jxsuite/ai/messages ([518d4a8](https://github.com/jxsuite/jx/commit/518d4a8b09930d487af0e390e2b2704b9f76cdec))
* **ai:** run streamed tool calls on any finish but not after Stop, and forward usage ([2dfb312](https://github.com/jxsuite/jx/commit/2dfb312a7190c978c11447b4aad063096da24467))
* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **compiler:** built HTML carries every element property as the attribute it reflects to ([83869d1](https://github.com/jxsuite/jx/commit/83869d15cb18db2ec87b00ea18d2ea2a86269d8e))
* desktop backend paths, right-click menus, and the Media tile menu ([#513](https://github.com/jxsuite/jx/issues/513)) ([80dac1b](https://github.com/jxsuite/jx/commit/80dac1b38b2aaecf954ca0033bc170629022973d))
* **desktop,studio:** 5.x desktop windows booted without their backend; fail loud and report Browse errors ([3f50ec9](https://github.com/jxsuite/jx/commit/3f50ec92d68ee010aedeb35955c1ff673362fac1))
* **desktop:** gate the shared AI proxy with the per-process service token ([e565e9e](https://github.com/jxsuite/jx/commit/e565e9ea2c7fddb68442aa21b29a4d4884ef1338))
* **desktop:** stop loading a second copy of Lit in the same window ([85e9d72](https://github.com/jxsuite/jx/commit/85e9d7242889893ace30171970435e8a9296a5d6))
* **desktop:** stop loading a second copy of Lit in the same window ([3891648](https://github.com/jxsuite/jx/commit/3891648a30130f159c8db73a0955e96c2b1d9c43))
* **desktop:** the launcher's handlers mock needs the member the launcher imports ([c2279e1](https://github.com/jxsuite/jx/commit/c2279e19befbaea7aad80f57c3c2706949e8b1b7))
* **evals:** the harnesses reach their provider, and a trial that never did does not pass ([60a7b10](https://github.com/jxsuite/jx/commit/60a7b10352cf9dce2ba4ccaa2cc154be7989e080))
* **evals:** the harnesses reach their provider, and a trial that never did does not pass ([221a5dc](https://github.com/jxsuite/jx/commit/221a5dcbbe22c545766c94ab60e0fb36f7f5e613))
* **evals:** the headless eval scores a run instead of throwing on its document ([54131c2](https://github.com/jxsuite/jx/commit/54131c22b9be8e19ece3b94056c2b7bbb6a38bf9))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* Jx harness phase 0  gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* normalize Bun.Glob paths to forward slashes on Windows ([d89903a](https://github.com/jxsuite/jx/commit/d89903ac9ab807d48373d8b5dc2489dbf560cd41))
* **runtime:** let a write from a child scope reach the state it names ([#556](https://github.com/jxsuite/jx/issues/556)) ([e32df97](https://github.com/jxsuite/jx/commit/e32df970084e8a7f604a8fbf7934f8f234d2433a))
* **schema,content-mapper,studio:** the state a project gives a document is seen by every reader ([#635](https://github.com/jxsuite/jx/issues/635)) ([c506085](https://github.com/jxsuite/jx/commit/c506085f0397155c3e9e5e9fed62d9ca98e5c87b))
* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))
* **server:** a rename drops the usage cache before it answers, so the new name's ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))
* **studio,desktop:** Browse reports why it could not choose a folder ([2e1a1cc](https://github.com/jxsuite/jx/commit/2e1a1cc7aa2e03b125afeeef29ea7ae6609cd310))
* **studio,desktop:** refuse the dev-server fallback when a launcher failed to start ([521803b](https://github.com/jxsuite/jx/commit/521803b2863cc6fdaa3612e54a4fa5572aa1e8b3))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))
* **studio:** a $switch case that is another document is fetched from the document's folder ([b130d36](https://github.com/jxsuite/jx/commit/b130d36cb94ed0c91e42fc97ae65006973c19acf)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **studio:** a class the backend never resolves holds a canvas render 30 seconds, not for good ([e26831f](https://github.com/jxsuite/jx/commit/e26831f32c804a8f713103015ea15590b6632767)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **studio:** a hand-off waits for the turn New Chat stopped, instead of being lost ([8551590](https://github.com/jxsuite/jx/commit/85515902182ec3b9f1545663575c58e6f06996a7))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([f9fba4f](https://github.com/jxsuite/jx/commit/f9fba4f991d09a7b28026baa68c7c20a16394655))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([c73b161](https://github.com/jxsuite/jx/commit/c73b1616f09e0031df5bddf67aa00f1e6c435ddc))
* **studio:** a one-line raw string in a .jxn file ends where it closes ([#641](https://github.com/jxsuite/jx/issues/641)) ([c4fdd5c](https://github.com/jxsuite/jx/commit/c4fdd5c2d77d735c7f3273992edef1c0304078bb))
* **studio:** a popover panel is shown on its own jx-ready, not a descendant's ([#623](https://github.com/jxsuite/jx/issues/623)) ([7bc0898](https://github.com/jxsuite/jx/commit/7bc0898a52c98ddc736e74101724e68d2fcb6f07))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([4ba9e30](https://github.com/jxsuite/jx/commit/4ba9e30967849112892d4af3744f8231d3b54a95))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([5936082](https://github.com/jxsuite/jx/commit/5936082f9519f486814e78a1d96ce4e2eb6bbdc1))
* **studio:** a right-click on the canvas selects without starting an edit ([#514](https://github.com/jxsuite/jx/issues/514)) ([c3d9384](https://github.com/jxsuite/jx/commit/c3d938468a1adb91d3376b4b191b746547bb5729))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([311d58b](https://github.com/jxsuite/jx/commit/311d58b7547e3bc3a45243733e7c76879aaf5134))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([f6bda72](https://github.com/jxsuite/jx/commit/f6bda72f9af177fe74913dce644127c28e834ad9))
* **studio:** an edit to an innerHTML block stores nodes and removes the markup ([#654](https://github.com/jxsuite/jx/issues/654)) ([b36ca79](https://github.com/jxsuite/jx/commit/b36ca795aec6c2ad4ff6de2601d4f892a4255c77))
* **studio:** an Inspector edit patches the canvas, and a full render keeps the page styled ([#609](https://github.com/jxsuite/jx/issues/609)) ([8021ccf](https://github.com/jxsuite/jx/commit/8021ccf1b9b64916d3b60068cffd957e4b326ef3))
* **studio:** Component Settings shows and edits a prop wherever the instance delivers it ([#651](https://github.com/jxsuite/jx/issues/651)) ([8e5b0f9](https://github.com/jxsuite/jx/commit/8e5b0f955bd45a95c73e67a615d984e1dbb21005))
* **studio:** contain create_page paths and drop the write ledger with its chat ([c733b4f](https://github.com/jxsuite/jx/commit/c733b4f7397b66f0d4b30baef9cfcd9257727fa0))
* **studio:** contain create_page paths and drop the write ledger with its chat ([1fd6482](https://github.com/jxsuite/jx/commit/1fd64822cc77773fa23cc8f3b07f3a9aa1161e78))
* **studio:** cursor-anchored zoom, dirty-gated Save, Library rail button, and four more fixes ([#444](https://github.com/jxsuite/jx/issues/444)) ([72670f0](https://github.com/jxsuite/jx/commit/72670f0ea73eccde8259775a3a802318ce0ed2fc))
* **studio:** discard a superseded package-lock.json when pulling ([#564](https://github.com/jxsuite/jx/issues/564)) ([a49ee6f](https://github.com/jxsuite/jx/commit/a49ee6f08c9889131f83a8c33b1d667fb93ca770))
* **studio:** grid row-header contrast, persistent checkboxes, Publish count after save ([#569](https://github.com/jxsuite/jx/issues/569)) ([5c8baa7](https://github.com/jxsuite/jx/commit/5c8baa7dd367b0d8f4ecd6a4612f02fb5c11c2f9))
* **studio:** let the Style sidebar scroll again ([#536](https://github.com/jxsuite/jx/issues/536)) ([8e1d0d8](https://github.com/jxsuite/jx/commit/8e1d0d834161fb76972e3407d7d2986cec8a19f8))
* **studio:** list a page once when a collection lives in an ancestor of the project ([#527](https://github.com/jxsuite/jx/issues/527)) ([460c775](https://github.com/jxsuite/jx/commit/460c77545988e54068732b623cd8c61a1f6e63d4))
* **studio:** lower the functions coverage floor to match reality, not a regression ([6daee00](https://github.com/jxsuite/jx/commit/6daee00b5da1532e64f294479a98feb2af294847))
* **studio:** offer the account picker when Cloudflare names no account ([1337bc9](https://github.com/jxsuite/jx/commit/1337bc94b07d90c3ce481d1462cee4db197766f7))
* **studio:** one turn per window, and Stop stays on offer for all of it ([e426bd3](https://github.com/jxsuite/jx/commit/e426bd3a72ab81a9eaa5a24e5434a02e37f4e930))
* **studio:** one turn per window, and Stop stays on offer for all of it ([104f296](https://github.com/jxsuite/jx/commit/104f2963547d03dde1fe8ca676a148b8dae9df4c))
* **studio:** one writer per action button's drawn state ([#425](https://github.com/jxsuite/jx/issues/425)) ([7ae7773](https://github.com/jxsuite/jx/commit/7ae777384af3d04b5dfc83b0479080e52ed1cec4))
* **studio:** open a newly created project into a new window when one is already open ([5bdd74d](https://github.com/jxsuite/jx/commit/5bdd74d5b72d1a0603844d7cb71efd448c48bb55))
* **studio:** outline, action bar and caret for display: contents components ([#486](https://github.com/jxsuite/jx/issues/486)) ([b7dcea8](https://github.com/jxsuite/jx/commit/b7dcea8172574afcc410998d1f63bfa4712904ba))
* **studio:** prop-bound text is editable on the canvas wherever the instance delivers the prop ([8ef773f](https://github.com/jxsuite/jx/commit/8ef773f6841e7c24d8624d84e55bc9b6cf1b20ab))
* **studio:** record project directories on every door into a project ([#451](https://github.com/jxsuite/jx/issues/451)) ([3f5faa7](https://github.com/jxsuite/jx/commit/3f5faa71a507e64846f1425f94823de497e951cd))
* **studio:** record the assistant's text and state edits as document ops ([b091a68](https://github.com/jxsuite/jx/commit/b091a6893e32689159ee8db4f76cb5ac16ddac26))
* **studio:** register every Monaco feature before the first editor exists ([#571](https://github.com/jxsuite/jx/issues/571)) ([6e88e9c](https://github.com/jxsuite/jx/commit/6e88e9cd9c94b2283b453e8518220697d0c83671))
* **studio:** responsive Source Control, Edit-only Document Header, chrome polish ([db68119](https://github.com/jxsuite/jx/commit/db68119d345637005d1bbe3de000640b42000f41))
* **studio:** show a failed model listing wherever the catalogue is offered ([1269cb8](https://github.com/jxsuite/jx/commit/1269cb8596ef842835d57f135ccfa4d53013e709))
* **studio:** Source Control, Document Header, button groups, and eight more chrome fixes ([b99443f](https://github.com/jxsuite/jx/commit/b99443fa3fbb930a5681d5ce030836b722a70475))
* **studio:** Stop is armed before the send path's first wait ([b0144cc](https://github.com/jxsuite/jx/commit/b0144cc20011a5c5bc777671adfbd90505c9c205))
* **studio:** Stop is armed before the send path's first wait ([be3d363](https://github.com/jxsuite/jx/commit/be3d36325c065218b2e155b7141c67543c842b12))
* **studio:** stop renames and moves overwriting files, and keep the Files panel live ([#534](https://github.com/jxsuite/jx/issues/534)) ([b29a7bd](https://github.com/jxsuite/jx/commit/b29a7bdb1b8eda6c4c6352d8bcc3059e5eaf9920))
* **studio:** the docked header answers the wheel, the bar flips, and no label is an abbreviation ([837807f](https://github.com/jxsuite/jx/commit/837807fc5133a54a51178167c19695425b2719fc))
* **studio:** the merge's collisions, and a skip that could not fire ([195e0bc](https://github.com/jxsuite/jx/commit/195e0bc5c168775140d1b772505cab03493de6d1))
* **studio:** the quick-insert menu stays frozen over the + that opened it ([#608](https://github.com/jxsuite/jx/issues/608)) ([bb10fb9](https://github.com/jxsuite/jx/commit/bb10fb99c1ecfc3e10cab685bf57fe4ed515342a))
* **studio:** wrap-reverse is an overflow row, so no keyword is ever truncated ([d14da19](https://github.com/jxsuite/jx/commit/d14da19cd674474b89a9781a173f792dd6bc0b7b))
* **studio:** zoom in the status bar, collapsed outline, reliable twisty, diff Code view back ([#605](https://github.com/jxsuite/jx/issues/605)) ([e4cc01d](https://github.com/jxsuite/jx/commit/e4cc01d17353b1e3749c5257fb09383ca6a505dd))
* **ui:** 11px is the type floor, in the kit and in Studio's chrome ([#599](https://github.com/jxsuite/jx/issues/599)) ([ad305fe](https://github.com/jxsuite/jx/commit/ad305fe0da3e0b3b68b03ba9c3c7dda2afcae9e9))
* **ui:** forward form attributes, draw invalid state and guard composition keys ([#626](https://github.com/jxsuite/jx/issues/626)) ([0649c13](https://github.com/jxsuite/jx/commit/0649c1310e329df5c9f34b5f0c8415fb816d3658))


### Performance Improvements

* **studio:** stop sweeping the project for component previews and template counts ([#484](https://github.com/jxsuite/jx/issues/484)) ([b7081a4](https://github.com/jxsuite/jx/commit/b7081a4b74d38a02f17e4a5d8e285944c6100590))
* **studio:** the Library table writes its table roles on its own boxes again ([4b87c8e](https://github.com/jxsuite/jx/commit/4b87c8e78002217aa38e1a8e4afe5bf002fd2d3d)), closes [#301](https://github.com/jxsuite/jx/issues/301)


### Code Refactoring

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501)) ([604b254](https://github.com/jxsuite/jx/commit/604b2540a667bf2ed5adbdadddf532b1e8dfaa9b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.44.0
    * @jxsuite/collab bumped to 0.13.0
    * @jxsuite/create bumped to 1.9.0
    * @jxsuite/erase bumped to 0.4.0
    * @jxsuite/formulas bumped to 0.0.36
    * @jxsuite/markup bumped to 2.0.0
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/site bumped to 3.0.0
    * @jxsuite/ui bumped to 0.13.0
</details>

<details><summary>ui: 0.13.0</summary>

## [0.13.0](https://github.com/jxsuite/jx/compare/ui-v0.12.2...ui-v0.13.0) (2026-11-15)


###   BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.
* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.
* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.

### Features

* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)
* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))
* **studio:** edit an image where it is opened ([#531](https://github.com/jxsuite/jx/issues/531)) ([0e2b90e](https://github.com/jxsuite/jx/commit/0e2b90e9a2deb20a542fc33803adbe31a20673ec))
* **studio:** open a cloud project from a repository subfolder ([#429](https://github.com/jxsuite/jx/issues/429)) ([bf467a7](https://github.com/jxsuite/jx/commit/bf467a7f4b987dc03fb6bb7db145dfa48c130280))
* **ui,studio:** jx-table ships, and Studio's Packages and Library tables are drawn with it ([31b1313](https://github.com/jxsuite/jx/commit/31b1313f6a2f4945bc3c329a40d124dba86897e4)), closes [#301](https://github.com/jxsuite/jx/issues/301)
* **ui:** a jx-action-group or jx-tabs inside a jx-toolbar is one tab stop ([14f22ec](https://github.com/jxsuite/jx/commit/14f22eccdf78645327e564ae9db0b3884812e600)), closes [#302](https://github.com/jxsuite/jx/issues/302)
* **ui:** a jx-field in a narrow container stacks its label above the control ([#600](https://github.com/jxsuite/jx/issues/600)) ([18cf26e](https://github.com/jxsuite/jx/commit/18cf26e6a2819e9240fe9029d73b552171768f9e))
* **ui:** section headings are one recipe, and the accordion draws it ([#601](https://github.com/jxsuite/jx/issues/601)) ([fc12fa6](https://github.com/jxsuite/jx/commit/fc12fa686eea1c2fcae5cac274120114bb1a3992))
* **ui:** the kit's element documents can be loaded one at a time ([71a14b5](https://github.com/jxsuite/jx/commit/71a14b5209f0a28ab33a43dec0b693a2171542e4)), closes [#300](https://github.com/jxsuite/jx/issues/300)
* **ui:** the published kit carries an optional compiled distribution ([d65af9f](https://github.com/jxsuite/jx/commit/d65af9f15ef6f630295114d3b33aabf0b3fe6514)), closes [#304](https://github.com/jxsuite/jx/issues/304)


### Bug Fixes

* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))
* **studio:** cursor-anchored zoom, dirty-gated Save, Library rail button, and four more fixes ([#444](https://github.com/jxsuite/jx/issues/444)) ([72670f0](https://github.com/jxsuite/jx/commit/72670f0ea73eccde8259775a3a802318ce0ed2fc))
* **studio:** Source Control, Document Header, button groups, and eight more chrome fixes ([b99443f](https://github.com/jxsuite/jx/commit/b99443fa3fbb930a5681d5ce030836b722a70475))
* **studio:** zoom in the status bar, collapsed outline, reliable twisty, diff Code view back ([#605](https://github.com/jxsuite/jx/issues/605)) ([e4cc01d](https://github.com/jxsuite/jx/commit/e4cc01d17353b1e3749c5257fb09383ca6a505dd))
* **ui:** 11px is the type floor, in the kit and in Studio's chrome ([#599](https://github.com/jxsuite/jx/issues/599)) ([ad305fe](https://github.com/jxsuite/jx/commit/ad305fe0da3e0b3b68b03ba9c3c7dda2afcae9e9))
* **ui:** a compact action group draws one segmented line, and outset hit areas cannot clip ([5842a3f](https://github.com/jxsuite/jx/commit/5842a3f64d9f32a99905176f1ffd9e15391c8024))
* **ui:** composition guard on combobox, forced-colours option highlight, dialog scroll containment ([#622](https://github.com/jxsuite/jx/issues/622)) ([3a4da4b](https://github.com/jxsuite/jx/commit/3a4da4bf392e1d8e6e6b067c9655e9123fe6f77f))
* **ui:** forward form attributes, draw invalid state and guard composition keys ([#626](https://github.com/jxsuite/jx/issues/626)) ([0649c13](https://github.com/jxsuite/jx/commit/0649c1310e329df5c9f34b5f0c8415fb816d3658))
* **ui:** muted text meets 4.5:1 on every surface, in both schemes ([#598](https://github.com/jxsuite/jx/issues/598)) ([83190e3](https://github.com/jxsuite/jx/commit/83190e30880ed5e0cc8ded9f64fcc95856b20120))
* **ui:** segmented compact action groups, inert empty error region, contained hit areas ([bad8f17](https://github.com/jxsuite/jx/commit/bad8f17760cc937240154aee106682193d102fa8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
</details>

---
This PR was generated with [Release Please](https://github.com/googleapis/release-please). See [documentation](https://github.com/googleapis/release-please#release-please).