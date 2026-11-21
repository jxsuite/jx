/**
 * Parent-realm component preview (src/panels/component-preview.ts) — used by the browse grid and
 * the components-palette DnD cards. Fallback paths must never throw (a broken component shows a
 * placeholder box instead).
 */
import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  defineComponent,
  renderComponentInstance,
  renderComponentPreview,
} from "../src/panels/component-preview";
import { setProjectState } from "../src/store";
import type { ProjectState } from "../src/types";
import type { JsonValue } from "@jxsuite/schema/types";

/** An open project with no config and nothing expanded; `projectRoot` empty unless given. */
function emptyProject(projectRoot = ""): ProjectState {
  return {
    dirs: new Map(),
    expanded: new Set(),
    isSiteProject: false,
    name: "",
    projectConfig: null,
    projectRoot,
    searchQuery: "",
    selectedPath: null,
  };
}

beforeEach(() => {
  setProjectState(emptyProject());
});

describe("renderComponentPreview", () => {
  test("npm component not registered → returns fallback div", async () => {
    const el = await renderComponentPreview(
      /** @type {any} */ { source: "npm", tagName: "sl-button" },
    );
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("<sl-button>");
  });

  test("registered npm component → instantiates it with prop defaults (false/'' skipped)", async () => {
    if (!customElements.get("x-preview-registered")) {
      customElements.define("x-preview-registered", class extends HTMLElement {});
    }
    const el = await renderComponentPreview({
      props: [
        { default: "'Jane'", name: "name" },
        { default: "false", name: "compact" },
        { default: "''", name: "label" },
        { name: "unset" },
      ],
      source: "npm",
      tagName: "x-preview-registered",
    });
    expect(el.tagName.toLowerCase()).toBe("x-preview-registered");
    expect(el.getAttribute("name")).toBe("Jane");
    expect(el.hasAttribute("compact")).toBe(false);
    expect(el.hasAttribute("label")).toBe(false);
    expect(el.hasAttribute("unset")).toBe(false);
  });

  test("sample props are set as the instance's own properties, ahead of connection", async () => {
    if (!customElements.get("x-preview-sampled")) {
      customElements.define("x-preview-sampled", class extends HTMLElement {});
    }
    const el = await renderComponentPreview(
      { source: "npm", tagName: "x-preview-sampled" },
      new Map<string, JsonValue>([
        ["title", "Harbour"],
        ["hue", 214],
      ]),
    );
    expect(el.title).toBe("Harbour");
    expect(Object.getOwnPropertyDescriptor(el, "hue")?.value).toBe(214);
  });

  test("defineComponent answers whether the tag can be instantiated", async () => {
    expect(await defineComponent({ source: "npm", tagName: "x-preview-sampled" })).toBe(true);
    expect(await defineComponent({ source: "npm", tagName: "x-never-defined" })).toBe(false);
    expect(
      await defineComponent({ path: "components/a.md", source: "project", tagName: "x-md" }),
    ).toBe(false);
  });

  test("npm component not registered → does not throw", async () => {
    // oxlint-disable-next-line typescript/await-thenable -- Bun's expect().resolves.toBeDefined() returns a real Promise at runtime but is typed `void`; the await must be kept to wait for resolution.
    await expect(
      renderComponentPreview(/** @type {any} */ { source: "npm", tagName: "sl-nonexistent" }),
    ).resolves.toBeDefined();
  });

  test("markdown component → returns fallback div without fetch", async () => {
    const el = await renderComponentPreview({
      path: "components/todo-app.md",
      source: "local",
      tagName: "todo-app",
    });
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("<todo-app>");
  });

  test("markdown component with .MD extension → returns fallback", async () => {
    const el = await renderComponentPreview({
      path: "components/my-comp.MD",
      source: "local",
      tagName: "my-comp",
    });
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("<my-comp>");
  });

  test("local component with invalid path → returns fallback (no unhandled error)", async () => {
    setProjectState(emptyProject("test-project"));
    const el = await renderComponentPreview({
      path: "components/nonexistent.json",
      source: "local",
      tagName: "missing-comp",
    });
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("<missing-comp>");
  });
});

/**
 * The Library and the Site panel cache what a preview hands back, so a definition that failed to
 * register must not come back as an element: it would be cached as the card's preview, and no retry
 * would ever draw the real one once the project had settled.
 */
describe("renderComponentInstance", () => {
  test("a definition that fails to register throws rather than answering a fallback box", async () => {
    setProjectState(emptyProject("test-project"));
    const realFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(() => Promise.reject(new Error("host not ready")), {
      preconnect: realFetch.preconnect,
    });
    try {
      let rejected = false;
      try {
        await renderComponentInstance({
          path: "components/not-ready.json",
          source: "project",
          tagName: "x-not-ready",
        });
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a tag that can never be defined here still answers the fallback box", async () => {
    const el = await renderComponentInstance({ source: "npm", tagName: "x-never-there" });
    expect(el.tagName).toBe("DIV");
    expect(el.textContent).toBe("<x-never-there>");
  });
});

describe("a .jxn definition served as its text", () => {
  test("defines the element in this window: the shell realm reads KDL as the canvas does", async () => {
    const realFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = Object.assign(
      async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response('/- kdl-version 2\n\nx-preview-kdl {\n    p "From KDL"\n}\n', {
          headers: { "Content-Type": "application/octet-stream" },
        });
      },
      { preconnect: realFetch.preconnect },
    );
    /* SAFETY: `./with-dom.js` registers happy-dom's GlobalRegistrator, which copies `happyDOM`
       (the DetachedWindowAPI that owns setURL) onto globalThis. An origin is what makes the
       definition's URL absolute; happy-dom's default is `about:blank`. */
    const { happyDOM } = globalThis as typeof globalThis & {
      happyDOM: { setURL: (url: string) => void };
    };
    happyDOM.setURL("http://127.0.0.1:4000/");
    try {
      setProjectState(emptyProject("kdl-project"));
      const comp = {
        path: "components/x-preview-kdl.jxn",
        source: "local",
        tagName: "x-preview-kdl",
      };
      expect(await defineComponent(comp)).toBe(true);
      expect(
        requested.some((url) => url.endsWith("/kdl-project/components/x-preview-kdl.jxn")),
      ).toBe(true);
      expect(customElements.get("x-preview-kdl")).toBeDefined();
    } finally {
      globalThis.fetch = realFetch;
      happyDOM.setURL("about:blank");
    }
  });
});
