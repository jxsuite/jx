import { describe, expect, test } from "bun:test";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ProjectSnapshot } from "@jxsuite/protocol/project-state";
import type { JxMutableNode } from "@jxsuite/schema/types";
import {
  CLIENT_REWRITE_READS,
  loadWithFormats,
  planClientRewrites,
  tagForPath,
} from "../src/files/client-rewrites";
import type { ClientRewriteDeps, FormatAccess, LoadedDocument } from "../src/files/client-rewrites";
import type { FormatActionOptions, StudioFormat } from "../src/format/format-host";
import { createContentStore } from "../src/project-state/store";

/*
 * The rewrites a rename carries for the documents its host cannot parse (`project-state.md` §8.2,
 * §9.1): Studio finds them by the store's `indexed: false`, parses them with its formats, and
 * rewrites them with the hosts' own walk.
 */

const H = await contentHash("x");

/** A store holding `files`, every one hashed; the unindexed ones are the planner's to rewrite. */
function storeOf(files: { path: string; indexed: boolean; isDir?: boolean }[]) {
  const store = createContentStore();
  const snapshot: ProjectSnapshot = {
    components: [],
    files: files.map((file, at) => ({
      docId: `d${at}`,
      indexed: file.indexed,
      isDir: file.isDir ?? false,
      kind: "other",
      path: file.path,
      ...(file.isDir !== true && { hash: H }),
    })),
    formats: "f",
    readiness: "ready",
  };
  store.applySnapshot(snapshot);
  return store;
}

/** A "format" that is JSON under any extension, so the walk sees a real tree. */
const jsonish: ClientRewriteDeps["load"] = async (path, text) =>
  path.endsWith(".bin")
    ? null
    : {
        doc: JSON.parse(text),
        serialize: path.endsWith(".csv") ? null : async (doc) => JSON.stringify(doc),
      };

function deps(
  store: ReturnType<typeof createContentStore>,
  files: Record<string, string>,
  load: ClientRewriteDeps["load"] = jsonish,
): ClientRewriteDeps & { reads: string[] } {
  const reads: string[] = [];
  return {
    load,
    mounts: () => [],
    read: async (path) => {
      reads.push(path);
      const text = files[path];
      if (text === undefined) {
        throw new Error(`No such file: ${path}`);
      }
      return text;
    },
    reads,
    store,
  };
}

describe("planClientRewrites", () => {
  test("nothing unindexed means no rewrites at all", async () => {
    const store = storeOf([{ indexed: true, path: "pages/a.json" }]);
    expect(await planClientRewrites("a.png", "b.png", deps(store, {}))).toBeNull();
  });

  test("rewrites the references of every unindexed document, relative to where it lives", async () => {
    const store = storeOf([
      { indexed: true, path: "media/logo.png" },
      { indexed: false, path: "content/post.md" },
      { indexed: false, path: "content/plain.md" },
      { indexed: false, path: "content", isDir: true },
      { indexed: false, path: "data/blob.bin" },
    ]);
    const post = JSON.stringify({ children: [{ src: "../media/logo.png", tagName: "img" }] });
    const plain = JSON.stringify({ tagName: "p", textContent: "../media/logo.png" });
    const planned = await planClientRewrites(
      "media/logo.png",
      "media/brand.png",
      deps(store, { "content/plain.md": plain, "content/post.md": post, "data/blob.bin": "{}" }),
    );
    expect(planned).toEqual({
      errors: [],
      rewrites: [
        {
          baseHash: await contentHash(post),
          changes: [{ from: "../media/logo.png", to: "../media/brand.png" }],
          contents: JSON.stringify({ children: [{ src: "../media/brand.png", tagName: "img" }] }),
          path: "content/post.md",
        },
      ],
    });
  });

  test("a document inside the moved folder is rewritten from its new place", async () => {
    const store = storeOf([
      { indexed: false, path: "content/post.md" },
      { indexed: true, path: "content", isDir: true },
    ]);
    const text = JSON.stringify({ src: "../media/logo.png", tagName: "img" });
    const planned = await planClientRewrites(
      "content",
      "archive/content",
      deps(store, { "content/post.md": text }),
    );
    expect(planned?.rewrites[0]?.changes).toEqual([
      { from: "../media/logo.png", to: "../../media/logo.png" },
    ]);
  });

  test("a renamed component renames its tag in every unindexed document that uses it", async () => {
    const store = storeOf([
      { indexed: true, path: "components/my-card.json" },
      { indexed: false, path: "content/post.md" },
    ]);
    const files = {
      "components/my-card.json": JSON.stringify({ tagName: "my-card" }),
      "content/post.md": JSON.stringify({ children: [{ tagName: "my-card" }] }),
    };
    const planned = await planClientRewrites(
      "components/my-card.json",
      "components/my-badge.json",
      deps(store, files),
    );
    expect(planned?.rewrites).toEqual([
      {
        baseHash: await contentHash(files["content/post.md"]),
        changes: [],
        contents: JSON.stringify({ children: [{ tagName: "my-badge" }] }),
        path: "content/post.md",
        tag: { from: "my-card", to: "my-badge" },
      },
    ]);
  });

  test("no tag rename for a folder, an unreadable file, or a name that is no custom element", async () => {
    const files = { "content/post.md": JSON.stringify({ children: [{ tagName: "my-card" }] }) };
    for (const [from, to, extra] of [
      ["components", "parts", { indexed: true, isDir: true, path: "components" }],
      [
        "components/gone.json",
        "components/my-x.json",
        { indexed: true, path: "components/gone.json" },
      ],
      [
        "components/my-card.json",
        "components/card.json",
        { indexed: true, path: "components/my-card.json" },
      ],
    ] as const) {
      const store = storeOf([extra, { indexed: false, path: "content/post.md" }]);
      const planned = await planClientRewrites(
        from,
        to,
        deps(store, {
          ...files,
          "components/my-card.json": JSON.stringify({ tagName: "my-card" }),
        }),
      );
      expect(planned).toEqual({ errors: [], rewrites: [] });
    }
  });

  test("a document it cannot write or read is named by its path after the move", async () => {
    const store = storeOf([
      { indexed: false, path: "data/list.csv" },
      { indexed: false, path: "data/missing.md" },
    ]);
    const planned = await planClientRewrites(
      "data",
      "tables",
      deps(store, { "data/list.csv": JSON.stringify({ src: "../media/a.png", tagName: "img" }) }),
    );
    expect(planned?.errors).toEqual([
      { error: "No such file: data/missing.md", path: "tables/missing.md" },
    ]);
    const media = await planClientRewrites(
      "media",
      "assets",
      deps(store, { "data/list.csv": JSON.stringify({ src: "../media/a.png", tagName: "img" }) }),
    );
    expect(media).toEqual({
      errors: [
        { error: "Its format cannot be written.", path: "data/list.csv" },
        { error: "No such file: data/missing.md", path: "data/missing.md" },
      ],
      rewrites: [],
    });
  });

  test("the store's own copy of a document is read before the platform", async () => {
    const store = storeOf([{ indexed: false, path: "content/post.md" }]);
    const text = JSON.stringify({ src: "../media/logo.png" });
    store.put("content/post.md", H, text);
    const used = deps(store, {});
    const planned = await planClientRewrites("media/logo.png", "media/b.png", used);
    expect(used.reads).toEqual([]);
    expect(planned?.rewrites[0]?.baseHash).toBe(await contentHash(text));
  });

  test("a document that does not parse is named with the parser's message", async () => {
    const store = storeOf([{ indexed: false, path: "content/post.md" }]);
    const planned = await planClientRewrites(
      "media/a.png",
      "b",
      deps(store, { "content/post.md": "![](../media/a.png)" }, async () => {
        throw new SyntaxError("unparseable");
      }),
    );
    expect(planned?.errors).toEqual([{ error: "unparseable", path: "content/post.md" }]);
  });

  test("documents are read a few at a time, and only one that names what moves is parsed", async () => {
    const paths = Array.from(
      { length: 20 },
      (_, at) => `content/post-${String(at).padStart(2, "0")}.md`,
    );
    const store = storeOf(paths.map((path) => ({ indexed: false, path })));
    const files = Object.fromEntries(
      paths.map((path, at) => [
        path,
        JSON.stringify(at === 3 ? { src: "../media/logo.png", tagName: "img" } : { tagName: "p" }),
      ]),
    );
    let reading = 0;
    let most = 0;
    const parsed: string[] = [];
    const used: ClientRewriteDeps = {
      ...deps(store, files, async (path, text) => {
        parsed.push(path);
        return jsonish(path, text);
      }),
      read: async (path) => {
        reading += 1;
        most = Math.max(most, reading);
        await new Promise((resume) => {
          setTimeout(resume, 1);
        });
        reading -= 1;
        return files[path] ?? "";
      },
    };
    const planned = await planClientRewrites("media/logo.png", "media/brand.png", used);
    expect(most).toBe(CLIENT_REWRITE_READS);
    expect(parsed).toEqual(["content/post-03.md"]);
    expect(planned?.rewrites.map((rewrite) => rewrite.path)).toEqual(["content/post-03.md"]);
  });

  test("tagForPath derives a tag as the hosts do", () => {
    expect(tagForPath("components/my-card.json")).toBe("my-card");
    expect(tagForPath("components/my-card.class.json")).toBe("my-card");
    expect(tagForPath("components/.hidden")).toBe(".hidden");
    expect(tagForPath("my-card")).toBe("my-card");
  });
});

describe("loadWithFormats", () => {
  const capability = { identifier: "x", timing: ["server"] };
  const format = (name: string, capabilities: StudioFormat["capabilities"]): StudioFormat => ({
    capabilities,
    documentKinds: ["content"],
    exportTarget: false,
    extensions: [],
    mediaType: null,
    name,
    remote: false,
    studio: null,
  });
  const FORMATS = new Map([
    [".csv", format("csv", { parse: capability })],
    [".md", format("markdown", { parse: capability, serialize: capability })],
    [".txt", format("text", {})],
  ]);

  function formats() {
    const serialized: [string, JxMutableNode, FormatActionOptions][] = [];
    const access: FormatAccess = {
      formatForPath: (path) => FORMATS.get(path.slice(path.lastIndexOf("."))),
      formatParse: async (name, source) => ({ tagName: name, textContent: source }),
      formatSerialize: async (name, doc, options) => {
        serialized.push([name, doc, options]);
        return "written";
      },
      loadFormats: async () => [],
    };
    return { access, serialized };
  }

  /** What `load` answered, failing the case when it answered nothing. */
  async function loaded(answer: Promise<LoadedDocument | null>): Promise<LoadedDocument> {
    const document = await answer;
    if (document === null) {
      throw new Error("expected a document");
    }
    return document;
  }

  test("JSON is itself, written back over the text it was read from", async () => {
    const load = loadWithFormats(formats().access);
    const text = '{ "src": "a.png", "tagName": "img" }\n';
    const document = await loaded(load("pages/a.json", text));
    expect(document.doc).toEqual({ src: "a.png", tagName: "img" });
    expect(await document.serialize?.({ src: "b.png", tagName: "img" })).toBe(
      '{ "src": "b.png", "tagName": "img" }\n',
    );
  });

  test("another document goes through its format, written back in round-trip mode", async () => {
    const { access, serialized } = formats();
    const load = loadWithFormats(access);
    const document = await loaded(load("content/a.md", "# Hi"));
    expect(document.doc).toEqual({ tagName: "markdown", textContent: "# Hi" });
    expect(await document.serialize?.({ tagName: "p" })).toBe("written");
    expect(serialized).toEqual([
      ["markdown", { tagName: "p" }, { mode: "roundtrip", source: "# Hi" }],
    ]);
    const readOnly = await loaded(load("data/a.csv", "a,b"));
    expect(readOnly.serialize).toBeNull();
    expect(await load("notes/a.txt", "x")).toBeNull();
    expect(await load("media/a.png", "x")).toBeNull();
  });
});
