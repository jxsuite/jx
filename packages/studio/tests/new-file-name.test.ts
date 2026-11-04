/**
 * The name rules New File and Add new share, `src/files/new-file-name.ts`, judged directly.
 *
 * `files-create.test.ts` drives the same rules through the New File prompt; this holds them with no
 * dialog, which is how Add new calls them.
 */
import { describe, expect, test } from "bun:test";
import {
  composeNewFileName,
  extensionOfName,
  OTHER_FORMAT,
  renameRefusal,
  slugify,
  validateNewFileName,
} from "../src/files/new-file-name";

describe("slugify and extensionOfName", () => {
  test("a display name becomes a lower-case stem", () => {
    expect(slugify("  About Us! ")).toBe("about-us");
    expect(slugify("[slug]")).toBe("slug");
  });

  test("an extension is the last dot's, and a leading dot is not one", () => {
    expect(extensionOfName("a.b.json")).toBe(".json");
    expect(extensionOfName(".gitignore")).toBe("");
    expect(extensionOfName("readme")).toBe("");
  });
});

describe("composeNewFileName", () => {
  test("three modes: verbatim, fixed and picked", () => {
    expect(composeNewFileName(" [slug].json ", "")).toBe("[slug].json");
    expect(composeNewFileName("About Us", "", { ext: ".md", kind: "fixed" })).toBe("about-us.md");
    expect(composeNewFileName("!!", "", { ext: ".md", kind: "fixed" })).toBe("");
    const choose = { kind: "choose" } as const;
    expect(composeNewFileName("about", ".md", choose)).toBe("about.md");
    expect(composeNewFileName("about.MD", ".md", choose)).toBe("about.MD");
    expect(composeNewFileName("robots.txt", OTHER_FORMAT, choose)).toBe("robots.txt");
  });
});

describe("validateNewFileName", () => {
  const base = { dir: "pages", taken: new Set(["about.json"]) };

  test("blank, slug-empty, slashes and `..` are refused before a collision is asked about", () => {
    expect(validateNewFileName("  ", "", base)).toBe("Enter a file name.");
    expect(validateNewFileName("", "", { ...base, choice: { ext: ".json", kind: "fixed" } })).toBe(
      "Enter a name.",
    );
    expect(
      validateNewFileName("!!", "", { ...base, choice: { ext: ".json", kind: "fixed" } }),
    ).toBe("Enter at least one letter or number.");
    expect(validateNewFileName("/x.json", "", base)).toContain("starts or ends with a slash");
    expect(validateNewFileName("../x.json", "", base)).toBe(
      "A name cannot step outside the destination folder.",
    );
  });

  test("a collision is case-insensitive and names the folder", () => {
    expect(validateNewFileName("About.JSON", "", base)).toBe(
      "About.JSON already exists in pages/.",
    );
    expect(validateNewFileName("contact.json", "", base)).toBe("");
  });

  test("a subfolder needs Other…, and a contradicting extension names both sides", () => {
    const check = {
      ...base,
      choice: { kind: "choose" } as const,
      known: new Set([".json", ".md"]),
      rows: [{ label: "Markdown (.md)", value: ".md" }],
    };
    expect(validateNewFileName("blog/post", ".md", check)).toBe(
      "Pick Other… to create a file in a subfolder of pages.",
    );
    expect(validateNewFileName("post.json", ".md", check)).toBe(
      "You picked Markdown (.md); this name ends in .json.",
    );
    expect(validateNewFileName("x/y", ".md", { ...check, dir: "." })).toContain("the project root");
  });

  test("under a lock, Other… still refuses a foreign document but not a plain file", () => {
    const check = {
      ...base,
      choice: { because: "Entries are .md files.", ext: ".md", kind: "locked" } as const,
      known: new Set([".json", ".md"]),
    };
    expect(validateNewFileName("post.json", OTHER_FORMAT, check)).toBe("Entries are .md files.");
    expect(validateNewFileName("credits.txt", OTHER_FORMAT, check)).toBe("");
  });
});

describe("renameRefusal", () => {
  const FOLDER = new Set(["hero.jpg", "Notes.md", "assets"]);
  const refusal = (value: string, path = "public/hero.jpg") => renameRefusal(path, value, FOLDER);

  test("accepts a new name, surrounding space, and another extension", () => {
    expect(refusal("cover.jpg")).toBe("");
    expect(refusal("  cover.jpg  ")).toBe("");
    expect(refusal("hero.txt")).toBe("");
    expect(refusal("hero")).toBe("");
  });

  test("refuses a blank", () => {
    expect(refusal("   ")).toBe("Enter a file name.");
  });

  test("refuses a path, which would land in a folder the listing cannot answer for", () => {
    expect(refusal("sub/cover.jpg")).toContain("not a path");
    expect(refusal("../cover.jpg")).toContain("not a path");
    expect(refusal(String.raw`sub\cover.jpg`)).toContain("not a path");
  });

  test("refuses a dotfile, and the two names that are not names", () => {
    expect(refusal(".env")).toContain("start with a dot");
    expect(refusal(".")).toContain("start with a dot");
    expect(refusal("..")).toContain("start with a dot");
  });

  test("a dotfile may keep being one, on a host that listed it", () => {
    expect(refusal(".env.local", "public/.env")).toBe("");
    expect(renameRefusal(".env", ".gitignore", new Set([".env", ".gitignore"]))).toContain(
      "already exists",
    );
  });

  test("refuses a name in the folder, whatever its case and whichever case was listed", () => {
    expect(refusal("notes.md")).toBe("notes.md already exists in this folder.");
    expect(refusal("NOTES.MD")).toBe("NOTES.MD already exists in this folder.");
    expect(refusal("assets")).toBe("assets already exists in this folder.");
  });

  test("the entry's own name is not a collision, so its case can change", () => {
    expect(refusal("hero.jpg")).toBe("");
    expect(refusal("Hero.JPG")).toBe("");
    expect(renameRefusal("hero.jpg", "HERO.jpg", FOLDER)).toBe("");
  });
});
