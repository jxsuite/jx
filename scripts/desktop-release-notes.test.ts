/**
 * Covers `scripts/desktop-release-notes.ts`, which fills the desktop release's body with what
 * changed in Studio. release-please's own notes for that release are a list of bumped dependencies,
 * and library components are no longer GitHub releases, so a reader of the Releases page would
 * otherwise learn nothing about the build they are about to install.
 */

import { describe, expect, test } from "bun:test";

import {
  BLOCK_END,
  BLOCK_START,
  MAX_BLOCK_LENGTH,
  blockForTag,
  demoteHeadings,
  movedComponents,
  newSections,
  parseChangelog,
  previousDesktopTag,
  renderBlock,
  spliceBlock,
  stripDependencies,
} from "./desktop-release-notes.ts";

const CHANGELOG = `# Changelog

## [13.0.0](https://github.com/jxsuite/jx/compare/studio-v12.0.0...studio-v13.0.0) (2026-11-15)


### ⚠ BREAKING CHANGES

* **runtime:** the interpreter renders a component with $shadow into a shadow root

### Features

* **studio:** a surface opens on the canvas ([31369f3](https://github.com/jxsuite/jx/commit/31369f3))

## [12.0.0](https://github.com/jxsuite/jx/compare/studio-v11.0.0...studio-v12.0.0) (2026-11-10)

### Bug Fixes

* **studio:** the grid scrolls ([abcdef0](https://github.com/jxsuite/jx/commit/abcdef0))

## [11.0.0] (2026-11-01)

### Features

* **studio:** an older one
`;

describe("parseChangelog", () => {
  test("splits a release-please changelog into its versions, with date and body", () => {
    const sections = parseChangelog(CHANGELOG);
    expect(sections.map((s) => s.version)).toEqual(["13.0.0", "12.0.0", "11.0.0"]);
    expect(sections.map((s) => s.date)).toEqual(["2026-11-15", "2026-11-10", "2026-11-01"]);
    expect(sections[0]!.body.startsWith("### ⚠ BREAKING CHANGES")).toBe(true);
    expect(sections[0]!.body).toContain("a surface opens on the canvas");
    // The next heading is not part of the previous body.
    expect(sections[0]!.body).not.toContain("12.0.0");
  });

  test("a changelog with no version section is empty, and another level-two heading ends one", () => {
    expect(parseChangelog("# Changelog\n")).toEqual([]);
    const sections = parseChangelog(
      "## [1.0.0] (2026-01-01)\n\nfirst\n\n## Notes\n\nnot a version\n",
    );
    expect(sections).toHaveLength(1);
    expect(sections[0]!.body).toBe("first");
  });

  test("a section without a date still parses", () => {
    expect(parseChangelog("## [2.0.0](https://x/y)\n\nbody\n")[0]).toEqual({
      version: "2.0.0",
      date: undefined,
      body: "body",
    });
  });
});

describe("newSections", () => {
  test("keeps exactly the versions the previous release did not have", () => {
    const now = parseChangelog(CHANGELOG);
    const before = parseChangelog(CHANGELOG).slice(1);
    expect(newSections(now, before).map((s) => s.version)).toEqual(["13.0.0"]);
  });

  test("a release that skipped a desktop build in between carries both versions", () => {
    const now = parseChangelog(CHANGELOG);
    const before = parseChangelog(CHANGELOG).slice(2);
    expect(newSections(now, before).map((s) => s.version)).toEqual(["13.0.0", "12.0.0"]);
  });

  test("nothing new when the previous release already had everything", () => {
    const now = parseChangelog(CHANGELOG);
    expect(newSections(now, now)).toEqual([]);
  });
});

describe("stripDependencies", () => {
  test("drops the bump list and keeps the sections around it", () => {
    const body =
      "### Features\n\n* a\n\n### Dependencies\n\n* The following workspace dependencies were updated\n  * @jxsuite/x bumped to 1.0.0\n\n### Bug Fixes\n\n* b";
    expect(stripDependencies(body)).toBe("### Features\n\n* a\n\n### Bug Fixes\n\n* b");
    expect(stripDependencies("### Dependencies\n\n* only this")).toBe("");
  });
});

describe("demoteHeadings", () => {
  test("moves a heading down a level and leaves a fence and prose alone", () => {
    const text = "### Features\n\n* a\n\n```md\n### not a heading\n```\n\n# Top";
    expect(demoteHeadings(text)).toBe(
      "#### Features\n\n* a\n\n```md\n### not a heading\n```\n\n## Top",
    );
  });
});

describe("movedComponents", () => {
  test("names what moved, skipping desktop itself, the copied changelog and the unreleased", () => {
    const previous = {
      "packages/desktop": "9.3.2",
      "packages/studio": "12.0.0",
      "packages/ui": "0.13.0",
    };
    const current = {
      "packages/desktop": "9.4.0",
      "packages/studio": "13.0.0",
      "packages/ui": "0.14.0",
      "packages/runtime": "9.0.0",
      "packages/fresh": "0.0.0",
      "packages/same": "1.0.0",
    };
    expect(movedComponents(current, { ...previous, "packages/same": "1.0.0" })).toEqual([
      { name: "runtime", from: undefined, to: "9.0.0" },
      { name: "ui", from: "0.13.0", to: "0.14.0" },
    ]);
  });
});

describe("previousDesktopTag", () => {
  const tags = [
    "desktop-v9.3.1",
    "desktop-v9.10.0",
    "desktop-v9.3.2",
    "desktop-v9.4.0",
    "studio-v1.0.0",
  ];

  test("is the next lower version, compared as versions and not as text", () => {
    expect(previousDesktopTag("desktop-v9.10.0", tags)).toBe("desktop-v9.4.0");
    expect(previousDesktopTag("desktop-v9.4.0", tags)).toBe("desktop-v9.3.2");
  });

  test("is undefined for the first release", () => {
    expect(previousDesktopTag("desktop-v9.3.1", ["desktop-v9.3.1"])).toBeUndefined();
  });
});

describe("renderBlock", () => {
  const sections = parseChangelog(CHANGELOG).slice(0, 1);
  const base = {
    tag: "desktop-v9.4.0",
    previousTag: "desktop-v9.3.2",
    changelogs: new Map([["Studio", sections]]),
    moved: [{ name: "ui", from: "0.13.0", to: "0.14.0" }],
  };

  test("lists Studio's new sections under the block's own headings, then the other packages", () => {
    const block = renderBlock(base);
    expect(block.startsWith(BLOCK_START)).toBe(true);
    expect(block.endsWith(BLOCK_END)).toBe(true);
    expect(block).toContain("## Changes in Studio");
    expect(block).toContain("### Studio 13.0.0 (2026-11-15)");
    expect(block).toContain("#### Features");
    expect(block).toContain("## Also released");
    expect(block).toContain("ui 0.14.0");
    expect(block).toContain(
      "https://github.com/jxsuite/jx/compare/desktop-v9.3.2...desktop-v9.4.0",
    );
  });

  test("says nothing when nothing changed, and omits the compare link without a previous tag", () => {
    expect(renderBlock({ ...base, changelogs: new Map(), moved: [] })).toBe("");
    expect(renderBlock({ ...base, previousTag: undefined })).not.toContain("compare");
    expect(renderBlock({ ...base, changelogs: new Map([["Studio", []]]), moved: [] })).toBe("");
  });

  test("cuts an oversized block, because GitHub refuses a body over 125000 characters", () => {
    const huge = [{ version: "1.0.0", date: undefined, body: "x".repeat(MAX_BLOCK_LENGTH * 2) }];
    const block = renderBlock({ ...base, changelogs: new Map([["Studio", huge]]) });
    expect(block.length).toBeLessThan(MAX_BLOCK_LENGTH + 500);
    expect(block).toContain("The notes were cut here");
    expect(block.endsWith(BLOCK_END)).toBe(true);
  });
});

describe("spliceBlock", () => {
  const block = `${BLOCK_START}\nnew\n${BLOCK_END}`;

  test("appends to the body", () => {
    expect(spliceBlock("## [9.4.0]\n\nnotes\n", block)).toBe(`## [9.4.0]\n\nnotes\n\n${block}\n`);
  });

  test("is idempotent: a second run replaces the block instead of stacking one", () => {
    const once = spliceBlock("notes", block);
    expect(spliceBlock(once, block)).toBe(once);
    const replaced = spliceBlock(once, `${BLOCK_START}\nnewer\n${BLOCK_END}`);
    expect(replaced).toContain("newer");
    expect(replaced).not.toContain("\nnew\n");
    expect(replaced.split(BLOCK_START)).toHaveLength(2);
  });

  test("an empty block removes an earlier one and adds nothing", () => {
    expect(spliceBlock(`notes\n\n${block}\n`, "")).toBe("notes\n");
  });
});

describe("blockForTag, against this repository's own history", () => {
  test("an unknown tag yields no studio section and does not throw", () => {
    // Neither the tag nor its changelog exists, so there is nothing to say.
    expect(blockForTag("desktop-v0.0.0-no-such-tag")).toBe("");
  });
});
