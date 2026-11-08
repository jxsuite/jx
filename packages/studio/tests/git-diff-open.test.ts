/**
 * Which changed files have a comparison, and which half of one.
 *
 * A file the canvas can draw gets the Visual half beside the Code one; a source or configuration
 * file gets the Code half; and a rename, a binary file or a path outside the project is refused in
 * words, which Review changes' centre shows instead (studio.md §21.3, §22.8).
 */

import "./harness";
import { describe, expect, test } from "bun:test";

const { canRenderComparison, comparisonRefusal } = await import("../src/panels/git-diff-open");

describe("canRenderComparison", () => {
  test("a .json document and a format-backed one have a visual half", () => {
    expect(canRenderComparison("pages/index.json")).toBe(true);
  });

  test("source and config files do not, which decides the VIEW and not whether the row opens", () => {
    expect(canRenderComparison("src/app.ts")).toBe(false);
    expect(canRenderComparison("styles/site.css")).toBe(false);
    expect(canRenderComparison(".gitignore")).toBe(false);
  });
});

describe("comparisonRefusal", () => {
  test("refuses a rename, because only the new path is in hand", () => {
    expect(comparisonRefusal("pages/new.json", "R")).toContain("renamed");
  });

  test("refuses a binary file, because a comparison of one is not text", () => {
    expect(comparisonRefusal("public/hero.png", "M")).toContain("not text");
  });

  test("allows every ordinary changed file", () => {
    expect(comparisonRefusal("src/app.ts", "M")).toBeNull();
    expect(comparisonRefusal("pages/index.json", "D")).toBeNull();
    expect(comparisonRefusal("notes.md", "U")).toBeNull();
  });
});

describe("what has a visual half", () => {
  test("a page or component does", () => {
    expect(canRenderComparison("pages/index.json")).toBe(true);
    expect(canRenderComparison("components/card.json")).toBe(true);
  });

  test("a .json that CONFIGURES the project does not", () => {
    /* Found in a browser: `package.json` took the visual half on the strength of its extension,
       drew whatever the runtime makes of an object with no `tagName`, and reported a dependency
       bump as "document settings changed" — every one of its keys being the root's. */
    expect(canRenderComparison("package.json")).toBe(false);
    expect(canRenderComparison("tsconfig.json")).toBe(false);
    expect(canRenderComparison("sites/x/package.json")).toBe(false);
  });

  test("a generated schema document does not either", () => {
    expect(canRenderComparison("project.schema.json")).toBe(false);
    expect(canRenderComparison("document.schema.json")).toBe(false);
  });
});

describe("files outside the project", () => {
  test("are refused by name rather than as a failed read", () => {
    /* `git status` runs in the project root, so a project nested in a larger repository lists real
       changes above itself. The server refuses a `..` in a git path outright — a traversal guard
       worth keeping — so the click has to explain rather than fail. */
    expect(comparisonRefusal("../bun.lock", "M")).toContain("outside this project");
    expect(comparisonRefusal("../packages/studio/src/x.ts", "M")).toContain("outside this project");
  });

  test("a path merely containing dots is fine", () => {
    expect(comparisonRefusal("pages/my..page.json", "M")).toBeNull();
    expect(comparisonRefusal("a/b/c.json", "M")).toBeNull();
  });
});
