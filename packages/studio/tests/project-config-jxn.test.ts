/**
 * A project declared by `project.jxn` (`site-architecture.md` §2.3): Studio learns which file the
 * project has, reads it with the project grammar rather than the document one, and a settings edit
 * changes its own line and keeps every comment. A folder holding both files, and a `project.jxn`
 * that does not read, are never written.
 */
import { flush, installMockPlatform, resetStudioState } from "./harness";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { isString } from "@jxsuite/schema/guards";
import { problems, resetNotifications } from "../src/services/notify";
import { closeAllTabs, workspace } from "../src/workspace/workspace";
import { projectState } from "../src/store";
import {
  formatByName,
  formatForPath,
  formatParse,
  formatSerialize,
} from "../src/format/format-host";
import { hasProjectFileConflict, learnProjectFileName } from "../src/files/project-file-name";
import { projectConfigPath, setProjectConfigPath } from "../src/tabs/tab";
import {
  adoptProjectConfig,
  commitProjectConfig,
  resetProjectConfigDocument,
} from "../src/tabs/project-config";

import { showSettingsDocument, showUnreadProjectFile } from "../src/settings/settings-document";
import { serializeDocument } from "../src/files/serialize-document";
import type { MockPlatformState } from "./harness";
import type { ProjectConfig } from "@jxsuite/schema/types";

const SOURCE = `/- kdl-version 2
// The site's own name.
project "Bistro"

// Where it is published.
url "https://bistro.example"

// The parser reads the menu.
extensions {
    - "@jxsuite/parser"
}
`;

/** The project.jxn writes the mock platform saw, newest last. */
function writes(state: MockPlatformState): string[] {
  return state.calls.flatMap(([method, path, content]) =>
    method === "writeFile" && path === "project.jxn" && isString(content) ? [content] : [],
  );
}

/** A project whose root holds these files, opened the way Studio opens one. */
async function open(files: Record<string, string>, config: ProjectConfig) {
  const { platform, state } = installMockPlatform({}, files);
  resetStudioState({ projectConfig: config });
  await learnProjectFileName(platform);
  return state;
}

beforeEach(() => {
  resetProjectConfigDocument();
  resetNotifications();
  closeAllTabs();
});

afterEach(() => {
  resetProjectConfigDocument();
  closeAllTabs();
  setProjectConfigPath("project.json");
});

describe("which file the project has", () => {
  test("is learned from the project's root", async () => {
    await open({ "pages/index.json": "{}", "project.jxn": SOURCE }, { name: "Bistro" });
    expect(projectConfigPath()).toBe("project.jxn");
    expect(hasProjectFileConflict()).toBe(false);

    await open({ "project.json": "{}" }, {});
    expect(projectConfigPath()).toBe("project.json");
  });

  test("is a new project's name when the root holds neither, or cannot be listed", async () => {
    await open({ "pages/project.jxn": 'h1 "x"' }, {});
    expect(projectConfigPath()).toBe("project.jxn");

    const { platform } = installMockPlatform({
      listDirectory: () => Promise.reject(new Error("offline")),
    });
    expect(await learnProjectFileName(platform)).toBeNull();
  });

  test("both is a Problem naming both files", async () => {
    await open({ "project.json": "{}", "project.jxn": SOURCE }, {});
    expect(hasProjectFileConflict()).toBe(true);
    expect(problems.at(-1)?.message).toContain("project.jxn and project.json");
  });
});

describe("the project file is not a document", () => {
  test("project.jxn has the project grammar, and a page by that name the document one", async () => {
    expect(formatForPath("project.jxn")?.name).toBe("jx-project");
    expect(formatByName("jx-project")?.extensions).toEqual([]);
    expect(formatForPath("pages/project.jxn")?.name).toBe("jxn");
    expect(formatForPath("project.json")).toBeUndefined();

    const config = await formatParse("jx-project", SOURCE);
    expect(config).toEqual({
      extensions: ["@jxsuite/parser"],
      name: "Bistro",
      url: "https://bistro.example",
    });
    const changed = { ...config, url: "https://bistro.test" };
    expect(await formatSerialize("jx-project", changed, { source: SOURCE })).toBe(
      SOURCE.replace("bistro.example", "bistro.test"),
    );
  });
});

describe("a settings edit", () => {
  test("changes its own line and keeps every comment", async () => {
    const config: ProjectConfig = {
      extensions: ["@jxsuite/parser"],
      name: "Bistro",
      url: "https://bistro.example",
    };
    const state = await open({ "project.jxn": SOURCE }, config);

    expect(await commitProjectConfig({ url: "https://bistro.test" })).toEqual({ ok: true });
    expect(writes(state)).toEqual([SOURCE.replace("bistro.example", "bistro.test")]);

    // A second edit merges with what the first wrote, not with what was first read.
    await commitProjectConfig({ name: "Bistro & Café" });
    expect(writes(state).at(-1)).toBe(
      SOURCE.replace("bistro.example", "bistro.test").replace(
        'project "Bistro"',
        'project "Bistro & Café"',
      ),
    );
  });

  test("that changes nothing writes nothing", async () => {
    const config: ProjectConfig = {
      extensions: ["@jxsuite/parser"],
      name: "Bistro",
      url: "https://bistro.example",
    };
    const state = await open({ "project.jxn": SOURCE }, config);
    expect(await commitProjectConfig({ url: "https://bistro.example" })).toEqual({ ok: true });
    expect(writes(state)).toEqual([]);
  });

  test("to a new project.jxn writes its canonical form", async () => {
    setProjectConfigPath("project.jxn");
    const { state } = installMockPlatform();
    resetStudioState({ projectConfig: { name: "Fresh" } });
    await commitProjectConfig({ url: "https://fresh.example" });
    expect(writes(state)).toEqual([
      '/- kdl-version 2\nproject Fresh\n\nurl "https://fresh.example"\n',
    ]);
  });

  test("is refused while the folder holds both files, and nothing is written", async () => {
    const state = await open({ "project.json": "{}", "project.jxn": SOURCE }, { name: "Bistro" });
    const result = await commitProjectConfig({ url: "https://bistro.test" });
    expect(result.ok).toBe(false);
    expect(writes(state)).toEqual([]);
    expect(problems.at(-1)?.message).toContain("project.jxn and project.json");
  });

  test("is refused while the file does not read, and goes through once it is fixed", async () => {
    const broken = 'project "Bistro"\nproject "Again"\n';
    const state = await open(
      { "project.jxn": broken },
      { extensions: ["@jxsuite/parser"], name: "Bistro", url: "https://bistro.example" },
    );
    const refused = await commitProjectConfig({ url: "https://bistro.test" });
    expect(refused.ok).toBe(false);
    expect(writes(state)).toEqual([]);
    expect(problems.at(-1)?.message).toContain("does not read");
    expect(state.files.get("project.jxn")).toBe(broken);

    state.files.set("project.jxn", SOURCE);
    const fixed = await commitProjectConfig({ url: "https://bistro.test" });
    expect(fixed).toEqual({ ok: true });
    const written = writes(state).at(-1);
    expect(written).toContain('url "https://bistro.test"');
    expect(written).toContain("// The parser reads the menu.");
  });

  test("after the assistant rewrote the file merges with what it wrote", async () => {
    const state = await open({ "project.jxn": SOURCE }, { name: "Bistro" });
    const rewritten = `${SOURCE}\n// Added by the assistant.\nbuild outDir="./out"\n`;
    state.files.set("project.jxn", rewritten);
    await adoptProjectConfig(
      {
        build: { outDir: "./out" },
        extensions: ["@jxsuite/parser"],
        name: "Bistro",
        url: "https://bistro.example",
      },
      rewritten,
    );
    await commitProjectConfig({ url: "https://bistro.test" });
    expect(writes(state).at(-1)).toBe(rewritten.replace("bistro.example", "bistro.test"));
  });
});

describe("the project.jxn tab", () => {
  test("opened from Settings is Jx Notation, with the file's own text", async () => {
    const state = await open(
      { "project.jxn": SOURCE },
      {
        extensions: ["@jxsuite/parser"],
        name: "Bistro",
        url: "https://bistro.example",
      },
    );
    const tab = showSettingsDocument("source");
    expect(tab?.doc.sourceFormat).toBe("jx-project");
    await flush(4);
    expect(tab?.doc.source).toBe(SOURCE);
    expect(await serializeDocument(tab!)).toBe(SOURCE);

    // ⌘S writes what a settings commit would: the one line, and no member the file never had.
    tab!.doc.document.url = "https://bistro.test";
    expect(await serializeDocument(tab!)).toBe(SOURCE.replace("bistro.example", "bistro.test"));
    expect(writes(state)).toEqual([]);
  });
});

describe("a project file that does not read", () => {
  const BROKEN = '/- kdl-version 2\nproject "Bistro"\ndefaults {\n';

  test("opens as its own text in the Code view, and the Problem says where", async () => {
    await open({ "project.jxn": BROKEN }, {});
    expect(await showUnreadProjectFile()).toBe(true);
    const problem = problems.at(-1);
    expect(problem?.message).toContain("project.jxn does not read");
    expect(problem?.detail).toMatch(/\d+:\d+|line \d+/u);
    const tab = workspace.tabs.get("project.jxn");
    expect(tab?.doc.source).toBe(BROKEN);
    expect(tab?.doc.unread).toBe(problem?.detail ?? "");
    expect(tab?.session.ui.canvasMode).toBe("source");

    // The Code view's commit that parses is the project's configuration at once.
    const fixed = { name: "Bistro" };
    tab!.doc.document = fixed;
    expect(projectState?.projectConfig).toEqual(fixed);
  });

  test("is not shown when it reads, or when there is none", async () => {
    await open({ "project.jxn": SOURCE }, { name: "Bistro" });
    expect(await showUnreadProjectFile()).toBe(false);
    await open({}, {});
    expect(await showUnreadProjectFile()).toBe(false);
    expect(workspace.tabs.size).toBe(0);
  });

  test("as project.json is not overwritten by a settings edit either", async () => {
    const state = await open({ "project.json": '{ "name": "Bistro", }' }, { name: "Bistro" });
    const refused = await commitProjectConfig({ url: "https://bistro.test" });
    expect(refused.ok).toBe(false);
    expect(state.files.get("project.json")).toBe('{ "name": "Bistro", }');
    expect(problems.at(-1)?.message).toContain("does not read");
  });
});
