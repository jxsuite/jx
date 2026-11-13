---
spec: compiler.md
level: major
---

§7: images are encoded by the compiler's own Rust core instead of sharp. The default formats become avif and jpeg, WebP is written losslessly with a build warning, a transparent source asked for as JPEG is written as PNG, EXIF orientation is applied, embedded colour profiles are converted to sRGB, an AVIF source is served as written, variants encode in parallel, and a variant's name covers the pipeline version. New §14 specifies the native core: one addon file per platform, how it is loaded, and that it links no C library.
