# Changelog

## [8.2.0](https://github.com/jxsuite/jx/compare/schema-v8.1.0...schema-v8.2.0) (2026-11-20)


### Features

* **studio:** convert a whole project between .json and .jxn from Project settings ([#717](https://github.com/jxsuite/jx/issues/717)) ([8d25ea7](https://github.com/jxsuite/jx/commit/8d25ea780feca9cc8623c1741037de20b735035c))

## [8.1.0](https://github.com/jxsuite/jx/compare/schema-v8.0.0...schema-v8.1.0) (2026-11-17)


### Features

* **compiler:** csp.sources adds origins to a derived directive ([#694](https://github.com/jxsuite/jx/issues/694)) ([6a6d072](https://github.com/jxsuite/jx/commit/6a6d0725a95c41e629e38461480382ebe7868a34))
* **site:** resolve project defs and default the page charset to utf-8 ([#696](https://github.com/jxsuite/jx/issues/696)) ([41b54fc](https://github.com/jxsuite/jx/commit/41b54fc23c806cee10f85e915d3f2f50d52c69a3))


### Bug Fixes

* **compiler:** negotiate a multilingual site's root under every adapter and base ([#692](https://github.com/jxsuite/jx/issues/692)) ([8e1adbe](https://github.com/jxsuite/jx/commit/8e1adbe75a22fd2bb28dd1f81ffba070825eb5f4))
* **feed:** stamp an empty feed's updated with the build time, not 1970 ([#693](https://github.com/jxsuite/jx/issues/693)) ([6d82a6c](https://github.com/jxsuite/jx/commit/6d82a6c70960a099c1e14497f58aee4f09f53920))

## [8.0.0](https://github.com/jxsuite/jx/compare/schema-v7.0.0...schema-v8.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.

### Features

* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)

## [7.0.0](https://github.com/jxsuite/jx/compare/schema-v6.0.2...schema-v7.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **compiler:** a built list now applies its `filter` and `sort`, where it showed every item in source order. A page list whose items, filter or sort reads state a handler writes is no longer prerendered: the page's module renders it. A template string as a repeater's `items` fails the build. A dynamic page's import map gains the `lit-html/` and `@vue/reactivity/` prefix keys.

### Features

* **compiler:** a site build writes a Custom Elements Manifest for the components it compiles ([44ec625](https://github.com/jxsuite/jx/commit/44ec625061819e4a500d4337d2544b4a1fa34410)), closes [#304](https://github.com/jxsuite/jx/issues/304)
* **compiler:** built lists filter, sort and keep keyed rows as the interpreter does ([8f98e21](https://github.com/jxsuite/jx/commit/8f98e2135e36272b91d14156736c923e846a35ff))
* **runtime,compiler,ui:** a custom element can be form-associated, and the kit's controls are ([dccb628](https://github.com/jxsuite/jx/commit/dccb62832d9c88c36f9ce88d564caf29f6c46f50)), closes [#303](https://github.com/jxsuite/jx/issues/303)
* **schema,studio:** a dynamic tag reads a chain of sources, and its popover lists them in order ([9bd7d5e](https://github.com/jxsuite/jx/commit/9bd7d5e64f29b1b9ca753379639b816fa86dc340)), closes [#653](https://github.com/jxsuite/jx/issues/653)

## [6.0.2](https://github.com/jxsuite/jx/compare/schema-v6.0.1...schema-v6.0.2) (2026-11-14)


### Bug Fixes

* keep CI green on the dependency bumps ([97000ad](https://github.com/jxsuite/jx/commit/97000adb60a24f7ff073df267a4c8d76900bbf04))

## [6.0.1](https://github.com/jxsuite/jx/compare/schema-v6.0.0...schema-v6.0.1) (2026-11-13)


### Bug Fixes

* **schema:** the images config describes the formats the build writes ([77316ac](https://github.com/jxsuite/jx/commit/77316ac17900ded360c72c6e2bf416ca5f516666))

## [6.0.0](https://github.com/jxsuite/jx/compare/schema-v5.6.0...schema-v6.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))

### Features

* **content-mapper,schema:** tsc and a language server check the code in a .jxn document ([#629](https://github.com/jxsuite/jx/issues/629)) ([9efac0a](https://github.com/jxsuite/jx/commit/9efac0a72297f677af688f120ef6caa586dc35a4))
* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* live-canvas foundations (tag model, formulas, runtime splice, static empty lists) ([#640](https://github.com/jxsuite/jx/issues/640)) ([8c83419](https://github.com/jxsuite/jx/commit/8c83419930fb278eec9980f9dd031cee9fcbccdd))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **schema,compiler,runtime:** a document carries its own client and server modules in $script ([#625](https://github.com/jxsuite/jx/issues/625)) ([bca939b](https://github.com/jxsuite/jx/commit/bca939bf63cd75a661842d75c3118b788789028b))
* **schema,content-mapper,studio:** a body's event and its mapped row are typed by where it stands ([#630](https://github.com/jxsuite/jx/issues/630)) ([fdf059f](https://github.com/jxsuite/jx/commit/fdf059f977788e72c9d7ba32060f22be9496481b))
* **schema,content-mapper:** a parameter that declares a type is checked as that type ([#636](https://github.com/jxsuite/jx/issues/636)) ([754a6ea](https://github.com/jxsuite/jx/commit/754a6ea21272cea0dc05c90be0b5c64f21469f53))
* **schema,content-mapper:** a typed entry and a document's $defs are checked as types ([#633](https://github.com/jxsuite/jx/issues/633)) ([63cf576](https://github.com/jxsuite/jx/commit/63cf5765f561915e8696a3ef970d2f45705759fe))
* **schema,content-mapper:** tsc checks a .jxn document's templates and its references into state ([#631](https://github.com/jxsuite/jx/issues/631)) ([c82dda8](https://github.com/jxsuite/jx/commit/c82dda858ebc49eb48d1410262c34102d1db5fe3))
* **schema,content-mapper:** tsc checks the props a .jxn document gives a component ([#632](https://github.com/jxsuite/jx/issues/632)) ([e7834a1](https://github.com/jxsuite/jx/commit/e7834a132bf1f24bcbce25f285d1d25a45883631))
* **schema,runtime,studio:** quote-aware template scan, and a commit keeps its binding ([#638](https://github.com/jxsuite/jx/issues/638)) ([5a1f8d8](https://github.com/jxsuite/jx/commit/5a1f8d878d3e6f824a254421174bdf656eba3b7a))
* **schema,studio:** the Code view completes a .jxn file from its schemas ([#643](https://github.com/jxsuite/jx/issues/643)) ([38e28e3](https://github.com/jxsuite/jx/commit/38e28e32bf7c9856a77ed059f59fe6af148d39f6))
* **studio,schema:** the Code view of a .jxn file marks type errors in the whole file ([#639](https://github.com/jxsuite/jx/issues/639)) ([506ec44](https://github.com/jxsuite/jx/commit/506ec445bf6583e5bfada9a6506e21c775cb8d90))
* **studio:** a dynamic tag opens a popover to pick its source, format and fallback ([#650](https://github.com/jxsuite/jx/issues/650)) ([918a6b5](https://github.com/jxsuite/jx/commit/918a6b5e53a62262b0eeaa3b147dc3a930bae260))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))
* **vscode:** a VS Code extension highlights, completes and type checks a .jxn file ([#646](https://github.com/jxsuite/jx/issues/646)) ([2a34cb9](https://github.com/jxsuite/jx/commit/2a34cb94e7c227d5e762ab475a5b78c29ed791ef))


### Bug Fixes

* **schema,content-mapper,studio:** the state a project gives a document is seen by every reader ([#635](https://github.com/jxsuite/jx/issues/635)) ([c506085](https://github.com/jxsuite/jx/commit/c506085f0397155c3e9e5e9fed62d9ca98e5c87b))
* **schema,content-mapper:** a rename reaches an (export) entry and a scope that redeclares a name ([#634](https://github.com/jxsuite/jx/issues/634)) ([444d1c6](https://github.com/jxsuite/jx/commit/444d1c67d202a3f72d0c7de492504bd6d425c926))

## [5.6.0](https://github.com/jxsuite/jx/compare/schema-v5.5.0...schema-v5.6.0) (2026-11-11)


### Features

* classify Function entries through one shared classifier ([#595](https://github.com/jxsuite/jx/issues/595)) ([122f997](https://github.com/jxsuite/jx/commit/122f997face23fd0a2af532e714d1168ebbdb56c))
* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))
* **schema,runtime,compiler:** one parameter list and call convention ([#607](https://github.com/jxsuite/jx/issues/607)) ([96c427a](https://github.com/jxsuite/jx/commit/96c427a7694afda77d4f426fda65ff220a30ba96))
* **schema,runtime,compiler:** refuse a Function declaring both body and $src ([#604](https://github.com/jxsuite/jx/issues/604)) ([750c463](https://github.com/jxsuite/jx/commit/750c4638f009264d1a71aef556dcb3ef050ea785))
* **schema,studio:** a component setting with an enum is a select ([#606](https://github.com/jxsuite/jx/issues/606)) ([88c9a2f](https://github.com/jxsuite/jx/commit/88c9a2f47647332a9e1f90e88407d7714f1ffbdc))
* **schema,studio:** report type errors in a function body ([#603](https://github.com/jxsuite/jx/issues/603)) ([9fb47c5](https://github.com/jxsuite/jx/commit/9fb47c53d8c86c63b4fb5d6dcdc3608d09f76607))

## [5.5.0](https://github.com/jxsuite/jx/compare/schema-v5.4.0...schema-v5.5.0) (2026-11-08)


### Features

* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))

## [5.4.0](https://github.com/jxsuite/jx/compare/schema-v5.3.0...schema-v5.4.0) (2026-11-08)


### Features

* **desktop:** declare .jxn on every channel that can register a file type ([#570](https://github.com/jxsuite/jx/issues/570)) ([2b19f27](https://github.com/jxsuite/jx/commit/2b19f278c90857d4684c407a102a756f54468665))
* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))

## [5.3.0](https://github.com/jxsuite/jx/compare/schema-v5.2.0...schema-v5.3.0) (2026-11-07)


### Features

* **desktop:** open what the OS hands over, after asking to run a folder's code ([#549](https://github.com/jxsuite/jx/issues/549)) ([7aa3f08](https://github.com/jxsuite/jx/commit/7aa3f08a14b663886949d9dea2ff9227832bcae6))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* saving a .jxn file keeps what did not change ([#555](https://github.com/jxsuite/jx/issues/555)) ([af1197e](https://github.com/jxsuite/jx/commit/af1197e84162fd6376f1053ebebb114c2b3ae7f5))
* **schema:** read and write Jx Notation ([#553](https://github.com/jxsuite/jx/issues/553)) ([e033c82](https://github.com/jxsuite/jx/commit/e033c8221b915c0775794108c69949132feab047))

## [5.2.0](https://github.com/jxsuite/jx/compare/schema-v5.1.0...schema-v5.2.0) (2026-11-06)


### Features

* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))
* **studio:** offer a repeater item's fields in the From data picker ([#539](https://github.com/jxsuite/jx/issues/539)) ([2063bfc](https://github.com/jxsuite/jx/commit/2063bfcd42861fa965ff248faf61b005c29683d2))

## [5.1.0](https://github.com/jxsuite/jx/compare/schema-v5.0.0...schema-v5.1.0) (2026-11-04)


### Features

* **site:** page a list into numbered routes, and query collections by path and by reference ([#535](https://github.com/jxsuite/jx/issues/535)) ([7b838fc](https://github.com/jxsuite/jx/commit/7b838fcc43b1f5e25f6dc348c3ae5fc418ff75f0))

## [5.0.0](https://github.com/jxsuite/jx/compare/schema-v4.1.0...schema-v5.0.0) (2026-10-29)


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
* **schema:** make which answer what Bun.which answers on Windows ([#511](https://github.com/jxsuite/jx/issues/511)) ([a3eaa1b](https://github.com/jxsuite/jx/commit/a3eaa1b420729077366b6d6d387255d7bb13ce01))

## [4.1.0](https://github.com/jxsuite/jx/compare/schema-v4.0.0...schema-v4.1.0) (2026-10-27)


### Features

* **ai:** the tree tools are portable producers in @jxsuite/ai/jx-tools ([#493](https://github.com/jxsuite/jx/issues/493)) ([40e7c27](https://github.com/jxsuite/jx/commit/40e7c27a1abedab5a22f20ade9d1e1e03297e984))
* **studio:** document tools refuse corrupting or no-op edits ([#492](https://github.com/jxsuite/jx/issues/492)) ([7134466](https://github.com/jxsuite/jx/commit/7134466b21d23ba1e8ab79d63890474d84f74e24))

## [4.0.0](https://github.com/jxsuite/jx/compare/schema-v3.0.0...schema-v4.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* **studio,runtime,compiler:** Whitespace-only text is no longer slotted, the first slot of a duplicated name takes the group, and built output now distributes slotted children by name instead of writing every child into every slot. Self-target reactive style declarations now read var(--jx-s0) and similar instead of a per-element --jx-r variable. Studio's Edit and Design views render bound values live instead of showing binding text for component props, attributes and styles.
* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))
* **studio,runtime,compiler:** render real sites on the canvas, fast outline, named slots ([#464](https://github.com/jxsuite/jx/issues/464)) ([6757dff](https://github.com/jxsuite/jx/commit/6757dfff34f6b85f696813ec37a1a46df690f114))

## [3.0.0](https://github.com/jxsuite/jx/compare/schema-v2.3.0...schema-v3.0.0) (2026-10-06)


### ⚠ BREAKING CHANGES

* **parser:** three defaults change for a content type that declares none of the new options. Callouts are on: a blockquote that begins with a GitHub alert marker renders as a callout, and alerts set to false keeps the blockquote. A README.md in a subfolder has its folder's id, so a path-based URL moves from /x/sub/README/ to /x/sub/. A dollar-brace sequence in Markdown text is kept as written instead of being evaluated as a template, as are image descriptions and callout titles.

### Features

* **parser:** support an Obsidian vault as a content collection ([#426](https://github.com/jxsuite/jx/issues/426)) ([6e2ca4a](https://github.com/jxsuite/jx/commit/6e2ca4a08d6c0277e09a80e5524a81c4a6c9ee74))

## [2.3.0](https://github.com/jxsuite/jx/compare/schema-v2.2.0...schema-v2.3.0) (2026-09-29)


### Features

* **schema:** document ops and the JSON serializer as portable @jxsuite/schema subpaths (harness J1.1) ([5d88928](https://github.com/jxsuite/jx/commit/5d88928460938bb626e5314b6cbd29e1d9311913))
* **schema:** the document-op vocabulary and its inverse, as @jxsuite/schema/doc-ops ([5a686cf](https://github.com/jxsuite/jx/commit/5a686cfce193596284bd5eebf3dc37e3056adb6f))
* **schema:** the layout-preserving JSON serializer, as @jxsuite/schema/json-layout ([2e221fe](https://github.com/jxsuite/jx/commit/2e221fe9115e19c458dfe7622c680e149c54acd3))

## [2.2.0](https://github.com/jxsuite/jx/compare/schema-v2.1.0...schema-v2.2.0) (2026-09-14)


### Features

* popovers become a first-class thing the canvas can open, and a rule it can check ([63e5916](https://github.com/jxsuite/jx/commit/63e5916c7aa1b41771bed4029960192582b52c0f))
* **runtime,schema,ui:** the seam schema-contained styling needs ([164f5a2](https://github.com/jxsuite/jx/commit/164f5a242cbbc4442e9af5a7d18dd6a041318b94))
* **runtime,schema:** a declaration at-rule may be written more than once ([9c37c39](https://github.com/jxsuite/jx/commit/9c37c3900b340ff70f6001588a2cbc0228fbc201))
* **runtime,studio:** a style block may document itself, and forced-colors.css is generated from one ([269f4c0](https://github.com/jxsuite/jx/commit/269f4c01b3f60209743a81eb60992fdd85b860ca))
* **runtime,studio:** dialogs, invoker commands and inert on the canvas ([4a1455e](https://github.com/jxsuite/jx/commit/4a1455ee6d0b86228c840529998d9fbed62e4442))
* **schema,runtime,compiler,site:** a style value may read state ([01e74c7](https://github.com/jxsuite/jx/commit/01e74c7f2d43cdcc9a3107b4ab30de4f769922d1))
* **schema,runtime:** keyed $map with per-row scopes, and a $switch that owns its case ([4917ec8](https://github.com/jxsuite/jx/commit/4917ec82f829f2cb39e64268440af9665822a801))
* **schema,studio,compiler:** accessibility rules, judged alike by Studio, jx validate and the tests ([c14d121](https://github.com/jxsuite/jx/commit/c14d121e128bf64c041c401b8b0514f6133e133c))
* **schema:** dialog and invoker-command rules, beside the popover ones (spec §8.7) ([2d6f9ae](https://github.com/jxsuite/jx/commit/2d6f9ae79dce6caf33ccf07790d81151fa6a12aa))
* **schema:** popover correctness rules, shared by every surface that judges a document ([d2575b2](https://github.com/jxsuite/jx/commit/d2575b2bf67cef0cef0a22b26069745c91996e9c))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **ui,compiler,schema:** jx-popover, jx-tooltip and jx-spinner ([21bc6ba](https://github.com/jxsuite/jx/commit/21bc6ba29f3304ddc3c56ee54de36d5b95fa69f1))
* **ui,studio:** jx-menu and jx-menu-item, and the element context menu as the first Jx surface ([07bb458](https://github.com/jxsuite/jx/commit/07bb458d7b02b1fc4683f876123a51a241c01414))
* **ui,studio:** jx-tree and jx-combobox, and the five surfaces that hand-rolled them ([b3363cf](https://github.com/jxsuite/jx/commit/b3363cfe2c9ffb5fe83058d62f83c5b55a95e55f))


### Bug Fixes

* **ci:** split a schema test under the runner's clock, and raise the search index's ceiling ([580f9cf](https://github.com/jxsuite/jx/commit/580f9cf65b2be8b6264ca796c9fa737cbf44a38e))
* **schema,runtime,studio:** the overlay tools could not see a custom element ([bc57e9f](https://github.com/jxsuite/jx/commit/bc57e9f89f2030fcd0b5b5bdeffda2178683908f))
* **schema:** the accessibility name rule reported two correct documents ([871fec0](https://github.com/jxsuite/jx/commit/871fec05f6fe132bcc6e17d4bd612c0371449569))
* **studio,ui,runtime,schema:** thirteen findings from the branch review ([9f80e82](https://github.com/jxsuite/jx/commit/9f80e82d245c7e2124a21828d97518dcac49f02a))
* **ui,studio,schema:** the five defects a browser found that no unit test could ([06e8d00](https://github.com/jxsuite/jx/commit/06e8d0045b3ad6bec99d777f11f9f0fc5570c512))

## [2.1.0](https://github.com/jxsuite/jx/compare/schema-v2.0.0...schema-v2.1.0) (2026-08-30)


### Features

* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([c97617a](https://github.com/jxsuite/jx/commit/c97617a27563a776f038e82c3b0bafb5696996da))
* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([e65e1cf](https://github.com/jxsuite/jx/commit/e65e1cf3feed747822e46fc460ff3d978e1e3131)), closes [#235](https://github.com/jxsuite/jx/issues/235)
* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([d61c756](https://github.com/jxsuite/jx/commit/d61c756ae3366d24769967be2b2057715bb73179))
* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([3bb1c59](https://github.com/jxsuite/jx/commit/3bb1c5965a54a4371cdad856d6119cd752c12721)), closes [#246](https://github.com/jxsuite/jx/issues/246)

## [2.0.0](https://github.com/jxsuite/jx/compare/schema-v1.9.0...schema-v2.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))


### Bug Fixes

* **desktop,import:** the two gates the live preview left red, and the coverage it owed ([c9d56d2](https://github.com/jxsuite/jx/commit/c9d56d2495f1da84997768e6144718be7380de07))


### Performance Improvements

* **compiler:** minify bundles, inline component CSS, preload the runtime ([502238b](https://github.com/jxsuite/jx/commit/502238baa06c81b02fcc2853017c54de6a23526c))
* **compiler:** minify bundles, inline component CSS, preload the runtime ([78dcc89](https://github.com/jxsuite/jx/commit/78dcc89496ad90f6fa0f9369f1c6e6b9d2538641))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))

## [1.9.0](https://github.com/jxsuite/jx/compare/schema-v1.8.1...schema-v1.9.0) (2026-08-26)


### Features

* **schema,runtime,studio:** the shared path math and a default-off canvas asset resolver ([4aad802](https://github.com/jxsuite/jx/commit/4aad80220632ac4ef415172c00ecbbd1a5e95642))
* **schema:** the pure math for project paths, site URLs, and the lanes between them ([6b187f2](https://github.com/jxsuite/jx/commit/6b187f280738fded5ba5f882763e5ac520f5deaa))

## [1.8.1](https://github.com/jxsuite/jx/compare/schema-v1.8.0...schema-v1.8.1) (2026-08-25)


### Bug Fixes

* **cloud:** discover components by reading them, so the canvas can register any ([#200](https://github.com/jxsuite/jx/issues/200)) ([45f650a](https://github.com/jxsuite/jx/commit/45f650a2554b6b8547fe69c72e73e1920bd65dfa))

## [1.8.0](https://github.com/jxsuite/jx/compare/schema-v1.7.0...schema-v1.8.0) (2026-08-21)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* color scheme support ([6334a09](https://github.com/jxsuite/jx/commit/6334a09694aa742e11082b386bcf93305df60477))
* **compiler:** an optional service worker, and the tombstone that removes it ([e7a1bae](https://github.com/jxsuite/jx/commit/e7a1baeb9daac3f271a7e3e926e1a37fc58f646a))
* **compiler:** emit a Content-Security-Policy derived from the built pages ([ce4f8dd](https://github.com/jxsuite/jx/commit/ce4f8dd41cd622aec2affe5663476480bd835f4c))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** generate manifest.webmanifest and .well-known/security.txt ([c77685e](https://github.com/jxsuite/jx/commit/c77685eba7af7774b2df18d296ecf330fd2b3dd4))
* **compiler:** locale routing — the i18n config finally has a reader ([c5151e0](https://github.com/jxsuite/jx/commit/c5151e0265d5befff04503a511b7cecc15b11f4d))
* **compiler:** negotiate a locale, expand {locale} sources, and check prefix-always ([8477348](https://github.com/jxsuite/jx/commit/84773489bcef6cbb4c820351ca9d379c8e97fe77))
* **compiler:** opt into a shadow root with $shadow ([ca5188b](https://github.com/jxsuite/jx/commit/ca5188ba741844c6001c2b500b343cde9f24ddd0))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** a page can render its own language switcher, and formats in its own language ([035970d](https://github.com/jxsuite/jx/commit/035970d6cf99cdec9bce11b2c9dddae5e09a2cef))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **runtime:** enforce private state against $props (spec.md §5.6) ([5e9b029](https://github.com/jxsuite/jx/commit/5e9b0299ad116be4ff61af4e1d3569ad0a6323e9))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** make per-project schema composition host-agnostic ([70e4580](https://github.com/jxsuite/jx/commit/70e4580f6f49d254cfd431585ae577ee9f111a67))
* **schema:** make per-project schema composition host-agnostic ([32d5cbd](https://github.com/jxsuite/jx/commit/32d5cbd05c7c6a303ae454d3c11057aa1e74a123))
* **schema:** normalize identifiers to NFC at the document parse boundary ([26119e7](https://github.com/jxsuite/jx/commit/26119e75f1fecc805738a5d70596c3077a2d9509))
* **schema:** parse media types, and enforce I-JSON at the document boundary ([068811e](https://github.com/jxsuite/jx/commit/068811e83278b0b55d82dd2e88ff838bfabfd05e))
* **schema:** serve markdown and YAML under the media types their RFCs register ([8e8c1f9](https://github.com/jxsuite/jx/commit/8e8c1f9f418a6e516f7e64745fd5c87a64c8b642))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* search package ([e8966f3](https://github.com/jxsuite/jx/commit/e8966f35ba0e1b6dd0da23526ef1a00631ad80d6))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))
* **styling:** forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script ([3f7a046](https://github.com/jxsuite/jx/commit/3f7a04690d34cd803e9fd00dd87ae7e1a2d9389e))
* support external/relative asset files ([7cbe138](https://github.com/jxsuite/jx/commit/7cbe138a1f2ecaa77599ca7112162b526e7bd5bc))


### Bug Fixes

* **compiler:** close five adjacent element-target defects found while fixing [#106](https://github.com/jxsuite/jx/issues/106)-113 ([1fd607a](https://github.com/jxsuite/jx/commit/1fd607a8bcfc86fc6e26a060b966db64591f44ca))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* **compiler:** package files in $head and $elements land in /assets/, not /node_modules/ ([ae4f2bd](https://github.com/jxsuite/jx/commit/ae4f2bd503e07863af51acac60d49b07520d9437))
* **compiler:** resolve the open issue sweep ([#121](https://github.com/jxsuite/jx/issues/121)–[#127](https://github.com/jxsuite/jx/issues/127)) ([fd220b8](https://github.com/jxsuite/jx/commit/fd220b8db68c132039b59f229d2a53194791395d))
* harden dev server and unify runtime/compiler evaluation ([775c393](https://github.com/jxsuite/jx/commit/775c393b5010a304c2a5bf6759b2dfc5ca3bcc80))
* nix build ([77b9b70](https://github.com/jxsuite/jx/commit/77b9b70e46b872f90eb3b514ae1abf5c10fe8216))
* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** cover admission blocks, capability roles, and the rendering grammar ([f435c08](https://github.com/jxsuite/jx/commit/f435c0899b3125489e83e17d6e07a18108210346))
* **schema:** don't polute tree on schema generation ([d3fe41e](https://github.com/jxsuite/jx/commit/d3fe41e86005d0548f4321a85e55a54bba81972b))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **schema:** the committed core schema is what its generator produces, and CI now says so ([b1463f1](https://github.com/jxsuite/jx/commit/b1463f1371db94a555439dba88c88da51ce21c0d))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **studio,server,desktop:** dev server bypassed the build; Monaco still loaded at startup ([0b98da6](https://github.com/jxsuite/jx/commit/0b98da64aa34e49d2c18276359f50c119706f9c1))
* **studio:** keep the Data panel's Refresh able to fetch, and stop happy-dom loading canvas iframes ([8d73c00](https://github.com/jxsuite/jx/commit/8d73c0005e8671ae693363a225bf47ad07d379a5))

## [1.7.0](https://github.com/jxsuite/jx/compare/schema-v1.6.0...schema-v1.7.0) (2026-08-21)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* color scheme support ([6334a09](https://github.com/jxsuite/jx/commit/6334a09694aa742e11082b386bcf93305df60477))
* **compiler:** an optional service worker, and the tombstone that removes it ([e7a1bae](https://github.com/jxsuite/jx/commit/e7a1baeb9daac3f271a7e3e926e1a37fc58f646a))
* **compiler:** emit a Content-Security-Policy derived from the built pages ([ce4f8dd](https://github.com/jxsuite/jx/commit/ce4f8dd41cd622aec2affe5663476480bd835f4c))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** generate manifest.webmanifest and .well-known/security.txt ([c77685e](https://github.com/jxsuite/jx/commit/c77685eba7af7774b2df18d296ecf330fd2b3dd4))
* **compiler:** locale routing — the i18n config finally has a reader ([c5151e0](https://github.com/jxsuite/jx/commit/c5151e0265d5befff04503a511b7cecc15b11f4d))
* **compiler:** negotiate a locale, expand {locale} sources, and check prefix-always ([8477348](https://github.com/jxsuite/jx/commit/84773489bcef6cbb4c820351ca9d379c8e97fe77))
* **compiler:** opt into a shadow root with $shadow ([ca5188b](https://github.com/jxsuite/jx/commit/ca5188ba741844c6001c2b500b343cde9f24ddd0))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* **compiler:** sidecar bundling, extension emit capability, heading anchors ([a360333](https://github.com/jxsuite/jx/commit/a3603333937364ba7753b72ec6bf77138cbe7e42))
* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** a page can render its own language switcher, and formats in its own language ([035970d](https://github.com/jxsuite/jx/commit/035970d6cf99cdec9bce11b2c9dddae5e09a2cef))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **runtime:** enforce private state against $props (spec.md §5.6) ([5e9b029](https://github.com/jxsuite/jx/commit/5e9b0299ad116be4ff61af4e1d3569ad0a6323e9))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** make per-project schema composition host-agnostic ([70e4580](https://github.com/jxsuite/jx/commit/70e4580f6f49d254cfd431585ae577ee9f111a67))
* **schema:** make per-project schema composition host-agnostic ([32d5cbd](https://github.com/jxsuite/jx/commit/32d5cbd05c7c6a303ae454d3c11057aa1e74a123))
* **schema:** normalize identifiers to NFC at the document parse boundary ([26119e7](https://github.com/jxsuite/jx/commit/26119e75f1fecc805738a5d70596c3077a2d9509))
* **schema:** parse media types, and enforce I-JSON at the document boundary ([068811e](https://github.com/jxsuite/jx/commit/068811e83278b0b55d82dd2e88ff838bfabfd05e))
* **schema:** serve markdown and YAML under the media types their RFCs register ([8e8c1f9](https://github.com/jxsuite/jx/commit/8e8c1f9f418a6e516f7e64745fd5c87a64c8b642))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* search package ([e8966f3](https://github.com/jxsuite/jx/commit/e8966f35ba0e1b6dd0da23526ef1a00631ad80d6))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))
* **styling:** forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script ([3f7a046](https://github.com/jxsuite/jx/commit/3f7a04690d34cd803e9fd00dd87ae7e1a2d9389e))
* support external/relative asset files ([7cbe138](https://github.com/jxsuite/jx/commit/7cbe138a1f2ecaa77599ca7112162b526e7bd5bc))


### Bug Fixes

* **compiler:** close five adjacent element-target defects found while fixing [#106](https://github.com/jxsuite/jx/issues/106)-113 ([1fd607a](https://github.com/jxsuite/jx/commit/1fd607a8bcfc86fc6e26a060b966db64591f44ca))
* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* **compiler:** package files in $head and $elements land in /assets/, not /node_modules/ ([ae4f2bd](https://github.com/jxsuite/jx/commit/ae4f2bd503e07863af51acac60d49b07520d9437))
* **compiler:** resolve the open issue sweep ([#121](https://github.com/jxsuite/jx/issues/121)–[#127](https://github.com/jxsuite/jx/issues/127)) ([fd220b8](https://github.com/jxsuite/jx/commit/fd220b8db68c132039b59f229d2a53194791395d))
* harden dev server and unify runtime/compiler evaluation ([775c393](https://github.com/jxsuite/jx/commit/775c393b5010a304c2a5bf6759b2dfc5ca3bcc80))
* nix build ([77b9b70](https://github.com/jxsuite/jx/commit/77b9b70e46b872f90eb3b514ae1abf5c10fe8216))
* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** cover admission blocks, capability roles, and the rendering grammar ([f435c08](https://github.com/jxsuite/jx/commit/f435c0899b3125489e83e17d6e07a18108210346))
* **schema:** don't polute tree on schema generation ([d3fe41e](https://github.com/jxsuite/jx/commit/d3fe41e86005d0548f4321a85e55a54bba81972b))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **schema:** the committed core schema is what its generator produces, and CI now says so ([b1463f1](https://github.com/jxsuite/jx/commit/b1463f1371db94a555439dba88c88da51ce21c0d))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **studio,server,desktop:** dev server bypassed the build; Monaco still loaded at startup ([0b98da6](https://github.com/jxsuite/jx/commit/0b98da64aa34e49d2c18276359f50c119706f9c1))
* **studio:** keep the Data panel's Refresh able to fetch, and stop happy-dom loading canvas iframes ([8d73c00](https://github.com/jxsuite/jx/commit/8d73c0005e8671ae693363a225bf47ad07d379a5))

## [1.6.0](https://github.com/jxsuite/jx/compare/schema-v1.5.0...schema-v1.6.0) (2026-08-19)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **compiler:** an optional service worker, and the tombstone that removes it ([e7a1bae](https://github.com/jxsuite/jx/commit/e7a1baeb9daac3f271a7e3e926e1a37fc58f646a))
* **compiler:** emit a Content-Security-Policy derived from the built pages ([ce4f8dd](https://github.com/jxsuite/jx/commit/ce4f8dd41cd622aec2affe5663476480bd835f4c))
* **compiler:** emit dist/_headers and .nojekyll ([0b2abf6](https://github.com/jxsuite/jx/commit/0b2abf6bd45787b993e93fd8071128e74e81f2c4))
* **compiler:** generate manifest.webmanifest and .well-known/security.txt ([c77685e](https://github.com/jxsuite/jx/commit/c77685eba7af7774b2df18d296ecf330fd2b3dd4))
* **compiler:** locale routing — the i18n config finally has a reader ([c5151e0](https://github.com/jxsuite/jx/commit/c5151e0265d5befff04503a511b7cecc15b11f4d))
* **compiler:** negotiate a locale, expand {locale} sources, and check prefix-always ([8477348](https://github.com/jxsuite/jx/commit/84773489bcef6cbb4c820351ca9d379c8e97fe77))
* **compiler:** opt into a shadow root with $shadow ([ca5188b](https://github.com/jxsuite/jx/commit/ca5188ba741844c6001c2b500b343cde9f24ddd0))
* **compiler:** responsive images — &lt;picture&gt; per format, one owner for loading ([c55b27a](https://github.com/jxsuite/jx/commit/c55b27ad51f0eaa64a989125b50f9f542538f24a))
* **feed:** Atom and JSON Feed from content collections ([345c10c](https://github.com/jxsuite/jx/commit/345c10cb9cf83cef2012e92642dde20b0ee60d10))
* **i18n:** a localized slug is a translation, when the page says which one ([4512d64](https://github.com/jxsuite/jx/commit/4512d64399ad6c54a2a840a52e7f0a62706763c5))
* **i18n:** a page can render its own language switcher, and formats in its own language ([035970d](https://github.com/jxsuite/jx/commit/035970d6cf99cdec9bce11b2c9dddae5e09a2cef))
* **i18n:** format for a language, and count what a reader sees ([c2215e1](https://github.com/jxsuite/jx/commit/c2215e1b30934885f94c8d30b3d0812861226fc5))
* **i18n:** multilingual sites, end to end — framework, Studio, extensions and a starter ([1a4cbbc](https://github.com/jxsuite/jx/commit/1a4cbbc45be89a4a998e2fdf9b244e2979e538ba))
* **runtime:** enforce private state against $props (spec.md §5.6) ([5e9b029](https://github.com/jxsuite/jx/commit/5e9b0299ad116be4ff61af4e1d3569ad0a6323e9))
* **schema,runtime,compiler,studio:** a tag can be chosen at element creation ([f557ed3](https://github.com/jxsuite/jx/commit/f557ed3c7dd6baac42b0e73b85c12863eef917ae))
* **schema:** normalize identifiers to NFC at the document parse boundary ([26119e7](https://github.com/jxsuite/jx/commit/26119e75f1fecc805738a5d70596c3077a2d9509))
* **schema:** parse media types, and enforce I-JSON at the document boundary ([068811e](https://github.com/jxsuite/jx/commit/068811e83278b0b55d82dd2e88ff838bfabfd05e))
* **schema:** serve markdown and YAML under the media types their RFCs register ([8e8c1f9](https://github.com/jxsuite/jx/commit/8e8c1f9f418a6e516f7e64745fd5c87a64c8b642))
* **schema:** validate BCP 47 language tags at author time, not only at build time ([a8d11e1](https://github.com/jxsuite/jx/commit/a8d11e1d16a54376660e4a8c1289a22f2c5d21f1))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **compiler:** head identity, JSON-LD objects, and per-page lang ([61834af](https://github.com/jxsuite/jx/commit/61834af225e10df5eb008ea024230b6c1245ec87))
* **compiler:** package files in $head and $elements land in /assets/, not /node_modules/ ([ae4f2bd](https://github.com/jxsuite/jx/commit/ae4f2bd503e07863af51acac60d49b07520d9437))
* **compiler:** resolve the open issue sweep ([#121](https://github.com/jxsuite/jx/issues/121)–[#127](https://github.com/jxsuite/jx/issues/127)) ([fd220b8](https://github.com/jxsuite/jx/commit/fd220b8db68c132039b59f229d2a53194791395d))
* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **schema,studio:** five defects found by driving Studio against a real production site ([82a52f2](https://github.com/jxsuite/jx/commit/82a52f2954e207201510f80fa6210e24e9d3e61b))
* **schema:** redirects admits the shape the compiler and Studio write ([e695ecd](https://github.com/jxsuite/jx/commit/e695ecd2930f519f64cd87bdb2d073d809bee9f6))
* **schema:** the committed core schema is what its generator produces, and CI now says so ([b1463f1](https://github.com/jxsuite/jx/commit/b1463f1371db94a555439dba88c88da51ce21c0d))

## [1.5.0](https://github.com/jxsuite/jx/compare/schema-v1.4.0...schema-v1.5.0) (2026-07-30)


### Features

* **schema:** make per-project schema composition host-agnostic ([70e4580](https://github.com/jxsuite/jx/commit/70e4580f6f49d254cfd431585ae577ee9f111a67))
* **schema:** make per-project schema composition host-agnostic ([32d5cbd](https://github.com/jxsuite/jx/commit/32d5cbd05c7c6a303ae454d3c11057aa1e74a123))


### Bug Fixes

* **compiler:** close five adjacent element-target defects found while fixing [#106](https://github.com/jxsuite/jx/issues/106)-113 ([1fd607a](https://github.com/jxsuite/jx/commit/1fd607a8bcfc86fc6e26a060b966db64591f44ca))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **schema:** validate $paths against the source union instead of any object ([ede98ad](https://github.com/jxsuite/jx/commit/ede98ad5db79d5a37a1bd62e4ba42d82e81fc1af))
* **studio,server,desktop:** dev server bypassed the build; Monaco still loaded at startup ([0b98da6](https://github.com/jxsuite/jx/commit/0b98da64aa34e49d2c18276359f50c119706f9c1))
* **studio:** keep the Data panel's Refresh able to fetch, and stop happy-dom loading canvas iframes ([8d73c00](https://github.com/jxsuite/jx/commit/8d73c0005e8671ae693363a225bf47ad07d379a5))

## [1.4.0](https://github.com/jxsuite/jx/compare/schema-v1.3.0...schema-v1.4.0) (2026-07-24)


### Features

* support external/relative asset files ([7cbe138](https://github.com/jxsuite/jx/commit/7cbe138a1f2ecaa77599ca7112162b526e7bd5bc))

## [1.3.0](https://github.com/jxsuite/jx/compare/schema-v1.2.0...schema-v1.3.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Bug Fixes

* harden dev server and unify runtime/compiler evaluation ([775c393](https://github.com/jxsuite/jx/commit/775c393b5010a304c2a5bf6759b2dfc5ca3bcc80))
* **schema:** cover admission blocks, capability roles, and the rendering grammar ([f435c08](https://github.com/jxsuite/jx/commit/f435c0899b3125489e83e17d6e07a18108210346))

## [1.2.0](https://github.com/jxsuite/jx/compare/schema-v1.1.0...schema-v1.2.0) (2026-07-18)


### Features

* color scheme support ([6334a09](https://github.com/jxsuite/jx/commit/6334a09694aa742e11082b386bcf93305df60477))
* **compiler:** sidecar bundling, extension emit capability, heading anchors ([a360333](https://github.com/jxsuite/jx/commit/a3603333937364ba7753b72ec6bf77138cbe7e42))
* search package ([e8966f3](https://github.com/jxsuite/jx/commit/e8966f35ba0e1b6dd0da23526ef1a00631ad80d6))
* **styling:** forced color-scheme contract — dual emission, color-scheme triplet, pre-paint script ([3f7a046](https://github.com/jxsuite/jx/commit/3f7a04690d34cd803e9fd00dd87ae7e1a2d9389e))


### Bug Fixes

* nix build ([77b9b70](https://github.com/jxsuite/jx/commit/77b9b70e46b872f90eb3b514ae1abf5c10fe8216))
* **schema:** don't polute tree on schema generation ([d3fe41e](https://github.com/jxsuite/jx/commit/d3fe41e86005d0548f4321a85e55a54bba81972b))

## [1.1.0](https://github.com/jxsuite/jx/compare/schema-v1.0.0...schema-v1.1.0) (2026-07-17)


### Features

* **compiler,server,create:** jx dev and jx preview — the scaffolded scripts now work ([94c9c15](https://github.com/jxsuite/jx/commit/94c9c156a4ad5d65c2282502212fbd3c22e6130a))
* **runtime,schema,formulas:** pure method operators and the composite formula catalog (spec §19.4d) ([39303e6](https://github.com/jxsuite/jx/commit/39303e6004cdeecce27dd77ee6e3c3faf34e4bc3))
* **runtime,schema,studio:** blessed Intl helpers and object-literal expression operands ([cb1c018](https://github.com/jxsuite/jx/commit/cb1c018585869c7a456c22dad602afe724fb4f11))
* **schema,runtime,studio:** structured function bodies and the statement editor (spec §20) ([e418fbb](https://github.com/jxsuite/jx/commit/e418fbb10cd858f7800f3d3fc42a99f2db24296f))
* **schema,runtime:** conditional operators and editor evaluation trace (spec §19.4b, §19.9) ([6cae3e8](https://github.com/jxsuite/jx/commit/6cae3e8abc312f4c44304b76e1c783594e3ff9ab))
* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))

## [1.0.0](https://github.com/jxsuite/jx/compare/schema-v0.35.0...schema-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- move @jxsuite/parser to the extensions/ tree
- hosts switch to the extension model; migrate all projects to content sections

### Features

- **connector:** dynamic data tables extension — Kysely core, /_jx/data mount, db push ([65e0d35](https://github.com/jxsuite/jx/commit/65e0d35bf99924b2cd7aa548d02e29e8441ba6ed))
- hosts switch to the extension model; migrate all projects to content sections ([b2c0e27](https://github.com/jxsuite/jx/commit/b2c0e27c08e649af334fdf67ccf6abbb73c480dc))
- **markup:** shared markup-conversion core package; sever studio/import from parser ([41141a1](https://github.com/jxsuite/jx/commit/41141a15ba51aa6f58ba1dee78731f15893eaff8))
- move @jxsuite/parser to the extensions/ tree ([4157381](https://github.com/jxsuite/jx/commit/4157381e83719359c2980e1f9cded4a5c907c463))
- **schema:** manifest-driven extension registry ([436a71d](https://github.com/jxsuite/jx/commit/436a71d534499cb590b5cc87f2163b9320402605))
- **schema:** shipped schema fragments + per-project schema emitters ([2d9d790](https://github.com/jxsuite/jx/commit/2d9d790ddbc24559809b217aa76ccd9c4db09df1))
- **studio:** descriptor-contributed settings + fetched project schemas ([b85afaf](https://github.com/jxsuite/jx/commit/b85afaf9f6d340e1d916ad399fc758df36ced2e1))

## [0.35.0](https://github.com/jxsuite/jx/compare/schema-v0.34.0...schema-v0.35.0) (2026-07-07)

### Features

- **schema:** build.deploy tracking block; fix stale adapter enum ([c531f46](https://github.com/jxsuite/jx/commit/c531f462658da2e4805ec686f3c7ca27c7334970))
