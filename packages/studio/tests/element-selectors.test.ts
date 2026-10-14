import "./with-dom.js";
import { describe, expect, test } from "bun:test";

import { COMMON_SELECTORS } from "../src/store";
import { selectorsForNode } from "../src/utils/element-selectors";
import type { JsonObject, JxMutableNode } from "@jxsuite/schema/types";

/** The selectors an element gains beyond the global set. */
function extras(node: JxMutableNode): string[] {
  return selectorsForNode(node).filter((s) => !COMMON_SELECTORS.includes(s));
}

/**
 * A node read straight off disk, before any schema validation: well-formed JSON whose members may
 * break the `JxMutableNode` contract, which is exactly the input these robustness cases feed.
 */
function unvalidated(json: JsonObject): JxMutableNode {
  /* SAFETY: callers pass deliberately schema-violating fixtures (a numeric tag, a non-tag
     expression); the assertion is the point of the test, not an oversight. */
  return json as JxMutableNode;
}

describe("selectorsForNode", () => {
  test("the common set always comes first, and in its own order", () => {
    const out = selectorsForNode({ tagName: "p" });
    expect(out.slice(0, COMMON_SELECTORS.length)).toEqual([...COMMON_SELECTORS]);
  });

  test("an ordinary element gains nothing — a menu of unmatchable states is a menu nobody reads", () => {
    expect(extras({ tagName: "p" })).toEqual([]);
    expect(extras({ tagName: "div" })).toEqual([]);
  });

  test("a popover gains its three states, whichever spelling declared it", () => {
    for (const popover of ["auto", "", "manual"]) {
      expect(extras({ attributes: { popover }, tagName: "nav" })).toEqual([
        ":popover-open",
        "::backdrop",
        ":popover-open::backdrop",
      ]);
    }
  });

  test("<dialog>, <details>, form fields and <a> each gain their own", () => {
    expect(extras({ tagName: "dialog" })).toEqual(["[open]", ":modal", "::backdrop"]);
    expect(extras({ tagName: "details" })).toEqual(["[open]"]);
    expect(extras({ tagName: "input" })).toEqual([
      ":checked",
      ":invalid",
      ":required",
      ":user-invalid",
    ]);
    expect(extras({ tagName: "a" })).toEqual([":visited", ":target"]);
  });

  test("a popover <dialog> gets both sets, deduped", () => {
    const out = extras({ attributes: { popover: "auto" }, tagName: "dialog" });
    expect(out.filter((s) => s === "::backdrop")).toHaveLength(1);
    expect(out).toContain(":popover-open");
    expect(out).toContain(":modal");
  });

  test("the tag is read case-insensitively, and through a tag expression", () => {
    expect(extras({ tagName: "DETAILS" })).toEqual(["[open]"]);
    /* A WHOLE `TagExpression` — `operator`, `target`, `cases` and the `default` an element with no
       tag cannot do without. The shorthand this used to pass was accepted only because the guard
       looked no further than "is `$expression` an object", which is the same unsoundness that let a
       formula reach tag position and threw `Cannot convert undefined or null to object` out of four
       projections at once. */
    const chosen = {
      tagName: {
        $expression: {
          cases: { a: "a" },
          default: "a",
          operator: "switch",
          target: { $ref: "#/state/kind" },
        },
      },
    } satisfies JxMutableNode;
    expect(extras(chosen)).toEqual([":visited", ":target"]);
    // An expression that is not a tag choice names no tag, so it earns no tag-specific selector.
    expect(
      extras(
        unvalidated({
          tagName: { $expression: { operator: "toUpperCase", target: { $ref: "#/state/t" } } },
        }),
      ),
    ).toEqual([]);
  });

  test("no node at all still answers the common set", () => {
    expect(selectorsForNode(null)).toEqual([...COMMON_SELECTORS]);
    // A document on disk can carry a tag the schema forbids; the menu must survive reading one.
    expect(selectorsForNode(unvalidated({ tagName: 7 }))).toEqual([...COMMON_SELECTORS]);
  });
});
