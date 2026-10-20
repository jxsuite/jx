/**
 * Where a live render imports an `npm:` package from (spec.md §5.3, 4c).
 *
 * The dev server answers `/node_modules/<package>/<subpath>` by resolving the package's `exports`
 * and bundling the entry on demand (`@jxsuite/server`), the same URL space a bare `$elements`
 * specifier and a bare `$head` asset are already fetched from. Both realms that render a project
 * live install it into the runtime (`setNpmModuleResolver`): the canvas frame against its own
 * address, and the editor window, which draws the Site panel's and the Content home's previews,
 * against the project's asset origin.
 *
 * Dependency-free so it rides in the slim canvas bundle.
 */

/**
 * The URL a package specifier is imported from, under `base`.
 *
 * @param specifier - `@scope/pkg/subpath`, as the document wrote it after `npm:`
 * @param base - The origin (or any URL on it) that serves the project
 */
export function npmModuleUrl(specifier: string, base: string): string {
  return new URL(`/node_modules/${specifier}`, base).href;
}
