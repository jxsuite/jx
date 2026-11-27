# Changelog

## [10.1.0](https://github.com/jxsuite/jx/compare/desktop-v10.0.0...desktop-v10.1.0) (2026-11-27)


### Features

* **desktop:** keep Git for HTTPS remotes only in the Mac App Store build ([#764](https://github.com/jxsuite/jx/issues/764)) ([bb4c3a3](https://github.com/jxsuite/jx/commit/bb4c3a3306cd1bbff9a98377398f067ef8fa2823))
* **desktop:** lock the user stores across processes ([#766](https://github.com/jxsuite/jx/issues/766)) ([d71ec08](https://github.com/jxsuite/jx/commit/d71ec0867cbc165adfb3304efca2ddac7c5ce37b))
* **desktop:** record the Mac App Store build's export compliance from a variable ([#744](https://github.com/jxsuite/jx/issues/744)) ([8b4a45e](https://github.com/jxsuite/jx/commit/8b4a45e355727d5811f2e11d408ebd510f3c8433))
* **desktop:** the backend formats and lints function bodies in its own process ([#774](https://github.com/jxsuite/jx/issues/774)) ([21da4b4](https://github.com/jxsuite/jx/commit/21da4b4a9957e5340c597bc60d108da437c91d11))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 11.2.0
    * @jxsuite/create bumped to 1.8.9
    * @jxsuite/protocol bumped to 7.1.0
    * @jxsuite/schema bumped to 8.3.0
    * @jxsuite/server bumped to 9.4.0
    * @jxsuite/starters bumped to 5.2.2
    * @jxsuite/studio bumped to 14.1.0
  * devDependencies
    * @jxsuite/server bumped to 9.4.0
    * @jxsuite/ui bumped to 0.17.0

## [10.0.0](https://github.com/jxsuite/jx/compare/desktop-v9.5.0...desktop-v10.0.0) (2026-11-23)


### ⚠ BREAKING CHANGES

* **studio,desktop:** retire the resync reasons; every reconnect is a subscribe with sinceRev ([#739](https://github.com/jxsuite/jx/issues/739))

### Features

* **studio,desktop:** retire the resync reasons; every reconnect is a subscribe with sinceRev ([#739](https://github.com/jxsuite/jx/issues/739)) ([8d87e68](https://github.com/jxsuite/jx/commit/8d87e68c9fc551d22763ff7aaa9ab18868771970))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 11.1.2
    * @jxsuite/create bumped to 1.8.8
    * @jxsuite/protocol bumped to 7.0.0
    * @jxsuite/schema bumped to 8.2.1
    * @jxsuite/server bumped to 9.3.1
    * @jxsuite/starters bumped to 5.2.1
    * @jxsuite/studio bumped to 14.0.0
  * devDependencies
    * @jxsuite/server bumped to 9.3.1
    * @jxsuite/ui bumped to 0.16.1

## [9.5.0](https://github.com/jxsuite/jx/compare/desktop-v9.4.1...desktop-v9.5.0) (2026-11-23)


### Features

* **desktop:** project-state host serves the desktop session ([#727](https://github.com/jxsuite/jx/issues/727)) ([fb12d93](https://github.com/jxsuite/jx/commit/fb12d9371e0a1245594480b9c1f185393b87a122))
* **server:** a rename is one operation that completes or rolls back ([#731](https://github.com/jxsuite/jx/issues/731)) ([5fb6a0a](https://github.com/jxsuite/jx/commit/5fb6a0a35b6e91fd98641c261e9084e78f25400f))
* **server:** the dev server serves project state and keys collab rooms by document ([#728](https://github.com/jxsuite/jx/issues/728)) ([bf16222](https://github.com/jxsuite/jx/commit/bf162221a5b26a169ab36a6fc378b9bd974c85df))
* **studio:** convert a whole project between .json and .jxn from Project settings ([#717](https://github.com/jxsuite/jx/issues/717)) ([8d25ea7](https://github.com/jxsuite/jx/commit/8d25ea780feca9cc8623c1741037de20b735035c))
* **studio:** one content store keyed by document and hash, with buffers held against a base ([#729](https://github.com/jxsuite/jx/issues/729)) ([0db299c](https://github.com/jxsuite/jx/commit/0db299cdcb24c3ee3a490b10039a5fc28560be72))


### Bug Fixes

* **desktop:** skip What's New where Apple refuses it ([#712](https://github.com/jxsuite/jx/issues/712)) ([e4d7d94](https://github.com/jxsuite/jx/commit/e4d7d9405eb74fbfde7ba0c45c42e68d96083802))
* **studio,desktop,server,runtime:** project state stays current after open, install and edits ([#721](https://github.com/jxsuite/jx/issues/721)) ([b096332](https://github.com/jxsuite/jx/commit/b09633266ab45d19abd3c722bcfa43ee1b97b1e3))
* **studio,desktop:** report a missing recent project, and open no blank Untitled tab ([#713](https://github.com/jxsuite/jx/issues/713)) ([1d825c2](https://github.com/jxsuite/jx/commit/1d825c22dbadf437130ddf61676de4a4d2ef5f29))
* **studio:** Convert to Component wraps the selection instead of replacing its root ([#720](https://github.com/jxsuite/jx/issues/720)) ([0589a29](https://github.com/jxsuite/jx/commit/0589a2979df4b3091b9bc1ffed75fc8845566fb0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 11.1.1
    * @jxsuite/create bumped to 1.8.7
    * @jxsuite/protocol bumped to 6.7.0
    * @jxsuite/schema bumped to 8.2.0
    * @jxsuite/server bumped to 9.3.0
    * @jxsuite/starters bumped to 5.2.0
    * @jxsuite/studio bumped to 13.2.0
  * devDependencies
    * @jxsuite/server bumped to 9.3.0
    * @jxsuite/ui bumped to 0.16.0

## [9.4.1](https://github.com/jxsuite/jx/compare/desktop-v9.4.0...desktop-v9.4.1) (2026-11-17)


### Bug Fixes

* **desktop:** stop declaring export compliance in the app ([#702](https://github.com/jxsuite/jx/issues/702)) ([8229b25](https://github.com/jxsuite/jx/commit/8229b255468ceeb72c3f05fca3f4b27ca3f7955d))

## [9.4.0](https://github.com/jxsuite/jx/compare/desktop-v9.3.2...desktop-v9.4.0) (2026-11-17)


### Features

* **desktop:** declare the Mac App Store build's export compliance in the app ([9158522](https://github.com/jxsuite/jx/commit/91585227d5b98bdca093af1f02611a7e8192d9e7))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 11.1.0
    * @jxsuite/create bumped to 1.8.6
    * @jxsuite/protocol bumped to 6.6.1
    * @jxsuite/schema bumped to 8.1.0
    * @jxsuite/server bumped to 9.2.1
    * @jxsuite/starters bumped to 5.1.0
    * @jxsuite/studio bumped to 13.1.0
  * devDependencies
    * @jxsuite/server bumped to 9.2.1
    * @jxsuite/ui bumped to 0.15.0

## [9.3.2](https://github.com/jxsuite/jx/compare/desktop-v9.3.1...desktop-v9.3.2) (2026-11-15)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 11.0.0
    * @jxsuite/create bumped to 1.8.5
    * @jxsuite/protocol bumped to 6.6.0
    * @jxsuite/schema bumped to 8.0.0
    * @jxsuite/server bumped to 9.2.0
    * @jxsuite/starters bumped to 5.0.0
    * @jxsuite/studio bumped to 13.0.0
  * devDependencies
    * @jxsuite/server bumped to 9.2.0
    * @jxsuite/ui bumped to 0.14.0

## [9.3.1](https://github.com/jxsuite/jx/compare/desktop-v9.3.0...desktop-v9.3.1) (2026-11-15)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 10.0.0
    * @jxsuite/create bumped to 1.8.4
    * @jxsuite/protocol bumped to 6.5.0
    * @jxsuite/schema bumped to 7.0.0
    * @jxsuite/server bumped to 9.1.0
    * @jxsuite/starters bumped to 4.0.0
    * @jxsuite/studio bumped to 12.0.0
  * devDependencies
    * @jxsuite/server bumped to 9.1.0
    * @jxsuite/ui bumped to 0.13.0

## [9.3.0](https://github.com/jxsuite/jx/compare/desktop-v9.2.0...desktop-v9.3.0) (2026-11-14)


### Features

* **desktop:** submit the Mac App Store build to App Review from CI ([4239514](https://github.com/jxsuite/jx/commit/42395147cdcf382769576bb65cb3d680c39730b4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 9.1.0
    * @jxsuite/create bumped to 1.8.3
    * @jxsuite/protocol bumped to 6.4.2
    * @jxsuite/schema bumped to 6.0.2
    * @jxsuite/server bumped to 9.0.3
    * @jxsuite/starters bumped to 3.7.1
    * @jxsuite/studio bumped to 11.1.0
  * devDependencies
    * @jxsuite/server bumped to 9.0.3
    * @jxsuite/ui bumped to 0.12.2

## [9.2.0](https://github.com/jxsuite/jx/compare/desktop-v9.1.0...desktop-v9.2.0) (2026-11-14)


### Features

* **desktop:** submit the Mac App Store build to App Review from CI ([4239514](https://github.com/jxsuite/jx/commit/42395147cdcf382769576bb65cb3d680c39730b4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 9.0.1
    * @jxsuite/server bumped to 9.0.2
  * devDependencies
    * @jxsuite/server bumped to 9.0.2

## [9.1.0](https://github.com/jxsuite/jx/compare/desktop-v9.0.1...desktop-v9.1.0) (2026-11-13)


### Features

* **desktop:** the compiler's native addon is staged beside the backend bundle ([d895662](https://github.com/jxsuite/jx/commit/d89566238364be7d69357068eddd5d4602a218ee))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 9.0.0
    * @jxsuite/create bumped to 1.8.2
    * @jxsuite/protocol bumped to 6.4.1
    * @jxsuite/schema bumped to 6.0.1
    * @jxsuite/server bumped to 9.0.1
    * @jxsuite/starters bumped to 3.7.0
    * @jxsuite/studio bumped to 11.0.2
  * devDependencies
    * @jxsuite/server bumped to 9.0.1
    * @jxsuite/ui bumped to 0.12.1

## [9.0.1](https://github.com/jxsuite/jx/compare/desktop-v9.0.0...desktop-v9.0.1) (2026-11-13)


### Bug Fixes

* **desktop:** add sharp's RPATH with patchelfUnstable so the Nix build loads it ([#656](https://github.com/jxsuite/jx/issues/656)) ([8992d82](https://github.com/jxsuite/jx/commit/8992d82d88a31fb0e13b1fe6f170455d91080a4d))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/studio bumped to 11.0.1

## [9.0.0](https://github.com/jxsuite/jx/compare/desktop-v8.3.1...desktop-v9.0.0) (2026-11-12)


### ⚠ BREAKING CHANGES

* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652))

### Features

* **erase,runtime,server,site:** a document's script runs in every interpreting host ([#627](https://github.com/jxsuite/jx/issues/627)) ([97f3bf0](https://github.com/jxsuite/jx/commit/97f3bf03a34e4e0a7b25b71900ba3d73d58e820d))
* **studio:** Preview is removed; Edit draws live data and Open in Browser runs the page ([#652](https://github.com/jxsuite/jx/issues/652)) ([d0d9316](https://github.com/jxsuite/jx/commit/d0d9316aa6c7c3652122bf0c8fef1967b4bc2258))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.7.0
    * @jxsuite/create bumped to 1.8.1
    * @jxsuite/protocol bumped to 6.4.0
    * @jxsuite/schema bumped to 6.0.0
    * @jxsuite/server bumped to 9.0.0
    * @jxsuite/starters bumped to 3.6.0
    * @jxsuite/studio bumped to 11.0.0
  * devDependencies
    * @jxsuite/server bumped to 9.0.0
    * @jxsuite/ui bumped to 0.12.0

## [8.3.1](https://github.com/jxsuite/jx/compare/desktop-v8.3.0...desktop-v8.3.1) (2026-11-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.6.0
    * @jxsuite/create bumped to 1.8.0
    * @jxsuite/protocol bumped to 6.3.0
    * @jxsuite/schema bumped to 5.6.0
    * @jxsuite/server bumped to 8.7.0
    * @jxsuite/starters bumped to 3.5.0
    * @jxsuite/studio bumped to 10.9.0
  * devDependencies
    * @jxsuite/server bumped to 8.7.0
    * @jxsuite/ui bumped to 0.11.0

## [8.3.0](https://github.com/jxsuite/jx/compare/desktop-v8.2.0...desktop-v8.3.0) (2026-11-08)


### Features

* erase TypeScript from function bodies as each document is read ([#576](https://github.com/jxsuite/jx/issues/576)) ([f9ccf78](https://github.com/jxsuite/jx/commit/f9ccf78cd9a7a0057c4aedf600a8e20635b3c237))
* provision every new project with project.jxn ([#578](https://github.com/jxsuite/jx/issues/578)) ([690ba96](https://github.com/jxsuite/jx/commit/690ba96a990136bafe34730223c1b478d3a52c6c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.5.0
    * @jxsuite/create bumped to 1.7.0
    * @jxsuite/protocol bumped to 6.2.5
    * @jxsuite/schema bumped to 5.5.0
    * @jxsuite/server bumped to 8.6.0
    * @jxsuite/starters bumped to 3.4.0
    * @jxsuite/studio bumped to 10.8.0
  * devDependencies
    * @jxsuite/server bumped to 8.6.0
    * @jxsuite/ui bumped to 0.10.4

## [8.2.0](https://github.com/jxsuite/jx/compare/desktop-v8.1.0...desktop-v8.2.0) (2026-11-08)


### Features

* **desktop:** declare .jxn on every channel that can register a file type ([#570](https://github.com/jxsuite/jx/issues/570)) ([2b19f27](https://github.com/jxsuite/jx/commit/2b19f278c90857d4684c407a102a756f54468665))
* **schema:** read and write a project file in Jx Notation ([#560](https://github.com/jxsuite/jx/issues/560)) ([66d6cc5](https://github.com/jxsuite/jx/commit/66d6cc5b2837bc4a4529905aa90d3dea58f4e846))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.4.0
    * @jxsuite/create bumped to 1.6.0
    * @jxsuite/protocol bumped to 6.2.4
    * @jxsuite/schema bumped to 5.4.0
    * @jxsuite/server bumped to 8.5.0
    * @jxsuite/starters bumped to 3.3.2
    * @jxsuite/studio bumped to 10.7.0
  * devDependencies
    * @jxsuite/server bumped to 8.5.0
    * @jxsuite/ui bumped to 0.10.3

## [8.1.0](https://github.com/jxsuite/jx/compare/desktop-v8.0.5...desktop-v8.1.0) (2026-11-07)


### Features

* **desktop:** open what the OS hands over, after asking to run a folder's code ([#549](https://github.com/jxsuite/jx/issues/549)) ([7aa3f08](https://github.com/jxsuite/jx/commit/7aa3f08a14b663886949d9dea2ff9227832bcae6))
* every host reads Jx Notation ([#554](https://github.com/jxsuite/jx/issues/554)) ([1305161](https://github.com/jxsuite/jx/commit/13051615b376e077d86875153a9aeacc127c5f76))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.3.0
    * @jxsuite/create bumped to 1.5.5
    * @jxsuite/protocol bumped to 6.2.3
    * @jxsuite/schema bumped to 5.3.0
    * @jxsuite/server bumped to 8.4.0
    * @jxsuite/starters bumped to 3.3.1
    * @jxsuite/studio bumped to 10.6.0
  * devDependencies
    * @jxsuite/server bumped to 8.4.0
    * @jxsuite/ui bumped to 0.10.2

## [8.0.5](https://github.com/jxsuite/jx/compare/desktop-v8.0.4...desktop-v8.0.5) (2026-11-06)


### Bug Fixes

* **desktop,server:** keep git paths and commits inside a nested project ([#540](https://github.com/jxsuite/jx/issues/540)) ([5a11efc](https://github.com/jxsuite/jx/commit/5a11efcf7772dc71a82a3c2974418a170dc9876e))
* **desktop:** stop taking over .json on install ([#547](https://github.com/jxsuite/jx/issues/547)) ([5addb19](https://github.com/jxsuite/jx/commit/5addb19cefb6acd9308b3ca7b482521d84baba2a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.2.0
    * @jxsuite/create bumped to 1.5.4
    * @jxsuite/protocol bumped to 6.2.2
    * @jxsuite/schema bumped to 5.2.0
    * @jxsuite/server bumped to 8.3.0
    * @jxsuite/starters bumped to 3.3.0
    * @jxsuite/studio bumped to 10.5.0
  * devDependencies
    * @jxsuite/server bumped to 8.3.0
    * @jxsuite/ui bumped to 0.10.1

## [8.0.4](https://github.com/jxsuite/jx/compare/desktop-v8.0.3...desktop-v8.0.4) (2026-11-04)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.1.0
    * @jxsuite/create bumped to 1.5.3
    * @jxsuite/protocol bumped to 6.2.1
    * @jxsuite/schema bumped to 5.1.0
    * @jxsuite/server bumped to 8.2.1
    * @jxsuite/starters bumped to 3.2.0
    * @jxsuite/studio bumped to 10.4.0
  * devDependencies
    * @jxsuite/server bumped to 8.2.1
    * @jxsuite/ui bumped to 0.10.0

## [8.0.3](https://github.com/jxsuite/jx/compare/desktop-v8.0.2...desktop-v8.0.3) (2026-11-04)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/server bumped to 8.2.0
    * @jxsuite/studio bumped to 10.3.0
  * devDependencies
    * @jxsuite/server bumped to 8.2.0
    * @jxsuite/ui bumped to 0.9.0

## [8.0.2](https://github.com/jxsuite/jx/compare/desktop-v8.0.1...desktop-v8.0.2) (2026-11-03)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.0.2
    * @jxsuite/create bumped to 1.5.2
    * @jxsuite/protocol bumped to 6.2.0
    * @jxsuite/server bumped to 8.1.0
    * @jxsuite/starters bumped to 3.1.4
    * @jxsuite/studio bumped to 10.2.0
  * devDependencies
    * @jxsuite/server bumped to 8.1.0

## [8.0.1](https://github.com/jxsuite/jx/compare/desktop-v8.0.0...desktop-v8.0.1) (2026-10-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.0.1
    * @jxsuite/create bumped to 1.5.1
    * @jxsuite/protocol bumped to 6.1.0
    * @jxsuite/server bumped to 8.0.1
    * @jxsuite/starters bumped to 3.1.3
    * @jxsuite/studio bumped to 10.1.0
  * devDependencies
    * @jxsuite/server bumped to 8.0.1

## [8.0.0](https://github.com/jxsuite/jx/compare/desktop-v7.0.0...desktop-v8.0.0) (2026-10-29)


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
* **desktop:** keep the Nix build's Electron bundle flat so jx-studio starts ([#508](https://github.com/jxsuite/jx/issues/508)) ([91094c1](https://github.com/jxsuite/jx/commit/91094c1c453b8ab1670b90a34afa88001cc8a5be))
* **desktop:** promise the Linux x64 AppImage under the name electron-builder gives it ([#512](https://github.com/jxsuite/jx/issues/512)) ([5b6b47d](https://github.com/jxsuite/jx/commit/5b6b47dd3bb3ba4d4d855f31e8c6a790fe7fac4e))
* **desktop:** ship the backend's node_modules, and smoke-test the packaged app honestly ([#506](https://github.com/jxsuite/jx/issues/506)) ([9118317](https://github.com/jxsuite/jx/commit/91183172999983fb8d5e663432dc15da6ca5394d))
* extensions resolve from the project only, first-party ones included ([#510](https://github.com/jxsuite/jx/issues/510)) ([ac70362](https://github.com/jxsuite/jx/commit/ac703627bd5c9d6874cf511049be3425904c9527))
* the release PR's smoke test installs this checkout, and npm can no longer hang a build ([#515](https://github.com/jxsuite/jx/issues/515)) ([66208f7](https://github.com/jxsuite/jx/commit/66208f7e27eab9535537d1de63a8bb8e897a04d8))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 8.0.0
    * @jxsuite/create bumped to 1.5.0
    * @jxsuite/protocol bumped to 6.0.0
    * @jxsuite/schema bumped to 5.0.0
    * @jxsuite/server bumped to 8.0.0
    * @jxsuite/starters bumped to 3.1.2
    * @jxsuite/studio bumped to 10.0.0
  * devDependencies
    * @jxsuite/server bumped to 8.0.0
    * @jxsuite/ui bumped to 0.8.2

## [7.0.0](https://github.com/jxsuite/jx/compare/desktop-v6.1.0...desktop-v7.0.0) (2026-10-27)


### ⚠ BREAKING CHANGES

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498))

### Features

* **compiler:** built pages call their server entries; page-level entries are served ([#498](https://github.com/jxsuite/jx/issues/498)) ([c755088](https://github.com/jxsuite/jx/commit/c75508844232af963a346901ad782249419de3f0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/auth bumped to 0.8.1
    * @jxsuite/compiler bumped to 7.0.0
    * @jxsuite/connector bumped to 0.8.1
    * @jxsuite/create bumped to 1.4.1
    * @jxsuite/feed bumped to 0.4.3
    * @jxsuite/parser bumped to 4.1.1
    * @jxsuite/protocol bumped to 5.0.0
    * @jxsuite/schema bumped to 4.1.0
    * @jxsuite/search bumped to 0.4.2
    * @jxsuite/server bumped to 7.0.0
    * @jxsuite/starters bumped to 3.1.1
    * @jxsuite/studio bumped to 9.0.0
  * devDependencies
    * @jxsuite/server bumped to 7.0.0
    * @jxsuite/ui bumped to 0.8.1

## [6.1.0](https://github.com/jxsuite/jx/compare/desktop-v6.0.1...desktop-v6.1.0) (2026-10-23)


### Features

* **desktop:** Mac App Store channel (mas target, sandbox entitlements, TestFlight lane) ([#475](https://github.com/jxsuite/jx/issues/475)) ([2aab641](https://github.com/jxsuite/jx/commit/2aab641f73e817c72c2689e87c3c481ed2b266a9))


### Bug Fixes

* **desktop:** sandboxed Mac App Store build opens the folders the user picks ([#481](https://github.com/jxsuite/jx/issues/481)) ([8a52af8](https://github.com/jxsuite/jx/commit/8a52af8369010e30ec8bcaeb8a8503ad401d2e41))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/auth bumped to 0.8.0
    * @jxsuite/compiler bumped to 6.1.0
    * @jxsuite/connector bumped to 0.8.0
    * @jxsuite/create bumped to 1.4.0
    * @jxsuite/parser bumped to 4.1.0
    * @jxsuite/server bumped to 6.1.0
    * @jxsuite/starters bumped to 3.1.0
    * @jxsuite/studio bumped to 8.1.0
  * devDependencies
    * @jxsuite/server bumped to 6.1.0
    * @jxsuite/ui bumped to 0.8.0

## [6.0.1](https://github.com/jxsuite/jx/compare/desktop-v6.0.0...desktop-v6.0.1) (2026-10-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/auth bumped to 0.7.0
    * @jxsuite/compiler bumped to 6.0.2
    * @jxsuite/connector bumped to 0.7.0
    * @jxsuite/create bumped to 1.3.17
    * @jxsuite/parser bumped to 4.0.1
    * @jxsuite/server bumped to 6.0.1
    * @jxsuite/starters bumped to 3.0.1
    * @jxsuite/studio bumped to 8.0.1
  * devDependencies
    * @jxsuite/server bumped to 6.0.1
    * @jxsuite/ui bumped to 0.7.1

## [6.0.0](https://github.com/jxsuite/jx/compare/desktop-v5.4.8...desktop-v6.0.0) (2026-10-21)


### ⚠ BREAKING CHANGES

* **desktop:** installed Electrobun builds cannot update into this app; reinstall once.

### Features

* **desktop:** replace Electrobun with Electron, packaged with electron-builder ([#465](https://github.com/jxsuite/jx/issues/465)) ([1cd8130](https://github.com/jxsuite/jx/commit/1cd813071e3487cb6640f7f0aa92ec9295b53a9c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 6.0.1
    * @jxsuite/create bumped to 1.3.16
    * @jxsuite/parser bumped to 4.0.0
    * @jxsuite/protocol bumped to 4.0.0
    * @jxsuite/server bumped to 6.0.0
    * @jxsuite/starters bumped to 3.0.0
    * @jxsuite/studio bumped to 8.0.0
  * devDependencies
    * @jxsuite/server bumped to 6.0.0
    * @jxsuite/ui bumped to 0.7.0

## [5.4.8](https://github.com/jxsuite/jx/compare/desktop-v5.4.7...desktop-v5.4.8) (2026-10-17)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/auth bumped to 0.6.3
    * @jxsuite/compiler bumped to 6.0.0
    * @jxsuite/connector bumped to 0.6.3
    * @jxsuite/create bumped to 1.3.15
    * @jxsuite/feed bumped to 0.4.2
    * @jxsuite/parser bumped to 3.0.0
    * @jxsuite/protocol bumped to 3.0.0
    * @jxsuite/schema bumped to 4.0.0
    * @jxsuite/search bumped to 0.4.1
    * @jxsuite/server bumped to 5.0.0
    * @jxsuite/starters bumped to 2.0.2
    * @jxsuite/studio bumped to 7.0.0
  * devDependencies
    * @jxsuite/server bumped to 5.0.0
    * @jxsuite/ui bumped to 0.6.0

## [5.4.7](https://github.com/jxsuite/jx/compare/desktop-v5.4.6...desktop-v5.4.7) (2026-10-16)


### Bug Fixes

* **desktop:** externalize the Astro compiler the oxfmt bump made a static import ([#458](https://github.com/jxsuite/jx/issues/458)) ([5f891ed](https://github.com/jxsuite/jx/commit/5f891ed1e776caf9f19cc18d7ec4b3ac1f0d8470))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.3
    * @jxsuite/server bumped to 4.5.1
    * @jxsuite/studio bumped to 6.1.2
  * devDependencies
    * @jxsuite/server bumped to 4.5.1

## [5.4.6](https://github.com/jxsuite/jx/compare/desktop-v5.4.5...desktop-v5.4.6) (2026-10-11)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.2
    * @jxsuite/create bumped to 1.3.14
    * @jxsuite/parser bumped to 2.0.1
    * @jxsuite/server bumped to 4.5.0
    * @jxsuite/starters bumped to 2.0.1
    * @jxsuite/studio bumped to 6.1.1
  * devDependencies
    * @jxsuite/server bumped to 4.5.0
    * @jxsuite/ui bumped to 0.5.1

## [5.4.5](https://github.com/jxsuite/jx/compare/desktop-v5.4.4...desktop-v5.4.5) (2026-10-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.1
    * @jxsuite/server bumped to 4.4.5
  * devDependencies
    * @jxsuite/server bumped to 4.4.5

## [5.4.4](https://github.com/jxsuite/jx/compare/desktop-v5.4.3...desktop-v5.4.4) (2026-10-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 5.1.0
    * @jxsuite/feed bumped to 0.4.1
    * @jxsuite/server bumped to 4.4.4
  * devDependencies
    * @jxsuite/server bumped to 4.4.4

## [5.4.3](https://github.com/jxsuite/jx/compare/desktop-v5.4.2...desktop-v5.4.3) (2026-10-07)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/studio bumped to 6.1.0
  * devDependencies
    * @jxsuite/ui bumped to 0.5.0

## [5.4.2](https://github.com/jxsuite/jx/compare/desktop-v5.4.1...desktop-v5.4.2) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/auth bumped to 0.6.2
    * @jxsuite/compiler bumped to 5.0.0
    * @jxsuite/connector bumped to 0.6.2
    * @jxsuite/create bumped to 1.3.13
    * @jxsuite/feed bumped to 0.4.0
    * @jxsuite/parser bumped to 2.0.0
    * @jxsuite/protocol bumped to 2.6.1
    * @jxsuite/schema bumped to 3.0.0
    * @jxsuite/search bumped to 0.4.0
    * @jxsuite/server bumped to 4.4.3
    * @jxsuite/starters bumped to 2.0.0
    * @jxsuite/studio bumped to 6.0.0
  * devDependencies
    * @jxsuite/server bumped to 4.4.3
    * @jxsuite/ui bumped to 0.4.1

## [5.4.1](https://github.com/jxsuite/jx/compare/desktop-v5.4.0...desktop-v5.4.1) (2026-10-06)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 4.0.3
    * @jxsuite/server bumped to 4.4.2
    * @jxsuite/studio bumped to 5.7.0
  * devDependencies
    * @jxsuite/server bumped to 4.4.2

## [5.4.0](https://github.com/jxsuite/jx/compare/desktop-v5.3.0...desktop-v5.4.0) (2026-10-03)


### Features

* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([88eb919](https://github.com/jxsuite/jx/commit/88eb919810d7ab7fc1c8f479769e0f1fa6e2fe0c))
* **studio:** jittered reconnect, wake on network or focus, and resync what a dropped socket missed ([de3512b](https://github.com/jxsuite/jx/commit/de3512bea3ec36871b24dd63d64885d90c9d5b07))


### Bug Fixes

* **ci:** publish to the Microsoft Store the official way, and unblock the snap review ([9db85c4](https://github.com/jxsuite/jx/commit/9db85c4221abb5123cf8f924e568e4257d8e7ded))
* **ci:** publish to the Microsoft Store the official way, and unblock the snap review ([e2b27e6](https://github.com/jxsuite/jx/commit/e2b27e638766d3a6241518c5fde90004b943cab4))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.6.0
    * @jxsuite/server bumped to 4.4.1
    * @jxsuite/studio bumped to 5.6.0
  * devDependencies
    * @jxsuite/server bumped to 4.4.1

## [5.3.0](https://github.com/jxsuite/jx/compare/desktop-v5.2.0...desktop-v5.3.0) (2026-10-01)


### Features

* **desktop:** publish Jx Studio to the Snap Store, and ship a 66% smaller Nix package ([e607f31](https://github.com/jxsuite/jx/commit/e607f31b58da211f85e30c1f93a578859bb605e0))
* **desktop:** publish Jx Studio to the Snap Store, and ship a 66% smaller Nix package ([6b2c8ad](https://github.com/jxsuite/jx/commit/6b2c8ade4fd030117c8682fb433e3fdcd0872b8b))


### Bug Fixes

* **desktop:** the Store MSIX launched nothing - patched launcher called an undefined __require ([cff91b4](https://github.com/jxsuite/jx/commit/cff91b4276fc8f75c14062b3185e47e510195773))
* **desktop:** the Store MSIX launched nothing - patched launcher called an undefined __require ([6c0e78b](https://github.com/jxsuite/jx/commit/6c0e78b2cbf04faaa91f7407d11cfae260bcc423))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.5.0
    * @jxsuite/server bumped to 4.4.0
    * @jxsuite/studio bumped to 5.5.0
  * devDependencies
    * @jxsuite/server bumped to 4.4.0

## [5.2.0](https://github.com/jxsuite/jx/compare/desktop-v5.1.3...desktop-v5.2.0) (2026-09-29)


### Features

* **ai:** the gateway, one implementation of the chat and models routes ([f2b3d41](https://github.com/jxsuite/jx/commit/f2b3d415ec7d2862c06a23f75311fe187c3ecfbe))
* **ai:** the gateway, one implementation of the chat and models routes ([542853e](https://github.com/jxsuite/jx/commit/542853e9478d5c67e5530e20ad551fc766d4edfb))
* **studio:** the PAL can answer a project file's raw bytes ([ac3ad07](https://github.com/jxsuite/jx/commit/ac3ad07f6d75936363c7318b7e265ae7974981cd))
* **studio:** the PAL can answer a project file's raw bytes ([378b704](https://github.com/jxsuite/jx/commit/378b7047b35ec1eccf50b0cea324c7682782d15e))


### Bug Fixes

* **desktop,studio:** 5.x desktop windows booted without their backend; fail loud and report Browse errors ([3f50ec9](https://github.com/jxsuite/jx/commit/3f50ec92d68ee010aedeb35955c1ff673362fac1))
* **desktop:** build init.js from the vendored Electrobun SDK in every release lane ([6fc779b](https://github.com/jxsuite/jx/commit/6fc779be16ac93e64b59f6191eec95f26cabd094))
* **desktop:** gate the shared AI proxy with the per-process service token ([e565e9e](https://github.com/jxsuite/jx/commit/e565e9ea2c7fddb68442aa21b29a4d4884ef1338))
* **desktop:** stop loading a second copy of Lit in the same window ([85e9d72](https://github.com/jxsuite/jx/commit/85e9d7242889893ace30171970435e8a9296a5d6))
* **desktop:** stop loading a second copy of Lit in the same window ([3891648](https://github.com/jxsuite/jx/commit/3891648a30130f159c8db73a0955e96c2b1d9c43))
* **desktop:** the launcher's handlers mock needs the member the launcher imports ([c2279e1](https://github.com/jxsuite/jx/commit/c2279e19befbaea7aad80f57c3c2706949e8b1b7))
* Jx harness phase 0 — gate the desktop AI proxy, fix stop and usage handling in the agent loop ([6269c5e](https://github.com/jxsuite/jx/commit/6269c5e5708fe4cdb1691c72d52bce7ac5542ddb))
* normalize Bun.Glob paths to forward slashes on Windows ([d89903a](https://github.com/jxsuite/jx/commit/d89903ac9ab807d48373d8b5dc2489dbf560cd41))
* **studio,desktop:** Browse reports why it could not choose a folder ([2e1a1cc](https://github.com/jxsuite/jx/commit/2e1a1cc7aa2e03b125afeeef29ea7ae6609cd310))
* **studio,desktop:** refuse the dev-server fallback when a launcher failed to start ([521803b](https://github.com/jxsuite/jx/commit/521803b2863cc6fdaa3612e54a4fa5572aa1e8b3))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 4.0.2
    * @jxsuite/create bumped to 1.3.12
    * @jxsuite/parser bumped to 1.8.2
    * @jxsuite/protocol bumped to 2.4.0
    * @jxsuite/schema bumped to 2.3.0
    * @jxsuite/server bumped to 4.3.0
    * @jxsuite/starters bumped to 1.8.2
    * @jxsuite/studio bumped to 5.4.0
  * devDependencies
    * @jxsuite/connector bumped to 0.6.1
    * @jxsuite/server bumped to 4.3.0
    * @jxsuite/ui bumped to 0.4.0

## [5.1.3](https://github.com/jxsuite/jx/compare/desktop-v5.1.2...desktop-v5.1.3) (2026-09-22)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/studio bumped to 5.3.0
  * devDependencies
    * @jxsuite/ui bumped to 0.3.0

## [5.1.2](https://github.com/jxsuite/jx/compare/desktop-v5.1.1...desktop-v5.1.2) (2026-09-18)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.3.1
    * @jxsuite/server bumped to 4.2.2
    * @jxsuite/studio bumped to 5.2.0
  * devDependencies
    * @jxsuite/server bumped to 4.2.2

## [5.1.1](https://github.com/jxsuite/jx/compare/desktop-v5.1.0...desktop-v5.1.1) (2026-09-14)


### Bug Fixes

* **desktop:** the first changed file's path no longer loses its first character ([b364aa9](https://github.com/jxsuite/jx/commit/b364aa9910f8af236a3f4c5e5b61af125fd04c94))
* **desktop:** the first changed file's path no longer loses its first character ([3e64b06](https://github.com/jxsuite/jx/commit/3e64b0689c44555606df9c9e9f0ddf8d4b2c5da2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 4.0.1
    * @jxsuite/create bumped to 1.3.11
    * @jxsuite/parser bumped to 1.8.1
    * @jxsuite/server bumped to 4.2.1
    * @jxsuite/starters bumped to 1.8.1
    * @jxsuite/studio bumped to 5.1.0
  * devDependencies
    * @jxsuite/server bumped to 4.2.1
    * @jxsuite/ui bumped to 0.2.0

## [5.1.0](https://github.com/jxsuite/jx/compare/desktop-v5.0.1...desktop-v5.1.0) (2026-09-14)


### Features

* **studio,server,protocol:** one toggle installs an extension and enables it ([1fe5f67](https://github.com/jxsuite/jx/commit/1fe5f6731c00c9421e8dcd8d1ca100d2b06f740e))
* **studio,server,protocol:** one toggle installs an extension and enables it ([17b2627](https://github.com/jxsuite/jx/commit/17b26270db18e23f2f66f7bb15e67db64b2eac22))
* Studio's chrome is Jx documents over a native kit; Spectrum is removed ([035778f](https://github.com/jxsuite/jx/commit/035778fa8bed3d45875643f9e811a066d2a933bc))
* **studio:** Adobe Spectrum is removed ([5474e07](https://github.com/jxsuite/jx/commit/5474e0788a637089aead2c94f43b12fce0237fb1))
* **studio:** highlight what changed in a diff, and open every changed file ([c87b2f3](https://github.com/jxsuite/jx/commit/c87b2f38bf97ec4f339cd9ac136885dd07d8ac7b))


### Bug Fixes

* **desktop,server:** the coverage gates the new catalogue member missed ([ba985d5](https://github.com/jxsuite/jx/commit/ba985d540d49d1147cbcd1147bf5ba301e49c4af))
* **studio,server:** the diff view drew line numbers and no text ([4618933](https://github.com/jxsuite/jx/commit/46189330c881097ad1fe4db2ee24dda9f2aea744))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 4.0.0
    * @jxsuite/create bumped to 1.3.10
    * @jxsuite/parser bumped to 1.8.0
    * @jxsuite/protocol bumped to 2.3.0
    * @jxsuite/schema bumped to 2.2.0
    * @jxsuite/server bumped to 4.2.0
    * @jxsuite/starters bumped to 1.8.0
    * @jxsuite/studio bumped to 5.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.6.0
    * @jxsuite/server bumped to 4.2.0
    * @jxsuite/ui bumped to 0.1.0

## [5.0.1](https://github.com/jxsuite/jx/compare/desktop-v5.0.0...desktop-v5.0.1) (2026-08-30)


### Bug Fixes

* **desktop:** exclude vendor from the Nix source so the published path is the one consumers ask for ([22ea684](https://github.com/jxsuite/jx/commit/22ea6847cae45900ccbc93757bb5546bd8e8d8df))
* **desktop:** exclude vendor from the Nix source so the published path is the one consumers ask for ([7e95f2c](https://github.com/jxsuite/jx/commit/7e95f2c5b39e96e2f418feddff3dcf612591d0e7)), closes [#250](https://github.com/jxsuite/jx/issues/250)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 3.1.0
    * @jxsuite/create bumped to 1.3.9
    * @jxsuite/parser bumped to 1.7.0
    * @jxsuite/protocol bumped to 2.2.0
    * @jxsuite/schema bumped to 2.1.0
    * @jxsuite/server bumped to 4.1.0
    * @jxsuite/starters bumped to 1.7.0
    * @jxsuite/studio bumped to 4.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.7
    * @jxsuite/server bumped to 4.1.0

## [5.0.0](https://github.com/jxsuite/jx/compare/desktop-v4.0.0...desktop-v5.0.0) (2026-08-27)


### ⚠ BREAKING CHANGES

* **schema,site:** `@jxsuite/schema` no longer exports `./routes`, `./layout`, `./context` or `./head-merger`. Import them from `@jxsuite/site`; the modules and their behaviour are unchanged.

### Features

* **desktop:** both launchers can preview the working tree live ([a3349a3](https://github.com/jxsuite/jx/commit/a3349a3be4be33a99aa69b3dcd5ed291478f3b90))
* **import:** the site-import workflow, end to end ([f701f33](https://github.com/jxsuite/jx/commit/f701f33bc035a8e5ce331530ff9886d25236da64))
* Open in Browser previews the working tree through the runtime ([c30c245](https://github.com/jxsuite/jx/commit/c30c2453a0ce426b0111518617b6ed88d9b367e1))
* **studio:** watch an import in the project, in a feed that outlives the run ([5fe22e2](https://github.com/jxsuite/jx/commit/5fe22e29a4eb32e9c3c87f5fbc503f4183ee0060))


### Bug Fixes

* **desktop,import:** the two gates the live preview left red, and the coverage it owed ([c9d56d2](https://github.com/jxsuite/jx/commit/c9d56d2495f1da84997768e6144718be7380de07))
* **screenshots:** stop the screenshot lane churning, and fix the three defects underneath it ([b0d5f57](https://github.com/jxsuite/jx/commit/b0d5f570db2d8aa839469ad846eced8cf3051067))
* **server,desktop:** answer a directory listing in stable path order ([32f1362](https://github.com/jxsuite/jx/commit/32f13628fcde9704167cada10f8be54f2f238f9d))
* **server,studio:** findReferences answers about every reference, and the rename keeps its promise ([ce3266f](https://github.com/jxsuite/jx/commit/ce3266f3966363ef602201a864047d3a7314c22f))
* **server:** resolve rooted refs through every lane, and index refs by shape ([a0f0437](https://github.com/jxsuite/jx/commit/a0f04370929254e6d9d1219d518b4bef67884b78)), closes [#239](https://github.com/jxsuite/jx/issues/239)
* **studio:** the Packages table shows each dependency's own npm latest ([fe75f46](https://github.com/jxsuite/jx/commit/fe75f46c08b31ffc8fee3bce51edbe98e10ec772))
* **studio:** the Packages table shows each dependency's own npm latest ([e6610a8](https://github.com/jxsuite/jx/commit/e6610a859613c40ff6f4cb2c20652dc267cb234f))
* **studio:** the Packages table shows each dependency's own npm latest ([30d997b](https://github.com/jxsuite/jx/commit/30d997b3d25cad7b00ab8c2fdc4413d728b7e124))


### Code Refactoring

* **schema,site:** site composition gets its own package ([d4a3d6e](https://github.com/jxsuite/jx/commit/d4a3d6ec50b747305e278060f05b20743daf4a2c))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 3.0.0
    * @jxsuite/create bumped to 1.3.8
    * @jxsuite/parser bumped to 1.6.0
    * @jxsuite/protocol bumped to 2.1.0
    * @jxsuite/schema bumped to 2.0.0
    * @jxsuite/server bumped to 4.0.0
    * @jxsuite/starters bumped to 1.6.5
    * @jxsuite/studio bumped to 4.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.6
    * @jxsuite/server bumped to 4.0.0

## [4.0.0](https://github.com/jxsuite/jx/compare/desktop-v3.0.1...desktop-v4.0.0) (2026-08-26)


### ⚠ BREAKING CHANGES

* **studio,desktop:** StudioPlatform's `saveSettings` is replaced by `patchSettings`, which takes a set/remove patch and answers with the resulting store. It stays optional, so an adapter that implements neither degrades to cache-only rather than throwing.

### Features

* **protocol:** type what an upload answers, and what a backend will accept ([d7d64e9](https://github.com/jxsuite/jx/commit/d7d64e9784dfcfabda28e44826ed6509660add6f))
* **studio:** declare assetSpace, and resolve media in the canvas realm ([9be7db9](https://github.com/jxsuite/jx/commit/9be7db9151e520caf2f65826968956f25304710b))
* **studio:** declare assetSpace, and resolve media in the canvas realm ([2344271](https://github.com/jxsuite/jx/commit/2344271d5f96728af1a2b3c00bd1e326e0ba1582))


### Bug Fixes

* **desktop:** type the settings patch the window-manager test mocks ([bf33db5](https://github.com/jxsuite/jx/commit/bf33db562ebdd31e44bf0d8802e9e9cd61be3e6b))
* **studio,desktop:** settings are patches, and a blank field never deletes ([7e73fa9](https://github.com/jxsuite/jx/commit/7e73fa9c6d45e53a30f82b08148f9a7547fd22bc))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.8
    * @jxsuite/create bumped to 1.3.7
    * @jxsuite/parser bumped to 1.5.6
    * @jxsuite/protocol bumped to 2.0.0
    * @jxsuite/schema bumped to 1.9.0
    * @jxsuite/server bumped to 3.0.0
    * @jxsuite/starters bumped to 1.6.4
    * @jxsuite/studio bumped to 3.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.5
    * @jxsuite/server bumped to 3.0.0

## [3.0.1](https://github.com/jxsuite/jx/compare/desktop-v3.0.0...desktop-v3.0.1) (2026-08-25)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.7
    * @jxsuite/create bumped to 1.3.6
    * @jxsuite/parser bumped to 1.5.5
    * @jxsuite/protocol bumped to 1.2.1
    * @jxsuite/schema bumped to 1.8.1
    * @jxsuite/server bumped to 2.2.7
    * @jxsuite/starters bumped to 1.6.3
    * @jxsuite/studio bumped to 2.4.3
  * devDependencies
    * @jxsuite/connector bumped to 0.5.4
    * @jxsuite/server bumped to 2.2.7

## [3.0.0](https://github.com/jxsuite/jx/compare/desktop-v2.3.3...desktop-v3.0.0) (2026-08-24)


### ⚠ BREAKING CHANGES

* **desktop:** move to Electrobun 2.0.1 stable and the npm-managed toolchain

### Features

* **desktop:** move to Electrobun 2.0.1 stable and the npm-managed toolchain ([3b3b7b2](https://github.com/jxsuite/jx/commit/3b3b7b2c76dd962aae0f260fce55a5d7be819050))


### Bug Fixes

* **tests:** make the Windows suites runnable ([b18435d](https://github.com/jxsuite/jx/commit/b18435dcf1162be38a01c5c48c4ae310be88c4d2))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.6
    * @jxsuite/server bumped to 2.2.6
    * @jxsuite/studio bumped to 2.4.2
  * devDependencies
    * @jxsuite/connector bumped to 0.5.3
    * @jxsuite/server bumped to 2.2.6

## [2.3.3](https://github.com/jxsuite/jx/compare/desktop-v2.3.2...desktop-v2.3.3) (2026-08-24)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.5
    * @jxsuite/create bumped to 1.3.5
    * @jxsuite/parser bumped to 1.5.4
    * @jxsuite/server bumped to 2.2.5
    * @jxsuite/starters bumped to 1.6.2
    * @jxsuite/studio bumped to 2.4.1
  * devDependencies
    * @jxsuite/server bumped to 2.2.5

## [2.3.2](https://github.com/jxsuite/jx/compare/desktop-v2.3.1...desktop-v2.3.2) (2026-08-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.4
    * @jxsuite/create bumped to 1.3.4
    * @jxsuite/parser bumped to 1.5.3
    * @jxsuite/protocol bumped to 1.2.0
    * @jxsuite/server bumped to 2.2.4
    * @jxsuite/starters bumped to 1.6.1
    * @jxsuite/studio bumped to 2.4.0
  * devDependencies
    * @jxsuite/server bumped to 2.2.4

## [2.3.1](https://github.com/jxsuite/jx/compare/desktop-v2.3.0...desktop-v2.3.1) (2026-08-23)


### Bug Fixes

* **desktop:** the electrobun config is one the CLI can actually load ([#170](https://github.com/jxsuite/jx/issues/170)) ([1249f46](https://github.com/jxsuite/jx/commit/1249f4632abdc29189d1f2d731319fa252c0befb))

## [2.3.0](https://github.com/jxsuite/jx/compare/desktop-v2.2.2...desktop-v2.3.0) (2026-08-23)


### Features

* **studio:** the package states its own layout, and hosts itself ([b94f87b](https://github.com/jxsuite/jx/commit/b94f87b5daa1788090be957302ea224504a743cd))


### Bug Fixes

* **desktop:** a bare jx-studio watched the whole home directory ([b014dfc](https://github.com/jxsuite/jx/commit/b014dfc485bad4c24c4ba9a4bb3f54f9e4195106))
* **desktop:** a bare jx-studio watched the whole home directory ([56d0885](https://github.com/jxsuite/jx/commit/56d0885e2d62a6f54a9477c52b614ad98e41bdeb))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/server bumped to 2.2.3
    * @jxsuite/studio bumped to 2.3.0
  * devDependencies
    * @jxsuite/server bumped to 2.2.3

## [2.2.2](https://github.com/jxsuite/jx/compare/desktop-v2.2.1...desktop-v2.2.2) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.3
    * @jxsuite/create bumped to 1.3.3
    * @jxsuite/server bumped to 2.2.2
    * @jxsuite/starters bumped to 1.6.0
    * @jxsuite/studio bumped to 2.2.2
  * devDependencies
    * @jxsuite/server bumped to 2.2.2

## [2.2.1](https://github.com/jxsuite/jx/compare/desktop-v2.2.0...desktop-v2.2.1) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.2
    * @jxsuite/create bumped to 1.3.2
    * @jxsuite/parser bumped to 1.5.2
    * @jxsuite/protocol bumped to 1.1.2
    * @jxsuite/schema bumped to 1.8.0
    * @jxsuite/server bumped to 2.2.1
    * @jxsuite/starters bumped to 1.5.0
    * @jxsuite/studio bumped to 2.2.1
  * devDependencies
    * @jxsuite/connector bumped to 0.5.2
    * @jxsuite/server bumped to 2.2.1

## [2.2.0](https://github.com/jxsuite/jx/compare/desktop-v2.1.0...desktop-v2.2.0) (2026-08-21)


### Features

* **desktop:** bring the chromium launcher to PAL parity with electrobun ([595d413](https://github.com/jxsuite/jx/commit/595d41325c4d81322dc5fe927161e07af51d35a2))
* **desktop:** bring the chromium launcher to PAL parity with electrobun ([9f13748](https://github.com/jxsuite/jx/commit/9f137482449ba887279aeb838b2c4c275c37a494))


### Bug Fixes

* **desktop:** give the chromium window an identity the taskbar can resolve ([012f5c4](https://github.com/jxsuite/jx/commit/012f5c4b27f3f18afbfacba21709531934c35a0d))
* **desktop:** type two test mocks to the contracts they stand in for ([d04c271](https://github.com/jxsuite/jx/commit/d04c271cb7c700cc92f47a8fe22e97d641a5ab89))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.1
    * @jxsuite/create bumped to 1.3.1
    * @jxsuite/parser bumped to 1.5.1
    * @jxsuite/protocol bumped to 1.1.1
    * @jxsuite/schema bumped to 1.7.0
    * @jxsuite/server bumped to 2.2.0
    * @jxsuite/starters bumped to 1.4.0
    * @jxsuite/studio bumped to 2.2.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.1
    * @jxsuite/server bumped to 2.2.0

## [2.1.0](https://github.com/jxsuite/jx/compare/desktop-v2.0.1...desktop-v2.1.0) (2026-08-19)


### Features

* **auth:** a loopback redirect with PKCE, and cookies a browser will keep ([43767ae](https://github.com/jxsuite/jx/commit/43767aeec6be115a810b43a14784f7e7038147ac))
* **server:** read Fetch Metadata, and close the three ungated project-server routes ([0e69837](https://github.com/jxsuite/jx/commit/0e698374ba5f251548d293f8553b12d308e07463))
* **studio,desktop:** P0 wave A — enforcement rails and three dead RPCs ([da8071d](https://github.com/jxsuite/jx/commit/da8071d93d783fa80a48e73fe6e6093c10461f2c))
* **studio,server,desktop:** P4 wave A — the app can say what happened ([c319576](https://github.com/jxsuite/jx/commit/c3195762c0dd76472355dd3ae0eb9ba6fc12c0d3))
* **studio:** say it out loud — one live region, and the affordances high contrast deletes ([e5fffdf](https://github.com/jxsuite/jx/commit/e5fffdff8f7107e7d98aaa51a81e7b1f93cf9ca1))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([c8c3452](https://github.com/jxsuite/jx/commit/c8c345213307f2383ed5c4251ca6b388c8489504))


### Bug Fixes

* **desktop:** the Nix bundle deleted the extension packages it depends on ([b3fc5bb](https://github.com/jxsuite/jx/commit/b3fc5bbe1a22fdd506a81f3b0339c619f29ec760))
* **parser:** localized content never reached its own locale's asset mount ([ff15172](https://github.com/jxsuite/jx/commit/ff1517233e4d5b685009e4f47b8bded295c9a186))
* **server:** give the previewed site its own origin, so Open in Browser is the real site ([fcbaa0b](https://github.com/jxsuite/jx/commit/fcbaa0bc7679727cc20caf50e86ac10cf6aca911))
* **studio:** Open Project's "New Window" opened in this window ([6427bbf](https://github.com/jxsuite/jx/commit/6427bbfe9122d3e6688d09b7c3854bdba6b3f1f3))
* **studio:** Open Project's "New Window" opened in this window ([9ac528f](https://github.com/jxsuite/jx/commit/9ac528f80b1d6937fd3dfa426dc344ddf9979d79))
* **types:** repair the two typecheck errors the workspace tsconfigs see ([908f661](https://github.com/jxsuite/jx/commit/908f6614ea8cfffe06ed82b6dfe7f1ae979f79ab))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 2.0.0
    * @jxsuite/create bumped to 1.3.0
    * @jxsuite/parser bumped to 1.5.0
    * @jxsuite/protocol bumped to 1.1.0
    * @jxsuite/schema bumped to 1.6.0
    * @jxsuite/server bumped to 2.1.0
    * @jxsuite/starters bumped to 1.3.0
    * @jxsuite/studio bumped to 2.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.5.0
    * @jxsuite/server bumped to 2.1.0

## [2.0.1](https://github.com/jxsuite/jx/compare/desktop-v2.0.0...desktop-v2.0.1) (2026-07-31)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/studio bumped to 2.0.1

## [2.0.0](https://github.com/jxsuite/jx/compare/desktop-v1.2.1...desktop-v2.0.0) (2026-07-30)


### ⚠ BREAKING CHANGES

* **studio:** `StudioPlatform` implementations must declare `createDestination` and honor `createProject`'s `destination`. `POST /__studio/create-project` rejects a request without one, and returns an absolute `root` for projects created outside the server root.

### Features

* **studio:** require a user-chosen destination for new projects ([0046d68](https://github.com/jxsuite/jx/commit/0046d68c4268489fadef9c9f37f414889fd88f4f))
* **studio:** upload and drop media from every editing surface ([3a58962](https://github.com/jxsuite/jx/commit/3a58962bf5225b31ec2476cba7c91f9d6a6231eb))


### Bug Fixes

* **desktop,studio,server,collab:** typecheck the desktop package, and hold the coverage gates ([f1e40e5](https://github.com/jxsuite/jx/commit/f1e40e5c813d4f7ec508859faddb4faef76e2c03))
* **schema:** make committed entry documents resolve in editors ([e957436](https://github.com/jxsuite/jx/commit/e957436666362e83c07f69e487c4228cfcc06b76))
* **studio,server,desktop:** dev server bypassed the build; Monaco still loaded at startup ([0b98da6](https://github.com/jxsuite/jx/commit/0b98da64aa34e49d2c18276359f50c119706f9c1))
* **studio:** resolve project schemas offline and ship Monaco's workers everywhere ([367cefa](https://github.com/jxsuite/jx/commit/367cefa437f79ebd36623341833209d684f81ae4))


### Performance Improvements

* **studio:** code-split the bundle and load Monaco on demand ([369e702](https://github.com/jxsuite/jx/commit/369e70287a5a32cbe3f6ef922ee0f647d48d755e))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 1.5.0
    * @jxsuite/create bumped to 1.2.2
    * @jxsuite/parser bumped to 1.4.1
    * @jxsuite/protocol bumped to 1.0.0
    * @jxsuite/schema bumped to 1.5.0
    * @jxsuite/server bumped to 2.0.0
    * @jxsuite/starters bumped to 1.2.2
    * @jxsuite/studio bumped to 2.0.0
  * devDependencies
    * @jxsuite/connector bumped to 0.4.2
    * @jxsuite/server bumped to 2.0.0

## [1.2.1](https://github.com/jxsuite/jx/compare/desktop-v1.2.0...desktop-v1.2.1) (2026-07-24)


### Bug Fixes

* **desktop:** stage create/starters static data into the Electrobun bundle ([75c38ab](https://github.com/jxsuite/jx/commit/75c38abf607bb639832362aadf3a646aa522618f))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 1.4.0
    * @jxsuite/create bumped to 1.2.1
    * @jxsuite/parser bumped to 1.4.0
    * @jxsuite/protocol bumped to 0.6.1
    * @jxsuite/schema bumped to 1.4.0
    * @jxsuite/server bumped to 1.3.0
    * @jxsuite/starters bumped to 1.2.1
    * @jxsuite/studio bumped to 1.5.0
  * devDependencies
    * @jxsuite/connector bumped to 0.4.1
    * @jxsuite/server bumped to 1.3.0

## [1.2.0](https://github.com/jxsuite/jx/compare/desktop-v1.1.2...desktop-v1.2.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([6e235b5](https://github.com/jxsuite/jx/commit/6e235b562d8b494afa3e8509b6bb98e4c2e3d9c6))


### Bug Fixes

* **starters,examples:** repair documents the schema correctly rejected ([7917b2b](https://github.com/jxsuite/jx/commit/7917b2b231e5f4ed6d3818d19c5f8fb477fe02c1))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 1.3.0
    * @jxsuite/create bumped to 1.2.0
    * @jxsuite/parser bumped to 1.3.0
    * @jxsuite/protocol bumped to 0.6.0
    * @jxsuite/schema bumped to 1.3.0
    * @jxsuite/server bumped to 1.2.0
    * @jxsuite/starters bumped to 1.2.0
    * @jxsuite/studio bumped to 1.4.0
  * devDependencies
    * @jxsuite/connector bumped to 0.4.0
    * @jxsuite/server bumped to 1.2.0

## [1.1.2](https://github.com/jxsuite/jx/compare/desktop-v1.1.1...desktop-v1.1.2) (2026-07-20)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/studio bumped to 1.3.0

## [1.1.1](https://github.com/jxsuite/jx/compare/desktop-v1.1.0...desktop-v1.1.1) (2026-07-18)


### Bug Fixes

* enable notarization in electrobun configuration ([edae3a7](https://github.com/jxsuite/jx/commit/edae3a7eb12446a8c766abdc24a755e40cfeed71))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 1.2.0
    * @jxsuite/create bumped to 1.1.1
    * @jxsuite/parser bumped to 1.2.0
    * @jxsuite/protocol bumped to 0.5.1
    * @jxsuite/schema bumped to 1.2.0
    * @jxsuite/server bumped to 1.1.1
    * @jxsuite/starters bumped to 1.1.1
    * @jxsuite/studio bumped to 1.2.0
  * devDependencies
    * @jxsuite/connector bumped to 0.3.1
    * @jxsuite/server bumped to 1.1.1

## [1.1.0](https://github.com/jxsuite/jx/compare/desktop-v1.0.0...desktop-v1.1.0) (2026-07-17)


### Features

* **studio:** spreadsheet grid editor — CSV grid tabs with batch save ([b0bd0dc](https://github.com/jxsuite/jx/commit/b0bd0dccb72a9541c77b877154783f376cd540fa))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/compiler bumped to 1.1.0
    * @jxsuite/create bumped to 1.1.0
    * @jxsuite/parser bumped to 1.1.0
    * @jxsuite/protocol bumped to 0.5.0
    * @jxsuite/schema bumped to 1.1.0
    * @jxsuite/server bumped to 1.1.0
    * @jxsuite/starters bumped to 1.1.0
    * @jxsuite/studio bumped to 1.1.0
  * devDependencies
    * @jxsuite/connector bumped to 0.3.0
    * @jxsuite/server bumped to 1.1.0

## [1.0.0](https://github.com/jxsuite/jx/compare/desktop-v0.35.3...desktop-v1.0.0) (2026-07-13)

### ⚠ BREAKING CHANGES

- hosts switch to the extension model; migrate all projects to content sections

### Features

- hosts switch to the extension model; migrate all projects to content sections ([b2c0e27](https://github.com/jxsuite/jx/commit/b2c0e27c08e649af334fdf67ccf6abbb73c480dc))
- **studio:** data console — connections, schema push, secrets, data grid ([de02861](https://github.com/jxsuite/jx/commit/de02861a03c94460f0d332ac909438decbd4fd9d))
- **studio:** descriptor-contributed settings + fetched project schemas ([b85afaf](https://github.com/jxsuite/jx/commit/b85afaf9f6d340e1d916ad399fc758df36ced2e1))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/compiler bumped to 1.0.0
    - @jxsuite/create bumped to 1.0.0
    - @jxsuite/parser bumped to 1.0.0
    - @jxsuite/protocol bumped to 0.4.0
    - @jxsuite/schema bumped to 1.0.0
    - @jxsuite/server bumped to 1.0.0
    - @jxsuite/starters bumped to 1.0.0
    - @jxsuite/studio bumped to 1.0.0
  - devDependencies
    - @jxsuite/connector bumped to 0.2.0
    - @jxsuite/server bumped to 1.0.0

## [0.35.3](https://github.com/jxsuite/jx/compare/desktop-v0.35.2...desktop-v0.35.3) (2026-07-08)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/server bumped to 0.37.1
    - @jxsuite/studio bumped to 0.37.1
  - devDependencies
    - @jxsuite/server bumped to 0.37.1

## [0.35.2](https://github.com/jxsuite/jx/compare/desktop-v0.35.1...desktop-v0.35.2) (2026-07-08)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/server bumped to 0.37.0
    - @jxsuite/studio bumped to 0.37.0
  - devDependencies
    - @jxsuite/server bumped to 0.37.0

## [0.35.1](https://github.com/jxsuite/jx/compare/desktop-v0.35.0...desktop-v0.35.1) (2026-07-07)

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/compiler bumped to 0.35.0
    - @jxsuite/create bumped to 0.36.0
    - @jxsuite/parser bumped to 0.35.1
    - @jxsuite/schema bumped to 0.35.0
    - @jxsuite/server bumped to 0.36.0
    - @jxsuite/starters bumped to 0.35.1
    - @jxsuite/studio bumped to 0.36.0
  - devDependencies
    - @jxsuite/server bumped to 0.36.0

## [0.35.0](https://github.com/jxsuite/jx/compare/desktop-v0.34.0...desktop-v0.35.0) (2026-07-06)

### Features

- **desktop:** persistent cross-platform user settings ([348f704](https://github.com/jxsuite/jx/commit/348f704452570c898cc26f865088b88b5bb75649))
- **desktop:** wire up the "new project" feature ([742e72d](https://github.com/jxsuite/jx/commit/742e72d4d9154cc14978718d458917042e3994c4))
- site import package, ui + starter templates & wizard ([700e432](https://github.com/jxsuite/jx/commit/700e432faeb6c30ef2b1859b0a12fa00457ff508))
- **starters:** init starter sites ([be19be6](https://github.com/jxsuite/jx/commit/be19be613e365ad26e804f99ecce95032d2419fc))

### Bug Fixes

- **desktop:** correct class on chromium runtime ([cf4b406](https://github.com/jxsuite/jx/commit/cf4b406edb0235d515b03a676763412344b91039))

### Dependencies

- The following workspace dependencies were updated
  - dependencies
    - @jxsuite/compiler bumped to 0.34.1
    - @jxsuite/create bumped to 0.35.0
    - @jxsuite/parser bumped to 0.35.0
    - @jxsuite/server bumped to 0.35.0
    - @jxsuite/starters bumped to 0.35.0
    - @jxsuite/studio bumped to 0.35.0
  - devDependencies
    - @jxsuite/server bumped to 0.35.0
