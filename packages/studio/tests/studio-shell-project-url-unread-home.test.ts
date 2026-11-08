/**
 * Studio shell (C7): ?project= over a project whose project.jxn does not read, with a home page to
 * land on. The session opens first and the file is shown over it, as text: the host relays it with
 * no configuration (site-architecture.md §2.3).
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { bootStudio, statusMessages, waitFor } from "./studio-shell-fixture";
import { activeTab, workspace } from "../src/workspace/workspace";

const SITE = "/abs/typo-home";
const UNCLOSED = 'project "Typo"\nbuild outDir="./dist" {\n';

await bootStudio({
  overrides: {
    listDirectory: async (dir: string) =>
      dir === "."
        ? [
            { name: "pages", path: "pages", type: "directory" },
            { name: "project.jxn", path: "project.jxn", type: "file" },
          ]
        : [{ name: "index.json", path: "pages/index.json", type: "file" }],
    resolveSiteContext: async () => ({
      fileRelPath: "project.jxn",
      projectConfig: null,
      sitePath: SITE,
    }),
  },
  seedFiles: { "pages/index.json": JSON.stringify({ tagName: "main" }), "project.jxn": UNCLOSED },
  url: `http://localhost/?project=${SITE}`,
});

await waitFor(() => activeTab.value?.id === "project.jxn");

describe("?project= over a project file that does not read", () => {
  test("opens the home page, then the file over it", () => {
    expect(workspace.tabs.has("pages/index.json")).toBe(true);
  });

  test("opens the file as its text in the Code view", () => {
    expect(activeTab.value?.doc.source).toBe(UNCLOSED);
    expect(activeTab.value?.doc.unread).toContain("project.jxn");
    expect(activeTab.value?.session.ui.canvasMode).toBe("source");
  });

  test("says where it fails, and never that the project could not be opened", () => {
    expect(statusMessages.some((message) => message.includes("project.jxn does not read"))).toBe(
      true,
    );
    expect(statusMessages.some((message) => message.startsWith("Could not open"))).toBe(false);
  });
});
