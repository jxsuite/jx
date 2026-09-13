/**
 * Prerender-nested-components.test.ts — a component instance written inside another component's own
 * `children` expands (issue #286).
 *
 * The page walk in site-build has always expanded the instances it meets in the page tree, and the
 * slotted children it hands a component; an instance inside a DEFINITION went through
 * `renderStaticNode` as a plain element and came out as `<inner-chip></inner-chip>` — no content,
 * no host style — under a parent still stamped `data-jx-static`, so no module ever filled it. These
 * are the unit-level contracts of the fix; `site-build-nested-components.test.ts` builds the
 * issue's site end to end.
 */

import { describe, expect, test } from "bun:test";
import {
  MAX_COMPONENT_NESTING,
  buildAttrs,
  buildInitialScope,
  buildInstanceScope,
  inlineStyleDeclarations,
  liftPropsAttributes,
  preRenderComponentHtml,
  renderStaticNode,
  resolveHostStyle,
} from "../src/shared";
import type { ComponentPrerenderContext } from "../src/shared";
import type { JxElement } from "@jxsuite/schema/types";

// ── Fixtures: the issue's two components, plus the icon its Impact section describes ──

const innerChip: JxElement = {
  children: [{ tagName: "span", textContent: "[${state.label}]" }],
  state: { label: "chip" },
  tagName: "inner-chip",
};

const outerBox: JxElement = {
  children: [
    { tagName: "h2", textContent: "${state.title}" },
    { $props: { label: "NESTED" }, tagName: "inner-chip" },
    { children: [{ tagName: "slot" }], tagName: "div" },
  ],
  state: { title: "box" },
  tagName: "outer-box",
};

/** A glyph masked from a custom property — every host declaration is per instance. */
const lcbIcon: JxElement = {
  state: { name: "arrow", size: "16px" },
  style: {
    display: "inline-block",
    height: "${state.size}",
    maskImage: "${'var(--icon-' + state.name + ')'}",
  },
  tagName: "lcb-icon",
};

const lcbButton: JxElement = {
  children: [
    {
      attributes: { href: "/quote" },
      children: [
        "${state.label}",
        {
          $props: { name: "${state.icon}", size: "24px" },
          style: { marginLeft: "${state.gap}" },
          tagName: "lcb-icon",
        },
      ],
      tagName: "a",
    },
  ],
  state: { gap: "4px", icon: "arrow", label: "Go" },
  tagName: "lcb-button",
};

const lcbCard: JxElement = {
  children: [
    { tagName: "h3", textContent: "${state.title}" },
    { $props: { icon: "phone", label: "Free Quote" }, tagName: "lcb-button" },
  ],
  state: { title: "Card" },
  tagName: "lcb-card",
};

/** A component with a handler: not static, so it ships a module and re-renders on upgrade. */
const liveChip: JxElement = {
  children: [
    { onclick: { $ref: "#/state/bump" }, tagName: "button", textContent: "${state.label}" },
  ],
  state: { bump: { $prototype: "Function", body: "state.n++;" }, label: "chip", n: 0 },
  tagName: "live-chip",
};

const staticShell: JxElement = {
  children: [{ $props: { label: "inside" }, tagName: "live-chip" }],
  tagName: "static-shell",
};

const innerWrap: JxElement = {
  children: [{ children: [{ tagName: "slot" }], className: "wrap", tagName: "div" }],
  tagName: "inner-wrap",
};

function registry(...defs: JxElement[]): ComponentPrerenderContext {
  return { componentDefs: new Map(defs.map((d) => [d.tagName as string, d])) };
}

// ── Expansion ─────────────────────────────────────────────────────────────────

describe("preRenderComponentHtml — an instance inside a definition", () => {
  test("is emitted bare when the caller hands over no registry", () => {
    // The pre-#286 output, and still what a caller with no component graph gets: a definition
    // Rendered alone has nothing to expand a foreign tag from.
    const html = preRenderComponentHtml(outerBox, { title: "Outer" });
    expect(html).toContain("<inner-chip></inner-chip>");
  });

  test("expands with its $props and is stamped by its own definition", () => {
    const html = preRenderComponentHtml(outerBox, { title: "Outer" }, null, registry(innerChip));
    expect(html).toBe(
      "<h2>Outer</h2>\n" +
        "<inner-chip data-jx-static><span>[NESTED]</span></inner-chip>\n" +
        "<div><slot></slot></div>",
    );
  });

  test("resolves a $props template against the PARENT's scope", () => {
    const def: JxElement = {
      children: [{ $props: { label: "${state.title}" }, tagName: "inner-chip" }],
      state: { title: "Outer" },
      tagName: "outer-box",
    };
    expect(preRenderComponentHtml(def, null, null, registry(innerChip))).toBe(
      "<inner-chip data-jx-static><span>[Outer]</span></inner-chip>",
    );
  });

  test("resolves a $ref prop against the PARENT's scope — the §4.3 form", () => {
    const def: JxElement = {
      children: [{ $props: { label: { $ref: "#/state/title" } }, tagName: "inner-chip" }],
      state: { title: "Outer" },
      tagName: "outer-box",
    };
    expect(preRenderComponentHtml(def, null, null, registry(innerChip))).toBe(
      "<inner-chip data-jx-static><span>[Outer]</span></inner-chip>",
    );
  });

  test("lifts props.* attributes into the props and keeps them out of the markup", () => {
    const def: JxElement = {
      children: [
        { attributes: { "aria-label": "chip", "props.label": "LIFTED" }, tagName: "inner-chip" },
      ],
      tagName: "outer-box",
    };
    const html = preRenderComponentHtml(def, null, null, registry(innerChip));
    expect(html).toBe(
      '<inner-chip aria-label="chip" data-jx-static><span>[LIFTED]</span></inner-chip>',
    );
  });

  test("its own children are its slot content, rendered in the parent's scope", () => {
    const def: JxElement = {
      children: [
        {
          children: [{ tagName: "b", textContent: "${state.title}" }],
          tagName: "inner-wrap",
        },
      ],
      state: { title: "Outer" },
      tagName: "outer-box",
    };
    expect(preRenderComponentHtml(def, null, null, registry(innerWrap))).toBe(
      '<inner-wrap data-jx-static><div class="wrap"><b>Outer</b></div></inner-wrap>',
    );
  });

  test("a slot among its children passes the grandparent's slot content through", () => {
    const def: JxElement = {
      children: [{ children: [{ tagName: "slot" }], tagName: "inner-wrap" }],
      tagName: "outer-box",
    };
    expect(preRenderComponentHtml(def, null, "<p>from the page</p>", registry(innerWrap))).toBe(
      '<inner-wrap data-jx-static><div class="wrap"><p>from the page</p></div></inner-wrap>',
    );
  });

  test("a nested instance with no children leaves the definition's slot in place", () => {
    const def: JxElement = { children: [{ tagName: "inner-wrap" }], tagName: "outer-box" };
    expect(preRenderComponentHtml(def, null, null, registry(innerWrap))).toBe(
      '<inner-wrap data-jx-static><div class="wrap"><slot></slot></div></inner-wrap>',
    );
  });

  test("a component among the instance's children is a sibling frame, not a nested one", () => {
    // `outer-box` slots an `inner-chip` into `inner-wrap`: the chip is written in outer-box's
    // Tree, so it renders in outer-box's scope and expands from outer-box's path.
    const def: JxElement = {
      children: [
        {
          children: [{ $props: { label: "${state.title}" }, tagName: "inner-chip" }],
          tagName: "inner-wrap",
        },
      ],
      state: { title: "Outer" },
      tagName: "outer-box",
    };
    expect(preRenderComponentHtml(def, null, null, registry(innerChip, innerWrap))).toBe(
      '<inner-wrap data-jx-static><div class="wrap">' +
        "<inner-chip data-jx-static><span>[Outer]</span></inner-chip>" +
        "</div></inner-wrap>",
    );
  });
});

// ── Host style ────────────────────────────────────────────────────────────────

describe("preRenderComponentHtml — a nested instance's host style", () => {
  test("resolves the definition's template entries against the instance, inline", () => {
    const html = preRenderComponentHtml(lcbButton, { icon: "phone" }, null, registry(lcbIcon));
    expect(html).toBe(
      '<a href="/quote">Go\n' +
        '<lcb-icon style="margin-left: 4px; height: 24px; mask-image: var(--icon-phone)" ' +
        "data-jx-static></lcb-icon></a>",
    );
  });

  test("the instance's own template style resolves against the parent, before the host's", () => {
    const html = preRenderComponentHtml(
      lcbButton,
      { gap: "8px", icon: "phone" },
      null,
      registry(lcbIcon),
    );
    // The host declarations go last, which is the precedence the page walk gives them
    // (`{ ...node.style, ...resolvedStyle }`): a later inline declaration of a property wins.
    expect(html).toContain('style="margin-left: 8px; height: 24px; mask-image: var(--icon-phone)"');
  });

  test("a literal host declaration stays in the stylesheet, not on the element", () => {
    const html = preRenderComponentHtml(lcbButton, null, null, registry(lcbIcon));
    expect(html).not.toContain("display: inline-block");
  });

  test("a prop carrying a quote cannot end the style attribute", () => {
    /* The host style is the one attribute whose value is data a prop chose — a mask or a
       background image named per instance — and the nested path puts it in an ATTRIBUTE, where
       the page walk put it in a rule. An unescaped `"` there ended the attribute and handed the
       rest of the prop to the parser as attributes of its own. */
    const html = preRenderComponentHtml(
      lcbButton,
      { icon: 'x") onload="alert(1)' },
      null,
      registry(lcbIcon),
    );
    expect(html).toContain(
      'style="margin-left: 4px; height: 24px; ' +
        'mask-image: var(--icon-x&quot;) onload=&quot;alert(1))" data-jx-static>',
    );
    expect(html).not.toContain(' onload="');
  });

  test("a url() host style keeps its quotes as entities, which the parser decodes", () => {
    const hero: JxElement = {
      state: { src: "/a.png" },
      style: { backgroundImage: "${'url(\"' + state.src + '\")'}" },
      tagName: "hero-tile",
    };
    const wall: JxElement = {
      children: [{ $props: { src: '/b "c".png' }, tagName: "hero-tile" }],
      tagName: "hero-wall",
    };
    const html = preRenderComponentHtml(wall, null, null, registry(hero));
    expect(html).toBe(
      '<hero-tile style="background-image: url(&quot;/b &quot;c&quot;.png&quot;)" data-jx-static>' +
        "</hero-tile>",
    );
  });
});

// ── Depth, dynamism, shadow ───────────────────────────────────────────────────

describe("preRenderComponentHtml — two levels, a live child, a shadow child", () => {
  test("card → button → icon expands every level, each with its own props", () => {
    const html = preRenderComponentHtml(
      lcbCard,
      { title: "Outer" },
      null,
      registry(lcbButton, lcbIcon),
    );
    expect(html).toBe(
      "<h3>Outer</h3>\n" +
        '<lcb-button data-jx-static><a href="/quote">Free Quote\n' +
        '<lcb-icon style="margin-left: 4px; height: 24px; mask-image: var(--icon-phone)" ' +
        "data-jx-static></lcb-icon></a></lcb-button>",
    );
  });

  test("a live child inside a static parent is a prerendered shell carrying its props", () => {
    const html = preRenderComponentHtml(staticShell, null, null, registry(liveChip));
    // Not `data-jx-static`: its module re-renders it on upgrade, and compiler.md §4.4 makes the
    // Payload the first prop source, so "inside" survives that re-render.
    expect(html).toBe(
      '<live-chip data-jx-props="{&quot;label&quot;:&quot;inside&quot;}" data-jx-prerendered>' +
        "<button>inside</button></live-chip>",
    );
  });

  test("a live child with no props carries no payload", () => {
    const def: JxElement = { children: [{ tagName: "live-chip" }], tagName: "static-shell" };
    expect(preRenderComponentHtml(def, null, null, registry(liveChip))).toBe(
      "<live-chip data-jx-prerendered><button>chip</button></live-chip>",
    );
  });

  test("a shadow-mode child gets its declarative root, with the slotted children outside it", () => {
    const shadowWrap: JxElement = { ...innerWrap, $shadow: "open" };
    const def: JxElement = {
      children: [{ children: [{ tagName: "em", textContent: "light" }], tagName: "inner-wrap" }],
      tagName: "outer-box",
    };
    expect(preRenderComponentHtml(def, null, null, registry(shadowWrap))).toBe(
      "<inner-wrap data-jx-static>" +
        '<template shadowrootmode="open"><link rel="stylesheet" href="/components/inner-wrap.css">' +
        '<div class="wrap"><slot></slot></div></template>' +
        "<em>light</em></inner-wrap>",
    );
  });

  test("the project default decides shadow mode when the child does not", () => {
    const def: JxElement = { children: [{ tagName: "inner-wrap" }], tagName: "outer-box" };
    const html = preRenderComponentHtml(def, null, null, {
      ...registry(innerWrap),
      defaults: { shadow: "closed" },
    });
    expect(html).toContain('<template shadowrootmode="closed">');
  });
});

// ── Termination ───────────────────────────────────────────────────────────────

describe("preRenderComponentHtml — a definition that names itself", () => {
  const aLoop: JxElement = {
    children: [{ tagName: "p", textContent: "loop" }, { tagName: "a-loop" }],
    tagName: "a-loop",
  };

  test("is a diagnostic naming the chain, not a stack overflow", () => {
    expect(() =>
      preRenderComponentHtml(aLoop, null, null, {
        ...registry(aLoop),
        path: [{ key: "{}", tag: "a-loop" }],
      }),
    ).toThrow(/Component <a-loop> renders itself: a-loop → a-loop\./);
  });

  test("is caught through an intermediary", () => {
    const bLoop: JxElement = { children: [{ tagName: "a-loop" }], tagName: "b-loop" };
    const aViaB: JxElement = { children: [{ tagName: "b-loop" }], tagName: "a-loop" };
    expect(() =>
      preRenderComponentHtml(aViaB, null, null, {
        ...registry(aViaB, bLoop),
        path: [{ key: "{}", tag: "a-loop" }],
      }),
    ).toThrow(/renders itself: a-loop → b-loop → a-loop\./);
  });

  test("with the same props is the cycle; with props that keep changing it is the depth cap", () => {
    // `depth: "${state.depth + 1}"` is a different instance at every level, so the seen-set never
    // Matches — and nothing ever stops it. The cap is what reports that shape.
    const runaway: JxElement = {
      children: [{ $props: { depth: "${state.depth + 1}" }, tagName: "run-away" }],
      state: { depth: 0 },
      tagName: "run-away",
    };
    expect(() =>
      preRenderComponentHtml(runaway, null, null, {
        ...registry(runaway),
        path: [{ key: "{}", tag: "run-away" }],
      }),
    ).toThrow(new RegExp(`nesting exceeds ${MAX_COMPONENT_NESTING} levels: run-away → run-away`));
  });

  test("data-driven recursion that bottoms out is allowed, and renders every level", () => {
    // The shape the cap must NOT reject: a tree node that renders another one until a `$switch`
    // On its depth says stop.
    const treeNode: JxElement = {
      children: [
        {
          $switch: "${state.depth < 2}",
          cases: {
            false: { tagName: "i", textContent: "leaf ${state.depth}" },
            true: { $props: { depth: "${state.depth + 1}" }, tagName: "tree-node" },
          },
          tagName: "div",
        },
      ],
      state: { depth: 0 },
      tagName: "tree-node",
    };
    const html = preRenderComponentHtml(treeNode, null, null, {
      ...registry(treeNode),
      path: [{ key: "{}", tag: "tree-node" }],
    });
    // Static all the way down: no handler anywhere, so no payload and no module — the tree is
    // Plain HTML.
    expect(html).toBe(
      "<div><tree-node data-jx-static><div><tree-node data-jx-static>" +
        "<div><i>leaf 2</i></div></tree-node></div></tree-node></div>",
    );
  });
});

// ── renderStaticNode with a registry ─────────────────────────────────────────

describe("renderStaticNode — a registered tag", () => {
  test("expands at the top level too, in the scope it is given", () => {
    const scope = buildInitialScope({ title: "Top" });
    const node: JxElement = { $props: { label: "${state.title}" }, tagName: "inner-chip" };
    expect(renderStaticNode(node, scope, null, registry(innerChip))).toBe(
      "<inner-chip data-jx-static><span>[Top]</span></inner-chip>",
    );
  });

  test("keeps the instance's own attributes and class, resolved in the parent scope", () => {
    const scope = buildInitialScope({ kind: "hero" });
    const node: JxElement = {
      attributes: { "data-kind": "${state.kind}" },
      className: "chip ${state.kind}",
      id: "first",
      tagName: "inner-chip",
    };
    expect(renderStaticNode(node, scope, null, registry(innerChip))).toBe(
      '<inner-chip id="first" class="chip hero" data-kind="hero" data-jx-static>' +
        "<span>[chip]</span></inner-chip>",
    );
  });

  test("stays the generic element path without a registry", () => {
    expect(renderStaticNode({ tagName: "inner-chip" }, null)).toBe("<inner-chip></inner-chip>");
  });
});

// ── The shared pieces ─────────────────────────────────────────────────────────

describe("liftPropsAttributes", () => {
  test("splits props.* from the rest without touching the input", () => {
    const attributes = { "aria-label": "x", "props.label": "L", "props.n": "2" };
    const { lifted, rest } = liftPropsAttributes(attributes);
    expect(lifted).toEqual({ label: "L", n: "2" });
    expect(rest).toEqual({ "aria-label": "x" });
    expect(attributes).toEqual({ "aria-label": "x", "props.label": "L", "props.n": "2" });
  });

  test("reports no props for a bare `props.` key, and for no attributes at all", () => {
    expect(liftPropsAttributes({ "props.": "x" })).toEqual({
      lifted: null,
      rest: { "props.": "x" },
    });
    expect(liftPropsAttributes(({} as JxElement).attributes)).toEqual({ lifted: null, rest: {} });
  });
});

describe("buildInstanceScope", () => {
  test("a prop over a declared object entry replaces its default and keeps the declaration", () => {
    const scope = buildInstanceScope({ state: { n: { default: 1, type: "number" } } }, { n: 5 });
    expect(scope.n).toBe(5);
  });

  test("a prop over a bare entry, and an undeclared prop, are the value itself", () => {
    const scope = buildInstanceScope({ state: { a: "x" } }, { a: "y", extra: "z" });
    expect(scope.a).toBe("y");
    expect(scope.extra).toBe("z");
  });

  test("no props is the definition's own state", () => {
    expect(buildInstanceScope({ state: { a: "x" } }, null).a).toBe("x");
    expect(Object.keys(buildInstanceScope({}, null))).toEqual([]);
  });
});

describe("resolveHostStyle", () => {
  test("resolves only the template entries, and drops one that resolves to nothing", () => {
    const scope = buildInitialScope({ size: "24px" });
    expect(
      resolveHostStyle(
        { display: "block", height: "${state.size}", width: "${state.missing.x}" },
        scope,
      ),
    ).toEqual({ height: "24px" });
  });

  test("is empty for no style", () => {
    expect(resolveHostStyle(undefined, buildInitialScope({}))).toEqual({});
  });
});

describe("inlineStyleDeclarations and buildAttrs", () => {
  test("declarations are the template entries, kebab-cased, resolved against the scope", () => {
    const scope = buildInitialScope({ c: "red" });
    expect(
      inlineStyleDeclarations({ ":hover": { color: "blue" }, color: "${state.c}" }, scope),
    ).toBe("color: red");
    expect(inlineStyleDeclarations({ color: "${state.c}" }, null)).toBe("");
    expect(inlineStyleDeclarations(undefined, scope)).toBe("");
  });

  test("buildAttrs folds host declarations into the one style attribute, after its own", () => {
    const scope = buildInitialScope({ c: "red" });
    expect(buildAttrs({ style: { color: "${state.c}" } }, scope, "height: 24px")).toBe(
      ' style="color: red; height: 24px"',
    );
    expect(buildAttrs({}, scope, "height: 24px")).toBe(' style="height: 24px"');
    expect(buildAttrs({ style: { color: "${state.c}" } }, scope)).toBe(' style="color: red"');
  });

  test("buildAttrs escapes the style attribute like every other attribute", () => {
    const scope = buildInitialScope({ c: 'red" onload="x' });
    expect(buildAttrs({ style: { color: "${state.c}" } }, scope)).toBe(
      ' style="color: red&quot; onload=&quot;x"',
    );
    expect(buildAttrs({}, scope, 'content: "<b>"')).toBe(' style="content: &quot;&lt;b&gt;&quot;"');
  });
});
