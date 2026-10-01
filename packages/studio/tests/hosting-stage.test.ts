// oxlint-disable typescript/await-thenable -- bun test .rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * The staging convenience (src/hosting/stage.ts) and the packaging gate.
 *
 * `mock.module()` cannot stub a `node:` builtin in Bun, so these run against real temp trees — the
 * pattern `packages/desktop/tests/stage-studio-assets.test.ts` and
 * `packages/studio/tests/check-styles-orphans.test.ts` already use.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { STUDIO_ASSETS } from "../src/hosting/layout";
import {
  canvasDocument,
  missingStudioAssets,
  stageStudioAssets,
  studioPreload,
  writeAssetManifest,
} from "../src/hosting/stage";
import {
  backendDependencies,
  backendImports,
  escapingImports,
  filesCovers,
  nodeImports,
  publishGaps,
  publishedMaps,
  stylesheetDrift,
} from "../scripts/check-studio-package";
import { forgetReleasePreload } from "../scripts/build-config";

const temps: string[] = [];
afterAll(() => {
  for (const t of temps) {
    rmSync(t, { force: true, recursive: true });
  }
});

/** A package tree carrying every required manifest entry, plus whatever extras are asked for. */
function studioTree(extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "jx-stage-"));
  temps.push(root);
  const write = (rel: string, body: string) => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  };
  for (const a of STUDIO_ASSETS) {
    if (a.dir) {
      mkdirSync(join(root, a.path), { recursive: true });
    } else {
      write(a.path, `/* ${a.path} */`);
    }
  }
  write("dist/chunks/studio-abc123.js", "// chunk");
  write("dist/chunks/studio-abc123.js.map", "{}");
  write("dist/chunks/jsonMode-x.css", "/* chunk css */");
  for (const w of ["editor.worker.js", "json.worker.js", "ts.worker.js"]) {
    write(`dist/workers/${w}`, `// ${w}`);
  }
  write("styles/tokens.css", "/* tokens */");
  write("fonts/jetbrains-mono-400.woff2", "font");
  for (const [rel, body] of Object.entries(extra)) {
    write(rel, body);
  }
  return root;
}

function dest(): string {
  const d = mkdtempSync(join(tmpdir(), "jx-dest-"));
  temps.push(d);
  return d;
}

describe("stageStudioAssets", () => {
  test("copies the manifest, keeping the package's shape", async () => {
    const to = dest();
    const { base, written } = await stageStudioAssets(to, { from: studioTree() });
    expect(base).toEqual({ mode: "nested", prefix: "./" });
    for (const path of ["index.html", "dist/studio.js", "dist/codicon.ttf", "styles/tokens.css"]) {
      expect(existsSync(join(to, path)), `${path} was not staged`).toBe(true);
    }
    expect(written).toContain("dist/chunks/studio-abc123.js");
  });

  /* 24 MB of chunk maps, and the entries ship without their own maps anyway, so a chunk map alone
     could not resolve a stack frame. */
  test("leaves source maps behind unless asked", async () => {
    const from = studioTree();
    const a = dest();
    await stageStudioAssets(a, { from });
    expect(existsSync(join(a, "dist/chunks/studio-abc123.js.map"))).toBe(false);
    const b = dest();
    await stageStudioAssets(b, { from, sourceMaps: true });
    expect(existsSync(join(b, "dist/chunks/studio-abc123.js.map"))).toBe(true);
  });

  test("flat hoists dist/ up one level and leaves styles and fonts where they are", async () => {
    const to = dest();
    const { base } = await stageStudioAssets(to, {
      from: studioTree(),
      layout: "flat",
      prefix: "/",
    });
    expect(base).toEqual({ mode: "flat", prefix: "/" });
    expect(existsSync(join(to, "studio.js"))).toBe(true);
    expect(existsSync(join(to, "codicon.ttf"))).toBe(true);
    expect(existsSync(join(to, "chunks/studio-abc123.js"))).toBe(true);
    expect(existsSync(join(to, "workers/json.worker.js"))).toBe(true);
    // The pair that has to stay together for tokens.css's ../fonts/ to resolve.
    expect(existsSync(join(to, "styles/tokens.css"))).toBe(true);
    expect(existsSync(join(to, "fonts/jetbrains-mono-400.woff2"))).toBe(true);
  });

  /* The cloud passes this: copying the package's own index.html would publish a SECOND studio, one
     that boots resolveDefaultPlatform()'s dev-server adapter — and wrangler's SPA fallback answers
     its /__studio/* fetches with the marketing page at HTTP 200, so nothing errors and nothing
     logs. */
  test("exclude leaves a kind out entirely", async () => {
    const to = dest();
    await stageStudioAssets(to, { from: studioTree(), exclude: ["document"] });
    expect(existsSync(join(to, "index.html"))).toBe(false);
    expect(existsSync(join(to, "canvas.html"))).toBe(false);
    expect(existsSync(join(to, "dist/studio.js"))).toBe(true);
  });

  /* `packages/desktop/scripts/pre-build.ts` writes its launcher's PAL-init bundle into the staged
     dist/ BEFORE staging runs. A blanket wipe deletes it and the packaged app boots with no
     platform registered — which then self-registers the dev-server adapter and fetches /__studio/*
     against a views:// origin. */
  test("cleaning removes the manifest's paths and nothing else", async () => {
    const to = dest();
    const from = studioTree();
    await stageStudioAssets(to, { from });
    writeFileSync(join(to, "dist", "init.js"), "// the launcher's own bundle");
    mkdirSync(join(to, "keep"), { recursive: true });
    writeFileSync(join(to, "keep", "mine.txt"), "not the manifest's");
    await stageStudioAssets(to, { from });
    expect(existsSync(join(to, "dist/init.js"))).toBe(true);
    expect(existsSync(join(to, "keep/mine.txt"))).toBe(true);
  });

  test("cleaning drops a chunk the new build no longer emits", async () => {
    const to = dest();
    await stageStudioAssets(to, { from: studioTree() });
    expect(existsSync(join(to, "dist/chunks/studio-abc123.js"))).toBe(true);
    const next = studioTree();
    rmSync(join(next, "dist/chunks/studio-abc123.js"));
    writeFileSync(join(next, "dist/chunks/studio-def456.js"), "// new chunk");
    await stageStudioAssets(to, { from: next });
    expect(existsSync(join(to, "dist/chunks/studio-abc123.js"))).toBe(false);
    expect(existsSync(join(to, "dist/chunks/studio-def456.js"))).toBe(true);
  });

  /* A staging failure should say what the reader loses, not just which file was absent — the whole
     point of the manifest's `why`. */
  test("a missing required asset throws, naming it and what it costs", async () => {
    const from = studioTree();
    rmSync(join(from, "dist/codicon.ttf"));
    await expect(stageStudioAssets(dest(), { from })).rejects.toThrow(/codicon\.ttf/);
    await expect(stageStudioAssets(dest(), { from })).rejects.toThrow(/Monaco's icon font/);
  });

  test("missingStudioAssets reports the same gap without copying anything", () => {
    const from = studioTree();
    rmSync(join(from, "dist/workers"), { force: true, recursive: true });
    expect(missingStudioAssets(from).map((a) => a.path)).toEqual(["dist/workers"]);
    expect(missingStudioAssets(studioTree())).toEqual([]);
  });
});

describe("the documents, read from a package root", () => {
  test("canvasDocument reads the package's canvas.html and rebases its entry", async () => {
    const from = studioTree({
      "canvas.html": '<script type="module">import(`./dist/iframe-entry.js?t=1`);</script>',
    });
    const html = await canvasDocument({ base: { mode: "flat", prefix: "/" }, from });
    expect(html).toContain("/iframe-entry.js?t=1");
    expect(html).not.toContain("./dist/iframe-entry.js");
  });

  test("canvasDocument defaults to the package's own shape", async () => {
    const from = studioTree({
      "canvas.html": '<script type="module">import(`./dist/iframe-entry.js`);</script>',
    });
    expect(await canvasDocument({ from })).toContain("./dist/iframe-entry.js");
  });

  /* The manifest as DATA, for a host that cannot import TypeScript at all — a Nix derivation, a
     shell script, a build in another language. */
  test("writeAssetManifest emits the manifest as json", async () => {
    const root = dest();
    await writeAssetManifest(root);
    const written = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8")) as {
      assets: { path: string; why: string }[];
      shell: string;
    };
    expect(written.shell).toBe("index.html");
    expect(written.assets.map((a) => a.path)).toEqual(STUDIO_ASSETS.map((a) => a.path));
    expect(written.assets.every((a) => a.why.length > 0)).toBe(true);
  });

  /* "This build computed no closure" and "this build's entry has none" are different statements,
     so a caller that passes nothing gets no field rather than an empty one. */
  test("writeAssetManifest writes no preload field unless one is passed", async () => {
    const root = dest();
    await writeAssetManifest(root);
    const written = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8")) as object;
    expect("preload" in written).toBe(false);
  });

  test("writeAssetManifest records the build's preload list verbatim", async () => {
    const root = dest();
    const preload = ["dist/chunks/a-11111111.js", "dist/chunks/b-22222222.js"];
    await writeAssetManifest(root, { preload });
    const written = JSON.parse(readFileSync(join(root, "dist", "manifest.json"), "utf8")) as {
      preload: string[];
      shell: string;
    };
    expect(written.preload).toEqual(preload);
    // The rest of the manifest is untouched by the extra.
    expect(written.shell).toBe("index.html");
  });
});

describe("studioPreload", () => {
  /* The round trip a host performs: the build writes the list, the host reads it back and hands it
     to studioShellHtml({ preload }). */
  test("reads back what writeAssetManifest wrote", async () => {
    const root = studioTree({ "dist/chunks/a-11111111.js": "// a" });
    await writeAssetManifest(root, { preload: ["dist/chunks/a-11111111.js"] });
    expect(await studioPreload(root)).toEqual(["dist/chunks/a-11111111.js"]);
  });

  /* A hint for a chunk that is not there is a 404 on every cold start; fewer hints is the better
     failure. The order of the survivors is the manifest's. */
  test("drops entries that are not on disk under the root", async () => {
    const root = studioTree({
      "dist/chunks/a-11111111.js": "// a",
      "dist/chunks/c-33333333.js": "",
    });
    await writeAssetManifest(root, {
      preload: [
        "dist/chunks/a-11111111.js",
        "dist/chunks/b-22222222.js",
        "dist/chunks/c-33333333.js",
      ],
    });
    expect(await studioPreload(root)).toEqual([
      "dist/chunks/a-11111111.js",
      "dist/chunks/c-33333333.js",
    ]);
  });

  /* The case the existence filter cannot see: `bun run build`, then `bun run dev`. The watcher
     rebuilds studio.js over the release chunks without deleting them, so every stale name still
     exists. The dev server drops the field before its first build, and the checkout reads as
     "no hints" — not as a list of chunks the running entry never imports. */
  test("is empty for a checkout the dev server has started on after a release build", async () => {
    const root = studioTree({ "dist/chunks/release-11111111.js": "// release" });
    await writeAssetManifest(root, { preload: ["dist/chunks/release-11111111.js"] });
    expect(await studioPreload(root)).toEqual(["dist/chunks/release-11111111.js"]);
    await forgetReleasePreload(root);
    expect(existsSync(join(root, "dist/chunks/release-11111111.js"))).toBe(true);
    expect(await studioPreload(root)).toEqual([]);
  });

  /* A source checkout that was never built: no hints, which is what every host had before. */
  test("is empty when there is no manifest at all", async () => {
    expect(await studioPreload(dest())).toEqual([]);
  });

  /* A manifest from a build that predates the field. */
  test("is empty when the manifest has no preload field", async () => {
    const root = dest();
    await writeAssetManifest(root);
    expect(await studioPreload(root)).toEqual([]);
  });

  test("ignores a field that is not a list of strings rather than hinting garbage", async () => {
    const root = dest();
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "manifest.json"), JSON.stringify({ preload: "dist/x.js" }));
    expect(await studioPreload(root)).toEqual([]);
    mkdirSync(join(root, "dist", "chunks"), { recursive: true });
    writeFileSync(join(root, "dist", "chunks", "a-11111111.js"), "// a");
    writeFileSync(
      join(root, "dist", "manifest.json"),
      JSON.stringify({ preload: ["dist/chunks/a-11111111.js", 7, null] }),
    );
    expect(await studioPreload(root)).toEqual(["dist/chunks/a-11111111.js"]);
  });

  /* A damaged install is not an old one, and should say so rather than boot without hints. */
  test("throws on a manifest that is not JSON", async () => {
    const root = dest();
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "dist", "manifest.json"), "{ not json");
    await expect(studioPreload(root)).rejects.toThrow();
  });

  test("defaults to the package's own root", async () => {
    expect(Array.isArray(await studioPreload())).toBe(true);
  });
});

describe("check-studio-package rules", () => {
  test("a stylesheet on disk but not in the list is a finding, and vice versa", () => {
    expect(
      stylesheetDrift(["styles/tokens.css"]).some((p) => p.detail.includes("not on disk")),
    ).toBe(true);
    const extra = stylesheetDrift([
      "styles/tokens.css",
      "styles/shell.css",
      "styles/canvas.css",
      "styles/panels.css",
      "styles/inspector.css",
      "styles/overlays.css",
      "styles/forced-colors.css",
      "styles/brand-new.css",
    ]);
    expect(extra.some((p) => p.detail.includes("brand-new.css"))).toBe(true);
  });

  test("filesCovers understands exact paths, directories and globs", () => {
    expect(filesCovers(["src"], "src/studio.ts")).toBe(true);
    expect(filesCovers(["dist/studio.js"], "dist/studio.js")).toBe(true);
    expect(filesCovers(["dist/chunks/*.js"], "dist/chunks/a.js")).toBe(true);
    expect(filesCovers(["dist/chunks/*.js"], "dist/chunks/a.css")).toBe(false);
    // A manifest DIRECTORY is covered when patterns reach inside it.
    expect(filesCovers(["dist/chunks/*.js", "dist/chunks/*.css"], "dist/chunks")).toBe(true);
    expect(filesCovers(["src"], "data/webdata.json")).toBe(false);
  });

  test("an import that escapes src/ is found, and prose quoting one is not", () => {
    expect(escapingImports({ "studio.ts": 'import x from "../data/webdata.json";' })).toEqual([
      "data/webdata.json",
    ]);
    expect(escapingImports({ "panels/a.ts": 'import { x } from "../store";' })).toEqual([]);
    expect(
      escapingImports({ "store.ts": '// re-exported so `from "../store"` keeps working' }),
    ).toEqual([]);
  });

  test("publishGaps names what files does not cover", () => {
    const gaps = publishGaps(["src"], ["data/webdata.json"]);
    expect(gaps.some((p) => p.detail.includes("data/webdata.json"))).toBe(true);
    expect(gaps.some((p) => p.detail.includes("dist/codicon.ttf"))).toBe(true);
  });

  /* The workers gained linked maps while `files` still listed `dist/workers` whole, and 21 MB of
     maps reached the tarball: staging and the bundle budget both skip `**\/*.map`, so this rule is
     the only place it is visible. */
  test("a files entry that would publish a dist/ source map is a finding", () => {
    for (const pattern of ["dist/workers", "dist/workers/", "dist", "dist/chunks/*", "dist/**"]) {
      expect(publishedMaps([pattern]), pattern).toHaveLength(1);
    }
    expect(publishedMaps(["dist/studio.js.map"])).toHaveLength(1);
    expect(publishedMaps(["dist/workers"])[0]?.rule).toBe("maps");
  });

  test("files entries that name .js, .css or a single file publish no map", () => {
    expect(
      publishedMaps([
        "dist/workers/*.js",
        "dist/chunks/*.js",
        "dist/chunks/*.css",
        "dist/studio.js",
        "dist/manifest.json",
        "dist/codicon.ttf",
      ]),
    ).toEqual([]);
    // Source trees listed whole are the source, not a build, and hold no maps.
    expect(publishedMaps(["src", "styles", "fonts", "data"])).toEqual([]);
  });

  /* A narrowed entry still publishes the manifest directory it reaches inside. */
  test("dist/workers/*.js still covers the dist/workers manifest entry", () => {
    expect(filesCovers(["dist/workers/*.js"], "dist/workers")).toBe(true);
    expect(filesCovers(["dist/workers/*.js"], "dist/workers/json.worker.js")).toBe(true);
    expect(filesCovers(["dist/workers/*.js"], "dist/workers/json.worker.js.map")).toBe(false);
  });

  /* Neither of these is expressible in check-dep-rules.ts, which forbids only core-to-extension
     edges — server and studio are both core, so the edge would pass it silently. */
  test("a backend dependency is a finding in every dependency field", () => {
    for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
      expect(backendDependencies({ [field]: { "@jxsuite/server": "^1" } })).toHaveLength(1);
    }
    expect(backendDependencies({ dependencies: { "@jxsuite/schema": "^1" } })).toEqual([]);
  });

  test("a backend import is a finding, and a mention in prose is not", () => {
    expect(backendImports({ "a.ts": 'import { x } from "@jxsuite/server/dev";' })).toHaveLength(1);
    expect(
      backendImports({ "a.ts": "/* @jxsuite/server is one implementation's backend */" }),
    ).toEqual([]);
  });

  test("only the stager may import node:", () => {
    expect(nodeImports({ "hosting/stage.ts": 'import { cp } from "node:fs/promises";' })).toEqual(
      [],
    );
    expect(nodeImports({ "hosting/layout.ts": 'import { join } from "node:path";' })).toHaveLength(
      1,
    );
    expect(nodeImports({ "hosting/layout.ts": '// never import "node:path" here' })).toEqual([]);
  });
});
