/**
 * blog.js — external function for blog.json
 *
 * With the new state grammar, the selectPost handler is defined inline
 * as a $prototype: "Function" entry with `body`. This sidecar is
 * kept as documentation of the external $src pattern.
 */

export function selectPost(state, event) {
  const slug = event.target.dataset?.slug;
  if (slug) {
    state.currentSlug = slug;
  }
}
