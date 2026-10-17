/** Gap coverage for src/utils/edit-display.ts — edit-mode display transforms. */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  computeEmptyPlaceholderClass,
  EMPTY_PLACEHOLDER_CLASSES,
  PLACEHOLDER_IMG,
  placeholderBrokenImages,
  prepareForEditMode,
  restoreTemplateExpressions,
  templateToEditDisplay,
  TRANSPARENT_PX,
} from "../src/utils/edit-display";
import { isNodeObject } from "@jxsuite/schema/guards";
import type { JxDocumentValue, JxMutableNode } from "@jxsuite/schema/types";

/**
 * Prepare a node-shaped value. The input is any document value because several fixtures are
 * deliberately malformed (a lone object as `children`, a `null` style); the output of an object
 * input is always an object, which the guard checks rather than assumes.
 */
function prep(node: JxDocumentValue): JxMutableNode {
  const out = prepareForEditMode(node);
  if (!isNodeObject(out)) {
    throw new Error("prepareForEditMode returned a non-node for a node input");
  }
  return out;
}

/** The element children of a prepared node; none of these fixtures hold text children. */
function elementChildren(node: JxMutableNode | undefined): JxMutableNode[] {
  const children = node?.children;
  if (!Array.isArray(children) || !children.every((child) => isNodeObject(child))) {
    throw new Error("expected an array of element children");
  }
  return children;
}

// ─── TRANSPARENT_PX ───────────────────────────────────────────────────────────

describe("TRANSPARENT_PX", () => {
  test("is the 1x1 transparent GIF data URI the placeholder assertions below compare against", () => {
    expect(TRANSPARENT_PX).toBe(
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
    );
  });
});

// ─── computeEmptyPlaceholderClass ─────────────────────────────────────────────

describe("computeEmptyPlaceholderClass", () => {
  test("empty text tag gets text placeholder", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "p" })).toBe("empty-text-placeholder");
  });

  test("empty container tag gets container placeholder", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "section" })).toBe(
      "empty-container-placeholder",
    );
  });

  test("returns null without tagName", () => {
    expect(computeEmptyPlaceholderClass({})).toBeNull();
  });

  test("returns null when textContent present", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "p", textContent: "hi" })).toBeNull();
  });

  test("returns null when innerHTML present", () => {
    expect(computeEmptyPlaceholderClass({ innerHTML: "<b>x</b>", tagName: "p" })).toBeNull();
  });

  test("returns null when children non-empty", () => {
    expect(
      computeEmptyPlaceholderClass({
        children: [{ tagName: "span" }],
        tagName: "div",
      }),
    ).toBeNull();
  });

  test("empty children array still counts as empty", () => {
    expect(computeEmptyPlaceholderClass({ children: [], tagName: "div" })).toBe(
      "empty-container-placeholder",
    );
  });

  test("non-text non-container tag returns null", () => {
    expect(computeEmptyPlaceholderClass({ tagName: "img" })).toBeNull();
  });

  test("layout-originated empty text tag returns null", () => {
    expect(computeEmptyPlaceholderClass({ $__layout: true, tagName: "span" })).toBeNull();
  });

  test("layout-originated empty container tag returns null", () => {
    expect(computeEmptyPlaceholderClass({ $__layout: true, tagName: "div" })).toBeNull();
  });

  test("exported placeholder class list matches the two classes", () => {
    expect([...EMPTY_PLACEHOLDER_CLASSES]).toEqual([
      "empty-text-placeholder",
      "empty-container-placeholder",
    ]);
  });
});

// ─── templateToEditDisplay / restoreTemplateExpressions ──────────────────────

describe("template display round-trip", () => {
  test("templateToEditDisplay wraps expressions in display brackets", () => {
    expect(templateToEditDisplay("Hello ${name}!")).toBe("Hello ❪ name ❫!");
  });

  test("handles multiple expressions", () => {
    expect(templateToEditDisplay("${a} and ${b}")).toBe("❪ a ❫ and ❪ b ❫");
  });

  test("leaves plain strings untouched", () => {
    expect(templateToEditDisplay("plain")).toBe("plain");
  });

  test("restoreTemplateExpressions converts display brackets back in text nodes", () => {
    const el = document.createElement("div");
    el.textContent = "Hello ❪ name ❫!";
    restoreTemplateExpressions(el);
    expect(el.textContent).toBe("Hello ${name}!");
  });

  test("restores expressions inside nested elements", () => {
    const el = document.createElement("div");
    const span = document.createElement("span");
    span.textContent = "❪ a.b ❫";
    el.append(document.createTextNode("plain "), span);
    restoreTemplateExpressions(el);
    expect(span.textContent).toBe("${a.b}");
    expect(el.textContent).toBe("plain ${a.b}");
  });
});

// ─── prepareForEditMode ───────────────────────────────────────────────────────

describe("prepareForEditMode basics", () => {
  test("returns primitives unchanged", () => {
    expect(prepareForEditMode("text")).toBe("text");
    expect(prepareForEditMode(null)).toBeNull();
  });

  test("maps arrays element-wise", () => {
    const out = prepareForEditMode([{ tagName: "p", textContent: "${x}" }]);
    expect(Array.isArray(out)).toBe(true);
    expect(out).toMatchObject([{ textContent: "❪ x ❫" }]);
  });

  test("preserves state, $media and $elements untouched", () => {
    const state = { count: { default: 1 } };
    const $media = { md: "(min-width: 768px)" };
    const $elements = { "x-c": "./x.json" };
    const out = prep({ $elements, $media, state, tagName: "div", textContent: "x" });
    expect(out.state).toBe(state);
    expect(out.$media).toBe($media);
    // The fixture's `$elements` is deliberately not the declared array form: pass-through is blind to shape.
    expect<JxDocumentValue | undefined>(out.$elements).toBe($elements);
  });

  test("converts template textContent to display form", () => {
    const out = prep({ tagName: "p", textContent: "Hi ${user}" });
    expect(out.textContent).toBe("Hi ❪ user ❫");
  });

  test("bound url properties render live, since the canvas de-links what they point at", () => {
    const a = prep({ href: "${state.url}", tagName: "a", textContent: "go" });
    expect(a.href).toBe("${state.url}");
    const form = prep({ action: "${state.ep}", tagName: "form", textContent: "f" });
    expect(form.action).toBe("${state.ep}");
  });

  test("a bound className renders live, and one that reads the repeater row shows its binding", () => {
    const div = (className: string) => prep({ children: ["x"], className, tagName: "div" });
    expect(div("${state.cls}").className).toBe("${state.cls}");
    expect(div("${item.cls}").className).toBe("❪ item.cls ❫");
  });

  test("$ref top-level value becomes display label", () => {
    const out = prep({ tagName: "p", textContent: { $ref: "#/state/title" } });
    expect(out.textContent).toBe("{title}");
  });

  test("$ref outside #/state/ keeps full path label", () => {
    const out = prep({ tagName: "p", textContent: { $ref: "#/$defs/foo" } });
    expect(out.textContent).toBe("{#/$defs/foo}");
  });
});

describe("prepareForEditMode $props", () => {
  test("processes template strings, url props, refs and passthrough values", () => {
    const out = prep({
      $props: {
        href: "${s}",
        label: "${t}",
        link: { $ref: "#/state/url" },
        other: { $ref: "raw.path" },
        plain: 5,
      },
      tagName: "x-card",
    });
    /* A component's inputs render live: a header's variant shown as `❪ state.variant ❫` reached the
       component as that literal text and matched none of its styles. */
    expect(out.$props).toEqual({
      href: "${s}",
      label: "${t}",
      link: { $ref: "#/state/url" },
      other: { $ref: "raw.path" },
      plain: 5,
    });
  });

  test("props that read the repeater row keep a display, the perimeter having no row", () => {
    const out = prep({
      $props: {
        featuredImage: "${state.x}",
        heroBg: "${item.bg}",
        href: "${item.h}",
        image: "${item.data.featuredImage}",
        row: { $ref: "$map/item/t" },
        title: "${item.t}",
      },
      tagName: "eer-category",
    });
    // Image-like keys (exact or camelCase suffix) → a data:image/svg+xml gray box, not a ❪ ❫ glyph.
    expect(out.$props?.image).toStartWith("data:image/svg+xml");
    expect(out.$props?.heroBg).toStartWith("data:image/svg+xml");
    // One that reads the page's state is live like any other.
    expect(out.$props?.featuredImage).toBe("${state.x}");
    expect(out.$props?.row).toBe("{$map/item/t}");
    // Non-image text prop → the readable ❪ expr ❫ binding glyph.
    expect(out.$props?.title).toBe("❪ item.t ❫");
    expect(out.$props?.title).toContain("❪");
    expect(out.$props?.title).toContain("❫");
    // Link target prop → inert empty string.
    expect(out.$props?.href).toBe("");
  });

  test("a static (non-template) image prop is left untouched", () => {
    const out = prep({ $props: { image: "/photo.png" }, tagName: "eer-category" });
    expect(out.$props?.image).toBe("/photo.png");
  });
});

describe("prepareForEditMode children", () => {
  test("recurses into array children", () => {
    const out = prep({
      children: [{ tagName: "p", textContent: "${a}" }],
      tagName: "div",
    });
    expect(elementChildren(out)[0]!.textContent).toBe("❪ a ❫");
  });

  test("wraps mapped-array children in a repeater perimeter", () => {
    const out = prep({
      children: {
        $prototype: "Array",
        map: { tagName: "li", textContent: "${item}" },
      },
      tagName: "ul",
    });
    expect(out.children).toHaveLength(1);
    expect(elementChildren(out)[0]!.className).toBe("repeater-perimeter");
    expect(elementChildren(out)[0]!.tagName).toBe("div");
    expect(elementChildren(elementChildren(out)[0])[0]!.textContent).toBe("❪ item ❫");
  });

  test("mapped-array children without a template still emit one (empty) perimeter", () => {
    // One DOM node per array keeps the 1:1 sibling-index correspondence the patcher relies on.
    const out = prep({
      children: { $prototype: "Array" },
      tagName: "ul",
    });
    expect(out.children).toHaveLength(1);
    expect(elementChildren(out)[0]!.className).toBe("repeater-perimeter");
    expect(elementChildren(elementChildren(out)[0])).toEqual([]);
  });

  test("array pseudo-element among siblings becomes one perimeter in place", () => {
    const out = prep({
      children: [
        { tagName: "li", textContent: "header" },
        { $prototype: "Array", map: { tagName: "li", textContent: "${item}" } },
        { tagName: "li", textContent: "footer" },
      ],
      tagName: "ul",
    });
    expect(out.children).toHaveLength(3);
    expect(elementChildren(out)[0]!.textContent).toBe("header");
    expect(elementChildren(out)[1]!.className).toBe("repeater-perimeter");
    expect(elementChildren(elementChildren(out)[1])[0]!.textContent).toBe("❪ item ❫");
    expect(elementChildren(out)[2]!.textContent).toBe("footer");
  });

  test("single object children recurse", () => {
    const out = prep({
      children: { tagName: "span", textContent: "${x}" },
      tagName: "div",
    });
    expect(out.children).toMatchObject({ textContent: "❪ x ❫" });
  });
});

describe("prepareForEditMode $switch cases", () => {
  test("renders first case inline when it is a plain node", () => {
    const out = prep({
      $switch: "${mode}",
      cases: {
        edit: { tagName: "section", textContent: "Edit" },
        view: { tagName: "p", textContent: "View" },
      },
      tagName: "div",
    });
    expect(out.$switch).toBe("❪ mode ❫");
    expect(elementChildren(out)[0]!.tagName).toBe("section");
    expect(elementChildren(out)[0]!.textContent).toBe("Edit");
    expect(out.cases).toBeUndefined();
  });

  test("renders placeholder when first case is a $ref", () => {
    const out = prep({
      $switch: "${page}",
      cases: {
        about: { $ref: "./about.json" },
        home: { $ref: "./home.json" },
      },
      tagName: "div",
    });
    expect(out.children).toHaveLength(1);
    expect(elementChildren(out)[0]!.textContent).toBe("[$switch: about | home]");
    expect(elementChildren(out)[0]!.style?.color).toBe("var(--danger)");
  });

  test("empty cases object leaves children unset", () => {
    const out = prep({ $switch: "${x}", cases: {}, tagName: "div" });
    expect(out.children).toBeUndefined();
  });
});

describe("prepareForEditMode media elements", () => {
  test("empty src gets transparent pixel and media placeholder class", () => {
    const out = prep({ src: "", tagName: "img" });
    expect(out.src).toBe(TRANSPARENT_PX);
    expect(out.className).toBe("empty-media-placeholder");
  });

  test("a bound src renders live; one that reads the repeater row gets the transparent pixel", () => {
    expect(prep({ src: "${state.url}", tagName: "video" }).src).toBe("${state.url}");
    const cover = prep({ src: { $ref: "#/state/cover" }, tagName: "img" });
    expect(cover.src).toEqual({ $ref: "#/state/cover" });
    expect(cover.className).toBeUndefined();
    const row = prep({ src: "${item.src}", tagName: "img" });
    expect(row.src).toBe(TRANSPARENT_PX);
    expect(row.className).toContain("empty-media-placeholder");
  });

  test("media element with no src at all gets placeholder class", () => {
    const out = prep({ tagName: "img" });
    expect(out.className).toBe("empty-media-placeholder");
  });

  test("media element with a real src keeps it and gets no placeholder", () => {
    const out = prep({ src: "/photo.png", tagName: "img" });
    expect(out.src).toBe("/photo.png");
    expect(out.className).toBeUndefined();
  });

  test("poster in attributes counts as resolvable media source", () => {
    const out = prep({ attributes: { poster: "/poster.jpg" }, tagName: "video" });
    expect(out.attributes?.poster).toBe("/poster.jpg");
    expect(out.className).toBeUndefined();
  });

  test("attributes: bindings render live, and row bindings show a display", () => {
    const out = prep({
      attributes: {
        alt: { $ref: "#/state/altText" },
        "data-cap": "${item.caption}",
        href: "${item.u}",
        src: "${state.url}",
      },
      tagName: "img",
    });
    expect(out.attributes?.src).toBe("${state.url}");
    expect(out.attributes?.alt).toEqual({ $ref: "#/state/altText" });
    expect(out.attributes?.["data-cap"]).toBe("❪ item.caption ❫");
    expect(out.attributes?.href).toBe("");
    expect(out.className).toBeUndefined();
    const row = prep({ attributes: { src: "${item.src}" }, tagName: "img" });
    expect(row.attributes?.src).toBe(TRANSPARENT_PX);
    expect(row.className).toContain("empty-media-placeholder");
  });

  test("a non-media element's attributes are live too, row bindings aside", () => {
    const out = prep({
      attributes: { "data-tone": "${state.tone}", "data-row": "${index}" },
      tagName: "div",
    });
    expect(out.attributes).toEqual({ "data-row": "❪ index ❫", "data-tone": "${state.tone}" });
  });

  test("attributes: empty src replaced with pixel", () => {
    const out = prep({ attributes: { src: "" }, tagName: "img" });
    expect(out.attributes?.src).toBe(TRANSPARENT_PX);
  });

  test("does not duplicate the media placeholder class", () => {
    const out = prep({ className: "empty-media-placeholder", src: "", tagName: "img" });
    expect(out.className).toBe("empty-media-placeholder");
  });
});

describe("prepareForEditMode style handling", () => {
  test("bound style declarations are live; only one that reads the repeater row is dropped", () => {
    /* Dropped, not blanked to `""`: `width: ` is a malformed declaration in a rule, and omitting it
       lets the cascade answer. */
    const out = prep({
      style: { color: "red", height: "${item.h}px", width: "${state.w}px" },
      tagName: "div",
      textContent: "x",
    });
    expect(out.style).toEqual({ color: "red", width: "${state.w}px" });
  });

  test("non-object style passes through", () => {
    const out = prep({ style: null, tagName: "div", textContent: "x" });
    expect(out.style).toBeNull();
  });
});

describe("prepareForEditMode empty placeholders", () => {
  test("empty text tag gains placeholder class merged with existing className", () => {
    const out = prep({ className: "lead", tagName: "p" });
    expect(out.className).toBe("lead empty-text-placeholder");
  });

  test("empty container without className gets bare placeholder class", () => {
    const out = prep({ tagName: "section" });
    expect(out.className).toBe("empty-container-placeholder");
  });

  test("layout-marked empty elements get no placeholder class", () => {
    // Regression: decorative hamburger-bar spans in a page's layout shell rendered
    // Overlapping "Click here to add text..." placeholders.
    const out = prep({
      $__layout: true,
      children: [
        { $__layout: true, style: { height: "3px" }, tagName: "span" },
        { $__layout: true, style: { height: "3px" }, tagName: "span" },
        { $__layout: true, style: { height: "3px" }, tagName: "span" },
      ],
      tagName: "button",
    });
    for (const bar of elementChildren(out)) {
      expect(bar.className).toBeUndefined();
      expect(bar.$__layout).toBe(true);
    }
  });

  test("identical non-layout empty span still gets text placeholder", () => {
    const out = prep({ style: { height: "3px" }, tagName: "span" });
    expect(out.className).toBe("empty-text-placeholder");
  });
});

// ─── placeholderBrokenImages ──────────────────────────────────────────────────

describe("placeholderBrokenImages", () => {
  test("a nested image that fails to load becomes the placeholder, until the signal aborts", () => {
    const host = document.createElement("div");
    const card = document.createElement("section");
    const img = document.createElement("img");
    img.setAttribute("src", "/missing.jpg");
    img.setAttribute("srcset", "/missing-2x.jpg 2x");
    card.append(img);
    host.append(card);
    const listening = new AbortController();
    placeholderBrokenImages(host, listening.signal);

    // `error` does not bubble; the capture listener on the host still sees it.
    img.dispatchEvent(new Event("error"));
    expect(img.getAttribute("src")).toBe(PLACEHOLDER_IMG);
    expect(img.hasAttribute("srcset")).toBe(false);
    expect(img.dataset.placeholder).toBe("");

    const later = document.createElement("img");
    later.setAttribute("src", "/also-missing.jpg");
    host.append(later);
    listening.abort();
    later.dispatchEvent(new Event("error"));
    expect(later.getAttribute("src")).toBe("/also-missing.jpg");
  });

  test("errors from anything but an image are ignored", () => {
    const host = document.createElement("div");
    const video = document.createElement("video");
    video.setAttribute("src", "/missing.mp4");
    host.append(video);
    placeholderBrokenImages(host, new AbortController().signal);
    video.dispatchEvent(new Event("error"));
    expect(video.getAttribute("src")).toBe("/missing.mp4");
  });
});
