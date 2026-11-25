import { describe, expect, test } from "bun:test";
import { buildShorthandTable, renderShorthandModule } from "../scripts/css-shorthands-table.ts";
import { SHORTHAND_LONGHANDS } from "../src/css-shorthands.ts";

describe("the committed shorthand table", () => {
  test("matches @webref/css (run `bun run generate:css-shorthands` after a bump)", async () => {
    expect(SHORTHAND_LONGHANDS).toEqual(await buildShorthandTable());
  });

  test("lists margin and border with their longhands", () => {
    expect(SHORTHAND_LONGHANDS["margin"]).toContain("margin-left");
    expect(SHORTHAND_LONGHANDS["border"]).toContain("border-color");
    expect(SHORTHAND_LONGHANDS["border-color"]).toContain("border-bottom-color");
  });

  test("has no cycle: no shorthand is its own descendant", () => {
    const table = new Map<string, readonly string[]>(Object.entries(SHORTHAND_LONGHANDS));
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean =>
      (table.get(from) ?? []).some((next) => {
        if (next === target) {
          return true;
        }
        if (seen.has(next)) {
          return false;
        }
        seen.add(next);
        return reaches(next, target, seen);
      });
    for (const name of table.keys()) {
      expect(reaches(name, name)).toBe(false);
    }
  });

  test("renders a module the generator can write back", async () => {
    const source = renderShorthandModule({ margin: ["margin-left"] });
    expect(source).toContain("GENERATED");
    expect(source).toContain('{"margin":["margin-left"]}');
  });
});
