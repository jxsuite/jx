/**
 * Copy the studio tree somewhere a host can serve it.
 *
 * CONVENIENCE, not contract. Everything a subscriber strictly needs is in `./layout` (the manifest
 * and {@link assetUrl}) and `./document` (the two generators), both of which are pure and run
 * anywhere. This module exists so the two Bun consumers — the desktop's asset staging and
 * jx-platform's `public/` build — do not each write the same copier, and it is the ONLY module
 * under `src/` that imports `node:`. A host in another runtime reads the manifest and moves the
 * bytes however it likes.
 *
 * @docs extending/embedding/hosting
 */

import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Glob } from "bun";
import { STUDIO_ASSETS, STUDIO_CANVAS, STUDIO_SHELL } from "./layout";
import type { AssetBase, StudioAsset, StudioAssetKind, StudioLayoutMode } from "./layout";
import { canvasShellHtml } from "./document";
import type { DocumentOptions } from "./document";

/** The installed package root, resolved off this module rather than off a caller's cwd. */
export const STUDIO_PACKAGE_DIR = resolve(import.meta.dir, "..", "..");

/**
 * Normalize a `Glob.scan` result to forward slashes. Private and un-exported, like
 * `project-session.ts`'s own `toPosix()`: this is the one module under `src/` that touches
 * filesystem paths at all, and its published `files` entry (`package.json`) covers `src/` but not
 * the repo's dev-tooling `scripts/lib/posix-path.ts`, so a cross-boundary import here would 404 for
 * anyone who installed this package rather than checked out the monorepo.
 */
function toPosix(p: string): string {
  return p.replaceAll("\\", "/");
}

export interface StageOptions {
  /** Package root to read from — an installed copy, or a `--link` checkout. */
  readonly from?: string | undefined;
  /** Kinds to leave out. The cloud passes `["document"]`; see the note on {@link stageStudioAssets}. */
  readonly exclude?: readonly StudioAssetKind[] | undefined;
  /** Copy `*.map` too. Default false: the chunk maps alone are about 24 MB. */
  readonly sourceMaps?: boolean | undefined;
  /**
   * Remove the manifest's own paths under `destDir` first. Default true.
   *
   * Only those paths, never the whole directory. `packages/desktop/scripts/pre-build.ts` writes its
   * launcher's PAL-init bundle to `assets/studio/dist/init.js` BEFORE staging, so a blanket wipe
   * deletes it and the packaged app boots with no platform registered. Not cleaning at all is
   * equally wrong: content-hashed chunks would accumulate in a staged tree forever.
   */
  readonly clean?: boolean | undefined;
  /** Layout to report in {@link StageResult.base}. Default `"nested"`. */
  readonly layout?: StudioLayoutMode | undefined;
  /** Url prefix to report in {@link StageResult.base}. Default `"./"`. */
  readonly prefix?: string | undefined;
}

export interface StageResult {
  /**
   * The base the tree was staged at — hand it straight to {@link studioShellHtml}, so the stager and
   * the document cannot disagree about where the files went.
   */
  readonly base: AssetBase;
  /** Package-relative paths written, in manifest order. */
  readonly written: readonly string[];
  readonly bytes: number;
}

/** Manifest entries absent from `root`. Empty means the tree is complete. */
export function missingStudioAssets(root: string = STUDIO_PACKAGE_DIR): readonly StudioAsset[] {
  return STUDIO_ASSETS.filter((a) => a.required && !existsSync(join(root, a.path)));
}

/** Where a package-relative path lands under `destDir`, honouring the layout. */
function destOf(destDir: string, path: string, layout: StudioLayoutMode): string {
  return join(destDir, layout === "flat" ? path.replace(/^dist\//, "") : path);
}

/**
 * Copy the tree into `destDir`.
 *
 * @throws {Error} Naming the entry AND its `why` when a required one is missing — a staging failure
 *   should say what the reader will lose, not just which file was absent.
 */
export async function stageStudioAssets(
  destDir: string,
  options: StageOptions = {},
): Promise<StageResult> {
  const from = options.from ?? STUDIO_PACKAGE_DIR;
  const layout = options.layout ?? "nested";
  const exclude = new Set(options.exclude);
  const entries = STUDIO_ASSETS.filter((a) => !exclude.has(a.kind));

  const absent = entries.filter((a) => a.required && !existsSync(join(from, a.path)));
  if (absent.length > 0) {
    const listed = absent.map((a) => `  ${a.path} — ${a.why}`).join("\n");
    throw new Error(
      `@jxsuite/studio is missing ${absent.length} required asset(s) at ${from}:\n${listed}\n` +
        `Run \`bun run build\` in packages/studio, or check the package's published files list.`,
    );
  }

  if (options.clean !== false) {
    for (const a of entries) {
      await rm(destOf(destDir, a.path, layout), { force: true, recursive: true });
    }
  }

  const written: string[] = [];
  let bytes = 0;
  const skipMap = (p: string) => !options.sourceMaps && p.endsWith(".map");

  for (const a of entries) {
    const src = join(from, a.path);
    if (!existsSync(src)) {
      continue;
    }
    const dest = destOf(destDir, a.path, layout);
    if (a.dir) {
      await mkdir(dest, { recursive: true });
      for (const rawRel of new Glob("**/*").scanSync(src)) {
        const posix = toPosix(rawRel);
        if (skipMap(posix)) {
          continue;
        }
        const file = join(src, posix);
        const to = join(dest, posix);
        await mkdir(dirname(to), { recursive: true });
        await cp(file, to);
        written.push(`${a.path}/${posix}`);
        const info = await stat(file);
        bytes += info.size;
      }
    } else {
      if (skipMap(a.path)) {
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await cp(src, dest);
      written.push(a.path);
      const info = await stat(src);
      bytes += info.size;
    }
  }

  return { base: { mode: layout, prefix: options.prefix ?? "./" }, bytes, written };
}

export interface ReadDocumentOptions extends DocumentOptions {
  /** Package root to read `canvas.html` from. */
  readonly from?: string | undefined;
}

/* There is no shellDocument() here. The editor document needs no file read, so it would be a
   re-export of studioShellHtml under a second name — a host imports `./hosting/document` for it,
   which is also the entry that stays pure. */

/** The canvas document, read from the package and rebased. */
export async function canvasDocument(options: ReadDocumentOptions = {}): Promise<string> {
  const from = options.from ?? STUDIO_PACKAGE_DIR;
  const html = await readFile(join(from, STUDIO_CANVAS), "utf8");
  return canvasShellHtml(html, options.base);
}

/** What the build knows that the source does not, written beside {@link STUDIO_ASSETS}. */
export interface AssetManifestExtra {
  /**
   * The editor entry's static import closure, as package-relative paths
   * (`"dist/chunks/studio-abcd1234.js"`). See {@link studioPreload}.
   */
  readonly preload?: readonly string[] | undefined;
}

/** The manifest's file, under a package root. */
function manifestPath(root: string): string {
  return join(root, "dist", "manifest.json");
}

/**
 * Write `dist/manifest.json` — {@link STUDIO_ASSETS} as data, for a host that cannot import
 * TypeScript, plus whatever the build measured. Called by the build; gated against the emitted tree
 * by check-studio-dist.ts.
 *
 * `preload` lives HERE, and not in `./layout`, because it names content-hashed chunks: it is a fact
 * about one build's output, true of the `dist/` it was written beside and of no other. A field that
 * is not passed is not written, rather than written empty — "this build computed nothing" and "this
 * build's entry has no static imports" are different statements.
 */
export async function writeAssetManifest(
  root: string = STUDIO_PACKAGE_DIR,
  extra: AssetManifestExtra = {},
): Promise<void> {
  const out = manifestPath(root);
  await mkdir(dirname(out), { recursive: true });
  const manifest = {
    assets: STUDIO_ASSETS,
    ...(extra.preload === undefined ? {} : { preload: extra.preload }),
    shell: STUDIO_SHELL,
  };
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * The modules to hint as `<link rel="modulepreload">`, read from an installed package's
 * `dist/manifest.json` — hand the result to `studioShellHtml({ preload })`.
 *
 * The editor entry statically imports a few dozen split chunks, and those import more; a browser
 * finds each layer only after parsing the one above it. The release build records the whole static
 * closure, so a host that serves the shell can name it up front and the chunks download in parallel
 * with the entry. Dynamic imports are never in it — Monaco and the other on-demand payloads stay
 * off the startup path (studio.md §11.1).
 *
 * Opt-in, and empty rather than failing when there is nothing to read: a source checkout that has
 * never been built has no manifest, and a manifest from a build that predates the field has no
 * `preload`. Both mean "no hints", which is exactly what a host got before this existed. A manifest
 * that exists but is not JSON still throws, because that is a damaged install, not an old one.
 *
 * An entry that is not on disk under `root` is dropped: a hint for a missing chunk is a 404 on
 * every cold start, and fewer hints is the better failure. That catches a `dist/` cleaned after the
 * release build, NOT one the repo dev watcher rebuilt over it — there the release chunks are still
 * on disk, just no longer imported, which is why the dev server drops the field itself before its
 * first build (`forgetReleasePreload` in scripts/build-config.ts). A checkout the watcher has run
 * on therefore reads as "no hints", the same as one never built.
 *
 * @param root Package root to read from — an installed copy, or a `--link` checkout.
 * @returns Package-relative module paths, in the order the manifest lists them.
 */
export async function studioPreload(root: string = STUDIO_PACKAGE_DIR): Promise<string[]> {
  const path = manifestPath(root);
  if (!existsSync(path)) {
    return [];
  }
  const manifest = JSON.parse(await readFile(path, "utf8")) as { preload?: unknown };
  const { preload } = manifest;
  if (!Array.isArray(preload)) {
    return [];
  }
  return preload.filter(
    (p): p is string => typeof p === "string" && existsSync(join(root, ...p.split("/"))),
  );
}
