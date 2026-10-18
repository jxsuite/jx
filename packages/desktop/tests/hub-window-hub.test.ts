// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { pickProjectFile } from "../src/project-session";
import { projectPartition, titleFor } from "../src/hub/window-hub";
import { hubFixture } from "./_hub-harness";
import type { Fixture, Sent } from "./_hub-harness";

let fixture: Fixture;

/** The nth `open-window` the hub sent. */
function nth(index: number): Sent<"open-window"> {
  const window = fixture.opened().at(index);
  if (!window) {
    throw new Error(`no window ${index}`);
  }
  return window;
}

describe("titleFor / projectPartition", () => {
  test("a title is the folder's name, then the app's; a welcome window is just the app's", () => {
    expect(titleFor("/p/my-site")).toBe("my-site — Jx Studio");
    expect(titleFor("/p/my-site/")).toBe("my-site — Jx Studio");
    expect(titleFor(String.raw`C:\Users\me\site`)).toBe("site — Jx Studio");
    expect(titleFor(null)).toBe("Jx Studio");
    expect(titleFor("/")).toBe("Jx Studio");
  });

  test("a project's partition is persistent, stable for the project, and keeps its path private", () => {
    const partition = projectPartition("/p/my-site");
    expect(partition).toMatch(/^persist:project-[0-9a-f]{16}$/);
    expect(partition).toBe(projectPartition("/p/my-site/"));
    expect(partition).not.toBe(projectPartition("/p/other"));
    expect(partition).not.toContain("my-site");
  });
});

describe("window hub", () => {
  afterEach(() => fixture.teardown());

  describe("opening windows", () => {
    test("a project window is a tokened Studio URL on its own server, titled for the project", () => {
      fixture = hubFixture();
      const root = fixture.makeProject("alpha");
      expect(fixture.hub.openProject(root)).toEqual({ focused: false });
      const window = nth(0);
      expect(window.id).toBe(1);
      expect(window.title).toBe("alpha — Jx Studio");
      expect(window.partition).toBe(projectPartition(root));
      expect(window.url).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/__studio__\/index\.html\?token=[\w-]+$/,
      );
      expect(fixture.hub.windows()).toEqual([{ id: 1, projectRoot: root }]);
    });

    test("each window has its own server and its own token", () => {
      fixture = hubFixture();
      fixture.hub.openProject(fixture.makeProject("a"));
      fixture.hub.openProject(fixture.makeProject("b"));
      const [first, second] = [new URL(nth(0).url), new URL(nth(1).url)];
      expect(first.host).not.toBe(second.host);
      expect(first.searchParams.get("token")).not.toBe(second.searchParams.get("token"));
    });

    test("a project that is already open is raised, not opened twice", () => {
      fixture = hubFixture();
      const root = fixture.makeProject("alpha");
      fixture.hub.openProject(root);
      // The same directory spelled differently is still the same project.
      expect(fixture.hub.openProject(`${root}/`)).toEqual({ focused: true });
      expect(fixture.opened()).toHaveLength(1);
      expect(fixture.sent.at(-1)).toEqual({ id: 1, type: "focus-window" });
    });

    test("welcome windows take the lowest free storage slot, and a closed one's is reused", () => {
      fixture = hubFixture();
      fixture.hub.openProject(null);
      fixture.hub.openProject(null);
      expect(nth(0).partition).toBe("persist:welcome-0");
      expect(nth(1).partition).toBe("persist:welcome-1");
      expect(nth(0).title).toBe("Jx Studio");
      fixture.hub.handle({ id: 1, type: "window-closed" });
      fixture.hub.openProject(null);
      expect(nth(2).partition).toBe("persist:welcome-0");
    });

    test("an open-project message from the shell opens a window", () => {
      fixture = hubFixture();
      const root = fixture.makeProject("alpha");
      fixture.hub.handle({ root, type: "open-project" });
      expect(fixture.hub.windows()).toEqual([{ id: 1, projectRoot: root }]);
    });
  });

  describe("closing windows", () => {
    test("closing releases the window's server and forgets it; an unknown id changes nothing", async () => {
      fixture = hubFixture();
      fixture.hub.openProject(fixture.makeProject("a"));
      fixture.hub.openProject(fixture.makeProject("b"));
      const closing = nth(0);
      const before = await fetch(closing.url);
      expect(before.status).toBeLessThan(500);
      fixture.hub.handle({ id: 1, type: "window-closed" });
      fixture.hub.handle({ id: 99, type: "window-closed" });
      expect(fixture.hub.windows().map((w) => w.id)).toEqual([2]);
      await expect(fetch(closing.url)).rejects.toThrow();
      // The survivor still answers.
      const survivor = await fetch(nth(1).url);
      expect(survivor.status).toBeLessThan(500);
    });

    test("the last window closing leaves a hub that can open another", () => {
      fixture = hubFixture();
      fixture.hub.openProject(fixture.makeProject("a"));
      fixture.hub.handle({ id: 1, type: "window-closed" });
      expect(fixture.hub.windows()).toEqual([]);
      fixture.hub.openProject(null);
      expect(fixture.hub.windows()).toEqual([{ id: 2, projectRoot: null }]);
    });
  });

  describe("a window's RPC over its own socket", () => {
    test("answers for its own session, and the window list names every window", async () => {
      fixture = hubFixture();
      const a = fixture.makeProject("a");
      const b = fixture.makeProject("b");
      fixture.hub.openProject(a);
      fixture.hub.openProject(b);
      const socketA = await fixture.connect(nth(0));
      const socketB = await fixture.connect(nth(1));
      expect(await socketA.call("getProjectRoot")).toEqual({ root: a });
      expect(await socketB.call("getProjectRoot")).toEqual({ root: b });
      expect(await socketA.call("listOpenWindows")).toEqual([
        { id: 1, projectRoot: a },
        { id: 2, projectRoot: b },
      ]);
      expect(await socketA.call("appInfo")).toEqual({ ...fixture.appInfo });
    });

    test("openProjectInNewWindow reports whether it opened or raised", async () => {
      fixture = hubFixture();
      const a = fixture.makeProject("a");
      const b = fixture.makeProject("b");
      fixture.hub.openProject(a);
      const socket = await fixture.connect(nth(0));
      expect(await socket.call("openProjectInNewWindow", { root: a })).toEqual({ focused: true });
      expect(await socket.call("openProjectInNewWindow", { root: b })).toEqual({ focused: false });
      expect(fixture.opened()).toHaveLength(2);
    });

    test("newWindow opens a welcome window", async () => {
      fixture = hubFixture();
      fixture.hub.openProject(fixture.makeProject("a"));
      const socket = await fixture.connect(nth(0));
      await socket.call("newWindow");
      expect(fixture.hub.windows().at(-1)).toEqual({ id: 2, projectRoot: null });
    });

    test("setWindowProject re-roots and retitles, but defers to a window that holds the project", async () => {
      fixture = hubFixture();
      const a = fixture.makeProject("a");
      const b = fixture.makeProject("b");
      fixture.hub.openProject(a);
      fixture.hub.openProject(null);
      const welcome = await fixture.connect(nth(1));
      // Another window holds `a`: raise it, bind nothing here.
      expect(await welcome.call("setWindowProject", { root: a })).toEqual({
        config: null,
        deduped: true,
      });
      expect(fixture.sent.at(-1)).toEqual({ id: 1, type: "focus-window" });
      // Nobody holds `b`: this window takes it.
      expect(await welcome.call("setWindowProject", { root: b })).toEqual({
        config: null,
        deduped: false,
      });
      expect(fixture.sent.at(-1)).toEqual({ id: 2, title: "b — Jx Studio", type: "set-title" });
      expect(fixture.hub.windows()[1]).toEqual({ id: 2, projectRoot: b });
      // A window is never a duplicate of itself.
      expect(await welcome.call("setWindowProject", { root: b })).toEqual({
        config: null,
        deduped: false,
      });
    });
  });

  describe("native dialogs", () => {
    test("a folder pick is a dialog request answered by the shell's reply", async () => {
      fixture = hubFixture();
      fixture.hub.openProject(null);
      const socket = await fixture.connect(nth(0));
      const answer = socket.call("pickDirectory");
      await Bun.sleep(50);
      const request = fixture.sent.find((m): m is Sent<"dialog"> => m.type === "dialog");
      expect(request).toMatchObject({ kind: "directory", type: "dialog" });
      fixture.hub.handle({
        path: "/chosen",
        requestId: request?.requestId ?? -1,
        type: "dialog-result",
      });
      expect(await answer).toEqual({ path: "/chosen" });
    });

    test("a project pick resolves the chosen project.json to a project, and cancel to nothing", async () => {
      fixture = hubFixture();
      const root = fixture.makeProject("picked");
      fixture.hub.openProject(null);
      const socket = await fixture.connect(nth(0));

      const picking = socket.call("pickProject");
      await Bun.sleep(50);
      const request = fixture.sent.find((m): m is Sent<"dialog"> => m.type === "dialog");
      expect(request).toMatchObject({ kind: "file", title: "Open project.json" });
      fixture.hub.handle({
        path: join(root, "project.json"),
        requestId: request?.requestId ?? -1,
        type: "dialog-result",
      });
      expect(await picking).toEqual({ name: "picked", root });

      const cancelled = socket.call("pickProject");
      await Bun.sleep(50);
      const second = fixture.sent.findLast((m): m is Sent<"dialog"> => m.type === "dialog");
      fixture.hub.handle({ path: null, requestId: second?.requestId ?? -1, type: "dialog-result" });
      expect(await cancelled).toBeNull();
    });

    test("openProject binds the picked project to this window and retitles it", async () => {
      fixture = hubFixture();
      const root = fixture.makeProject("picked");
      fixture.hub.openProject(null);
      const socket = await fixture.connect(nth(0));
      const opening = socket.call("openProject");
      await Bun.sleep(50);
      const request = fixture.sent.find((m): m is Sent<"dialog"> => m.type === "dialog");
      fixture.hub.handle({
        path: join(root, "project.json"),
        requestId: request?.requestId ?? -1,
        type: "dialog-result",
      });
      expect(await opening).toMatchObject({ handle: { name: "picked", root } });
      expect(fixture.sent.at(-1)).toEqual({
        id: 1,
        title: "picked — Jx Studio",
        type: "set-title",
      });
    });

    test("a reply to a dialog nobody asked is ignored", () => {
      fixture = hubFixture();
      fixture.hub.handle({ path: "/x", requestId: 404, type: "dialog-result" });
      expect(fixture.sent).toEqual([]);
    });
  });

  describe("pushes", () => {
    test("a settings change reaches every window", async () => {
      fixture = hubFixture();
      fixture.hub.openProject(fixture.makeProject("a"));
      fixture.hub.openProject(null);
      const sockets = await Promise.all([fixture.connect(nth(0)), fixture.connect(nth(1))]);
      for (const listener of fixture.settings.listeners) {
        listener({ theme: "dark" });
      }
      for (const socket of sockets) {
        expect(await socket.push("settingsChanged")).toEqual({
          method: "settingsChanged",
          params: { settings: { theme: "dark" } },
        });
      }
    });

    test("a file changing under a project reaches that window's sidebar", async () => {
      fixture = hubFixture();
      const root = fixture.makeProject("a");
      fixture.hub.openProject(root);
      const socket = await fixture.connect(nth(0));
      // The watcher needs a moment to arm before an event can be seen.
      await Bun.sleep(500);
      appendFileSync(join(root, "page.json"), "{}");
      const push = await socket.push("onFileEvents", (params) =>
        JSON.stringify(params).includes("page.json"),
      );
      expect(push.method).toBe("onFileEvents");
    }, 20_000);
  });

  describe("update status", () => {
    test("reaches the About screen once the updater has said something, and not before", async () => {
      fixture = hubFixture();
      fixture.hub.openProject(null);
      const socket = await fixture.connect(nth(0));
      expect(await socket.call("appInfo")).toEqual({ ...fixture.appInfo });
      fixture.hub.handle({ text: "Update ready (9.9.9)", type: "update-status" });
      expect(await socket.call("appInfo")).toEqual({
        ...fixture.appInfo,
        updateStatus: "Update ready (9.9.9)",
      });
    });
  });

  describe("site import", () => {
    /** The status an unauthenticated import request gets from the window's server. */
    async function importStatus(): Promise<number> {
      fixture.hub.openProject(null);
      const { origin } = new URL(nth(0).url);
      const response = await fetch(`${origin}/__studio__/import-site`, { method: "POST" });
      return response.status;
    }

    test("is not served when there is no browser to drive it", async () => {
      fixture = hubFixture();
      expect(await importStatus()).toBe(404);
    });

    test("is served behind the window's token when there is one", async () => {
      fixture = hubFixture({ resolveDest: (dir) => dir });
      // It writes to the filesystem, so a request without the token is refused, not routed.
      expect(await importStatus()).toBe(403);
    });
  });

  describe("dispose", () => {
    test("stops every server and the settings watch, and answers waiting dialogs as cancelled", async () => {
      fixture = hubFixture();
      fixture.hub.openProject(fixture.makeProject("a"));
      const { url } = nth(0);
      const pending = pickProjectFile();
      fixture.hub.dispose();
      expect(await pending).toBeNull();
      expect(fixture.settings.stops).toBe(1);
      expect(fixture.hub.windows()).toEqual([]);
      await expect(fetch(url)).rejects.toThrow();
      // The dialogs are no longer this hub's to answer.
      await expect(pickProjectFile()).rejects.toThrow("No file dialog configured");
    });
  });
});
