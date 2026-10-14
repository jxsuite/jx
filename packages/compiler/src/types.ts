/**
 * `HeadMergeContext` moved to `@jxsuite/site/head-merger` with the merger itself — a browser bundle
 * and a Worker both assemble the same `<head>`, and neither can import this package.
 */
export type { HeadMergeContext } from "@jxsuite/site/head-merger";

/**
 * `SiteRoute` is owned by `@jxsuite/site/context`, whose `injectContext` is the consumer that reads
 * it; the site build hands the same route to both, so there is one declaration of its shape.
 */
export type { SiteRoute } from "@jxsuite/site/context";
