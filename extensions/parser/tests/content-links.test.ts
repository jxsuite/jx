/**
 * Content-links tests: relative links between entries become routes (src/content-links.ts).
 *
 * These drive `rewriteLinks` directly over hand-built trees and a hand-built {@link LinkIndex}, so
 * each branch of the resolver is pinned without a vault on disk. The same behavior over a real
 * collection is in vault-content.test.ts.
 */

import { describe, expect, it } from "bun:test";
import type { JxElement } from "@jxsuite/schema/types";
import { rewriteLinks } from "../src/content-links.ts";
import type { FileOutcome, LinkIndex, LinkProblem } from "../src/content-links.ts";

function makeIndex(files: Record<string, FileOutcome>, extra: Partial<LinkIndex> = {}): LinkIndex {
  return {
    entryExtensions: new Set([".md"]),
    excludedBy: (path) => (path.startsWith("internal/") ? "internal/**" : undefined),
    exists: (path) => path.startsWith("internal/") && path.endsWith(".md"),
    files: new Map(Object.entries(files)),
    indexes: new Map(),
    localePrefix: "",
    trailingSlash: "always",
    ...extra,
  };
}

const INDEX = makeIndex(
  {
    "Frappe/Bench Operations.md": { route: "/kb/frappe/bench-operations" },
    "Frappe/README.md": { route: "/kb/frappe" },
    "Linux/Swap Configuration.md": { route: "/kb/linux/swap-configuration" },
    "Linux/Draft.md": { unpublished: "left out by where.status" },
    "Root.md": { route: "/kb" },
  },
  {
    indexes: new Map([
      ["Frappe", "Frappe/README.md"],
      ["", "Root.md"],
    ]),
  },
);

/** Rewrite one `a` element's href as if authored in `from`; report what happened. */
function run(href: string, from = "Frappe/Bench Operations.md", index: LinkIndex = INDEX) {
  const link: JxElement = { attributes: { href }, tagName: "a", textContent: "text" };
  const nodes: (JxElement | string)[] = [link];
  const problems: LinkProblem[] = [];
  rewriteLinks(nodes, from, index, (p) => problems.push(p));
  const kept = nodes.length === 1 && typeof nodes[0] === "object" && nodes[0].tagName === "a";
  return {
    href: kept ? (nodes[0] as JxElement).attributes?.href : undefined,
    nodes,
    problems,
    unlinked: !kept,
  };
}

describe("links that are rewritten", () => {
  it("resolves a sibling and a ../ link, decoding percent-escapes", () => {
    expect(run("../Linux/Swap%20Configuration.md").href).toBe("/kb/linux/swap-configuration/");
    expect(run("Frappe/../Linux/Swap Configuration.md", "Top.md").href).toBe(
      "/kb/linux/swap-configuration/",
    );
    expect(run("./README.md").href).toBe("/kb/frappe/");
  });

  it("keeps ?query and rewrites #fragment to a heading id", () => {
    expect(run("../Linux/Swap%20Configuration.md?tab=2#Create%20a%20Swap%20File").href).toBe(
      "/kb/linux/swap-configuration/?tab=2#create-a-swap-file",
    );
    expect(run("../Linux/Swap%20Configuration.md#already-a-slug").href).toBe(
      "/kb/linux/swap-configuration/#already-a-slug",
    );
    expect(run("../Linux/Swap%20Configuration.md#").href).toBe("/kb/linux/swap-configuration/#");
  });

  it("a malformed escape in a fragment is kept as written", () => {
    expect(run("../Linux/Swap%20Configuration.md#%E0%A4%A").href).toBe(
      "/kb/linux/swap-configuration/#%E0%A4%A",
    );
  });

  it("applies the trailing-slash setting and a locale prefix", () => {
    const never = makeIndex({ "A.md": { route: "/kb/a" } }, { trailingSlash: "never" });
    expect(run("A.md", "B.md", never).href).toBe("/kb/a");
    const fr = makeIndex({ "A.md": { route: "/kb/a" } }, { localePrefix: "/fr" });
    expect(run("A.md", "B.md", fr).href).toBe("/fr/kb/a/");
  });

  it("falls back to a unique case-insensitive match, never an ambiguous one", () => {
    expect(run("../linux/swap%20configuration.MD").href).toBe("/kb/linux/swap-configuration/");
    const clash = makeIndex({
      "A.md": { route: "/a-upper" },
      "a.md": { route: "/a-lower" },
    });
    expect(run("a.md", "B.md", clash).href).toBe("/a-lower/");
    expect(run("A.md", "B.md", clash).href).toBe("/a-upper/");
    // "a.MD" matches both case-insensitively: ambiguous, so it is a missing file.
    expect(run("a.MD", "B.md", clash).problems[0]!.reason).toBe("does not exist");
  });

  it("resolves a directory link to that directory's index, with or without a slash", () => {
    expect(run("../Frappe/").href).toBe("/kb/frappe/");
    expect(run("../Frappe").href).toBe("/kb/frappe/");
    expect(run("../").href).toBe("/kb/");
    expect(run("./", "Frappe/Bench Operations.md").href).toBe("/kb/frappe/");
  });

  it("resolves a link with its extension left off", () => {
    expect(run("../Linux/Swap%20Configuration").href).toBe("/kb/linux/swap-configuration/");
  });

  it("normalises a same-page anchor that is an authored heading", () => {
    expect(run("#Restore%20Steps").href).toBe("#restore-steps");
    expect(run("#Restore Steps").href).toBe("#restore-steps");
    expect(run("#restore-steps").href).toBe("#restore-steps");
    expect(run("#").href).toBe("#");
  });

  it("rewrites links inside nested elements and keeps the rest of the tree", () => {
    const tree: (JxElement | string)[] = [
      {
        children: [
          "see ",
          {
            attributes: { href: "../Linux/Swap%20Configuration.md" },
            tagName: "a",
            textContent: "swap",
          },
        ],
        tagName: "p",
      },
      "loose text",
      null as never,
      { tagName: "hr" },
    ];
    rewriteLinks(tree, "Frappe/X.md", INDEX, () => {});
    const link = ((tree[0] as JxElement).children as JxElement[])[1]!;
    expect(link.attributes?.href).toBe("/kb/linux/swap-configuration/");
  });
});

describe("links that are left exactly as written", () => {
  it("external schemes, absolute paths, protocol-relative and templates", () => {
    for (const href of [
      "https://example.com/a.md",
      "http://example.com/",
      "mailto:a@example.com",
      "tel:+15555550100",
      "data:text/plain,hi",
      "/already/absolute/",
      "//cdn.example.com/x.md",
      "",
      "${state.url}",
    ]) {
      const out = run(href);
      expect(out.href).toBe(href);
      expect(out.problems).toEqual([]);
    }
  });

  it("assets and anything that is not an entry, when the collection publishes none", () => {
    for (const href of [
      "img/diagram.png",
      "../files/guide.pdf",
      "notes.txt",
      "../Linux",
      "Nothing",
    ]) {
      const out = run(href);
      expect(out.href).toBe(href);
      expect(out.problems).toEqual([]);
    }
  });

  it("a malformed escape or an escaped separator is not a path this understands", () => {
    for (const href of ["%E0%A4%A.md", "a%2Fb.md", "a%5Cb.md"]) {
      const out = run(href);
      expect(out.href).toBe(href);
      expect(out.problems).toEqual([]);
    }
  });

  it("an up-and-over path to a non-entry is not ours either", () => {
    const out = run("../../../outside.png");
    expect(out.href).toBe("../../../outside.png");
    expect(out.problems).toEqual([]);
  });

  it("a plain anchor that already is a heading id", () => {
    expect(run("#backups").href).toBe("#backups");
  });
});

describe("links that have no page", () => {
  it("an unpublished entry is reported with its reason and renders as text", () => {
    const out = run("../Linux/Draft.md");
    expect(out.unlinked).toBe(true);
    expect(out.nodes).toEqual(["text"]);
    expect(out.problems).toEqual([
      { href: "../Linux/Draft.md", reason: "is not published (left out by where.status)" },
    ]);
  });

  it("an excluded file that exists says it is excluded, by which pattern", () => {
    expect(run("../internal/Plan.md").problems[0]!.reason).toBe(
      'is not published (excluded by "internal/**")',
    );
  });

  it("a file that is not there says it does not exist", () => {
    expect(run("../Linux/Nope.md").problems[0]!.reason).toBe("does not exist");
    // Excluded by pattern but not on disk: missing, not unpublished.
    expect(run("../internal/Gone.txt.md").problems[0]!.reason).toBe(
      'is not published (excluded by "internal/**")',
    );
    const absent = makeIndex({}, { exists: () => false });
    expect(run("../internal/Gone.md", "Frappe/X.md", absent).problems[0]!.reason).toBe(
      "does not exist",
    );
  });

  it("a path that climbs out of the root is refused, never resolved", () => {
    const out = run("../../etc/passwd.md");
    expect(out.unlinked).toBe(true);
    expect(out.problems[0]!.reason).toBe("points outside the collection's source directory");
    expect(run("../../../x.md", "A.md").problems[0]!.reason).toContain("outside");
    expect(run("../x.md", "A.md").problems[0]!.reason).toContain("outside");
  });

  it("a percent-encoded dot segment cannot be used to climb out", () => {
    expect(run("%2E%2E/%2E%2E/etc/passwd.md").problems[0]!.reason).toContain("outside");
  });

  it("keeps the anchor's own children when it is removed", () => {
    const link: JxElement = {
      attributes: { href: "Nope.md" },
      children: ["a ", { tagName: "strong", textContent: "bold" }, " link"],
      tagName: "a",
    };
    const nodes: (JxElement | string)[] = ["before ", link, " after"];
    rewriteLinks(nodes, "A.md", INDEX, () => {});
    expect(nodes).toEqual([
      "before ",
      "a ",
      { tagName: "strong", textContent: "bold" },
      " link",
      " after",
    ]);
  });

  it("an anchor with no content disappears, and a text-less one leaves nothing", () => {
    const empty: JxElement = { attributes: { href: "Nope.md" }, tagName: "a" };
    const nodes: (JxElement | string)[] = ["x", empty, "y"];
    rewriteLinks(nodes, "A.md", INDEX, () => {});
    expect(nodes).toEqual(["x", "y"]);
  });

  it("an anchor inside an anchor's content is still examined", () => {
    const inner: JxElement = { attributes: { href: "Nope2.md" }, tagName: "a", textContent: "in" };
    const outer: JxElement = {
      attributes: { href: "Nope.md" },
      children: [inner],
      tagName: "a",
    };
    const problems: LinkProblem[] = [];
    const nodes: (JxElement | string)[] = [outer];
    rewriteLinks(nodes, "A.md", INDEX, (p) => problems.push(p));
    expect(nodes).toEqual(["in"]);
    expect(problems.map((p) => p.href)).toEqual(["Nope.md", "Nope2.md"]);
  });

  it("a link element with no string href is not examined", () => {
    const nodes: (JxElement | string)[] = [
      { attributes: {}, tagName: "a", textContent: "x" },
      { tagName: "a", textContent: "y" },
    ];
    const before = JSON.stringify(nodes);
    rewriteLinks(nodes, "A.md", INDEX, () => {});
    expect(JSON.stringify(nodes)).toBe(before);
  });
});

describe("fragments", () => {
  it("collapses a run of hyphens the way the heading id does, in either spelling", () => {
    // `## Foo - Bar` has the id `foo-bar`; GitHub would link it as `#foo---bar`.
    expect(run("#foo---bar").href).toBe("#foo-bar");
    expect(run("#Foo%20-%20Bar").href).toBe("#foo-bar");
    expect(run("../Linux/Swap%20Configuration.md#foo---bar").href).toBe(
      "/kb/linux/swap-configuration/#foo-bar",
    );
  });

  it("leaves a fragment with nothing to slugify as written", () => {
    expect(run("#???").href).toBe("#???");
  });
});

describe("a link whose text was made inert", () => {
  it("keeps the words of a link that has no page, as the same escaped text", () => {
    const link: JxElement = {
      attributes: { href: "Nope.md" },
      innerHTML: "see &#36;{y}",
      tagName: "a",
    };
    const nodes: (JxElement | string)[] = ["a ", link, " b"];
    rewriteLinks(nodes, "A.md", INDEX, () => {});
    expect(nodes).toEqual(["a ", { innerHTML: "see &#36;{y}", tagName: "span" }, " b"]);
  });
});

describe("a raw HTML block", () => {
  it("is a nested list, and the links in it are rewritten", () => {
    const nested = [
      {
        attributes: { href: "../Linux/Swap%20Configuration.md" },
        tagName: "a",
        textContent: "swap",
      },
    ];
    const tree = [nested] as never;
    rewriteLinks(tree, "Frappe/X.md", INDEX, () => {});
    expect((nested[0] as JxElement).attributes?.href).toBe("/kb/linux/swap-configuration/");
  });
});

describe("links to something that is not an entry", () => {
  const published = makeIndex(
    { "Frappe/Bench Operations.md": { route: "/kb/frappe/bench-operations" } },
    {
      asset: (path) =>
        ({
          "files/report.pdf": { url: "/content/kb/files/report.pdf" },
          "internal/plan.pdf": { unpublished: 'excluded by "internal/**"' },
        })[path],
      excludesDir: (path) => path === "internal",
      isDirectory: (path) => ["Empty", "internal", "Frappe"].includes(path),
      indexes: new Map([["Frappe", "Frappe/Bench Operations.md"]]),
    },
  );

  it("an attachment follows the asset mount, keeping its query and fragment as written", () => {
    expect(run("../files/report.pdf", "Frappe/Bench Operations.md", published).href).toBe(
      "/content/kb/files/report.pdf",
    );
    expect(
      run("../files/report.pdf?v=2#page=3", "Frappe/Bench Operations.md", published).href,
    ).toBe("/content/kb/files/report.pdf?v=2#page=3");
  });

  it("an attachment the collection does not publish is a broken link", () => {
    const out = run("../internal/plan.pdf", "Frappe/Bench Operations.md", published);
    expect(out.unlinked).toBe(true);
    expect(out.problems).toEqual([
      { href: "../internal/plan.pdf", reason: 'is not published (excluded by "internal/**")' },
    ]);
  });

  it("a folder with no README or index is a broken link, and an excluded one says so", () => {
    expect(run("../Empty/", "Frappe/Bench Operations.md", published).problems[0]!.reason).toBe(
      "is a folder with no README.md or index.md",
    );
    expect(run("../Empty", "Frappe/Bench Operations.md", published).problems[0]!.reason).toBe(
      "is a folder with no README.md or index.md",
    );
    expect(run("../internal/", "Frappe/Bench Operations.md", published).problems[0]!.reason).toBe(
      "is not published (its folder is excluded)",
    );
  });

  it("a folder that has an index is still that index's page, and an unknown path is left alone", () => {
    expect(run("../Frappe/", "Frappe/Bench Operations.md", published).href).toBe(
      "/kb/frappe/bench-operations/",
    );
    const out = run("../nowhere/thing.png", "Frappe/Bench Operations.md", published);
    expect(out.href).toBe("../nowhere/thing.png");
    expect(out.problems).toEqual([]);
  });
});

describe("a name written in another Unicode form", () => {
  it("finds a file whose name is composed when the link is decomposed, and the reverse", () => {
    const composed = makeIndex({ "Caf\u00E9/Menu.md": { route: "/kb/menu" } });
    expect(run("Cafe\u0301/Menu.md", "A.md", composed).href).toBe("/kb/menu/");
    const decomposed = makeIndex({ "Cafe\u0301/Menu.md": { route: "/kb/menu" } });
    expect(run("Caf%C3%A9/Menu.md", "A.md", decomposed).href).toBe("/kb/menu/");
  });

  it("finds a directory index the same way", () => {
    const index = makeIndex(
      { "Caf\u00E9/README.md": { route: "/kb/cafe" } },
      { indexes: new Map([["Caf\u00E9", "Caf\u00E9/README.md"]]) },
    );
    expect(run("Cafe\u0301/", "A.md", index).href).toBe("/kb/cafe/");
  });
});
