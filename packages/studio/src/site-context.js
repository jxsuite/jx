/**
 * Site context helpers — merge site-level definitions with file-level.
 *
 * When a project has a site.json, its $media and style cascade into every file. File-level
 * definitions merge on top (file wins on conflict).
 */

import { projectState } from "./store.js";

/**
 * Merge site $media with document $media. Document keys win on conflict.
 *
 * @param {any} docMedia — the current document's $media (may be undefined)
 * @returns {any}
 */
export function getEffectiveMedia(docMedia) {
  const siteMedia = projectState?.siteConfig?.$media;
  if (!siteMedia) return docMedia || {};
  if (!docMedia) return { ...siteMedia };
  return { ...siteMedia, ...docMedia };
}

/**
 * Merge site style with document style. Document keys win on conflict. Nested selector objects
 * (e.g. `& li`) are shallow-merged individually.
 *
 * @param {any} docStyle — the current document's style (may be undefined)
 * @returns {any}
 */
export function getEffectiveStyle(docStyle) {
  const siteStyle = projectState?.siteConfig?.style;
  if (!siteStyle) return docStyle || {};
  if (!docStyle) return { ...siteStyle };
  const merged = { ...siteStyle };
  for (const [k, v] of Object.entries(docStyle)) {
    if (
      typeof v === "object" &&
      v !== null &&
      typeof merged[k] === "object" &&
      merged[k] !== null
    ) {
      merged[k] = { ...merged[k], ...v };
    } else {
      merged[k] = v;
    }
  }
  return merged;
}

/**
 * Merge site imports with document imports. Document keys win on conflict.
 *
 * @param {any} docImports — the current document's imports (may be undefined)
 * @returns {any}
 */
export function getEffectiveImports(docImports) {
  const siteImports = projectState?.siteConfig?.imports;
  if (!siteImports) return docImports || {};
  if (!docImports) return { ...siteImports };
  return { ...siteImports, ...docImports };
}
