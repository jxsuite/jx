/**
 * The project's stylesheet as a live preview's root adopts it (src/browse/preview-style.ts): the
 * `project.json` block and the stylesheets `$head` links, with the page's root and body read as the
 * preview's box.
 */
import { resetStudioState } from "./harness";
import { afterEach, describe, expect, test } from "bun:test";
import {
  headStylesheetHrefs,
  hostSelector,
  loadProjectPreviewSheets,
  projectPreviewSheets,
} from "../src/browse/preview-style";
import { mountPreview } from "../src/browse/preview-root";
import type { ProjectConfig } from "@jxsuite/schema/types";

/* SAFETY: `./harness`, imported first, registers happy-dom's GlobalRegistrator, which copies the
   window's members onto globalThis, `happyDOM` (the DetachedWindowAPI that owns setURL) among them. */
const { happyDOM } = globalThis as typeof globalThis & {
  happyDOM: { setURL: (u: string) => void };
};
// Studio's own address, which a linked sheet's URL is made absolute against.
happyDOM.setURL("http://localhost:3000/packages/studio/index.html");

afterEach(() => {
  document.body.replaceChildren();
});

/** Every rule of a list of sheets, as text, at any depth of grouping. */
function cssOf(sheets: readonly CSSStyleSheet[]): string {
  return sheets.flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join("\n");
}

describe("hostSelector", () => {
  test("the page's root, html and body are the box", () => {
    expect(hostSelector(":root")).toBe(":host");
    expect(hostSelector("body")).toBe(":host");
    expect(hostSelector("html body .card")).toBe(":host .card");
    expect(hostSelector("body > main, :root h1")).toBe(":host > main, :host h1");
  });

  test("a selector naming neither is unchanged", () => {
    expect(hostSelector(".body-copy")).toBeNull();
    expect(hostSelector("tbody td")).toBeNull();
  });
});

describe("headStylesheetHrefs", () => {
  test("only linked stylesheets, in order", () => {
    expect(
      headStylesheetHrefs([
        { attributes: { href: "/favicon.svg", rel: "icon" }, tagName: "link" },
        { attributes: { href: "/css/site.css", rel: "stylesheet" }, tagName: "link" },
        { attributes: { content: "x", name: "y" }, tagName: "meta" },
        { attributes: { href: "", rel: "stylesheet" }, tagName: "link" },
        { attributes: { href: "/css/print.css", rel: "alternate stylesheet" }, tagName: "LINK" },
      ]),
    ).toEqual(["/css/site.css", "/css/print.css"]);
    expect(headStylesheetHrefs([])).toEqual([]);
  });
});

/** Answer every `fetch` with `answer` until the returned function restores the real one. */
function stubFetch(answer: (url: string) => Promise<Response>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign((input: RequestInfo | URL) => answer(String(input)), {
    preconnect: original.preconnect,
  });
  return () => {
    globalThis.fetch = original;
  };
}

describe("loadProjectPreviewSheets", () => {
  test("builds the linked sheets and the project block, re-pointed at the box", async () => {
    const restore = stubFetch((url) =>
      Promise.resolve(
        url.endsWith("missing.css")
          ? new Response("", { status: 404 })
          : new Response(":root { --ink: navy } body { color: var(--ink) } .card { margin: 0 }"),
      ),
    );
    const config: ProjectConfig = {
      $head: [
        { attributes: { href: "/css/site.css", rel: "stylesheet" }, tagName: "link" },
        { attributes: { href: "/css/missing.css", rel: "stylesheet" }, tagName: "link" },
      ],
      style: { "--brand": "#123", fontFamily: "serif" },
    };
    resetStudioState({ projectConfig: config });
    expect(projectPreviewSheets()).toEqual([]);
    const sheets = await loadProjectPreviewSheets();
    // The missing sheet is skipped; the read one and the block remain.
    expect(sheets).toHaveLength(2);
    const css = cssOf(sheets);
    expect(css).toContain(":host");
    expect(css).toContain("--brand");
    expect(css).not.toContain(":root");
    // Settled, the same sheets answer synchronously, and a second read builds nothing new.
    expect(projectPreviewSheets()).toBe(sheets);
    expect(await loadProjectPreviewSheets()).toBe(sheets);
    // And a preview's root adopts them ahead of the runtime's rules.
    const island = document.createElement("div");
    document.body.append(island);
    mountPreview(island, document.createElement("p"));
    expect(island.shadowRoot?.adoptedStyleSheets.slice(0, 2)).toEqual(sheets);
    restore();
  });

  test("a sheet that cannot be fetched is left out rather than failing the preview", async () => {
    const restore = stubFetch(() => Promise.reject(new Error("offline")));
    resetStudioState({
      projectConfig: {
        $head: [{ attributes: { href: "/a.css", rel: "stylesheet" }, tagName: "link" }],
      },
    });
    expect(await loadProjectPreviewSheets()).toEqual([]);
    restore();
  });

  test("no project, no sheets", async () => {
    resetStudioState({ projectConfig: null });
    expect(await loadProjectPreviewSheets()).toEqual([]);
    expect(projectPreviewSheets()).toEqual([]);
  });
});
