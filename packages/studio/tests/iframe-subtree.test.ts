/**
 * In-iframe subtree renderer — renders a shadow-doc node into stamped DOM with the retained render
 * context, and disposes the effect scopes + scoped style tags of removed/replaced subtrees. Covers
 * the render path (including the layout-wrapped offset) and both disposal entry points directly.
 */
import "./with-dom.js";
import { beforeAll, describe, expect, test } from "bun:test";
import { applyStyle, buildScope, renderNode } from "@jxsuite/runtime";
import { makeStamper } from "../src/canvas/iframe-render";
import { prepareForEditMode } from "../src/utils/edit-display";
import {
  disposeAllSubtrees,
  disposeSubtree,
  renderSubtreeIframe,
} from "../src/canvas/iframe-subtree";
import { newRowView } from "../src/canvas/iframe-rows";
import type { IframeRenderCtx } from "../src/canvas/iframe-render";
import type { JxMutableNode } from "@jxsuite/schema/types";

let ctx: IframeRenderCtx;
beforeAll(async () => {
  ctx = {
    defs: await buildScope({}, {}, "http://localhost/"),
    docBase: "http://localhost/",
    mapperCtx: {
      canvasMode: "design",
      layoutWrapped: false,
      pageContentOffset: null,
      pageContentPrefix: null,
    },
    hooks: {},
    mode: "design",
    rows: newRowView(),
  };
});

const docOf = (...children: (JxMutableNode | string)[]): JxMutableNode => ({
  children,
  tagName: "div",
});

/** Narrows a rendered node (or query result) to an element, failing the test when it is not one. */
function elementOf(node: Node | null): HTMLElement {
  if (!(node instanceof HTMLElement)) {
    throw new TypeError("expected the render to produce an HTMLElement");
  }
  return node;
}

describe("renderSubtreeIframe", () => {
  test("renders a node into DOM stamped with its document path, descendants included", () => {
    const doc = docOf({ children: [{ tagName: "em", textContent: "x" }], tagName: "p" });
    const el = elementOf(renderSubtreeIframe(doc, ["children", 0], ctx));
    expect(el.tagName.toLowerCase()).toBe("p");
    expect(el.dataset.jxPath).toBe('["children",0]');
    const em = elementOf(el.querySelector("em"));
    expect(em.dataset.jxPath).toBe('["children",0,"children",0]');
  });

  test("renders a bare string child as a text node", () => {
    const node = renderSubtreeIframe(docOf("just text"), ["children", 0], ctx);
    expect(node.textContent).toBe("just text");
  });

  test("throws when the path resolves to nothing", () => {
    expect(() => renderSubtreeIframe(docOf(), ["children", 5], ctx)).toThrow(
      /iframe-patch-node-not-found:children\/5/,
    );
  });

  test("re-applies the slot offset for a layout-wrapped render path", () => {
    const wrapped: IframeRenderCtx = {
      ...ctx,
      mapperCtx: {
        ...ctx.mapperCtx,
        layoutWrapped: true,
        pageContentOffset: 2,
        pageContentPrefix: ["children", 1],
      },
    };
    const doc = docOf({ tagName: "p", textContent: "x" });
    // The docPath children/0 renders at children/1/children/(0+2); the stamper maps it to children/0.
    const el = elementOf(renderSubtreeIframe(doc, ["children", 0], wrapped));
    expect(el.dataset.jxPath).toBe('["children",0]');
  });
});

describe("disposeSubtree / disposeAllSubtrees", () => {
  test("stops the subtree's scope and hands its rule set back", () => {
    const el = elementOf(
      renderSubtreeIframe(docOf({ tagName: "p", textContent: "x" }), ["children", 0], ctx),
    );
    /* The runtime's own teardown API, not a `<style>` tag this test invents. Rule sets are shared
       between elements that style alike, so only a refcounted release is safe. */
    applyStyle(el, { color: "rebeccapurple" });
    expect(el.dataset.jx).toBeTruthy();

    disposeSubtree(el);
    expect(el.dataset.jx).toBeUndefined();
  });

  test("ignores elements it never rendered (no scope, no rules)", () => {
    const plain = document.createElement("div");
    plain.append(document.createElement("span"));
    expect(() => disposeSubtree(plain)).not.toThrow();
  });

  test("disposeAllSubtrees stops every tracked scope", () => {
    renderSubtreeIframe(docOf({ tagName: "p" }), ["children", 0], ctx);
    renderSubtreeIframe(docOf({ tagName: "span" }), ["children", 0], ctx);
    expect(() => disposeAllSubtrees()).not.toThrow();
  });

  test("a node under a repeater is re-rendered with the scope and the row of the instance named", async () => {
    const defs = await buildScope(
      { state: { rows: [{ t: "Harbour" }, { t: "Crane" }] } },
      {},
      "http://localhost/",
    );
    const rowCtx: IframeRenderCtx = { ...ctx, defs, rows: newRowView() };
    const doc = docOf({
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: { children: [{ tagName: "h3", textContent: "${item.t}" }], tagName: "li" },
    });
    // The full render: the runtime draws both rows and the stamper keeps each node's row scope.
    const prepared = prepareForEditMode(structuredClone(doc));
    const onNodeCreated = makeStamper(rowCtx.mapperCtx, rowCtx.rows);
    const list = elementOf(renderNode(prepared, defs, { _path: [], onNodeCreated }));
    const headings = [...list.querySelectorAll("h3")];
    expect(headings.map((h) => h.textContent)).toEqual(["Harbour", "Crane"]);
    const second = headings[1]!;
    const scope = rowCtx.rows.scopes.get(second);
    if (!scope) {
      throw new TypeError("the stamper kept no scope for a row's node");
    }
    const path = ["children", 0, "map", "children", 0];
    const again = elementOf(renderSubtreeIframe(doc, path, rowCtx, { rows: [1], scope }));
    // Its own row's value and its own row's coordinates: an echo of the template's path.
    expect(again.textContent).toBe("Crane");
    expect(again.dataset.jxEchoPath).toBe(JSON.stringify(path));
    expect(again.dataset.jxRow).toBe("[1]");
    /* With no instance named it is drawn against the page's scope, where there is no row: the
       defect this replaces, kept visible so the argument above is known to be what decides. */
    const rowless = elementOf(renderSubtreeIframe(doc, path, rowCtx));
    expect(rowless.textContent).toBe("");
    expect(rowless.dataset.jxPath).toBe(JSON.stringify(path));
  });

  test("disposal actually stops a live binding effect (runtime-instance scope ownership)", async () => {
    // The subtree's effects are created by the runtime's copy of @vue/reactivity; a studio-instance
    // EffectScope would collect nothing and disposal would silently leak them (they'd keep firing
    // Against detached DOM and pin it in memory). A bare string node skips prepareForEditMode, so a
    // Template child keeps its live binding even under the design-mode ctx.
    const liveCtx: IframeRenderCtx = {
      ...ctx,
      defs: await buildScope({ state: { msg: "one" } }, {}, "http://localhost/"),
    };
    const node = renderSubtreeIframe(docOf("${state.msg}"), ["children", 0], liveCtx);
    expect(node.textContent).toBe("one");

    // Live before disposal: the effect tracks the reactive defs.
    liveCtx.defs["msg"] = "two";
    expect(node.textContent).toBe("two");

    // Dead after: further changes leave the detached text node untouched.
    disposeAllSubtrees();
    liveCtx.defs["msg"] = "three";
    expect(node.textContent).toBe("two");
  });
});
