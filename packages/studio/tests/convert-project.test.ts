/**
 * Tests for src/format/convert-project.ts and convert-project-flow.ts — converting a whole project
 * between the two native notations.
 *
 * What carries the weight: the plan is complete before anything is written (a refusal leaves the
 * platform with no write and no rename), a file that cannot convert is skipped rather than aborting
 * the rest, unsaved tabs block the whole run, and a branch that is not merged is a warning the
 * dialog states and an unanswerable host is not mistaken for a clean one.
 */
import { installMockPlatform, resetStudioState } from "./harness";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { setFormats } from "../src/format/format-host";
import { closeAllTabs, openTab, workspace } from "../src/workspace/workspace";
import { invalidateUsages } from "../src/services/references";
import { resetNotifications } from "../src/services/notify";
import type { MockPlatformState } from "./harness";
import type { StudioPlatform } from "../src/types";

let validatorAnswer: string[] | null = [];
void mock.module("../src/services/jx-validate", () => ({
  validateDocOrNull: () => Promise.resolve(validatorAnswer),
}));

const PAGE = '{\n  "tagName": "div",\n  "children": [{ "tagName": "p", "textContent": "Hi" }]\n}\n';

let state: MockPlatformState;

function install(files: Record<string, string>, overrides: Partial<StudioPlatform> = {}) {
  ({ state } = installMockPlatform(overrides, files));
}

function fsCalls(): string[] {
  return state.calls.flatMap(([name, path]) =>
    name === "writeFile" || name === "renameFile" ? [`${name} ${String(path)}`] : [],
  );
}

beforeEach(() => {
  resetNotifications();
  validatorAnswer = [];
  invalidateUsages();
  closeAllTabs();
  setFormats([]);
  resetStudioState({ dirs: new Map(), projectConfig: {}, projectDirs: ["pages"] });
  install({
    "components/card.json": PAGE,
    "layouts/base.json": PAGE,
    "pages/about.json": PAGE,
    "pages/index.jxn": "tagName div\n",
    "pages/data.class.json": "{}",
    "public/media/logo.json": "{}",
  });
});

describe("scanNativeDocuments", () => {
  test("lists native files under the document folders only", async () => {
    const { scanNativeDocuments } = await import("../src/format/convert-project");
    expect(await scanNativeDocuments()).toEqual([
      "components/card.json",
      "layouts/base.json",
      "pages/about.json",
      "pages/index.jxn",
    ]);
  });
});

describe("scanning and counting", () => {
  test("skips node_modules and dot folders, and a folder that cannot be listed", async () => {
    const files = {
      "components/c.json": PAGE,
      "pages/.cache/hidden.json": PAGE,
      "pages/node_modules/dep.json": PAGE,
      "pages/ok.json": PAGE,
    };
    const { platform: base } = installMockPlatform({}, files);
    install(files, {
      listDirectory: async (dir: string) => {
        if (dir === "components") {
          throw new Error("denied");
        }
        return base.listDirectory(dir);
      },
    });
    const { scanNativeDocuments } = await import("../src/format/convert-project");
    expect(await scanNativeDocuments()).toEqual(["pages/ok.json"]);
  });

  test("walks into nested folders", async () => {
    install({ "pages/blog/2024/post.json": PAGE, "pages/blog/index.json": PAGE });
    const { scanNativeDocuments } = await import("../src/format/convert-project");
    const found = await scanNativeDocuments();
    expect(found.toSorted()).toEqual(["pages/blog/2024/post.json", "pages/blog/index.json"]);
  });

  test("the census counts only what a conversion would consider", async () => {
    const { censusOf } = await import("../src/format/convert-project");
    const census = await censusOf(["pages/a.json", "pages/b.jxn", "styles/x.json"]);
    expect(census).toEqual({ json: 1, jxn: 1 });
  });
});

describe("planProjectConversion", () => {
  test("a file that cannot be read is skipped with the reason", async () => {
    install(
      { "pages/a.json": PAGE, "pages/b.json": PAGE },
      {
        readFile: async (path: string) => {
          if (path === "pages/a.json") {
            throw new Error("unreadable");
          }
          return PAGE;
        },
      },
    );
    const { planProjectConversion } = await import("../src/format/convert-project");
    const plan = await planProjectConversion(".jxn");
    expect(plan.skipped).toEqual([{ path: "pages/a.json", reason: "unreadable" }]);
    expect(plan.files).toHaveLength(1);
  });

  test("plans every JSON document and writes nothing", async () => {
    const { planProjectConversion } = await import("../src/format/convert-project");
    const plan = await planProjectConversion(".jxn");
    expect(plan.files.map((f) => f.path)).toEqual([
      "components/card.json",
      "layouts/base.json",
      "pages/about.json",
    ]);
    expect(plan.alreadyTarget).toBe(1);
    expect(plan.dirty).toEqual([]);
    expect(fsCalls()).toEqual([]);
  });

  test("a file the schema rejects is skipped with its reason, the rest still go", async () => {
    const { planProjectConversion } = await import("../src/format/convert-project");
    let calls = 0;
    void mock.module("../src/services/jx-validate", () => ({
      validateDocOrNull: () => {
        calls += 1;
        return Promise.resolve(calls === 1 ? ["/tagName: bad"] : []);
      },
    }));
    const plan = await planProjectConversion(".jxn");
    expect(plan.skipped).toHaveLength(1);
    expect(plan.files).toHaveLength(2);
  });

  test("a target that already exists is skipped", async () => {
    install({ "pages/about.json": PAGE, "pages/about.jxn": "tagName div\n" });
    const { planProjectConversion } = await import("../src/format/convert-project");
    const plan = await planProjectConversion(".jxn");
    expect(plan.files).toEqual([]);
    expect(plan.skipped[0]?.reason).toContain("pages/about.jxn already exists");
  });

  test("skipped files are listed in path order", async () => {
    install({
      "pages/b.json": PAGE,
      "pages/b.jxn": "tagName div\n",
      "pages/a.json": PAGE,
      "pages/a.jxn": "tagName div\n",
    });
    const { planProjectConversion } = await import("../src/format/convert-project");
    const plan = await planProjectConversion(".jxn");
    expect(plan.skipped.map((entry) => entry.path)).toEqual(["pages/a.json", "pages/b.json"]);
  });

  test("an open tab with unsaved changes is reported", async () => {
    openTab({
      document: { children: [], tagName: "div" },
      documentPath: "pages/about.json",
      id: "pages/about.json",
    });
    workspace.tabs.get("pages/about.json")!.doc.dirty = true;
    const { planProjectConversion, runProjectConversion } =
      await import("../src/format/convert-project");
    const plan = await planProjectConversion(".jxn");
    expect(plan.dirty).toEqual(["pages/about.json"]);
    expect(runProjectConversion(plan)).rejects.toThrow("Unsaved changes");
    expect(fsCalls()).toEqual([]);
  });
});

describe("runProjectConversion", () => {
  test("writes then renames each file, in order, and counts them", async () => {
    const { planProjectConversion, runProjectConversion } =
      await import("../src/format/convert-project");
    const plan = await planProjectConversion(".jxn");
    const seen: string[] = [];
    const result = await runProjectConversion(plan, (done, total, path) => {
      seen.push(`${done}/${total} ${path}`);
    });
    expect(result.converted).toBe(3);
    expect(result.failed).toEqual([]);
    expect(seen).toEqual([
      "1/3 components/card.json",
      "2/3 layouts/base.json",
      "3/3 pages/about.json",
    ]);
    expect(fsCalls().slice(0, 2)).toEqual([
      "writeFile components/card.json",
      "renameFile components/card.json",
    ]);
  });

  test("a failed rename is reported, restores the file and does not stop the others", async () => {
    install(
      { "components/card.json": PAGE, "pages/about.json": PAGE },
      {
        renameFile: async (from: string) => {
          if (from === "components/card.json") {
            throw new Error("locked");
          }
          /* SAFETY: the converter reads only `references` from a rename's report. */
          return { references: { filesChanged: 1, refsUpdated: 2 } } as never;
        },
      },
    );
    const { planProjectConversion, runProjectConversion } =
      await import("../src/format/convert-project");
    const result = await runProjectConversion(await planProjectConversion(".jxn"));
    expect(result.converted).toBe(1);
    expect(result.refsUpdated).toBe(2);
    expect(result.failed.map((f) => f.path)).toEqual(["components/card.json"]);
    expect(state.files.get("components/card.json")).toBe(PAGE);
  });
});

describe("checkBranches", () => {
  test("names the unmerged branches the host reports", async () => {
    install(
      {},
      {
        gitBranches: async () => ({
          branches: ["main", "feat"],
          current: "main",
          unmerged: ["feat"],
        }),
      },
    );
    const { checkBranches } = await import("../src/format/convert-project");
    const check = await checkBranches();
    expect(check).toEqual({ branches: ["feat"], current: "main", kind: "some" });
  });

  test("an empty answer is none", async () => {
    install(
      {},
      {
        gitBranches: async () => ({ branches: ["main", "old"], current: "main", unmerged: [] }),
      },
    );
    const { checkBranches } = await import("../src/format/convert-project");
    const check = await checkBranches();
    expect(check.kind).toBe("none");
  });

  test("a host that cannot say, with other branches, is unknown and not none", async () => {
    install(
      {},
      {
        gitBranches: async () => ({ branches: ["main", "feat", "origin/HEAD"], current: "main" }),
      },
    );
    const { checkBranches } = await import("../src/format/convert-project");
    const check = await checkBranches();
    expect(check).toEqual({ branches: ["feat"], current: "main", kind: "unknown" });
  });

  test("no repository is none", async () => {
    install(
      {},
      {
        gitBranches: async () => {
          throw new Error("not a repo");
        },
      },
    );
    const { checkBranches } = await import("../src/format/convert-project");
    const check = await checkBranches();
    expect(check.kind).toBe("none");
  });
});

describe("the dialog's sentences", () => {
  test("branchWarning is silent for none, and names branches otherwise", async () => {
    const { branchWarning } = await import("../src/format/convert-project-flow");
    expect(branchWarning({ branches: [], current: "main", kind: "none" })).toBeNull();
    expect(branchWarning({ branches: ["a", "b"], current: "main", kind: "some" })).toContain(
      "2 other branches hold commits",
    );
    expect(branchWarning({ branches: ["a"], current: "main", kind: "unknown" })).toContain(
      "cannot say whether they are merged",
    );
    const many = Array.from({ length: 7 }, (_, i) => `b${i}`);
    expect(branchWarning({ branches: many, current: "", kind: "some" })).toContain("and 2 more");
  });

  test("planLines states the count, the skips and the default", async () => {
    const { planLines, resultLine } = await import("../src/format/convert-project-flow");
    const planned = planLines({
      alreadyTarget: 2,
      branches: { branches: [], current: "main", kind: "none" },
      dirty: [],
      /* SAFETY: planLines counts files and never reads a file's plan. */
      files: [{ original: "", path: "a.json", plan: {} as never }],
      skipped: [1, 2, 3, 4].map((n) => ({ path: `s${n}.json`, reason: "bad" })),
      target: ".jxn",
    });
    const text = planned.join("\n");
    expect(planned[0]).toContain("1 document in pages/");
    expect(text).toContain("2 already are Jx Notation (.jxn)");
    expect(text).toContain("4 will be left as they are");
    expect(text).toContain("and 1 more");
    expect(resultLine({ converted: 1, failed: [], filesChanged: 1, refsUpdated: 1 }, ".json")).toBe(
      "Converted 1 document to JSON (.json); updated 1 reference in 1 file",
    );
  });
});
