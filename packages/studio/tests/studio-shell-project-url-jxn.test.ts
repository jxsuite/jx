/**
 * Studio shell (C7): ?project= with ?file= naming a `.jxn` page (studio.md §8.5). The page opens
 * holding the text it was read as, which every save merges with, so a deep-linked page keeps its
 * comments through its first save.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { bootStudio, waitFor } from "./studio-shell-fixture";
import { serializeDocument } from "../src/files/serialize-document";
import { activeTab } from "../src/workspace/workspace";

const SITE = "/abs/notation-site";
const PAGE =
  '/- kdl-version 2\n\n// The team page.\nmain {\n    style padding="2rem"\n    h1 "Team"\n}\n';

await bootStudio({
  overrides: {
    resolveSiteContext: async () => ({
      fileRelPath: "pages/about.jxn",
      projectConfig: { name: "Notation" },
      sitePath: SITE,
    }),
  },
  seedFiles: { "pages/about.jxn": PAGE, "project.json": '{ "name": "Notation" }' },
  url: `http://localhost/?project=${SITE}&file=pages/about.jxn`,
});

await waitFor(() => activeTab.value?.id === "pages/about.jxn");

describe("?file= naming a .jxn page", () => {
  test("opens it as Jx Notation, holding the text it was read as", () => {
    expect(activeTab.value?.doc.sourceFormat).toBe("jxn");
    expect(activeTab.value?.doc.source).toBe(PAGE);
  });

  test("a style edit saves as that one line, the comment kept", async () => {
    const tab = activeTab.value!;
    tab.doc.document.style = { padding: "3rem" };
    expect(await serializeDocument(tab)).toBe(PAGE.replace("2rem", "3rem"));
  });

  test("an element with no children gains none on save", async () => {
    const tab = activeTab.value!;
    tab.doc.document = { tagName: "main", textContent: "Team" };
    const saved = await serializeDocument(tab);
    expect(saved).not.toContain("children");
    expect(saved).toEndWith("main Team\n");
  });
});
