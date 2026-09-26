# Changelog

## [0.38.0](https://github.com/jxsuite/jx/compare/ai-v0.37.2...ai-v0.38.0) (2026-09-26)


### Features

* **ai:** the gateway, one implementation of the chat and models routes ([cbf5728](https://github.com/jxsuite/jx/commit/cbf5728d2f81e8f36a42a1e94cac6a6b0944e3a8))
* **ai:** the gateway, one implementation of the chat and models routes ([404923f](https://github.com/jxsuite/jx/commit/404923f303ee6869469b5310560f37c6bcfe1f20))


### Bug Fixes

* **ai:** run streamed tool calls on any finish but not after Stop, and forward usage ([1513100](https://github.com/jxsuite/jx/commit/1513100f789ab88ea25dfcf69f44ba76dcdb2e75))
* Jx harness phase 0 — gate the desktop AI proxy, fix stop and usage handling in the agent loop ([8d364ea](https://github.com/jxsuite/jx/commit/8d364eac66bea8302f0dcac03f8f72587e49d8c6))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([f064bc5](https://github.com/jxsuite/jx/commit/f064bc5e07d70d0429d62ba69ec3826ccf228e20))
* **studio:** a live chip shows how its call ended; a stopped or failed turn leaves an honest record ([6a70470](https://github.com/jxsuite/jx/commit/6a704701bf1fefa4666e3fe1c1b23d4c9115ac5d))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([0488ee1](https://github.com/jxsuite/jx/commit/0488ee10a5c4d689ea3850424dcdabe2311b2a19))
* **studio:** a reopened chat shows how each tool call ended and keeps an open question ([879b7fe](https://github.com/jxsuite/jx/commit/879b7fe793e457380399a064040c427b64859200))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([2d063c5](https://github.com/jxsuite/jx/commit/2d063c5a2fa7226715aa061412c46a033951c970))
* **studio:** a turn reports what it applied, and a turn that drew nothing says so ([60a84f4](https://github.com/jxsuite/jx/commit/60a84f4f5e5ccfdf63b2a550ed11a147e6d9d40f))
* **studio:** one turn per window, and Stop stays on offer for all of it ([81c7824](https://github.com/jxsuite/jx/commit/81c78242a58d247d5b1ecf697122160ee7600e6a))
* **studio:** one turn per window, and Stop stays on offer for all of it ([076b9c7](https://github.com/jxsuite/jx/commit/076b9c7de6411be8af206aa48b321d4d2fec8a00))
* **studio:** Stop is armed before the send path's first wait ([d9a8059](https://github.com/jxsuite/jx/commit/d9a805929d4efc91a8ab6918dc3784fcf367a9c4))
* **studio:** Stop is armed before the send path's first wait ([297f75e](https://github.com/jxsuite/jx/commit/297f75ecb2ec7bed6622a7e298a160a24863bdc0))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.4.0

## [0.37.2](https://github.com/jxsuite/jx/compare/ai-v0.37.1...ai-v0.37.2) (2026-09-18)


### Bug Fixes

* **ai:** parse Cloudflare's array-shaped error envelope for BYOK providers ([f703244](https://github.com/jxsuite/jx/commit/f7032448034eb17f752574d3a3916b34c332d324))
* **ai:** parse Cloudflare's array-shaped error envelope for BYOK providers ([65add04](https://github.com/jxsuite/jx/commit/65add043b8a73b956f726a2d1852205bb0f75c57))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.3.1

## [0.37.1](https://github.com/jxsuite/jx/compare/ai-v0.37.0...ai-v0.37.1) (2026-09-14)


### Bug Fixes

* **ai:** stop sending an empty assistant turn, and replay a model's reasoning ([9b0d735](https://github.com/jxsuite/jx/commit/9b0d7353897444825087cace1b4489bc6965e9fb))
* **ai:** stop sending an empty assistant turn, and replay a model's reasoning ([d0b7fe1](https://github.com/jxsuite/jx/commit/d0b7fe19e0b40660f4ecb69e585df2682b05a129))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.3.0

## [0.37.0](https://github.com/jxsuite/jx/compare/ai-v0.36.5...ai-v0.37.0) (2026-08-30)


### Features

* **studio,ai:** the assistant uses the backend's per-model capabilities ([4f7a9dd](https://github.com/jxsuite/jx/commit/4f7a9ddab4ca039a0dea83741dd39bc8345b87ea))


### Bug Fixes

* **studio:** a lapsed Cloudflare grant no longer ends the connect flow before it starts ([83102d2](https://github.com/jxsuite/jx/commit/83102d2eaf64752895efe8118afacc605eaa2aff))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.2.0

## [0.36.5](https://github.com/jxsuite/jx/compare/ai-v0.36.4...ai-v0.36.5) (2026-08-27)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.1.0

## [0.36.4](https://github.com/jxsuite/jx/compare/ai-v0.36.3...ai-v0.36.4) (2026-08-26)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 2.0.0

## [0.36.3](https://github.com/jxsuite/jx/compare/ai-v0.36.2...ai-v0.36.3) (2026-08-25)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 1.2.1

## [0.36.2](https://github.com/jxsuite/jx/compare/ai-v0.36.1...ai-v0.36.2) (2026-08-23)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 1.2.0

## [0.36.1](https://github.com/jxsuite/jx/compare/ai-v0.36.0...ai-v0.36.1) (2026-08-21)


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 1.1.2

## [0.36.0](https://github.com/jxsuite/jx/compare/ai-v0.35.0...ai-v0.36.0) (2026-08-21)


### Features

* **ai:** export the StreamEvent union, its members, and the factory option types ([9e0f4b3](https://github.com/jxsuite/jx/commit/9e0f4b3f41f3d63887b468263ff5d33640090024))


### Bug Fixes

* defects surfaced by fact-checking the new package READMEs ([c4a614d](https://github.com/jxsuite/jx/commit/c4a614dae5e199d49384f998a0b937354f9de882))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 1.1.1

## [0.35.0](https://github.com/jxsuite/jx/compare/ai-v0.34.0...ai-v0.35.0) (2026-08-19)


### Features

* **protocol:** one failure shape — RFC 9457 problem details ([2ab94b1](https://github.com/jxsuite/jx/commit/2ab94b189e1c1265f90713e36b8cb8030f9afd40))
* **studio:** the Named Shell — P0–P8, the full UX redesign ([b576cbb](https://github.com/jxsuite/jx/commit/b576cbb24c7e0d8d36075f6d682e9b3b6b971166))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @jxsuite/protocol bumped to 1.1.0

## [0.34.0](https://github.com/jxsuite/jx/compare/ai-v0.33.0...ai-v0.34.0) (2026-07-22)


### Features

* enforce truthful marketing claims and add the missing LICENSE ([b7e0b09](https://github.com/jxsuite/jx/commit/b7e0b095566121d79ca50894b69a476984fb93ee))
