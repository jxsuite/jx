import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { setProjectState } from "../src/store";
import type { ProjectConfig } from "@jxsuite/schema/types";
import {
  getEffectiveElements,
  getEffectiveHead,
  getEffectiveImports,
  getEffectiveLocales,
  getEffectiveMedia,
  getEffectiveRenderLocale,
  getEffectiveStyle,
} from "../src/site-context";

/**
 * Open an empty project whose `project.json` is `projectConfig`, the only member site-context
 * reads.
 */
function openProject(projectConfig: ProjectConfig | null): void {
  setProjectState({
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: projectConfig !== null,
    name: "site",
    projectConfig,
    projectRoot: "",
    searchQuery: "",
    selectedPath: null,
  });
}

beforeEach(() => {
  openProject(null);
});

// ─── getEffectiveMedia ─────────────────────────────────────────────────────

describe("getEffectiveMedia", () => {
  test("returns doc media when no project config", () => {
    const docMedia = { "--sm": "(min-width: 640px)" };
    expect(getEffectiveMedia(docMedia)).toEqual(docMedia);
  });

  test("returns empty object when no doc media and no project config", () => {
    expect(getEffectiveMedia()).toEqual({});
  });

  test("returns site media when no doc media", () => {
    openProject({ $media: { "--lg": "(min-width: 1024px)" } });
    expect(getEffectiveMedia()).toEqual({
      "--lg": "(min-width: 1024px)",
    });
  });

  test("merges site and doc media (doc wins)", () => {
    openProject({
      $media: { "--lg": "(min-width: 1024px)", "--md": "(min-width: 768px)" },
    });
    const docMedia = { "--md": "(min-width: 800px)" };
    const result = getEffectiveMedia(docMedia);
    expect(result["--md"]).toBe("(min-width: 800px)");
    expect(result["--lg"]).toBe("(min-width: 1024px)");
  });
});

// ─── getEffectiveStyle ─────────────────────────────────────────────────────

describe("getEffectiveStyle", () => {
  test("returns doc style when no project config", () => {
    const docStyle = { color: "red" };
    expect(getEffectiveStyle(docStyle)).toEqual(docStyle);
  });

  test("returns empty object when nothing defined", () => {
    expect(getEffectiveStyle()).toEqual({});
  });

  test("returns site style when no doc style", () => {
    openProject({ style: { margin: "0" } });
    expect(getEffectiveStyle()).toEqual({ margin: "0" });
  });

  test("merges styles (doc wins for flat values)", () => {
    openProject({ style: { color: "blue", margin: "0" } });
    const result = getEffectiveStyle({ color: "red" });
    expect(result.color).toBe("red");
    expect(result.margin).toBe("0");
  });

  test("shallow-merges nested selector objects", () => {
    openProject({ style: { ":hover": { color: "blue", opacity: "0.8" } } });
    const result = getEffectiveStyle({ ":hover": { color: "red" } });
    expect(result[":hover"]).toEqual({ color: "red", opacity: "0.8" });
  });
});

// ─── getEffectiveImports ───────────────────────────────────────────────────

describe("getEffectiveImports", () => {
  test("returns doc imports when no project config", () => {
    const imports = { MyComp: "./comp.json" };
    expect(getEffectiveImports(imports)).toEqual(imports);
  });

  test("returns empty object when nothing defined", () => {
    expect(getEffectiveImports()).toEqual({});
  });

  test("returns site imports when no doc imports", () => {
    openProject({ imports: { Parser: "@jx/parser" } });
    expect(getEffectiveImports()).toEqual({ Parser: "@jx/parser" });
  });

  test("merges imports (doc wins)", () => {
    openProject({ imports: { A: "a.json", B: "b.json" } });
    const result = getEffectiveImports({ A: "override.json" });
    expect(result.A).toBe("override.json");
    expect(result.B).toBe("b.json");
  });

  test("the enabled extensions' classes come last, as the build resolves a bare $prototype", () => {
    openProject({ imports: { ContentEntry: "./mine/ContentEntry.class.json" } });
    const extensions = [
      {
        classes: [
          { name: "ContentEntry", path: "/ext/parser/ContentEntry.class.json" },
          { name: "Markdown", path: "/ext/parser/Markdown.class.json" },
          { name: "NotAClass", path: "/ext/parser/readme.md" },
        ],
        contributions: [],
        name: "@jxsuite/parser",
        specifier: "@jxsuite/parser",
      },
      {
        classes: [{ name: "Markdown", path: "/ext/other/Markdown.class.json" }],
        contributions: [],
        name: "other",
        specifier: "other",
      },
      { contributions: [], name: "bare", specifier: "bare" },
    ];
    expect(getEffectiveImports({}, extensions)).toEqual({
      // The project's own mapping wins over the registry's.
      ContentEntry: "./mine/ContentEntry.class.json",
      // The first extension to declare a name keeps it.
      Markdown: "/ext/parser/Markdown.class.json",
    });
  });
});

// ─── getEffectiveElements ──────────────────────────────────────────────────

describe("getEffectiveElements", () => {
  test("returns doc elements when no project config", () => {
    const els = [{ $ref: "./a.json" }];
    expect(getEffectiveElements(els)).toEqual(els);
  });

  test("returns empty array when nothing defined", () => {
    expect(getEffectiveElements()).toEqual([]);
  });

  test("returns site elements when no doc elements", () => {
    openProject({ $elements: [{ $ref: "./site.json" }] });
    expect(getEffectiveElements()).toEqual([{ $ref: "./site.json" }]);
  });

  test("deduplicates by $ref", () => {
    openProject({
      $elements: [{ $ref: "./a.json" }, { $ref: "./b.json" }],
    });
    const result = getEffectiveElements([{ $ref: "./a.json" }, { $ref: "./c.json" }]);
    // Site entries first, then the document's, each `$ref` once.
    expect(result).toEqual([{ $ref: "./a.json" }, { $ref: "./b.json" }, { $ref: "./c.json" }]);
  });

  test("handles string entries", () => {
    openProject({ $elements: ["./global.json"] });
    const result = getEffectiveElements(["./global.json", "./local.json"]);
    expect(result).toHaveLength(2);
  });
});

// ─── getEffectiveHead ──────────────────────────────────────────────────────

describe("getEffectiveHead", () => {
  test("returns doc head when no project config", () => {
    const head = [{ attributes: { href: "/style.css" }, tagName: "link" }];
    expect(getEffectiveHead(head)).toEqual(head);
  });

  test("returns empty array when nothing defined", () => {
    expect(getEffectiveHead()).toEqual([]);
  });

  test("returns site head when no doc head", () => {
    const siteHead = [{ attributes: { href: "/global.css" }, tagName: "link" }];
    openProject({ $head: siteHead });
    expect(getEffectiveHead()).toEqual(siteHead);
  });

  test("deduplicates by href", () => {
    openProject({
      $head: [
        { attributes: { href: "/a.css" }, tagName: "link" },
        { attributes: { href: "/b.css" }, tagName: "link" },
      ],
    });
    const result = getEffectiveHead([
      { attributes: { href: "/a.css" }, tagName: "link" },
      { attributes: { href: "/c.css" }, tagName: "link" },
    ]);
    expect(result).toHaveLength(3);
  });

  test("deduplicates by src", () => {
    openProject({
      $head: [{ attributes: { src: "/app.js" }, tagName: "script" }],
    });
    const result = getEffectiveHead([{ attributes: { src: "/app.js" }, tagName: "script" }]);
    expect(result).toHaveLength(1);
  });

  test("deduplicates by JSON.stringify for entries without href/src", () => {
    const meta = {
      attributes: { content: "width=device-width", name: "viewport" },
      tagName: "meta",
    };
    openProject({ $head: [meta] });
    const result = getEffectiveHead([meta]);
    expect(result).toHaveLength(1);
  });
});

// ─── getEffectiveLocales ───────────────────────────────────────────────────

/*
 * These are NOT a restatement of the compiler's locale rules. Studio and the compiler call the
 * same `resolveI18n` out of `@jxsuite/schema/locale`, so the two cannot disagree about what a tag
 * means. What is asserted here is only what this wrapper adds: that it hands the resolver the LIVE
 * project config, and that it answers a render rather than throwing on one.
 */
describe("getEffectiveLocales", () => {
  test("no project, and a project that declares none, are both null", () => {
    expect(getEffectiveLocales()).toBeNull();
    openProject({ name: "Demo" });
    expect(getEffectiveLocales()).toBeNull();
  });

  test("reads the live config, resolved the way the build resolves it", () => {
    openProject({ i18n: { defaultLocale: "EN-us", locales: ["en-US", "fr-ca", "not_a_tag"] } });
    expect(getEffectiveLocales()).toEqual({
      defaultLocale: "en-US",
      locales: ["en-US", "fr-CA"],
      routing: "prefix-except-default",
    });
  });

  /*
   * A malformed tag is a build error, and the resolver returns it as one. A render has nowhere to
   * put a sentence, so the sentence belongs to Project Settings — what this must not do is throw
   * on the way to drawing a menu.
   */
  test("a malformed tag is dropped rather than thrown, and the rest survives", () => {
    openProject({ i18n: { locales: ["en_US", "fr"] } });
    expect(getEffectiveLocales()?.locales).toEqual(["fr"]);
  });

  // `projectState` is replaced wholesale on a project switch, so a cached answer would describe a
  // Project that is no longer open.
  test("follows a project switch", () => {
    openProject({ i18n: { locales: ["en", "fr"] } });
    expect(getEffectiveLocales()?.locales).toHaveLength(2);
    openProject({ name: "Other" });
    expect(getEffectiveLocales()).toBeNull();
  });
});

// ─── getEffectiveRenderLocale ────────────────────────────────────────────────

describe("getEffectiveRenderLocale", () => {
  test("null in a project that declares no locales, whatever was chosen", () => {
    openProject({ name: "Demo" });
    expect(getEffectiveRenderLocale("ar", "pages/ar/about.json")).toBeNull();
  });

  test("a declared choice wins over the path and the default", () => {
    openProject({ i18n: { defaultLocale: "en", locales: ["en", "fr-CA", "ar"] } });
    expect(getEffectiveRenderLocale("en", "pages/ar/about.json")).toBe("en");
    expect(getEffectiveRenderLocale("fr-ca", "pages/about.json")).toBe("fr-CA");
  });

  // The restored-session case: the stored tag is ignored, not drawn.
  test("a choice the project no longer declares answers as if none were made", () => {
    openProject({ i18n: { defaultLocale: "en", locales: ["en", "fr"] } });
    expect(getEffectiveRenderLocale("ar", "pages/fr/a-propos.json")).toBe("fr");
  });

  // The file's own language, without being asked: an Arabic entry is drawn right to left.
  test("with no choice, the path's locale, page or entry, else the default", () => {
    openProject({ i18n: { defaultLocale: "en", locales: ["en", "fr-CA", "ar"] } });
    expect(getEffectiveRenderLocale(null, "pages/ar/about.json")).toBe("ar");
    expect(getEffectiveRenderLocale(null, "content/exhibitions/fr-ca/a.md")).toBe("fr-CA");
    expect(getEffectiveRenderLocale(null, "pages/about.json")).toBe("en");
    expect(getEffectiveRenderLocale(null, null)).toBe("en");
  });

  test("a project declaring one locale still answers it", () => {
    openProject({ i18n: { defaultLocale: "ar", locales: ["ar"] } });
    expect(getEffectiveRenderLocale(null, "pages/index.json")).toBe("ar");
  });
});
