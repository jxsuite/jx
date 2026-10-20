/**
 * The Media workspace's records — `src/media/media-commands.ts`.
 *
 * Each `run` lazily imports the library flow and the home opener, so both are doubled with
 * `mock.module()` (AGENTS.md): the double is the witness that the record ran the flow, and it keeps
 * two real imports of either module from ever overlapping.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createCommandRegistry } from "../src/commands/registry";
import { emptyContext, makeContext } from "../src/commands/context";
import type { CommandArgValues } from "../src/commands/command-args";
import type { MediaBrowseRequest } from "../src/media/media-library";

const calls: unknown[][] = [];
let deleted = true;

void mock.module("../src/media/media-library.ts", () => ({
  applyMediaBrowse: (request: MediaBrowseRequest) => calls.push(["browse", request]),
  deleteMediaFile: async (path: string) => {
    calls.push(["delete", path]);
    return deleted;
  },
  requestMediaReplace: (path: string) => calls.push(["replace", path]),
  requestMediaUpload: () => calls.push(["upload"]),
}));
void mock.module("../src/workspace/workspace-home.ts", () => ({
  openWorkspaceHome: (id: string) => calls.push(["home", id]),
}));

const {
  MEDIA_BROWSE,
  MEDIA_DELETE,
  MEDIA_REPLACE,
  MEDIA_UPLOAD,
  mediaCommands,
  registerMediaCommands,
} = await import("../src/media/media-commands");

function registry() {
  const commands = createCommandRegistry({
    getContext: () => makeContext({ project: { open: true } }),
    mac: true,
  });
  registerMediaCommands(commands);
  return commands;
}

async function run(id: string, args?: CommandArgValues): Promise<void> {
  await registry().run(id, args);
}

/** The message a run was refused with, or `""` when it was not. */
async function refusal(id: string, args: CommandArgValues): Promise<string> {
  try {
    await run(id, args);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

beforeEach(() => {
  calls.length = 0;
  deleted = true;
});

describe("the records", () => {
  test("are four project-level palette records with schemas where they take arguments", () => {
    const records = mediaCommands();
    expect(records.map((record) => record.id)).toEqual([
      MEDIA_BROWSE,
      MEDIA_UPLOAD,
      MEDIA_REPLACE,
      MEDIA_DELETE,
    ]);
    for (const record of records) {
      expect(record.level).toBe("project");
      expect(record.menus).toEqual(["palette"]);
      expect(record.id).not.toMatch(/\.toggle[A-Z]/);
    }
    const browse = records[0]!;
    expect(Object.keys(browse.args?.properties ?? {}).toSorted()).toEqual([
      "filter",
      "query",
      "select",
    ]);
    expect(records[2]?.args?.required).toEqual(["path"]);
    expect(records[3]?.args?.required).toEqual(["path"]);
    // Delete is the one danger row: styled as one and ordered last, like every other delete verb.
    expect(records[3]?.destructive).toBe(true);
    expect(records[3]?.group).toBe("9_danger");
    expect(records.slice(0, 3).every((record) => record.destructive !== true)).toBe(true);
    // Gated on an open project, and only on that.
    expect(browse.when?.(emptyContext())).toBe(false);
  });
});

describe("media.browse", () => {
  test("applies the request, then opens the Media home", async () => {
    await run(MEDIA_BROWSE, { filter: "unused", query: "hero", select: "./public/media/a.png" });
    expect(calls).toEqual([
      ["browse", { filter: "unused", query: "hero", select: "public/media/a.png" }],
      ["home", "media"],
    ]);
  });

  test("with no arguments only shows the home", async () => {
    await run(MEDIA_BROWSE);
    expect(calls).toEqual([
      ["browse", {}],
      ["home", "media"],
    ]);
  });

  test("refuses a selection that is not a media file, before touching anything", async () => {
    expect(await refusal(MEDIA_BROWSE, { select: "pages/index.json" })).toContain(
      '"pages/index.json" is not a media file',
    );
    expect(calls).toEqual([]);
  });

  test("refuses a filter its schema does not declare", async () => {
    expect(await refusal(MEDIA_BROWSE, { filter: "tags" })).not.toBe("");
    expect(calls).toEqual([]);
  });
});

describe("media.upload, media.replace, media.delete", () => {
  test("upload opens the home, then asks for its picker", async () => {
    await run(MEDIA_UPLOAD);
    expect(calls).toEqual([["home", "media"], ["upload"]]);
  });

  test("replace opens the home, then asks for that file's Replace picker", async () => {
    await run(MEDIA_REPLACE, { path: "public/hero.jpg" });
    expect(calls).toEqual([
      ["home", "media"],
      ["replace", "public/hero.jpg"],
    ]);
  });

  test("delete goes through the flow's confirmation, and opens nothing", async () => {
    deleted = false;
    await run(MEDIA_DELETE, { path: "public/hero.jpg" });
    expect(calls).toEqual([["delete", "public/hero.jpg"]]);
  });

  test("a path that is not media is refused by name", async () => {
    expect(await refusal(MEDIA_REPLACE, { path: "project.json" })).toContain(
      'command "media.replace": "project.json" is not a media file',
    );
    expect(await refusal(MEDIA_DELETE, { path: "notes.md" })).toContain("is not a media file");
    expect(calls).toEqual([]);
  });
});
