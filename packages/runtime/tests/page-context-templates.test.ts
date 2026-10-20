import { GlobalRegistrator } from "@happy-dom/global-registrator";

import { describe, expect, test } from "bun:test";
import { renderNode } from "../src/runtime";
import type { JxScope } from "../src/types.ts";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** Render one definition and narrow the result to the element it must be. */
function renderElement(def: Parameters<typeof renderNode>[0], scope: JxScope): HTMLElement {
  const el = renderNode(def, scope);
  if (!(el instanceof HTMLElement)) {
    throw new Error("renderNode returned a Text node for an element definition");
  }
  return el;
}

/**
 * `$page` and `$site` read bare in a template, the way site-architecture.md writes them.
 *
 * The compiler's `evaluateStaticTemplate` binds both as parameters; the live runtime did not, so
 * `${$page.locale}` threw `ReferenceError: $page is not defined` on the canvas and wherever a page
 * rendered live, on a template the build prerendered without complaint.
 */
describe("page context in templates", () => {
  const scope: JxScope = {
    $page: { locale: "fr-CA", title: "Accueil" },
    $site: { name: "Atrium" },
  };

  test("text interpolates a bare $page and $site", () => {
    const el = renderElement(
      { tagName: "p", textContent: "${$page.title} · ${$site.name} (${$page.locale})" },
      scope,
    );
    expect(el.textContent).toBe("Accueil · Atrium (fr-CA)");
  });

  test("attributes and properties read the page context too", () => {
    const el = renderElement(
      {
        attributes: { lang: "${$page.locale}" },
        className: "${$site.name === 'Atrium' ? 'home' : 'away'}",
        tagName: "p",
      },
      scope,
    );
    expect(el.getAttribute("lang")).toBe("fr-CA");
    expect(el.className).toBe("home");
  });

  test("a scope without page context reads them as undefined, not as an error", () => {
    const el = renderElement({ tagName: "p", textContent: "${$page?.locale ?? 'none'}" }, {});
    expect(el.textContent).toBe("none");
  });

  test("a mapped row still sees its item beside the page context", () => {
    const el = renderElement(
      {
        children: {
          $prototype: "Array",
          items: ["a", "b"],
          map: { tagName: "li", textContent: "${item}-${index}-${$page.locale}" },
        },
        tagName: "ul",
      },
      scope,
    );
    expect([...el.children].map((li) => li.textContent)).toEqual(["a-0-fr-CA", "b-1-fr-CA"]);
  });
});
