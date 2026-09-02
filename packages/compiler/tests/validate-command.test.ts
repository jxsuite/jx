/**
 * Validate-command.test.ts — `jx validate` whole-project walk
 *
 * Builds a fixture project (parser extension enabled), generates its bundled entry documents, and
 * drives validateProjectTree end-to-end: valid tree, invalid document, invalid class file, issue
 * formatting, and the self-containment gate on the committed entry documents — every ref form that
 * resolves for some consumer but not all of them (relative path, absolute URI, `$anchor`, pointer
 * to nothing) is rejected, while `$ref`-shaped strings in instance-data keywords are left alone.
 * Also pins the strict `$paths` source union the generated document schema now carries.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { emitProjectSchema } from "@jxsuite/schema/project-schemas";
import { writeProjectSchemas } from "../src/site/schema-command";
import {
  formatProjectTreeIssues,
  formatProjectTreeLint,
  validateProjectTree,
} from "../src/site/validate-command";

const TMP = resolve(import.meta.dir, "__test-validate-command__");

function writeFile(relPath: string, content: string | object) {
  const abs = resolve(TMP, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(
    abs,
    typeof content === "string" ? content : JSON.stringify(content, null, 2),
    "utf8",
  );
}

beforeAll(async () => {
  rmSync(TMP, { force: true, recursive: true });
  writeFile("project.json", {
    extensions: ["@jxsuite/parser"],
    name: "Validate Command Fixture",
  });
  writeFile("components/good-card.json", {
    children: [{ tagName: "p", textContent: "hello" }],
    state: { label: "hi" },
    tagName: "good-card",
  });
  writeFile("pages/index.json", {
    children: [{ tagName: "h1", textContent: "Home" }],
    tagName: "main",
  });
  // Nested page directory: the document walk must recurse into subdirectories.
  writeFile("pages/blog/post.json", {
    children: [{ tagName: "h2", textContent: "Post" }],
    tagName: "article",
  });
  writeFile("classes/Good.class.json", {
    $prototype: "Class",
    title: "Good",
  });
  await writeProjectSchemas(TMP);
});

afterAll(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("validateProjectTree", () => {
  it("passes a fully valid project tree", async () => {
    const result = await validateProjectTree(TMP);
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
    // Project.json + 2 entry docs + 2 documents + 1 class + parser's project/document fragments.
    expect(result.checked).toBeGreaterThanOrEqual(7);
  });

  it("lints well-formed documents for overlay and accessibility defects, fatal only with strict", async () => {
    writeFile("pages/unnamed.json", {
      children: [{ tagName: "button" }, { attributes: { src: "/a.png" }, tagName: "img" }],
      tagName: "main",
    });
    try {
      const result = await validateProjectTree(TMP);
      // Advisory by default: the tree is well-formed, and the findings ride beside that verdict.
      expect(result.valid).toBe(true);
      expect(result.lint.map((finding) => [finding.file, finding.rule, finding.severity])).toEqual([
        ["pages/unnamed.json", "interactive-unnamed", "error"],
        ["pages/unnamed.json", "img-alt-missing", "error"],
      ]);
      expect(formatProjectTreeLint(result)[0]).toBe(
        "pages/unnamed.json: error: the <button> has no accessible name. [accessibility/interactive-unnamed, WCAG 4.1.2]",
      );
      const strict = await validateProjectTree(TMP, { strict: true });
      expect(strict.valid).toBe(false);
      expect(strict.issues).toEqual([]);
    } finally {
      rmSync(resolve(TMP, "pages/unnamed.json"), { force: true });
    }
  });

  it("a clean tree carries no lint, and a document with a schema error is not linted", async () => {
    const result = await validateProjectTree(TMP, { strict: true });
    expect(result.lint).toEqual([]);
    expect(result.valid).toBe(true);
    writeFile("components/broken.json", { children: [{ tagName: "button" }], tagName: 42 });
    try {
      const broken = await validateProjectTree(TMP);
      expect(broken.lint).toEqual([]);
      expect(broken.valid).toBe(false);
    } finally {
      rmSync(resolve(TMP, "components/broken.json"), { force: true });
    }
  });

  it("reports invalid documents and classes with file-scoped issues", async () => {
    writeFile("components/broken.json", { tagName: 42 });
    writeFile("classes/Bad.class.json", { $prototype: "Class" });
    try {
      const result = await validateProjectTree(TMP);
      expect(result.valid).toBe(false);
      const files = result.issues.map((issue) => issue.file);
      expect(files).toContain("components/broken.json");
      expect(files).toContain("classes/Bad.class.json");
      const lines = formatProjectTreeIssues(result);
      expect(lines.join("\n")).toContain("components/broken.json:");
      expect(lines.join("\n")).toContain("required property 'title'");
    } finally {
      rmSync(resolve(TMP, "components/broken.json"), { force: true });
      rmSync(resolve(TMP, "classes/Bad.class.json"), { force: true });
    }
  });

  it("reports an invalid project.json as a file-scoped issue", async () => {
    writeFile("project.json", {
      extensions: ["@jxsuite/parser"],
      name: 42,
    });
    try {
      const result = await validateProjectTree(TMP);
      expect(result.valid).toBe(false);
      const issue = result.issues.find((entry) => entry.file === "project.json");
      expect(issue).toBeDefined();
      expect(JSON.stringify(issue!.errors)).toContain("string");
    } finally {
      writeFile("project.json", {
        extensions: ["@jxsuite/parser"],
        name: "Validate Command Fixture",
      });
    }
  });

  it("reports extension schema fragments that fail to compile", async () => {
    writeFile("bad-ext/jx-extension.json", {
      name: "bad-ext",
      schemas: { project: "./bad.fragment.schema.json" },
    });
    // An unresolvable $ref makes Ajv's standalone compile throw for this fragment.
    writeFile("bad-ext/bad.fragment.schema.json", {
      $ref: "https://jx.invalid/missing.schema.json",
    });
    writeFile("project.json", {
      extensions: ["@jxsuite/parser", "./bad-ext"],
      name: "Validate Command Fixture",
    });
    try {
      const result = await validateProjectTree(TMP);
      expect(result.valid).toBe(false);
      const issue = result.issues.find((entry) => entry.file === "./bad-ext (project fragment)");
      expect(issue).toBeDefined();
      expect(JSON.stringify(issue!.errors)).toContain("missing.schema.json");
    } finally {
      rmSync(resolve(TMP, "bad-ext"), { force: true, recursive: true });
      writeFile("project.json", {
        extensions: ["@jxsuite/parser"],
        name: "Validate Command Fixture",
      });
    }
  });

  it("flags residual relative refs in a stale unbundled entry document", async () => {
    // Simulate a pre-bundling committed entry document (relative node_modules refs).
    const unbundled = emitProjectSchema({
      corePath: "./node_modules/@jxsuite/schema/schemas/project.core.schema.json",
      fragments: ["./node_modules/@jxsuite/parser/schemas/project.fragment.schema.json"],
    });
    writeFile("project.schema.json", unbundled);
    try {
      const result = await validateProjectTree(TMP);
      expect(result.valid).toBe(false);
      const issue = result.issues.find((entry) => entry.file === "project.schema.json");
      expect(issue).toBeDefined();
      expect(JSON.stringify(issue!.errors)).toContain("regenerate with `jx schema`");
    } finally {
      await writeProjectSchemas(TMP);
    }
  });

  /* Each of these ref forms resolves for someone but not for everyone, which is exactly the class of
     bug that let a dangling paths-union ref and unresolvable editor pointers sit in committed files
     unnoticed. The check runs before the ajv walks so it reports them instead of a MissingRefError. */
  const OFFENDING_REFS: [string, string][] = [
    ["#/$defs/NoSuchEmbed", "points at no node in this document"],
    ["#/$defs/project-core-v2/properties/name/type/deeper", "points at no node in this document"],
    ["#anchored", "is an $anchor reference"],
    ["https://jxsuite.com/schema/project/core/v2", "is an absolute URI"],
    ["./node_modules/@jxsuite/schema/schema.json", "is a relative path"],
  ];
  for (const [ref, reason] of OFFENDING_REFS) {
    it(`flags a committed $ref that ${reason} — "${ref}"`, async () => {
      const pristine = readFileSync(resolve(TMP, "project.schema.json"), "utf8");
      const schema = JSON.parse(pristine) as { allOf: unknown[] };
      schema.allOf.push({ $ref: ref });
      writeFile("project.schema.json", schema);
      try {
        const result = await validateProjectTree(TMP);
        expect(result.valid).toBe(false);
        const issue = result.issues.find((entry) => entry.file === "project.schema.json");
        expect(issue).toBeDefined();
        expect(JSON.stringify(issue!.errors)).toContain(reason);
      } finally {
        writeFileSync(resolve(TMP, "project.schema.json"), pristine, "utf8");
      }
    });
  }

  /* `$paths` used to be declared `type: "object"`, which accepted literally any object — a typo or
     a source shape whose extension is not enabled passed validation and then expanded to zero pages
     at build time with only a console warning. The generated entry document now unions the core
     source shapes with each enabled extension's. */
  const PATHS_CASES: [string, unknown, boolean][] = [
    ["parser contentType source", { contentType: "posts", field: "id", param: "slug" }, true],
    ["core explicit values", { param: "lang", values: ["en", "fr"] }, true],
    ["core data-file $ref", { $ref: "./data/products.json", field: "sku", param: "id" }, true],
    ["legacy parameter array", [{ slug: "hello" }], true],
    ["misspelled discriminator", { contentTyp: "posts", param: "slug" }, false],
    ["empty object", {}, false],
    ["stray key beside values", { bogus: 1, values: ["a"] }, false],
    ["source for a disabled extension", { param: "id", table: "products" }, false],
    ["not an object at all", "posts", false],
  ];
  for (const [label, $paths, expected] of PATHS_CASES) {
    it(`${expected ? "accepts" : "rejects"} a $paths ${label}`, async () => {
      writeFile("pages/[slug].json", { $paths, children: [], tagName: "article" });
      try {
        const result = await validateProjectTree(TMP);
        const issue = result.issues.find((entry) => entry.file === "pages/[slug].json");
        expect(issue === undefined).toBe(expected);
      } finally {
        rmSync(resolve(TMP, "pages/[slug].json"), { force: true });
      }
    });
  }

  it("ignores $ref-shaped strings inside instance-data keywords", async () => {
    // Jx document examples legitimately contain refs like "#/state/cart" — not schema refs.
    const pristine = readFileSync(resolve(TMP, "project.schema.json"), "utf8");
    const schema = JSON.parse(pristine) as { $defs: Record<string, unknown> };
    schema.$defs.Probe = {
      default: { $ref: "#/state/fallback" },
      enum: [{ $ref: "#/state/one" }],
      examples: [{ $ref: "#/state/cart" }],
    };
    writeFile("project.schema.json", schema);
    try {
      const result = await validateProjectTree(TMP);
      expect(result.issues.find((entry) => entry.file === "project.schema.json")).toBeUndefined();
    } finally {
      writeFileSync(resolve(TMP, "project.schema.json"), pristine, "utf8");
    }
  });

  it("judges a custom element as what its own definition renders", async () => {
    /* A component IS a popover when its definition declares one, and it FORWARDS invocation when
       it observes the four invoker attributes. Neither fact is visible in the page that uses it,
       so without the project's definitions in scope the CLI reported `command-target-mismatch` and
       `invoker-not-button` on correct markup — and Studio, which passes the same scope, called the
       same page clean. A CLI that disagrees with the editor about a page is worse than either. */
    writeFile("components/x-panel.class.json", {
      $id: "XPanel",
      attributes: { popover: "auto" },
      children: [],
      style: { ":popover-open": { display: "flex" }, flexDirection: "column" },
      tagName: "x-panel",
    });
    writeFile("components/x-trigger.class.json", {
      $id: "XTrigger",
      children: [{ attributes: { part: "control" }, tagName: "button" }],
      observedAttributes: ["popovertarget", "popovertargetaction", "command", "commandfor"],
      tagName: "x-trigger",
    });
    writeFile("pages/overlay-page.json", {
      children: [
        { attributes: { commandfor: "p1", command: "toggle-popover" }, tagName: "x-trigger" },
        { attributes: { popovertarget: "p1" }, tagName: "x-trigger" },
        { attributes: { id: "p1" }, tagName: "x-panel" },
      ],
      tagName: "div",
    });
    try {
      const result = await validateProjectTree(TMP);
      const onPage = result.lint.filter((f) => f.file === "pages/overlay-page.json");
      expect(onPage.map((f) => f.rule)).toEqual([]);
    } finally {
      rmSync(resolve(TMP, "pages/overlay-page.json"), { force: true });
      rmSync(resolve(TMP, "components/x-panel.class.json"), { force: true });
      rmSync(resolve(TMP, "components/x-trigger.class.json"), { force: true });
    }
  });

  it("still refuses an invoker attribute on a tag that forwards nothing", async () => {
    writeFile("components/x-plain.class.json", {
      $id: "XPlain",
      children: [{ attributes: { part: "box" }, tagName: "div" }],
      tagName: "x-plain",
    });
    writeFile("pages/bad-invoker.json", {
      children: [
        { attributes: { popovertarget: "p2" }, tagName: "x-plain" },
        { attributes: { popover: "auto" }, id: "p2", tagName: "div" },
      ],
      tagName: "div",
    });
    try {
      const result = await validateProjectTree(TMP);
      const onPage = result.lint.filter((f) => f.file === "pages/bad-invoker.json");
      expect(onPage.map((f) => f.rule)).toContain("invoker-not-button");
    } finally {
      rmSync(resolve(TMP, "pages/bad-invoker.json"), { force: true });
      rmSync(resolve(TMP, "components/x-plain.class.json"), { force: true });
    }
  });
});
