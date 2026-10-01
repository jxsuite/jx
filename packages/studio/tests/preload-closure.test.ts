/**
 * The editor entry's static import closure, read off a metafile (scripts/lib/preload.ts).
 *
 * What it computes becomes `<link rel="modulepreload">` hints in every host that opts in, so the
 * two ways it can be wrong are both silent in a browser: a dynamic import that leaks in drags
 * Monaco back onto the startup path (studio.md §11.1), and a transitive chunk that is missed is
 * still fetched — just a round trip later than it needed to be. The fixtures below are shaped like
 * Bun's own metafile: outputs keyed `./<path>` relative to `outdir`, with the same convention for
 * every import's `path`.
 */
import { describe, expect, test } from "bun:test";
import { staticImportClosure } from "../scripts/lib/preload";
import type { PreloadMetafile } from "../scripts/lib/preload";

const stat = (path: string) => ({ kind: "import-statement", path });
const dyn = (path: string) => ({ kind: "dynamic-import", path });

/** The entry studio.js → a → c, and studio.js → b → c (a diamond), plus a dynamic edge to Monaco. */
const DIAMOND: PreloadMetafile = {
  outputs: {
    "./chunks/a-11111111.js": { imports: [stat("./chunks/c-33333333.js")] },
    "./chunks/b-22222222.js": { imports: [stat("./chunks/c-33333333.js")] },
    "./chunks/c-33333333.js": { imports: [] },
    "./chunks/monaco-44444444.js": { imports: [stat("./chunks/monaco-dep-55555555.js")] },
    "./chunks/monaco-dep-55555555.js": {},
    "./studio.css": {},
    "./studio.js": {
      imports: [
        stat("./chunks/b-22222222.js"),
        stat("./chunks/a-11111111.js"),
        dyn("./chunks/monaco-44444444.js"),
      ],
    },
  },
};

describe("staticImportClosure", () => {
  test("follows static imports transitively, deduplicated and sorted, package-relative", () => {
    expect(staticImportClosure(DIAMOND, "studio.js", "dist/")).toEqual([
      "dist/chunks/a-11111111.js",
      "dist/chunks/b-22222222.js",
      "dist/chunks/c-33333333.js",
    ]);
  });

  /* The rule that keeps this an optimisation: a dynamic import is how Monaco stays off the startup
     path, so neither its chunk nor anything only it reaches may be hinted. */
  test("never follows a dynamic import, nor what only a dynamic import reaches", () => {
    const closure = staticImportClosure(DIAMOND, "studio.js", "dist/");
    expect(closure.some((p) => p.includes("monaco"))).toBe(false);
  });

  test("a chunk reached both statically and dynamically is still preloaded", () => {
    const meta: PreloadMetafile = {
      outputs: {
        "./chunks/shared-66666666.js": {},
        "./chunks/lazy-77777777.js": { imports: [stat("./chunks/shared-66666666.js")] },
        "./studio.js": {
          imports: [dyn("./chunks/lazy-77777777.js"), stat("./chunks/shared-66666666.js")],
        },
      },
    };
    expect(staticImportClosure(meta, "studio.js")).toEqual(["chunks/shared-66666666.js"]);
  });

  test("never lists the entry itself, even through a cycle back to it", () => {
    const meta: PreloadMetafile = {
      outputs: {
        "./chunks/a-11111111.js": { imports: [stat("./studio.js")] },
        "./studio.js": { imports: [stat("./chunks/a-11111111.js")] },
      },
    };
    expect(staticImportClosure(meta, "studio.js", "dist/")).toEqual(["dist/chunks/a-11111111.js"]);
  });

  /* Esbuild keys outputs without the leading `./`; Bun keys them with it. Either spelling, on
     either side, names the same file. */
  test("accepts keys and an entry with or without the leading ./", () => {
    const meta: PreloadMetafile = {
      outputs: {
        "chunks/a-11111111.js": {},
        "studio.js": { imports: [stat("./chunks/a-11111111.js")] },
      },
    };
    expect(staticImportClosure(meta, "./studio.js")).toEqual(["chunks/a-11111111.js"]);
  });

  test("an import that names no output is external to the build and is skipped", () => {
    const meta: PreloadMetafile = {
      outputs: { "./studio.js": { imports: [stat("https://cdn.example/x.js")] } },
    };
    expect(staticImportClosure(meta, "studio.js")).toEqual([]);
  });

  test("an entry with no static imports has an empty closure", () => {
    expect(staticImportClosure({ outputs: { "./studio.js": {} } }, "studio.js")).toEqual([]);
  });

  /* Empty is a legitimate answer (above), so a mistyped entry must not be able to produce it. */
  test("throws, naming the entry, when the metafile has no such output", () => {
    expect(() => staticImportClosure(DIAMOND, "dist/studio.js")).toThrow(/dist\/studio\.js/);
  });
});
