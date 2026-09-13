/**
 * The frontmatter shape of a generated page.
 *
 * Two halves, following nav.test.ts. The RULE tests drive the two frontmatter writers — the shared
 * helper and the one studio-commands.ts keeps for its association fields — and assert the fields a
 * generated page must carry: `generated: true`, which check-doc-refs.ts pairs with the banner, and
 * `search: false` on the pages that asked for it, which keeps them out of the site's search index
 * (issue #305). The GOLDEN test walks the committed docs tree and pins WHICH pages opt out: the
 * three derived from the specs, and no hand-written page ever. A generator that rolled its own
 * frontmatter and dropped the opt-out would put its page back into the perf budget; one that took
 * it for a catalogue would take a formula name or a shortcut out of search.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BANNER, GENERATED_FIELD, SEARCH_OPT_OUT, frontmatter } from "./shared.ts";
import { generateShortcuts } from "./studio-commands.ts";

const DOCS_DIR = resolve(import.meta.dir, "../../../docs");

/** The YAML block between the first two `---` lines, parsed; null when the file has none. */
function parseFrontmatter(source: string): Record<string, unknown> | null {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  return match ? (Bun.YAML.parse(match[1]!) as Record<string, unknown>) : null;
}

/** The generated pages that leave the index: projections of the specs, never searched by name. */
const SPEC_DERIVED = [
  "extending/reference/implementation-status.md",
  "extending/reference/spec-changelog.md",
  "extending/reference/standards.md",
];

describe("frontmatter()", () => {
  test("carries the generated flag, and is indexed unless the page opts out", () => {
    const fm = parseFrontmatter(`${frontmatter({ description: "d", title: "t" })}\n`);
    expect(fm).toEqual({ description: "d", generated: true, title: "t" });
    const out = parseFrontmatter(
      `${frontmatter({ description: "d", title: "t" }, { search: false })}\n`,
    );
    expect(out).toEqual({ description: "d", generated: true, search: false, title: "t" });
  });

  test("the two writers spell the same fields, so they cannot drift", () => {
    expect(GENERATED_FIELD).toBe("generated: true");
    expect(SEARCH_OPT_OUT).toBe("search: false");
    // Studio-commands keeps its own writer for the spec/code association lists; it must end the
    // Block with the generated flag, stay indexed (a shortcut is searched by its keys), and parse —
    // A stray indent would take the page out of every gate that reads its frontmatter.
    const fm = parseFrontmatter(generateShortcuts())!;
    expect(fm.generated).toBe(true);
    expect(fm.search).toBeUndefined();
    expect(fm.spec).toEqual(["studio.md#10"]);
  });
});

describe("the committed docs tree", () => {
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.endsWith(".md")) {
        pages.push(path);
      }
    }
  };
  walk(DOCS_DIR);

  test("the spec-derived pages opt out of search, and no other page does", () => {
    const optedOut: string[] = [];
    const generated: string[] = [];
    for (const page of pages) {
      const source = readFileSync(page, "utf8");
      const fm = parseFrontmatter(source);
      const rel = relative(DOCS_DIR, page);
      if (fm === null) {
        // Docs/README.md is the folder's own readme, not a page; check-doc-refs.ts skips it too.
        continue;
      }
      if (fm.generated === true) {
        generated.push(rel);
        expect(source, rel).toContain(BANNER);
      }
      if (fm.search === false) {
        optedOut.push(rel);
      }
      // The key is a boolean or nothing: a string "false" is indexed, and reported by the emitter,
      // Which is a warning nobody reads in a site build that succeeds.
      expect([true, false, undefined], rel).toContain(fm.search);
    }
    // A hand-written page is real documentation and stays searchable, and so does a generated
    // Catalogue, because a formula name or a shortcut should land on the page that lists it. Only
    // The projections of the specs leave the index (issue #305).
    expect(optedOut.toSorted()).toEqual(SPEC_DERIVED);
    for (const page of SPEC_DERIVED) {
      expect(generated, page).toContain(page);
    }
    expect(generated.length).toBeGreaterThan(SPEC_DERIVED.length);
  });
});
