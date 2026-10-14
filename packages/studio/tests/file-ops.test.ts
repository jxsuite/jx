import "./with-dom.js";
import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { registerPlatform } from "../src/platform";
import { exportFile, openFile, parseSourceForPath, saveFile } from "../src/files/file-ops";
import { activeTab, closeTab, openTab } from "../src/workspace/workspace";
import { openMediaTab } from "../src/media/media-open";
import { mockFormatAction, seedMarkdownFormat } from "./format-fixture";
import { isString } from "@jxsuite/schema/guards";
import type { Mock } from "bun:test";
import type { StudioPlatform } from "../src/types";

beforeAll(() => {
  seedMarkdownFormat();
});

/** What a test's mock platform received: the method, the path, and the bytes. */
type PlatformWrite = (string | File | Blob | ArrayBuffer)[];

/** Register a platform that implements `formatAction` plus only the `methods` a test supplies. */
function registerPartialPlatform(methods: Partial<StudioPlatform> = {}): void {
  /* SAFETY: the paths under test reach the platform for `formatAction` (format-host's parse and
     serialize), `locateFile` (openFile) and `writeFile` (saveFile), and each test supplies the ones
     its path calls. A member left out stays `undefined`, as on the partial platforms these suites
     always registered, so a path that started calling one throws rather than reading an answer. */
  registerPlatform({ formatAction: mockFormatAction, ...methods } as StudioPlatform);
}

/** A `FileSystemFileHandle` whose writable stream hands each write to `onWrite`. */
function writableHandle(onWrite: (content: string) => void, name = "export.json") {
  /* SAFETY: saveFile and exportFile call only `createWritable()` on the handle, then `write()` and
     `close()` on the stream (plus `name` after an export), which is all this object implements. */
  return {
    createWritable: async () => ({
      close: async () => {},
      write: async (content: string) => {
        onWrite(content);
      },
    }),
    name,
  } as FileSystemFileHandle;
}

// ─── parseSourceForPath ──────────────────────────────────────────────────────

describe("parseSourceForPath", () => {
  beforeAll(() => {
    registerPartialPlatform();
  });

  test("returns content state for plain markdown", async () => {
    const result = await parseSourceForPath(
      "post.md",
      "---\ntitle: Test Post\n---\n\n# Hello\n\nWorld",
    );
    expect(result.document).toBeDefined();
    expect(result.document.children).toBeDefined();
    expect(result.frontmatter.title).toBe("Test Post");
    expect(result.mode).toBe("content");
    expect(result.format.name).toBe("Markdown");
  });

  test("returns component state for hyphenated tagName", async () => {
    const result = await parseSourceForPath(
      "comp.md",
      "---\ntagName: my-component\n---\n# Content\n",
    );
    expect(result.document.tagName).toBe("my-component");
    expect(result.frontmatter).toEqual({});
    expect(result.mode).toBe("component");
  });

  test("extracts frontmatter keys excluding children", async () => {
    const result = await parseSourceForPath(
      "post.md",
      "---\ntitle: Test Post\n---\n\n# Content doc",
    );
    expect(result.frontmatter).toBeDefined();
    expect(result.frontmatter.children).toBeUndefined();
    expect(result.frontmatter.title).toBe("Test Post");
  });

  test("throws for unregistered extensions", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- Bun's expect().rejects.toThrow() returns a real Promise at runtime but is typed `void`; the await must be kept to wait for the rejection.
    await expect(parseSourceForPath("data.toml", "a = 1")).rejects.toThrow(
      /No format class imported/,
    );
  });
});

// ─── openFile ─────────────────────────────────────────────────────────────────

describe("openFile", () => {
  beforeEach(() => {
    // No project to resolve the picked file against, so it opens without a documentPath.
    registerPartialPlatform({ locateFile: async () => null });
    // The File System Access pickers are not in TypeScript's DOM lib, so they are removed by name.
    Reflect.deleteProperty(window, "showOpenFilePicker");
    // Close any existing tabs
    for (const id of activeTab.value ? [activeTab.value.id] : []) {
      closeTab(id);
    }
  });

  test("opens JSON file via showOpenFilePicker", async () => {
    const mockHandle = {
      getFile: async () => ({
        text: async () => JSON.stringify({ children: [], tagName: "div" }),
      }),
      name: "component.json",
    };
    Object.assign(window, { showOpenFilePicker: async () => [mockHandle] });

    await openFile();

    const tab = activeTab.value;
    expect(tab).not.toBeNull();
    expect(tab!.doc.document.tagName).toBe("div");
    expect(tab!.doc.dirty).toBe(false);
  });

  test("opens markdown file via showOpenFilePicker", async () => {
    const mockHandle = {
      getFile: async () => ({
        text: async () => "# Hello\n\nContent here",
      }),
      name: "post.md",
    };
    Object.assign(window, { showOpenFilePicker: async () => [mockHandle] });

    await openFile();

    const tab = activeTab.value;
    expect(tab).not.toBeNull();
    expect(tab!.doc.sourceFormat).toBe("Markdown");
    // The tab keeps the picker's own handle; the stub implements only what openFile reads.
    expect<FileSystemFileHandle | typeof mockHandle | null>(tab!.fileHandle).toEqual(mockHandle);
  });

  test("handles AbortError silently", async () => {
    const error = new Error("User cancelled");
    error.name = "AbortError";
    Object.assign(window, {
      showOpenFilePicker: async () => {
        throw error;
      },
    });

    // Should not throw
    await openFile();
  });
});

// ─── saveFile ─────────────────────────────────────────────────────────────────

describe("saveFile", () => {
  beforeEach(() => {
    // Close existing tabs and open a fresh one for each test
    for (const id of activeTab.value ? [activeTab.value.id] : []) {
      closeTab(id);
    }
  });

  test("saves via platform when documentPath exists", async () => {
    let written: { content: string; path: string } | null = null;
    registerPartialPlatform({
      writeFile: async (path, content) => {
        written = { content, path };
      },
    });

    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/index.json",
      id: "test-save",
    });
    activeTab.value!.doc.dirty = true;

    await saveFile();

    expect(written).not.toBeNull();
    expect(written!.path).toBe("pages/index.json");
    expect(activeTab.value!.doc.dirty).toBe(false);
  });

  test("saves via File System Access API when fileHandle exists", async () => {
    let writtenContent: string | null = null;
    const mockHandle = writableHandle((content) => {
      writtenContent = content;
    });

    registerPartialPlatform();
    openTab({
      document: { children: [], tagName: "div" },
      fileHandle: mockHandle,
      id: "test-save-fs",
    });
    activeTab.value!.doc.dirty = true;

    await saveFile();

    expect(writtenContent).not.toBeNull();
    expect(activeTab.value!.doc.dirty).toBe(false);
  });

  test("shows message when no save target", async () => {
    registerPartialPlatform();
    openTab({
      document: { tagName: "div" },
      id: "test-no-target",
    });

    // Should not throw
    await saveFile();
  });

  test("serializes markdown source format via the format class", async () => {
    let writtenContent: string | null = null;
    registerPartialPlatform({
      writeFile: async (_path, content) => {
        writtenContent = content;
      },
    });

    openTab({
      document: {
        children: [{ tagName: "p", textContent: "Hello" }],
        tagName: "div",
      },
      documentPath: "pages/post.md",
      id: "test-md-save",
      sourceFormat: "Markdown",
    });
    activeTab.value!.doc.dirty = true;

    await saveFile();

    expect(writtenContent).toBeDefined();
    expect(isString(writtenContent)).toBe(true);
  });

  test("component with duplicate default slots still saves (warn, not block)", async () => {
    let written: { content: string; path: string } | null = null;
    registerPartialPlatform({
      writeFile: async (path, content) => {
        written = { content, path };
      },
    });

    openTab({
      document: {
        children: [{ tagName: "slot" }, { tagName: "slot" }],
        tagName: "my-card",
      },
      documentPath: "components/my-card.json",
      id: "test-slot-warn",
    });
    activeTab.value!.doc.dirty = true;

    // Should not throw; warning is surfaced via statusbar but the save proceeds
    await saveFile();

    expect(written).not.toBeNull();
    expect(written!.path).toBe("components/my-card.json");
    expect(activeTab.value!.doc.dirty).toBe(false);
  });

  test("component with valid slots saves without warning", async () => {
    let written: { content: string; path: string } | null = null;
    registerPartialPlatform({
      writeFile: async (path, content) => {
        written = { content, path };
      },
    });

    openTab({
      document: {
        children: [{ tagName: "slot" }, { attributes: { name: "header" }, tagName: "slot" }],
        tagName: "my-card",
      },
      documentPath: "components/my-card.json",
      id: "test-slot-ok",
    });
    activeTab.value!.doc.dirty = true;

    await saveFile();

    expect(written).not.toBeNull();
    expect(activeTab.value!.doc.dirty).toBe(false);
  });

  test("handles save error gracefully", async () => {
    registerPartialPlatform({
      writeFile: async () => {
        throw new Error("disk full");
      },
    });

    openTab({
      document: { tagName: "div" },
      documentPath: "pages/index.json",
      id: "test-error",
    });

    // Should not throw
    await saveFile();
  });

  /* A media tab reaches `saveFile` through the ordinary ⌘S: `file.save` is gated on `documentOpen`
     alone, and a media tab has a `documentPath`. Before the guard, `serializeDocument` returned the
     stub `openMediaTab` gives every media tab and `writeFile` put it on disk, so saving with a PNG
     open destroyed the PNG. The assertion is that NOTHING is written — a returned `false` alone would
     have passed against the broken code, which wrote and then reported success. */
  test("refuses a media tab rather than writing the stub document over the file", async () => {
    const writes: PlatformWrite[] = [];
    registerPartialPlatform({
      uploadFile: async (path, data) => {
        writes.push(["uploadFile", path, data]);
        return { path };
      },
      writeFile: async (path, content) => {
        writes.push(["writeFile", path, content]);
      },
    });

    const tab = openMediaTab("public/hero.png");

    expect(await saveFile(tab)).toBe(false);
    expect(writes).toEqual([]);
  });

  /* `.svg` is the one media type with a second, TEXT mode, so a guard written against
     `canvasMode === "media"` would have left it able to overwrite itself from the Code view. It is a
     media file either way, which is what the guard actually keys on. */
  test("refuses an .svg media tab, whose source alternate has the same stub behind it", async () => {
    const writes: PlatformWrite[] = [];
    registerPartialPlatform({
      writeFile: async (path, content) => {
        writes.push([path, content]);
      },
    });

    const tab = openMediaTab("public/icon.svg");
    tab.session.ui.canvasMode = "source";

    expect(await saveFile(tab)).toBe(false);
    expect(writes).toEqual([]);
  });
});

// ─── exportFile ───────────────────────────────────────────────────────────────

describe("exportFile", () => {
  let anchorClicks: Mock<() => void> | null = null;

  /* The download fallback clicks a detached `<a download>`. Stubbing `click` keeps happy-dom from
     navigating, and each call's receiver is the link, so its `download` name is the file offered. */
  function downloadNames(): string[] {
    return (anchorClicks?.mock.contexts ?? []).flatMap((link) =>
      link instanceof HTMLAnchorElement ? [link.download] : [],
    );
  }

  beforeEach(() => {
    anchorClicks = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    Reflect.deleteProperty(window, "showSaveFilePicker");
    for (const id of activeTab.value ? [activeTab.value.id] : []) {
      closeTab(id);
    }
  });

  afterEach(() => {
    anchorClicks?.mockRestore();
  });

  test("exports via showSaveFilePicker when available", async () => {
    let writtenContent: string | null = null;
    const mockHandle = writableHandle((content) => {
      writtenContent = content;
    });
    Object.assign(window, { showSaveFilePicker: async () => mockHandle });

    openTab({
      document: { children: [], tagName: "div" },
      id: "test-export",
    });

    await exportFile();

    expect(writtenContent).not.toBeNull();
    expect(activeTab.value!.doc.dirty).toBe(false);
  });

  test("falls back to download when showSaveFilePicker unavailable", async () => {
    openTab({
      document: { children: [], tagName: "div" },
      id: "test-download",
    });

    await exportFile();

    expect(downloadNames()).toEqual(["component.json"]);
    expect(activeTab.value!.doc.dirty).toBe(false);
  });

  test("uses .md extension for content mode", async () => {
    openTab({
      document: { children: [{ tagName: "p", textContent: "Hello" }] },
      id: "test-md-export",
      sourceFormat: "Markdown",
    });
    // Content mode is set by sourceFormat being "md" in createTab
    // But for this test we need mode=content explicitly
    activeTab.value!.doc.mode = "content";

    await exportFile();

    expect(downloadNames()).toEqual(["content.md"]);
  });

  test("handles AbortError silently", async () => {
    const error = new Error("User cancelled");
    error.name = "AbortError";
    Object.assign(window, {
      showSaveFilePicker: async () => {
        throw error;
      },
    });

    openTab({
      document: { tagName: "div" },
      id: "test-abort",
    });

    await exportFile();
  });
});
