# Changelog

## [0.3.0](https://github.com/jxsuite/jx/compare/compiler-binding-v0.2.1...compiler-binding-v0.3.0) (2026-11-14)


### Features

* **compiler:** the image pipeline is stated once, and its cache, formats and Markdown images match ([9e1d1e8](https://github.com/jxsuite/jx/commit/9e1d1e8acc9f6f90091fcfdab8013d97f64f8665))


### Bug Fixes

* **compiler-binding:** the musl and Windows arm64 addons build, and a pull request proves all eight ([b6c36ae](https://github.com/jxsuite/jx/commit/b6c36ae6544accc3044449a05ce3ee4b1d954109))

## [0.2.1](https://github.com/jxsuite/jx/compare/compiler-binding-v0.2.0...compiler-binding-v0.2.1) (2026-11-14)


### Bug Fixes

* **compiler-binding:** the musl and Windows arm64 addons build, and a pull request proves all eight ([b6c36ae](https://github.com/jxsuite/jx/commit/b6c36ae6544accc3044449a05ce3ee4b1d954109))

## [0.2.0](https://github.com/jxsuite/jx/compare/compiler-binding-v0.1.0...compiler-binding-v0.2.0) (2026-11-13)


### ⚠ BREAKING CHANGES

* **compiler:** the default image formats are avif and jpeg instead of webp and avif, WebP output is lossless, sharp is no longer a dependency, and variant file names change. A project that lists webp should list avif and jpeg instead.

### Features

* **compiler:** images are encoded by the compiler's own Rust core ([8e929a7](https://github.com/jxsuite/jx/commit/8e929a7520b95fc661e55f64c5b6f7ce3fd333e4))


### Bug Fixes

* **compiler-binding:** the loader finds a checkout's addon from the compiler's CLI bundle ([c0dcf74](https://github.com/jxsuite/jx/commit/c0dcf744f58697ac962bcef73cb836ef046190ea))
