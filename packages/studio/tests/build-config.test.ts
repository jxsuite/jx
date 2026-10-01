/**
 * The bundler contract the release build and the dev watcher share (scripts/build-config.ts), and
 * the part of it only the release build takes (studio.md §11.1).
 *
 * Nothing here builds. The bytes are the gated `studio-dist` job's to judge; what is pinned here is
 * the split between the two paths, which a one-line edit to the shared options could erase without
 * any build failing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STUDIO_ASSETS } from "../src/hosting/layout";
import { writeAssetManifest } from "../src/hosting/stage";
import {
  forgetReleasePreload,
  studioBundleOptions,
  studioReleaseDefine,
  studioReleaseOptions,
} from "../scripts/build-config";

describe("the shared contract", () => {
  /* The dev watcher spreads these and nothing else, so anything minifying here would reach every
     `bun run dev` — where a readable stack trace is the point. */
  test("does not minify, so the dev watcher stays readable", () => {
    expect("minify" in studioBundleOptions).toBe(false);
  });

  /* Hosts cache dist/chunks/* as immutable on the strength of the content hash in the name, and
     match it as -[a-z0-9]{8}.<ext>. Changing the template changes what every host may cache. */
  test("keeps content-hashed chunk names and flat, unhashed entries", () => {
    expect(studioBundleOptions.naming.chunk).toBe("chunks/[name]-[hash].[ext]");
    expect(studioBundleOptions.naming.entry).toBe("[name].[ext]");
  });

  test("emits linked source maps, which is what keeps a minified release debuggable", () => {
    expect(studioBundleOptions.sourcemap).toBe("linked");
  });
});

describe("the release additions", () => {
  test("minify every way Bun can", () => {
    expect(studioReleaseOptions.minify).toEqual({
      identifiers: true,
      keepNames: true,
      syntax: true,
      whitespace: true,
    });
  });

  /* @vue/reactivity's esm-bundler build gates its development branches on this, and Bun folds an
     undefined NODE_ENV to "not production" for a browser target. */
  test("define NODE_ENV as production, as a JSON string literal", () => {
    expect(studioReleaseDefine["process.env.NODE_ENV"]).toBe('"production"');
  });

  test("override nothing the shared contract decides", () => {
    for (const key of Object.keys(studioReleaseOptions)) {
      expect(key in studioBundleOptions, key).toBe(false);
    }
  });
});

/* The dev path's half of the manifest contract: the release build's `preload` names chunks the
   watcher's studio.js never imports, and they stay on disk, so only removing the field keeps a
   `--link` host from hinting them. */
describe("forgetReleasePreload", () => {
  const temps: string[] = [];
  afterAll(() => {
    for (const t of temps) {
      rmSync(t, { force: true, recursive: true });
    }
  });
  const root = () => {
    const d = mkdtempSync(join(tmpdir(), "jx-build-config-"));
    temps.push(d);
    return d;
  };
  const manifest = (r: string) =>
    JSON.parse(readFileSync(join(r, "dist", "manifest.json"), "utf8")) as Record<string, unknown>;

  test("rewrites a release manifest without its preload list, keeping the rest", async () => {
    const r = root();
    await writeAssetManifest(r, { preload: ["dist/chunks/studio-abcd1234.js"] });
    expect(manifest(r).preload).toEqual(["dist/chunks/studio-abcd1234.js"]);
    await forgetReleasePreload(r);
    const after = manifest(r);
    expect("preload" in after).toBe(false);
    expect(after.shell).toBe("index.html");
    expect(after.assets).toEqual(STUDIO_ASSETS);
  });

  test("writes a field-less manifest for a checkout that was never built", async () => {
    const r = root();
    await forgetReleasePreload(r);
    expect("preload" in manifest(r)).toBe(false);
  });
});
