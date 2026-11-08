/**
 * Which project components restyle an element their own way (`src/style/component-restyles.ts`,
 * studio.md §7.4): the selector match, the walk over a definition, the read once per registry and
 * the reactive answer the Style tab draws.
 */
import { flush, installMockPlatform } from "./harness";
import { describe, expect, test } from "bun:test";
import {
  componentRestyles,
  loadComponentRestyles,
  restylesTag,
  selectorNamesTag,
} from "../src/style/component-restyles";
import type { ComponentEntry } from "../src/files/components";
import type { JxDocument } from "@jxsuite/schema/types";

/** Wait, a turn at a time, until the answer for `tag` has landed (a definition read is async). */
async function landed(tag: string, read?: (path: string) => Promise<JxDocument | null>) {
  for (let turn = 0; turn < 200; turn++) {
    const found = componentRestyles(tag, read);
    if (found.length > 0) {
      return found;
    }
    await flush(1);
  }
  return componentRestyles(tag, read);
}

function entry(tagName: string, path?: string, source?: string): ComponentEntry {
  const made: ComponentEntry = { props: [], slots: [], tagName };
  if (path !== undefined) {
    made.path = path;
  }
  if (source !== undefined) {
    made.source = source;
  }
  return made;
}

describe("selectorNamesTag", () => {
  test("a tag is named as a whole word of a selector, never as part of another name", () => {
    for (const selector of [
      "button",
      "& button",
      ".cta > button:hover",
      "a, button",
      ":is(button)",
    ]) {
      expect(selectorNamesTag(selector, "button")).toBe(true);
    }
    for (const selector of ["buttons", "my-button", ".button", "#button", "[button]"]) {
      expect(selectorNamesTag(selector, "button")).toBe(false);
    }
    expect(selectorNamesTag("table th", "th")).toBe(true);
  });
});

describe("restylesTag", () => {
  test("a rule naming the tag anywhere in the tree restyles it, at any depth of nesting", () => {
    expect(restylesTag({ style: { "& button": { color: "red" } }, tagName: "x-a" }, "button")).toBe(
      true,
    );
    expect(
      restylesTag({ style: { "@--sm": { ".cta": { button: { padding: "0" } } } } }, "button"),
    ).toBe(true);
    expect(
      restylesTag(
        { children: [{ style: { "& button:hover": { color: "red" } }, tagName: "div" }] },
        "button",
      ),
    ).toBe(true);
  });

  test("a styled node of the tag inside restyles it; the component's own root does not", () => {
    expect(
      restylesTag({ children: [{ style: { color: "red" }, tagName: "button" }] }, "button"),
    ).toBe(true);
    expect(restylesTag({ style: { color: "red" }, tagName: "button" }, "button")).toBe(false);
    expect(restylesTag({ children: [{ style: {}, tagName: "button" }, "text"] }, "button")).toBe(
      false,
    );
    // A declaration whose NAME looks like the tag is a property, not a rule.
    expect(restylesTag({ style: { button: "none" } }, "button")).toBe(false);
    expect(restylesTag("text", "button")).toBe(false);
  });
});

describe("loadComponentRestyles", () => {
  test("reads each project definition once per registry and lists the ones that restyle the tag", async () => {
    const reads: string[] = [];
    const files = new Map<string, JxDocument>([
      ["components/cta.json", { style: { "& button": { color: "red" } }, tagName: "x-cta" }],
      ["components/card.json", { tagName: "x-card" }],
    ]);
    const read = async (path: string) => {
      reads.push(path);
      if (path === "components/broken.json") {
        throw new Error("unreadable");
      }
      return files.get(path) ?? null;
    };
    const registry = [
      entry("x-cta", "components/cta.json"),
      entry("x-card", "components/card.json"),
      entry("x-broken", "components/broken.json"),
      entry("x-npm", "node_modules/x/x.json", "npm"),
      entry("x-nowhere"),
    ];
    expect(await loadComponentRestyles(registry, "button", read)).toEqual([
      { path: "components/cta.json", tagName: "x-cta" },
    ]);
    expect(await loadComponentRestyles(registry, "a", read)).toEqual([]);
    // The second tag asked no file again; an npm package and a pathless entry were never read.
    expect(reads.toSorted()).toEqual([
      "components/broken.json",
      "components/card.json",
      "components/cta.json",
    ]);
  });
});

describe("componentRestyles", () => {
  test("answers empty while it reads, then the answer, and starts over for a new registry", async () => {
    installMockPlatform(
      {
        discoverComponents: async () => [
          { path: "components/cta.json", props: [], slots: [], tagName: "x-cta" },
        ],
      },
      {
        "components/cta.json": JSON.stringify({
          style: { "& button": { color: "red" } },
          tagName: "x-cta",
        }),
      },
    );
    const { loadComponentRegistry } = await import("../src/files/components");
    await loadComponentRegistry();
    let reads = 0;
    const read = async (path: string): Promise<JxDocument | null> => {
      reads += 1;
      const { readDefinition } = await import("../src/browse/library-preview");
      return readDefinition(path);
    };
    // Asked twice while the read is in flight, it answers empty and does not start a second one.
    const first = componentRestyles("button", read);
    const again = componentRestyles("button", read);
    expect([first, again]).toEqual([[], []]);
    expect(await landed("button", read)).toEqual([
      { path: "components/cta.json", tagName: "x-cta" },
    ]);
    expect(reads).toBe(1);
    // A re-read registry is a new array, so what was answered for the old one is forgotten.
    await loadComponentRegistry();
    expect(componentRestyles("button", read)).toEqual([]);
    await landed("button", read);
    expect(reads).toBe(2);
  });

  test("the default reader reads the definition from the project", async () => {
    installMockPlatform(
      {
        discoverComponents: async () => [
          { path: "components/hero.json", props: [], slots: [], tagName: "x-hero" },
        ],
      },
      {
        "components/hero.json": JSON.stringify({
          children: [{ style: { color: "red" }, tagName: "a" }],
          tagName: "x-hero",
        }),
      },
    );
    const { loadComponentRegistry } = await import("../src/files/components");
    await loadComponentRegistry();
    expect(componentRestyles("a")).toEqual([]);
    expect(await landed("a")).toEqual([{ path: "components/hero.json", tagName: "x-hero" }]);
  });
});
