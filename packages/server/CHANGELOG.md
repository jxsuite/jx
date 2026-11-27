# Changelog

## [9.4.0](https://github.com/jxsuite/jx/compare/server-v9.3.1...server-v9.4.0) (2026-11-27)


### Features

* **collab:** a save answers once, and presence names the rooms a client holds ([#751](https://github.com/jxsuite/jx/issues/751)) ([b1e1073](https://github.com/jxsuite/jx/commit/b1e10730a105f835e2ec35cb7635ee5fa30d2827))
* **compiler:** jx db push runs section owners' deploySchema after the connector plan ([#772](https://github.com/jxsuite/jx/issues/772)) ([86ae47e](https://github.com/jxsuite/jx/commit/86ae47edded62bccb3800163c8bc744bbcaea5f5))
* **desktop:** the backend formats and lints function bodies in its own process ([#774](https://github.com/jxsuite/jx/issues/774)) ([21da4b4](https://github.com/jxsuite/jx/commit/21da4b4a9957e5340c597bc60d108da437c91d11))
* **studio:** show an attach that could not open as Not connected with its reason ([#750](https://github.com/jxsuite/jx/issues/750)) ([d46ef7f](https://github.com/jxsuite/jx/commit/d46ef7fc3a56e68e324f0e7af318e7bbcdf7a7a6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.4
    * @jxsuite/catalog bumped to 0.1.21
    * @jxsuite/collab bumped to 0.14.0
    * @jxsuite/compiler bumped to 11.2.0
    * @jxsuite/create bumped to 1.8.9
    * @jxsuite/erase bumped to 0.3.8
    * @jxsuite/import bumped to 0.44.11
    * @jxsuite/protocol bumped to 7.1.0
    * @jxsuite/runtime bumped to 9.1.0
    * @jxsuite/schema bumped to 8.3.0
    * @jxsuite/site bumped to 4.2.0
    * @jxsuite/starters bumped to 5.2.2
  * devDependencies
    * @jxsuite/auth bumped to 0.9.0
    * @jxsuite/connector bumped to 0.9.0
    * @jxsuite/parser bumped to 5.3.0

## [9.3.1](https://github.com/jxsuite/jx/compare/server-v9.3.0...server-v9.3.1) (2026-11-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.3
    * @jxsuite/catalog bumped to 0.1.20
    * @jxsuite/collab bumped to 0.13.1
    * @jxsuite/compiler bumped to 11.1.2
    * @jxsuite/create bumped to 1.8.8
    * @jxsuite/erase bumped to 0.3.7
    * @jxsuite/import bumped to 0.44.10
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/runtime bumped to 9.0.3
    * @jxsuite/schema bumped to 8.2.1
    * @jxsuite/site bumped to 4.1.2
    * @jxsuite/starters bumped to 5.2.1
  * devDependencies
    * @jxsuite/auth bumped to 0.8.16
    * @jxsuite/connector bumped to 0.8.16
    * @jxsuite/parser bumped to 5.2.3

## [9.3.0](https://github.com/jxsuite/jx/compare/server-v9.2.1...server-v9.3.0) (2026-11-23)


### Features

* **desktop:** project-state host serves the desktop session ([#727](https://github.com/jxsuite/jx/issues/727)) ([fb12d93](https://github.com/jxsuite/jx/commit/fb12d9371e0a1245594480b9c1f185393b87a122))
* **protocol,studio:** the cloud binding of project state, and Studio's half of it ([#732](https://github.com/jxsuite/jx/issues/732)) ([7206f61](https://github.com/jxsuite/jx/commit/7206f614d16d9807952c4073c68064b226aa4d93))
* **server:** a rename is one operation that completes or rolls back ([#731](https://github.com/jxsuite/jx/issues/731)) ([5fb6a0a](https://github.com/jxsuite/jx/commit/5fb6a0a35b6e91fd98641c261e9084e78f25400f))
* **server:** project-state dependency graph ([#725](https://github.com/jxsuite/jx/issues/725)) ([04ae064](https://github.com/jxsuite/jx/commit/04ae0649ae1ad72d0712bd10d5d24d84a4a65ad3))
* **server:** project-state host core, readiness and git monitor ([#726](https://github.com/jxsuite/jx/issues/726)) ([7f7f683](https://github.com/jxsuite/jx/commit/7f7f6839b9361d20d895c6bcb4067a234ff269f0))
* **server:** reference extraction is a pure subpath export ([#723](https://github.com/jxsuite/jx/issues/723)) ([6971aa4](https://github.com/jxsuite/jx/commit/6971aa40c9632b7ffc1a53b9810d3da04764cc49))
* **server:** the dev server serves project state and keys collab rooms by document ([#728](https://github.com/jxsuite/jx/issues/728)) ([bf16222](https://github.com/jxsuite/jx/commit/bf162221a5b26a169ab36a6fc378b9bd974c85df))
* **studio:** convert a whole project between .json and .jxn from Project settings ([#717](https://github.com/jxsuite/jx/issues/717)) ([8d25ea7](https://github.com/jxsuite/jx/commit/8d25ea780feca9cc8623c1741037de20b735035c))
* **studio:** one content store keyed by document and hash, with buffers held against a base ([#729](https://github.com/jxsuite/jx/issues/729)) ([0db299c](https://github.com/jxsuite/jx/commit/0db299cdcb24c3ee3a490b10039a5fc28560be72))


### Bug Fixes

* **studio,desktop,server,runtime:** project state stays current after open, install and edits ([#721](https://github.com/jxsuite/jx/issues/721)) ([b096332](https://github.com/jxsuite/jx/commit/b09633266ab45d19abd3c722bcfa43ee1b97b1e3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.2
    * @jxsuite/catalog bumped to 0.1.19
    * @jxsuite/collab bumped to 0.13.0
    * @jxsuite/compiler bumped to 11.1.1
    * @jxsuite/create bumped to 1.8.7
    * @jxsuite/erase bumped to 0.3.6
    * @jxsuite/import bumped to 0.44.9
    * @jxsuite/protocol bumped to 6.7.0
    * @jxsuite/runtime bumped to 9.0.2
    * @jxsuite/schema bumped to 8.2.0
    * @jxsuite/site bumped to 4.1.1
    * @jxsuite/starters bumped to 5.2.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.15
    * @jxsuite/connector bumped to 0.8.15
    * @jxsuite/parser bumped to 5.2.2

## [9.2.1](https://github.com/jxsuite/jx/compare/server-v9.2.0...server-v9.2.1) (2026-11-17)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.1
    * @jxsuite/catalog bumped to 0.1.18
    * @jxsuite/collab bumped to 0.12.5
    * @jxsuite/compiler bumped to 11.1.0
    * @jxsuite/create bumped to 1.8.6
    * @jxsuite/erase bumped to 0.3.5
    * @jxsuite/import bumped to 0.44.8
    * @jxsuite/protocol bumped to 6.6.1
    * @jxsuite/runtime bumped to 9.0.1
    * @jxsuite/schema bumped to 8.1.0
    * @jxsuite/site bumped to 4.1.0
    * @jxsuite/starters bumped to 5.1.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.14
    * @jxsuite/connector bumped to 0.8.14
    * @jxsuite/parser bumped to 5.2.1

## [9.2.0](https://github.com/jxsuite/jx/compare/server-v9.1.0...server-v9.2.0) (2026-11-15)


### Features

* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))


### Bug Fixes

* **server:** judge the provider base URL by range, and follow no redirect ([8c4964e](https://github.com/jxsuite/jx/commit/8c4964e0b333d2d45e72d5ad537d540cd57f1887))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.45.0
    * @jxsuite/catalog bumped to 0.1.17
    * @jxsuite/collab bumped to 0.12.4
    * @jxsuite/compiler bumped to 11.0.0
    * @jxsuite/create bumped to 1.8.5
    * @jxsuite/erase bumped to 0.3.4
    * @jxsuite/import bumped to 0.44.7
    * @jxsuite/protocol bumped to 6.6.0
    * @jxsuite/runtime bumped to 9.0.0
    * @jxsuite/schema bumped to 8.0.0
    * @jxsuite/site bumped to 4.0.0
    * @jxsuite/starters bumped to 5.0.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.13
    * @jxsuite/connector bumped to 0.8.13
    * @jxsuite/parser bumped to 5.2.0

## [9.1.0](https://github.com/jxsuite/jx/compare/server-v9.0.3...server-v9.1.0) (2026-11-15)


### Features

* **ai:** chat wire version 2 and the OpenAI-compatible provider adapter ([9491a55](https://github.com/jxsuite/jx/commit/9491a55977559d42889d336fd33795b9c650912a))
* **ai:** one stream normalizer for the gateway and the direct client ([99a9637](https://github.com/jxsuite/jx/commit/99a963743aeb7259bf7af00ac2f4411851d2c21d))


### Bug Fixes

* **server:** judge the provider base URL by range, and follow no redirect ([8c4964e](https://github.com/jxsuite/jx/commit/8c4964e0b333d2d45e72d5ad537d540cd57f1887))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.44.0
    * @jxsuite/catalog bumped to 0.1.16
    * @jxsuite/collab bumped to 0.12.3
    * @jxsuite/compiler bumped to 10.0.0
    * @jxsuite/create bumped to 1.8.4
    * @jxsuite/erase bumped to 0.3.3
    * @jxsuite/import bumped to 0.44.6
    * @jxsuite/protocol bumped to 6.5.0
    * @jxsuite/runtime bumped to 8.0.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/site bumped to 3.0.0
    * @jxsuite/starters bumped to 4.0.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.12
    * @jxsuite/connector bumped to 0.8.12
    * @jxsuite/parser bumped to 5.1.0

## [9.0.3](https://github.com/jxsuite/jx/compare/server-v9.0.2...server-v9.0.3) (2026-11-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.7
    * @jxsuite/catalog bumped to 0.1.15
    * @jxsuite/collab bumped to 0.12.2
    * @jxsuite/compiler bumped to 9.1.0
    * @jxsuite/create bumped to 1.8.3
    * @jxsuite/erase bumped to 0.3.2
    * @jxsuite/import bumped to 0.44.5
    * @jxsuite/protocol bumped to 6.4.2
    * @jxsuite/runtime bumped to 7.1.0
    * @jxsuite/schema bumped to 6.0.2
    * @jxsuite/site bumped to 2.8.0
    * @jxsuite/starters bumped to 3.7.1
  * devDependencies
    * @jxsuite/auth bumped to 0.8.11
    * @jxsuite/connector bumped to 0.8.11
    * @jxsuite/parser bumped to 5.0.2

## [9.0.2](https://github.com/jxsuite/jx/compare/server-v9.0.1...server-v9.0.2) (2026-11-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 9.0.1
    * @jxsuite/import bumped to 0.44.4

## [9.0.1](https://github.com/jxsuite/jx/compare/server-v9.0.0...server-v9.0.1) (2026-11-13)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.6
    * @jxsuite/catalog bumped to 0.1.14
    * @jxsuite/collab bumped to 0.12.1
    * @jxsuite/compiler bumped to 9.0.0
    * @jxsuite/create bumped to 1.8.2
    * @jxsuite/erase bumped to 0.3.1
    * @jxsuite/import bumped to 0.44.3
    * @jxsuite/protocol bumped to 6.4.1
    * @jxsuite/runtime bumped to 7.0.1
    * @jxsuite/schema bumped to 6.0.1
    * @jxsuite/site bumped to 2.7.1
    * @jxsuite/starters bumped to 3.7.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.10
    * @jxsuite/connector bumped to 0.8.10
    * @jxsuite/parser bumped to 5.0.1

## [9.0.0](https://github.com/jxsuite/jx/compare/server-v8.7.0...server-v9.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))

### Features

* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* Open in Browser runs a component or a layout on its own ([#644](https://github.com/jxsuite/jx/issues/644)) ([dd6e18d](https://github.com/jxsuite/jx/commit/dd6e18df227e1c78cd0f8e296051b201fd808854))
* **schema,collab,compiler,studio:** a document's script in .jxn, Studio and shared sessions ([#628](https://github.com/jxsuite/jx/issues/628)) ([02b607d](https://github.com/jxsuite/jx/commit/02b607d7d721311aacd8bf0a9d8dea2db70f1bf8))
* **server,compiler:** jx format formats the code a .jxn file holds, as Studio does ([#637](https://github.com/jxsuite/jx/issues/637)) ([46c388b](https://github.com/jxsuite/jx/commit/46c388bcb2726bade8fe5627a8f8b86c03f32f94))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))


### Bug Fixes

* **server:** the site worker refuses cross-site calls and its answers stay out of caches ([#621](https://github.com/jxsuite/jx/issues/621)) ([0a6ba0d](https://github.com/jxsuite/jx/commit/0a6ba0dd614c3f0d26b43ba37547d785398ec3c6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.5
    * @jxsuite/catalog bumped to 0.1.13
    * @jxsuite/collab bumped to 0.12.0
    * @jxsuite/compiler bumped to 8.7.0
    * @jxsuite/create bumped to 1.8.1
    * @jxsuite/erase bumped to 0.3.0
    * @jxsuite/import bumped to 0.44.2
    * @jxsuite/protocol bumped to 6.4.0
    * @jxsuite/runtime bumped to 7.0.0
    * @jxsuite/schema bumped to 6.0.0
    * @jxsuite/site bumped to 2.7.0
    * @jxsuite/starters bumped to 3.6.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.9
    * @jxsuite/connector bumped to 0.8.9
    * @jxsuite/parser bumped to 5.0.0

## [8.7.0](https://github.com/jxsuite/jx/compare/server-v8.6.0...server-v8.7.0) (2026-11-11)


### Features

* edit function bodies as TypeScript and store them as written ([#593](https://github.com/jxsuite/jx/issues/593)) ([c95636f](https://github.com/jxsuite/jx/commit/c95636fa1d7792e5bafb0cde3d242c188b456688))
* run TypeScript function bodies in the canvas and Live Preview ([#592](https://github.com/jxsuite/jx/issues/592)) ([dc09e27](https://github.com/jxsuite/jx/commit/dc09e27d53e7824fa56551784d0b4346350d254b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.4
    * @jxsuite/catalog bumped to 0.1.12
    * @jxsuite/collab bumped to 0.11.10
    * @jxsuite/compiler bumped to 8.6.0
    * @jxsuite/create bumped to 1.8.0
    * @jxsuite/erase bumped to 0.2.0
    * @jxsuite/import bumped to 0.44.1
    * @jxsuite/protocol bumped to 6.3.0
    * @jxsuite/runtime bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0
    * @jxsuite/site bumped to 2.6.0
    * @jxsuite/starters bumped to 3.5.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.8
    * @jxsuite/connector bumped to 0.8.8
    * @jxsuite/parser bumped to 4.3.4

## [8.6.0](https://github.com/jxsuite/jx/compare/server-v8.5.0...server-v8.6.0) (2026-11-08)


### Features

* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.3
    * @jxsuite/catalog bumped to 0.1.11
    * @jxsuite/collab bumped to 0.11.9
    * @jxsuite/compiler bumped to 8.5.0
    * @jxsuite/create bumped to 1.7.0
    * @jxsuite/erase bumped to 0.1.0
    * @jxsuite/import bumped to 0.44.0
    * @jxsuite/protocol bumped to 6.2.5
    * @jxsuite/runtime bumped to 6.2.2
    * @jxsuite/schema bumped to 5.5.0
    * @jxsuite/site bumped to 2.5.1
    * @jxsuite/starters bumped to 3.4.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.7
    * @jxsuite/connector bumped to 0.8.7
    * @jxsuite/parser bumped to 4.3.3

## [8.5.0](https://github.com/jxsuite/jx/compare/server-v8.4.0...server-v8.5.0) (2026-11-08)


### Features

* jx convert moves the project file, and Studio opens one that does not read ([#565](https://github.com/jxsuite/jx/issues/565)) ([aba29d2](https://github.com/jxsuite/jx/commit/aba29d2fa918ec88b680bd3f01c782c4811c9bcd))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))
* **studio:** open, find, save and convert .jxn documents, solo and shared ([#567](https://github.com/jxsuite/jx/issues/567)) ([2be9af7](https://github.com/jxsuite/jx/commit/2be9af7ea7e5ab645a8e3d39c03bbfd4ea6566c2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.2
    * @jxsuite/catalog bumped to 0.1.10
    * @jxsuite/collab bumped to 0.11.8
    * @jxsuite/compiler bumped to 8.4.0
    * @jxsuite/create bumped to 1.6.0
    * @jxsuite/import bumped to 0.43.0
    * @jxsuite/protocol bumped to 6.2.4
    * @jxsuite/runtime bumped to 6.2.1
    * @jxsuite/schema bumped to 5.4.0
    * @jxsuite/site bumped to 2.5.0
    * @jxsuite/starters bumped to 3.3.2
  * devDependencies
    * @jxsuite/auth bumped to 0.8.6
    * @jxsuite/connector bumped to 0.8.6
    * @jxsuite/parser bumped to 4.3.2

## [8.4.0](https://github.com/jxsuite/jx/compare/server-v8.3.0...server-v8.4.0) (2026-11-07)


### Features

* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))
* saving a .jxn file keeps what did not change ([#555](https://github.com/jxsuite/jx/issues/555)) ([af1197e](https://github.com/jxsuite/jx/commit/af1197e84162fd6376f1053ebebb114c2b3ae7f5))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.1
    * @jxsuite/catalog bumped to 0.1.9
    * @jxsuite/collab bumped to 0.11.7
    * @jxsuite/compiler bumped to 8.3.0
    * @jxsuite/create bumped to 1.5.5
    * @jxsuite/import bumped to 0.42.5
    * @jxsuite/protocol bumped to 6.2.3
    * @jxsuite/runtime bumped to 6.2.0
    * @jxsuite/schema bumped to 5.3.0
    * @jxsuite/site bumped to 2.4.0
    * @jxsuite/starters bumped to 3.3.1
  * devDependencies
    * @jxsuite/auth bumped to 0.8.5
    * @jxsuite/connector bumped to 0.8.5
    * @jxsuite/parser bumped to 4.3.1

## [8.3.0](https://github.com/jxsuite/jx/compare/server-v8.2.1...server-v8.3.0) (2026-11-06)


### Features

* **content:** let a project say what holds an entry back ([#548](https://github.com/jxsuite/jx/issues/548)) ([00044a9](https://github.com/jxsuite/jx/commit/00044a9263b36fdb6cba36757e91c767b51cf3af))


### Bug Fixes

* **desktop,server:** keep git paths and commits inside a nested project ([#540](https://github.com/jxsuite/jx/issues/540)) ([5a11efc](https://github.com/jxsuite/jx/commit/5a11efcf7772dc71a82a3c2974418a170dc9876e))
* **server:** resolve a relative class from the base Studio's canvas sends ([#543](https://github.com/jxsuite/jx/issues/543)) ([cc47155](https://github.com/jxsuite/jx/commit/cc471559777afcda7d689544e3789dbc0e8cf7ea))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.43.0
    * @jxsuite/catalog bumped to 0.1.8
    * @jxsuite/collab bumped to 0.11.6
    * @jxsuite/compiler bumped to 8.2.0
    * @jxsuite/create bumped to 1.5.4
    * @jxsuite/import bumped to 0.42.4
    * @jxsuite/protocol bumped to 6.2.2
    * @jxsuite/runtime bumped to 6.1.0
    * @jxsuite/schema bumped to 5.2.0
    * @jxsuite/site bumped to 2.3.1
    * @jxsuite/starters bumped to 3.3.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.4
    * @jxsuite/connector bumped to 0.8.4
    * @jxsuite/parser bumped to 4.3.0

## [8.2.1](https://github.com/jxsuite/jx/compare/server-v8.2.0...server-v8.2.1) (2026-11-04)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.42.1
    * @jxsuite/catalog bumped to 0.1.7
    * @jxsuite/collab bumped to 0.11.5
    * @jxsuite/compiler bumped to 8.1.0
    * @jxsuite/create bumped to 1.5.3
    * @jxsuite/import bumped to 0.42.3
    * @jxsuite/protocol bumped to 6.2.1
    * @jxsuite/runtime bumped to 6.0.2
    * @jxsuite/schema bumped to 5.1.0
    * @jxsuite/site bumped to 2.3.0
    * @jxsuite/starters bumped to 3.2.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.3
    * @jxsuite/connector bumped to 0.8.3
    * @jxsuite/parser bumped to 4.2.0

## [8.2.0](https://github.com/jxsuite/jx/compare/server-v8.1.0...server-v8.2.0) (2026-11-04)


### Features

* **studio:** rename and duplicate a media file from the Media workspace ([#533](https://github.com/jxsuite/jx/issues/533)) ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))


### Bug Fixes

* **server:** a rename drops the usage cache before it answers, so the new name's ([ac8cfaf](https://github.com/jxsuite/jx/commit/ac8cfaf397cca10ce8edb57ca12f5d487ca1fe24))
* **studio:** stop renames and moves overwriting files, and keep the Files panel live ([#534](https://github.com/jxsuite/jx/issues/534)) ([b29a7bd](https://github.com/jxsuite/jx/commit/b29a7bdb1b8eda6c4c6352d8bcc3059e5eaf9920))

## [8.1.0](https://github.com/jxsuite/jx/compare/server-v8.0.1...server-v8.1.0) (2026-11-03)


### Features

* **ai:** support anthropic messages api ([#526](https://github.com/jxsuite/jx/issues/526)) ([d6eefc3](https://github.com/jxsuite/jx/commit/d6eefc364a7e2097f08336c54298f5d8d85fb3d6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.42.0
    * @jxsuite/catalog bumped to 0.1.6
    * @jxsuite/compiler bumped to 8.0.2
    * @jxsuite/create bumped to 1.5.2
    * @jxsuite/import bumped to 0.42.2
    * @jxsuite/protocol bumped to 6.2.0
    * @jxsuite/starters bumped to 3.1.4

## [8.0.1](https://github.com/jxsuite/jx/compare/server-v8.0.0...server-v8.0.1) (2026-10-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.41.2
    * @jxsuite/catalog bumped to 0.1.5
    * @jxsuite/compiler bumped to 8.0.1
    * @jxsuite/create bumped to 1.5.1
    * @jxsuite/import bumped to 0.42.1
    * @jxsuite/protocol bumped to 6.1.0
    * @jxsuite/starters bumped to 3.1.3

## [8.0.0](https://github.com/jxsuite/jx/compare/server-v7.0.0...server-v8.0.0) (2026-10-29)


### ⚠ BREAKING CHANGES

* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510))
* **server:** document the runtime-neutral server and upgrading to 8.0 ([#505](https://github.com/jxsuite/jx/issues/505))

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


### Documentation

* **server:** document the runtime-neutral server and upgrading to 8.0 ([#505](https://github.com/jxsuite/jx/issues/505)) ([fa3bba3](https://github.com/jxsuite/jx/commit/fa3bba3f234655bdd3cf0910af13a4c781560b58))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.41.1
    * @jxsuite/catalog bumped to 0.1.4
    * @jxsuite/collab bumped to 0.11.4
    * @jxsuite/compiler bumped to 8.0.0
    * @jxsuite/create bumped to 1.5.0
    * @jxsuite/import bumped to 0.42.0
    * @jxsuite/protocol bumped to 6.0.0
    * @jxsuite/runtime bumped to 6.0.1
    * @jxsuite/schema bumped to 5.0.0
    * @jxsuite/site bumped to 2.2.2
    * @jxsuite/starters bumped to 3.1.2
  * devDependencies
    * @jxsuite/auth bumped to 0.8.2
    * @jxsuite/connector bumped to 0.8.2
    * @jxsuite/parser bumped to 4.1.2

## [7.0.0](https://github.com/jxsuite/jx/compare/server-v6.1.0...server-v7.0.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501))
* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))

### Features

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))


### Code Refactoring

* **studio:** drop the dev server's Open Project ([#501](https://github.com/jxsuite/jx/issues/501)) ([604b254](https://github.com/jxsuite/jx/commit/604b2540a667bf2ed5adbdadddf532b1e8dfaa9b))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.41.0
    * @jxsuite/catalog bumped to 0.1.3
    * @jxsuite/collab bumped to 0.11.3
    * @jxsuite/compiler bumped to 7.0.0
    * @jxsuite/create bumped to 1.4.1
    * @jxsuite/import bumped to 0.41.1
    * @jxsuite/protocol bumped to 5.0.0
    * @jxsuite/runtime bumped to 6.0.0
    * @jxsuite/schema bumped to 4.1.0
    * @jxsuite/site bumped to 2.2.1
    * @jxsuite/starters bumped to 3.1.1
  * devDependencies
    * @jxsuite/auth bumped to 0.8.1
    * @jxsuite/connector bumped to 0.8.1
    * @jxsuite/parser bumped to 4.1.1

## [6.1.0](https://github.com/jxsuite/jx/compare/server-v6.0.1...server-v6.1.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.40.0
    * @jxsuite/compiler bumped to 6.1.0
    * @jxsuite/create bumped to 1.4.0
    * @jxsuite/import bumped to 0.41.0
    * @jxsuite/runtime bumped to 5.2.0
    * @jxsuite/site bumped to 2.2.0
    * @jxsuite/starters bumped to 3.1.0
  * devDependencies
    * @jxsuite/auth bumped to 0.8.0
    * @jxsuite/connector bumped to 0.8.0
    * @jxsuite/parser bumped to 4.1.0

## [6.0.1](https://github.com/jxsuite/jx/compare/server-v6.0.0...server-v6.0.1) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 6.0.2
    * @jxsuite/create bumped to 1.3.17
    * @jxsuite/import bumped to 0.40.13
    * @jxsuite/runtime bumped to 5.1.0
    * @jxsuite/site bumped to 2.1.0
    * @jxsuite/starters bumped to 3.0.1
  * devDependencies
    * @jxsuite/auth bumped to 0.7.0
    * @jxsuite/connector bumped to 0.7.0
    * @jxsuite/parser bumped to 4.0.1

## [6.0.0](https://github.com/jxsuite/jx/compare/server-v5.0.0...server-v6.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.5
    * @jxsuite/catalog bumped to 0.1.2
    * @jxsuite/compiler bumped to 6.0.1
    * @jxsuite/create bumped to 1.3.16
    * @jxsuite/import bumped to 0.40.12
    * @jxsuite/protocol bumped to 4.0.0
    * @jxsuite/starters bumped to 3.0.0
  * devDependencies
    * @jxsuite/parser bumped to 4.0.0

## [5.0.0](https://github.com/jxsuite/jx/compare/server-v4.5.1...server-v5.0.0) (2026-10-17)


### ⚠ BREAKING CHANGES

* a single-expression Shape 3 entry is no longer always a string; "${state.count}" is now the number, not its text.

### Bug Fixes

* cold-open component timeouts, shell-preview 403s, and typed single-expression state templates ([#460](https://github.com/jxsuite/jx/issues/460)) ([28a0047](https://github.com/jxsuite/jx/commit/28a0047282453277dd2f410edb9b63c38b4a50f8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.4
    * @jxsuite/catalog bumped to 0.1.1
    * @jxsuite/collab bumped to 0.11.2
    * @jxsuite/compiler bumped to 6.0.0
    * @jxsuite/create bumped to 1.3.15
    * @jxsuite/import bumped to 0.40.11
    * @jxsuite/protocol bumped to 3.0.0
    * @jxsuite/runtime bumped to 5.0.0
    * @jxsuite/schema bumped to 4.0.0
    * @jxsuite/site bumped to 2.0.5
    * @jxsuite/starters bumped to 2.0.2
  * devDependencies
    * @jxsuite/auth bumped to 0.6.3
    * @jxsuite/connector bumped to 0.6.3
    * @jxsuite/parser bumped to 3.0.0

## [4.5.1](https://github.com/jxsuite/jx/compare/server-v4.5.0...server-v4.5.1) (2026-10-16)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.3
    * @jxsuite/import bumped to 0.40.10

## [4.5.0](https://github.com/jxsuite/jx/compare/server-v4.4.5...server-v4.5.0) (2026-10-11)


### Features

* **runtime:** call a server-timed entry only through the host's proxy ([#445](https://github.com/jxsuite/jx/issues/445)) ([2305f8e](https://github.com/jxsuite/jx/commit/2305f8e32e88974fe7f8842641d08a62284b6759))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.2
    * @jxsuite/create bumped to 1.3.14
    * @jxsuite/import bumped to 0.40.9
    * @jxsuite/runtime bumped to 4.1.0
    * @jxsuite/site bumped to 2.0.4
    * @jxsuite/starters bumped to 2.0.1
  * devDependencies
    * @jxsuite/parser bumped to 2.0.1

## [4.4.5](https://github.com/jxsuite/jx/compare/server-v4.4.4...server-v4.4.5) (2026-10-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.1
    * @jxsuite/import bumped to 0.40.8

## [4.4.4](https://github.com/jxsuite/jx/compare/server-v4.4.3...server-v4.4.4) (2026-10-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.0
    * @jxsuite/import bumped to 0.40.7

## [4.4.3](https://github.com/jxsuite/jx/compare/server-v4.4.2...server-v4.4.3) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.3
    * @jxsuite/collab bumped to 0.11.1
    * @jxsuite/compiler bumped to 5.0.0
    * @jxsuite/create bumped to 1.3.13
    * @jxsuite/import bumped to 0.40.6
    * @jxsuite/protocol bumped to 2.6.1
    * @jxsuite/runtime bumped to 4.0.3
    * @jxsuite/schema bumped to 3.0.0
    * @jxsuite/site bumped to 2.0.3
    * @jxsuite/starters bumped to 2.0.0
  * devDependencies
    * @jxsuite/auth bumped to 0.6.2
    * @jxsuite/connector bumped to 0.6.2
    * @jxsuite/parser bumped to 2.0.0

## [4.4.2](https://github.com/jxsuite/jx/compare/server-v4.4.1...server-v4.4.2) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.2
    * @jxsuite/compiler bumped to 4.0.3
    * @jxsuite/import bumped to 0.40.5

## [4.4.1](https://github.com/jxsuite/jx/compare/server-v4.4.0...server-v4.4.1) (2026-10-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.1
    * @jxsuite/collab bumped to 0.11.0
    * @jxsuite/protocol bumped to 2.6.0

## [4.4.0](https://github.com/jxsuite/jx/compare/server-v4.3.0...server-v4.4.0) (2026-10-01)


### Features

* **ai:** prompt-cache hints, keyed per chat session ([50e119c](https://github.com/jxsuite/jx/commit/50e119c841fe7929c9e15da7923e987e47cbbcf4))
* **ai:** prompt-cache hints, keyed per chat session ([9f2ac83](https://github.com/jxsuite/jx/commit/9f2ac83a265b48caceb78b2f3d4a6555c728c374))
* **desktop:** publish Jx Studio to the Snap Store, and ship a 66% smaller Nix package ([e607f31](https://github.com/jxsuite/jx/commit/e607f31b58da211f85e30c1f93a578859bb605e0))


### Bug Fixes

* **server:** declare oxfmt, which the code services import ([e91bf5c](https://github.com/jxsuite/jx/commit/e91bf5cd05a775032e3244b0f4d54563f551d435))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.39.0
    * @jxsuite/protocol bumped to 2.5.0

## [4.3.0](https://github.com/jxsuite/jx/compare/server-v4.2.2...server-v4.3.0) (2026-09-29)


### Features

* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))


### Bug Fixes

* **ai:** run streamed tool calls on any finish but not after Stop, and forward usage ([2dfb312](https://github.com/jxsuite/jx/commit/2dfb312a7190c978c11447b4aad063096da24467))
* **desktop:** gate the shared AI proxy with the per-process service token ([e565e9e](https://github.com/jxsuite/jx/commit/e565e9ea2c7fddb68442aa21b29a4d4884ef1338))
* Jx harness phase 0 — gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* **studio:** Source Control, Document Header, button groups, and eight more chrome fixes ([b99443f](https://github.com/jxsuite/jx/commit/b99443fa3fbb930a5681d5ce030836b722a70475))
* **studio:** the merge's collisions, and a skip that could not fire ([195e0bc](https://github.com/jxsuite/jx/commit/195e0bc5c168775140d1b772505cab03493de6d1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/ai bumped to 0.38.0
    * @jxsuite/collab bumped to 0.10.0
    * @jxsuite/compiler bumped to 4.0.2
    * @jxsuite/create bumped to 1.3.12
    * @jxsuite/import bumped to 0.40.4
    * @jxsuite/protocol bumped to 2.4.0
    * @jxsuite/runtime bumped to 4.0.2
    * @jxsuite/schema bumped to 2.3.0
    * @jxsuite/site bumped to 2.0.2
    * @jxsuite/starters bumped to 1.8.2
  * devDependencies
    * @jxsuite/auth bumped to 0.6.1
    * @jxsuite/connector bumped to 0.6.1
    * @jxsuite/parser bumped to 1.8.2

## [4.2.2](https://github.com/jxsuite/jx/compare/server-v4.2.1...server-v4.2.2) (2026-09-18)


### Bug Fixes

* **ai:** parse Cloudflare's array-shaped error envelope for BYOK providers ([e8158b6](https://github.com/jxsuite/jx/commit/e8158b680ec5dbbb016de784010768ca360cdd8a))
* **ai:** parse Cloudflare's array-shaped error envelope for BYOK providers ([172f061](https://github.com/jxsuite/jx/commit/172f06194f500312b4b8792839aa999ec9bc67b0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.3.1

## [4.2.1](https://github.com/jxsuite/jx/compare/server-v4.2.0...server-v4.2.1) (2026-09-14)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 4.0.1
    * @jxsuite/create bumped to 1.3.11
    * @jxsuite/import bumped to 0.40.3
    * @jxsuite/runtime bumped to 4.0.1
    * @jxsuite/site bumped to 2.0.1
    * @jxsuite/starters bumped to 1.8.1
  * devDependencies
    * @jxsuite/parser bumped to 1.8.1

## [4.2.0](https://github.com/jxsuite/jx/compare/server-v4.1.0...server-v4.2.0) (2026-09-14)


### Features

* **studio,server,protocol:** one toggle installs an extension and enables it ([1fe5f67](https://github.com/jxsuite/jx/commit/1fe5f6731c00c9421e8dcd8d1ca100d2b06f740e))
* **studio,server,protocol:** one toggle installs an extension and enables it ([17b2627](https://github.com/jxsuite/jx/commit/17b26270db18e23f2f66f7bb15e67db64b2eac22))
* **studio:** highlight what changed in a diff, and open every changed file ([c87b2f3](https://github.com/jxsuite/jx/commit/c87b2f38bf97ec4f339cd9ac136885dd07d8ac7b))


### Bug Fixes

* **ai:** stop sending an empty assistant turn, and replay a model's reasoning ([1aaa1d3](https://github.com/jxsuite/jx/commit/1aaa1d371862ed0f2d26fe9588ab3dd0d0fea838))
* **ai:** stop sending an empty assistant turn, and replay a model's reasoning ([01cc65d](https://github.com/jxsuite/jx/commit/01cc65d2cfe7b7e0f34cd1fcf0ec96a32f53677a))
* **desktop,server:** the coverage gates the new catalogue member missed ([ba985d5](https://github.com/jxsuite/jx/commit/ba985d540d49d1147cbcd1147bf5ba301e49c4af))
* **server:** point catalog imports at extension-catalog.ts, not the renamed package ([550affd](https://github.com/jxsuite/jx/commit/550affd0b373e4310e3f8e2fd7e19ba2db2b7d93))
* **server:** point package.json's ./catalog export at extension-catalog.ts ([b724807](https://github.com/jxsuite/jx/commit/b7248072fb841d010b1c5985048e534f826fb7d1))
* **studio,server:** the diff view drew line numbers and no text ([4618933](https://github.com/jxsuite/jx/commit/46189330c881097ad1fe4db2ee24dda9f2aea744))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.9.0
    * @jxsuite/compiler bumped to 4.0.0
    * @jxsuite/create bumped to 1.3.10
    * @jxsuite/import bumped to 0.40.2
    * @jxsuite/protocol bumped to 2.3.0
    * @jxsuite/runtime bumped to 4.0.0
    * @jxsuite/schema bumped to 2.2.0
    * @jxsuite/site bumped to 2.0.0
    * @jxsuite/starters bumped to 1.8.0
  * devDependencies
    * @jxsuite/auth bumped to 0.6.0
    * @jxsuite/connector bumped to 0.6.0
    * @jxsuite/parser bumped to 1.8.0

## [4.1.0](https://github.com/jxsuite/jx/compare/server-v4.0.0...server-v4.1.0) (2026-08-30)


### Features

* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([c97617a](https://github.com/jxsuite/jx/commit/c97617a27563a776f038e82c3b0bafb5696996da))
* **compiler,server:** a site deployed under a subpath resolves its URLs against url's path ([e65e1cf](https://github.com/jxsuite/jx/commit/e65e1cf3feed747822e46fc460ff3d978e1e3131)), closes [#235](https://github.com/jxsuite/jx/issues/235)
* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([d61c756](https://github.com/jxsuite/jx/commit/d61c756ae3366d24769967be2b2057715bb73179))
* **parser,schema,server:** a format may declare rewrite, repairing a reference a CSV row names ([3bb1c59](https://github.com/jxsuite/jx/commit/3bb1c5965a54a4371cdad856d6119cd752c12721)), closes [#246](https://github.com/jxsuite/jx/issues/246)


### Bug Fixes

* **server:** a copy map's keys and a directory content source are references the engine can see ([265fcd5](https://github.com/jxsuite/jx/commit/265fcd522b6c6d28a1b9992353aaeb40d6cbdaa1))
* **server:** a copy map's keys and a directory content source are references the engine can see ([744c7df](https://github.com/jxsuite/jx/commit/744c7dfcf886520e234650b0c417653dd40d5101)), closes [#242](https://github.com/jxsuite/jx/issues/242) [#243](https://github.com/jxsuite/jx/issues/243)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.8.5
    * @jxsuite/compiler bumped to 3.1.0
    * @jxsuite/create bumped to 1.3.9
    * @jxsuite/import bumped to 0.40.1
    * @jxsuite/protocol bumped to 2.2.0
    * @jxsuite/runtime bumped to 3.1.0
    * @jxsuite/schema bumped to 2.1.0
    * @jxsuite/site bumped to 1.1.0
    * @jxsuite/starters bumped to 1.7.0
  * devDependencies
    * @jxsuite/auth bumped to 0.5.7
    * @jxsuite/connector bumped to 0.5.7
    * @jxsuite/parser bumped to 1.7.0

## [4.0.0](https://github.com/jxsuite/jx/compare/server-v3.0.0...server-v4.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* **import:** limit the breakpoints an import keeps, and strip the classes it cannot use ([1332da8](https://github.com/jxsuite/jx/commit/1332da854e6db822b56219cfa7ab3a8ffbb1b43b))
* **import:** the site-import workflow, end to end ([f701f33](https://github.com/jxsuite/jx/commit/f701f33bc035a8e5ce331530ff9886d25236da64))
* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))
* **server,studio:** the import stream says what the run found, and can check its own fidelity ([367f374](https://github.com/jxsuite/jx/commit/367f3740a42d90e0f769ad21097c555e25d88b4d))
* **server:** the working tree, browsable at real routes, on its own origin ([d862f2f](https://github.com/jxsuite/jx/commit/d862f2f71fd0579b6435fa6f48d69f029ac6c5dc))
* **studio:** choose a format on New File, convert between formats, and inherit a collection's ([b206983](https://github.com/jxsuite/jx/commit/b2069834dc6f586aef9eed5c620e4378d5c46c22))
* **studio:** Open in Browser previews the canvas, and Build Site keeps the compiler ([b834eef](https://github.com/jxsuite/jx/commit/b834eefd1107663832695e99335919ccec42e9a4))
* **studio:** set the import's fidelity minimum in the New Project dialog ([ce1c05d](https://github.com/jxsuite/jx/commit/ce1c05d09336f8eb8e767988a119b517e625f6fa))
* **studio:** the site import is an agent turn — model, brief, live status, and a pause to ask ([3afd38c](https://github.com/jxsuite/jx/commit/3afd38c254e368f95eccbe01ca6f1168fe279aac))
* **studio:** watch an import in the project, in a feed that outlives the run ([5fe22e2](https://github.com/jxsuite/jx/commit/5fe22e29a4eb32e9c3c87f5fbc503f4183ee0060))


### Bug Fixes

* **desktop,import:** the two gates the live preview left red, and the coverage it owed ([c9d56d2](https://github.com/jxsuite/jx/commit/c9d56d2495f1da84997768e6144718be7380de07))
* **screenshots:** stop the screenshot lane churning, and fix the three defects underneath it ([b0d5f57](https://github.com/jxsuite/jx/commit/b0d5f570db2d8aa839469ad846eced8cf3051067))
* **server,desktop:** answer a directory listing in stable path order ([32f1362](https://github.com/jxsuite/jx/commit/32f13628fcde9704167cada10f8be54f2f238f9d))
* **server,studio:** findReferences answers about every reference, and the rename keeps its promise ([ce3266f](https://github.com/jxsuite/jx/commit/ce3266f3966363ef602201a864047d3a7314c22f))
* **server:** a rename drops the co-editing room keyed to the old path ([3baebea](https://github.com/jxsuite/jx/commit/3baebeacb9ddf4487e6e30deba5885eb08a6e890))
* **server:** resolve rooted refs through every lane, and index refs by shape ([a0f0437](https://github.com/jxsuite/jx/commit/a0f04370929254e6d9d1219d518b4bef67884b78)), closes [#239](https://github.com/jxsuite/jx/issues/239)
* **server:** resolve the references target against the server root, like its sibling ([9610487](https://github.com/jxsuite/jx/commit/96104875c5cb92d6d90dca0d583d55afca93821a)), closes [#239](https://github.com/jxsuite/jx/issues/239)
* **server:** the preview origin builds its format registry from the project's config ([0dd061a](https://github.com/jxsuite/jx/commit/0dd061a86c81810a10600725087333b3eb8a8a6d))
* **studio:** stop stripping the project root off a reply that is already in it ([fd2c913](https://github.com/jxsuite/jx/commit/fd2c9136b746f88d49694a7ac0cfb7feaacbe88d)), closes [#239](https://github.com/jxsuite/jx/issues/239)
* **studio:** the Packages table shows each dependency's own npm latest ([fe75f46](https://github.com/jxsuite/jx/commit/fe75f46c08b31ffc8fee3bce51edbe98e10ec772))
* **studio:** the Packages table shows each dependency's own npm latest ([e6610a8](https://github.com/jxsuite/jx/commit/e6610a859613c40ff6f4cb2c20652dc267cb234f))
* **studio:** the Packages table shows each dependency's own npm latest ([30d997b](https://github.com/jxsuite/jx/commit/30d997b3d25cad7b00ab8c2fdc4413d728b7e124))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.8.4
    * @jxsuite/compiler bumped to 3.0.0
    * @jxsuite/create bumped to 1.3.8
    * @jxsuite/import bumped to 0.40.0
    * @jxsuite/protocol bumped to 2.1.0
    * @jxsuite/runtime bumped to 3.0.0
    * @jxsuite/schema bumped to 2.0.0
    * @jxsuite/site bumped to 1.0.0
    * @jxsuite/starters bumped to 1.6.5
  * devDependencies
    * @jxsuite/auth bumped to 0.5.6
    * @jxsuite/connector bumped to 0.5.6
    * @jxsuite/parser bumped to 1.6.0

## [3.0.0](https://github.com/jxsuite/jx/compare/server-v2.2.7...server-v3.0.0) (2026-08-26)


### ⚠ BREAKING CHANGES

* **server:** a project relying on root-relative static serving loses it. The root lane survives as a COMPATIBILITY lane and is scheduled for removal; until then a site URL answered from it prints a diagnostic naming the file and the fix — move it into `public/`.

### Bug Fixes

* **server:** public/ resolves before the project root, as a build does ([3d940b0](https://github.com/jxsuite/jx/commit/3d940b06459d8ae94769fbabc6eec133cb8f60b6))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.8.3
    * @jxsuite/compiler bumped to 2.0.8
    * @jxsuite/create bumped to 1.3.7
    * @jxsuite/import bumped to 0.39.8
    * @jxsuite/protocol bumped to 2.0.0
    * @jxsuite/runtime bumped to 2.1.0
    * @jxsuite/schema bumped to 1.9.0
    * @jxsuite/starters bumped to 1.6.4
  * devDependencies
    * @jxsuite/auth bumped to 0.5.5
    * @jxsuite/connector bumped to 0.5.5
    * @jxsuite/parser bumped to 1.5.6

## [2.2.7](https://github.com/jxsuite/jx/compare/server-v2.2.6...server-v2.2.7) (2026-08-25)


### Bug Fixes

* **cloud:** discover components by reading them, so the canvas can register any ([#200](https://github.com/jxsuite/jx/issues/200)) ([45f650a](https://github.com/jxsuite/jx/commit/45f650a2554b6b8547fe69c72e73e1920bd65dfa))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.8.2
    * @jxsuite/compiler bumped to 2.0.7
    * @jxsuite/create bumped to 1.3.6
    * @jxsuite/import bumped to 0.39.7
    * @jxsuite/protocol bumped to 1.2.1
    * @jxsuite/runtime bumped to 2.0.5
    * @jxsuite/schema bumped to 1.8.1
    * @jxsuite/starters bumped to 1.6.3
  * devDependencies
    * @jxsuite/auth bumped to 0.5.4
    * @jxsuite/connector bumped to 0.5.4
    * @jxsuite/parser bumped to 1.5.5

## [2.2.6](https://github.com/jxsuite/jx/compare/server-v2.2.5...server-v2.2.6) (2026-08-24)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.6
    * @jxsuite/import bumped to 0.39.6
  * devDependencies
    * @jxsuite/auth bumped to 0.5.3
    * @jxsuite/connector bumped to 0.5.3

## [2.2.5](https://github.com/jxsuite/jx/compare/server-v2.2.4...server-v2.2.5) (2026-08-24)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.5
    * @jxsuite/create bumped to 1.3.5
    * @jxsuite/import bumped to 0.39.5
    * @jxsuite/runtime bumped to 2.0.4
    * @jxsuite/starters bumped to 1.6.2
  * devDependencies
    * @jxsuite/parser bumped to 1.5.4

## [2.2.4](https://github.com/jxsuite/jx/compare/server-v2.2.3...server-v2.2.4) (2026-08-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.4
    * @jxsuite/create bumped to 1.3.4
    * @jxsuite/import bumped to 0.39.4
    * @jxsuite/protocol bumped to 1.2.0
    * @jxsuite/runtime bumped to 2.0.3
    * @jxsuite/starters bumped to 1.6.1
  * devDependencies
    * @jxsuite/parser bumped to 1.5.3

## [2.2.3](https://github.com/jxsuite/jx/compare/server-v2.2.2...server-v2.2.3) (2026-08-23)


### Bug Fixes

* **desktop:** a bare jx-studio watched the whole home directory ([b014dfc](https://github.com/jxsuite/jx/commit/b014dfc485bad4c24c4ba9a4bb3f54f9e4195106))
* **desktop:** a bare jx-studio watched the whole home directory ([56d0885](https://github.com/jxsuite/jx/commit/56d0885e2d62a6f54a9477c52b614ad98e41bdeb))

## [2.2.2](https://github.com/jxsuite/jx/compare/server-v2.2.1...server-v2.2.2) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.3
    * @jxsuite/create bumped to 1.3.3
    * @jxsuite/import bumped to 0.39.3
    * @jxsuite/starters bumped to 1.6.0

## [2.2.1](https://github.com/jxsuite/jx/compare/server-v2.2.0...server-v2.2.1) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.8.1
    * @jxsuite/compiler bumped to 2.0.2
    * @jxsuite/create bumped to 1.3.2
    * @jxsuite/import bumped to 0.39.2
    * @jxsuite/protocol bumped to 1.1.2
    * @jxsuite/runtime bumped to 2.0.2
    * @jxsuite/schema bumped to 1.8.0
    * @jxsuite/starters bumped to 1.5.0
  * devDependencies
    * @jxsuite/auth bumped to 0.5.2
    * @jxsuite/connector bumped to 0.5.2
    * @jxsuite/parser bumped to 1.5.2

## [2.2.0](https://github.com/jxsuite/jx/compare/server-v2.1.0...server-v2.2.0) (2026-08-21)


### Features

* **desktop:** bring the chromium launcher to PAL parity with electrobun ([595d413](https://github.com/jxsuite/jx/commit/595d41325c4d81322dc5fe927161e07af51d35a2))
* **desktop:** bring the chromium launcher to PAL parity with electrobun ([9f13748](https://github.com/jxsuite/jx/commit/9f137482449ba887279aeb838b2c4c275c37a494))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.8.0
    * @jxsuite/compiler bumped to 2.0.1
    * @jxsuite/create bumped to 1.3.1
    * @jxsuite/import bumped to 0.39.1
    * @jxsuite/protocol bumped to 1.1.1
    * @jxsuite/runtime bumped to 2.0.1
    * @jxsuite/schema bumped to 1.7.0
    * @jxsuite/starters bumped to 1.4.0
  * devDependencies
    * @jxsuite/auth bumped to 0.5.1
    * @jxsuite/connector bumped to 0.5.1
    * @jxsuite/parser bumped to 1.5.1

## [2.1.0](https://github.com/jxsuite/jx/compare/server-v2.0.0...server-v2.1.0) (2026-08-19)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **collab:** negotiate the wire envelope on the handshake — jx.collab.v1 ([25c3cf3](https://github.com/jxsuite/jx/commit/25c3cf31feeb4087797e7d9f182cb4f7345c4fcb))
* **protocol:** one failure shape — RFC 9457 problem details ([e2598da](https://github.com/jxsuite/jx/commit/e2598dab57d672d3c0f805d1d5789ad955c9df2f))
* **schema:** serve markdown and YAML under the media types their RFCs register ([8e8c1f9](https://github.com/jxsuite/jx/commit/8e8c1f9f418a6e516f7e64745fd5c87a64c8b642))
* **server:** read Fetch Metadata, and close the three ungated project-server routes ([0e69837](https://github.com/jxsuite/jx/commit/0e698374ba5f251548d293f8553b12d308e07463))
* **server:** ship the Trusted Types observation stage (spec.md §21.5) ([fd616c5](https://github.com/jxsuite/jx/commit/fd616c5b566ea3fb1903f8d67a38c844a66f0ebb))
* **server:** the live-reload stream reconnects, and the import stream stops hiding drops ([8d5aff6](https://github.com/jxsuite/jx/commit/8d5aff63aec49499459b8d1b80d2510d02f3be93))
* **studio,server,desktop:** P4 wave A — the app can say what happened ([c319576](https://github.com/jxsuite/jx/commit/c3195762c0dd76472355dd3ae0eb9ba6fc12c0d3))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **server:** give the previewed site its own origin, so Open in Browser is the real site ([fcbaa0b](https://github.com/jxsuite/jx/commit/fcbaa0bc7679727cc20caf50e86ac10cf6aca911))
* **studio:** the icon I deleted, the two I never fixed, and the checker that approved all three ([4747bff](https://github.com/jxsuite/jx/commit/4747bff6c22a92e7356090ea52c3039a218f4967))
* **studio:** the update prompt asks the registry, not this build's version number ([05b28e0](https://github.com/jxsuite/jx/commit/05b28e073c34475367e204c9079aadf2f002569c))


### Reverts

* **studio:** stop reporting Trusted Types violations nobody can act on ([6bab956](https://github.com/jxsuite/jx/commit/6bab956c0142b9bd1935a4d6da70f96fc01e8ccd))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.7.0
    * @jxsuite/compiler bumped to 2.0.0
    * @jxsuite/create bumped to 1.3.0
    * @jxsuite/import bumped to 0.39.0
    * @jxsuite/protocol bumped to 1.1.0
    * @jxsuite/runtime bumped to 2.0.0
    * @jxsuite/schema bumped to 1.6.0
    * @jxsuite/starters bumped to 1.3.0
  * devDependencies
    * @jxsuite/auth bumped to 0.5.0
    * @jxsuite/connector bumped to 0.5.0
    * @jxsuite/parser bumped to 1.5.0

## [2.0.0](https://github.com/jxsuite/jx/compare/server-v1.3.0...server-v2.0.0) (2026-07-30)


### ⚠ BREAKING CHANGES

* **studio:** `StudioPlatform` implementations must declare `createDestination` and honor `createProject`'s `destination`. `POST /__studio/create-project` rejects a request without one, and returns an absolute `root` for projects created outside the server root.

### Features

* **studio:** require a user-chosen destination for new projects ([0046d68](https://github.com/jxsuite/jx/commit/0046d68c4268489fadef9c9f37f414889fd88f4f))
* **studio:** upload and drop media from every editing surface ([3a58962](https://github.com/jxsuite/jx/commit/3a58962bf5225b31ec2476cba7c91f9d6a6231eb))


### Bug Fixes

* **desktop,studio,server,collab:** typecheck the desktop package, and hold the coverage gates ([f1e40e5](https://github.com/jxsuite/jx/commit/f1e40e5c813d4f7ec508859faddb4faef76e2c03))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **server:** let Studio open a project it does not already contain ([4b69a74](https://github.com/jxsuite/jx/commit/4b69a7434b184c28c4ec3787bdbb4a6909222102))
* **studio,server,desktop:** dev server bypassed the build; Monaco still loaded at startup ([0b98da6](https://github.com/jxsuite/jx/commit/0b98da64aa34e49d2c18276359f50c119706f9c1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.6.0
    * @jxsuite/compiler bumped to 1.5.0
    * @jxsuite/create bumped to 1.2.2
    * @jxsuite/import bumped to 0.38.2
    * @jxsuite/protocol bumped to 1.0.0
    * @jxsuite/runtime bumped to 1.3.2
    * @jxsuite/schema bumped to 1.5.0
    * @jxsuite/starters bumped to 1.2.2
  * devDependencies
    * @jxsuite/auth bumped to 0.4.2
    * @jxsuite/connector bumped to 0.4.2
    * @jxsuite/parser bumped to 1.4.1

## [1.3.0](https://github.com/jxsuite/jx/compare/server-v1.2.0...server-v1.3.0) (2026-07-24)


### Features

* support external/relative asset files ([7cbe138](https://github.com/jxsuite/jx/commit/7cbe138a1f2ecaa77599ca7112162b526e7bd5bc))


### Bug Fixes

* **server:** resolve the oxlint binary robustly for the lint endpoint ([61387b4](https://github.com/jxsuite/jx/commit/61387b41f1b0408ab0f47e3f0183eb0907c67538))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.5.1
    * @jxsuite/compiler bumped to 1.4.0
    * @jxsuite/create bumped to 1.2.1
    * @jxsuite/import bumped to 0.38.1
    * @jxsuite/protocol bumped to 0.6.1
    * @jxsuite/runtime bumped to 1.3.1
    * @jxsuite/schema bumped to 1.4.0
    * @jxsuite/starters bumped to 1.2.1
  * devDependencies
    * @jxsuite/auth bumped to 0.4.1
    * @jxsuite/connector bumped to 0.4.1
    * @jxsuite/parser bumped to 1.4.0

## [1.2.0](https://github.com/jxsuite/jx/compare/server-v1.1.1...server-v1.2.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Bug Fixes

* harden dev server and unify runtime/compiler evaluation ([775c393](https://github.com/jxsuite/jx/commit/775c393b5010a304c2a5bf6759b2dfc5ca3bcc80))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.5.0
    * @jxsuite/compiler bumped to 1.3.0
    * @jxsuite/create bumped to 1.2.0
    * @jxsuite/import bumped to 0.38.0
    * @jxsuite/protocol bumped to 0.6.0
    * @jxsuite/runtime bumped to 1.3.0
    * @jxsuite/schema bumped to 1.3.0
    * @jxsuite/starters bumped to 1.2.0
  * devDependencies
    * @jxsuite/auth bumped to 0.4.0
    * @jxsuite/connector bumped to 0.4.0
    * @jxsuite/parser bumped to 1.3.0

## [1.1.1](https://github.com/jxsuite/jx/compare/server-v1.1.0...server-v1.1.1) (2026-07-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.4.1
    * @jxsuite/compiler bumped to 1.2.0
    * @jxsuite/create bumped to 1.1.1
    * @jxsuite/import bumped to 0.37.1
    * @jxsuite/protocol bumped to 0.5.1
    * @jxsuite/runtime bumped to 1.2.0
    * @jxsuite/schema bumped to 1.2.0
    * @jxsuite/starters bumped to 1.1.1
  * devDependencies
    * @jxsuite/auth bumped to 0.3.1
    * @jxsuite/connector bumped to 0.3.1
    * @jxsuite/parser bumped to 1.2.0

## [1.1.0](https://github.com/jxsuite/jx/compare/server-v1.0.0...server-v1.1.0) (2026-07-17)


### Features

* **compiler,server,create:** jx dev and jx preview — the scaffolded scripts now work ([94c9c15](https://github.com/jxsuite/jx/commit/94c9c156a4ad5d65c2282502212fbd3c22e6130a))
* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/collab bumped to 0.4.0
    * @jxsuite/compiler bumped to 1.1.0
    * @jxsuite/create bumped to 1.1.0
    * @jxsuite/import bumped to 0.37.0
    * @jxsuite/protocol bumped to 0.5.0
    * @jxsuite/runtime bumped to 1.1.0
    * @jxsuite/schema bumped to 1.1.0
    * @jxsuite/starters bumped to 1.1.0
  * devDependencies
    * @jxsuite/auth bumped to 0.3.0
    * @jxsuite/connector bumped to 0.3.0
    * @jxsuite/parser bumped to 1.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/server-v0.37.1...server-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- hosts switch to the extension model; migrate all projects to content sections

### Features

- **auth:** Better Auth extension — sessions, permissions, auth-gated data ([32c871e](https://github.com/jxsuite/jx/commit/32c871e9fe48fdeed62e030354cc05adbf6efd19))
- **connector:** dynamic data tables extension — Kysely core, /_jx/data mount, db push ([65e0d35](https://github.com/jxsuite/jx/commit/65e0d35bf99924b2cd7aa548d02e29e8441ba6ed))
- hosts switch to the extension model; migrate all projects to content sections ([b2c0e27](https://github.com/jxsuite/jx/commit/b2c0e27c08e649af334fdf67ccf6abbb73c480dc))
- **studio:** data console — connections, schema push, secrets, data grid ([de02861](https://github.com/jxsuite/jx/commit/de02861a03c94460f0d332ac909438decbd4fd9d))
- **studio:** descriptor-contributed settings + fetched project schemas ([b85afaf](https://github.com/jxsuite/jx/commit/b85afaf9f6d340e1d916ad399fc758df36ced2e1))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/collab bumped to 0.3.0
    - @jxsuite/compiler bumped to 1.0.0
    - @jxsuite/create bumped to 1.0.0
    - @jxsuite/import bumped to 0.36.0
    - @jxsuite/protocol bumped to 0.4.0
    - @jxsuite/runtime bumped to 1.0.0
    - @jxsuite/schema bumped to 1.0.0
    - @jxsuite/starters bumped to 1.0.0
  - devDependencies
    - @jxsuite/auth bumped to 0.2.0
    - @jxsuite/connector bumped to 0.2.0
    - @jxsuite/parser bumped to 1.0.0

## [0.37.1](https://github.com/jxsuite/jx/compare/server-v0.37.0...server-v0.37.1) (2026-07-08)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/collab bumped to 0.2.1

## [0.37.0](https://github.com/jxsuite/jx/compare/server-v0.36.0...server-v0.37.0) (2026-07-08)

### Features

- **collab:** the wire — ws client/room core, devserver endpoint, adapter members ([dc53b5d](https://github.com/jxsuite/jx/commit/dc53b5dcf24069ca6bc30051e330c8ccdcda0fe6))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/collab bumped to 0.2.0

## [0.36.0](https://github.com/jxsuite/jx/compare/server-v0.35.0...server-v0.36.0) (2026-07-07)

### Features

- **studio:** AI managed mode — unlock the assistant from proxy state ([077cd1d](https://github.com/jxsuite/jx/commit/077cd1d63e3bd048b6520c2f3a897e0408198e9d))
- **studio:** one-click Cloudflare Pages publish surface ([9eebc15](https://github.com/jxsuite/jx/commit/9eebc154a0d77a0f347d0efd47bed3b9a643e89c))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/compiler bumped to 0.35.0
    - @jxsuite/create bumped to 0.36.0
    - @jxsuite/import bumped to 0.35.1
    - @jxsuite/parser bumped to 0.35.1
    - @jxsuite/runtime bumped to 0.34.2
    - @jxsuite/schema bumped to 0.35.0
    - @jxsuite/starters bumped to 0.35.1

## [0.35.0](https://github.com/jxsuite/jx/compare/server-v0.34.0...server-v0.35.0) (2026-07-06)

### Features

- site import package, ui + starter templates & wizard ([700e432](https://github.com/jxsuite/jx/commit/700e432faeb6c30ef2b1859b0a12fa00457ff508))
- **starters:** init starter sites ([be19be6](https://github.com/jxsuite/jx/commit/be19be613e365ad26e804f99ecce95032d2419fc))

### Bug Fixes

- **studio:** proper handling of relative component references ([6d99771](https://github.com/jxsuite/jx/commit/6d99771eed1e2a87518cbf90e3700305056f3666))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/compiler bumped to 0.34.1
    - @jxsuite/create bumped to 0.35.0
    - @jxsuite/import bumped to 0.35.0
    - @jxsuite/parser bumped to 0.35.0
    - @jxsuite/runtime bumped to 0.34.1
    - @jxsuite/starters bumped to 0.35.0
