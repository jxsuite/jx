/**
 * What Review changes calls a change (`src/publish/review-changes.ts`, studio.md §22.8): the thing
 * it is on the site, named the way the Site panel names it, with a tag for what happened and one
 * sentence for what publishing it does.
 */
import { resetStudioState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { resolveI18n } from "@jxsuite/schema/locale";
import {
  reviewItem,
  reviewItems,
  reviewTag,
  selectedReviewItem,
} from "../src/publish/review-changes";
import type { GitFileStatus } from "../src/types";

/** One status row. */
function file(path: string, status: string, staged = false): GitFileStatus {
  return { path, staged, status };
}

beforeEach(() => {
  resetStudioState({
    name: "Demo",
    projectConfig: { content: { posts: { source: "./content/posts/" } }, name: "Demo" },
    projectRoot: "/p",
  });
});

describe("tags", () => {
  test("say what happened in the site's words: new, edited, deleted, renamed", () => {
    expect(["A", "U", "M", "D", "R", "X"].map((status) => reviewTag(status))).toEqual([
      "new",
      "new",
      "edit",
      "delete",
      "rename",
      "edit",
    ]);
    expect(reviewItem(file("pages/about.json", "D")).tagLabel).toBe("DELETE");
    expect(reviewItem(file("pages/about.json", "R")).tagLabel).toBe("RENAME");
  });
});

describe("what a change is called", () => {
  test("a page by its route, with its address", () => {
    expect(reviewItem(file("pages/index.md", "M", true))).toEqual({
      included: true,
      kind: "Page · /",
      label: "Home",
      noun: "page",
      nounPlural: "pages",
      path: "pages/index.md",
      refusal: "",
      status: "M",
      summary: "This page changed.",
      tag: "edit",
      tagLabel: "EDIT",
      url: "/",
    });
    const added = reviewItem(file("pages/pricing.md", "U"));
    expect([added.label, added.kind, added.summary]).toEqual([
      "Pricing",
      "Page · /pricing",
      "A new page. It goes live at /pricing.",
    ]);
  });

  test("a page in a locale folder is marked with its language", () => {
    const { i18n } = resolveI18n({ i18n: { defaultLocale: "en", locales: ["en", "fr"] } });
    expect(reviewItem(file("pages/fr/about.json", "M"), i18n).label).toBe("About (fr)");
  });

  test("an entry by its collection, in the singular", () => {
    const entry = reviewItem(file("content/posts/designing-for-slowness.md", "A"));
    expect([entry.label, entry.kind, entry.summary, entry.url]).toEqual([
      "Designing for slowness",
      "Post · Posts",
      "A new post.",
      "",
    ]);
  });

  test("a component or a template says that the pages using it change with it", () => {
    const component = reviewItem(file("components/site-footer.json", "M"));
    expect([component.label, component.kind, component.summary]).toEqual([
      "Site footer",
      "Component",
      "This component changed. Every page that uses it changes with it.",
    ]);
    const template = reviewItem(file("layouts/base.json", "M"));
    expect([template.label, template.kind, template.summary]).toEqual([
      "Base",
      "Template",
      "This template changed. Every page drawn in it changes with it.",
    ]);
    const styles = reviewItem(file("styles/site.css", "A"));
    expect([styles.kind, styles.summary]).toEqual([
      "Styles",
      "A new stylesheet. Every page that loads it can change.",
    ]);
  });

  test("what a deletion or a rename reaches is not claimed", () => {
    expect(reviewItem(file("components/site-footer.json", "D")).summary).toBe(
      "This component is deleted.",
    );
    expect(reviewItem(file("layouts/base.json", "R")).summary).toBe("This template was renamed.");
  });

  test("media and the project's other files by their file name", () => {
    const image = reviewItem(file("public/images/greenhouse photo.jpg", "U"));
    expect([image.label, image.kind, image.summary, image.nounPlural]).toEqual([
      "greenhouse photo.jpg",
      "Media",
      "A new image.",
      "images",
    ]);
    // Media that is not a picture is a file, as the rest of the project's files are.
    const pdf = reviewItem(file("public/files/menu.pdf", "U"));
    expect([pdf.noun, pdf.nounPlural, pdf.summary]).toEqual(["file", "files", "A new file."]);
    const lock = reviewItem(file("package-lock.json", "M"));
    expect([lock.label, lock.kind, lock.noun]).toEqual([
      "package-lock.json",
      "Project file",
      "file",
    ]);
  });
});

describe("what has a comparison", () => {
  test("a refused change says why, in words", () => {
    expect(reviewItem(file("public/images/hero.jpg", "M")).refusal).toMatch(/image or media file/);
    expect(reviewItem(file("pages/old.json", "R")).refusal).toMatch(/renamed file/);
    expect(reviewItem(file("pages/odd.json", "X")).refusal).toBe(
      '"pages/odd.json" has no change a comparison can show.',
    );
    expect(reviewItem(file("pages/about.json", "M")).refusal).toBe("");
  });
});

describe("the list", () => {
  test("reads the way a site does: pages, entries, components, templates, styles, media, other", () => {
    const items = reviewItems([
      file("package-lock.json", "U"),
      file("public/hero.jpg", "U"),
      file("layouts/base.json", "M"),
      file("styles/site.css", "M"),
      file("components/card.json", "M"),
      file("content/posts/a.md", "M"),
      file("pages/about.json", "M"),
      file("pages/index.json", "M"),
    ]);
    expect(items.map((item) => item.path)).toEqual([
      "pages/about.json",
      "pages/index.json",
      "content/posts/a.md",
      "components/card.json",
      "layouts/base.json",
      "styles/site.css",
      "public/hero.jpg",
      "package-lock.json",
    ]);
  });

  test("the centre shows the change picked while it is still one, else the first", () => {
    const items = reviewItems([file("pages/index.json", "M"), file("pages/about.json", "M")]);
    expect(selectedReviewItem(items, "pages/about.json")?.label).toBe("About");
    expect(selectedReviewItem(items, "pages/gone.json")?.label).toBe("Home");
    expect(selectedReviewItem(items, null)?.label).toBe("Home");
    expect(selectedReviewItem([], null)).toBeNull();
  });
});
