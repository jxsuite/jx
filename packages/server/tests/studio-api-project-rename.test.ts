/**
 * The dev server's rename route (`specs/project-state.md` §9, §10.2): `POST
 * /__studio/project/rename` reaches the active project's host through the project state service,
 * and tells the collaboration rooms the old path of a rename it applied. A server with no project
 * state service has no route.
 */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { PROJECT_RENAME_PATH } from "@jxsuite/protocol/project-state-frames";
import type { RenameOperation } from "@jxsuite/protocol/project-state";
import { createProjectEventsService } from "../src/project-events.ts";
import { handleStudioApi } from "../src/studio-api.ts";
import { fakeHost } from "./_fake-project-host.ts";

const ROOT = resolve("/virtual/site");

const operation: RenameOperation = {
  dirtyReferrers: [],
  from: "media/a.png",
  opId: "op",
  policy: "rewrite-buffer",
  to: "media/b.png",
};

function post() {
  const url = new URL(`http://localhost${PROJECT_RENAME_PATH}`);
  return { req: new Request(url, { body: JSON.stringify(operation), method: "POST" }), url };
}

describe("POST /__studio/project/rename", () => {
  test("is answered by the active project's host, and names the moved path to the rooms", async () => {
    const host = fakeHost(ROOT);
    host.rename = () =>
      Promise.resolve({
        buffers: [],
        errors: [],
        files: ["media/b.png"],
        from: "media/a.png",
        isDir: false,
        ok: true,
        opId: "op",
        references: { files: [], filesChanged: 0, refsUpdated: 0 },
        rev: 2,
        to: "media/b.png",
      });
    const projectEvents = createProjectEventsService({ createHost: () => Promise.resolve(host) });
    const moved: string[] = [];
    const { req, url } = post();
    const res = await handleStudioApi(req, url, ROOT, ROOT, {
      onFileMoved: (abs) => moved.push(abs),
      projectEvents,
    });
    // No project is active yet, so the service cannot start a host.
    expect(res?.status).toBe(500);
    await projectEvents.activate(ROOT);
    const again = post();
    const done = await handleStudioApi(again.req, again.url, ROOT, ROOT, {
      onFileMoved: (abs) => moved.push(abs),
      projectEvents,
    });
    expect(done?.status).toBe(200);
    expect(await done?.json()).toMatchObject({ ok: true, rev: 2 });
    expect(moved).toEqual([resolve(ROOT, "media/a.png")]);
    await projectEvents.close();
  });

  test("is not served without the project state", async () => {
    const { req, url } = post();
    const res = await handleStudioApi(req, url, ROOT, ROOT);
    expect(res?.status).toBe(404);
  });
});
