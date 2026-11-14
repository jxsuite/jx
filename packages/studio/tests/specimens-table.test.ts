import { describe, expect, test } from "bun:test";

import {
  SPECIMENS,
  STUDIO_PROJECT_URL,
  specimenOf,
  specimenVariants,
  specimenWidth,
} from "../src/surfaces/specimens";

describe("specimenOf", () => {
  test("names a surface of Studio's own project that has a specimen", () => {
    expect(specimenOf(STUDIO_PROJECT_URL, "src/surfaces/statusbar.json")).toBe("statusbar");
    expect(specimenOf(STUDIO_PROJECT_URL, "./src/surfaces/statusbar.json")).toBe("statusbar");
    expect(specimenOf(STUDIO_PROJECT_URL, String.raw`src\surfaces\style-panel.json`)).toBe(
      "style-panel",
    );
  });

  test("is null for every other project, whatever the path", () => {
    expect(specimenOf("https://jxsuite.com/ui", "src/surfaces/statusbar.json")).toBeNull();
    expect(specimenOf(undefined, "src/surfaces/statusbar.json")).toBeNull();
  });

  test("is null for a document that is not a surface with a specimen", () => {
    expect(specimenOf(STUDIO_PROJECT_URL, "pages/index.json")).toBeNull();
    expect(specimenOf(STUDIO_PROJECT_URL, "src/surfaces/nested/statusbar.json")).toBeNull();
    expect(
      specimenOf(STUDIO_PROJECT_URL, "packages/studio/src/surfaces/statusbar.json"),
    ).toBeNull();
    expect(specimenOf(STUDIO_PROJECT_URL, "src/surfaces/statusbar.ts")).toBeNull();
    // A surface the table lacks, and a name every object answers to.
    expect(specimenOf(STUDIO_PROJECT_URL, "src/surfaces/shell.json")).toBeNull();
    expect(specimenOf(STUDIO_PROJECT_URL, "src/surfaces/constructor.json")).toBeNull();
    expect(specimenOf(STUDIO_PROJECT_URL, null)).toBeNull();
    expect(specimenOf(STUDIO_PROJECT_URL, "")).toBeNull();
  });
});

describe("specimenVariants", () => {
  test("lists what the table declares, and nothing for a name it lacks", () => {
    expect(specimenVariants("statusbar")).toEqual(["no-document"]);
    expect(specimenVariants("shell")).toEqual([]);
    expect(specimenVariants("constructor")).toEqual([]);
  });

  test("a width is named only by a surface that spans the window", () => {
    expect(specimenWidth("statusbar")).toBe(1200);
    expect(specimenWidth("menu")).toBeNull();
    expect(specimenWidth("constructor")).toBeNull();
  });

  test("the identity is the url packages/studio/project.json declares", async () => {
    const project: { url?: string } = await Bun.file(
      new URL("../project.json", import.meta.url),
    ).json();
    expect(project.url).toBe(STUDIO_PROJECT_URL);
    expect(SPECIMENS.size).toBeGreaterThan(0);
  });
});
