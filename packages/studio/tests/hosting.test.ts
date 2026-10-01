/**
 * The host contract: the manifest, the layout rule, and the two generated documents.
 *
 * These are what four hosts used to re-derive by hand. jx-platform's asset build carried three
 * `replaceAll` calls, an exact-string surgery on the entry's script tag, a hard-coded worker
 * triple, a version floor and — added after the fact — an assertion that no relative reference had
 * survived, because studio 2.1.0 split the chrome into `./styles/*.css` and the rewrite list missed
 * it. Every one of those is a fact about a document someone else owns; the assertions here are that
 * fact, stated once.
 *
 * No DOM and no harness: layout.ts and document.ts are pure by contract, and this file proves it by
 * not needing one.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assetUrl,
  PUBLISHED_EXTRAS,
  STUDIO_ASSETS,
  STUDIO_BUNDLE_CSS,
  STUDIO_ENTRY,
  STUDIO_FAVICON,
  STUDIO_HOST_API,
  STUDIO_IFRAME_ENTRY,
  STUDIO_STYLESHEETS,
  STUDIO_WORKERS,
} from "../src/hosting/layout";
import type { AssetBase } from "../src/hosting/layout";
import { BOOT_META, canvasShellHtml, IN_PLACE, studioShellHtml } from "../src/hosting/document";

/** The three layouts a real host uses. */
const NESTED: AssetBase = { mode: "nested", prefix: "/studio-assets/" };
const FLAT: AssetBase = { mode: "flat", prefix: "/" };
const LOOPBACK: AssetBase = { mode: "nested", prefix: "/__studio__/" };

describe("the manifest", () => {
  test("every entry carries a reason, and the reason says what breaks", () => {
    for (const a of STUDIO_ASSETS) {
      expect(a.why.length, `${a.path} has no reason`).toBeGreaterThan(40);
    }
  });

  test("names each path once", () => {
    const paths = STUDIO_ASSETS.map((a) => a.path);
    expect(paths.length).toBe(new Set(paths).size);
  });

  test("the entries whose paths are a contract are in it", () => {
    const paths = new Set(STUDIO_ASSETS.map((a) => a.path));
    for (const path of [STUDIO_ENTRY, STUDIO_IFRAME_ENTRY, STUDIO_BUNDLE_CSS]) {
      expect(paths.has(path), `${path} is missing from the manifest`).toBe(true);
    }
  });

  /* The bug that ran longest: dist/codicon.ttf is emitted by the build and referenced by
     dist/studio.css and three chunk stylesheets, and it was in no `files` list and no host's copy
     list, so every distribution drew tofu where Monaco draws icons. */
  test("includes the Monaco icon font, which shipped nowhere for months", () => {
    const codicon = STUDIO_ASSETS.find((a) => a.path === "dist/codicon.ttf");
    expect(codicon).toBeDefined();
    expect(codicon!.required).toBe(true);
  });

  test("includes the favicon a Chromium --app window falls back to for its own icon", () => {
    const favicon = STUDIO_ASSETS.find((a) => a.path === STUDIO_FAVICON);
    expect(favicon).toBeDefined();
    expect(favicon!.required).toBe(true);
    expect(favicon!.dir).toBe(false);
  });

  test("the directories that ship wholesale are marked as directories", () => {
    for (const path of ["dist/chunks", "dist/workers", "styles", "fonts"]) {
      expect(STUDIO_ASSETS.find((a) => a.path === path)?.dir, `${path}`).toBe(true);
    }
  });

  test("source maps are excluded, and the source graph is published beyond the served tree", () => {
    expect(PUBLISHED_EXTRAS).toContain("src");
    // `data/` is imported by six modules including src/studio.ts, so the "." export needs it.
    expect(PUBLISHED_EXTRAS).toContain("data");
  });

  test("declares a host API version a consumer can assert against", () => {
    expect(Number.isInteger(STUDIO_HOST_API)).toBe(true);
  });
});

describe("assetUrl", () => {
  test("nested keeps the package's own shape", () => {
    expect(assetUrl(NESTED, "dist/studio.js")).toBe("/studio-assets/dist/studio.js");
    expect(assetUrl(LOOPBACK, "canvas.html")).toBe("/__studio__/canvas.html");
  });

  /* One `dist/` segment and nothing else, and that single rule is what makes flattening a contract
     rather than a rewrite: everything inside dist/ is dist-relative, so stripping one segment moves
     all of it together. */
  test("flat strips exactly one leading dist/ segment", () => {
    expect(assetUrl(FLAT, "dist/studio.js")).toBe("/studio.js");
    expect(assetUrl(FLAT, "dist/chunks/studio-abc.js")).toBe("/chunks/studio-abc.js");
    expect(assetUrl(FLAT, "dist/workers/json.worker.js")).toBe("/workers/json.worker.js");
    expect(assetUrl(FLAT, "dist/codicon.ttf")).toBe("/codicon.ttf");
  });

  /* `styles/` and `fonts/` are untouched in BOTH modes, which is why tokens.css's url("../fonts/…")
     resolves either way — the relationship between them never moves. */
  test("leaves styles and fonts alone in both modes, keeping ../fonts reachable", () => {
    for (const base of [NESTED, FLAT, LOOPBACK]) {
      expect(assetUrl(base, "styles/tokens.css")).toBe(`${base.prefix}styles/tokens.css`);
      expect(assetUrl(base, "fonts/jetbrains-mono-400.woff2")).toBe(
        `${base.prefix}fonts/jetbrains-mono-400.woff2`,
      );
    }
  });

  test("a nested dist/ deeper in the path is not stripped", () => {
    expect(assetUrl(FLAT, "dist/chunks/dist/x.js")).toBe("/chunks/dist/x.js");
  });

  test("tolerates a leading ./ on the input", () => {
    expect(assetUrl(NESTED, "./dist/studio.js")).toBe("/studio-assets/dist/studio.js");
  });
});

describe("studioShellHtml", () => {
  test("links the favicon, then the bundle stylesheet and the chrome, in cascade order", () => {
    const html = studioShellHtml();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      `./${STUDIO_FAVICON}`,
      `./${STUDIO_BUNDLE_CSS}`,
      ...STUDIO_STYLESHEETS.map((s) => `./${s}`),
    ]);
  });

  test("the favicon link is a plain icon, not a stylesheet", () => {
    expect(studioShellHtml()).toContain(`<link rel="icon" href="./${STUDIO_FAVICON}" />`);
  });

  /* `forced-colors.css` redraws what Windows High Contrast deletes, so it has to win. Order here is
     behaviour, not presentation. */
  test("forced-colors.css is last", () => {
    expect(studioShellHtml().lastIndexOf("forced-colors.css")).toBeGreaterThan(
      studioShellHtml().lastIndexOf("overlays.css"),
    );
  });

  test("every reference is rebased, at every layout", () => {
    for (const base of [NESTED, FLAT, LOOPBACK]) {
      const html = studioShellHtml({ base });
      const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(7);
      for (const ref of refs) {
        expect(ref.startsWith(base.prefix), `${ref} was not rebased under ${base.prefix}`).toBe(
          true,
        );
      }
    }
  });

  /* The assertion jx-platform had to invent — that nothing relative survived the rewrite — and the
     reason it needed inventing. Here it cannot fail, because nothing is rewritten. */
  test("leaves no document-relative reference at a deep base", () => {
    const html = studioShellHtml({ base: { mode: "nested", prefix: "/edit/acme/site@main/x/" } });
    expect([...html.matchAll(/(?:href|src)="(\.\/[^"]*)"/g)]).toEqual([]);
  });

  test("boot modules load before the entry, in order", () => {
    const html = studioShellHtml({ boot: ["/edit-init.js", "/second.js"] });
    const at = (s: string) => html.indexOf(s);
    expect(at("/edit-init.js")).toBeGreaterThan(-1);
    expect(at("/edit-init.js")).toBeLessThan(at("/second.js"));
    expect(at("/second.js")).toBeLessThan(at(STUDIO_ENTRY));
  });

  test("no boot module means no stray script tag", () => {
    expect(studioShellHtml().match(/<script/g)).toHaveLength(1);
  });

  /* The meta is how the studio entry tells "the dev server, which should fall back" from "a
     launcher whose boot module never ran, which must not" (platforms/default-platform.ts). */
  test("declaring a boot module stamps the jx-boot meta into the head", () => {
    const html = studioShellHtml({ boot: ["/edit-init.js"] });
    const meta = `<meta name="${BOOT_META.name}" content="${BOOT_META.content}" />`;
    expect(meta).toBe('<meta name="jx-boot" content="launcher" />');
    expect(html.split("</head>")[0]).toContain(meta);
    // Before any script, so a boot module that never loaded cannot take it with it.
    expect(html.indexOf(meta)).toBeLessThan(html.indexOf("<script"));
  });

  test("no boot module means no jx-boot meta, so the dev server keeps its fallback", () => {
    expect(studioShellHtml()).not.toContain("jx-boot");
    expect(studioShellHtml({ boot: [] })).not.toContain("jx-boot");
  });

  /* Electrobun's macOS CEF path injects its preload by splicing after the literal "<head>"; an
     attribute on the tag would silently move the preload out of the document. */
  test("the head tag stays a literal, attribute-free <head> either way", () => {
    for (const html of [studioShellHtml(), studioShellHtml({ boot: ["/init.js"] })]) {
      expect(html).toContain("\n  <head>\n");
    }
  });

  test("carries an empty body — the frame is src/shell/tree.ts", () => {
    const body = studioShellHtml().split("<body>")[1]!;
    expect(body).not.toContain("<div");
    expect(body).not.toContain("sp-theme");
  });

  test("the title is the caller's", () => {
    expect(studioShellHtml({ title: "acme/site · Jx Studio" })).toContain(
      "<title>acme/site · Jx Studio</title>",
    );
  });

  test("IN_PLACE is the package's own shape", () => {
    expect(studioShellHtml({ base: IN_PLACE })).toBe(studioShellHtml());
  });
});

describe("studioShellHtml preload", () => {
  const PRELOAD = ["dist/chunks/studio-aaaaaaaa.js", "dist/chunks/studio-bbbbbbbb.js"];
  const hint = (href: string) => `<link rel="modulepreload" href="${href}" />`;

  /* The opt-in is the contract. The committed index.html is generated with no options, served by the
     dev watcher (whose chunk hashes are never the release build's), and byte-diffed by CI — so the
     no-options document must not move by a byte. Compared against the committed file itself, not
     against a second call, so this fails in the same pull request that would fail that diff. */
  test("no options, and an empty list, produce the committed index.html byte for byte", () => {
    const committed = readFileSync(join(import.meta.dir, "..", "index.html"), "utf8");
    expect(studioShellHtml()).toBe(committed);
    expect(studioShellHtml({ preload: [] })).toBe(committed);
    expect(committed).not.toContain("modulepreload");
  });

  test("emits one modulepreload hint per entry, in the order given", () => {
    const html = studioShellHtml({ preload: PRELOAD });
    expect(html.match(/rel="modulepreload"/g)).toHaveLength(2);
    expect(html.indexOf(hint(`./${PRELOAD[0]}`))).toBeLessThan(
      html.indexOf(hint(`./${PRELOAD[1]}`)),
    );
  });

  /* After the last render-blocking stylesheet so a hint never competes with one, and in the head
     before any script so every hinted module is in flight when the entry asks for it. */
  test("the hints follow the stylesheets and precede every script, inside the head", () => {
    const html = studioShellHtml({ boot: ["/edit-init.js"], preload: PRELOAD });
    const head = html.split("</head>")[0]!;
    const first = head.indexOf("modulepreload");
    expect(first).toBeGreaterThan(head.lastIndexOf('rel="stylesheet"'));
    expect(first).toBeGreaterThan(-1);
    expect(html.indexOf("<script")).toBeGreaterThan(head.lastIndexOf("modulepreload"));
  });

  test("each hint is rebased like every other reference, at every layout", () => {
    expect(studioShellHtml({ base: NESTED, preload: PRELOAD })).toContain(
      hint("/studio-assets/dist/chunks/studio-aaaaaaaa.js"),
    );
    // Flat strips the one dist/ segment, exactly as the entry's own `./chunks/` imports expect.
    expect(studioShellHtml({ base: FLAT, preload: PRELOAD })).toContain(
      hint("/chunks/studio-aaaaaaaa.js"),
    );
  });

  /* The cloud's call shape. The boot meta, the attribute-free head and the boot ordering are all
     independent of the hints. */
  test("composes with boot without disturbing it", () => {
    const html = studioShellHtml({ base: FLAT, boot: ["/edit-init.js"], preload: PRELOAD });
    expect(html).toContain("\n  <head>\n");
    expect(html).toContain('<meta name="jx-boot" content="launcher" />');
    expect(html.indexOf("/edit-init.js")).toBeLessThan(html.indexOf("/studio.js"));
    const withoutHints = studioShellHtml({ base: FLAT, boot: ["/edit-init.js"] });
    expect(html.replaceAll(/\n {4}<link rel="modulepreload"[^\n]*/g, "")).toBe(withoutHints);
  });
});

describe("canvasShellHtml", () => {
  const canvas = `<div id="jx-canvas-root"></div>
<script type="module">
  import(\`./dist/iframe-entry.js?t=\${Date.now()}\`);
</script>`;

  /* The reference is a dynamic import() inside a template literal with a cache-buster — precisely
     the shape jx-platform's `(?:src|href)="\\./…"` residual-ref guard structurally could not see. */
  test("rebases the entry inside a template-literal import", () => {
    expect(canvasShellHtml(canvas, FLAT)).toContain("/iframe-entry.js?t=");
    expect(canvasShellHtml(canvas, FLAT)).not.toContain("./dist/iframe-entry.js");
  });

  test("rebases at a nested base too", () => {
    expect(canvasShellHtml(canvas, NESTED)).toContain("/studio-assets/dist/iframe-entry.js?t=");
  });

  test("leaves the hand-authored style block alone", () => {
    const withStyle = `<style>#jx-canvas-viewport { container-type: size; }</style>${canvas}`;
    expect(canvasShellHtml(withStyle, FLAT)).toContain("container-type: size;");
  });

  /* A silent miss here is a canvas that 404s at boot, which is what the old rewrite could do. */
  test("throws when the entry reference is absent rather than passing it through", () => {
    expect(() => canvasShellHtml("<div></div>", FLAT)).toThrow(/iframe-entry\.js/);
  });
});

describe("the worker names", () => {
  /* Three consumers address these literally: workerUrl in services/monaco-setup.ts, the desktop
     bundle config, and scripts/build-workers.ts. The manifest must not become a fourth writer. */
  test("are the three Monaco emits", () => {
    expect([...STUDIO_WORKERS].toSorted()).toEqual([
      "editor.worker.js",
      "json.worker.js",
      "ts.worker.js",
    ]);
  });
});
