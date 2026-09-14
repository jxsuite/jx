/**
 * The frontmatter shape of a generated page.
 *
 * Two halves, following nav.test.ts. The RULE tests drive the two frontmatter writers — the shared
 * helper and the one studio-commands.ts keeps for its association fields — and assert the fields a
 * generated page must carry: `generated: true`, which check-doc-refs.ts pairs with the banner, and
 * `search: false` on the pages that asked for it, which keeps them out of the site's search index
 * (issue #305). The GOLDEN test renders the whole page set in memory (`pages.ts`) and pins WHICH
 * pages opt out: the three derived from the specs, and no hand-written page ever. A generator that
 * rolled its own frontmatter and dropped the opt-out would put its page back into the perf budget;
 * one that took it for a catalogue would take a formula name or a shortcut out of search. The
 * derived pages are gitignored build outputs, so the tracked tree is the hand-written set.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PAGES } from "./pages.ts";
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

describe("the page set", () => {
  /** Every derived page, rendered in memory: the set does not depend on what a checkout carries. */
  const rendered = Object.entries(PAGES).map(([path, generate]) => [path, generate()] as const);

  test("every derived page carries the generated flag and the banner", () => {
    for (const [path, source] of rendered) {
      const fm = parseFrontmatter(source);
      expect([path, fm?.generated]).toEqual([path, true]);
      expect(source, path).toContain(BANNER);
    }
  });

  test("the spec-derived pages opt out of search, and no other derived page does", () => {
    // A generated CATALOGUE stays searchable, because a formula name or a shortcut should land on
    // The page that lists it. Only the projections of the specs leave the index (issue #305).
    const optedOut = rendered
      .filter(([, source]) => parseFrontmatter(source)?.search === false)
      .map(([path]) => path.replace(/^docs\//, ""))
      .toSorted();
    expect(optedOut).toEqual(SPEC_DERIVED);
    for (const [path, source] of rendered) {
      // The key is a boolean or nothing: a string "false" is indexed, and reported by the emitter,
      // Which is a warning nobody reads in a site build that succeeds.
      const search = parseFrontmatter(source)?.search;
      expect([path, search === true || search === false || search === undefined]).toEqual([
        path,
        true,
      ]);
    }
  });

  test("every derived page is gitignored and none is tracked: the list in .gitignore is PAGES", () => {
    // `.gitignore` names the nine paths by hand, and nothing else binds that list to the
    // Generator's; a tenth page added to PAGES without its ignore line would be committed by the
    // Next `git add -A`, and the merge conflicts these pages left git to escape would be back.
    const root = resolve(import.meta.dir, "../../..");
    const paths = Object.keys(PAGES);
    const ignored = Bun.spawnSync(["git", "check-ignore", ...paths], { cwd: root })
      .stdout.toString()
      .split("\n")
      .filter(Boolean)
      .toSorted();
    expect(ignored).toEqual(paths.toSorted());
    const tracked = Bun.spawnSync(["git", "ls-files", ...paths], { cwd: root })
      .stdout.toString()
      .split("\n")
      .filter(Boolean);
    expect(tracked).toEqual([]);
  });

  test("no hand-written page is generated or opts out of search", () => {
    // The tracked pages are the hand-written ones: the derived pages are gitignored build outputs
    // (`.gitignore`), so a `generated: true` or a `search: false` under version control is a page
    // That was hand-edited into the shape only a generator may write.
    const tracked = Bun.spawnSync(["git", "ls-files", "docs/*.md", "docs/**/*.md"], {
      cwd: resolve(import.meta.dir, "../../.."),
    })
      .stdout.toString()
      .split("\n")
      .filter(Boolean);
    expect(tracked.length).toBeGreaterThan(100);
    for (const rel of tracked) {
      const fm = parseFrontmatter(readFileSync(join(DOCS_DIR, "..", rel), "utf8"));
      if (fm === null) {
        // Docs/README.md is the folder's own readme, not a page; check-doc-refs.ts skips it too.
        continue;
      }
      expect([rel, fm.generated]).toEqual([rel, undefined]);
      expect([rel, fm.search]).toEqual([rel, undefined]);
    }
  });
});
