/**
 * The ATAG Part B checks: what they find, what they deliberately do not, and the property that
 * makes the report honest — a run that could not check something says so.
 */

import { resetWorkspaceWithTab } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  a11yCommands,
  checkDocument,
  reportA11yProblems,
  unavailableChecks,
} from "../src/services/a11y-report";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext, makeContext } from "../src/commands/context";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import type { JxElement } from "@jxsuite/schema/types";

/** A one-element document, so each test states only what it is about. */
function doc(children: JxElement[], extra: Partial<JxElement> = {}): JxElement {
  return { children, lang: "en", tagName: "my-page", ...extra } as JxElement;
}

/** A tab holding the given children, so the command has an active document to check. */
function setupDocTab(children: JxElement[]): void {
  resetWorkspaceWithTab({ children, lang: "en", tagName: "my-page" } as never, {
    documentPath: "pages/index.json",
  });
}

function ids(node: JxElement): string[] {
  return checkDocument(node).map((f) => f.id.replace(/:.*$/, ""));
}

afterEach(() => {
  resetNotifications();
});

describe("images", () => {
  test("an image with no alt is an error; an empty alt is a decision and passes", () => {
    expect(ids(doc([{ attributes: { src: "/a.png" }, tagName: "img" }]))).toContain(
      "img-alt-missing",
    );
    // An empty alt says "decorative" out loud. The ABSENT attribute says nothing.
    expect(ids(doc([{ attributes: { alt: "", src: "/a.png" }, tagName: "img" }]))).toEqual([]);
    expect(ids(doc([{ attributes: { alt: "A cat", src: "/a.png" }, tagName: "img" }]))).toEqual([]);
  });

  test("alt text that starts by saying it is an image is flagged", () => {
    // A screen reader announces the role already, so this is heard twice.
    expect(ids(doc([{ attributes: { alt: "Image of a cat", src: "/a.png" }, tagName: "img" }])));
    expect(
      ids(doc([{ attributes: { alt: "Photo of a dog", src: "/a.png" }, tagName: "img" }])),
    ).toContain("img-alt-redundant");
  });

  test("a linked image-map area with no alt is reported, and an unlinked one is not", () => {
    // The engine names it: an <area href> IS its link text, so it has no other route to a name.
    expect(
      ids(
        doc([
          {
            children: [
              { attributes: { coords: "0,0,9,9", href: "/", shape: "rect" }, tagName: "area" },
            ],
            tagName: "map",
          },
        ]),
      ),
    ).toContain("interactive-unnamed");
    expect(
      ids(
        doc([
          {
            children: [
              {
                attributes: { alt: "Home", coords: "0,0,9,9", href: "/", shape: "rect" },
                tagName: "area",
              },
              { attributes: { coords: "9,9,9,9", shape: "rect" }, tagName: "area" },
            ],
            tagName: "map",
          },
        ]),
      ),
    ).toEqual([]);
  });

  test('the wording check reaches an area and an <input type="image">, not a fictional tag', () => {
    expect(
      ids(
        doc([
          {
            attributes: { alt: "Icon of a printer", src: "/p.png", type: "image" },
            tagName: "input",
          },
        ]),
      ),
    ).toContain("img-alt-redundant");
    expect(
      ids(doc([{ attributes: { alt: "Graphic of the shop", href: "/s" }, tagName: "area" }])),
    ).toContain("img-alt-redundant");
    // A text input is not an image, whatever its alt says.
    expect(
      ids(
        doc([
          { attributes: { "aria-label": "Q", alt: "Photo of x", type: "text" }, tagName: "input" },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("headings", () => {
  test("a skipped level is flagged, a contiguous one is not", () => {
    const skipped = doc([
      { tagName: "h1", textContent: "Title" },
      { tagName: "h3", textContent: "Sub" },
    ]);
    expect(ids(skipped)).toContain("heading-skip");

    const fine = doc([
      { tagName: "h1", textContent: "Title" },
      { tagName: "h2", textContent: "Sub" },
      { tagName: "h3", textContent: "Deeper" },
      { tagName: "h2", textContent: "Back up" },
    ]);
    expect(ids(fine)).toEqual([]);
  });

  test("a second h1 is flagged once, not once per heading", () => {
    const two = doc([
      { tagName: "h1", textContent: "A" },
      { tagName: "h1", textContent: "B" },
      { tagName: "h1", textContent: "C" },
    ]);
    expect(ids(two).filter((id) => id === "multiple-h1")).toHaveLength(1);
  });
});

describe("controls and links", () => {
  test("an unlabelled input is an error; a submit button names itself", () => {
    expect(ids(doc([{ attributes: { type: "text" }, tagName: "input" }]))).toContain(
      "interactive-unnamed",
    );
    expect(ids(doc([{ attributes: { type: "submit", value: "Go" }, tagName: "input" }]))).toEqual(
      [],
    );
    expect(
      ids(doc([{ attributes: { "aria-label": "Search", type: "text" }, tagName: "input" }])),
    ).toEqual([]);
  });

  test("a personal-data field with no autocomplete is flagged", () => {
    const found = ids(
      doc([
        { attributes: { "aria-label": "Email", name: "email", type: "email" }, tagName: "input" },
      ]),
    );
    expect(found).toContain("input-no-autocomplete");
  });

  test("vague link text is flagged and specific text is not", () => {
    expect(ids(doc([{ tagName: "a", textContent: "Click here" }]))).toContain("link-vague");
    expect(ids(doc([{ tagName: "a", textContent: "Read the deployment guide" }]))).toEqual([]);
  });

  test("a link with no text at all is an error", () => {
    expect(ids(doc([{ attributes: { href: "/x" }, tagName: "a" }]))).toContain(
      "interactive-unnamed",
    );
  });

  test("a new-tab link that says so is fine", () => {
    expect(
      ids(doc([{ attributes: { target: "_blank" }, tagName: "a", textContent: "Docs" }])),
    ).toContain("link-new-window");
    expect(
      ids(
        doc([
          {
            attributes: { target: "_blank" },
            tagName: "a",
            textContent: "Docs (opens in new tab)",
          },
        ]),
      ),
    ).toEqual([]);
  });
});

describe("structure", () => {
  test("a positive tabindex is an error, 0 and -1 are not", () => {
    // A positive value reorders the WHOLE page, not just this component.
    expect(ids(doc([{ tabIndex: 3, tagName: "div" }]))).toContain("positive-tabindex");
    expect(
      ids(
        doc([
          { tabIndex: 0, tagName: "div" },
          { tabIndex: -1, tagName: "div" },
        ]),
      ),
    ).toEqual([]);
  });

  test("every finding gets a key of its own, hand-written ones included", () => {
    /*
     * A Problem key replaces rather than stacks, so two findings under one id are one row. Three
     * elements sharing an id are TWO duplicate-id findings, and they used to collapse: the count
     * `reportA11yProblems` returned and the number of rows the author saw disagreed.
     */
    const three = doc([
      { id: "dup", tagName: "div" },
      { id: "dup", tagName: "div" },
      { id: "dup", tagName: "div" },
    ]);
    const nodeIds = checkDocument(three).map((f) => f.id);
    expect(new Set(nodeIds).size).toBe(nodeIds.length);
    resetNotifications();
    const filed = reportA11yProblems(three);
    const rows = problems.filter((p) => p.source === "Accessibility");
    expect(rows).toHaveLength(filed);
  });

  test("a duplicate id is flagged once", () => {
    const dup = doc([
      { id: "main", tagName: "div" },
      { id: "main", tagName: "div" },
    ]);
    expect(ids(dup).filter((id) => id.startsWith("duplicate-id"))).toHaveLength(1);
  });

  test("autoplaying media with no controls is an error", () => {
    expect(ids(doc([{ attributes: { autoplay: "", src: "/v.mp4" }, tagName: "video" }]))).toContain(
      "autoplay-no-controls",
    );
    expect(
      ids(doc([{ attributes: { autoplay: "", controls: "", src: "/v.mp4" }, tagName: "video" }])),
    ).toEqual([]);
  });

  test("a document with no language is flagged", () => {
    const noLang = { children: [], tagName: "my-page" } as JxElement;
    expect(ids(noLang)).toContain("no-lang");
  });

  test("elements inside a $switch branch are checked too", () => {
    // A branch that only renders sometimes still ships to somebody.
    const switched = doc([
      {
        $switch: "state.mode",
        cases: { off: { tagName: "span" }, on: { attributes: { src: "/a.png" }, tagName: "img" } },
        tagName: "div",
      },
    ]);
    expect(ids(switched)).toContain("img-alt-missing");
  });
});

describe("reportA11yProblems", () => {
  test("files one Problem per finding, each naming its criterion", () => {
    reportA11yProblems(
      doc([{ attributes: { src: "/a.png" }, tagName: "img" }]),
      "pages/index.json",
    );
    const filed = problems.filter((p) => p.source === "Accessibility");
    const alt = filed.find((p) => p.message.includes("alt text"));
    expect(alt?.tier).toBe("problem");
    expect(alt?.detail).toContain("WCAG 1.1.1");
    expect(alt?.path).toBe("pages/index.json");
  });

  test("a clean document still says what was NOT checked", () => {
    /*
     * The property that makes this a check rather than a reassurance. Contrast and target size are
     * properties of rendered output; a report that listed nothing would read as "this page is
     * accessible", which this run cannot claim.
     */
    const filed = reportA11yProblems(doc([{ tagName: "p", textContent: "Hello" }]));
    expect(filed).toBe(unavailableChecks().length);
    const rows = problems.filter((p) => p.source === "Accessibility");
    expect(rows).toHaveLength(unavailableChecks().length);
    expect(rows.map((p) => p.message)).toContain("Colour contrast was not checked.");
    // And each one offers the re-run, so it is not a dead end.
    expect(rows.every((p) => p.action === "document.checkAccessibility")).toBe(true);
  });

  test("a re-run replaces the previous findings rather than stacking them", () => {
    const bad = doc([{ attributes: { src: "/a.png" }, tagName: "img" }]);
    reportA11yProblems(bad);
    reportA11yProblems(bad);
    const filed = problems.filter((p) => p.source === "Accessibility");
    expect(filed.filter((p) => p.message.includes("alt text"))).toHaveLength(1);
  });

  test("four broken references on one node are four Problems, not one", () => {
    /*
     * One node, one rule, one path, four distinct dangling ids. A key of rule and path alone is the
     * same string for all four, and a key REPLACES rather than stacks — so the author was told
     * about the last reference and never heard about the other three.
     */
    const filed = reportA11yProblems(
      doc([
        {
          attributes: { "aria-controls": "gone-d", "aria-labelledby": "gone-a gone-b gone-c" },
          tagName: "button",
          textContent: "Go",
        },
      ]),
    );
    const rows = problems.filter((p) => p.message.includes("nothing in this document has"));
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((p) => p.key)).size).toBe(4);
    // Every one of them is named, not just the survivor.
    const said = rows.map((p) => p.message).join(" ");
    for (const id of ["#gone-a", "#gone-b", "#gone-c", "#gone-d"]) {
      expect(said).toContain(id);
    }
    // And the count the command's toast reports agrees with the panel.
    expect(filed).toBe(rows.length + unavailableChecks().length);
  });

  test("fixing the page clears its rows", () => {
    reportA11yProblems(doc([{ attributes: { src: "/a.png" }, tagName: "img" }]));
    expect(problems.some((p) => p.message.includes("alt text"))).toBe(true);
    reportA11yProblems(doc([{ attributes: { alt: "A cat", src: "/a.png" }, tagName: "img" }]));
    expect(problems.some((p) => p.message.includes("alt text"))).toBe(false);
  });
});

// ─── The command ─────────────────────────────────────────────────────────────

describe("document.checkAccessibility", () => {
  test("is registered like Search appearance, and gated on an open document", () => {
    const [command] = a11yCommands();
    expect(command!.id).toBe("document.checkAccessibility");
    expect(command!.level).toBe("document");
    expect(command!.menus).toContain("palette");
    expect(command!.aiTool?.name).toBe("check_accessibility");
    // With no document there is nothing to check, so the command says so rather than doing nothing.
    expect(command!.when!(emptyContext())).toBe(false);
  });

  test("runs over the active document and reports how many it filed", async () => {
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true } }),
    });
    registry.register(a11yCommands()[0]!);
    setupDocTab([{ attributes: { src: "/a.png" }, tagName: "img" }]);
    resetNotifications();

    await registry.run("document.checkAccessibility");
    expect(problems.some((p) => p.message.includes("alt text"))).toBe(true);
    expect(toasts.at(-1)?.message).toContain("1 accessibility problem");
  });

  test("a clean document is told so in words, not by an empty list", async () => {
    const registry = createCommandRegistry({
      getContext: () => makeContext({ document: { open: true } }),
    });
    registry.register(a11yCommands()[0]!);
    setupDocTab([{ tagName: "p", textContent: "Hello" }]);
    resetNotifications();

    await registry.run("document.checkAccessibility");
    expect(toasts.at(-1)?.message).toBe("No accessibility problems found in this document.");
  });
});

describe("accessible names", () => {
  test("text nested inside a child counts as a link's name", () => {
    // The name computation walks into children; a link wrapping a <span> is named by that span.
    const nested = doc([
      { children: [{ tagName: "span", textContent: "The deployment guide" }], tagName: "a" },
    ]);
    expect(ids(nested)).toEqual([]);
  });

  test("a bare string child counts too", () => {
    const bare = doc([{ children: ["Read the deployment guide"], tagName: "a" }]);
    expect(ids(bare)).toEqual([]);
  });
});
