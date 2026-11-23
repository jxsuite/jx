/**
 * Studio shell: the dev server's default door (no `?project=`) keeps the project state subscription
 * it starts at boot. Entering the root project leaves the previous one, which stops the
 * subscription the boot's first `ensureFsSync` started (`files/open-sequence.ts`), so the door
 * starts it again once the project is in (`project-state.md` §3, §11.1).
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import {
  answerSubscribe,
  contentHash,
  createMemoryEventLog,
} from "@jxsuite/protocol/project-state";
import type { SubscribeRequest } from "@jxsuite/protocol/project-state";
import type { ProjectStateListener } from "@jxsuite/protocol/project-state-frames";
import { bootStudio, waitFor } from "./studio-shell-fixture";
import { getPlatform } from "../src/platform";
import { projectStateServed, projectStateTracksWrites } from "../src/project-state/subscription";
import { componentRegistry } from "../src/files/components";
import { workspace } from "../src/workspace/workspace";

const log = createMemoryEventLog({ epoch: "e1" });
const requests: SubscribeRequest[] = [];
const writes: string[] = [];
let listener: ProjectStateListener | null = null;

const { state } = await bootStudio({
  overrides: {
    subscribeProjectState: async (request, next) => {
      requests.push(request);
      listener = next;
      return answerSubscribe(log, request, () => ({
        components: [],
        files: [],
        formats: "f",
        readiness: "ready",
      }));
    },
    writeProjectState: async (request) => {
      writes.push(request.path);
      return { hash: "sha256-x", ok: true, rev: 1 };
    },
  },
  url: "http://localhost/",
});

await waitFor(() => projectStateServed() && requests.length >= 2);

describe("the default door and the project state subscription", () => {
  test("the subscription the project's entry stopped is started again, and the host answers it", () => {
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(projectStateTracksWrites()).toBe(true);
    expect(projectStateServed()).toBe(true);
  });

  test("the host's dependency events reach the live component lane without throwing", async () => {
    const event = log.append({
      cause: { docId: "d1", kind: "component-instance" },
      complete: true,
      docIds: [],
      origin: "external",
      tags: ["x-card"],
      type: "dependentsInvalidated",
    });
    listener?.events({ epoch: log.epoch, events: [event] });
    await waitFor(() => false, 5);
    expect(projectStateServed()).toBe(true);
  });

  test("a plain write then goes through the contract, with a base", async () => {
    await getPlatform().writeFile("notes.txt", "hello");
    expect(writes).toEqual(["notes.txt"]);
  });

  /* `studio.md` §9.2: a component another writer changed reaches the live component lane through the
     subscription's `docChanged`, which says the change is not Studio's own, and the lane rewrites the
     registry entry the instances read. */
  test("another writer's docChanged on a definition rewrites its registry entry", async () => {
    const rootBefore = workspace.projectRoot;
    workspace.projectRoot ??= "/recent/site";
    try {
      const text = JSON.stringify({ state: { headline: { default: "" } }, tagName: "disk-card" });
      state.files.set("components/disk-card.json", text);
      const hash = await contentHash(text);
      const path = "components/disk-card.json";
      const events = [
        log.append({
          docId: "dc",
          hash,
          isDir: false,
          origin: "external",
          path,
          type: "fileAdded",
        }),
        log.append({
          docId: "dc",
          hash,
          indexed: true,
          kind: "component",
          origin: "external",
          path,
          type: "docChanged",
        }),
      ];
      listener?.events({ epoch: log.epoch, events });
      await waitFor(() => componentRegistry.some((entry) => entry.tagName === "disk-card"));
      const entry = componentRegistry.find((c) => c.tagName === "disk-card");
      expect(entry?.path).toBe(path);
      expect(entry?.props).toEqual([{ default: "", name: "headline" }]);
    } finally {
      workspace.projectRoot = rootBefore;
    }
  });
});
