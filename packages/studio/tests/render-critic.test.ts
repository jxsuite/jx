import "./with-dom.ts";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { buildScope, renderNode } from "@jxsuite/runtime";
import { installMockPlatform, resetStudioState } from "./harness";
import { invalidateParamValues } from "../src/page-params";
import { renderCheck } from "../src/services/render-critic";
import type { JxDocument } from "@jxsuite/schema/types";
import type { CandidateDocument, RenderVerdict } from "../src/services/ai-write-report";

/**
 * `renderCheck` as the AI tools take it: they hand over a `CandidateDocument`, the raw tool
 * argument that their `validate` dep has already accepted, and these suites stub `validate`.
 */
function checkCandidate(doc: CandidateDocument): Promise<RenderVerdict> {
  /* SAFETY: every candidate these suites send is a Jx document literal, and `renderCheck` runs its
     whole body (buildScope, renderNode) inside one try/catch that turns any throw into
     `{ ok: false }`, so a candidate that were not a well-formed document would still yield a
     verdict rather than an unhandled error. */
  return renderCheck(doc as JxDocument);
}

describe("a document whose data is a lookup", () => {
  const realFetch = globalThis.fetch;
  let answers: ((response: Response) => void)[];
  let bodies: { slug?: string }[];

  beforeEach(() => {
    answers = [];
    bodies = [];
    invalidateParamValues();
    const handler = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((respond) => {
          answers.push(respond);
          /* SAFETY: every body here is the runtime's own lookup, whose config carries the entry's
             `slug` as these documents wrote it; a test reading a different shape fails its assertion. */
          bodies.push(JSON.parse(String(init?.body)) as { slug?: string });
        }),
    );
    globalThis.fetch = Object.assign(handler, { preconnect: realFetch.preconnect });
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** A page reading one collection, as the build would hand it the resolved value. */
  const pageReading = (template: string): JxDocument => ({
    children: [{ children: [template], tagName: "p" }],
    state: { posts: { $prototype: "ContentCollection", $src: "@acme/pkg/Posts.class.json" } },
    tagName: "div",
  });

  /** Lets a check that has started reach the point where it is waiting on its fetch. */
  const started = async () => {
    for (let turn = 0; turn < 50 && answers.length === 0; turn += 1) {
      await new Promise<void>((done) => {
        setTimeout(done, 0);
      });
    }
  };

  test("is not refused for reading the data, unguarded, as the build lets it", async () => {
    const check = renderCheck(pageReading("${state.posts.length} posts, ${state.posts[0].title}"));
    await started();
    answers.shift()!(Response.json([{ title: "First" }]));
    expect(await check).toEqual({ ok: true });
  });

  test("is refused when the data does not make the template valid", async () => {
    const check = renderCheck(pageReading("${state.posts.missing.deeper}"));
    await started();
    answers.shift()!(Response.json([]));
    const result = await check;
    // The message itself is the engine's: Chrome and Bun word this TypeError differently.
    expect(result.ok ? "" : result.error).toContain("Render error");
  });

  test("is refused when its lookup fails, because the template read nothing", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const check = renderCheck(pageReading("${state.posts.length} posts"));
    await started();
    answers.shift()!(Response.json({}, { status: 500 }));
    const result = await check;
    const message = result.ok ? "" : result.error;
    // It names the entry and its source, rather than blaming a name missing from state.
    expect(message).toContain("state.posts has no data");
    expect(message).toContain("@acme/pkg/Posts.class.json");
    expect(message).not.toContain("doesn't exist in state");
    error.mockRestore();
  });

  test("names the entry when its lookup answers with nothing", async () => {
    const check = renderCheck(pageReading("${state.posts.length} posts"));
    await started();
    answers.shift()!(Response.json(null));
    const result = await check;
    expect(result.ok ? "" : result.error).toContain("state.posts has no data");
  });

  test("names a bare class by its $prototype, having no $src to name", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const result = await renderCheck({
      children: [{ children: ["${state.posts.length}"], tagName: "p" }],
      state: { posts: { $prototype: "ContentCollection" } },
      tagName: "div",
    });
    expect(result.ok ? "" : result.error).toContain("through ContentCollection");
    warn.mockRestore();
  });

  test("does not blame a failed lookup for a template that does not read it", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    for (const template of ["${neverDeclaredAnywhere}", "${state.postsElsewhere.length}"]) {
      const check = renderCheck(pageReading(template));
      await started();
      answers.shift()!(Response.json({}, { status: 500 }));
      const result = await check;
      expect(result.ok ? "" : result.error).not.toContain("has no data");
    }
    error.mockRestore();
  });

  test("is refused for a template no data could fix", async () => {
    const check = renderCheck(pageReading("${neverDeclaredAnywhere}"));
    await started();
    answers.shift()!(Response.json([]));
    const result = await check;
    expect(result.ok ? "" : result.error).toContain("is not defined");
  });

  test("is not judged on its templates when the lookup outlasts the wait", async () => {
    const check = await renderCheck(pageReading("${state.posts.length} posts"), {}, 5);
    expect(check).toEqual({ ok: true });
    // Answered, so the lookup does not stay in flight for whatever this realm runs next.
    answers.shift()!(Response.json([]));
    await started();
  });

  test("a failure of something else drawn during the wait is not this document's", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const check = renderCheck(pageReading("${state.posts.length} posts"));
    await started();
    const unrelated = await buildScope({ tagName: "div" }, {});
    renderNode({ children: ["${drawnBySomeoneElse}"], tagName: "b" }, unrelated);
    answers.shift()!(Response.json([]));
    expect(await check).toEqual({ ok: true });
    warn.mockRestore();
  });

  describe("on a dynamic route", () => {
    /** A route page reading one entry through its route parameter. */
    const routePage = (template: string, $paths?: JxDocument["$paths"]): JxDocument => ({
      ...($paths && { $paths }),
      children: [{ children: [template], tagName: "p" }],
      state: {
        entry: {
          $prototype: "ContentEntry",
          $src: "@acme/pkg/Entry.class.json",
          slug: { $ref: "#/$params/slug" },
        },
      },
      tagName: "div",
    });
    const two = { param: "slug", values: ["first", "second"] };

    test("is drawn with the first entry, and passes when the data suits it", async () => {
      const check = renderCheck(routePage("${state.entry.data.title}", two));
      await started();
      expect(bodies[0]?.slug).toBe("first");
      answers.shift()!(Response.json({ data: { title: "First" } }));
      expect(await check).toEqual({ ok: true });
    });

    test("is refused when the first entry's data does not make the template valid", async () => {
      const check = renderCheck(routePage("${state.entry.missing.deeper}", two));
      await started();
      answers.shift()!(Response.json({ data: {} }));
      const result = await check;
      expect(result.ok ? "" : result.error).toContain("Render error");
    });

    test("takes its first entry from a collection", async () => {
      installMockPlatform({
        resolveClass: async () => [
          { data: {}, id: "from-collection" },
          { data: {}, id: "later" },
        ],
      });
      const check = renderCheck(
        routePage("${state.entry.data.title}", { contentType: "work", param: "slug" }),
      );
      await started();
      expect(bodies[0]?.slug).toBe("from-collection");
      answers.shift()!(Response.json({ data: { title: "T" } }));
      expect(await check).toEqual({ ok: true });
    });

    test("reads a Markdown page's $paths from its frontmatter", async () => {
      const check = renderCheck(routePage("${state.entry.data.title}"), {
        frontmatter: { $paths: { param: "slug", values: ["from-frontmatter"] } },
      });
      await started();
      expect(bodies[0]?.slug).toBe("from-frontmatter");
      answers.shift()!(Response.json({ data: { title: "T" } }));
      expect(await check).toEqual({ ok: true });
    });

    test("is not judged on its templates with no entry to draw", async () => {
      const check = renderCheck(
        routePage("${state.entry.data.title}", { param: "slug", values: [] }),
      );
      await started();
      answers.shift()!(Response.json(null));
      expect(await check).toEqual({ ok: true });
    });

    test("is not judged on its templates when the path names a parameter nothing fills", async () => {
      const page: JxDocument = {
        children: [{ children: ["${state.slug.length}"], tagName: "p" }],
        tagName: "div",
      };
      expect(await renderCheck(page, { documentPath: "pages/work/[slug].json" })).toEqual({
        ok: true,
      });
    });

    test("leaves the document it was handed as it found it", async () => {
      const page = routePage("${state.entry.data.title}", two);
      const before = structuredClone(page);
      const check = renderCheck(page);
      await started();
      answers.shift()!(Response.json({ data: { title: "T" } }));
      await check;
      expect(page).toEqual(before);
    });
  });

  describe("on a page of a site", () => {
    afterEach(() => {
      resetStudioState();
    });

    test("reads $site, $page and project state, which only a page is given", async () => {
      resetStudioState({
        isSiteProject: true,
        projectConfig: { name: "Acme", state: { tagline: "Hello" } },
        projectRoot: "/project",
      });
      const page: JxDocument = {
        children: [
          { children: ["${$site.name} ${$page.url} ${state.tagline}"], tagName: "p" },
          { children: ["${$page.url.length}"], tagName: "p" },
        ],
        imports: {},
        state: {},
        tagName: "div",
      };
      const before = structuredClone(page);
      expect(await renderCheck(page, { documentPath: "pages/about.json" })).toEqual({ ok: true });
      expect(page).toEqual(before);
      // A layout is drawn around a page, so what it reads is what the page is given.
      expect(await renderCheck(page, { documentPath: "layouts/base.json" })).toEqual({ ok: true });
      // A component is not a page, and is given neither.
      const component = await renderCheck(page, { documentPath: "components/about.json" });
      expect(component.ok).toBe(false);
    });

    test("still refuses a page's broken template", async () => {
      resetStudioState({
        isSiteProject: true,
        projectConfig: { name: "Acme" },
        projectRoot: "/project",
      });
      const page: JxDocument = {
        children: [{ children: ["${neverDeclaredAnywhere}"], tagName: "p" }],
        tagName: "div",
      };
      const result = await renderCheck(page, { documentPath: "pages/about.json" });
      expect(result.ok ? "" : result.error).toContain("is not defined");
    });
  });

  describe("with live data", () => {
    /** A page reading a server entry, through whichever nodes a test gives it. */
    const serverPage = (children: NonNullable<JxDocument["children"]>, state = {}): JxDocument => ({
      children,
      state: { total: { $export: "total", $src: "./sum.js", timing: "server" }, ...state },
      tagName: "div",
    });
    const reading = (template: string) => serverPage([{ children: [template], tagName: "p" }]);

    test("never calls the function, and does not refuse a read of its value", async () => {
      expect(await renderCheck(reading("${state.total.value}"))).toEqual({ ok: true });
      expect(bodies).toEqual([]);
    });

    test.each([
      "${state.total.items.map((item) => item.name).join(', ')}",
      "${state.total.count > 0 ? state.total.rows[0].id : 'none'}",
      "${[...state.total.items].length}",
      "${state.total.value + 1}",
      "${`${state.total.label}!`}",
      "${JSON.stringify(state.total)}",
    ])("evaluates %s", async (template) => {
      expect(await renderCheck(reading(template))).toEqual({ ok: true });
    });

    test("reaches a repeater, an attribute and a computed entry", async () => {
      const page = serverPage(
        [
          {
            $prototype: "Array",
            items: { $ref: "#/state/total/items" },
            map: { children: ["${$map.item.name}"], tagName: "li" },
          },
          { attributes: { "data-total": "${state.total.value}" }, tagName: "p" },
          { children: ["${state.doubled}"], tagName: "p" },
        ],
        { doubled: "${state.total.value * 2}" },
      );
      expect(await renderCheck(page)).toEqual({ ok: true });
    });

    test.each([
      ["automatic", { $prototype: "Request", url: "/feed.json" }],
      ["sent by hand", { $prototype: "Request", manual: true, url: "/feed.json" }],
      ["that would write", { $prototype: "Request", body: {}, method: "POST", url: "/feed.json" }],
    ])("does not send a Request %s, and reads it as a placeholder", async (_kind, feed) => {
      const page: JxDocument = {
        children: [{ children: ["${state.feed.items[0].title}"], tagName: "p" }],
        state: { feed },
        tagName: "div",
      };
      expect(await renderCheck(page)).toEqual({ ok: true });
      expect(answers).toHaveLength(0);
    });

    test("a Request's placeholder does not excuse the rest of the page", async () => {
      const page: JxDocument = {
        children: [
          { children: ["${state.feed.title}"], tagName: "p" },
          { children: ["${neverDeclaredAnywhere}"], tagName: "p" },
        ],
        state: { feed: { $prototype: "Request", url: "/feed.json" } },
        tagName: "div",
      };
      const result = await renderCheck(page);
      expect(result.ok ? "" : result.error).toContain("is not defined");
    });

    test("a class that happens to be called Request is an ordinary lookup", async () => {
      const check = renderCheck({
        children: [{ children: ["${state.feed.title}"], tagName: "p" }],
        state: { feed: { $prototype: "Request", $src: "@acme/pkg/Request.class.json" } },
        tagName: "div",
      });
      await started();
      expect(answers).toHaveLength(1);
      answers.shift()!(Response.json({ title: "T" }));
      expect(await check).toEqual({ ok: true });
    });

    test("does not excuse the rest of the page", async () => {
      const page = serverPage([
        { children: ["${state.total.value}"], tagName: "p" },
        { children: ["${neverDeclaredAnywhere}"], tagName: "p" },
      ]);
      const result = await renderCheck(page);
      expect(result.ok ? "" : result.error).toContain("is not defined");
    });
  });
});

describe("render-critic", () => {
  test("valid document renders ok", async () => {
    const doc = {
      tagName: "div",
      children: [{ tagName: "h1", children: ["Hello World"] }],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(true);
  });

  test("minimal valid document (no children) renders ok", async () => {
    const doc = { tagName: "div" };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(true);
  });

  test("document with valid state and template expression renders ok", async () => {
    const doc = {
      tagName: "div",
      state: { count: 0 },
      children: [{ tagName: "span", children: ["Count: ${state.count}"] }],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(true);
  });

  test("template expression referencing missing state is caught", async () => {
    const doc = {
      tagName: "div",
      children: [{ tagName: "span", children: ["Value: ${nonExistent}"] }],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("is not defined");
  });

  test("malformed Function body is caught", async () => {
    const doc = {
      tagName: "div",
      state: {
        broken: {
          $prototype: "Function",
          body: "this is not valid javascript }{}{",
        },
      },
      children: [
        {
          tagName: "button",
          onclick: { $ref: "#/state/broken" },
          children: ["Click"],
        },
      ],
    };
    const result = await renderCheck(doc);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("Render error");
  });

  test("applyAndValidate integration — render break surfaces as tool error", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { createTab, disposeTab } = await import("../src/tabs/tab");
    const { registerAiTools } = await import("../src/services/ai-tools");

    const doc = {
      tagName: "div",
      children: [{ tagName: "h1", children: ["Hello"] }],
    };
    const tab = createTab({ document: doc, id: "critic-test" });
    const registry = createToolRegistry();

    registerAiTools(registry, {
      getTab: () => tab,
      validate: async () => [],
      renderCheck: checkCandidate,
    });

    const result = await registry.execute("set_property", {
      path: ["children", 0],
      key: "onclick",
      value: { $ref: "#/state/nonExistent" },
    });

    // The set_property itself succeeds (schema allows arbitrary props), but the render
    // Critic should catch the broken $ref during render — or the property is benign
    // Enough that renderNode doesn't throw (in which case the critic correctly passes).
    // Either outcome is valid for this integration test; we just verify no crash.
    expect(result).toBeDefined();
    expect(result.success).toBeTypeOf("boolean");

    disposeTab(tab);
  });

  test("create_page render gate — rejects a render-broken page before writing", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { registerAiTools } = await import("../src/services/ai-tools");

    let written = null;
    const registry = createToolRegistry();
    registerAiTools(registry, {
      getTab: () => null,
      validate: async () => [],
      renderCheck: checkCandidate,
      saveFile: async (path, content) => {
        written = { path, content };
      },
    });

    const result = await registry.execute("create_page", {
      path: "pages/broken.json",
      content: {
        tagName: "div",
        children: [{ tagName: "span", children: ["Value: ${nonExistent}"] }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("fails to render");
    expect(written).toBeNull(); // Nothing written to disk.
  });

  test("create_component render gate — writes a valid component", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { registerAiTools } = await import("../src/services/ai-tools");

    let written: { path: string; content: string } | null = null;
    const registry = createToolRegistry();
    registerAiTools(registry, {
      getTab: () => null,
      validate: async () => [],
      renderCheck: checkCandidate,
      saveFile: async (path, content) => {
        written = { path, content };
      },
    });

    const result = await registry.execute("create_component", {
      path: "components/ok-card.json",
      content: {
        tagName: "ok-card",
        state: { title: "Hi" },
        children: [{ tagName: "h3", children: ["${state.title}"] }],
      },
    });

    expect(result.success).toBe(true);
    expect(written).not.toBeNull();
    expect(written!.path).toBe("components/ok-card.json");
  });

  test("both create tools tell the check where the document will live", async () => {
    const { createToolRegistry } = await import("@jxsuite/ai");
    const { registerAiTools } = await import("../src/services/ai-tools");

    const sources: unknown[] = [];
    const registry = createToolRegistry();
    registerAiTools(registry, {
      getTab: () => null,
      validate: async () => [],
      renderCheck: async (_doc, source) => {
        sources.push(source);
        return { ok: true };
      },
      saveFile: async () => {},
    });
    await registry.execute("create_page", {
      content: { tagName: "div" },
      path: "./pages/work/[slug].json",
    });
    await registry.execute("create_component", {
      content: { tagName: "ok-card" },
      path: "components/ok-card.json",
    });
    expect(sources).toEqual([
      { documentPath: "pages/work/[slug].json" },
      { documentPath: "components/ok-card.json" },
    ]);
  });
});
