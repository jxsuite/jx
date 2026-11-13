---
title: "Images"
description: "The build-time image pipeline: responsive srcset variants in AVIF and JPEG, lazy-loading attributes, per-image overrides, and caching."
spec:
  - site-architecture.md#9
  - site-architecture.md#9.2.8
  - compiler.md#7
code:
  - packages/compiler/src/site/image-transform.ts
  - packages/site/src/xmp-packet.ts
  - packages/compiler/src/site/img-loading.ts
  - packages/compiler/src/site/asset-mounts.ts
  - packages/compiler/src/site/image-optimizer.ts
  - packages/compiler/src/site/image-cache.ts
  - packages/compiler-binding/src/index.ts
---

# Images

The build optimizes images automatically: every eligible `<img>` gets a responsive `srcset` of resized, format-converted variants, plus lazy-loading attributes. It's on by default, and you configure it (or turn it off) under the `images` key in the project file.

## Configuration

All properties are optional; these are the defaults:

```json
{
  "images": {
    "optimize": true,
    "widths": [320, 640, 960, 1280, 1920],
    "formats": ["avif", "jpeg"],
    "quality": { "avif": 65, "jpeg": 80 },
    "sizes": "(max-width: 768px) 100vw, 50vw",
    "lazyLoad": true,
    "picture": true,
    "service": "build"
  }
}
```

| Property        | What it controls                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------- |
| `optimize`      | Master switch; `false` disables all image processing                                            |
| `widths`        | Pixel widths for the responsive variants                                                        |
| `formats`       | Output formats: `"avif"`, `"jpeg"`, `"png"`, `"webp"` (see "Formats" below)                     |
| `quality`       | Lossy quality for `avif` and `jpeg` (1–100)                                                     |
| `sizes`         | Fallback CSS `sizes`, used only when neither the tag nor its container says (below)             |
| `lazyLoad`      | Adds `loading="lazy"` and `decoding="async"`, whether or not `optimize` is on                   |
| `picture`       | Wrap a multi-format image in a `<picture>`, one `<source>` per format (default `true`)          |
| `service`       | `"build"` = encoded at build time; `"cloudflare"` = transform URLs served by Cloudflare (below) |
| `remoteDomains` | Https hostnames whose remote images also get transform srcsets, `"cloudflare"` service only     |

## What the build does

The encoder is part of the compiler, so there is no image library to install and nothing to configure on a build machine. For each eligible image, the pipeline:

1. **Filters widths** to those at or below the image's natural width. There is no upscaling. The image's own width is added as an extra breakpoint only when it is _smaller_ than your largest configured width. Otherwise your largest width is the ceiling you asked for, and a 3840 px screenshot would quietly emit a 3840 px variant in every format that no layout would ever request.
2. **Generates one variant per width × format** and writes it to `dist/images/_optimized/{stem}-{width}-{hash}.{format}` (e.g. `hero-640-a1b2c3d4.avif`). A photo stored sideways is turned upright first, using its EXIF orientation, and an embedded colour profile is converted to sRGB.
3. **Rewrites the markup.** With one configured format, the `<img>` gets a `srcset` of those variants plus a `sizes` (below). With two or more, it is wrapped in a `<picture>`:

```html
<picture>
  <source type="image/avif" srcset="/images/_optimized/hero-640-a1b2.avif 640w, …" sizes="…" />
  <source type="image/jpeg" srcset="/images/_optimized/hero-640-a1b2.jpeg 640w, …" sizes="…" />
  <img
    src="/images/_optimized/hero-1200-a1b2.jpeg"
    alt="Hero"
    width="1200"
    height="800"
    loading="lazy"
  />
</picture>
```

The `<img>` carries no `srcset`, which is what makes it a real fallback. A bare `srcset` says nothing about format, so a browser that can't decode AVIF picks an AVIF candidate anyway and shows nothing; `<source type>` is the only markup that lets it decline. Set `"picture": false` if you'd rather have the flat `<img>` and accept that.

Its `src` is the largest variant in a universally decodable format (`jpeg` or `png`) when your `formats` include one, and the original file otherwise. `src` is only ever reached by a client that understood neither `srcset` nor any `<source type>`, so it has to stay decodable; but the original is the _unresized_ source, and a resized variant of the same format is strictly better. With `formats: ["avif"]` alone there is nothing safe to point at, so the original stays: a smaller image nobody can decode is not an improvement.

### Formats

| Format | Written as                                                           |
| ------ | -------------------------------------------------------------------- |
| `avif` | Lossy, at `quality.avif`                                             |
| `jpeg` | Lossy and progressive, at `quality.jpeg`                             |
| `png`  | Lossless                                                             |
| `webp` | Lossless, so much larger than AVIF or JPEG for a photo or screenshot |

The default pair covers every browser: AVIF for the ones that decode it, JPEG for the rest.

JPEG has no transparency. Where `jpeg` is listed and an image has transparent pixels, the build writes PNG in its place and offers it as `image/png`, so a logo's fallback is not a white rectangle.

:::doc-warning
WebP is written losslessly. If your `formats` lists `"webp"`, the build prints a warning, because those files are several times the size of the AVIF or JPEG of the same picture. Projects created before this change list `["webp", "avif"]`: change it to `["avif", "jpeg"]`.
:::

## How `sizes` is chosen

`sizes` is a promise about layout, and the browser keeps it absolutely: it picks a candidate from that string before any layout has happened and never revisits the choice. One project-wide string therefore can't be right for every image on a site. `(max-width: 768px) 100vw, 50vw` describes a half-width image, and on a hero that renders full-width inside a 960 px column it is too small on a wide screen and too large on a narrow one.

So the build asks, in order:

1. **A `sizes` you wrote on the tag.** Always wins.
2. **The container.** The narrowest literal `max-width` or `width` in `px`/`rem` on the image or any ancestor, emitted as `(max-width: 960px) 100vw, 960px`. This is layout the build already knows, so it beats a project-wide guess.
3. **`images.sizes`**, if you set one.
4. **Nothing**, so the browser assumes `100vw`.

Only literal lengths count. A `clamp()`, a percentage, or a `var()` is a real constraint too, but not one the build can resolve, and a wrong `sizes` is worse than none. Write `sizes` on the tag when your layout is one of those.

Images embedded in pre-rendered Markdown content go through the same transformation, so a `![hero](./images/hero.jpg)` in a blog post is optimized like any hand-placed `<img>`.

## When images load

`loading` and `decoding` are decided by `lazyLoad` alone, for every image on the site, including ones the optimizer skipped, and every image in a project with `"optimize": false`. Whether an image is worth re-encoding says nothing about when it should be fetched.

Three things stop `loading="lazy"` from being added:

| You write                     | The build does                             |
| ----------------------------- | ------------------------------------------ |
| `"lazyLoad": false`           | Nothing, anywhere                          |
| `loading="eager"` or `"lazy"` | Leaves it exactly as you wrote it          |
| `fetchpriority="high"`        | Nothing; the two contradict and yours wins |

:::doc-tip
Mark your hero image `fetchpriority="high"`. The build can't work out which image is the largest contentful paint, because that depends on the visitor's viewport rather than on the document, so it doesn't guess, and an unmarked hero is lazy-loaded like everything else.
:::

## Which images are eligible

Processed: `<img>` nodes with a static, local `src` (a string, rather than a `${...}` expression or a `$ref`) pointing at a raster file (`.jpg`, `.jpeg`, `.png`, `.webp`, `.tiff`, `.bmp`) that exists on disk.

Skipped automatically:

- External URLs (`http://`, `https://`, `//`, `data:`)
- SVGs and GIFs
- AVIF files, which are already in the format the build would convert them to
- Dynamic `src` values (template expressions or bindings)
- Anything carrying a `data-no-optimize` attribute

## Where srcs resolve

In pages, layouts, and components, image paths resolve against the **site root**, not the referring file: a `/`-prefixed src like `/images/hero.jpg` resolves into `public/` (so it's `public/images/hero.jpg` on disk, and works verbatim at runtime too), while a relative src like `content/blog/images/hero.jpg` resolves from the project root.

**Content entries are the exception.** They resolve against themselves, so a collection stays readable in a markdown editor:

```markdown
![A diagram](./images/diagram.png)
```

A relative reference in an entry is remapped to the collection's own URL, so `content/blog/images/diagram.png` becomes `/content/blog/images/diagram.png`, and the build copies the file there. A collection that declares `exclude`, `where` or `route` does not publish through that URL what its own rules leave out: an excluded file, a hidden file such as `.env` and a Markdown document are neither remapped nor copied, even when a page names `/content/<type>/...` directly. See [Content collections](/docs/framework/site/content-collections).

## Per-image overrides

Individual images can override the global config through ordinary attributes:

```json
{
  "tagName": "img",
  "attributes": {
    "src": "/images/hero.jpg",
    "alt": "Hero image",
    "sizes": "(max-width: 640px) 80vw, 40vw",
    "fetchpriority": "high"
  }
}
```

- `sizes`: replaces the configured default for this image
- `loading="eager"`: keeps `loading="lazy"` off an above-the-fold image
- `fetchpriority="high"`: marks the LCP image: fetched at high priority, never lazy-loaded
- `data-no-optimize`: skips the pipeline entirely

## Focal point

A picture can carry its own focal point in its embedded metadata: an IPTC image region holding one point, with the role _area of interest_. Studio's Media workspace writes it (see [Focal point](/docs/studio/projects/media#focal-point)), and so can any tool that writes IPTC image regions.

When an `<img>` references a JPEG, PNG, WebP or SVG file in the project that has one, the build sets the point as the image's `object-position`, for example `25% 80%`. An image drawn with `object-fit: cover` then crops around that point. This happens whether or not `optimize` is on. Your own `objectPosition` on the image always wins, and an image whose `src` is bound, remote or a `data:` URL is left alone.

## Caching

Variants are cached in `.cache/images/` (with a `manifest.json`) so unchanged images aren't re-encoded on the next build. The cache key combines the source file's content hash, a hash of the optimization config, and the file's name, so changing the image, renaming it, or changing the `widths`/`formats`/`quality` settings invalidates the entry, as do missing variant files. Variants are named after the source file, and any file name works: a space, a comma or an accented letter is percent-encoded in the `srcset` and `src` URLs. The cache survives `dist/` cleanup; add `.cache/` to `.gitignore`, or commit it to speed up CI builds.

The cache is self-pruning: after a fully successful build, entries no build step touched (deleted or replaced source images, superseded configs) are dropped and their variant files deleted, so a persisted cache, and the `dist/images/_optimized/` copy made from it, stays bounded to the images the site actually uses, even when the cache lives forever (for example in a CI cache). Builds that end with errors skip pruning, because a page that failed to compile never touched its images and evicting them would force a pointless re-encode.

## The Cloudflare service

Setting `"service": "cloudflare"` replaces the build-time pipeline with pure markup: eligible images get a `srcset` of `/cdn-cgi/image/...` transform URLs (one per configured width, `format=auto` so Cloudflare negotiates AVIF/WebP per browser, quality from `quality.webp`), and no variants are generated at build time. Remote `https` images from hostnames listed in `remoteDomains` get the same treatment.

This requires the site to be served through a Cloudflare zone with Image Transformations enabled (dashboard: _Images > Transformations_). The URLs do not resolve on `*.pages.dev` or `*.workers.dev` preview hosts, so previews fall back to the untouched originals.

## Related

- [Build output and adapters](/docs/framework/site/deployment): where the variants land in `dist/`
- [Media in Studio](/docs/studio/projects/media): browsing and placing images visually
- [the project file](/docs/framework/site/project-json): the full configuration reference
