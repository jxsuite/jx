/**
 * Format-host edge paths the main suites do not reach: the two backend-failure fallbacks, and the
 * `documentMode.default` hint that decides a document's mode when no `componentWhen` rule matched.
 */
import { installMockPlatform } from "./harness";
import { describe, expect, mock, test } from "bun:test";
import type { StudioFormat } from "../src/format/format-host";

/* Both consumers of the per-project schemas are reached by dynamic import, and both are wrapped in a
   catch: a chunk that fails to load must cost the project its EDITOR HINTS, never its activation.
   Making the module factories throw is the only way to reach those handlers — nothing else in a test
   run can fail a local import. */
void mock.module("../src/services/jx-validate", () => {
  throw new Error("jx-validate chunk unavailable");
});
void mock.module("../src/settings/extension-sections", () => {
  throw new Error("extension-sections chunk unavailable");
});
const {
  getExtensionCatalog,
  getExtensions,
  getFormats,
  loadExtensionCatalog,
  loadExtensions,
  loadFormats,
  onFormatsChanged,
  refreshExtensionUi,
  refreshFormats,
  setFormats,
  splitFormatDocument,
} = await import("../src/format/format-host");

/* A backend that cannot answer must leave the studio with an EMPTY registry, not a rejected promise:
   every caller of loadFormats() is on a UI path (opening a file, the New Document picker), and a
   throw there takes the panel down. The cost of degrading is a "No format class imported" error on
   the specific file, which is the honest message. */
describe("format registry when the backend fails", () => {
  test("loadFormats degrades to an empty registry when listFormats throws", async () => {
    installMockPlatform({
      listFormats: async () => {
        throw new Error("registry exploded");
      },
    });
    setFormats([
      {
        capabilities: {},
        documentKinds: [],
        exportTarget: false,
        extensions: [],
        mediaType: null,
        name: "Stale",
        remote: false,
        studio: null,
      },
    ]);
    refreshFormats();
    expect(await loadFormats()).toEqual([]);
    expect(getFormats()).toEqual([]);
  });

  /* First touch of the extensions cache in this file, deliberately: `setExtensions` primes it with a
     resolved promise and there is no exported invalidator, so the load path is only reachable while
     the cache is still empty. `--isolate` gives each test file its own module state. */
  test("loadExtensions degrades to an empty list when listExtensions throws", async () => {
    installMockPlatform({
      listExtensions: async () => {
        throw new Error("extensions exploded");
      },
    });
    expect(await loadExtensions()).toEqual([]);
    expect(getExtensions()).toEqual([]);
  });

  /* Same cache discipline as the extensions payload above: first touch in this file, so the load
     path is reachable. A platform that cannot answer must cost the Extensions section its OFFER,
     never its ability to render what the project already names. */
  test("loadExtensionCatalog degrades to an empty list when the member throws", async () => {
    installMockPlatform({
      listExtensionCatalog: async () => {
        throw new Error("catalogue exploded");
      },
    });
    expect(await loadExtensionCatalog()).toEqual([]);
    expect(getExtensionCatalog()).toEqual([]);
  });
});

/* `componentWhen` is the specific rule (a frontmatter key matching a pattern); `default` is what the
   format declares for everything else. Markdown leaves it unset and falls through to content, so
   only a format that opts in exercises this. */
describe("documentMode.default", () => {
  const componentByDefault: StudioFormat = {
    capabilities: {},
    documentKinds: [],
    exportTarget: false,
    extensions: [],
    mediaType: null,
    name: "Bespoke",
    remote: false,
    studio: {
      documentMode: { componentWhen: { frontmatterKey: "tagName" }, default: "component" },
    },
  };

  test("a document that matched no componentWhen rule still opens as a component", () => {
    const split = splitFormatDocument(componentByDefault, { children: [], title: "No tagName" });
    expect(split.mode).toBe("component");
    expect(split.frontmatter).toEqual({});
    expect(split.document).toEqual({ children: [], title: "No tagName" });
  });

  test("the componentWhen rule still wins where it applies", () => {
    const split = splitFormatDocument(componentByDefault, { children: [], tagName: "x-card" });
    expect(split.mode).toBe("component");
  });
});

describe("project activation survives unloadable consumers", () => {
  test("refreshExtensionUi resolves even when both dynamic imports fail", async () => {
    installMockPlatform({});
    expect(() =>
      refreshExtensionUi({
        fetchProjectSchemas: async () => ({ document: { type: "object" }, project: {} }),
      }),
    ).not.toThrow();
    // Let both rejected imports settle; an unhandled rejection here would fail the run.
    await Promise.resolve();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
});

/* A content document's `state` and `imports` belong to the DOCUMENT, not its frontmatter: they are
   Jx machinery the editor binds against, while every other key is metadata the frontmatter panel
   owns. */
describe("content split", () => {
  test("state and imports stay on the document; other keys become frontmatter", () => {
    const split = splitFormatDocument(undefined, {
      children: [{ children: [], tagName: "p" }],
      imports: { "x-card": "./x-card.json" },
      state: { count: 0 },
      title: "Post",
    });
    expect(split.mode).toBe("content");
    expect(split.document).toMatchObject({
      imports: { "x-card": "./x-card.json" },
      state: { count: 0 },
    });
    expect(split.frontmatter).toEqual({ title: "Post" });
  });

  test("an empty content document gets one paragraph to type into", () => {
    const split = splitFormatDocument(undefined, { children: [] });
    expect(split.document.children).toEqual([{ children: [], tagName: "p" }]);
  });
});

/** A format record whose only distinguishing member is its name. */
function fmt(name: string, extensions: string[] = []): StudioFormat {
  return {
    capabilities: {},
    documentKinds: [],
    exportTarget: false,
    extensions,
    mediaType: null,
    name,
    remote: false,
    studio: null,
  };
}

/* The registry is fetched per project and again after a dependency install, and a fresh clone's
   first fetch answers with nothing. Whatever was derived from that answer (which files are routed
   pages) must hear that the answer changed. */
describe("onFormatsChanged", () => {
  test("fires when a re-fetch answers with a different set, and not when it answers the same", async () => {
    let answer: StudioFormat[] = [];
    installMockPlatform({ listFormats: async () => answer });
    setFormats([]);
    const heard = mock(() => {});
    const stop = onFormatsChanged(heard);
    try {
      refreshFormats();
      await loadFormats();
      expect(heard).not.toHaveBeenCalled();

      // The install landed: the same fetch now finds the markdown format.
      answer = [fmt("markdown", [".md"])];
      refreshFormats();
      await loadFormats();
      expect(heard).toHaveBeenCalledTimes(1);
      expect(getFormats().map((format) => format.name)).toEqual(["markdown"]);

      refreshFormats();
      await loadFormats();
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
    setFormats([]);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test("a fetch dropped while in flight cannot write its answer over the newer one", async () => {
    let release: (formats: StudioFormat[]) => void = () => {};
    let calls = 0;
    installMockPlatform({
      listFormats: () => {
        calls += 1;
        if (calls === 1) {
          return new Promise<StudioFormat[]>((resolve) => {
            release = resolve;
          });
        }
        return Promise.resolve([fmt("fresh")]);
      },
    });
    refreshFormats();
    const stale = loadFormats();
    refreshFormats();
    await loadFormats();
    release([fmt("stale")]);
    await stale;
    expect(getFormats().map((format) => format.name)).toEqual(["fresh"]);
  });

  test("one listener's failure does not keep the next from hearing", () => {
    // What the second listener could read when it was told: the new set, never the old one.
    const heard: string[][] = [];
    const stopThrowing = onFormatsChanged(() => {
      throw new Error("listener exploded");
    });
    const stopAfter = onFormatsChanged(() => {
      heard.push(getFormats().map((format) => format.name));
    });
    try {
      setFormats([fmt("one")]);
      setFormats([fmt("two")]);
    } finally {
      stopThrowing();
      stopAfter();
    }
    expect(heard).toEqual([["one"], ["two"]]);
    setFormats([]);
  });
});
