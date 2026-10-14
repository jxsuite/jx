/**
 * Studio shell (C7): ?project= + ?file= pointing at a registered content format — studio.ts parses
 * through the format host and switches the opened tab into content mode.
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { bootStudio, waitFor } from "./studio-shell-fixture";
import { activeTab } from "../src/workspace/workspace";
import { toRaw } from "../src/reactivity";
import type { FormatActionRequest } from "../src/types";

const MARKDOWN_FORMAT = {
  capabilities: { parse: { identifier: "parse", timing: ["server"] } },
  documentKinds: ["content", "page"],
  exportTarget: false,
  extensions: [".md"],
  mediaType: "text/markdown",
  name: "Markdown",
  remote: false,
  studio: null,
};

await bootStudio({
  overrides: {
    formatAction: async (payload: FormatActionRequest) => {
      if (payload.action === "parse") {
        return {
          children: [{ children: [], tagName: "p", textContent: "Hello world" }],
          title: "Hello",
        };
      }
      throw new Error(`unexpected format action: ${payload.action}`);
    },
    listFormats: async () => [MARKDOWN_FORMAT],
    resolveSiteContext: async () => ({ sitePath: null }),
  },
  seedFiles: {
    "posts/hello.md": "# Hello\n\nHello world",
  },
  url: "http://localhost/?project=/abs/mdsite&file=posts/hello.md",
});

await waitFor(() => activeTab.value?.id === "posts/hello.md");

describe("?project= with a format-parsed content file", () => {
  test("opens the parsed document in a tab with its source format", () => {
    const tab = activeTab.value!;
    expect(tab.id).toBe("posts/hello.md");
    expect(tab.doc.sourceFormat).toBe("Markdown");
    // The raw document: the reactive proxy is not something `toMatchObject` can walk.
    expect(toRaw(tab.doc.document)).toMatchObject({ children: [{ textContent: "Hello world" }] });
  });

  test("separates frontmatter and switches the tab into content mode", () => {
    const tab = activeTab.value!;
    expect(tab.doc.mode).toBe("content");
    expect(tab.doc.document.title).toBeUndefined();
    expect(tab.doc.content.frontmatter["title"]).toBe("Hello");
  });
});
