export const imageConfigSchema = {
  description: "Image optimization configuration for the project.",
  properties: {
    formats: {
      description:
        'Output formats, each one of "avif", "jpeg", "png" or "webp" (default ["avif", "jpeg"]). ' +
        "AVIF and JPEG are lossy; PNG and WebP are written losslessly, so listing WebP produces " +
        "larger files than either. A source with transparency is written as PNG wherever JPEG is " +
        "listed.",
      items: { type: "string" },
      type: "array",
    },
    lazyLoad: { type: "boolean" },
    optimize: { type: "boolean" },
    picture: {
      description:
        "Wrap a multi-format image in a <picture> with one <source> per format (default true). " +
        "With it off the <img> carries a srcset in the preferred format alone, which browsers " +
        "that cannot decode that format will still select from.",
      type: "boolean",
    },
    quality: {
      description:
        "Lossy quality per format, 1 to 100 (defaults: avif 65, jpeg 80). The build writes png " +
        "and webp losslessly, so png is never read and webp is read only by the cloudflare " +
        "service, as the quality of its transform URLs (default 80).",
      properties: {
        avif: { type: "number" },
        jpeg: { type: "number" },
        png: { type: "number" },
        webp: { type: "number" },
      },
      type: "object",
    },
    remoteDomains: {
      description:
        "Hostnames whose remote (https) images are optimized through /cdn-cgi/image transform " +
        'URLs (cloudflare service only), e.g. ["drive.usercontent.google.com"]. Remote sources ' +
        "from other hosts are left untouched.",
      items: { type: "string" },
      type: "array",
    },
    service: {
      description:
        'How images are optimized: "build" encodes variants at build time; "cloudflare" emits ' +
        "/cdn-cgi/image transform URLs served by Cloudflare Image Transformations (requires " +
        "the feature to be enabled on the serving zone).",
      enum: ["build", "cloudflare"],
      type: "string",
    },
    sizes: { type: "string" },
    widths: { items: { type: "number" }, type: "array" },
  },
  type: "object",
} as const;
