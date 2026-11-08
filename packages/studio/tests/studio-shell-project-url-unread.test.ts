/**
 * Studio shell (C7): ?project= resolving to a project whose project.jxn does not read. The host
 * relays it with no configuration (site-architecture.md §2.3), and studio.ts opens the file as its
 * own text in the Code view instead of reporting that it could not open it.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { bootStudio, statusMessages, waitFor } from "./studio-shell-fixture";
import { activeTab } from "../src/workspace/workspace";

const SITE = "/abs/typo-site";
const BROKEN = 'project "Typo"\ndefaults {\n';

await bootStudio({
  overrides: {
    listDirectory: async () => [{ name: "project.jxn", path: "project.jxn", type: "file" }],
    resolveSiteContext: async () => ({
      fileRelPath: "project.jxn",
      projectConfig: null,
      sitePath: SITE,
    }),
  },
  seedFiles: { "project.jxn": BROKEN },
  url: `http://localhost/?project=${SITE}`,
});

await waitFor(() => activeTab.value?.id === "project.jxn");

describe("?project= over a project file that does not read", () => {
  test("opens the file as its text in the Code view", () => {
    expect(activeTab.value?.doc.source).toBe(BROKEN);
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
