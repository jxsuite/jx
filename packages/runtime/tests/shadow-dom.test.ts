/**
 * Shadow-dom.test.ts — the interpreter renders `$shadow` and the realm's shadow default into a
 * shadow root, with the host translation and the stylesheet placement a build uses (spec.md
 * §16.6).
 *
 * The claims are differences between two trees, so each test reads BOTH sheets: the root's own,
 * where the definition's rules and everything it renders must land, and the document's, where the
 * usage site's rule and the document-global at-rules stay.
 *
 * Happy-dom implements no `attachInternals`, which is the standard's only way back to a closed
 * root, so the closed cases install a stand-in for it and capture the root `attachShadow` returns.
 * What they exercise is the interpreter's own branch, not a browser's closed-root semantics.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import {
  defineElement,
  documentStyleText,
  renderNode,
  reapplyStyle,
  resetDocumentStyles,
  setCanvasLightComponents,
  setShadowDefault,
} from "../src/runtime";
import { elementCSS } from "./style-text.ts";

import type { JxDocument, JxElement } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

let uid = 0;
const uniqueTag = () => `sd-test-${(uid += 1)}`;

const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 20);
  });

/** Define a component, put one instance in the document with the given light children, and wait. */
async function mountInstance(doc: JxDocument, light = ""): Promise<HTMLElement> {
  await defineElement(doc);
  const el = document.createElement(String(doc.tagName));
  el.innerHTML = light;
  document.body.append(el);
  await settle();
  return el;
}

/** An open instance's root, failing the test when it rendered into the light DOM instead. */
function rootOf(el: HTMLElement): ShadowRoot {
  if (!el.shadowRoot) {
    throw new Error(`<${el.localName}> has no open shadow root`);
  }
  return el.shadowRoot;
}

const prototype: { attachInternals?: () => { shadowRoot: ShadowRoot | null } } =
  HTMLElement.prototype;
const nativeAttachShadow = Element.prototype.attachShadow;

afterEach(() => {
  setShadowDefault(false);
  setCanvasLightComponents(false);
  delete prototype.attachInternals;
  Element.prototype.attachShadow = nativeAttachShadow;
  document.body.replaceChildren();
  resetDocumentStyles();
});

const card = (extra: JxDocument = {}): JxDocument => ({
  children: [
    { className: "inner", tagName: "p", textContent: "n=${state.n}" },
    { tagName: "slot" },
  ],
  state: { n: 1 },
  tagName: uniqueTag(),
  ...extra,
});

describe("where a component renders (spec.md §16.6)", () => {
  test("light by default: no root, and the slot is unwrapped", async () => {
    const el = await mountInstance(card(), "<span>given</span>");
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector("slot")).toBeNull();
    expect(el.querySelector("p.inner")?.textContent).toBe("n=1");
    expect(el.querySelector("span")?.textContent).toBe("given");
  });

  test("$shadow: open renders into an open root and leaves the light children for the slot", async () => {
    const el = await mountInstance(card({ $shadow: "open" }), "<span>given</span>");
    const root = rootOf(el);
    expect(root.querySelector("p.inner")?.textContent).toBe("n=1");
    expect(root.querySelector("slot")).not.toBeNull();
    // The authored child is still the host's own child, where a real slot projects it from.
    expect([...el.children].map((child) => child.localName)).toEqual(["span"]);
  });

  test("closed leaves nothing on the element", async () => {
    const roots: ShadowRoot[] = [];
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      const root = nativeAttachShadow.call(this, init);
      roots.push(root);
      return root;
    };
    prototype.attachInternals = () => ({ shadowRoot: null });
    const el = await mountInstance(card({ $shadow: "closed" }), "<span>given</span>");
    expect(el.shadowRoot).toBeNull();
    expect(roots).toHaveLength(1);
    expect(roots[0]?.mode).toBe("closed");
    expect(roots[0]?.querySelector("p.inner")?.textContent).toBe("n=1");
    expect(el.children).toHaveLength(1);
  });

  test("a closed declarative root is adopted through ElementInternals", async () => {
    const doc = card({ $shadow: "closed" });
    await defineElement(doc);
    const el = document.createElement(String(doc.tagName));
    const declared = nativeAttachShadow.call(el, { mode: "closed" });
    declared.innerHTML = "<p>stale</p>";
    prototype.attachInternals = function attachInternals(this: HTMLElement) {
      return { shadowRoot: this === el ? declared : null };
    };
    let attached = 0;
    Element.prototype.attachShadow = function attachShadow(init: ShadowRootInit) {
      attached += 1;
      return nativeAttachShadow.call(this, init);
    };
    document.body.append(el);
    await settle();
    expect(attached).toBe(0);
    expect([...declared.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["n=1"]);
  });

  test("the realm default applies, and $shadow: false opts one component out", async () => {
    setShadowDefault("open");
    const inherits = await mountInstance(card());
    const optsOut = await mountInstance(card({ $shadow: false }));
    expect(inherits.shadowRoot).not.toBeNull();
    expect(optsOut.shadowRoot).toBeNull();
  });

  test("a default that is not a mode is light DOM", async () => {
    setShadowDefault(null);
    const unset = await mountInstance(card());
    expect(unset.shadowRoot).toBeNull();
    /* A host hands over whatever a parsed project.json held, which the type cannot police. */
    const lying: "open" = JSON.parse('"yes"');
    setShadowDefault(lying);
    const invalid = await mountInstance(card());
    expect(invalid.shadowRoot).toBeNull();
  });

  test("an open root already on the element is adopted, not re-attached", async () => {
    const doc = card({ $shadow: "open" });
    await defineElement(doc);
    const el = document.createElement(String(doc.tagName));
    const declared = el.attachShadow({ mode: "open" });
    declared.innerHTML = "<p>stale</p>";
    document.body.append(el);
    await settle();
    expect(el.shadowRoot).toBe(declared);
    expect([...declared.querySelectorAll("p")].map((p) => p.textContent)).toEqual(["n=1"]);
  });

  test("root textContent is the root's content", async () => {
    const el = await mountInstance({
      $shadow: "open",
      state: { label: "hi" },
      tagName: uniqueTag(),
      textContent: "${state.label}",
    });
    expect(rootOf(el).textContent).toBe("hi");
    expect(el.textContent).toBe("");
  });

  test("with setCanvasLightComponents(true) a $shadow component renders light", async () => {
    setCanvasLightComponents(true);
    setShadowDefault("open");
    const el = await mountInstance(card({ $shadow: "closed" }), "<span>given</span>");
    expect(el.shadowRoot).toBeNull();
    expect(el.querySelector("p.inner")?.textContent).toBe("n=1");
    expect(el.querySelector("slot")).toBeNull();
  });
});

describe("where its rules are written (spec.md §16.6)", () => {
  test("the definition's style is :host rules in the root, the usage site's a rule in the page", async () => {
    const doc = card({
      $shadow: "open",
      style: { ":hover": { color: "teal" }, ":host(.wide)": { maxWidth: "none" }, color: "red" },
    });
    await defineElement(doc);
    const el = renderNode(
      { style: { margin: "4px" }, tagName: String(doc.tagName) } satisfies JxElement,
      {},
    );
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("expected an element");
    }
    document.body.append(el);
    await settle();

    const inner = documentStyleText(rootOf(el));
    expect(inner).toContain(":host { display: block; color: red }");
    expect(inner).toContain(":host(:hover) { color: teal }");
    expect(inner).toContain(":host(.wide) { max-width: none }");
    expect(inner).not.toContain("margin");

    const outer = documentStyleText(document);
    expect(outer).toContain(`[data-jx="${el.dataset.jx}"] { margin: 4px }`);
    expect(outer).not.toContain(":host");
    expect(outer).not.toContain("color: red");
  });

  test("a host with no usage-site style carries no handle", async () => {
    const el = await mountInstance(card({ $shadow: "open", style: { color: "red" } }));
    expect(el.dataset.jx).toBeUndefined();
    expect(documentStyleText(document)).toBe("");
  });

  test("a descendant, a list row and a $switch container style into the root", async () => {
    const el = await mountInstance({
      $shadow: "open",
      children: [
        { className: "plain", style: { color: "red" }, tagName: "p" },
        {
          children: {
            $prototype: "Array",
            items: { $ref: "#/state/rows" },
            map: { className: "row", style: { color: "green" }, tagName: "li" },
          },
          tagName: "ul",
        },
        {
          $switch: { $ref: "#/state/which" },
          cases: { a: { className: "case", style: { color: "blue" }, tagName: "b" } },
          className: "switch",
          style: { padding: "1px" },
          tagName: "div",
        },
      ],
      state: { rows: [1, 2], which: "a" },
      tagName: uniqueTag(),
    });
    const root = rootOf(el);
    const inner = documentStyleText(root);
    for (const selector of ["p.plain", "li.row", "div.switch", "b.case"]) {
      const node = root.querySelector<HTMLElement>(selector);
      expect({ handle: node?.dataset.jx !== undefined, selector }).toEqual({
        handle: true,
        selector,
      });
      expect(inner).toContain(`[data-jx="${node?.dataset.jx}"]`);
    }
    expect(documentStyleText(document)).toBe("");
    // The helper every style assertion uses reads the tree the element is in.
    expect(elementCSS(root.querySelector<HTMLElement>("p.plain")!)).toContain("color: red");
  });

  test("a light component inside a shadow root styles into that root", async () => {
    const badge: JxDocument = {
      children: [{ className: "dot", style: { width: "4px" }, tagName: "i" }],
      style: { color: "blue" },
      tagName: uniqueTag(),
    };
    await defineElement(badge);
    const el = await mountInstance({
      $shadow: "open",
      children: [{ style: { margin: "2px" }, tagName: String(badge.tagName) }],
      tagName: uniqueTag(),
    });
    await settle();
    const root = rootOf(el);
    const inner = documentStyleText(root);
    const nested = root.querySelector<HTMLElement>(String(badge.tagName))!;
    expect(nested.shadowRoot).toBeNull();
    // The definition and the usage site merge into one rule, as they do in a document.
    expect(inner).toContain(
      `[data-jx="${nested.dataset.jx}"] { display: block; color: blue; margin: 2px }`,
    );
    expect(inner).toContain("width: 4px");
    expect(documentStyleText(document)).toBe("");
  });

  test("a reactive declaration on each side of the boundary gets its own variable", async () => {
    const doc = card({
      $shadow: "open",
      state: { tint: "red" },
      style: { "& .inner": { color: "${state.tint}" }, color: "${state.tint}" },
    });
    await defineElement(doc);
    const el = renderNode(
      {
        style: { "& span": { color: "${'blue'}" }, color: "${'green'}" },
        tagName: String(doc.tagName),
      },
      {},
    );
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("expected an element");
    }
    document.body.append(el);
    await settle();
    const names = (el.getAttribute("style") ?? "")
      .split(";")
      .map((declaration) => declaration.split(":")[0]!.trim())
      .filter((name) => name.startsWith("--jx-"))
      .toSorted();
    // Self rules count by position under a letter per rule set; descendant rules by a serial
    // Drawn per document, so the two trees never hand the host one name twice.
    expect(names.filter((name) => !name.startsWith("--jx-r"))).toEqual(["--jx-h0", "--jx-s0"]);
    const serials = names.filter((name) => name.startsWith("--jx-r"));
    expect(serials).toHaveLength(2);
    expect(new Set(serials).size).toBe(2);
    expect(el.style.getPropertyValue("--jx-h0")).toBe("red");
    expect(el.style.getPropertyValue("--jx-s0")).toBe("green");
  });

  test("@keyframes stays in the document sheet", async () => {
    const el = await mountInstance(
      card({
        $shadow: "open",
        style: {
          "@keyframes sd-spin": { from: { opacity: "0" }, to: { opacity: "1" } },
          animationName: "sd-spin",
        },
      }),
    );
    expect(documentStyleText(document)).toContain("@keyframes sd-spin");
    const inner = documentStyleText(rootOf(el));
    expect(inner).not.toContain("@keyframes");
    expect(inner).toContain("animation-name: sd-spin");
  });

  test("a color-scheme block inside a root follows the OS preference only", async () => {
    const el = await mountInstance(
      card({
        $media: { "--dark": "(prefers-color-scheme: dark)" },
        $shadow: "open",
        style: { "@--dark": { color: "white" } },
      }),
    );
    const inner = documentStyleText(rootOf(el));
    expect(inner).toContain("@media (prefers-color-scheme: dark) { :host { color: white } }");
    expect(inner).not.toContain("data-color-scheme");
  });

  test("the <style> fallback lands inside the root", async () => {
    // A realm without constructable stylesheets: the engine appends a tag where the rules select.
    const view: { CSSStyleSheet?: typeof CSSStyleSheet } = window;
    const constructable = view.CSSStyleSheet;
    delete view.CSSStyleSheet;
    try {
      const el = await mountInstance(card({ $shadow: "open", style: { color: "red" } }));
      const tag = rootOf(el).querySelector("style[data-jx-sheet]");
      expect(tag).not.toBeNull();
      // The page's own tag, opened for the (empty) usage-site rule set, holds none of it.
      expect(document.head.querySelector("style[data-jx-sheet]")?.textContent ?? "").toBe("");
      expect(documentStyleText(rootOf(el))).toContain(":host { display: block; color: red }");
    } finally {
      if (constructable) {
        view.CSSStyleSheet = constructable;
      }
    }
  });

  test("a shadow root gets its own adopted sheet, released with the instance's scope", async () => {
    const first = await mountInstance(card({ $shadow: "open", style: { color: "red" } }));
    const second = await mountInstance(card({ $shadow: "open", style: { color: "blue" } }));
    expect(rootOf(first).adoptedStyleSheets).toHaveLength(1);
    expect(rootOf(second).adoptedStyleSheets).toHaveLength(1);
    expect(documentStyleText(rootOf(first))).toBe(":host { display: block; color: red }");
    expect(documentStyleText(rootOf(second))).toBe(":host { display: block; color: blue }");
  });
});

describe("host keys in the light DOM (spec.md §16.6)", () => {
  test("a definition's :host keys style the element itself", async () => {
    const el = await mountInstance(
      card({ style: { ":host": { display: "flex" }, ":host(.wide) .inner": { color: "red" } } }),
    );
    const handle = `[data-jx="${el.dataset.jx}"]`;
    const css = elementCSS(el);
    expect(css).toContain(`${handle} { display: flex }`);
    expect(css).toContain(`${handle}.wide .inner { color: red }`);
    expect(css).not.toContain(":host");
  });

  test("a reapply keeps a definition root's host translation", () => {
    const def = (color: string): JxElement => ({
      style: { ":host(.wide)": { color } },
      tagName: uniqueTag(),
    });
    const first = def("red");
    const el = renderNode(
      first,
      {},
      {
        onNodeCreated: (node) => {
          if (node instanceof HTMLElement) {
            node.dataset.jxDefinitionRoot = "";
          }
        },
      },
    );
    if (!(el instanceof HTMLElement)) {
      throw new TypeError("expected an element");
    }
    document.body.append(el);
    expect(elementCSS(el)).toContain(`[data-jx="${el.dataset.jx}"].wide { color: red }`);
    reapplyStyle(el, def("blue").style);
    const edited = elementCSS(el);
    expect(edited).toContain(`[data-jx="${el.dataset.jx}"].wide { color: blue }`);
    expect(edited).not.toContain(":host");
  });
});
