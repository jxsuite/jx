/**
 * Build the kit's compiled distribution into `dist/` (ui.md §9).
 *
 * Run it with `bun run build:ui` (the kit's own `build` script). The root `bun run build` runs it
 * too, which is what a release does before it packs, so `packages/ui/dist/` is a build output:
 * gitignored, never committed, and in the published package because `files` names it.
 *
 * It lives here and not in `packages/ui` because it needs both the kit and the compiler, and the
 * kit must not depend on the compiler: Studio depends on the kit, so that edge would put every
 * compiler change in front of Studio's whole suite (`scripts/ci/affected.ts`).
 *
 * `@jxsuite/ui` registers by interpreting its component documents (`registerUi`), and that stays
 * the default. This is the optional other path: every document compiled ahead of time by
 * `compileElementPack`, so a page that ships the kit loads element classes and neither the
 * documents nor the interpreter that reads them.
 *
 * Two steps. The compiler writes one module per element, whose `$src` behaviours it imports from
 * `src/` as TypeScript. A bundler pass then compiles those into the pack, so what is published is
 * JavaScript with two bare imports, `lit-html` and `@vue/reactivity`, and nothing a consumer has to
 * transpile. Each element stays its own entry, so `dist/jx-button.js` is importable alone and is
 * the path the manifest names; what two elements share goes to `dist/chunks/`.
 *
 * @docs extending/ui-kit
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { compileElementPack, writeElementPack } from "@jxsuite/compiler/pack";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";

import { themeCSS } from "../packages/ui/src/theme.ts";

/* `import.meta.dir`, not the pathname of `import.meta.url`: on Windows that pathname is
   `/D:/a/jx/...`, and `resolve` reads its leading slash as the current drive's root, which gave
   `D:\\D:\\a\\jx\\...` and failed the desktop build's first read under it. */
const PACKAGE_ROOT = resolve(import.meta.dir, "../packages/ui");

/** The scheme the kit's documents spell a behaviour module's `$src` in. */
const KIT_SCHEME = "jx-ui:/";

/**
 * A file path spelled as an import specifier.
 *
 * The compiler writes a specifier into a single-quoted string literal as it is, so it cannot carry
 * a backslash: on Windows `resolve` returns `D:\a\jx\jx\packages\ui\src\...`, and a literal holding
 * that reads `\u` as a broken unicode escape and `\a` as a bell, which failed the desktop build
 * with a `Syntax Error` in every element module that has a behaviour. Forward slashes name the same
 * file on every platform, and Bun resolves a drive-letter path spelled with them.
 *
 * @param path An absolute path in the host's own separator.
 * @returns The same path with forward slashes.
 */
export function toImportSpecifier(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * Where a kit document's `$src` behaviour module lives.
 *
 * @param specifier A `$src` that starts with `jx-ui:/`, or any other specifier, which is returned
 *   as it came.
 * @returns The specifier to import.
 */
export function kitModuleSpecifier(specifier: string): string {
  return specifier.startsWith(KIT_SCHEME)
    ? toImportSpecifier(resolve(PACKAGE_ROOT, "src", specifier.slice(KIT_SCHEME.length)))
    : specifier;
}

/** The stylesheet holding the kit's theme tokens, in its `@layer jx-ui`. */
export const THEME_STYLESHEET = "theme.css";

/** What a build wrote. */
export interface CompiledKit {
  /** The element tags compiled, each after the tags it renders. */
  tags: string[];
  /** Paths relative to the output directory. */
  files: string[];
  /** The manifest generator's warnings (spec.md §16.8). */
  warnings: string[];
}

/** The kit project's named media queries, which its documents' `@--name` blocks resolve against. */
function projectMedia(): Record<string, string> {
  /* SAFETY: JSON.parse only ever yields JSON values. */
  const project = JSON.parse(
    readFileSync(resolve(PACKAGE_ROOT, "project.json"), "utf8"),
  ) as JsonValue;
  const media = isJsonObject(project) ? project.$media : undefined;
  if (!isJsonObject(media)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(media).flatMap(([name, query]): [string, string][] =>
      isString(query) ? [[name, query]] : [],
    ),
  );
}

/**
 * Compile the kit into `outDir`.
 *
 * @param outDir The directory to write, replaced if it exists. Default is the package's `dist/`.
 */
export async function buildCompiledKit(
  outDir: string = resolve(PACKAGE_ROOT, "dist"),
): Promise<CompiledKit> {
  const pack = await compileElementPack({
    $media: projectMedia(),
    components: resolve(PACKAGE_ROOT, "components"),
    packDir: "dist",
    // A behaviour is imported from its source file, which the bundler pass below compiles in.
    rewriteSrc: kitModuleSpecifier,
  });

  rmSync(outDir, { force: true, recursive: true });
  mkdirSync(outDir, { recursive: true });
  // Staged inside the output directory so the stage and its bundle sit on one filesystem.
  const stage = mkdtempSync(join(outDir, ".stage-"));
  try {
    await writeElementPack(pack, stage);
    const modules = pack.files.filter((file) => file.path.endsWith(".js"));
    const result = await Bun.build({
      entrypoints: modules.map((file) => join(stage, file.path)),
      // The two modules every compiled element loads, and lit's own subpaths (a keyed list's).
      external: ["@vue/reactivity", "lit-html", "lit-html/*"],
      format: "esm",
      naming: { chunk: "chunks/chunk-[hash].[ext]", entry: "[name].[ext]" },
      outdir: outDir,
      splitting: true,
      target: "browser",
    });
    if (!result.success) {
      throw new Error(`Bundling the compiled kit failed:\n${result.logs.join("\n")}`);
    }
    const written = result.outputs.map((output) =>
      output.path.slice(outDir.length + 1).replaceAll("\\", "/"),
    );
    // Everything that is not a module is published as the compiler wrote it.
    for (const file of pack.files) {
      if (!file.path.endsWith(".js")) {
        writeFileSync(join(outDir, file.path), file.content, "utf8");
        written.push(file.path);
      }
    }
    writeFileSync(join(outDir, THEME_STYLESHEET), `${themeCSS()}\n`, "utf8");
    written.push(THEME_STYLESHEET);
    return { files: written.toSorted(), tags: pack.tags, warnings: pack.warnings };
  } finally {
    rmSync(stage, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const kit = await buildCompiledKit();
  for (const warning of kit.warnings) {
    console.warn(warning);
  }
  console.log(
    `Compiled ${kit.tags.length} kit element(s) into dist/ (${kit.files.length} file(s)).`,
  );
}
