/**
 * Add new's derivation and refusal, `src/create/add-new.ts` — pure, so every kind is a table.
 *
 * The generated documents are held to the real schemas: a page, a template, a component and a
 * collection's own page each validate as a Jx document, and a collection's `project.json` entry
 * validates as project configuration. "What the dialog says is what it writes" is only worth
 * something if what it writes is a document the build will take.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  collectionPageBody,
  creationProblem,
  CREATION_KINDS,
  defaultTemplateChoice,
  deriveCreation,
  directoriesToList,
  entryBody,
  itemNoun,
  KIND_INFO,
  layoutValueFor,
  presetSchema,
  START_ARTICLE,
  START_BLANK,
  START_COPY,
  START_SELECTION,
  urlSegments,
} from "../src/create/add-new";
import { validateDocOrNull, validateProjectConfig } from "../src/services/jx-validate";
import type { CreationContext, TakenLookup } from "../src/create/add-new";

const CTX: CreationContext = {
  article: { ext: ".md", name: "Markdown" },
  collections: [
    {
      dir: "content/posts",
      ext: ".md",
      formatName: "Markdown",
      name: "posts",
      schema: { properties: { title: { type: "string" } }, required: ["title"] },
    },
    { dir: "content/{locale}/news", ext: ".json", formatName: null, name: "news", schema: null },
  ],
  componentDocs: new Map([
    ["site-card", { children: [{ tagName: "slot" }], tagName: "site-card", $id: "x" }],
  ]),
  componentTags: ["site-card"],
  contentFormat: { ext: ".md", name: "Markdown" },
  declaredContent: ["posts", "news", "catalog"],
  defaultLayout: "./layouts/base.json",
  hasSelection: false,
  layouts: [
    { name: "Base", ref: "./layouts/base.json" },
    { name: "Post", ref: "./layouts/post.json" },
  ],
};

const NOTHING_TAKEN: TakenLookup = () => new Set();

describe("kinds", () => {
  test("six kinds, each with the board's copy", () => {
    expect([...CREATION_KINDS]).toEqual([
      "page",
      "collection",
      "template",
      "component",
      "media",
      "entry",
    ]);
    expect(KIND_INFO.page.cta).toBe("Create page");
    expect(KIND_INFO.media.cta).toBe("Upload");
  });
});

describe("pages", () => {
  test("a name derives a slugged page at its route, on the default template", () => {
    const page = deriveCreation("page", "Our Pricing", {}, CTX);
    expect(page.path).toBe("pages/our-pricing.json");
    expect(page.route).toBe("/our-pricing");
    expect(page.saved).toBe("Saved as pages/our-pricing.json · opens at /our-pricing");
    // The default template is the default, so the page says nothing and keeps following it.
    expect(page.content.doc.$layout).toBeUndefined();
    expect(page.content.doc).toMatchObject({ tagName: "main", title: "Our Pricing" });
  });

  test("another template is written; Blank opts out of the default", () => {
    expect(
      deriveCreation("page", "A", { startFrom: "./layouts/post.json" }, CTX).content.doc.$layout,
    ).toBe("./layouts/post.json");
    expect(deriveCreation("page", "A", { startFrom: START_BLANK }, CTX).content.doc.$layout).toBe(
      false,
    );
    expect(
      deriveCreation("page", "A", { startFrom: START_BLANK }, { ...CTX, defaultLayout: null })
        .content.doc.$layout,
    ).toBeUndefined();
  });

  test("an Article is Markdown, written by the format with a title in its frontmatter", () => {
    const article = deriveCreation("page", "Field Notes", { startFrom: START_ARTICLE }, CTX);
    expect(article.path).toBe("pages/field-notes.md");
    expect(article.content).toEqual({
      doc: { children: [{ tagName: "h1", textContent: "Field Notes" }], title: "Field Notes" },
      format: "Markdown",
      frontmatter: true,
    });
    // A project with no prose format has no Article: the choice falls back to a JSON page.
    expect(
      deriveCreation("page", "X", { startFrom: START_ARTICLE }, { ...CTX, article: null }).ext,
    ).toBe(".json");
  });

  test("an edited URL places the file, and / is the index", () => {
    const nested = deriveCreation("page", "Pricing", { url: "/Docs/Getting Started" }, CTX);
    expect(nested.path).toBe("pages/docs/getting-started.json");
    expect(nested.route).toBe("/docs/getting-started");
    expect(deriveCreation("page", "Home", { url: "/" }, CTX).path).toBe("pages/index.json");
    expect(urlSegments("//a//b c/")).toEqual(["a", "b-c"]);
  });

  test("a blank name derives nothing to save", () => {
    const blank = deriveCreation("page", "  ", {}, CTX);
    expect(blank.fileName).toBe("");
    expect(blank.saved).toBe("");
    expect(creationProblem(blank, "  ", {}, CTX, NOTHING_TAKEN)).toBe("Enter a name.");
    expect(creationProblem(blank, "!!", {}, CTX, NOTHING_TAKEN)).toBe(
      "Enter at least one letter or number.",
    );
  });

  test("a URL that steps out or has no leading slash is refused", () => {
    const options = { url: "/../x" };
    const page = deriveCreation("page", "X", options, CTX);
    expect(creationProblem(page, "X", options, CTX, NOTHING_TAKEN)).toBe(
      "A URL cannot step outside the site.",
    );
    const relative = { url: "pricing" };
    expect(
      creationProblem(
        deriveCreation("page", "X", relative, CTX),
        "X",
        relative,
        CTX,
        NOTHING_TAKEN,
      ),
    ).toBe("A URL starts with a slash, such as /pricing.");
  });

  test("a collision is New File's refusal, case-insensitively", () => {
    const page = deriveCreation("page", "About", {}, CTX);
    const taken: TakenLookup = (dir) => (dir === "pages" ? new Set(["about.json"]) : new Set());
    expect(creationProblem(page, "About", {}, CTX, taken)).toBe(
      "about.json already exists in pages/.",
    );
    // A directory not listed yet is not judged free or taken.
    expect(
      creationProblem(page, "About", {}, CTX, (dir) => new Map<string, Set<string>>().get(dir)),
    ).toBe("");
  });
});

describe("templates", () => {
  test("always JSON, one slot, wrapped in a layout or in nothing", () => {
    const plain = deriveCreation("template", "Landing", {}, CTX);
    expect(plain.path).toBe("layouts/landing.json");
    expect(plain.saved).toBe("Saved as layouts/landing.json with one slot.");
    expect(plain.content.doc).toEqual({
      children: [{ children: [{ tagName: "slot" }], tagName: "main" }],
      tagName: "div",
    });
    const wrapped = deriveCreation(
      "template",
      "Landing",
      { startFrom: "./layouts/base.json" },
      CTX,
    );
    expect(wrapped.content.doc.$layout).toBe("./layouts/base.json");
    expect(
      deriveCreation("template", "L", { startFrom: START_BLANK }, CTX).content.doc.$layout,
    ).toBeUndefined();
  });
});

describe("components", () => {
  test("the tag derives from the name, with site- when it has no hyphen", () => {
    const card = deriveCreation("component", "Pricing table", {}, CTX);
    expect(card.tag).toBe("pricing-table");
    expect(card.path).toBe("components/pricing-table.json");
    expect(card.saved).toBe("Saved as components/pricing-table.json with tag <pricing-table>.");
    expect(card.content.doc).toEqual({ children: [], tagName: "pricing-table" });
    expect(deriveCreation("component", "Hero", {}, CTX).tag).toBe("site-hero");
  });

  test("a copy carries the source's body under the new tag, without its $id", () => {
    const copy = deriveCreation(
      "component",
      "Card two",
      { copyOf: "site-card", startFrom: START_COPY },
      CTX,
    );
    expect(copy.content.doc).toEqual({ children: [{ tagName: "slot" }], tagName: "card-two" });
  });

  test("refuses a taken tag, a selection that is not there, and a copy of nothing", () => {
    const taken = deriveCreation("component", "site card", {}, CTX);
    expect(creationProblem(taken, "site card", {}, CTX, NOTHING_TAKEN)).toBe(
      "A component named <site-card> already exists.",
    );
    const selection = { startFrom: START_SELECTION };
    expect(
      creationProblem(
        deriveCreation("component", "Hero", selection, CTX),
        "Hero",
        selection,
        CTX,
        NOTHING_TAKEN,
      ),
    ).toBe("Select an element on the canvas to make a component from it.");
    const copy = { copyOf: "nope-x", startFrom: START_COPY };
    expect(
      creationProblem(
        deriveCreation("component", "Hero", copy, CTX),
        "Hero",
        copy,
        CTX,
        NOTHING_TAKEN,
      ),
    ).toBe("Choose the component to copy.");
    const reserved = deriveCreation("component", "font face", {}, CTX);
    expect(creationProblem(reserved, "font face", {}, CTX, NOTHING_TAKEN)).toBe(
      "<font-face> is reserved by HTML.",
    );
  });
});

describe("collections", () => {
  test("a project.json entry, a first entry and the starter-shaped own page", () => {
    const recipes = deriveCreation("collection", "Recipes", {}, CTX);
    expect(recipes.config).toEqual({
      entry: {
        format: "Markdown",
        schema: {
          properties: { cover: { format: "image", type: "string" }, title: { type: "string" } },
          required: ["title"],
          type: "object",
        },
        source: "./content/recipes",
      },
      name: "recipes",
    });
    expect(recipes.path).toBe("content/recipes/first-recipe.md");
    expect(recipes.content).toEqual({
      doc: { children: [], title: "First recipe" },
      format: "Markdown",
      frontmatter: true,
    });
    expect(recipes.route).toBe("/recipes/:slug");
    expect(recipes.extraWrites.map((write) => write.path)).toEqual(["pages/recipes/[slug].json"]);
    expect(recipes.saved).toBe(
      "Adds a “recipes” collection to project.json, a content/recipes/ folder with a first entry, " +
        "and pages/recipes/[slug].json at /recipes/:slug.",
    );
  });

  test("the own page is the blog starter's shape: $paths, a ContentEntry, the template, a bound body", () => {
    const page = collectionPageBody(
      "recipes",
      ["title", "image", "richText"],
      "./layouts/post.json",
      CTX,
    );
    expect(page.$paths).toEqual({ contentType: "recipes", field: "id", param: "slug" });
    expect(page.$layout).toBe("./layouts/post.json");
    expect(page.state).toEqual({
      entry: {
        $prototype: "ContentEntry",
        $src: "@jxsuite/parser/ContentEntry.class.json",
        contentType: "recipes",
        field: "id",
        id: { $ref: "#/$params/slug" },
      },
    });
    expect(page.children).toEqual([
      { tagName: "h1", textContent: "${state.entry.data.title}" },
      {
        attributes: {
          alt: "${state.entry.data.title}",
          loading: "lazy",
          src: "${state.entry.data.cover}",
        },
        tagName: "img",
      },
      { children: "${state.entry.$children}", tagName: "div" },
    ]);
    // No title field: the page is called by its item, and an image has no alt to bind.
    const bare = collectionPageBody("recipes", ["image"], undefined, { contentFormat: null });
    expect(bare.title).toBe("recipe");
    expect(bare.$layout).toBeUndefined();
    expect(bare.children).toEqual([
      {
        attributes: { alt: "", loading: "lazy", src: "${state.entry.data.cover}" },
        tagName: "img",
      },
    ]);
  });

  test("own page off writes no page; a JSON project writes JSON entries", () => {
    const off = deriveCreation("collection", "Team", { ownPage: false }, CTX);
    expect(off.extraWrites).toEqual([]);
    expect(off.route).toBeUndefined();
    const json = deriveCreation(
      "collection",
      "Team",
      { fields: ["title", "date"] },
      { ...CTX, contentFormat: null },
    );
    expect(json.path).toBe("content/team/first-team.json");
    expect(json.config?.entry.format).toBe("json");
    expect(json.content).toEqual({ doc: { title: "First team" }, format: null });
  });

  test("refuses a declared name and an existing folder", () => {
    const posts = deriveCreation("collection", "Posts", {}, CTX);
    expect(creationProblem(posts, "Posts", {}, CTX, NOTHING_TAKEN)).toBe(
      "A collection named “posts” already exists.",
    );
    const fresh = deriveCreation("collection", "Recipes", {}, CTX);
    const taken: TakenLookup = (dir) => (dir === "content" ? new Set(["recipes"]) : new Set());
    expect(creationProblem(fresh, "Recipes", {}, CTX, taken)).toBe(
      "content/recipes/ already exists.",
    );
    const pageTaken: TakenLookup = (dir) =>
      dir === "pages/recipes" ? new Set(["[slug].json"]) : new Set();
    expect(creationProblem(fresh, "Recipes", {}, CTX, pageTaken)).toBe(
      "[slug].json already exists in pages/recipes/.",
    );
    expect(directoriesToList(fresh)).toEqual(["content", "pages/recipes"]);
  });

  test("presets add up to a schema; Title is required only when chosen", () => {
    expect(presetSchema(["date", "tags", "number", "link"])).toEqual({
      properties: {
        date: { format: "date", type: "string" },
        link: { format: "uri", type: "string" },
        number: { type: "number" },
        tags: { items: { type: "string" }, type: "array" },
      },
      type: "object",
    });
  });
});

describe("entries", () => {
  test("a seeded entry in the collection's root, titled with the name", () => {
    const entry = deriveCreation("entry", "Hello World", { collection: "posts" }, CTX);
    expect(entry.path).toBe("content/posts/hello-world.md");
    expect(entry.saved).toBe("Saved as content/posts/hello-world.md in posts.");
    expect(entry.content).toEqual({
      doc: { children: [], title: "Hello World" },
      format: "Markdown",
      frontmatter: true,
    });
  });

  test("refuses no collection and a localized one", () => {
    const none = deriveCreation("entry", "X", {}, CTX);
    expect(none.fileName).toBe("");
    expect(creationProblem(none, "X", {}, CTX, NOTHING_TAKEN)).toBe(
      "Choose the collection this entry belongs to.",
    );
    const options = { collection: "news" };
    expect(
      creationProblem(deriveCreation("entry", "X", options, CTX), "X", options, CTX, NOTHING_TAKEN),
    ).toContain("is a localized collection");
  });

  test("entryBody seeds nothing it was not asked for, and JSON has no frontmatter", () => {
    expect(entryBody({ ext: ".json", formatName: null, schema: null }, "X")).toEqual({
      doc: {},
      format: null,
    });
    expect(entryBody({ ext: ".md", formatName: "Markdown", schema: null })).toEqual({
      doc: { children: [] },
      format: "Markdown",
      frontmatter: false,
    });
  });
});

describe("media", () => {
  test("names no file and says where uploads go; refuses until files are chosen", () => {
    const empty = deriveCreation("media", "", {}, CTX);
    expect(empty.path).toBe("public/media");
    expect(empty.saved).toBe("Saved under public/media/. No folder to choose.");
    expect(creationProblem(empty, "", {}, CTX, NOTHING_TAKEN)).toBe(
      "Drop files here, or browse for them.",
    );
    expect(deriveCreation("media", "", { files: 1 }, CTX).saved).toBe(
      "1 file will be saved under public/media/.",
    );
    const two = deriveCreation("media", "", { files: 2 }, CTX);
    expect(two.saved).toBe("2 files will be saved under public/media/.");
    expect(creationProblem(two, "", { files: 2 }, CTX, NOTHING_TAKEN)).toBe("");
    expect(directoriesToList(two)).toEqual([]);
  });
});

describe("small derivations", () => {
  test("item nouns and the default template", () => {
    expect([itemNoun("recipes"), itemNoun("stories"), itemNoun("news"), itemNoun("glass")]).toEqual(
      ["recipe", "story", "new", "glass"],
    );
    expect(defaultTemplateChoice(CTX)).toBe("./layouts/base.json");
    expect(defaultTemplateChoice({ ...CTX, defaultLayout: null })).toBe("./layouts/base.json");
    expect(defaultTemplateChoice({ ...CTX, defaultLayout: null, layouts: [] })).toBe(START_BLANK);
    expect(defaultTemplateChoice({ ...CTX, defaultLayout: "./layouts/gone.json" })).toBe(
      "./layouts/gone.json",
    );
    expect(layoutValueFor("layouts/base.json", CTX)).toBeUndefined();
    expect(layoutValueFor("", CTX)).toBe(false);
  });
});

describe("what is written validates", () => {
  test("pages, templates, components and a collection's page are Jx documents", async () => {
    const docs = [
      deriveCreation("page", "Pricing", { startFrom: "./layouts/post.json" }, CTX).content.doc,
      deriveCreation("page", "Pricing", { startFrom: START_BLANK }, CTX).content.doc,
      deriveCreation("template", "Landing", { startFrom: "./layouts/base.json" }, CTX).content.doc,
      deriveCreation("component", "Pricing table", {}, CTX).content.doc,
      deriveCreation("collection", "Recipes", {}, CTX).extraWrites[0]!.body.doc,
    ];
    for (const doc of docs) {
      expect(await validateDocOrNull(doc)).toEqual([]);
    }
  }, 30_000);

  test("a collection's entry is valid project configuration", async () => {
    const { config } = deriveCreation(
      "collection",
      "Recipes",
      { fields: ["title", "tags", "date"] },
      CTX,
    );
    expect(
      await validateProjectConfig({ content: { [config!.name]: config!.entry }, name: "Demo" }),
    ).toEqual([]);
  }, 30_000);
});
