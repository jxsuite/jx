/**
 * Site-build-instance-props.test.ts — what a component instance written on a built page receives
 * (compiler.md §8.1, §9.1).
 *
 * A prop the build can settle is resolved into the prerender and the `data-jx-props` payload. A
 * prop that reads state a handler writes (or `window#/`) stays on the instance, and the page's
 * module writes it onto the element as a property.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSite } from "../src/site/site-build";
import type { JsonValue } from "@jxsuite/schema/types";

/** @param {string} root @param {string} path @param {JsonValue} obj */
function writeJSON(root: string, path: string, obj: JsonValue) {
  const full = resolve(root, path);
  mkdirSync(resolve(full, ".."), { recursive: true });
  writeFileSync(full, JSON.stringify(obj, null, 2), "utf8");
}

describe("buildSite — an instance's $props on a page", () => {
  const TMP = resolve(import.meta.dir, "__test-instance-props__");
  const read = (path: string) => readFileSync(resolve(TMP, "dist", path), "utf8");

  beforeAll(async () => {
    rmSync(TMP, { force: true, recursive: true });
    writeJSON(TMP, "project.json", { build: { outDir: "./dist" }, name: "Instance props" });
    // A fully static component: it reads its props and has no handler of its own.
    writeJSON(TMP, "components/my-count.json", {
      children: [{ tagName: "p", textContent: "${state.count}|${state.fixed}" }],
      state: { count: { default: 0 }, fixed: { default: 0 } },
      tagName: "my-count",
    });
    writeJSON(TMP, "components/my-note.json", {
      children: [{ tagName: "p", textContent: "${state.note}" }],
      state: { note: { default: "" } },
      tagName: "my-note",
    });
    // A component with a handler, so its instances keep a payload.
    writeJSON(TMP, "components/my-live.json", {
      children: [
        {
          onclick: { $ref: "#/state/bump" },
          tagName: "p",
          textContent: "${state.count}|${state.note}",
        },
      ],
      state: {
        bump: { $prototype: "Function", body: "state.count++" },
        count: { default: 0 },
        note: { default: "" },
      },
      tagName: "my-live",
    });
    writeJSON(TMP, "pages/index.json", {
      children: [
        { onclick: { $ref: "#/state/inc" }, tagName: "button", textContent: "inc" },
        {
          $props: { count: { $ref: "#/state/n" }, fixed: { $ref: "#/state/k" } },
          attributes: { id: "live" },
          tagName: "my-count",
        },
        {
          $props: { fixed: { $ref: "#/state/k" } },
          attributes: { id: "settled" },
          tagName: "my-note",
        },
        {
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { $props: { count: { $ref: "$map/item/v" } }, tagName: "my-live" },
          },
          tagName: "div",
        },
        {
          $props: { note: { $ref: "#/state/doc/text" } },
          attributes: { id: "doc" },
          tagName: "my-live",
        },
      ],
      state: {
        doc: { default: { text: "use ${x}" } },
        inc: { $prototype: "Function", body: "state.n++" },
        k: 5,
        n: 1,
        rows: { default: [{ v: 7 }] },
      },
      title: "Home",
    });
    writeJSON(TMP, "pages/constant.json", {
      children: [{ $props: { fixed: { $ref: "#/state/k" } }, tagName: "my-count" }],
      state: { k: 5 },
      title: "Constant",
    });
    writeJSON(TMP, "pages/directive.json", {
      children: [
        {
          $props: { "#note": { $ref: "#/state/k" }, fixed: { $ref: "#/state/k" } },
          tagName: "my-count",
        },
      ],
      state: { k: 5 },
      title: "Directive",
    });
    writeJSON(TMP, "pages/stateless.json", {
      children: [{ $props: { count: { $ref: "window#/innerWidth" } }, tagName: "my-count" }],
      title: "Stateless",
    });
    await buildSite(TMP, { verbose: false });
  });

  afterAll(() => {
    rmSync(TMP, { force: true, recursive: true });
  });

  /** Every `data-jx-props` payload on the page, decoded. */
  const payloads = (html: string): JsonValue[] =>
    [...html.matchAll(/data-jx-props="([^"]*)"/g)].map((m) =>
      JSON.parse(
        m[1]!
          .replaceAll("&quot;", '"')
          .replaceAll("&amp;", "&")
          .replaceAll("&lt;", "<")
          .replaceAll("&gt;", ">"),
      ),
    );

  it("a $ref to a constant is settled into the prerender and the payload", () => {
    const html = read("index.html");
    expect(payloads(html)).toContainEqual({ fixed: 5 });
    expect(html).toContain("<p>0|5</p>");
  });

  it("a row's $map ref is settled against its row", () => {
    expect(payloads(read("index.html"))).toContainEqual({ count: 7 });
  });

  it("no payload carries an unresolved $ref", () => {
    const html = read("index.html");
    expect(html).not.toContain("&quot;$ref&quot;");
    for (const payload of payloads(html)) {
      expect(JSON.stringify(payload)).not.toContain("$ref");
    }
  });

  it("a prop bound to written state is delivered by the page module", () => {
    const html = read("index.html");
    expect(html).toMatch(/<my-count[^>]*:prop\._p0="count"/);
    expect(html).not.toMatch(/<my-count[^>]*data-jx-static/);
    expect(read("app.js")).toContain("() => state.n");
  });

  it("an instance with a live prop loads its module though its component is static", () => {
    const html = read("index.html");
    expect(html).toMatch(/<my-count[^>]*data-jx-prerendered/);
    expect(html).toContain("/components/my-count.js");
  });

  it("a static component with constant props still ships no module", () => {
    const html = read("constant/index.html");
    expect(html).toContain("data-jx-static");
    expect(html).not.toContain("my-count.js");
  });

  it("a stateless page whose only live prop reads window still gets a page module", () => {
    const html = read("stateless/index.html");
    expect(html).toContain(':prop._p0="count"');
    expect(html).toContain("/components/my-count.js");
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+\.js)"/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(1);
    expect(read("stateless/app.js")).toContain("() => window.innerWidth");
  });

  it("a payload is never read as a template", () => {
    const html = read("index.html");
    expect(html).not.toContain(":attr.data-jx-props");
    expect(payloads(html)).toContainEqual({ note: "use ${x}" });
    expect(html).toContain(String.raw`\u0024{x}`);
  });

  it("a #-prefixed $props key is a directive, neither a prop nor a payload entry", () => {
    const html = read("directive/index.html");
    expect(html).toContain("<p>0|5</p>");
    expect(html).not.toContain("#note");
    expect(html).not.toContain("note&quot;");
  });
});
