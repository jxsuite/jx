/**
 * The studio bundle contract, shared by every build path.
 *
 * There are TWO of those paths, which is the whole reason this file exists:
 *
 * - `scripts/build.ts` — the release build. Feeds the npm tarball, the desktop app bundle, and the
 *   cloud platform's static assets.
 * - The repo dev server (`server.js` → `@jxsuite/server`'s `builds` watcher) — rebuilds
 *   `packages/studio/dist` on every source change while you work.
 *
 * They used to disagree. The dev watcher had its own inline config with no Monaco de-duplication
 * and no code splitting, so `bun run dev` served an 18.8 MB bundle with Monaco in it twice while
 * `bun run build` produced 3.3 MB — and since the watcher overwrites `dist/` on the next keystroke,
 * a developer never saw the built output at all. Both paths now spread {@link studioBundleOptions},
 * so a change to the contract cannot reach one and miss the other.
 */

import { join } from "node:path";
import type { BuildConfig } from "bun";
import { writeAssetManifest } from "../src/hosting/stage.ts";

/** The studio package root, derived from this file's location. */
export const STUDIO_DIR = join(import.meta.dir, "..");

/*
 * THERE IS NO MONACO DE-DUPLICATION PLUGIN HERE ANY MORE, and the reason is worth keeping.
 *
 * A `dedupe-monaco` `onResolve` hook used to force every `monaco-editor` specifier through
 * `Bun.resolveSync` from this package — because there were TWO importers with two resolutions:
 * studio's own `monaco-editor/esm/...` went through `packages/studio/node_modules/monaco-editor`
 * (a symlink into `node_modules/.bun/…`) while `y-monaco`'s bare `monaco-editor` resolved to the
 * physically separate copy hoisted at the workspace root. Same version, two paths, so the bundler
 * emitted Monaco TWICE — 5.1 MB, 27% of the bundle.
 *
 * Replacing y-monaco with the first-party binding (`src/collab/monaco-binding.ts`) left exactly one
 * importer, so the hook became an identity transform. Verified rather than reasoned: a `bun build
 * --metafile` pass, which does NOT install this plugin, reports **one** physical
 * `monaco-editor` root in the input graph, and removing the plugin left the emitted bundle
 * byte-identical.
 *
 * If a second consumer of `monaco-editor` is ever added, check the metafile before assuming this
 * stays true.
 */

/**
 * Bundler options every studio build must use. Spread into a `Bun.build` call (or into a
 * `@jxsuite/server` `builds` entry, which forwards unknown keys to `Bun.build`).
 *
 * Entrypoints and `outdir` are deliberately absent — the caller owns those, and each entry must be
 * built in its OWN pass: a single multi-entry build roots its output at the entrypoints' common
 * ancestor (`src/`), which nests the iframe bundle under `dist/canvas/` and breaks `canvas.html`'s
 * flat `./dist/iframe-entry.js` import.
 */
export const studioBundleOptions = {
  format: "esm",
  /*
   * Naming is a CONTRACT, not a detail. Entries stay at flat, unhashed `dist/<name>.js` because four
   * consumers address them by fixed path: `index.html`, `canvas.html`,
   * `packages/desktop/scripts/stage-studio-assets.ts`, and the platform's `scripts/build-assets.ts`.
   * Split chunks are content-hashed (they are only ever reached through an import in an entry) and
   * land in `dist/chunks/`, which those consumers copy wholesale.
   */
  naming: {
    asset: "[name].[ext]",
    chunk: "chunks/[name]-[hash].[ext]",
    entry: "[name].[ext]",
  },
  sourcemap: "linked",
  /*
   * Splitting is what makes the ~18 `await import()` sites in studio src defer PAYLOAD rather than
   * just evaluation — without it Bun inlines them all into the entry, so Monaco, yjs, ajv and
   * pragmatic-dnd's element adapter ship on every cold start regardless.
   */
  splitting: true,
  target: "browser",
} satisfies Partial<BuildConfig>;

/**
 * What the RELEASE build adds on top of {@link studioBundleOptions}, and the dev watcher does not.
 *
 * Minification is release-only on purpose. The dev watcher exists so a developer can read what they
 * are running — a stack trace that names `renderInspector` at a real line is worth more on a dev
 * box than the bytes — and the linked source maps the shared contract already emits are what keep a
 * minified release debuggable instead.
 *
 * NAMES ARE NOT KEPT, whatever `keepNames` says. It is set because it states the intent and costs
 * nothing, but Bun 1.4.2 ignores it: `Bun.build` with `minify.keepNames` (and `bun build --minify
 * --keep-names`) emits byte-identical output to the same build without it, and a nested `class
 * InnerThing {}` reports `InnerThing.name === "n"` either way. Measured on this bundle the option
 * moves the release output by under a kilobyte in 9 MB. So what actually makes minifying safe is a
 * survey, not the flag: in the emitted unminified bundle nothing in the first-party graph reads a
 * function or class name — every `Error` subclass assigns its `name` as a string literal, and every
 * `.name ===` comparison is on a data record — and the vendored readers only ever see a native
 * constructor or format a message. Babel's `_unsupportedIterableToArray` compares
 * `constructor.name` against `"Map"`/`"Set"` (native, never renamed); `lib0/schema` (yjs) prints
 * `constructor.name` in validation errors; Monaco's instantiation service prints `ctor.name` in its
 * diagnostics and `observableInternal/debugName` derives debug labels from it; TypeScript's
 * `Debug.getFunctionName` in the TS worker formats assertion messages with `func.name`. A new
 * dependency that DISPATCHES on a name would break in the release build only — grep the unminified
 * bundle for `constructor.name` / `ctor.name` before assuming otherwise, and check whether a newer
 * Bun has started honouring the flag.
 */
export const studioReleaseOptions = {
  minify: { identifiers: true, keepNames: true, syntax: true, whitespace: true },
} satisfies Partial<BuildConfig>;

/**
 * Compile-time constants the release build adds, kept apart from {@link studioReleaseOptions} so
 * each change can be measured, and reverted, on its own.
 *
 * `process.env.NODE_ENV` is what `@vue/reactivity`'s esm-bundler build gates its development
 * branches on — the `[Vue warn]` reporter, the effect-scope and cleanup misuse warnings, the
 * dependency-tracking debug hooks. Left undefined, Bun folds the test to "not production" for a
 * browser target, so every release shipped the development build of the reactivity core into both
 * entries. Monaco reads no `NODE_ENV`, which is why the worker passes do not take this.
 */
export const studioReleaseDefine = {
  "process.env.NODE_ENV": JSON.stringify("production"),
} as const satisfies Record<string, string>;

/**
 * Rewrite `dist/manifest.json` WITHOUT the release build's `preload` list. The dev server calls
 * this before its watcher's first build, and it is the dev path's half of the manifest contract.
 *
 * `preload` names content-hashed chunks, so it is true only of the build that wrote it. The watcher
 * then replaces `dist/studio.js` with an unminified, non-production build whose chunks hash
 * differently, and it never cleans `dist/`, so the release chunks stay on disk beside the new ones.
 * A list kept across that would pass every existence check — `studioPreload`'s and rule 5 of
 * check-studio-dist.ts alike — while naming chunks the running entry never imports: a host on a
 * `--link` checkout would preload a few MB of dead code and the browser would warn "preloaded but
 * not used" for each. The watcher computes no closure, so it writes no field, which is exactly what
 * {@link writeAssetManifest} does when it is handed none.
 *
 * @param root The studio package root; a test passes a temp tree.
 */
export async function forgetReleasePreload(root: string = STUDIO_DIR): Promise<void> {
  await writeAssetManifest(root);
}

/** The two studio entrypoints, relative to the studio package root, in build order. */
export const STUDIO_ENTRYPOINTS = ["./src/studio.ts", "./src/canvas/iframe-entry.ts"] as const;
