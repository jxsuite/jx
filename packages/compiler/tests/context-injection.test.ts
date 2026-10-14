/**
 * The compiler's filesystem half of context injection — the rebaser, and that it is wired.
 *
 * The injection rules themselves are tested in `@jxsuite/schema` beside the module they moved to.
 */
import { describe, expect, test } from "bun:test";
import { injectContext, nodeImportRebaser } from "../src/site/context-injection";
import { resolvePrototypes } from "../src/site/prototype-resolver";
import type { ProjectSections } from "../src/site/project-sections";
import type { JxDocument } from "@jxsuite/schema/types";
import type { SiteRoute } from "@jxsuite/site/context";

describe("nodeImportRebaser", () => {
  const route: SiteRoute = { sourcePath: "/site/pages/blog/hello.json", urlPattern: "/blog/hello" };

  test("rebases a project-relative import onto the page's own directory", () => {
    expect(nodeImportRebaser("/site")("./lib/helpers.ts", route)).toBe("./../../lib/helpers.ts");
  });

  test("a route with no source file has no directory to rebase onto", () => {
    const bare: SiteRoute = { urlPattern: "/generated" };
    expect(nodeImportRebaser("/site")("./lib/helpers.ts", bare)).toBe("./lib/helpers.ts");
  });

  test("injectContext wires the rebaser when given a project root", () => {
    const doc: JxDocument = {};
    injectContext(doc, { imports: { helpers: "./lib/helpers.ts" } }, route, "/site");
    expect(doc.imports?.helpers).toBe("./../../lib/helpers.ts");
  });

  test("no project root leaves the authored path alone", () => {
    const doc: JxDocument = {};
    injectContext(doc, { imports: { helpers: "./lib/helpers.ts" } }, route);
    expect(doc.imports?.helpers).toBe("./lib/helpers.ts");
  });
});

describe("injectContext with the prototype resolver", () => {
  const baseProject = { name: "Test Site", url: "https://example.com" };
  const baseRoute: SiteRoute = { urlPattern: "/about" };

  test("resolves ContentEntry with missing content type gracefully", async () => {
    const doc: JxDocument = {
      imports: {
        ContentEntry: "@jxsuite/parser/ContentEntry.class.json",
      },
      state: {
        post: {
          $prototype: "ContentEntry",
          contentType: "nonexistent",
          id: "abc",
        },
      },
    };
    const sections: ProjectSections = {
      content: new Map([["posts", [{ body: null, data: {}, id: "x" }]]]),
    };
    injectContext(doc, baseProject, baseRoute);
    await resolvePrototypes(doc, baseRoute, import.meta.dir, {
      config: baseProject,
      sections,
    });
    expect(doc.state?.post).toBeNull();
  });
});
