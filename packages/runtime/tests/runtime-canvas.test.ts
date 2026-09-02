import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, test, expect, afterEach } from "bun:test";
import { reactive } from "@vue/reactivity";
import {
  applyStyle,
  Jx,
  renderNode as _renderNode,
  setCanvasAssetResolver,
  setCanvasDelinkAnchors,
  setCanvasDelinkPopovers,
  setCanvasViewportTranspose,
  resolveNestedSelector,
  setCanvasDelinkCommands,
  toCSSText,
  transposeCanvasOverlaySelector,
  transposeCanvasPopoverSelector,
  transposeCanvasUnits,
} from "../src/runtime";
import { adoptedCSS, elementCSS } from "./style-text.ts";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

const renderNode: (...args: Parameters<typeof _renderNode>) => HTMLElement = _renderNode as any;

// Every hook is GLOBAL module state. Reset every one after every test.
afterEach(() => {
  setCanvasViewportTranspose(false);
  setCanvasDelinkAnchors(false);
  setCanvasDelinkPopovers(false);
  setCanvasAssetResolver(null);
});

// ─── transposeCanvasUnits ───────────────────────────────────────────────────────

describe("transposeCanvasUnits", () => {
  test("flag off (default) returns the value unchanged", () => {
    expect(transposeCanvasUnits("100vh")).toBe("100vh");
    expect(transposeCanvasUnits("50vw")).toBe("50vw");
    expect(transposeCanvasUnits("calc(100vh - 10px)")).toBe("calc(100vh - 10px)");
  });

  test("flag on transposes every viewport unit kind", () => {
    setCanvasViewportTranspose(true);
    expect(transposeCanvasUnits("100vh")).toBe("100cqh");
    expect(transposeCanvasUnits("100vw")).toBe("100cqw");
    expect(transposeCanvasUnits("10vmin")).toBe("10cqmin");
    expect(transposeCanvasUnits("10vmax")).toBe("10cqmax");
    expect(transposeCanvasUnits("3vi")).toBe("3cqi");
    expect(transposeCanvasUnits("4vb")).toBe("4cqb");
  });

  test("flag on transposes small/large/dynamic viewport prefixes", () => {
    setCanvasViewportTranspose(true);
    expect(transposeCanvasUnits("5svh")).toBe("5cqh");
    expect(transposeCanvasUnits("5lvh")).toBe("5cqh");
    expect(transposeCanvasUnits("5dvh")).toBe("5cqh");
    expect(transposeCanvasUnits("50svw")).toBe("50cqw");
  });

  test("flag on handles decimals and negatives", () => {
    setCanvasViewportTranspose(true);
    expect(transposeCanvasUnits("-2.5dvh")).toBe("-2.5cqh");
    expect(transposeCanvasUnits("2.5vh")).toBe("2.5cqh");
    expect(transposeCanvasUnits(".5vw")).toBe(".5cqw");
    expect(transposeCanvasUnits("-10vw")).toBe("-10cqw");
  });

  test("flag on transposes multiple units within one value (calc)", () => {
    setCanvasViewportTranspose(true);
    expect(transposeCanvasUnits("calc(100vh - 10px)")).toBe("calc(100cqh - 10px)");
    expect(transposeCanvasUnits("calc(50vw + 25vh)")).toBe("calc(50cqw + 25cqh)");
  });

  test("flag on lowercases the matched dimension letter (regex i-flag)", () => {
    setCanvasViewportTranspose(true);
    // Lowercase `v` passes the guard; the i-flag matches the uppercase dim.
    expect(transposeCanvasUnits("100vH")).toBe("100cqh");
    expect(transposeCanvasUnits("50vW")).toBe("50cqw");
  });

  test("flag on: an all-uppercase 'V' is a no-op (lowercase guard)", () => {
    setCanvasViewportTranspose(true);
    // The guard fires only on lowercase "v", so all-caps is left unchanged.
    expect(transposeCanvasUnits("100VH")).toBe("100VH");
  });

  test("flag on leaves a value with no 'v' untouched (no-op fast path)", () => {
    setCanvasViewportTranspose(true);
    expect(transposeCanvasUnits("10px")).toBe("10px");
    expect(transposeCanvasUnits("red")).toBe("red");
    expect(transposeCanvasUnits("1rem")).toBe("1rem");
  });
});

// ─── setCanvasViewportTranspose toggling ─────────────────────────────────────────

describe("setCanvasViewportTranspose", () => {
  test("returns undefined", () => {
    expect(setCanvasViewportTranspose(true)).toBeUndefined();
    expect(setCanvasViewportTranspose(false)).toBeUndefined();
  });

  test("toggles the transpose behavior on and back off", () => {
    expect(transposeCanvasUnits("100vh")).toBe("100vh");
    setCanvasViewportTranspose(true);
    expect(transposeCanvasUnits("100vh")).toBe("100cqh");
    setCanvasViewportTranspose(false);
    expect(transposeCanvasUnits("100vh")).toBe("100vh");
  });
});

// ─── toCSSText transposing ───────────────────────────────────────────────────────

describe("toCSSText viewport transpose", () => {
  test("flag off leaves viewport units in serialized CSS", () => {
    expect(toCSSText({ height: "100vh", width: "50vw" })).toBe("height: 100vh; width: 50vw");
  });

  test("flag on transposes viewport units in serialized CSS", () => {
    setCanvasViewportTranspose(true);
    expect(toCSSText({ height: "100vh", width: "50vw" })).toBe("height: 100cqh; width: 50cqw");
  });

  test("flag on transposes inside calc within serialized CSS", () => {
    setCanvasViewportTranspose(true);
    expect(toCSSText({ height: "calc(100vh - 2rem)" })).toBe("height: calc(100cqh - 2rem)");
  });
});

// ─── applyStyle inline transpose ─────────────────────────────────────────────────

describe("applyStyle viewport transpose", () => {
  test("flag off keeps the raw viewport unit in the emitted rule", () => {
    const el = document.createElement("div");
    applyStyle(el, { height: "100vh" });
    expect(elementCSS(el)).toContain("height: 100vh");
  });

  test("flag on transposes a custom property value to a container-query unit", () => {
    setCanvasViewportTranspose(true);
    const el = document.createElement("div");
    applyStyle(el, { "--banner-height": "80vh" });
    expect(elementCSS(el)).toContain("--banner-height: 80cqh");
  });

  test("flag on: the standard-property value is transposed in the rule", () => {
    /* A rule keeps the `cq*` unit the inline path could not: happy-dom dropped it on assignment to
       `el.style.height`, so the assertion had to be that "vh" was gone rather than what replaced it. */
    setCanvasViewportTranspose(true);
    const el = document.createElement("div");
    applyStyle(el, { height: "100vh" });
    expect(elementCSS(el)).toContain("height: 100cqh");
  });

  test("flag off vs on diverge for the same standard-property input", () => {
    const off = document.createElement("div");
    applyStyle(off, { height: "100vh" });
    setCanvasViewportTranspose(true);
    const on = document.createElement("div");
    applyStyle(on, { height: "100vh" });
    expect(elementCSS(off)).not.toBe(elementCSS(on));
  });
});

// ─── applyStyle @keyframes ──────────────────────────────────────────────────────

describe("applyStyle @keyframes", () => {
  /** A node the studio has stamped, which is what the canvas rewrites are gated on. */
  function stamped(tag = "div"): HTMLElement {
    const el = document.createElement(tag);
    el.dataset.jxPath = '["children",0]';
    document.body.append(el);
    return el;
  }

  test("the block reaches the document sheet whole, and the element's handle is nowhere in it", () => {
    /* The Studio toast lost its entry animation here: the emitter walked the keyframes body
       carrying the element scope, so the sheet got `@keyframes toast-in { [data-jx="…"] from { … } }`
       — which a browser parses into a keyframes rule holding no keyframes at all, while the
       `animation` declaration beside it still names a live animation. */
    const el = document.createElement("div");
    document.body.append(el);
    applyStyle(el, {
      animation: "kf-toast 180ms ease-out",
      "@keyframes kf-toast": { from: { opacity: "0" }, to: { opacity: "1" } },
    });
    const adopted = adoptedCSS();
    expect(adopted).toContain("@keyframes kf-toast { from { opacity: 0 } to { opacity: 1 } }");
    // The animation and its keyframes both land, and the scope stays out of the stops.
    expect(elementCSS(el)).toContain("animation: kf-toast 180ms ease-out");
    const keyframeLine = adopted.split("\n").find((line) => line.includes("kf-toast {"));
    expect(keyframeLine).not.toContain("data-jx");
  });

  test("two elements naming one animation hoist ONE copy, released with the last of them", () => {
    // The `@font-face` path: document-global by name, refcounted by text.
    const style = { "@keyframes kf-shared": { from: { opacity: "0" } } };
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(a, b);
    applyStyle(a, style);
    applyStyle(b, style);
    const lines = adoptedCSS()
      .split("\n")
      .filter((line) => line.includes("kf-shared"));
    expect(lines.length).toBe(1);
    // Neither element carries a scoped rule set, so neither is handed a handle.
    expect(a.dataset.jx).toBeUndefined();
    expect(b.dataset.jx).toBeUndefined();
  });

  test("the canvas unit transpose reaches a stop; the overlay transpose never touches one", () => {
    /* `transposeCanvasOverlaySelector` returns null for `::backdrop`, and a keyframe selector is
       not a selector at all — handing it over would delete a stop from an otherwise sound
       animation. The value hook still has to run, or a `10vh` stop would move the artboard. */
    setCanvasViewportTranspose(true);
    setCanvasDelinkPopovers(true);
    const el = stamped();
    applyStyle(el, {
      "@keyframes kf-rise": {
        "0%": { transform: "translateY(10vh)" },
        "100%": { transform: "none" },
      },
    });
    expect(adoptedCSS()).toContain(
      "@keyframes kf-rise { 0% { transform: translateY(10cqh) } 100% { transform: none } }",
    );
  });
});

// ─── applyAttributes anchor de-link ──────────────────────────────────────────────

describe("setCanvasDelinkAnchors", () => {
  test("returns undefined", () => {
    expect(setCanvasDelinkAnchors(true)).toBeUndefined();
    expect(setCanvasDelinkAnchors(false)).toBeUndefined();
  });
});

describe("applyAttributes anchor de-link", () => {
  test("flag off: an <a href> keeps a live href", () => {
    const el = renderNode(
      { attributes: { href: "https://example.com" }, tagName: "a" } as any,
      reactive({}),
    );
    expect(el.getAttribute("href")).toBe("https://example.com");
    expect(el.dataset.jxHref).toBeUndefined();
  });

  test("flag on: an <a href> is stamped on data-jx-href, href stays null", () => {
    setCanvasDelinkAnchors(true);
    const el = renderNode(
      { attributes: { href: "https://example.com" }, tagName: "a" } as any,
      reactive({}),
    );
    expect(el.dataset.jxHref).toBe("https://example.com");
    expect(el.getAttribute("href")).toBeNull();
  });

  test("flag on: an <area href> is also de-linked", () => {
    setCanvasDelinkAnchors(true);
    const el = renderNode({ attributes: { href: "/zone" }, tagName: "area" } as any, reactive({}));
    expect(el.dataset.jxHref).toBe("/zone");
    expect(el.getAttribute("href")).toBeNull();
  });

  test("flag on: a non-anchor element keeps its href untouched", () => {
    setCanvasDelinkAnchors(true);
    // A "link" element is neither A nor AREA, so canvasAttrName leaves it alone.
    const el = renderNode(
      { attributes: { href: "/styles.css" }, tagName: "link" } as any,
      reactive({}),
    );
    expect(el.getAttribute("href")).toBe("/styles.css");
    expect(el.dataset.jxHref).toBeUndefined();
  });

  test("flag on: a non-href attribute on an anchor is untouched", () => {
    setCanvasDelinkAnchors(true);
    const el = renderNode(
      { attributes: { href: "/page", target: "_blank" } as any, tagName: "a" } as any,
      reactive({}),
    );
    // The href is de-linked, but target is a normal attribute either way.
    expect(el.getAttribute("target")).toBe("_blank");
    expect(el.dataset.jxHref).toBe("/page");
  });

  test("de-link applies to a reactive ($ref) href too", async () => {
    setCanvasDelinkAnchors(true);
    const state = reactive({ url: "/first" });
    const el = renderNode(
      { attributes: { href: { $ref: "#/state/url" } }, tagName: "a" } as any,
      state,
    );
    expect(el.dataset.jxHref).toBe("/first");
    expect(el.getAttribute("href")).toBeNull();
    state.url = "/second";
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(el.dataset.jxHref).toBe("/second");
  });
});

// ─── setCanvasAssetResolver ─────────────────────────────────────────────────

/**
 * The canvas asset resolver.
 *
 * The runtime writes a reference verbatim — `el.src = "/hero.jpg"` — so the BROWSER resolves it,
 * against whatever document the renderer happens to be running in. That is right on a site and on
 * an editing server that serves the project tree, and wrong on a multi-tenant editor origin, where
 * `/hero.jpg` misses and a single-page-app fallback answers HTML at HTTP 200: the image renders
 * broken and nothing is logged.
 *
 * A hook rather than a document rewrite because the values are produced INSIDE reactive effects. A
 * `{"$ref": "#/state/hero"}` is not a string until the effect runs, so no walk over the document
 * can see it — which is why the walk this replaces only ever fixed literal values.
 */
describe("setCanvasAssetResolver", () => {
  /** Prefix every reference, so any rewrite is visible and any missed one is too. */
  const prefixResolver = (value: string) => `/raw/${value.replace(/^\//, "")}`;

  test("a literal src is resolved", () => {
    setCanvasAssetResolver(prefixResolver);
    const el = renderNode({ src: "/hero.jpg", tagName: "img" } as never, reactive({}));
    expect(el.getAttribute("src")).toBe("/raw/hero.jpg");
  });

  /* THE case the document walk could not reach. The value does not exist as a string until the
     effect runs, so a walk over the document sees `{"$ref": …}` and rewrites nothing. */
  test("a $ref-bound src is resolved, inside the effect", async () => {
    setCanvasAssetResolver(prefixResolver);
    const state = reactive({ hero: "/hero.jpg" });
    const el = renderNode({ src: { $ref: "#/state/hero" }, tagName: "img" } as never, state);
    expect(el.getAttribute("src")).toBe("/raw/hero.jpg");
    // And again when the binding changes — the resolution is part of the effect, not a one-off.
    state.hero = "/other.jpg";
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(el.getAttribute("src")).toBe("/raw/other.jpg");
  });

  test("a templated src is resolved", () => {
    setCanvasAssetResolver(prefixResolver);
    const el = renderNode(
      { src: "${state.dir}/a.png", tagName: "img" } as never,
      reactive({ dir: "/img" }),
    );
    expect(el.getAttribute("src")).toBe("/raw/img/a.png");
  });

  test("the attributes spelling of the same reference", () => {
    setCanvasAssetResolver(prefixResolver);
    const el = renderNode(
      { attributes: { src: "/hero.jpg" }, tagName: "img" } as never,
      reactive({}),
    );
    expect(el.getAttribute("src")).toBe("/raw/hero.jpg");
  });

  test("poster too, in both spellings", () => {
    setCanvasAssetResolver(prefixResolver);
    // As a top-level key it is a DOM property; as an `attributes` entry it is an attribute.
    const asProp = renderNode({ poster: "/p.jpg", tagName: "video" } as never, reactive({}));
    expect((asProp as unknown as { poster: string }).poster).toBe("/raw/p.jpg");
    const asAttr = renderNode(
      { attributes: { poster: "/p.jpg" }, tagName: "video" } as never,
      reactive({}),
    );
    expect(asAttr.getAttribute("poster")).toBe("/raw/p.jpg");
  });

  test("every srcset candidate, descriptors preserved", () => {
    setCanvasAssetResolver(prefixResolver);
    const el = renderNode(
      { srcset: "/a.png 1x, /b.png 2x", tagName: "img" } as never,
      reactive({}),
    );
    expect(el.getAttribute("srcset")).toBe("/raw/a.png 1x, /raw/b.png 2x");
  });

  test("url() inside a style value, in the rule and the toCSSText paths", () => {
    setCanvasAssetResolver(prefixResolver);
    const el = renderNode(
      { style: { backgroundImage: "url('/bg.png')" }, tagName: "div" } as never,
      reactive({}),
    );
    expect(elementCSS(el)).toContain("background-image: url('/raw/bg.png')");
    expect(toCSSText({ maskImage: "url(/m.svg)" })).toBe("mask-image: url(/raw/m.svg)");
  });

  /* An `<a href>` is a place to go, not a file to load. Rewriting one would send a click at the
     document that backs the page instead of at the page. A `<link href>` is the opposite. */
  test("href is an asset on <link> and a destination on <a>", () => {
    setCanvasAssetResolver(prefixResolver);
    const anchor = renderNode({ href: "/about", tagName: "a" } as never, reactive({}));
    expect(anchor.getAttribute("href")).toBe("/about");
    const link = renderNode(
      { attributes: { href: "/styles/main.css", rel: "stylesheet" }, tagName: "link" } as never,
      reactive({}),
    );
    expect(link.getAttribute("href")).toBe("/raw/styles/main.css");
  });

  test("a resolver that returns null leaves the value exactly as written", () => {
    setCanvasAssetResolver(() => null);
    const el = renderNode({ src: "/hero.jpg", tagName: "img" } as never, reactive({}));
    expect(el.getAttribute("src")).toBe("/hero.jpg");
  });

  test("an empty reference is never handed to the resolver", () => {
    let calls = 0;
    setCanvasAssetResolver((value) => {
      calls += 1;
      return `/raw/${value}`;
    });
    renderNode({ src: "", tagName: "img" } as never, reactive({}));
    expect(calls).toBe(0);
  });

  /**
   * The identity guarantee. A null resolver is the default and it is what production renders with,
   * so every one of these must come out byte-identical to a build that has never heard of the
   * hook.
   */
  test("with NO resolver, every value is byte-identical", () => {
    const cases = [
      { src: "/hero.jpg", tagName: "img" },
      { srcset: "/a.png 1x, /b.png 2x", tagName: "img" },
      { attributes: { poster: "/p.jpg" }, tagName: "video" },
      { style: { backgroundImage: "url('/bg.png')" }, tagName: "div" },
      { attributes: { href: "/styles/main.css" }, tagName: "link" },
    ];
    for (const def of cases) {
      const el = renderNode(def as never, reactive({}));
      for (const [key, expected] of Object.entries(def)) {
        if (key === "tagName" || key === "style" || key === "attributes") {
          continue;
        }
        expect(el.getAttribute(key)).toBe(expected as string);
      }
    }
    const styled = renderNode(cases[3] as never, reactive({}));
    expect(elementCSS(styled)).toContain("background-image: url('/bg.png')");
    expect(toCSSText({ maskImage: "url(/m.svg)" })).toBe("mask-image: url(/m.svg)");
  });

  /* `$props` writes a JS property straight onto a custom element, bypassing `bindProperty`
     entirely — so `<x-image $props: { src }>` was the one spelling of an asset reference the hook
     did not see. A media prop the component FORWARDS into its own `<img>` is resolved separately,
     inside the component's own render, against the same context. */
  test("a $props asset key on a custom element is resolved", async () => {
    setCanvasAssetResolver(prefixResolver);
    const { defineElement } = await import("../src/runtime");
    await defineElement({
      children: [{ src: "${state.src}", tagName: "img" }],
      state: { src: { default: "" } },
      tagName: "canvas-props-img",
    } as never);
    const el = renderNode(
      { $props: { src: "/hero.jpg" }, tagName: "canvas-props-img" } as never,
      reactive({}),
    );
    expect((el as unknown as { src: string }).src).toBe("/raw/hero.jpg");
  });

  test("a non-URL attribute is never resolved, however it is written", () => {
    setCanvasAssetResolver(prefixResolver);
    const el = renderNode(
      { attributes: { alt: "/hero.jpg", "data-x": "/hero.jpg" }, tagName: "img" } as never,
      reactive({}),
    );
    expect(el.getAttribute("alt")).toBe("/hero.jpg");
    expect(el.dataset.x).toBe("/hero.jpg");
  });
});

describe("$head asset resolution", () => {
  /* `/node_modules/<pkg>` is the HOST's URL space, not the project's: the file is not in the
     repository, so there is nothing for a project resolver to resolve it to. A resolver that
     claimed the bare-specifier lane would point every packaged stylesheet at a 404. */
  test("a bare specifier stays in /node_modules and is never offered to the resolver", async () => {
    const seen: string[] = [];
    setCanvasAssetResolver((value) => {
      seen.push(value);
      return `/raw/${value.replace(/^\//, "")}`;
    });
    const target = document.createElement("div");
    await Jx(
      {
        $head: [
          { attributes: { href: "some-canvas-pkg/style.css", rel: "stylesheet" }, tagName: "link" },
          { attributes: { href: "/styles/main.css", rel: "stylesheet" }, tagName: "link" },
        ],
        tagName: "div",
      } as never,
      target,
    );
    expect(
      document.head.querySelector('link[href="/node_modules/some-canvas-pkg/style.css"]'),
    ).toBeTruthy();
    expect(document.head.querySelector('link[href="/raw/styles/main.css"]')).toBeTruthy();
    expect(seen).toEqual(["/styles/main.css"]);
  });
});

// ─── setCanvasDelinkPopovers ────────────────────────────────────────────────────

describe("setCanvasDelinkPopovers", () => {
  /** A node the studio has stamped, which is what the rewrite is gated on. */
  function stamped(tag = "nav"): HTMLElement {
    const el = document.createElement(tag);
    el.dataset.jxPath = '["children",0]';
    document.body.append(el);
    return el;
  }

  test("flag off (production and preview) leaves the attribute and the selector alone", () => {
    const el = renderNode(
      { attributes: { popover: "auto" }, tagName: "nav" } as never,
      reactive({}),
      { _path: [], onNodeCreated: (n: HTMLElement) => (n.dataset.jxPath = "[]") } as never,
    );
    expect(el.getAttribute("popover")).toBe("auto");
    const styled = stamped();
    applyStyle(styled, { ":popover-open": { display: "flex" } });
    expect(elementCSS(styled)).toContain(":popover-open");
  });

  test("flag on renames popover on a node the studio can address", () => {
    setCanvasDelinkPopovers(true);
    const el = renderNode(
      { attributes: { popover: "auto" }, tagName: "nav" } as never,
      reactive({}),
      { _path: [], onNodeCreated: (n: HTMLElement) => (n.dataset.jxPath = "[]") } as never,
    );
    expect(el.dataset.jxPopover).toBe("auto");
    expect(el.getAttribute("popover")).toBeNull();
  });

  test("an UNSTAMPED node keeps its native popover — a component's own internals", () => {
    setCanvasDelinkPopovers(true);
    const el = renderNode(
      { attributes: { popover: "auto" }, tagName: "nav" } as never,
      reactive({}),
    );
    expect(el.getAttribute("popover")).toBe("auto");
    expect(el.dataset.jxPopover).toBeUndefined();
  });

  test("onNodeCreated stamps the path BEFORE applyAttributes runs", () => {
    // The gate above rests on this ordering, and it is an unwritten contract between two packages
    // — the runtime fires the callback and the studio's stamper writes the attribute. Asserted
    // Directly so a reordering fails here rather than silently un-gating the rewrite.
    setCanvasDelinkPopovers(true);
    const seen: boolean[] = [];
    renderNode({ attributes: { popover: "auto" }, tagName: "nav" } as never, reactive({}), {
      _path: [],
      onNodeCreated: (n: HTMLElement) => {
        seen.push(n.hasAttribute("popover"));
        n.dataset.jxPath = "[]";
      },
    } as never);
    expect(seen).toEqual([false]);
  });

  test(":popover-open transposes to the attribute selector, at the same specificity", () => {
    setCanvasDelinkPopovers(true);
    const el = stamped();
    applyStyle(el, { ":popover-open": { display: "flex" }, transform: "translateX(100%)" });
    const css = elementCSS(el);
    expect(css).toContain("[data-jx-popover-open] { display: flex }");
    expect(css).not.toContain(":popover-open");
  });

  test("it transposes inside @media and through the & spelling too", () => {
    setCanvasDelinkPopovers(true);
    const el = stamped();
    applyStyle(el, {
      "&:popover-open": { opacity: "1" },
      "@(min-width: 40rem)": { ":popover-open": { gap: "1rem" } },
    });
    const css = elementCSS(el);
    expect(css).toContain("[data-jx-popover-open] { opacity: 1 }");
    expect(css).toContain("@media (min-width: 40rem)");
    expect(css).not.toContain(":popover-open");
  });

  test("::backdrop is dropped, not emitted inert", () => {
    setCanvasDelinkPopovers(true);
    const el = stamped();
    applyStyle(el, {
      "::backdrop": { backgroundColor: "black" },
      ":popover-open::backdrop": { opacity: "1" },
      ":popover-open": { display: "flex" },
    });
    const css = elementCSS(el);
    expect(css).not.toContain("backdrop");
    expect(css).toContain("[data-jx-popover-open] { display: flex }");
  });

  test("an unstamped element's styles are never transposed", () => {
    setCanvasDelinkPopovers(true);
    const el = document.createElement("nav");
    document.body.append(el);
    applyStyle(el, { ":popover-open": { display: "flex" } });
    expect(elementCSS(el)).toContain(":popover-open");
  });
});

describe("setCanvasDelinkCommands", () => {
  afterEach(() => {
    setCanvasDelinkCommands(false);
    setCanvasDelinkPopovers(false);
    document.body.replaceChildren();
  });

  function stampedRender(def: Record<string, unknown>): HTMLElement {
    return renderNode(def as never, reactive({}), {
      _path: [],
      onNodeCreated: (n: HTMLElement) => (n.dataset.jxPath = "[]"),
    } as never) as HTMLElement;
  }

  test("flag on renames commandfor, inert and a dialog's open on a stamped node", () => {
    setCanvasDelinkCommands(true);
    const button = stampedRender({
      attributes: { command: "show-modal", commandfor: "d" },
      tagName: "button",
    });
    // `command` stays: a button with a command and no target does nothing, which is the point.
    expect(button.getAttribute("command")).toBe("show-modal");
    expect(button.getAttribute("commandfor")).toBeNull();
    expect(button.dataset.jxCommandfor).toBe("d");

    const region = stampedRender({ attributes: { inert: true }, tagName: "section" });
    expect(region.hasAttribute("inert")).toBe(false);
    expect(region.dataset.jxInert).toBeDefined();

    const dialog = stampedRender({ attributes: { id: "d", open: true }, tagName: "dialog" });
    expect(dialog.hasAttribute("open")).toBe(false);
    expect(dialog.dataset.jxOpen).toBeDefined();
  });

  test("open on anything but a dialog is content, and stays", () => {
    setCanvasDelinkCommands(true);
    const details = stampedRender({ attributes: { open: true }, tagName: "details" });
    expect(details.hasAttribute("open")).toBe(true);
    expect(details.dataset.jxOpen).toBeUndefined();
  });

  test("an UNSTAMPED node keeps its native invoker — a component's own internals", () => {
    setCanvasDelinkCommands(true);
    const button = renderNode(
      { attributes: { command: "show-modal", commandfor: "d" }, tagName: "button" } as never,
      reactive({}),
    );
    expect(button.getAttribute("commandfor")).toBe("d");
    const dialog = renderNode(
      { attributes: { open: true }, tagName: "dialog" } as never,
      reactive({}),
    );
    expect(dialog.hasAttribute("open")).toBe(true);
  });

  test("flag off leaves every one of them alone", () => {
    const button = stampedRender({
      attributes: { command: "close", commandfor: "d", inert: true },
      tagName: "button",
    });
    expect(button.getAttribute("commandfor")).toBe("d");
    expect(button.hasAttribute("inert")).toBe(true);
  });

  test(":modal transposes to the dialog attribute, and [open] does so only on a dialog", () => {
    setCanvasDelinkCommands(true);
    const dialog = document.createElement("dialog");
    dialog.dataset.jxPath = '["children",0]';
    document.body.append(dialog);
    applyStyle(dialog, {
      "&[open]": { display: "grid" },
      ":modal": { border: "0" },
      "::backdrop": { background: "black" },
    });
    const dialogCss = elementCSS(dialog);
    expect(dialogCss).toContain("[data-jx-dialog-open] { display: grid }");
    expect(dialogCss).toContain("[data-jx-dialog-open] { border: 0 }");
    expect(dialogCss).not.toContain("[open]");
    expect(dialogCss).not.toContain("backdrop");

    const details = document.createElement("details");
    details.dataset.jxPath = '["children",1]';
    document.body.append(details);
    applyStyle(details, { "&[open]": { display: "grid" } });
    expect(elementCSS(details)).toContain("[open] { display: grid }");
  });

  test("[open] follows the compound it names, not the element the style hangs off", () => {
    setCanvasDelinkCommands(true);
    /* A wrapper styling the dialogs inside it. The canvas renamed those dialogs' `open`, so the
       author's rule has to be transposed even though a `<div>` owns it. */
    const wrapper = document.createElement("div");
    wrapper.dataset.jxPath = '["children",0]';
    document.body.append(wrapper);
    applyStyle(wrapper, { "& dialog[open]": { display: "grid" } });
    const wrapperCss = elementCSS(wrapper);
    expect(wrapperCss).toContain("dialog[data-jx-dialog-open] { display: grid }");
    expect(wrapperCss).not.toContain("[open] {");

    /* An accordion inside a dialog. `<details open>` keeps its attribute on the canvas, so a rule
       the owner's tag alone would have rewritten is left exactly as authored. */
    const dialog = document.createElement("dialog");
    dialog.dataset.jxPath = '["children",1]';
    document.body.append(dialog);
    applyStyle(dialog, {
      "& details[open]": { color: "red" },
      "&[open]": { display: "grid" },
    });
    const dialogCss = elementCSS(dialog);
    expect(dialogCss).toContain("details[open] { color: red }");
    expect(dialogCss).toContain("[data-jx-dialog-open] { display: grid }");
  });

  test("[inert] transposes with the attribute, so the author's rule still selects the region", () => {
    setCanvasDelinkCommands(true);
    const region = stampedRender({ attributes: { inert: true }, tagName: "section" });
    document.body.append(region);
    applyStyle(region, { "&[inert]": { opacity: "0.4" } });
    const css = elementCSS(region);
    expect(css).toContain("[data-jx-inert] { opacity: 0.4 }");
    expect(css).not.toContain("[inert] {");
    /* Text is not the point: the rule has to select the element the canvas actually rendered. */
    expect(region.matches(css.split(" {")[0]!)).toBe(true);

    /* An unstamped node — a component's own internals — keeps the native attribute, so its rule
       must keep naming it. */
    const inner = document.createElement("section");
    inner.toggleAttribute("inert", true);
    document.body.append(inner);
    applyStyle(inner, { "&[inert]": { opacity: "0.4" } });
    expect(elementCSS(inner)).toContain("[inert] { opacity: 0.4 }");
  });
});

describe("transposeCanvasOverlaySelector", () => {
  test("substitutes both pseudo-classes, drops a backdrop, and treats [open] as the dialog's only when told", () => {
    expect(transposeCanvasOverlaySelector("#a:popover-open")).toBe("#a[data-jx-popover-open]");
    expect(transposeCanvasOverlaySelector("dialog:modal")).toBe("dialog[data-jx-dialog-open]");
    expect(transposeCanvasOverlaySelector("#d[open]")).toBe("#d[open]");
    expect(transposeCanvasOverlaySelector("#d[open]", { dialog: true })).toBe(
      "#d[data-jx-dialog-open]",
    );
    expect(transposeCanvasOverlaySelector("#d:modal::backdrop", { dialog: true })).toBeNull();
  });

  test("[open] is decided by its own compound, and by the owner only when it names no type", () => {
    // A compound that names `dialog` is the dialog's open state whatever owns the rule.
    expect(transposeCanvasOverlaySelector(".x dialog[open]", { dialog: false })).toBe(
      ".x dialog[data-jx-dialog-open]",
    );
    // A compound that names anything else is content, and is left exactly as authored.
    expect(transposeCanvasOverlaySelector(".x details[open]", { dialog: true })).toBe(
      ".x details[open]",
    );
    /* A compound with NO type takes the owner's answer, both ways, which is also how the runtime's
       own scope handle is answered: it is not a parseable type name, so the scan finds none. */
    expect(transposeCanvasOverlaySelector("&[open]", { dialog: true })).toBe(
      "&[data-jx-dialog-open]",
    );
    expect(transposeCanvasOverlaySelector("&[open]", { dialog: false })).toBe("&[open]");
    expect(transposeCanvasOverlaySelector("\u0001jx-scope\u0001[open]", { dialog: true })).toBe(
      "\u0001jx-scope\u0001[data-jx-dialog-open]",
    );
    // Two compounds in one selector are answered one at a time.
    expect(transposeCanvasOverlaySelector("dialog[open] details[open]", { dialog: true })).toBe(
      "dialog[data-jx-dialog-open] details[open]",
    );
    /* A functional pseudo between the type and the attribute defeats the backscan, so the compound
       reads as typeless and takes the fallback. Written down rather than claimed away. */
    expect(transposeCanvasOverlaySelector("dialog:not(.x)[open]", { dialog: false })).toBe(
      "dialog:not(.x)[open]",
    );
  });

  test("[inert] is transposed wherever it appears, and needs no option to be", () => {
    expect(transposeCanvasOverlaySelector("#a[inert]")).toBe("#a[data-jx-inert]");
    expect(transposeCanvasOverlaySelector("#a [inert] .x")).toBe("#a [data-jx-inert] .x");
    // Already transposed, or somebody else's attribute: neither is `[inert]`.
    expect(transposeCanvasOverlaySelector("#a[data-jx-inert]")).toBe("#a[data-jx-inert]");
  });
});

describe("transposeCanvasPopoverSelector", () => {
  test("substitutes the pseudo-class and drops any backdrop rule", () => {
    expect(transposeCanvasPopoverSelector("#a:popover-open")).toBe("#a[data-jx-popover-open]");
    expect(transposeCanvasPopoverSelector("#a")).toBe("#a");
    expect(transposeCanvasPopoverSelector("#a::backdrop")).toBeNull();
    expect(transposeCanvasPopoverSelector("#a:popover-open::backdrop")).toBeNull();
  });
});

describe("resolveNestedSelector", () => {
  test("the four branches every emitter now shares", () => {
    expect(resolveNestedSelector("#a", "&.on")).toBe("#a.on");
    expect(resolveNestedSelector("#a", ":hover")).toBe("#a:hover");
    expect(resolveNestedSelector("#a", "[open]")).toBe("#a[open]");
    expect(resolveNestedSelector("#a", ".child")).toBe("#a.child");
    expect(resolveNestedSelector("#a", "> li")).toBe("#a > li");
  });

  test("a selector list on either side distributes, as CSS Nesting's implicit :is() does", () => {
    expect(resolveNestedSelector("#a, #b", ":hover")).toBe("#a:hover, #b:hover");
    expect(resolveNestedSelector("#a", "& .x, & .y")).toBe("#a .x, #a .y");
    expect(resolveNestedSelector("#a .x, #a .y", ":focus-visible")).toBe(
      "#a .x:focus-visible, #a .y:focus-visible",
    );
    expect(resolveNestedSelector("#a, #b", "& .x, .y")).toBe("#a .x, #a.y, #b .x, #b.y");
    // Every `&` in a member is the scope, not just the first.
    expect(resolveNestedSelector("#a", "& + &")).toBe("#a + #a");
  });

  test("a comma inside :is(), :not() or a quoted attribute value separates nothing", () => {
    expect(resolveNestedSelector("#a", "&:is(.x, .y)")).toBe("#a:is(.x, .y)");
    expect(resolveNestedSelector("#a", "&:not(.x, .y) .z")).toBe("#a:not(.x, .y) .z");
    expect(resolveNestedSelector("#a", '&[title="x, y"]')).toBe('#a[title="x, y"]');
    // An empty member is dropped, and whitespace around a member is not part of it.
    expect(resolveNestedSelector("#a", "& .x, , & .y ")).toBe("#a .x, #a .y");
    // A blank scope is a member of its own: nothing to distribute over, nothing dropped.
    expect(resolveNestedSelector("   ", ":hover")).toBe("   :hover");
    // An escaped quote inside a quoted value does not end the string early.
    expect(resolveNestedSelector("#a", String.raw`&[x="q\"z, w"], & .b`)).toBe(
      String.raw`#a[x="q\"z, w"], #a .b`,
    );
  });
});
