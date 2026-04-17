import { describe, test, expect } from "bun:test";
import { handleStudioApi } from "../src/studio-api.js";
import { join, resolve } from "node:path";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";

const FIXTURES = resolve(import.meta.dir, "_studio_fixtures");
mkdirSync(FIXTURES, { recursive: true });

// Simple .class.json for direct path resolution
const simpleClass = {
  $prototype: "Class",
  title: "DataSource",
  description: "A test data source",
  $defs: {
    parameters: {
      url: {
        identifier: "url",
        type: { type: "string" },
        description: "API endpoint URL",
        examples: ["https://api.example.com"],
      },
      limit: {
        identifier: "limit",
        type: { type: "integer", default: 10 },
        description: "Max results",
      },
      debug: {
        identifier: "debug",
        type: { type: "boolean", default: false },
        description: "Enable debug mode",
      },
    },
    fields: {
      cache: {
        role: "field",
        access: "public",
        scope: "instance",
        identifier: "cache",
        type: { type: "object" },
        default: {},
        description: "Internal cache",
      },
      secret: {
        role: "field",
        access: "private",
        scope: "instance",
        identifier: "secret",
      },
    },
    constructor: {
      role: "constructor",
      $prototype: "Function",
      parameters: [{ $ref: "#/$defs/parameters/url" }],
    },
  },
};
writeFileSync(join(FIXTURES, "DataSource.class.json"), JSON.stringify(simpleClass), "utf8");

// Parent .class.json for extends testing
const parentClass = {
  $prototype: "Class",
  title: "BaseCollection",
  description: "Base collection class",
  $defs: {
    parameters: {
      src: {
        identifier: "src",
        type: { type: "string" },
        description: "Source path",
      },
      sortBy: {
        identifier: "sortBy",
        type: { type: "string" },
        description: "Sort field",
      },
    },
    constructor: {
      role: "constructor",
      $prototype: "Function",
      parameters: [{ $ref: "#/$defs/parameters/src" }],
    },
  },
};
writeFileSync(join(FIXTURES, "BaseCollection.class.json"), JSON.stringify(parentClass), "utf8");

// Child .class.json extending parent
const childClass = {
  $prototype: "Class",
  title: "PostCollection",
  description: "Posts collection",
  extends: { $ref: "./BaseCollection.class.json" },
  $defs: {
    parameters: {
      category: {
        identifier: "category",
        type: { type: "string" },
        description: "Filter by category",
      },
    },
  },
};
writeFileSync(join(FIXTURES, "PostCollection.class.json"), JSON.stringify(childClass), "utf8");

// Class with format: "json-schema" type parameter
const parameterizedClass = {
  $prototype: "Class",
  title: "TypedCollection",
  $defs: {
    parameters: {
      src: { identifier: "src", type: { type: "string" } },
      itemSchema: {
        identifier: "itemSchema",
        type: { type: "object" },
        format: "json-schema",
        description: "Schema for collection items",
      },
    },
    constructor: {
      role: "constructor",
      $prototype: "Function",
      parameters: [{ $ref: "#/$defs/parameters/src" }],
    },
  },
};
writeFileSync(
  join(FIXTURES, "TypedCollection.class.json"),
  JSON.stringify(parameterizedClass),
  "utf8",
);

// Sibling JS module with a companion .class.json
writeFileSync(join(FIXTURES, "parser.js"), "export class Parser {}", "utf8");
const siblingClassJson = {
  $prototype: "Class",
  title: "Parser",
  description: "Sibling auto-discovered schema",
  $defs: {
    parameters: {
      input: { identifier: "input", type: { type: "string" }, description: "Input text" },
    },
  },
};
writeFileSync(join(FIXTURES, "Parser.class.json"), JSON.stringify(siblingClassJson), "utf8");

// Helper: create a studio API request for plugin-schema
/**
 * @param {any} src
 * @param {any} [prototype]
 * @param {any} [base]
 */
function schemaRequest(src, prototype, base) {
  const params = new URLSearchParams({ src });
  if (prototype) params.set("prototype", prototype);
  if (base) params.set("base", base);
  const url = new URL(`http://localhost/__studio/plugin-schema?${params}`);
  return {
    req: new Request(url, { method: "GET" }),
    url,
  };
}

// ─── extractStudioSchema — direct .class.json path ──────────────────────────

describe("plugin-schema — direct .class.json path", () => {
  test("extracts parameters as properties", async () => {
    const { req, url } = schemaRequest(`./_studio_fixtures/DataSource.class.json`, "DataSource");
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(res).not.toBeNull();
    const { schema } = await /** @type {any} */ (res).json();
    expect(schema.properties.url).toEqual({
      type: "string",
      description: "API endpoint URL",
      examples: ["https://api.example.com"],
    });
    expect(schema.properties.limit).toEqual({
      type: "integer",
      default: 10,
      description: "Max results",
    });
    expect(schema.properties.debug).toEqual({
      type: "boolean",
      default: false,
      description: "Enable debug mode",
    });
  });

  test("includes public fields but excludes private fields", async () => {
    const { req, url } = schemaRequest(`./_studio_fixtures/DataSource.class.json`, "DataSource");
    const res = await handleStudioApi(req, url, import.meta.dir);
    const { schema } = await /** @type {any} */ (res).json();
    expect(schema.properties.cache).toBeDefined();
    expect(schema.properties.cache.description).toBe("Internal cache");
    expect(schema.properties.secret).toBeUndefined();
  });

  test("determines required from constructor parameters without defaults", async () => {
    const { req, url } = schemaRequest(`./_studio_fixtures/DataSource.class.json`, "DataSource");
    const res = await handleStudioApi(req, url, import.meta.dir);
    const { schema } = await /** @type {any} */ (res).json();
    expect(schema.required).toContain("url");
    expect(schema.required).not.toContain("limit"); // has default: 10
    expect(schema.required).not.toContain("debug"); // has default: false
  });
});

// ─── extractStudioSchema — extends inheritance ──────────────────────────────

describe("plugin-schema — extends inheritance", () => {
  test("child inherits parent parameters", async () => {
    const { req, url } = schemaRequest(
      `./_studio_fixtures/PostCollection.class.json`,
      "PostCollection",
    );
    const res = await handleStudioApi(req, url, import.meta.dir);
    const { schema } = await /** @type {any} */ (res).json();
    expect(schema.description).toBe("Posts collection");
    // Parent parameters
    expect(schema.properties.src).toBeDefined();
    expect(schema.properties.sortBy).toBeDefined();
    // Child parameter
    expect(schema.properties.category).toBeDefined();
  });

  test("child inherits parent required fields", async () => {
    const { req, url } = schemaRequest(
      `./_studio_fixtures/PostCollection.class.json`,
      "PostCollection",
    );
    const res = await handleStudioApi(req, url, import.meta.dir);
    const { schema } = await /** @type {any} */ (res).json();
    // src is required from parent (no default)
    expect(schema.required).toContain("src");
  });
});

// ─── extractStudioSchema — format: "json-schema" passthrough ────────────────

describe("plugin-schema — format: json-schema", () => {
  test("preserves format: json-schema annotation", async () => {
    const { req, url } = schemaRequest(
      `./_studio_fixtures/TypedCollection.class.json`,
      "TypedCollection",
    );
    const res = await handleStudioApi(req, url, import.meta.dir);
    const { schema } = await /** @type {any} */ (res).json();
    expect(schema.properties.itemSchema.format).toBe("json-schema");
    expect(schema.properties.itemSchema.description).toBe("Schema for collection items");
  });
});

// ─── plugin-schema — sibling .class.json auto-discovery ─────────────────────

describe("plugin-schema — sibling auto-discovery", () => {
  test("discovers .class.json next to .js module", async () => {
    const { req, url } = schemaRequest(`./_studio_fixtures/parser.js`, "Parser");
    const res = await handleStudioApi(req, url, import.meta.dir);
    const { schema } = await /** @type {any} */ (res).json();
    expect(schema).not.toBeNull();
    expect(schema.description).toBe("Sibling auto-discovered schema");
    expect(schema.properties.input).toBeDefined();
  });
});

// ─── plugin-schema — error handling ─────────────────────────────────────────

describe("plugin-schema — errors", () => {
  test("returns 400 when src param is missing", async () => {
    const url = new URL("http://localhost/__studio/plugin-schema");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(/** @type {any} */ (res).status).toBe(400);
  });

  test("returns null schema for nonexistent .class.json", async () => {
    const { req, url } = schemaRequest(`./_studio_fixtures/Nonexistent.class.json`, "Nonexistent");
    const res = await handleStudioApi(req, url, import.meta.dir);
    const data = await /** @type {any} */ (res).json();
    expect(data.schema).toBeNull();
  });
});

// ─── project-info endpoint ───────────────────────────────────────────────────

// Set up a fake site-project fixture
const SITE_PROJECT = join(FIXTURES, "my-site");
mkdirSync(join(SITE_PROJECT, "pages"), { recursive: true });
mkdirSync(join(SITE_PROJECT, "layouts"), { recursive: true });
mkdirSync(join(SITE_PROJECT, "components"), { recursive: true });
writeFileSync(
  join(SITE_PROJECT, "site.json"),
  JSON.stringify({ name: "Test Site", url: "https://test.dev" }),
  "utf8",
);

// Non-site project fixture (just a plain directory)
const PLAIN_DIR = join(FIXTURES, "plain-dir");
mkdirSync(PLAIN_DIR, { recursive: true });
writeFileSync(join(PLAIN_DIR, "readme.txt"), "hello", "utf8");

// Component fixture inside site project
writeFileSync(
  join(SITE_PROJECT, "components", "my-card.json"),
  JSON.stringify({ tagName: "my-card", state: { title: { type: "string", default: "" } } }),
  "utf8",
);

function projectInfoRequest(/** @type {any} */ dir) {
  const params = new URLSearchParams();
  if (dir) params.set("dir", dir);
  const url = new URL(`http://localhost/__studio/project-info?${params}`);
  return { req: new Request(url, { method: "GET" }), url };
}

describe("project-info", () => {
  test("detects a site project with site.json", async () => {
    const { req, url } = projectInfoRequest("_studio_fixtures/my-site");
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(res).not.toBeNull();
    const data = await /** @type {any} */ (res).json();
    expect(data.isSiteProject).toBe(true);
    expect(data.siteConfig.name).toBe("Test Site");
    expect(data.directories).toContain("pages");
    expect(data.directories).toContain("layouts");
    expect(data.directories).toContain("components");
  });

  test("returns isSiteProject false for plain directory", async () => {
    const { req, url } = projectInfoRequest("_studio_fixtures/plain-dir");
    const res = await handleStudioApi(req, url, import.meta.dir);
    const data = await /** @type {any} */ (res).json();
    expect(data.isSiteProject).toBe(false);
    expect(data.siteConfig).toBeNull();
  });

  test("rejects directory traversal", async () => {
    const { req, url } = projectInfoRequest("../../etc");
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(/** @type {any} */ (res).status).toBe(400);
  });

  test("defaults to current dir when no dir param", async () => {
    const url = new URL("http://localhost/__studio/project-info");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    const data = await /** @type {any} */ (res).json();
    expect(data.projectRoot).toBe(".");
  });
});

// ─── sites discovery endpoint ────────────────────────────────────────────────

describe("sites discovery", () => {
  test("discovers site projects with site.json", async () => {
    const url = new URL("http://localhost/__studio/sites");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(res).not.toBeNull();
    const sites = await /** @type {any} */ (res).json();
    const testSite = sites.find((/** @type {any} */ s) => s.config.name === "Test Site");
    expect(testSite).toBeDefined();
    expect(testSite.path).toBe("_studio_fixtures/my-site");
    expect(testSite.config.url).toBe("https://test.dev");
  });

  test("does not include directories without site.json", async () => {
    const url = new URL("http://localhost/__studio/sites");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    const sites = await /** @type {any} */ (res).json();
    expect(sites.every((/** @type {any} */ s) => s.path !== "_studio_fixtures/plain-dir")).toBe(
      true,
    );
  });
});

// ─── components?dir= scoped scan ─────────────────────────────────────────────

describe("components — scoped scan", () => {
  test("finds components under a specific directory", async () => {
    const url = new URL("http://localhost/__studio/components?dir=_studio_fixtures/my-site");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(res).not.toBeNull();
    const components = await /** @type {any} */ (res).json();
    expect(components.length).toBeGreaterThanOrEqual(1);
    expect(components.some((/** @type {any} */ c) => c.tagName === "my-card")).toBe(true);
  });

  test("returns empty for directory with no components", async () => {
    const url = new URL("http://localhost/__studio/components?dir=_studio_fixtures/plain-dir");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    const components = await /** @type {any} */ (res).json();
    expect(components).toEqual([]);
  });

  test("rejects directory traversal on dir param", async () => {
    const url = new URL("http://localhost/__studio/components?dir=../../etc");
    const req = new Request(url, { method: "GET" });
    const res = await handleStudioApi(req, url, import.meta.dir);
    expect(/** @type {any} */ (res).status).toBe(400);
  });
});

// Cleanup
process.on("exit", () => {
  try {
    rmSync(FIXTURES, { recursive: true });
  } catch {}
});
