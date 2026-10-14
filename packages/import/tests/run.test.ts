/**
 * The importSite orchestrator: option validation, phase sequencing, progress events, warnings,
 * abort handling, and the single-page vs crawl branches. All browser/FS-touching phase modules are
 * mocked; the pure transforms (convertToJx, style-diff, apply-styles, layout-detect) run for real.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JxElement } from "@jxsuite/schema/types";
import type { AiComponentizeOptions } from "../src/ai-componentize.ts";
import type { LaunchOptions } from "../src/browser-local.ts";
import type { CaptureOptions, ImportBrowser, ImportPage } from "../src/capture.ts";
import type { ComponentizeResult } from "../src/componentize.ts";
import type { CrawlOptions, CrawlResult } from "../src/crawl.ts";
import type { DownloadResult } from "../src/asset-download.ts";
import type { MultiEmitOptions } from "../src/emit.ts";
import type { ExtractMediaOptions, MediaExtractionResult } from "../src/media-extract.ts";
import type { CapturedStyle, StyleCaptureResult } from "../src/style-capture.ts";
import type { VerifyOptions, VerifyResult } from "../src/verify.ts";

const pageClose = mock(() => Promise.resolve());
const pageSetViewport = mock((_v: { width: number; height: number }) => Promise.resolve());
const pageScreenshot = mock((_o?: { fullPage?: boolean; type?: string }) =>
  Promise.resolve(new Uint8Array([1, 2, 3])),
);
const fakeBrowser = { fake: true };

const launchBrowser = mock((_opts?: LaunchOptions) => Promise.resolve(fakeBrowser));
const closeBrowser = mock(() => Promise.resolve());
void mock.module("../src/browser-local.ts", () => ({ launchBrowser, closeBrowser }));

const capturePage = mock((_url: string, _browser?: ImportBrowser, _opts?: CaptureOptions) =>
  Promise.resolve({
    url: "https://site.example/",
    title: "Example Site",
    bodyHtml: "<div><h1>Hello</h1><p>World</p></div>",
    links: ["https://site.example/about"],
    page: { close: pageClose, setViewport: pageSetViewport, screenshot: pageScreenshot },
  }),
);
void mock.module("../src/capture.ts", () => ({ capturePage }));

const captureStyles = mock((): Promise<StyleCaptureResult> =>
  Promise.resolve({
    elements: [],
    uaDefaults: {},
    mediaQueries: [],
    customProperties: {},
    documentStyles: { "background-color": "rgb(1, 2, 3)" },
  }),
);
void mock.module("../src/style-capture.ts", () => ({ captureStyles }));

const extractMedia = mock(
  (
    _page?: ImportPage,
    _base?: CapturedStyle[],
    _uaDefaults?: Record<string, Record<string, string>>,
    _queries?: readonly string[],
    _options?: ExtractMediaOptions,
  ): Promise<MediaExtractionResult> =>
    Promise.resolve({
      breakpoints: { "--md": "(max-width: 768px)" },
      deltas: {},
    }),
);
void mock.module("../src/media-extract.ts", () => ({ extractMedia }));

const collectAssets = mock(() =>
  Promise.resolve({
    assets: [{ url: "https://site.example/hero.jpg", kind: "image" }],
    inlineSvgCount: 0,
    stylesheets: [{ href: "inline", cssText: "", fontFaceRules: ["@font-face { }"] }],
  }),
);
void mock.module("../src/asset-collect.ts", () => ({ collectAssets }));

const downloadAssets = mock((): Promise<DownloadResult> =>
  Promise.resolve({
    rewriteMap: new Map([
      ["https://site.example/hero.jpg", "/assets/images/hero.jpg"],
      ["https://site.example/font.woff2", "/assets/fonts/font.woff2"],
    ]),
    failed: ["https://site.example/broken.png"],
    skipped: [],
    totalBytes: 2048,
  }),
);
void mock.module("../src/asset-download.ts", () => ({ downloadAssets }));

const emitMultiPageProject = mock((_opts: MultiEmitOptions) =>
  Promise.resolve({
    classesStripped: 0,
    files: ["project.json", "a", "b"],
    projectJson: '{ "name": "Example Site" }\n',
  }),
);
void mock.module("../src/emit.ts", () => ({ emitMultiPageProject }));

const componentize = mock(() => ({
  components: new Map([["component-div-0", { tagName: "component-div-0" }]]),
  rewrittenPages: new Map<string, JxElement>(),
}));
void mock.module("../src/componentize.ts", () => ({ componentize }));

const aiComponentize = mock(
  (
    _heuristic: ComponentizeResult,
    _opts: AiComponentizeOptions,
    onProgress?: (msg: string) => void,
  ) => {
    onProgress?.("Renamed component-div-0 → hero-banner");
    return Promise.resolve({
      components: new Map([["hero-banner", { tagName: "hero-banner" }]]),
      rewrittenPages: new Map<string, JxElement>(),
    });
  },
);
void mock.module("../src/ai-componentize.ts", () => ({ aiComponentize }));

/* Annotated with the real VerifyResult so a per-test override can populate the arrays: inference
   from the default implementation types them `never[]`, which then rejects the very cases worth
   testing — a page that logged console errors, a build that reported one. */
const verifyProject = mock((opts: VerifyOptions): Promise<VerifyResult> => {
  opts.onProgress?.("Building site...");
  return Promise.resolve({
    pages: [
      {
        route: "pages/index.json",
        sourceUrl: "https://site.example/",
        fidelity: 97.5,
        mismatchedPixels: 10,
        totalPixels: 400,
        diffImagePath: "d",
        originalScreenshotPath: "o",
        renderedScreenshotPath: "r",
        consoleErrors: [],
        failedRequests: [],
      },
    ],
    averageFidelity: 97.5,
    reportDir: "/tmp/report",
    buildErrors: [],
    passed: true,
  });
});
void mock.module("../src/verify.ts", () => ({ verifyProject }));

const page = (title: string, extra?: JxElement[]): JxElement => ({
  tagName: "div",
  children: [
    { tagName: "header", children: ["Shared header"] },
    { tagName: "main", children: [title, ...(extra ?? [])] },
    { tagName: "footer", children: ["Shared footer"] },
  ],
});

const crawlSite = mock((opts: CrawlOptions): Promise<CrawlResult> => {
  opts.onProgress?.("  [1/10] Capturing...");
  return Promise.resolve({
    pages: [
      {
        url: "https://site.example/",
        route: "pages/index.json",
        title: "Home",
        jx: { document: page("Home"), nodeCount: 4, collectedStyles: [] },
        depth: 0,
        links: [],
      },
      {
        url: "https://site.example/about",
        route: "pages/about.json",
        title: "About",
        jx: { document: page("About"), nodeCount: 4, collectedStyles: [] },
        depth: 1,
        links: [],
        screenshot: new Uint8Array([1, 2, 3]),
      },
    ],
    breakpoints: { "--sm": "(max-width: 640px)" },
    skippedByRobots: ["https://site.example/admin"],
    skippedByNodeCap: ["https://site.example/huge"],
    fontFaceRules: [],
    fontRewriteMap: new Map<string, string>(),
    styleTokens: undefined,
  });
});
void mock.module("../src/crawl.ts", () => ({ crawlSite }));

const { importSite } = await import("../src/run.ts");

/** The arguments of one recorded call (default: the first), failing the test if it never happened. */
function callArgs<Args extends unknown[]>(calls: Args[], index = 0): Args {
  const args = calls.at(index);
  if (args === undefined) {
    throw new Error(`the mock has no call at index ${index}`);
  }
  return args;
}

interface ProgressEvent {
  phase: string;
  message: string;
  /** Present on the `seed` event alone — the root a host can open straight away. */
  root?: string;
}

function freshOutDir(): string {
  const base = mkdtempSync(join(tmpdir(), "jx-run-test-"));
  return join(base, "out");
}

beforeEach(() => {
  for (const m of [
    launchBrowser,
    closeBrowser,
    capturePage,
    captureStyles,
    extractMedia,
    collectAssets,
    downloadAssets,
    emitMultiPageProject,
    componentize,
    aiComponentize,
    verifyProject,
    crawlSite,
    pageClose,
    pageSetViewport,
    pageScreenshot,
  ]) {
    m.mockClear();
  }
});

describe("importSite — validation", () => {
  test("rejects a non-http(s) URL", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(importSite({ url: "ftp://x", outDir: freshOutDir() })).rejects.toThrow(
      "URL must start with http:// or https://",
    );
  });

  test("rejects a relative outDir", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(importSite({ url: "https://x.example", outDir: "relative/dir" })).rejects.toThrow(
      "absolute path",
    );
  });

  test("rejects a non-empty outDir", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-run-nonempty-"));
    writeFileSync(join(dir, "existing.txt"), "x");
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(importSite({ url: "https://x.example", outDir: dir })).rejects.toThrow(
      "is not empty",
    );
  });

  test("tolerates its OWN seed, so a re-entered run is not refused by its first statement", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jx-run-seeded-"));
    writeFileSync(join(dir, "project.json"), '{ "name": "x" }');
    const result = await importSite({ url: "https://site.example/", outDir: dir, maxDepth: 0 });
    expect(result.outDir).toBe(dir);
  });
});

describe("importSite — the seed", () => {
  test("creates the destination and announces the root before the browser launches", async () => {
    const events: ProgressEvent[] = [];
    const outDir = freshOutDir();
    await importSite({ url: "https://www.site.example/", outDir, maxDepth: 0 }, (e) => {
      events.push(e);
    });

    expect(events[0]).toEqual({
      message: `Created ${outDir}`,
      phase: "seed",
      root: outDir,
    });
    // The seed lands before anything that could take minutes, which is the point of it.
    expect(events.findIndex((e) => e.phase === "seed")).toBeLessThan(
      events.findIndex((e) => e.phase === "launch"),
    );
    const seeded = await Bun.file(join(outDir, "project.json")).json();
    expect(seeded.name).toBe("site.example");
  });

  test("falls back to a placeholder name when the URL has no readable hostname", async () => {
    const outDir = freshOutDir();
    capturePage.mockResolvedValueOnce({
      url: "https://site.example/",
      title: "Example Site",
      bodyHtml: "<div></div>",
      links: [],
      page: { close: pageClose, setViewport: pageSetViewport, screenshot: pageScreenshot },
    });
    // `importSite` has already accepted the scheme; this is the belt-and-braces branch for a URL
    // That parses at the guard and not at `new URL` — an empty authority.
    await importSite({ url: "https://", outDir, maxDepth: 0 });
    const seeded = await Bun.file(join(outDir, "project.json")).json();
    expect(seeded.name).toBe("Imported Site");
  });
});

describe("importSite — single-page mode", () => {
  test("runs capture → styles → assets → emit and reports progress", async () => {
    const events: ProgressEvent[] = [];
    const outDir = freshOutDir();
    const result = await importSite({ url: "https://site.example/", outDir, maxDepth: 0 }, (e) => {
      events.push(e);
    });

    const phases = events.map((e) => e.phase);
    for (const phase of ["launch", "capture", "styles", "assets", "emit", "done"]) {
      expect(phases).toContain(phase);
    }
    expect(result.outDir).toBe(outDir);
    expect(result.pages).toEqual([
      { route: "pages/index.json", title: "Example Site", nodeCount: expect.any(Number) },
    ]);
    expect(result.fileCount).toBe(3);
    expect(result.verify).toBeNull();
    // Failed asset downloads surface as warnings.
    expect(result.warnings.some((w) => w.includes("failed to download"))).toBe(true);
    expect(pageClose).toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
    // No @media queries in the mock → extractMedia is never consulted.
    expect(extractMedia).not.toHaveBeenCalled();
  });

  test("threads the chrome path into launchBrowser", async () => {
    await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      chromePath: "/opt/chromium/bin/chromium",
    });
    expect(launchBrowser).toHaveBeenCalledWith({
      executablePath: "/opt/chromium/bin/chromium",
    });
  });

  test("skips styles and assets when disabled", async () => {
    const events: ProgressEvent[] = [];
    await importSite(
      {
        url: "https://site.example/",
        outDir: freshOutDir(),
        maxDepth: 0,
        styles: false,
        assets: false,
      },
      (e) => events.push(e),
    );
    expect(captureStyles).not.toHaveBeenCalled();
    expect(collectAssets).not.toHaveBeenCalled();
    const phases = new Set(events.map((e) => e.phase));
    expect(phases.has("styles")).toBe(false);
    expect(phases.has("assets")).toBe(false);
  });

  test("extracts breakpoints when the page has media queries", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [],
      uaDefaults: {},
      mediaQueries: ["(max-width: 768px)"],
      customProperties: { "--brand": "rgb(1, 2, 3)" },
      documentStyles: {},
    });
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 });
    expect(extractMedia).toHaveBeenCalled();
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.breakpoints).toEqual({ "--md": "(max-width: 768px)" });
  });

  test("names the breakpoints it kept and the widths that folded into them", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [],
      uaDefaults: {},
      mediaQueries: [
        "(max-width: 520px)",
        "(min-width: 600px)",
        "(max-width: 767px)",
        "(min-width: 782px)",
        "(min-width: 1390px)",
      ],
      customProperties: {},
      documentStyles: {},
    });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    const line = events.map((e) => e.message).find((m) => m.includes("breakpoints declared"));
    expect(line).toBe("5 breakpoints declared, keeping 3: --520 (+600), --767 (+782), --1390");
  });

  test("says so when it is keeping every declared breakpoint", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [],
      uaDefaults: {},
      mediaQueries: ["(max-width: 520px)", "(min-width: 1390px)"],
      customProperties: {},
      documentStyles: {},
    });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    expect(events.map((e) => e.message)).toContain("Keeping all 2 declared breakpoints");
  });

  test("warns about width queries it could not read, naming them", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [],
      uaDefaults: {},
      mediaQueries: ["(min-width: 48rem)", "(hover: hover)"],
      customProperties: {},
      documentStyles: {},
    });
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
    });
    expect(result.warnings.some((w) => w.includes("(min-width: 48rem)"))).toBe(true);
    // A query with no width in it is not a lost breakpoint and must not be reported as one.
    expect(result.warnings.some((w) => w.includes("(hover: hover)"))).toBe(false);
  });

  test("honours an explicit breakpoint policy", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [],
      uaDefaults: {},
      mediaQueries: ["(max-width: 767px)", "(min-width: 1390px)"],
      customProperties: {},
      documentStyles: {},
    });
    await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      breakpoints: { mode: "explicit", rounding: "nearest", widths: [768] },
    });
    const [_page, _base, _uaDefaults, _queries, options] = callArgs(extractMedia.mock.calls, -1);
    expect(options?.policy).toEqual({ mode: "explicit", rounding: "nearest", widths: [768] });
  });

  test("reports what the class strip removed", async () => {
    emitMultiPageProject.mockResolvedValueOnce({
      classesStripped: 42,
      files: ["project.json"],
      projectJson: "{}\n",
    });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    expect(events.map((e) => e.message)).toContain("Wrote 1 files, stripped 42 source class names");
  });

  test("reports sub-kilobyte download sizes and skipped tracking URLs", async () => {
    downloadAssets.mockResolvedValueOnce({
      rewriteMap: new Map([["https://site.example/hero.jpg", "/assets/images/hero.jpg"]]),
      failed: [],
      skipped: ["https://site.example/analytics.js"],
      totalBytes: 512,
    });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    const messages = events.map((e) => e.message);
    expect(messages.some((m) => m.includes("512 B"))).toBe(true);
    expect(messages.some((m) => m.includes("Skipped 1 tracking/analytics URLs"))).toBe(true);
  });

  test("reports megabyte-range download sizes", async () => {
    downloadAssets.mockResolvedValueOnce({
      rewriteMap: new Map([["https://site.example/hero.jpg", "/assets/images/hero.jpg"]]),
      failed: [],
      skipped: [],
      totalBytes: 3 * 1024 * 1024,
    });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    expect(events.some((e) => e.message.includes("3.0 MB"))).toBe(true);
  });

  test("extracts design tokens when custom properties match computed values", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [{ path: [0], tagName: "h1", styles: { color: "rgb(4, 5, 6)" } }],
      uaDefaults: {},
      mediaQueries: [],
      customProperties: { "--ink": "rgb(4, 5, 6)" },
      documentStyles: {},
    });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    expect(events.some((e) => e.message.includes("design tokens"))).toBe(true);
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.styleTokens).toEqual({ "--ink": "rgb(4, 5, 6)" });
  });

  test("reports when media queries yield no breakpoint deltas", async () => {
    captureStyles.mockResolvedValueOnce({
      elements: [],
      uaDefaults: {},
      mediaQueries: ["(max-width: 500px)"],
      customProperties: {},
      documentStyles: {},
    });
    extractMedia.mockResolvedValueOnce({ breakpoints: {}, deltas: {} });
    const events: ProgressEvent[] = [];
    await importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }, (e) => {
      events.push(e);
    });
    expect(events.some((e) => e.message.includes("No responsive breakpoints"))).toBe(true);
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.breakpoints).toBeUndefined();
  });

  test("warns on pages above the node cap", async () => {
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      maxNodesPerPage: 1,
    });
    expect(result.warnings.some((w) => w.includes("Large page"))).toBe(true);
  });

  test("runs the AI componentize pass and forwards the refined components to emit", async () => {
    await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      ai: { apiKey: "sk-test", baseUrl: "http://llm.local/v1", model: "test-model" },
    });
    expect(componentize).toHaveBeenCalled();
    expect(aiComponentize).toHaveBeenCalled();
    const [, aiOpts] = callArgs(aiComponentize.mock.calls);
    expect(aiOpts).toEqual({
      apiKey: "sk-test",
      baseUrl: "http://llm.local/v1",
      model: "test-model",
    });
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.componentizeOptions).toBe(false);
    expect(emitOpts.precomputedComponents?.components.has("hero-banner")).toBe(true);
  });

  test("skips the AI pass when the heuristic finds no components", async () => {
    componentize.mockReturnValueOnce({
      components: new Map<string, { tagName: string }>(),
      rewrittenPages: new Map<string, JxElement>(),
    });
    await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      ai: { apiKey: "sk-test" },
    });
    expect(componentize).toHaveBeenCalled();
    expect(aiComponentize).not.toHaveBeenCalled();
    // Emit falls back to its own heuristic pass: no precomputed components handed over.
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.precomputedComponents).toBeUndefined();
    expect(emitOpts.componentizeOptions).toEqual({});
  });

  test("skips the AI pass when componentization is disabled", async () => {
    await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      componentize: false,
      ai: { apiKey: "sk-test" },
    });
    expect(componentize).not.toHaveBeenCalled();
    expect(aiComponentize).not.toHaveBeenCalled();
    // Emit is told not to componentize either, and is handed nothing precomputed.
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.componentizeOptions).toBe(false);
    expect(emitOpts.precomputedComponents).toBeUndefined();
  });

  test("verify captures a reference screenshot and reports fidelity", async () => {
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      verify: { threshold: 0.2 },
    });
    /* The reference is shot through the page itself now — reaching into verify.ts for it would
       have put a compiler and Bun.serve in the portable pipeline's import graph. */
    expect(pageScreenshot).toHaveBeenCalledWith({ fullPage: true, type: "png" });
    const [verifyOpts] = callArgs(verifyProject.mock.calls);
    expect(verifyOpts.threshold).toBe(0.2);
    // An identity check on an opaque handle: the mocked launchBrowser's stand-in is no Browser.
    expect<unknown>(verifyOpts.browser).toBe(fakeBrowser);
    // The whole scrollable page by default — the old viewport-only diff looked at the first 900px.
    expect(verifyOpts.fullPage).toBe(true);
    /* Per page, not just the average: "average fidelity 97.5%" is a fact nobody can act on, and
       "the pricing page renders at 61%" is a decision. */
    expect(result.verify).toEqual({
      averageFidelity: 97.5,
      buildErrors: [],
      minFidelity: 0,
      pages: [{ consoleErrors: 0, failedRequests: 0, fidelity: 97.5, route: "pages/index.json" }],
      passed: true,
      reportDir: "/tmp/report",
    });
  });

  /*
   * Issue #232: nothing about verify could fail. Build errors were logged inside the verifier and
   * dropped, and an 8%-fidelity clone finished exactly like a 95% one.
   */
  test("a run below the minimum fidelity does not pass, and says so", async () => {
    verifyProject.mockImplementationOnce(() =>
      Promise.resolve({
        averageFidelity: 8.17,
        buildErrors: [],
        pages: [
          {
            consoleErrors: ["Failed to load resource"],
            diffImagePath: "d",
            failedRequests: ["404 /assets/images/logo.webp"],
            fidelity: 8.17,
            mismatchedPixels: 400,
            originalScreenshotPath: "o",
            renderedScreenshotPath: "r",
            route: "pages/index.json",
            sourceUrl: "https://site.example/",
            totalPixels: 500,
          },
        ],
        passed: false,
        reportDir: "/tmp/report",
      }),
    );
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      verify: { minFidelity: 25 },
    });

    expect(result.verify!.passed).toBe(false);
    expect(result.verify!.minFidelity).toBe(25);
    // The counts a percentage cannot carry: 404s are why this page scores 8%.
    expect(result.verify!.pages).toEqual([
      { consoleErrors: 1, failedRequests: 1, fidelity: 8.17, route: "pages/index.json" },
    ]);
    expect(result.warnings.some((w) => w.includes("Verification failed"))).toBe(true);
  });

  test("build errors reach the caller as warnings instead of being swallowed", async () => {
    verifyProject.mockImplementationOnce(() =>
      Promise.resolve({
        averageFidelity: 99,
        buildErrors: ["Error compiling /about: unknown $ref"],
        pages: [],
        passed: false,
        reportDir: "/tmp/report",
      }),
    );
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      verify: {},
    });

    expect(result.verify!.buildErrors).toEqual(["Error compiling /about: unknown $ref"]);
    expect(result.warnings.some((w) => w.includes("unknown $ref"))).toBe(true);
  });

  test("a page the verifier could not render carries its reason", async () => {
    // A page at 0% because it failed to build is a different finding from one that rendered badly.
    verifyProject.mockImplementationOnce(() =>
      Promise.resolve({
        averageFidelity: 0,
        pages: [
          {
            diffImagePath: "d",
            error: "Navigation failed",
            fidelity: 0,
            mismatchedPixels: 0,
            originalScreenshotPath: "o",
            renderedScreenshotPath: "r",
            route: "pages/about.json",
            sourceUrl: "https://site.example/about",
            totalPixels: 0,
            consoleErrors: [],
            failedRequests: [],
          },
        ],
        buildErrors: [],
        passed: false,
        reportDir: "/tmp/report",
      }),
    );
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      maxDepth: 0,
      verify: {},
    });
    expect(result.verify!.pages).toEqual([
      {
        consoleErrors: 0,
        error: "Navigation failed",
        failedRequests: 0,
        fidelity: 0,
        route: "pages/about.json",
      },
    ]);
  });

  test("an aborted signal stops the pipeline and still closes the browser", async () => {
    const controller = new AbortController();
    controller.abort();
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(
      importSite({
        url: "https://site.example/",
        outDir: freshOutDir(),
        maxDepth: 0,
        signal: controller.signal,
      }),
    ).rejects.toThrow("Import aborted");
    expect(capturePage).not.toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
  });

  test("emit failures propagate and still close the browser", async () => {
    emitMultiPageProject.mockRejectedValueOnce(new Error("disk full"));
    // oxlint-disable-next-line typescript/await-thenable -- rejects.toThrow resolves a Promise at runtime.
    await expect(
      importSite({ url: "https://site.example/", outDir: freshOutDir(), maxDepth: 0 }),
    ).rejects.toThrow("disk full");
    expect(closeBrowser).toHaveBeenCalled();
  });
});

describe("importSite — crawl mode", () => {
  test("maps options onto crawlSite and aggregates the result", async () => {
    const events: ProgressEvent[] = [];
    const outDir = freshOutDir();
    const result = await importSite(
      {
        url: "https://site.example/",
        outDir,
        maxDepth: 2,
        maxPages: 10,
        styles: false,
        assets: false,
        scroll: false,
        respectRobots: false,
      },
      (e) => events.push(e),
    );

    const [crawlOpts] = callArgs(crawlSite.mock.calls);
    expect(crawlOpts.maxDepth).toBe(2);
    expect(crawlOpts.maxPages).toBe(10);
    expect(crawlOpts.skipStyles).toBe(true);
    expect(crawlOpts.skipAssets).toBe(true);
    expect(crawlOpts.noScroll).toBe(true);
    expect(crawlOpts.respectRobots).toBe(false);
    expect(crawlOpts.captureScreenshots).toBe(false);

    // Two structurally-identical header/footer pages → a shared layout is detected and emitted.
    const [emitOpts] = callArgs(emitMultiPageProject.mock.calls);
    expect(emitOpts.layout).toBeDefined();
    const phases = new Set(events.map((e) => e.phase));
    expect(phases.has("layout")).toBe(true);

    expect(result.pages).toEqual([
      { route: "pages/index.json", title: "Home", nodeCount: 4 },
      { route: "pages/about.json", title: "About", nodeCount: 4 },
    ]);
    // Node-cap skips surface as warnings.
    expect(result.warnings.some((w) => w.includes("node cap"))).toBe(true);
    expect(closeBrowser).toHaveBeenCalled();
  });

  test("verify uses the screenshots captured during the crawl", async () => {
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      verify: {},
    });
    const [verifyOpts] = callArgs(verifyProject.mock.calls);
    // Only the page that has a screenshot participates.
    expect([...verifyOpts.pages.keys()]).toEqual(["pages/about.json"]);
    expect(verifyOpts.threshold).toBe(0.15);
    expect(result.verify?.averageFidelity).toBe(97.5);
    /*
     * The crawl frames its references the same way the verifier renders the clone. Half of a
     * comparison captured at the viewport and the other half full-page is not a comparison at all:
     * the diff pads the shorter image, so everything below the fold counts as a mismatch.
     */
    const [crawlOpts] = callArgs(crawlSite.mock.calls, -1);
    expect(crawlOpts.fullPageScreenshots).toBe(true);
  });

  test("skips verify when the crawl produced no screenshots", async () => {
    crawlSite.mockResolvedValueOnce({
      pages: [
        {
          url: "https://site.example/",
          route: "pages/index.json",
          title: "Home",
          jx: { document: page("Home"), nodeCount: 4, collectedStyles: [] },
          depth: 0,
          links: [],
        },
      ],
      breakpoints: undefined,
      skippedByRobots: [],
      skippedByNodeCap: [],
      fontFaceRules: [],
      fontRewriteMap: new Map(),
      styleTokens: undefined,
    });
    const result = await importSite({
      url: "https://site.example/",
      outDir: freshOutDir(),
      verify: {},
    });
    expect(verifyProject).not.toHaveBeenCalled();
    expect(result.verify).toBeNull();
  });
});
