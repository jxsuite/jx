# Changelog

## [0.2.0](https://github.com/jxsuite/jx/compare/compiler-binding-v0.1.0...compiler-binding-v0.2.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* **compiler:** the default image formats are avif and jpeg instead of webp and avif, WebP output is lossless, sharp is no longer a dependency, and variant file names change. A project that lists webp should list avif and jpeg instead.

### Features

* **compiler:** images are encoded by the compiler's own Rust core ([fef06a5](https://github.com/jxsuite/jx/commit/fef06a523d0e671fc191a04e50df82a174126b6e))


### Bug Fixes

* **compiler-binding:** the loader finds a checkout's addon from the compiler's CLI bundle ([d72cd03](https://github.com/jxsuite/jx/commit/d72cd0388598a966dd60fe9e5b751f3ada849c94))
