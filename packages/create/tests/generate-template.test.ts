/**
 * The built-in template variants of the blank build: $media direction, viewport/theme-color meta,
 * the mobile-app file overlay, and precedence of a starter over a template id.
 */
import { parseJxn } from "@jxsuite/schema/jxn";
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readProject } from "./_project";
import type { ProjectConfig } from "@jxsuite/schema/types";

const FIXTURE = resolve(tmpdir(), `jx-template-starter-fixture-${Date.now()}`);
const TMP = resolve(tmpdir(), `jx-create-template-test-${Date.now()}`);

// Stand in for @jxsuite/starters so the precedence test never touches the real registry.
void mock.module("@jxsuite/starters", () => ({
  getStarterDir: (id: string) => {
    if (id !== "fixture") {
      throw new Error(`Unknown starter: "${id}"`);
    }
    return FIXTURE;
  },
}));

const { generateProject } = await import("../generate");

const DESKTOP_MEDIA = {
  "--": "1280px",
  "--lg": "(max-width: 1024px)",
  "--md": "(max-width: 768px)",
  "--sm": "(max-width: 640px)",
};

const MOBILE_MEDIA = {
  "--": "375px",
  "--sm": "(min-width: 640px)",
  "--md": "(min-width: 768px)",
  "--lg": "(min-width: 1024px)",
};

function readDocument(...segments: string[]) {
  return parseJxn(readFileSync(join(TMP, ...segments), "utf8"));
}

function viewportContent(project: ProjectConfig) {
  return project.$head?.find((t) => t.attributes?.name === "viewport")?.attributes?.content;
}

beforeAll(() => {
  mkdirSync(join(FIXTURE, "pages"), { recursive: true });
  writeFileSync(
    join(FIXTURE, "project.json"),
    JSON.stringify({ name: "Fixture Starter", url: "https://fixture.example" }),
  );
  writeFileSync(join(FIXTURE, "package.json"), JSON.stringify({ name: "fixture-starter" }));
  writeFileSync(join(FIXTURE, "pages", "index.md"), "# Fixture home\n");
});

afterEach(() => {
  rmSync(TMP, { force: true, recursive: true });
});

describe("generateProject — built-in templates", () => {
  test("no template (regression) builds the desktop-first blank project", async () => {
    await generateProject(TMP, { name: "My Site" });

    const project = readProject(TMP);
    expect(project.$media).toEqual(DESKTOP_MEDIA);
    expect(viewportContent(project)).toBe("width=device-width, initial-scale=1");
    const hasThemeColor = project.$head?.some((t) => t.attributes?.name === "theme-color");
    expect(hasThemeColor).toBe(false);

    // The shared skeleton files, no app-shell overlay.
    const layout = readDocument("layouts", "base.jxn");
    expect(layout).toMatchObject({ style: { minHeight: "100vh" } });
    expect(existsSync(join(TMP, "pages", "explore.md"))).toBe(false);
  });

  test('"desktop-first" produces the same project.json as blank', async () => {
    await generateProject(TMP, { name: "My Site", template: "desktop-first" });
    const desktopFirst = readProject(TMP);

    rmSync(TMP, { force: true, recursive: true });
    await generateProject(TMP, { name: "My Site" });
    expect(readProject(TMP)).toEqual(desktopFirst);
  });

  test('"mobile-first" flips $media to min-width queries but keeps the shared skeleton', async () => {
    await generateProject(TMP, { name: "My App", template: "mobile-first" });

    const project = readProject(TMP);
    expect(project.$media).toEqual(MOBILE_MEDIA);
    expect(viewportContent(project)).toBe("width=device-width, initial-scale=1");

    const layout = readDocument("layouts", "base.jxn");
    expect(layout).toMatchObject({ style: { minHeight: "100vh" } });
    expect(existsSync(join(TMP, "pages", "explore.md"))).toBe(false);
  });

  test('"mobile-app" adds the app-shell overlay, viewport-fit, and theme-color', async () => {
    await generateProject(TMP, { name: "My App", template: "mobile-app" });

    const project = readProject(TMP);
    expect(project.$media).toEqual(MOBILE_MEDIA);
    expect(viewportContent(project)).toBe(
      "width=device-width, initial-scale=1, viewport-fit=cover",
    );
    expect(project.$head).toContainEqual({
      attributes: { content: "#ffffff", name: "theme-color" },
      tagName: "meta",
    });

    // The overlay replaces the base layout with the app shell and adds the nav's pages.
    const layout = readDocument("layouts", "base.jxn");
    expect(layout).toMatchObject({ style: { height: "100dvh" } });
    const children = Array.isArray(layout.children) ? layout.children : [];
    expect(children.at(-1)).toMatchObject({ tagName: "nav" });
    expect(existsSync(join(TMP, "pages", "explore.md"))).toBe(true);
    expect(existsSync(join(TMP, "pages", "profile.md"))).toBe(true);
  });

  test("a non-blank starter wins over a template id", async () => {
    await generateProject(TMP, { name: "Cloned", starter: "fixture", template: "mobile-app" });

    const project = readProject(TMP);
    expect(project.name).toBe("Cloned");
    // The fixture tree is cloned as-is: no generated $media, no app-shell overlay.
    expect(project.$media).toBeUndefined();
    expect(existsSync(join(TMP, "pages", "explore.md"))).toBe(false);
  });

  test('starter "blank" defers to the template id', async () => {
    await generateProject(TMP, { name: "Appy", starter: "blank", template: "mobile-app" });
    expect(readProject(TMP).$media).toEqual(MOBILE_MEDIA);
    expect(existsSync(join(TMP, "pages", "explore.md"))).toBe(true);
  });
});
