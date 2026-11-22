/**
 * Studio shell: the dev server's default door (no `?project=`) keeps the project state subscription
 * it starts at boot. Entering the root project leaves the previous one, which stops the
 * subscription the boot's first `ensureFsSync` started (`files/open-sequence.ts`), so the door
 * starts it again once the project is in (`project-state.md` §3, §11.1).
 */
import "./harness";
import { describe, expect, test } from "bun:test";
import { answerSubscribe, createMemoryEventLog } from "@jxsuite/protocol/project-state";
import type { SubscribeRequest } from "@jxsuite/protocol/project-state";
import type { ProjectStateListener } from "@jxsuite/protocol/project-state-frames";
import { bootStudio, waitFor } from "./studio-shell-fixture";
import { getPlatform } from "../src/platform";
import { projectStateServed, projectStateTracksWrites } from "../src/project-state/subscription";

const log = createMemoryEventLog({ epoch: "e1" });
const requests: SubscribeRequest[] = [];
const writes: string[] = [];
let listener: ProjectStateListener | null = null;

await bootStudio({
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
});
