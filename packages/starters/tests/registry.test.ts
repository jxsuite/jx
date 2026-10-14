/** Registry integrity + the module's public API (listStarters / getStarter / getStarterDir). */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { getStarter, getStarterDir, listStarters, SITES_DIR } from "../index";

const starters = listStarters();

describe("starter registry", () => {
  test("is a non-empty array", () => {
    expect(Array.isArray(starters)).toBe(true);
    expect(starters.length).toBeGreaterThan(0);
  });

  test("every entry has the required, non-empty fields", () => {
    for (const s of starters) {
      for (const field of [s.id, s.name, s.industry, s.tagline, s.description]) {
        expect(field).toBeString();
        expect(field).not.toBe("");
      }
      expect(Array.isArray(s.features)).toBe(true);
      expect(s.features.length).toBeGreaterThan(0);
      for (const feature of s.features) {
        expect(feature).toBeString();
      }
      expect(s.accent).toBeString();
      expect(s.thumbnail).toBeString();
      expect(s.accent).toMatch(/^#[0-9a-fA-F]{3,8}$/);
      expect(s.thumbnail.startsWith("data:image/")).toBe(true);
    }
  });

  test("ids are unique", () => {
    const ids = starters.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every id maps to a sites/<id> directory with a project.json", () => {
    for (const s of starters) {
      const dir = join(SITES_DIR, s.id);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(join(dir, "project.json"))).toBe(true);
    }
  });
});

describe("module API", () => {
  test("getStarter returns the metadata for a known id", () => {
    const [first] = starters;
    if (!first) {
      throw new Error("registry is empty");
    }
    expect(getStarter(first.id)?.name).toBe(first.name);
  });

  test("getStarter returns undefined for an unknown id", () => {
    expect(getStarter("does-not-exist")).toBeUndefined();
  });

  test("getStarterDir resolves a known id to its sites directory", () => {
    const [first] = starters;
    if (!first) {
      throw new Error("registry is empty");
    }
    expect(getStarterDir(first.id)).toBe(join(SITES_DIR, first.id));
  });

  test("getStarterDir throws for an unknown id", () => {
    expect(() => getStarterDir("does-not-exist")).toThrow('Unknown starter: "does-not-exist"');
  });

  test("listStarters is cached (returns the same array on repeated calls)", () => {
    expect(listStarters()).toBe(listStarters());
  });
});
