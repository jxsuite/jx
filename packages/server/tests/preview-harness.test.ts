/**
 * The harness: one component or one layout, run on its own on the live preview origin.
 *
 * What is worth guarding is the boundary. An address is anyone's to write, so each test here that
 * is not about rendering is about something an address must not be able to do: name a document
 * outside the project's components and layouts, run an expression, or put its own text on the
 * page.
 */

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue, JxDocument } from "@jxsuite/schema/types";
import {
  clearLivePreviewOverlay,
  navigateLivePreview,
  setLivePreviewOverlay,
  startLivePreview,
  stopLivePreviews,
} from "../src/live-preview";
import { HARNESS_QUERY_MAX, HARNESS_ROUTE } from "@jxsuite/protocol/preview-harness";
import {
  HARNESS_KEY_PARAM,
  UNKEYED_NOTE,
  declaredProps,
  harnessNotes,
  harnessTarget,
  readHarnessProps,
  withoutHarnessKey,
} from "../src/preview-harness";

const TMP = resolve(import.meta.dir, "__test-preview-harness__");

function write(relPath: string, content: string | JsonObject) {
  const abs = resolve(TMP, relPath);
  mkdirSync(resolve(abs, ".."), { recursive: true });
  writeFileSync(abs, isString(content) ? content : JSON.stringify(content, null, 2), "utf8");
}

const CARD: JsonObject = {
  children: [{ tagName: "h2", textContent: "${state.heading}" }],
  state: {
    "#secret": "hidden",
    count: { default: 0, type: "integer" },
    heading: { type: "string" },
    href: null,
    label: "${state.heading + '!'}",
    press: { $prototype: "Function", body: "state.count += 1" },
    tags: ["a"],
    theme: { accent: "red" },
  },
  tagName: "site-card",
};

const LAYOUT: JsonObject = {
  $head: [{ attributes: { href: "/styles/main.css", rel: "stylesheet" }, tagName: "link" }],
  children: [
    { children: [{ attributes: { name: "banner" }, tagName: "slot" }], tagName: "header" },
    { children: [{ tagName: "slot" }], tagName: "main" },
    { children: [{ attributes: { name: "banner" }, tagName: "slot" }], tagName: "footer" },
    "Site chrome",
  ],
  tagName: "div",
};

beforeAll(() => {
  rmSync(TMP, { force: true, recursive: true });
  write("project.json", {
    $head: [{ attributes: { content: "Jx", name: "generator" }, tagName: "meta" }],
    name: "Harness Site",
    state: { tagline: "From the project" },
    style: { "--brand": "rebeccapurple" },
  });
  write("components/site-card.json", CARD);
  write("components/plain.json", { children: ["Not an element"], tagName: "div" });
  write("components/broken.json", "{ not json");
  write("components/nothing.json", "null");
  write("components/list.json", "[]");
  write("components/site-chip.jxn", '/- kdl-version 2\n\nsite-chip {\n    state label="Chip"\n}\n');
  /* A file outside the project, reachable only through a link inside `components/`. */
  write("../__test-preview-harness-outside__.json", { tagName: "site-outside" });
  symlinkSync(
    resolve(TMP, "../__test-preview-harness-outside__.json"),
    resolve(TMP, "components/site-outside.json"),
  );
  write("components/site-note.md", "---\ntagName: site-note\n---\nHello");
  write("layouts/base.json", LAYOUT);
  write("layouts/prose.md", "---\n---\nA layout no native parser reads");
  write("pages/index.json", { children: ["Home"], tagName: "main" });
  write("data/facts.json", { tagName: "data-facts" });
  write(".dev.vars", "SECRET=hunter2");
});

afterEach(() => {
  clearLivePreviewOverlay(TMP);
});

afterAll(() => {
  stopLivePreviews();
  rmSync(TMP, { force: true, recursive: true });
  rmSync(resolve(TMP, "../__test-preview-harness-outside__.json"), { force: true });
});

/** A harness address, as Studio writes one: no key, because Studio never holds it. */
function addressOf(path: string, props?: JsonValue | string): string {
  const query =
    props === undefined
      ? ""
      : `?props=${encodeURIComponent(isString(props) ? props : JSON.stringify(props))}`;
  return `${HARNESS_ROUTE}${path}${query}`;
}

/**
 * GET a harness address the way the opener's tab does: asked for through the origin first, which is
 * what lets the unkeyed address the opener was given be exchanged for the keyed one.
 */
async function harness(path: string, props?: JsonValue | string) {
  const { origin } = await startLivePreview(TMP);
  const address = addressOf(path, props);
  await navigateLivePreview(TMP, address);
  const response = await fetch(`${origin}${address}`);
  return { body: await response.text(), status: response.status, url: response.url };
}

/** GET a harness address nobody asked the origin for: a link somebody wrote. */
async function crafted(path: string, props: JsonValue, key?: string) {
  const { origin } = await startLivePreview(TMP);
  const suffix = key === undefined ? "" : `&${HARNESS_KEY_PARAM}=${key}`;
  const response = await fetch(`${origin}${addressOf(path, props)}${suffix}`, {
    redirect: "manual",
  });
  return { body: await response.text(), status: response.status };
}

/** This origin's harness key, read from where the opener's tab ends up. */
async function keyOf(): Promise<string> {
  const { url } = await harness("components/site-card.json", { count: 1 });
  return new URL(url).searchParams.get(HARNESS_KEY_PARAM)!;
}

/** The document the shell inlines for the runtime. */
function documentOf(html: string): JxDocument {
  const payload = html.split('id="jx-page-document">')[1]!.split("</script>")[0]!;
  /* SAFETY: the shell wrote this block from a composed `JxDocument` a moment ago. */
  return JSON.parse(payload) as JxDocument;
}

/** The harnessed instance: the host page's last child. */
function instanceOf(html: string): JsonObject {
  const { children } = documentOf(html);
  /* SAFETY: a component's host page is built with an array of element children, instance last. */
  return (children as JsonObject[]).at(-1)!;
}

/** The notes a component's host page opens with. */
function notesOf(html: string): string[] {
  /* SAFETY: as in `instanceOf`. */
  const children = documentOf(html).children as JsonObject[];
  return children.slice(0, -1).map((note) => String(note.textContent));
}

describe("what an address may name", () => {
  const paths = [
    "components/site-card.json",
    "components/ui/site-chip.jxn",
    "layouts/base.json",
    "pages/index.json",
    "data/facts.json",
    "components/${evil}.json",
  ];

  test("a component and a layout the tree lists, by kind", () => {
    expect(harnessTarget("components/site-card.json", paths)).toEqual({
      kind: "component",
      path: "components/site-card.json",
    });
    expect(harnessTarget("components/ui/site-chip.jxn", paths)).toEqual({
      kind: "component",
      path: "components/ui/site-chip.jxn",
    });
    expect(harnessTarget("layouts/base.json", paths)).toEqual({
      kind: "layout",
      path: "layouts/base.json",
    });
  });

  test("nothing the tree does not list, and nothing outside components/ and layouts/", () => {
    expect(harnessTarget("components/gone.json", paths)).toBeNull();
    expect(harnessTarget("pages/index.json", paths)).toBeNull();
    expect(harnessTarget("data/facts.json", paths)).toBeNull();
    expect(harnessTarget("project.json", paths)).toBeNull();
  });

  test("traversal is refused rather than resolved, however it is spelled", () => {
    expect(harnessTarget("components/../components/site-card.json", paths)).toBeNull();
    expect(harnessTarget("components/%2e%2e/layouts/base.json", paths)).toBeNull();
    expect(harnessTarget("components/%252e%252e/layouts/base.json", paths)).toBeNull();
    expect(harnessTarget("components/%zz", paths)).toBeNull();
    expect(harnessTarget("", paths)).toBeNull();
  });

  test("a path that would read as a template is not a target, even when a file has that name", () => {
    expect(harnessTarget("components/$%7Bevil%7D.json", paths)).toBeNull();
  });
});

describe("a component's props", () => {
  test("are its public plain-data state entries, with their declared defaults", () => {
    /* SAFETY: the fixture is a document. */
    const declared = declaredProps(CARD as JxDocument);
    expect([...declared.keys()]).toEqual(["count", "heading", "href", "tags", "theme"]);
    expect(declared.get("count")).toBe(0);
    expect(declared.get("heading")).toBeUndefined();
    expect(declared.get("href")).toBeNull();
    expect(declared.get("tags")).toEqual(["a"]);
    expect(declared.get("theme")).toEqual({ accent: "red" });
  });

  test("a document with no state declares none", () => {
    expect(declaredProps({ tagName: "x-y" }).size).toBe(0);
  });

  test("an expression, a computed and a handler entry are behavior, not props", () => {
    const behavioral: JsonObject = {
      state: {
        a: { $expression: { operator: "=", value: 1 } },
        b: { $compute: "1" },
        c: { $handler: "x" },
      },
    };
    /* SAFETY: three behavioral entry shapes in a JSON object, which is what a document is before
       anything reads it and what the function is asked to refuse. */
    expect(declaredProps(behavioral as JxDocument).size).toBe(0);
  });
});

describe("reading test values out of an address", () => {
  const declared = new Map<string, JsonValue | undefined>([
    ["heading", undefined],
    ["count", 0],
    ["tags", []],
  ]);
  const query = (value: JsonValue) => `?props=${encodeURIComponent(JSON.stringify(value))}`;

  test("no props parameter is no values and nothing to say", () => {
    expect(readHarnessProps("", declared, true)).toEqual({
      applied: {},
      refused: [],
      unread: null,
    });
  });

  test("declared names are applied; an undeclared one is dropped without a word", () => {
    const read = readHarnessProps(query({ count: 3, heading: "Hi", nope: "x" }), declared, true);
    expect(read).toEqual({ applied: { count: 3, heading: "Hi" }, refused: [], unread: null });
  });

  test("a value holding an expression anywhere is left out, by name", () => {
    const read = readHarnessProps(
      query({
        count: { $ref: "#/state/secret" },
        heading: "${fetch('//evil')}",
        tags: ["ok", { deep: "${1}" }],
      }),
      declared,
      true,
    );
    expect(read.applied).toEqual({});
    expect(read.refused).toEqual(["count", "heading", "tags"]);
  });

  test("a nested object of plain values is data", () => {
    const read = readHarnessProps(
      query({ tags: [{ label: "a", on: true, n: null }] }),
      declared,
      true,
    );
    expect(read.applied).toEqual({ tags: [{ label: "a", n: null, on: true }] });
  });

  test("a value that is not a JSON object reads as nothing, and says so", () => {
    for (const search of ["?props=%7Bnot-json", query([1, 2]), query("text"), query(null)]) {
      const read = readHarnessProps(search, declared, true);
      expect(read.applied).toEqual({});
      expect(read.unread).toContain("could not be read");
    }
  });

  test("without the key nothing is applied, and the page is told why", () => {
    const read = readHarnessProps(query({ count: 3, heading: "Hi" }), declared, false);
    expect(read).toEqual({ applied: {}, refused: [], unread: UNKEYED_NOTE });
    // No values is nothing to refuse, keyed or not.
    expect(readHarnessProps("", declared, false).unread).toBeNull();
  });

  test("the key the origin appended is not counted against the bound", () => {
    const search = query({ heading: "x".repeat(HARNESS_QUERY_MAX - 40) });
    expect(search.length).toBeLessThanOrEqual(HARNESS_QUERY_MAX);
    const keyed = `${search}&${HARNESS_KEY_PARAM}=${"a".repeat(64)}`;
    expect(keyed.length).toBeGreaterThan(HARNESS_QUERY_MAX);
    expect(withoutHarnessKey(keyed)).toBe(search);
    expect(readHarnessProps(keyed, declared, true).unread).toBeNull();
  });

  test("a query past the bound is not parsed at all", () => {
    const read = readHarnessProps(
      query({ heading: "x".repeat(HARNESS_QUERY_MAX) }),
      declared,
      true,
    );
    expect(read.applied).toEqual({});
    expect(read.unread).toContain("too large");
  });
});

describe("what the host page says", () => {
  const declared = new Map<string, JsonValue | undefined>([
    ["heading", undefined],
    ["href", null],
    ["count", 0],
  ]);

  test("nothing, when every prop has a default or a test value", () => {
    const props = { applied: { heading: "Hi", href: "/" }, refused: [], unread: null };
    expect(harnessNotes(declared, props)).toEqual([]);
  });

  test("the props with neither a default nor a test value, by name", () => {
    const notes = harnessNotes(declared, { applied: { href: "/" }, refused: [], unread: null });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("declared defaults");
    expect(notes[0]).toContain("No test value is set for: heading.");
  });

  test("what was unread and what was refused, ahead of what is missing", () => {
    const notes = harnessNotes(declared, {
      applied: {},
      refused: ["heading"],
      unread: "The test values in this address could not be read, so none were applied.",
    });
    expect(notes).toHaveLength(3);
    expect(notes[0]).toContain("could not be read");
    expect(notes[1]).toContain("plain values and not expressions: heading.");
    expect(notes[2]).toContain("heading, href");
  });
});

describe("a component on its own", () => {
  test("is a page that uses it once, with no layout, carrying the project's head and state", async () => {
    const page = await harness("components/site-card.json", { count: 4, heading: "Hello" });
    expect(page.status).toBe(200);
    const doc = documentOf(page.body);
    expect(doc.tagName).toBe("main");
    expect(doc.$elements).toEqual([{ $ref: "./components/site-card.json" }]);
    expect(instanceOf(page.body)).toEqual({
      $props: { count: 4, heading: "Hello" },
      tagName: "site-card",
    });
    // The project's own state and context, as a page would have them.
    expect(doc.state?.tagline).toBe("From the project");
    expect(doc.state?.$site).toMatchObject({ name: "Harness Site" });
    expect(doc.state?.$page).toMatchObject({ title: "site-card", url: "/__jx_live__/harness" });
    // The project's head, the site stylesheet and the reload client, exactly as on a route.
    expect(page.body).toContain('name="generator"');
    expect(page.body).toContain("<title>site-card");
    expect(page.body).toContain('href="/__jx_live__/site.css"');
    expect(page.body).toContain('src="/__jx_live__/client.js"');
    expect(page.body).toContain("setResolveToken(");
  });

  test("with no test values still opens, with its defaults and the missing props named", async () => {
    const page = await harness("components/site-card.json");
    expect(page.status).toBe(200);
    expect(instanceOf(page.body)).toEqual({ tagName: "site-card" });
    const notes = notesOf(page.body);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("No test value is set for: heading, href.");
  });

  test("a value that would run as an expression never reaches the instance", async () => {
    const page = await harness("components/site-card.json", {
      heading: "${globalThis.pwned = 1}",
      href: { $ref: "#/state/secret" },
      tags: ["fine"],
    });
    expect(instanceOf(page.body)).toEqual({ $props: { tags: ["fine"] }, tagName: "site-card" });
    expect(page.body).not.toContain("pwned");
    expect(notesOf(page.body)[0]).toContain("heading, href");
  });

  test("a value cannot close the block it travels in", async () => {
    const page = await harness("components/site-card.json", {
      heading: "</script><script>alert(1)</script>",
    });
    expect(page.body).not.toContain("<script>alert(1)");
    expect(instanceOf(page.body).$props).toEqual({
      heading: "</script><script>alert(1)</script>",
    });
  });

  test("text in an address that names no prop is nowhere on the page", async () => {
    const page = await harness("components/site-card.json", { "<img src=x>": "reflected-marker" });
    expect(page.body).not.toContain("reflected-marker");
    expect(page.body).not.toContain("<img src=x>");
  });

  test("an unsaved edit to the component is what runs", async () => {
    setLivePreviewOverlay(
      TMP,
      "components/site-card.json",
      JSON.stringify({ ...CARD, state: { heading: "Unsaved" } }),
    );
    const page = await harness("components/site-card.json");
    expect(notesOf(page.body)).toEqual([]);
  });

  test("an unsaved component the disk does not have is addressable", async () => {
    setLivePreviewOverlay(TMP, "components/new-one.json", JSON.stringify({ tagName: "new-one" }));
    const page = await harness("components/new-one.json");
    expect(page.status).toBe(200);
    expect(instanceOf(page.body)).toEqual({ tagName: "new-one" });
  });

  test("a document that defines no custom element says so", async () => {
    const page = await harness("components/plain.json");
    expect(page.status).toBe(500);
    expect(page.body).toContain("does not define a custom element");
  });

  test("a component that does not parse names the file and the reason", async () => {
    const page = await harness("components/broken.json");
    expect(page.status).toBe(500);
    expect(page.body).toContain("components/broken.json could not be read");
  });

  test("a file that holds JSON and no document is reported by name, not thrown", async () => {
    for (const path of ["components/nothing.json", "components/list.json"]) {
      const page = await harness(path);
      expect(page.status).toBe(500);
      expect(page.body).toContain(`${path} could not be read`);
    }
  });

  test("a .jxn component runs as a .json one does, and the origin serves it as JSON", async () => {
    const page = await harness("components/site-chip.jxn", { label: "New" });
    expect(page.status).toBe(200);
    expect(documentOf(page.body).$elements).toEqual([{ $ref: "./components/site-chip.jxn" }]);
    expect(instanceOf(page.body)).toEqual({ $props: { label: "New" }, tagName: "site-chip" });
    /* What the browser fetches to register it: the same address, answered as a document. */
    const { origin } = await startLivePreview(TMP);
    const file = await fetch(`${origin}/components/site-chip.jxn`);
    expect(file.headers.get("content-type")).toContain("application/json");
    expect(await file.json()).toMatchObject({ tagName: "site-chip" });
  });

  test("a component in a format a browser cannot read says which formats run", async () => {
    const page = await harness("components/site-note.md");
    expect(page.status).toBe(500);
    expect(page.body).toContain("Only .json and .jxn components run here");
  });
});

describe("test values need the origin's key", () => {
  const HOSTILE = "<img src=x onerror=alert(document.domain)>";

  test("an address somebody wrote renders the defaults, and its values are nowhere on the page", async () => {
    const page = await crafted("components/site-card.json", { count: 9, heading: HOSTILE });
    expect(page.status).toBe(200);
    expect(instanceOf(page.body)).toEqual({ tagName: "site-card" });
    expect(page.body).not.toContain("onerror");
    expect(page.body).not.toContain("alert(document.domain)");
    expect(JSON.stringify(documentOf(page.body))).not.toContain("onerror");
    expect(notesOf(page.body)[0]).toBe(UNKEYED_NOTE);
  });

  test("a wrong key is no key, whatever its length", async () => {
    const key = await keyOf();
    const flipped = `${key.slice(0, -1)}${key.endsWith("0") ? "1" : "0"}`;
    for (const wrong of [flipped, key.slice(1), `${key}0`, ""]) {
      const page = await crafted("components/site-card.json", { heading: HOSTILE }, wrong);
      expect(page.status).toBe(200);
      expect(instanceOf(page.body)).toEqual({ tagName: "site-card" });
      expect(page.body).not.toContain("onerror");
      expect(notesOf(page.body)[0]).toBe(UNKEYED_NOTE);
    }
  });

  test("the right key applies the values, on any address and on every reload", async () => {
    const key = await keyOf();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    for (const heading of ["First", "Second", "Second"]) {
      const page = await crafted("components/site-card.json", { heading }, key);
      expect(page.status).toBe(200);
      expect(instanceOf(page.body).$props).toEqual({ heading });
      expect(notesOf(page.body).join(" ")).not.toContain("not opened from Studio");
    }
  });

  test("the address the opener asked for is exchanged for the keyed one, once", async () => {
    const { origin } = await startLivePreview(TMP);
    const address = addressOf("components/site-card.json", { heading: "Asked" });
    expect(await navigateLivePreview(TMP, address)).toBe(false);
    const first = await fetch(`${origin}${address}`, { redirect: "manual" });
    expect(first.status).toBe(302);
    expect(await first.text()).toBe("");
    const location = first.headers.get("location")!;
    expect(location.startsWith(`${address}&${HARNESS_KEY_PARAM}=`)).toBe(true);
    expect(first.headers.get("cache-control")).toContain("no-store");
    // The keyed address is never a Referer to another origin: not from the redirect, not the page.
    expect(first.headers.get("referrer-policy")).toBe("same-origin");
    const page = await fetch(`${origin}${location}`);
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
    await page.text();
    // The same address again is somebody else's by now.
    const second = await fetch(`${origin}${address}`, { redirect: "manual" });
    expect(second.status).toBe(200);
    expect(instanceOf(await second.text())).toEqual({ tagName: "site-card" });
  });

  test("only the address asked for is exchanged, and asking for another retires it", async () => {
    const { origin } = await startLivePreview(TMP);
    const asked = addressOf("components/site-card.json", { heading: "Asked" });
    await navigateLivePreview(TMP, asked);
    const other = await crafted("components/site-card.json", { heading: "Other" });
    expect(other.status).toBe(200);
    expect(instanceOf(other.body)).toEqual({ tagName: "site-card" });
    // A page route, an address with no values, another origin and no address at all grant nothing.
    for (const route of [
      "/",
      addressOf("components/site-card.json"),
      "//elsewhere.test/",
      "http://[",
    ]) {
      await navigateLivePreview(TMP, asked);
      await navigateLivePreview(TMP, route);
      const response = await fetch(`${origin}${asked}`, { redirect: "manual" });
      expect(response.status).toBe(200);
      expect(instanceOf(await response.text())).toEqual({ tagName: "site-card" });
    }
  });

  test("an address asked for and not opened in time is not exchanged", async () => {
    const { origin } = await startLivePreview(TMP);
    const address = addressOf("components/site-card.json", { heading: "Late" });
    const now = Date.now();
    await navigateLivePreview(TMP, address);
    const clock = spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000);
    try {
      const late = await fetch(`${origin}${address}`, { redirect: "manual" });
      expect(late.status).toBe(200);
      expect(instanceOf(await late.text())).toEqual({ tagName: "site-card" });
    } finally {
      clock.mockRestore();
    }
  });

  test("a tab that takes the route is sent the keyed address", async () => {
    const key = await keyOf();
    const { origin } = await startLivePreview(TMP);
    const stream = await fetch(`${origin}/__jx_live__/reload`);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    const address = addressOf("components/site-card.json", { heading: "Retargeted" });
    const pending = navigateLivePreview(TMP, address);
    let sent = "";
    while (!sent.includes("event: navigate")) {
      const { value } = await reader.read();
      sent += decoder.decode(value);
    }
    /* SAFETY: the frame is this origin's own `navigate` event, whose data is `{ gen, route }`. */
    const message = JSON.parse(
      sent.split("event: navigate")[1]!.split("data: ")[1]!.split("\n")[0]!,
    ) as {
      gen: number;
      route: string;
    };
    expect(message.route).toBe(`${address}&${HARNESS_KEY_PARAM}=${key}`);
    await fetch(`${origin}/__jx_live__/ack`, {
      body: JSON.stringify({ gen: message.gen }),
      method: "POST",
    });
    expect(await pending).toBe(true);
    await reader.cancel();
    // The tab took it, so nothing is left for an unkeyed request to exchange.
    const unkeyed = await fetch(`${origin}${address}`, { redirect: "manual" });
    expect(unkeyed.status).toBe(200);
  });

  test("the key is in no page a keyless request is answered with", async () => {
    const key = await keyOf();
    const { origin } = await startLivePreview(TMP);
    const unkeyed = await crafted("components/site-card.json", { heading: "x" });
    const wrong = await crafted("components/site-card.json", { heading: "x" }, "wrong");
    const bodies = [unkeyed.body, wrong.body];
    for (const path of [
      addressOf("components/site-card.json"),
      addressOf("layouts/base.json"),
      `${HARNESS_ROUTE}components/absent.json`,
      "/",
      "/__jx_live__/client.js",
      "/__jx_live__/site.css",
      "/components/site-card.json",
    ]) {
      const response = await fetch(`${origin}${path}`);
      bodies.push(await response.text());
    }
    for (const body of bodies) {
      expect(body).not.toContain(key);
    }
    // Nor in the page the keyed address itself is answered with.
    const keyed = await crafted("components/site-card.json", { heading: "x" }, key);
    expect(keyed.body).not.toContain(key);
  });

  test("a name that merely resolves to this machine is shown neither place the key travels", async () => {
    /* DNS rebinding: a page on a name its owner points at 127.0.0.1 is same-origin with whatever
       answers there, so it reads what a cross-origin page cannot. Its `Host` is that name. */
    const key = await keyOf();
    const { origin } = await startLivePreview(TMP);
    const rebound = { Host: `rebound.test:${new URL(origin).port}` };
    const address = addressOf("components/site-card.json", { heading: "Asked" });
    await navigateLivePreview(TMP, address);
    const exchange = await fetch(`${origin}${address}`, { headers: rebound, redirect: "manual" });
    expect(exchange.status).toBe(403);
    expect(exchange.headers.get("location")).toBeNull();
    expect(await exchange.text()).not.toContain(key);
    const keyed = await fetch(`${origin}${address}&${HARNESS_KEY_PARAM}=${key}`, {
      headers: rebound,
    });
    expect(keyed.status).toBe(403);
    const stream = await fetch(`${origin}/__jx_live__/reload`, { headers: rebound });
    expect(stream.status).toBe(403);
    await stream.body?.cancel();
    // Refused, so it holds no stream a retarget could be sent down, and the grant is still unspent.
    const first = await fetch(`${origin}${address}`, { redirect: "manual" });
    expect(first.status).toBe(302);
  });

  test("one project's key opens nothing on another project's origin", async () => {
    const other = resolve(import.meta.dir, "__test-preview-harness-other__");
    rmSync(other, { force: true, recursive: true });
    mkdirSync(resolve(other, "components"), { recursive: true });
    writeFileSync(resolve(other, "project.json"), JSON.stringify({ name: "Other" }));
    writeFileSync(resolve(other, "components/site-card.json"), JSON.stringify(CARD));
    try {
      const key = await keyOf();
      const { origin } = await startLivePreview(other);
      const address = addressOf("components/site-card.json", { heading: HOSTILE });
      const response = await fetch(`${origin}${address}&${HARNESS_KEY_PARAM}=${key}`);
      const body = await response.text();
      expect(instanceOf(body)).toEqual({ tagName: "site-card" });
      expect(body).not.toContain("onerror");
      expect(notesOf(body)[0]).toBe(UNKEYED_NOTE);
    } finally {
      rmSync(other, { force: true, recursive: true });
    }
  });

  test("a component with no values needs no key", async () => {
    const { origin } = await startLivePreview(TMP);
    const response = await fetch(`${origin}${addressOf("components/site-card.json")}`);
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(notesOf(body).join(" ")).not.toContain("not opened from Studio");
  });
});

describe("a layout on its own", () => {
  test("wraps one placeholder per slot it declares", async () => {
    const page = await harness("layouts/base.json");
    expect(page.status).toBe(200);
    const doc = documentOf(page.body);
    expect(doc.tagName).toBe("div");
    const text = JSON.stringify(doc);
    expect(text).toContain("Page content goes here");
    expect(text).toContain(String.raw`Content for the \"banner\" slot goes here`);
    expect(text).toContain("Site chrome");
    expect(text).not.toContain('"tagName":"slot"');
    // The layout's head is merged and rendered, as it is for a page that uses it.
    expect(page.body).toContain('href="/styles/main.css"');
    expect(page.body).toContain("<title>layouts/base.json");
  });

  test("ignores a props parameter: a layout takes none", async () => {
    const page = await harness("layouts/base.json", { heading: "x" });
    expect(page.status).toBe(200);
    expect(JSON.stringify(documentOf(page.body))).not.toContain("$props");
  });

  test("a layout no native parser reads is reported by the composer, by name", async () => {
    const page = await harness("layouts/prose.md");
    expect(page.status).toBe(500);
    expect(page.body).toContain("layouts/prose.md");
  });
});

describe("what the route refuses", () => {
  test("a page, a data file and the project file are not harness targets", async () => {
    for (const path of ["pages/index.json", "data/facts.json", "project.json", ".dev.vars"]) {
      const page = await harness(path);
      expect(page.status).toBe(404);
      expect(page.body).toContain("names no component or layout");
      expect(page.body).not.toContain("hunter2");
    }
  });

  test("traversal out of components/ is a 404 and echoes nothing", async () => {
    const page = await harness("components/%2e%2e/%2e%2e/.dev.vars");
    expect(page.status).toBe(404);
    expect(page.body).not.toContain("hunter2");
    expect(page.body).not.toContain(".dev.vars");
  });

  test("a link out of the project is not a harness target", async () => {
    /* The tree lists files, and a link is not one, so the harness never reads through it. */
    const page = await harness("components/site-outside.json");
    expect(page.status).toBe(404);
    expect(page.body).not.toContain("site-outside");
  });

  test("only GET is answered", async () => {
    const { origin } = await startLivePreview(TMP);
    const response = await fetch(`${origin}/__jx_live__/harness/components/site-card.json`, {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});
