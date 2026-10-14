/**
 * What the BUILD emitted, checked against what the package says it ships.
 *
 * `check-studio-package.ts` is source-only and runs everywhere; this one needs a real `bun run
 * build`, because the questions it asks are about emitted bytes. They are the questions that let
 * `dist/codicon.ttf` go missing for months: the build emitted a file, the shipped CSS referenced
 * it, and nothing compared the two.
 *
 * Five rules:
 *
 * 1. **Every required manifest entry exists.** The floor.
 * 2. **Every emitted file under `dist/` is accounted for** — matched by a manifest entry or by the
 *    exclude list. This is the codicon catcher: the next unhashed asset a dependency drops into
 *    `dist/` is a red X on the day it appears rather than a silent 404 in three distributions.
 * 3. **Every `url()` in emitted CSS resolves**, against its own file's directory. Codicon again, from
 *    the reference side: `dist/studio.css` says `./codicon.ttf` and three chunk stylesheets say
 *    `../codicon.ttf`, and both have to land on a real file.
 * 4. **Every emitted stylesheet is reachable** — named by an emitted JS or by a document. This
 *    surfaces something nobody had named: the chunk stylesheets are referenced by nothing at all.
 *    Carried on a ratcheting allow-list so the finding is recorded without blocking on deleting
 *    it.
 * 5. **The manifest's `preload` list is real.** Every entry exists under `dist/` and is a split chunk,
 *    and after a release build the list is not empty. A host turns each entry into a `<link
 *    rel="modulepreload">`, so a stale name is a 404 on every cold start and an empty list is the
 *    optimisation silently switched off — both with a working editor and nothing in the console,
 *    which is the shape every rule in this file exists to catch.
 *
 * Run in the gated `studio-dist` CI job, after the build.
 */

import { Glob } from "bun";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative, resolve } from "node:path";
import { isJsonObject } from "@jxsuite/schema/guards";
import type { JsonValue } from "@jxsuite/schema/types";
import type { Problem } from "./check-studio-package.ts";
import { toPosixPath } from "./lib/posix-path";
import { STUDIO_ASSETS, STUDIO_WORKERS } from "../src/hosting/layout";

/** Where the build writes the manifest, relative to the package root. */
export const MANIFEST = "dist/manifest.json";

const PKG_DIR = resolve(import.meta.dir, "..");

/**
 * Emitted CSS that nothing loads.
 *
 * A shrinking backlog. Bun emits a stylesheet per chunk for CSS reached through a dynamic import,
 * but injects no link for it and no emitted JS names it — so about 687 KB of Monaco's CSS ships and
 * is never applied, while `dist/studio.css` carries the same rules and is. Recorded rather than
 * deleted here, because the fix is a build-configuration question and this is a gate.
 */
export const UNREACHABLE_CSS: readonly string[] = [
  "dist/chunks/grid-view-*.css",
  "dist/chunks/javascript-*.css",
  "dist/chunks/jsonMode-*.css",
  "dist/chunks/monaco-setup-*.css",
  "dist/chunks/tsMode-*.css",
];

/** POSIX paths of everything emitted under `dist/`, relative to the package root. */
export function emittedFiles(distDir: string, pkgDir: string): string[] {
  if (!existsSync(distDir)) {
    return [];
  }
  return [...new Glob("**/*").scanSync(distDir)]
    .map((rel) => posix.join(toPosixPath(relative(pkgDir, distDir)), toPosixPath(rel)))
    .toSorted();
}

/** Does a manifest entry (a file, or a directory that ships wholesale) account for `path`? */
export function accountedFor(path: string): boolean {
  if (path.endsWith(".map")) {
    return true;
  }
  return STUDIO_ASSETS.some((a) => (a.dir ? path.startsWith(`${a.path}/`) : a.path === path));
}

export function unaccounted(emitted: readonly string[]): Problem[] {
  return emitted.flatMap((p) =>
    accountedFor(p)
      ? []
      : [
          {
            detail: `${p} is emitted but no manifest entry accounts for it — add it to STUDIO_ASSETS or to STUDIO_ASSET_EXCLUDE`,
            rule: "unaccounted",
          },
        ],
  );
}

/** Every `url(...)` in `css`, ignoring data uris and absolute urls. */
export function cssUrls(css: string): string[] {
  return [...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].flatMap((m) => {
    const url = m[2]!.trim();
    if (/^(?:data:|https?:|\/\/|#)/.test(url)) {
      return [];
    }
    const path = url.split(/[?#]/)[0]!;
    return path ? [path] : [];
  });
}

export function danglingUrls(pkgDir: string, cssFiles: readonly string[]): Problem[] {
  const findings: Problem[] = [];
  for (const rel of cssFiles) {
    for (const url of cssUrls(readFileSync(join(pkgDir, rel), "utf8"))) {
      const target = posix.normalize(posix.join(posix.dirname(rel), url));
      if (!existsSync(join(pkgDir, target))) {
        findings.push({
          detail: `${rel} references ${url}, which resolves to ${target} — and that file is not there`,
          rule: "dangling-url",
        });
      }
    }
  }
  return findings;
}

export function unreachableStylesheets(
  pkgDir: string,
  cssFiles: readonly string[],
  jsFiles: readonly string[],
): Problem[] {
  const allowed = UNREACHABLE_CSS.map((p) => new Glob(p));
  const bodies = jsFiles.map((f) => readFileSync(join(pkgDir, f), "utf8"));
  const documents = ["index.html", "canvas.html"].flatMap((d) =>
    existsSync(join(pkgDir, d)) ? [readFileSync(join(pkgDir, d), "utf8")] : [],
  );
  return cssFiles.flatMap((rel) => {
    if (rel === "dist/studio.css" || allowed.some((g) => g.match(rel))) {
      return [];
    }
    const name = rel.split("/").pop()!;
    if ([...bodies, ...documents].some((body) => body.includes(name))) {
      return [];
    }
    return [
      {
        detail: `${rel} is emitted but no emitted script and no document names it`,
        rule: "unreachable-css",
      },
    ];
  });
}

/**
 * Rule 5: the manifest's `preload` list against the emitted tree.
 *
 * The gate runs after a release build, and the release build always writes the field, so an absent
 * manifest or an absent/empty field is a finding rather than "nothing to check". The chunk test is
 * the manifest's own `chunk` entry rather than a hard-coded `dist/chunks/`: a preload hint for an
 * entry or a stylesheet would be a different kind of mistake, and the gate should say so.
 */
export function preloadFindings(pkgDir: string, emitted: readonly string[]): Problem[] {
  const path = join(pkgDir, MANIFEST);
  if (!existsSync(path)) {
    return [{ detail: `${MANIFEST} is absent — the release build writes it`, rule: "preload" }];
  }
  const manifest: JsonValue = JSON.parse(readFileSync(path, "utf8"));
  // A manifest that is not an object has no preload list either, and is reported as one without.
  const preload = isJsonObject(manifest) ? manifest.preload : undefined;
  if (!Array.isArray(preload) || preload.length === 0) {
    return [
      {
        detail:
          `${MANIFEST} has no preload list after a release build — the editor entry's static ` +
          `import closure was not recorded, so a host opting into modulepreload hints gets none`,
        rule: "preload",
      },
    ];
  }
  const chunkDirs = STUDIO_ASSETS.filter((a) => a.kind === "chunk").map((a) => `${a.path}/`);
  const present = new Set(emitted);
  const findings: Problem[] = [];
  for (const entry of preload) {
    const name = String(entry);
    if (!present.has(name)) {
      findings.push({
        detail: `${MANIFEST} preloads ${name}, which the build did not emit — every host that hints it 404s on cold start`,
        rule: "preload",
      });
    } else if (!name.endsWith(".js") || !chunkDirs.some((dir) => name.startsWith(dir))) {
      findings.push({
        detail: `${MANIFEST} preloads ${name}, which is not a split chunk — only the editor entry's static chunk imports belong there`,
        rule: "preload",
      });
    }
  }
  return findings;
}

export function analyze(pkgDir = PKG_DIR): Problem[] {
  const distDir = join(pkgDir, "dist");
  const emitted = emittedFiles(distDir, pkgDir);
  if (emitted.length === 0) {
    return [{ detail: "dist/ is empty — run `bun run build` first", rule: "build" }];
  }
  const css = emitted.filter((p) => p.endsWith(".css"));
  const js = emitted.filter((p) => p.endsWith(".js"));

  const missing = STUDIO_ASSETS.filter((a) => a.required && !existsSync(join(pkgDir, a.path))).map(
    (a) => ({ detail: `${a.path} is required and absent — ${a.why}`, rule: "missing" }),
  );
  const workers = STUDIO_WORKERS.filter((w) => !existsSync(join(distDir, "workers", w))).map(
    (w) => ({ detail: `dist/workers/${w} is absent`, rule: "missing" }),
  );

  const staleAllowed = UNREACHABLE_CSS.flatMap((pattern) =>
    css.some((rel) => new Glob(pattern).match(rel))
      ? []
      : [
          {
            detail: `UNREACHABLE_CSS allows ${pattern}, which nothing emits any more — delete the entry`,
            rule: "stale-allowlist",
          },
        ],
  );

  return [
    ...missing,
    ...workers,
    ...unaccounted(emitted),
    ...danglingUrls(pkgDir, css),
    ...unreachableStylesheets(pkgDir, css, js),
    ...preloadFindings(pkgDir, emitted),
    ...staleAllowed,
  ];
}

/** The report, as lines. Pure, so the runner is one call. */
export function report(findings: readonly Problem[], pkgDir = PKG_DIR): string[] {
  if (findings.length === 0) {
    const dist = emittedFiles(join(pkgDir, "dist"), pkgDir);
    const bytes = dist.reduce((n, p) => n + statSync(join(pkgDir, p)).size, 0);
    return [
      `✓ check-studio-dist: ${dist.length} emitted file(s), ${(bytes / 1e6).toFixed(1)} MB, all ` +
        `accounted for; every css url() resolves; every preloaded chunk exists; ` +
        `${UNREACHABLE_CSS.length} unreachable stylesheet pattern(s) on the backlog.`,
    ];
  }
  return [
    "",
    "The studio build and the manifest disagree:",
    "",
    ...findings
      .toSorted((a, b) => a.rule.localeCompare(b.rule))
      .map((f) => `  [${f.rule}] ${f.detail}`),
  ];
}

if (import.meta.main) {
  const findings = analyze();
  console.log(report(findings).join("\n"));
  process.exit(findings.length > 0 ? 1 : 0);
}
