/**
 * The modules an entry cannot evaluate without — its STATIC import closure — read off a bundler
 * metafile, as the package-relative paths a document's `<link rel="modulepreload">` hints name.
 *
 * Why a closure and not the entry's own import list: a browser discovers a module's static imports
 * only once it has fetched and parsed that module, so a chunk two hops from the entry is fetched
 * two round trips after the entry is. The split studio build hangs about sixty chunks off
 * `dist/studio.js` this way. Naming every one of them up front lets the browser fetch the whole
 * startup graph in parallel with the entry instead of discovering it a layer at a time.
 *
 * Only `import-statement` edges are followed, never `dynamic-import`. A dynamic `import()` is how
 * the studio keeps Monaco, the collab stack and the grid engine OFF the startup path (studio.md
 * §11.1); preloading what one reaches would put the payload straight back on it, which is the
 * failure that section exists to forbid.
 *
 * Pure: the build hands it `Bun.build({ metafile: true }).metafile`, and the tests hand it a
 * literal.
 */

/** The slice of a Bun (or esbuild) metafile this reads. */
export interface PreloadMetafile {
  readonly outputs: Readonly<
    Record<
      string,
      { readonly imports?: readonly { readonly path: string; readonly kind: string }[] }
    >
  >;
}

/** Bun keys outputs `./chunks/x.js`, relative to `outdir`; esbuild has no `./`. Compare without it. */
function bare(path: string): string {
  return path.replace(/^\.\//, "");
}

/**
 * Every output the entry reaches through static imports, transitively, excluding the entry itself.
 *
 * @param metafile The build's metafile.
 * @param entry The entry's output path, relative to the build's `outdir` (`"studio.js"`).
 * @param prefix Prepended to every result to make it package-relative (`"dist/"`).
 * @returns The closure, deduplicated and sorted, so a rebuild of the same graph writes the same
 *   bytes.
 * @throws {Error} When the metafile has no such entry. An empty list would be a valid answer for an
 *   entry with no static imports, so a mistyped entry must not be able to produce one.
 */
export function staticImportClosure(
  metafile: PreloadMetafile,
  entry: string,
  prefix = "",
): string[] {
  const outputs = new Map(Object.entries(metafile.outputs).map(([k, v]) => [bare(k), v]));
  const root = bare(entry);
  if (!outputs.has(root)) {
    throw new Error(
      `the metafile has no output ${root} (it has ${[...outputs.keys()].length} outputs) — ` +
        `pass the entry's path relative to outdir`,
    );
  }
  const seen = new Set<string>([root]);
  const queue = [root];
  for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
    for (const edge of outputs.get(path)?.imports ?? []) {
      const target = bare(edge.path);
      /* An import that names no output is external to this build (a bare url the bundler left
         alone); there is no emitted file to preload, and check-studio-dist proves every one that
         IS listed exists. */
      if (edge.kind !== "import-statement" || seen.has(target) || !outputs.has(target)) {
        continue;
      }
      seen.add(target);
      queue.push(target);
    }
  }
  seen.delete(root);
  return [...seen].map((path) => `${prefix}${path}`).toSorted();
}
