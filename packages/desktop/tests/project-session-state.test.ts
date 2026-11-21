// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * The window's session running the project state host for its project (`specs/project-state.md`
 * §10.1) over a real directory: a subscription through the session streams the project's events, a
 * conditional write lands through the host and a stale one is refused, the usage query answers from
 * the host's graph once it is indexed, and a re-root ends the subscription.
 */

import { authorized } from "./_authorized";
import { afterAll, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash } from "@jxsuite/protocol/project-state";
import type { ProjectEvent, SubscribeResponse } from "@jxsuite/protocol/project-state";
import { decodeDesktopEnded, decodeDesktopPush } from "@jxsuite/protocol/project-state-frames";
import { RpcProblemError } from "@jxsuite/server/project-server";
import type { RpcConnection } from "@jxsuite/server/project-server";
import { createProjectStateHost } from "@jxsuite/server/project-state/host";
import type { ProjectStateHost } from "@jxsuite/server/project-state/host";
import * as livePreview from "@jxsuite/server/live-preview";

/** What the live preview's readers are shown, per path, as the session published it. */
const shown = new Map<string, string>();
void mock.module("@jxsuite/server/live-preview", () => ({
  ...livePreview,
  clearLivePreviewOverlay: (_root: string, path?: string) => {
    if (path === undefined) {
      shown.clear();
    } else {
      shown.delete(path);
    }
  },
  setLivePreviewOverlay: (_root: string, path: string, contents: string) => {
    shown.set(path, contents);
  },
}));

const { createProjectSession } = await import("../src/backend/project-session");

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "jx-session-state-"));
  roots.push(root);
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write("project.json", JSON.stringify({ name: "p" }));
  write("components/card.json", JSON.stringify({ tagName: "my-card" }));
  write("pages/index.json", JSON.stringify({ children: [{ tagName: "my-card" }] }));
  write("pages/broken.json", "{ not json");
  return root;
}

/** A socket that collects what the session sends it, replying as the project server does. */
function socket(id = 1) {
  const sent: string[] = [];
  const replied: (() => void)[] = [];
  const closers: (() => void)[] = [];
  const connection: RpcConnection = {
    afterReply: (listener) => {
      replied.push(listener);
    },
    buffered: () => 0,
    id,
    onClose: (listener) => {
      closers.push(listener);
    },
    send: (frame) => {
      sent.push(frame);
      return true;
    },
  };
  return {
    close: () => {
      for (const listener of closers.splice(0)) {
        listener();
      }
    },
    connection,
    events: (): ProjectEvent[] => sent.flatMap((frame) => decodeDesktopPush(frame)?.events ?? []),
    reply: () => {
      for (const listener of replied.splice(0)) {
        listener();
      }
    },
    sent,
  };
}

/** A session whose project state host runs without the git CLI. */
function session(root: string) {
  return createProjectSession(authorized(root), undefined, {
    projectState: {
      createHost: (options) => createProjectStateHost({ ...options, git: false }),
    },
  });
}

/** Wait for `check` to hold, failing the test by name when it never does. */
async function until(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!check()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await Bun.sleep(20);
  }
}

const ready = (sock: ReturnType<typeof socket>) => () =>
  sock.events().some((event) => event.type === "readiness" && event.state === "ready");

describe("the session's project state", () => {
  test("subscribes, writes with a base, refuses a stale one, and answers usages from the graph", async () => {
    const root = project();
    const s = session(root);
    try {
      const sock = socket();
      const response: SubscribeResponse = await s.projectSubscribe(
        { clientId: "window" },
        sock.connection,
      );
      sock.reply();
      expect(response.kind).toBe("snapshot");
      await until(ready(sock), "the host to be ready");

      const before = await contentHash(readFileSync(join(root, "pages/index.json")));
      const next = JSON.stringify({ children: [] });
      const written = await s.projectWrite({
        baseHash: before,
        contents: next,
        path: "pages/index.json",
        writeId: "w1",
      });
      expect(written.hash).toBe(await contentHash(new TextEncoder().encode(next)));
      expect(readFileSync(join(root, "pages/index.json"), "utf8")).toBe(next);
      await until(
        () =>
          sock
            .events()
            .some(
              (event) =>
                event.type === "fileChanged" &&
                event.origin !== "external" &&
                event.origin.writeId === "w1",
            ),
        "the write's own event",
      );
      await expect(
        s.projectWrite({
          baseHash: before,
          contents: "{}",
          path: "pages/index.json",
          writeId: "w2",
        }),
      ).rejects.toBeInstanceOf(RpcProblemError);
      await expect(
        s.projectDelete({ base: { hash: before }, path: "pages/index.json", writeId: "d1" }),
      ).rejects.toBeInstanceOf(RpcProblemError);

      // A socket that subscribed writes with a base; one that has not keeps writeFile (§5).
      expect(() => {
        s.refuseUnconditional("writeFile", sock.connection);
      }).toThrow(RpcProblemError);
      expect(() => {
        s.refuseUnconditional("writeFile", socket(2).connection);
      }).not.toThrow();
      expect(() => {
        s.refuseUnconditional("writeFile");
      }).not.toThrow();

      // The graph's answer names an unreadable document as it reads it, not as JSON.parse does.
      const usages = await s.findReferences({ path: "components/card.json" });
      expect(usages.errors).toEqual([
        { error: "The document could not be read", path: "pages/broken.json" },
      ]);

      // Re-rooting closes the host, which ends the subscription; the socket is told.
      s.setProjectRoot(authorized(project()));
      await until(
        () => sock.sent.some((frame) => decodeDesktopEnded(frame) !== null),
        "the subscription's end",
      );
      // A socket that closes is one that has not subscribed again.
      sock.close();
      expect(() => {
        s.refuseUnconditional("deleteFile", sock.connection);
      }).not.toThrow();
    } finally {
      await s.dispose();
    }
  });

  test("the overlay keys by document once the host knows it, and a delete through it drops it", async () => {
    const root = project();
    const s = session(root);
    try {
      const sock = socket();
      await s.projectSubscribe({ clientId: "window" }, sock.connection);
      sock.reply();
      await until(ready(sock), "the host to be ready");
      s.setPreviewOverlay({ clientId: "window", contents: "{}", path: "pages/index.json" });
      s.setPreviewOverlay({ clientId: "window", contents: "[]", path: "components/card.json" });
      expect(shown.get("pages/index.json")).toBe("{}");
      const hash = await contentHash(readFileSync(join(root, "pages/index.json")));
      const deleted = await s.projectDelete({
        base: { hash },
        path: "pages/index.json",
        writeId: "d1",
      });
      expect(deleted.rev).toEqual(expect.any(Number));
      // The removal reaches the overlay through the host's events, and unpublishes the document.
      await until(() => !shown.has("pages/index.json"), "the overlay to drop the deleted file");
      expect(shown.get("components/card.json")).toBe("[]");
      s.clearPreviewOverlay({ clientId: "window" });
      expect(shown.size).toBe(0);
    } finally {
      await s.dispose();
      await s.dispose();
    }
  });

  test("a host that fails to close is reported, and dispose waits for every host let go of", async () => {
    let closes = 0;
    let release: () => void = () => {};
    const s = createProjectSession(authorized(project()), undefined, {
      projectState: {
        createHost: async (options) => {
          const host = await createProjectStateHost({ ...options, git: false });
          return {
            ...host,
            close: async (): Promise<void> => {
              closes += 1;
              await host.close();
              if (closes === 1) {
                throw new Error("watcher would not close");
              }
              await new Promise<void>((resolve) => {
                release = resolve;
              });
            },
          } satisfies ProjectStateHost;
        },
      },
    });
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      await s.projectSubscribe({}, socket().connection);
      s.setProjectRoot(authorized(project()));
      await until(
        () => logged.mock.calls.some((call) => String(call[0]).includes("would not close")),
        "the failed close to be reported",
      );
      await s.projectSubscribe({}, socket(2).connection);
      s.close();
      let disposed = false;
      const disposing = s.dispose().then(() => {
        disposed = true;
      });
      await until(() => closes === 2, "the second host to start closing");
      await Bun.sleep(20);
      expect(disposed).toBe(false);
      release();
      await disposing;
      expect(disposed).toBe(true);
    } finally {
      logged.mockRestore();
    }
  });
});
