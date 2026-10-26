import { describe, expect, test } from "bun:test";
import { layoutChain, resolveLayout } from "../src/site/layout-resolver";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isString } from "@jxsuite/schema/guards";
import type { JsonObject, JxDocument, JxElement } from "@jxsuite/schema/types";

const FIXTURES = join(import.meta.dir, "_fixtures_layout");

function setup() {
  mkdirSync(join(FIXTURES, "layouts"), { recursive: true });
}

function cleanup() {
  rmSync(FIXTURES, { force: true, recursive: true });
}

/** @param {string} name @param {JsonObject} content */
function writeLayout(name: string, content: JsonObject) {
  writeFileSync(join(FIXTURES, "layouts", name), JSON.stringify(content), "utf8");
}

/** The message a pending resolution rejected with, or null when it resolved. */
async function rejectionOf(pending: Promise<JxDocument>): Promise<string | null> {
  try {
    await pending;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The first element child of `node` with the given tag, if its children are a plain list. */
function childTagged(node: JxElement | undefined, tagName: string): JxElement | undefined {
  const children = node?.children;
  if (!Array.isArray(children)) {
    return undefined;
  }
  return children.find(
    (child): child is JxElement => !isString(child) && child.tagName === tagName,
  );
}

// ─── resolveLayout ──────────────────────────────────────────────────────────

describe("resolveLayout", () => {
  test("returns page as-is when no layout specified", async () => {
    const page = { children: [{ tagName: "p" }], tagName: "div" };
    const result = await resolveLayout(page, {}, "/tmp");
    expect(result).toBe(page);
  });

  test("returns page as-is when $layout is not set and no defaults", async () => {
    const page = { children: [{ tagName: "p" }] };
    const result = await resolveLayout(page, { defaults: {} }, "/tmp");
    expect(result).toBe(page);
  });

  test("throws when layout file not found", async () => {
    const page = { $layout: "./layouts/missing.json" };
    expect(await rejectionOf(resolveLayout(page, {}, "/tmp"))).toContain("Layout not found");
  });

  test("distributes page children into layout slots", async () => {
    setup();
    try {
      writeLayout("base.json", {
        children: [
          {
            children: [{ tagName: "h1", textContent: "Header" }],
            tagName: "header",
          },
          { children: [{ tagName: "slot" }], tagName: "main" },
          {
            children: [{ tagName: "p", textContent: "Footer" }],
            tagName: "footer",
          },
        ],
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/base.json",
        children: [{ tagName: "p", textContent: "Page content" }],
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      const main = childTagged(result, "main");
      expect(main).toHaveProperty(["children", 0, "textContent"], "Page content");
    } finally {
      cleanup();
    }
  });

  test("distributes named slots", async () => {
    setup();
    try {
      writeLayout("slots.json", {
        children: [
          {
            children: [{ attributes: { name: "nav" }, tagName: "slot" }],
            tagName: "nav",
          },
          { children: [{ tagName: "slot" }], tagName: "main" },
        ],
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/slots.json",
        children: [
          { attributes: { slot: "nav" }, tagName: "a", textContent: "Link" },
          { tagName: "p", textContent: "Main content" },
        ],
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      const nav = childTagged(result, "nav");
      expect(nav).toHaveProperty(["children", 0, "tagName"], "a");
      expect(nav).toHaveProperty(["children", 0, "textContent"], "Link");

      const main = childTagged(result, "main");
      expect(main).toHaveProperty(["children", 0, "textContent"], "Main content");
    } finally {
      cleanup();
    }
  });

  test("merges page state onto layout state", async () => {
    setup();
    try {
      writeLayout("with-state.json", {
        children: [],
        state: { layoutVar: "from-layout" },
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/with-state.json",
        state: { pageVar: "from-page" },
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result.state?.layoutVar).toBe("from-layout");
      expect(result.state?.pageVar).toBe("from-page");
    } finally {
      cleanup();
    }
  });

  test("page state overrides layout state on conflict", async () => {
    setup();
    try {
      writeLayout("override.json", {
        children: [],
        state: { shared: "layout-value" },
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/override.json",
        state: { shared: "page-value" },
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result.state?.shared).toBe("page-value");
    } finally {
      cleanup();
    }
  });

  test("preserves page $head and title as _pageHead and _pageTitle", async () => {
    setup();
    try {
      writeLayout("meta.json", {
        children: [],
        tagName: "div",
      });

      const page = {
        $head: [
          {
            attributes: { content: "About page", name: "description" },
            tagName: "meta",
          },
        ],
        $layout: "./layouts/meta.json",
        title: "About Us",
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result._pageTitle).toBe("About Us");
      expect(result._pageHead).toHaveLength(1);
    } finally {
      cleanup();
    }
  });

  test("removes $layout from resolved document", async () => {
    setup();
    try {
      writeLayout("clean.json", { children: [], tagName: "div" });
      const page = { $layout: "./layouts/clean.json" };
      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result.$layout).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  test("uses project default layout when page has no $layout", async () => {
    setup();
    try {
      writeLayout("default.json", {
        children: [{ tagName: "slot" }],
        className: "default-layout",
        tagName: "div",
      });

      const page = {
        children: [{ tagName: "p", textContent: "Content" }],
      };
      const project = { defaults: { layout: "./layouts/default.json" } };

      const result = await resolveLayout(page, project, FIXTURES);
      expect(result.className).toBe("default-layout");
    } finally {
      cleanup();
    }
  });

  test("slot fallback content is used when no matching children", async () => {
    setup();
    try {
      writeLayout("fallback.json", {
        children: [
          {
            children: [
              {
                attributes: { name: "sidebar" },
                children: [{ tagName: "p", textContent: "Default sidebar" }],
                tagName: "slot",
              },
            ],
            tagName: "aside",
          },
          { children: [{ tagName: "slot" }], tagName: "main" },
        ],
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/fallback.json",
        children: [{ tagName: "p", textContent: "Main content" }],
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      const aside = childTagged(result, "aside");
      expect(aside).toHaveProperty(["children", 0, "textContent"], "Default sidebar");
    } finally {
      cleanup();
    }
  });

  test("throws on malformed layout JSON", async () => {
    setup();
    try {
      writeFileSync(join(FIXTURES, "layouts", "bad.json"), "{ not valid json", "utf8");
      const page = { $layout: "./layouts/bad.json" };
      expect(await rejectionOf(resolveLayout(page, {}, FIXTURES))).toContain("Invalid layout JSON");
    } finally {
      cleanup();
    }
  });

  test("resolves nested layouts (layout extending another layout)", async () => {
    setup();
    try {
      writeLayout("outer.json", {
        children: [{ children: [{ tagName: "slot" }], tagName: "body" }],
        tagName: "html",
      });
      writeLayout("inner.json", {
        $layout: "./layouts/outer.json",
        children: [{ tagName: "slot" }],
        className: "inner-wrapper",
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/inner.json",
        children: [{ tagName: "p", textContent: "Nested content" }],
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result.tagName).toBe("html");
      const body = childTagged(result, "body");
      expect(body).toBeDefined();
    } finally {
      cleanup();
    }
  });

  test("merges page $media onto layout $media", async () => {
    setup();
    try {
      writeLayout("media.json", {
        $media: { "--md": "(min-width: 768px)" },
        children: [{ tagName: "slot" }],
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/media.json",
        $media: { "--lg": "(min-width: 1024px)" },
        children: [{ tagName: "p" }],
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result.$media?.["--md"]).toBe("(min-width: 768px)");
      expect(result.$media?.["--lg"]).toBe("(min-width: 1024px)");
    } finally {
      cleanup();
    }
  });

  test("merges page style onto layout style", async () => {
    setup();
    try {
      writeLayout("styled.json", {
        children: [{ tagName: "slot" }],
        style: { color: "red" },
        tagName: "div",
      });

      const page = {
        $layout: "./layouts/styled.json",
        children: [{ tagName: "p" }],
        style: { fontSize: "16px" },
      };

      const result = await resolveLayout(page, {}, FIXTURES);
      expect(result.style?.color).toBe("red");
      expect(result.style?.fontSize).toBe("16px");
    } finally {
      cleanup();
    }
  });
});

// ─── layoutChain ────────────────────────────────────────────────────────────

describe("layoutChain", () => {
  test("layoutChain lists every layout a page is wrapped in, innermost first, with its path", () => {
    setup();
    try {
      writeLayout("outer.json", { children: [{ tagName: "slot" }], tagName: "html" });
      writeLayout("inner.json", {
        $layout: "./layouts/outer.json",
        children: [{ tagName: "slot" }],
        className: "inner-wrapper",
        tagName: "div",
      });

      const chain = layoutChain({ $layout: "./layouts/inner.json" }, {}, FIXTURES);
      expect(chain.map((level) => level.path)).toEqual([
        join(FIXTURES, "layouts", "inner.json"),
        join(FIXTURES, "layouts", "outer.json"),
      ]);
      expect(chain[0]?.doc.className).toBe("inner-wrapper");
      expect(chain[1]?.doc.tagName).toBe("html");
    } finally {
      cleanup();
    }
  });

  test("layoutChain is empty for `$layout: false` and with no default layout", () => {
    const project = { defaults: { layout: "./layouts/default.json" } };
    // `false` opts the page out even when the project names a default, so nothing is read.
    expect(layoutChain({ $layout: false }, project, FIXTURES)).toEqual([]);
    expect(layoutChain({}, {}, FIXTURES)).toEqual([]);
    expect(layoutChain({}, { defaults: { layout: null } }, FIXTURES)).toEqual([]);
  });

  test("layoutChain stops at a layout that names itself", () => {
    setup();
    try {
      writeLayout("loop.json", {
        $layout: "./layouts/loop.json",
        children: [{ tagName: "slot" }],
        tagName: "div",
      });

      const chain = layoutChain({ $layout: "./layouts/loop.json" }, {}, FIXTURES);
      expect(chain.map((level) => level.path)).toEqual([join(FIXTURES, "layouts", "loop.json")]);
    } finally {
      cleanup();
    }
  });

  test("layoutChain falls back to defaults.layout", () => {
    setup();
    try {
      writeLayout("default.json", { children: [{ tagName: "slot" }], tagName: "div" });

      const chain = layoutChain({}, { defaults: { layout: "./layouts/default.json" } }, FIXTURES);
      expect(chain.map((level) => level.path)).toEqual([join(FIXTURES, "layouts", "default.json")]);
    } finally {
      cleanup();
    }
  });
});

process.on("exit", () => {
  try {
    cleanup();
  } catch {}
});
