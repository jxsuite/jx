/**
 * The dependency graph (`specs/project-state.md` §8): one case per edge kind of §8.1, the
 * transitive and partial cases, relabels and configuration changes, and the events a host emits.
 */
import { describe, expect, test } from "bun:test";
import type { JsonValue } from "@jxsuite/schema/types";
import type { DocKind } from "@jxsuite/protocol/project-state";
import {
  createDependencyGraph,
  extractRefs,
  invalidationEvents,
  NO_REFS,
} from "../src/project-state/graph.ts";
import type { DependencyGraph, Invalidation } from "../src/project-state/graph.ts";
import { collectTagUses, countTagUses } from "../src/refactor/refs.ts";

/** Record a parsed document in the graph, as a host does after reading it. */
function put(
  graph: DependencyGraph,
  docId: string,
  path: string,
  doc: JsonValue,
  kind: DocKind,
): Invalidation[] {
  return graph.update(docId, path, extractRefs(doc, kind));
}

const plain = (map: Map<string, string[]>): Record<string, string[]> => Object.fromEntries(map);

const byKind = (invalidations: Invalidation[]): Record<string, string[]> =>
  Object.fromEntries(invalidations.map((entry) => [entry.kind, entry.docIds]));

describe("extractRefs", () => {
  test("collects references, instantiated tags, the declared tag and queried types", () => {
    const refs = extractRefs(
      {
        $elements: ["./x-icon.json"],
        children: [{ tagName: "my-card" }, { tagName: "my-card" }, { tagName: "div" }],
        state: {
          entry: { $prototype: "ContentEntry", contentType: "blog" },
          list: { $prototype: "ContentCollection", contentType: ["blog", "news"] },
          other: { $prototype: "Array" },
          plain: 3,
          untyped: { value: 1 },
        },
        tagName: "my-page",
      },
      "component",
    );
    expect(refs).toEqual({
      contentTypes: ["blog", "news"],
      defines: "my-page",
      implicitLayout: false,
      prototypes: ["Array", "ContentCollection", "ContentEntry"],
      refs: [{ refType: "$elements", rootRelativeBare: false, value: "./x-icon.json" }],
      tags: ["my-card"],
    });
  });

  test("a page with no $layout wraps in the default; one with $layout: false does not", () => {
    expect(extractRefs({ tagName: "main" }, "page").implicitLayout).toBe(true);
    expect(extractRefs({ $layout: false, tagName: "main" }, "page").implicitLayout).toBe(false);
    expect(extractRefs({ $layout: "./layouts/a.json" }, "page").implicitLayout).toBe(false);
    expect(extractRefs({ tagName: "main" }, "layout").implicitLayout).toBe(false);
    expect(extractRefs([1, 2], "page")).toEqual({ ...NO_REFS, implicitLayout: false });
  });

  test("collections listed in a nested state scope and in $paths, `each` included", () => {
    const refs = extractRefs(
      {
        $paths: {
          each: { contentType: "tags", param: "tag" },
          pageSize: 10,
          paginate: { $ref: "#/state/posts" },
        },
        children: [
          {
            state: { feed: { $prototype: "ContentCollection", contentType: ["news"] } },
            tagName: "aside",
          },
        ],
        tagName: "main",
      },
      "page",
    );
    expect(refs.contentTypes).toEqual(["news", "tags"]);
    expect(extractRefs({ $paths: [{ contentType: "kb" }, 3] }, "page").contentTypes).toEqual([
      "kb",
    ]);
  });

  test("prototype names, less the ones the document's own imports map", () => {
    const refs = extractRefs(
      {
        imports: { Local: "./local.class.json" },
        state: {
          card: { $prototype: "PostCard" },
          own: { $prototype: "Local" },
        },
      },
      "page",
    );
    expect(refs.prototypes).toEqual(["PostCard"]);
    expect(refs.refs).toEqual([
      { refType: "imports", rootRelativeBare: false, value: "./local.class.json" },
    ]);
  });

  test("only a component declares a tag, and only a custom element's", () => {
    expect(extractRefs({ tagName: "my-card" }, "page").defines).toBe(null);
    expect(extractRefs({ tagName: "div" }, "component").defines).toBe(null);
    expect(extractRefs({ state: [] }, "page").contentTypes).toEqual([]);
  });

  test("collectTagUses is countTagUses for every tag at once", () => {
    const doc: JsonValue = {
      children: [{ tagName: "a-b" }, { map: { tagName: "a-b" } }, [{ tagName: "c-d" }]],
      tagName: "main",
    };
    const uses = collectTagUses(doc);
    for (const tag of ["a-b", "c-d", "main", "nope"]) {
      expect(uses.get(tag) ?? 0).toBe(countTagUses(doc, tag));
    }
  });
});

describe("edge kinds (§8.1)", () => {
  test("component-instance: a definition reaches every document using its tag", () => {
    const graph = createDependencyGraph();
    put(graph, "card", "components/my-card.json", { tagName: "my-card" }, "component");
    put(graph, "about", "pages/about.json", { children: [{ tagName: "my-card" }] }, "page");
    put(graph, "home", "pages/index.json", { tagName: "main" }, "page");
    expect(plain(graph.dependentsOf("card"))).toEqual({ "component-instance": ["about"] });
    const removed = graph.remove("card");
    expect(removed).toEqual([
      { complete: true, docIds: ["about"], kind: "component-instance", tags: ["my-card"] },
    ]);
    expect(graph.remove("card")).toEqual([]);
  });

  test("component-instance: a $ref or $elements path is an instance edge too", () => {
    const graph = createDependencyGraph();
    put(graph, "page", "pages/a.json", { $elements: ["../components/x.json"] }, "page");
    expect(plain(graph.dependentsAt("components/x.json"))).toEqual({
      "component-instance": ["page"],
    });
  });

  test("a changed tag invalidates the old tag's users and the new tag's", () => {
    const graph = createDependencyGraph();
    put(graph, "card", "components/card.json", { tagName: "old-card" }, "component");
    put(graph, "a", "pages/a.json", { children: [{ tagName: "old-card" }] }, "page");
    put(graph, "b", "pages/b.json", { children: [{ tagName: "new-card" }] }, "page");
    const changed = put(
      graph,
      "card",
      "components/card.json",
      { tagName: "new-card" },
      "component",
    );
    expect(changed).toEqual([
      {
        complete: true,
        docIds: ["a", "b"],
        kind: "component-instance",
        tags: ["new-card", "old-card"],
      },
    ]);
  });

  test("layout-page: explicit $layout, and the default for pages that name none", () => {
    const graph = createDependencyGraph();
    graph.configure({ defaultLayout: "layouts/base.json" });
    put(graph, "base", "layouts/base.json", { tagName: "div" }, "layout");
    put(graph, "home", "pages/index.json", { tagName: "main" }, "page");
    put(graph, "bare", "pages/bare.json", { $layout: false, tagName: "main" }, "page");
    put(graph, "blog", "pages/blog/post.json", { $layout: "./layouts/post.json" }, "page");
    expect(plain(graph.dependentsOf("base"))).toEqual({ "layout-page": ["home"] });
    expect(plain(graph.dependentsAt("layouts/post.json"))).toEqual({ "layout-page": ["blog"] });
    // A changed default moves the implicit edges at once.
    graph.configure({ defaultLayout: "layouts/post.json" });
    expect(plain(graph.dependentsOf("base"))).toEqual({});
    expect(plain(graph.dependentsAt("layouts/post.json"))).toEqual({
      "layout-page": ["blog", "home"],
    });
    graph.configure({});
    expect(plain(graph.dependentsAt("layouts/post.json"))).toEqual({ "layout-page": ["blog"] });
  });

  test("layout-page: the default layout as authored, `./` or rooted, resolves from the root", () => {
    const graph = createDependencyGraph();
    put(graph, "home", "pages/index.json", { tagName: "main" }, "page");
    for (const authored of ["./layouts/base.json", "/layouts/base.json", "layouts/base.json"]) {
      graph.configure({ defaultLayout: authored });
      const edited = put(graph, "base", "layouts/base.json", { tagName: "div" }, "layout");
      expect(byKind(edited)).toEqual({ "layout-page": ["home"] });
    }
    graph.configure({ defaultLayout: "https://x.test/layout.json" });
    expect(byKind(put(graph, "base", "layouts/base.json", {}, "layout"))).toEqual({});
  });

  test("content-collection: an entry reaches the pages querying a type that includes it", () => {
    const graph = createDependencyGraph();
    graph.configure({ collections: { blog: ["content/blog/hello.md"], news: [] } });
    put(
      graph,
      "list",
      "pages/blog.json",
      {
        state: { posts: { $prototype: "ContentCollection", contentType: "blog" } },
      },
      "page",
    );
    put(
      graph,
      "other",
      "pages/news.json",
      {
        state: { posts: { $prototype: "ContentCollection", contentType: "news" } },
      },
      "page",
    );
    const hello = graph.update("hello", "content/blog/hello.md", NO_REFS);
    expect(byKind(hello)).toEqual({ "content-collection": ["list"] });
  });

  test("content-collection: a page listing a type through $paths or a nested state", () => {
    const graph = createDependencyGraph();
    graph.configure({ collections: { tags: ["content/tags/news.json"] } });
    put(
      graph,
      "archive",
      "pages/tags/[tag]/[...page].json",
      { $paths: { each: { contentType: "tags" } } },
      "page",
    );
    put(
      graph,
      "widget",
      "components/tag-cloud.json",
      {
        children: [{ state: { all: { $prototype: "ContentCollection", contentType: "tags" } } }],
        tagName: "tag-cloud",
      },
      "component",
    );
    expect(byKind(graph.update("news", "content/tags/news.json", NO_REFS))).toEqual({
      "content-collection": ["archive", "widget"],
    });
  });

  test("content-collection: an entry added after configure reaches the type's readers", () => {
    const graph = createDependencyGraph();
    graph.configure({ collections: { blog: ["content/blog/a.md"] } });
    put(
      graph,
      "index",
      "pages/blog.json",
      { state: { posts: { $prototype: "ContentCollection", contentType: "blog" } } },
      "page",
    );
    graph.update("a", "content/blog/a.md", NO_REFS);
    // The host re-resolves the collection for the fileAdded, then records the file.
    graph.setEntryTypes("content/blog/b.md", ["blog"]);
    expect(byKind(graph.update("b", "content/blog/b.md", NO_REFS))).toEqual({
      "content-collection": ["index"],
    });
    expect(plain(graph.dependentsOf("b"))).toEqual({ "content-collection": ["index"] });
  });

  test("content-collection: an entry that leaves a type invalidates its readers once", () => {
    const graph = createDependencyGraph();
    graph.configure({ collections: { blog: ["content/blog/a.md"], drafts: [] } });
    put(
      graph,
      "index",
      "pages/blog.json",
      { state: { posts: { $prototype: "ContentCollection", contentType: "blog" } } },
      "page",
    );
    put(
      graph,
      "review",
      "pages/drafts.json",
      { state: { posts: { $prototype: "ContentCollection", contentType: "drafts" } } },
      "page",
    );
    graph.update("a", "content/blog/a.md", NO_REFS);
    // A frontmatter edit moves the entry out of blog's `where` and into drafts.
    graph.setEntryTypes("content/blog/a.md", ["drafts"]);
    expect(graph.update("a", "content/blog/a.md", NO_REFS)).toEqual([
      { complete: true, docIds: ["index", "review"], kind: "content-collection", tags: [] },
    ]);
    // The departure was owed once, to that change.
    expect(byKind(graph.update("a", "content/blog/a.md", NO_REFS))).toEqual({
      "content-collection": ["review"],
    });
    // Rejoining blog forgives a departure not yet reported.
    graph.setEntryTypes("content/blog/a.md", ["blog"]);
    graph.setEntryTypes("content/blog/a.md", ["blog", "drafts"]);
    expect(byKind(graph.update("a", "content/blog/a.md", NO_REFS))).toEqual({
      "content-collection": ["index", "review"],
    });
    // A removed entry: the host drops it from every type, then removes it.
    graph.setEntryTypes("content/blog/a.md", []);
    expect(byKind(graph.remove("a"))).toEqual({ "content-collection": ["index", "review"] });
    // A configuration change owes nothing: it invalidates every document itself.
    graph.update("c", "content/blog/c.md", NO_REFS);
    graph.setEntryTypes("content/blog/c.md", ["blog"]);
    graph.setEntryTypes("content/blog/c.md", []);
    graph.configure({});
    expect(graph.update("c", "content/blog/c.md", NO_REFS)).toEqual([]);
  });

  test("content-collection: a collection's source names no edge of its own", () => {
    const graph = createDependencyGraph();
    put(graph, "cfg", "site/settings.json", { content: { blog: { source: "./posts/" } } }, "other");
    expect(plain(graph.dependentsAt("site/posts"))).toEqual({});
  });

  test("media-referrer: relative, root-relative and mounted references", () => {
    const graph = createDependencyGraph();
    graph.configure({ mounts: [{ dir: "content/blog", urlPrefix: "/content/blog" }] });
    put(graph, "rel", "pages/a.json", { children: [{ src: "../media/logo.png" }] }, "page");
    put(graph, "root", "pages/b.json", { style: { background: "url(/media/logo.png)" } }, "page");
    put(graph, "mounted", "pages/c.json", { children: [{ src: "/content/blog/x.png" }] }, "page");
    put(graph, "ext", "pages/d.json", { children: [{ src: "https://x.test/a.png" }] }, "page");
    put(graph, "self", "pages/e.json", { children: [{ href: "./e.json" }] }, "page");
    expect(plain(graph.dependentsAt("media/logo.png"))).toEqual({
      "media-referrer": ["rel", "root"],
    });
    expect(plain(graph.dependentsAt("content/blog/x.png"))).toEqual({
      "media-referrer": ["mounted"],
    });
    expect(plain(graph.dependentsAt("pages/e.json"))).toEqual({});
  });

  test("a reference to the root itself resolves to nothing", () => {
    const graph = createDependencyGraph();
    put(graph, "a", "a.json", { children: [{ href: "./" }] }, "page");
    expect(plain(graph.dependentsAt(""))).toEqual({});
  });

  test("data-consumer: $src", () => {
    const graph = createDependencyGraph();
    put(
      graph,
      "page",
      "pages/a.json",
      { state: { items: { $src: "../data/items.json" } } },
      "page",
    );
    expect(plain(graph.dependentsAt("data/items.json"))).toEqual({ "data-consumer": ["page"] });
  });

  test("data-consumer: a class the configuration imports reaches each document naming it", () => {
    const graph = createDependencyGraph();
    graph.configure({
      imports: {
        Bad: "https://x.test/a.class.json",
        PostCard: "./components/post-card.class.json",
      },
    });
    put(
      graph,
      "cfg",
      "project.json",
      { imports: { PostCard: "./components/post-card.class.json" } },
      "project-config",
    );
    put(graph, "cls", "components/post-card.class.json", { $prototype: "Class" }, "other");
    put(graph, "page", "pages/index.json", { state: { card: { $prototype: "PostCard" } } }, "page");
    put(
      graph,
      "own",
      "pages/own.json",
      { imports: { PostCard: "./mine.class.json" }, state: { card: { $prototype: "PostCard" } } },
      "page",
    );
    put(graph, "none", "pages/none.json", { tagName: "main" }, "page");
    expect(plain(graph.dependentsOf("cls"))).toEqual({ "data-consumer": ["page"] });
    expect(plain(graph.dependentsAt("pages/mine.class.json"))).toEqual({
      "data-consumer": ["own"],
    });
    graph.remove("page");
    expect(plain(graph.dependentsOf("cls"))).toEqual({});
  });

  test("project-config: the configuration and the manifest reach every document", () => {
    const graph = createDependencyGraph();
    put(
      graph,
      "cfg",
      "project.json",
      { defaults: { layout: "./layouts/base.json" } },
      "project-config",
    );
    put(graph, "a", "pages/a.json", { tagName: "main" }, "page");
    graph.update("logo", "media/logo.png", NO_REFS);
    expect(plain(graph.dependentsOf("cfg"))).toEqual({ "project-config": ["a", "logo"] });
    expect(plain(graph.dependentsAt("package.json"))).toEqual({
      "project-config": ["a", "cfg", "logo"],
    });
    // The configuration's own references are not edges: a layout it names does not reach it.
    expect(plain(graph.dependentsAt("layouts/base.json"))).toEqual({});
  });

  test("configPaths replaces the default set", () => {
    const graph = createDependencyGraph({ configPaths: ["jx.config.json"] });
    graph.update("a", "pages/a.json", NO_REFS);
    expect(plain(graph.dependentsAt("project.json"))).toEqual({});
    expect(plain(graph.dependentsAt("jx.config.json"))).toEqual({ "project-config": ["a"] });
  });
});

describe("transitive and deduplicated", () => {
  test("a dependent's dependents are reached, each once, under the first edge's kind", () => {
    const graph = createDependencyGraph();
    graph.configure({ defaultLayout: "layouts/base.json" });
    put(graph, "icon", "components/x-icon.json", { tagName: "x-icon" }, "component");
    put(
      graph,
      "card",
      "components/my-card.json",
      {
        children: [{ tagName: "x-icon" }, { tagName: "x-icon" }],
        tagName: "my-card",
      },
      "component",
    );
    put(graph, "base", "layouts/base.json", { children: [{ tagName: "my-card" }] }, "layout");
    put(
      graph,
      "a",
      "pages/a.json",
      {
        children: [{ tagName: "my-card" }, { tagName: "x-icon" }],
      },
      "page",
    );
    put(graph, "b", "pages/b.json", { $layout: false }, "page");
    expect(plain(graph.dependentsOf("icon"))).toEqual({
      "component-instance": ["a", "base", "card"],
    });
    expect(plain(graph.dependentsOf("missing"))).toEqual({});
  });

  test("a cycle terminates and never lists the cause", () => {
    const graph = createDependencyGraph();
    put(graph, "a", "a.json", { $ref: "./b.json" }, "other");
    put(graph, "b", "b.json", { $ref: "./a.json" }, "other");
    expect(plain(graph.dependentsOf("a"))).toEqual({ "component-instance": ["b"] });
  });

  test("an edge to a path that does not exist yet reaches its referrer when a file arrives", () => {
    const graph = createDependencyGraph();
    put(graph, "page", "pages/a.json", { children: [{ src: "../media/later.png" }] }, "page");
    const added = graph.update("later", "media/later.png", NO_REFS);
    expect(byKind(added)).toEqual({ "media-referrer": ["page"] });
  });
});

describe("relabel and remove", () => {
  test("a relabel invalidates both paths' referrers and re-resolves its own references", () => {
    const graph = createDependencyGraph();
    put(graph, "logo", "media/logo.png", {}, "media");
    put(graph, "a", "pages/a.json", { children: [{ src: "../media/logo.png" }] }, "page");
    put(graph, "b", "pages/b.json", { children: [{ src: "../media/brand.png" }] }, "page");
    put(graph, "c", "pages/c.json", { children: [{ src: "./d.png" }] }, "page");
    const renamed = graph.relabel("logo", "media/brand.png");
    expect(byKind(renamed)).toEqual({ "media-referrer": ["a", "b"] });
    // The relative reference in c now resolves from its new directory.
    graph.relabel("c", "other/c.json");
    expect(plain(graph.dependentsAt("pages/d.png"))).toEqual({});
    expect(plain(graph.dependentsAt("other/d.png"))).toEqual({ "media-referrer": ["c"] });
    expect(graph.relabel("missing", "x")).toEqual([]);
  });

  test("a removed reader leaves the tag and type indexes", () => {
    const graph = createDependencyGraph();
    graph.configure({ collections: { blog: ["content/a.md"] } });
    put(graph, "card", "components/my-card.json", { tagName: "my-card" }, "component");
    put(
      graph,
      "page",
      "pages/a.json",
      {
        children: [{ tagName: "my-card" }],
        state: { posts: { $prototype: "ContentCollection", contentType: "blog" } },
      },
      "page",
    );
    graph.update("entry", "content/a.md", NO_REFS);
    graph.remove("page");
    expect(plain(graph.dependentsOf("card"))).toEqual({});
    expect(plain(graph.dependentsOf("entry"))).toEqual({});
  });

  test("an update at a new path counts as a move of the old one", () => {
    const graph = createDependencyGraph();
    put(graph, "a", "pages/a.json", { children: [{ src: "../media/one.png" }] }, "page");
    graph.update("m", "media/one.png", NO_REFS);
    expect(byKind(graph.update("m", "media/two.png", NO_REFS))).toEqual({
      "media-referrer": ["a"],
    });
  });
});

describe("partial graphs (§8.2)", () => {
  test("an unindexed document makes every invalidation incomplete, except its own", () => {
    const graph = createDependencyGraph();
    graph.configure({ defaultLayout: "layouts/base.json" });
    put(graph, "a", "pages/a.json", { tagName: "main" }, "page");
    graph.update("md", "content/x.md", null);
    expect(graph.unindexed()).toEqual(["md"]);
    const layout = put(graph, "base", "layouts/base.json", {}, "layout");
    expect(layout).toEqual([{ complete: false, docIds: ["a"], kind: "layout-page", tags: [] }]);
    // The unindexed document's own change is complete: its dependents are known.
    put(graph, "b", "pages/b.json", { $ref: "../content/x.md" }, "page");
    expect(graph.update("md", "content/x.md", null)[0]?.complete).toBe(true);
    graph.update("md", "content/x.md", NO_REFS);
    expect(graph.unindexed()).toEqual([]);
    expect(graph.remove("md")[0]?.complete).toBe(true);
  });
});

describe("invalidationEvents", () => {
  test("one dependentsInvalidated per kind, with the cause and origin", () => {
    const events = invalidationEvents(
      "card",
      [
        { complete: true, docIds: ["a"], kind: "component-instance", tags: ["my-card"] },
        { complete: false, docIds: ["b"], kind: "media-referrer", tags: ["my-card"] },
      ],
      "external",
    );
    expect(events).toEqual([
      {
        cause: { docId: "card", kind: "component-instance" },
        complete: true,
        docIds: ["a"],
        origin: "external",
        tags: ["my-card"],
        type: "dependentsInvalidated",
      },
      {
        cause: { docId: "card", kind: "media-referrer" },
        complete: false,
        docIds: ["b"],
        origin: "external",
        tags: ["my-card"],
        type: "dependentsInvalidated",
      },
    ]);
  });
});
