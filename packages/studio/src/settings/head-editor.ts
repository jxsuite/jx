/**
 * The Site head section's seam into the settings registry.
 *
 * `settings/settings-document.ts` registers this section as `{ key: "head", render:
 * renderHeadEditor }`, and that contract did not change when the surface did: a section is a
 * contribution to CONFIGURATION, not to any particular way of drawing one
 * (`./section-registry.ts`). What used to be a lit template over Spectrum here is the
 * `settings-head` surface now — a Jx document over the kit, mounted by `surfaces/settings-head.ts`,
 * which is where the section's behaviour lives.
 *
 * @docs studio/projects/settings
 */

export { renderHeadEditor } from "../surfaces/settings-head";
