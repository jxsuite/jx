import { describe, expect, test } from "bun:test";

import type { JsonValue } from "../types";

const { validateDocument } = await import("../src/schema");

/**
 * Both spellings of a `$map` pointer validate wherever one may appear (spec.md §10.4): the bare
 * `$map/item/x`, which Studio writes, and `#/$map/item/x`, the form every other pointer in the
 * schema takes. Every tier resolves both, so the validator must not refuse the one the runtime has
 * always accepted.
 */
const list = (extra: Record<string, JsonValue>) => ({
  children: [
    {
      $prototype: "Array",
      items: { $ref: "#/state/rows" },
      map: { tagName: "li" },
      ...extra,
    },
  ],
  state: { rows: [] },
  tagName: "ul",
});

describe("a $map pointer in either spelling", () => {
  test.each(["$map/item", "$map/item/id", "#/$map/item/id", "#/$map/item"])(
    "a key accepts %s",
    async (pointer) => {
      const result = await validateDocument(list({ key: { $ref: pointer } }));
      expect(result.errors).toBeNull();
    },
  );

  test.each(["$map/index", "#/$map/index", "#/state/id"])("a key refuses %s", async (pointer) => {
    const result = await validateDocument(list({ key: { $ref: pointer } }));
    expect(result.valid).toBe(false);
  });

  test.each(["#/$map/item/x", "#/$map/index", "$map/item/x"])(
    "a $ref binding accepts %s",
    async (pointer) => {
      const result = await validateDocument(
        list({ map: { tagName: "li", textContent: { $ref: pointer } } }),
      );
      expect(result.errors).toBeNull();
    },
  );

  test("a pointer that names neither item nor index is still refused", async () => {
    const result = await validateDocument(
      list({ map: { tagName: "li", textContent: { $ref: "#/$map/other" } } }),
    );
    expect(result.valid).toBe(false);
  });
});
