/**
 * The trust gate, over a real hub and real servers (specs/desktop.md §4.7).
 *
 * The table is the point. Every way a project can come to be bound is a row of it, so a new way
 * either joins this table or fails to compile, because a session only takes an `AuthorizedRoot`.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createProjectSession } from "../src/backend/project-session";
import { hubFixture } from "./_hub-harness";
import type { Fixture, Sent, WindowSocket } from "./_hub-harness";
import type { TrustStore } from "../src/backend/trust-store";

/** A store holding only what it was told, which records its grants. */
function memoryStore(...trusted: string[]): TrustStore & { granted: string[] } {
  const granted: string[] = [];
  return {
    grant: (root) => {
      granted.push(root);
      return Promise.resolve();
    },
    granted,
    isTrusted: (root) => Promise.resolve(trusted.includes(root) || granted.includes(root)),
  };
}

let fixture: Fixture | undefined;

afterEach(() => {
  fixture?.teardown();
  fixture = undefined;
});

function start(store: TrustStore = memoryStore()): Fixture {
  fixture = hubFixture(undefined, store);
  return fixture;
}

/** Wait for the hub to send a message of `type`, and answer with it. */
async function sentOf<T extends Fixture["sent"][number]["type"]>(
  f: Fixture,
  type: T,
): Promise<Extract<Fixture["sent"][number], { type: T }>> {
  for (let tries = 0; tries < 400; tries += 1) {
    const found = f.sent.find((message) => message.type === type);
    if (found) {
      // SAFETY: `found`'s `type` is `type`, which is all the `Extract` narrows on.
      return found as Extract<Fixture["sent"][number], { type: T }>;
    }
    await Bun.sleep(5);
  }
  throw new Error(`The hub never sent ${type}.`);
}

function answer(f: Fixture, prompt: Sent<"confirm-trust">, trusted: boolean): void {
  f.hub.handle({ requestId: prompt.requestId, trusted, type: "trust-answer" });
}

const prompts = (f: Fixture): Sent<"confirm-trust">[] =>
  f.sent.filter((message): message is Sent<"confirm-trust"> => message.type === "confirm-trust");

/** A welcome window's socket. */
async function welcomeSocket(f: Fixture): Promise<WindowSocket> {
  await f.open(null);
  const [window] = f.opened();
  return f.connect(window);
}

/** Everything that can bind a project, each to be held at the prompt until it is answered. */
const BINDERS: {
  /** Start binding `root`; the promise settles once the binder has its answer. */
  bind: (f: Fixture, root: string, socket: WindowSocket) => Promise<void>;
  name: string;
}[] = [
  {
    bind: async (f, root) => {
      await f.hub.openProject(root);
    },
    name: "hub.openProject (the menu, a switch, a window)",
  },
  {
    bind: (f, root) => {
      f.hub.handle({ root, type: "open-project" });
      return f.hub.idle();
    },
    name: "the open-project message",
  },
  {
    bind: (f, root) => {
      f.hub.handle({ path: join(root, "project.json"), type: "open-path" });
      return f.hub.idle();
    },
    name: "the open-path message (a double-click, a bare argument, a second launch)",
  },
  {
    bind: async (_f, root, socket) => {
      await socket.call("openProjectInNewWindow", { root });
    },
    name: "the openProjectInNewWindow RPC",
  },
  {
    bind: async (_f, root, socket) => {
      await socket.call("setWindowProject", { root });
    },
    name: "the setWindowProject RPC (Recent, This Window)",
  },
  {
    bind: async (f, root, socket) => {
      const opening = socket.call("openProject");
      const dialog = await sentOf(f, "dialog");
      f.hub.handle({
        path: join(root, "project.json"),
        requestId: dialog.requestId,
        type: "dialog-result",
      });
      await opening;
    },
    name: "the openProject RPC (Cmd-O, the toolbar, the welcome screen)",
  },
];

describe("every way of binding a project asks first", () => {
  describe.each(BINDERS)("$name", ({ bind }) => {
    test("binds nothing and runs nothing until it is answered, and nothing if the answer is no", async () => {
      const f = start();
      const root = f.makeProject("site");
      const marker = join(root, "ran.txt");
      writeFileSync(
        join(root, "boom.js"),
        `import { writeFileSync } from "node:fs"; export function go() { writeFileSync(${JSON.stringify(marker)}, "ran"); return 1; }`,
      );
      const socket = await welcomeSocket(f);
      const opened = bind(f, root, socket);

      const prompt = await sentOf(f, "confirm-trust");
      expect(prompt.root).toBe(realpathSync(root));
      const heldWhileAsking = f.hub.windows().map((window) => window.projectRoot);
      const rootWhileAsking = await socket.call("getProjectRoot");

      answer(f, prompt, false);
      await opened;
      await f.hub.idle();
      const heldAfter = f.hub.windows().map((window) => window.projectRoot);
      expect(heldWhileAsking).toEqual([null]);
      expect(rootWhileAsking).toEqual({ root: null });
      expect(heldAfter).toEqual([null]);
      expect(f.opened()).toHaveLength(1);

      // The route that imports project modules has no project to import from.
      const [window] = f.opened();
      const url = new URL(window.url);
      const response = await fetch(
        `${url.origin}/__jx_server__?token=${url.searchParams.get("token")}`,
        {
          body: JSON.stringify({ $export: "go", $src: "./boom.js" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        },
      );
      expect(response.ok).toBe(false);
      expect(existsSync(marker)).toBe(false);
    });

    test("binds once the answer is yes, and does not ask again", async () => {
      const store = memoryStore();
      const f = start(store);
      const root = f.makeProject("site");
      const socket = await welcomeSocket(f);
      const opened = bind(f, root, socket);
      answer(f, await sentOf(f, "confirm-trust"), true);
      await opened;
      await f.hub.idle();
      expect(f.hub.windows().map((window) => window.projectRoot)).toContain(root);
      expect(store.granted).toEqual([root]);
      expect(prompts(f)).toHaveLength(1);
    });

    test("does not ask about a folder already answered for", async () => {
      const f = start();
      const root = f.makeProject("site");
      const socket = await welcomeSocket(f);
      // Answer once through the first binder of the table, then bind again by this one.
      const first = f.hub.openProject(root);
      answer(f, await sentOf(f, "confirm-trust"), true);
      await first;
      const held = f.hub.windows().find((window) => window.projectRoot === root);
      if (held) {
        f.hub.handle({ id: held.id, type: "window-closed" });
      }
      await bind(f, root, socket);
      await f.hub.idle();
      expect(prompts(f)).toHaveLength(1);
    });
  });
});

describe("everything stays clickable while a prompt is up", () => {
  test("a path joining a window's prompt gives one window on the project", async () => {
    const f = start();
    const root = f.makeProject("site");
    const socket = await welcomeSocket(f);
    const binding = socket.call("setWindowProject", { root });
    await sentOf(f, "confirm-trust");
    f.hub.handle({ path: join(root, "project.json"), type: "open-path" });
    answer(f, await sentOf(f, "confirm-trust"), true);
    await binding;
    await f.hub.idle();
    const holders = f.hub.windows().filter((window) => window.projectRoot === root);
    expect(holders).toHaveLength(1);
  });

  test("two welcome windows asking about one folder give one window on it", async () => {
    const f = start();
    const root = f.makeProject("site");
    await f.open(null);
    await f.open(null);
    const [firstWindow, secondWindow] = f.opened();
    const first = await f.connect(firstWindow);
    const second = await f.connect(secondWindow);
    const answers = [
      first.call("setWindowProject", { root }),
      second.call("setWindowProject", { root }),
    ];
    answer(f, await sentOf(f, "confirm-trust"), true);
    const results = await Promise.all(answers);
    expect(
      results.filter((result) => JSON.stringify(result).includes('"deduped":true')),
    ).toHaveLength(1);
    const holders = f.hub.windows().filter((window) => window.projectRoot === root);
    expect(holders).toHaveLength(1);
  });

  test("a document asked for in the meantime reaches the window that won", async () => {
    const f = start();
    const root = f.makeProject("site");
    writeFileSync(join(root, "page.json"), "{}");
    const socket = await welcomeSocket(f);
    const binding = socket.call("setWindowProject", { root });
    await sentOf(f, "confirm-trust");
    f.hub.handle({ path: join(root, "page.json"), type: "open-path" });
    answer(f, await sentOf(f, "confirm-trust"), true);
    await binding;
    await f.hub.idle();
    const [window] = f.opened().slice(-1);
    const collecting = await f.connect(window);
    const held = await collecting.call("takeOpenDocuments");
    const welcomeHeld = await socket.call("takeOpenDocuments");
    expect([held, welcomeHeld].flat()).toEqual(["page.json"]);
  });

  describe("a window that binds on the same answer, through the picker", () => {
    /** The openProject RPC, held at the prompt for `root`. */
    async function pickedAndAsking(f: Fixture, root: string, socket: WindowSocket) {
      const picking = socket.call("openProject");
      const dialog = await sentOf(f, "dialog");
      f.hub.handle({
        path: join(root, "project.json"),
        requestId: dialog.requestId,
        type: "dialog-result",
      });
      const prompt = await sentOf(f, "confirm-trust");
      return { picking, prompt };
    }

    test("takes a document asked for meanwhile, rather than a second window opening", async () => {
      const f = start();
      const root = f.makeProject("site");
      writeFileSync(join(root, "page.json"), "{}");
      const socket = await welcomeSocket(f);
      const { picking, prompt } = await pickedAndAsking(f, root, socket);
      f.hub.handle({ path: join(root, "page.json"), type: "open-path" });
      answer(f, prompt, true);
      await picking;
      await f.hub.idle();
      expect(f.opened()).toHaveLength(1);
      const held = await socket.call("takeOpenDocuments");
      expect(held).toEqual(["page.json"]);
    });

    test("is raised for an open that names no document", async () => {
      const f = start();
      const root = f.makeProject("site");
      const socket = await welcomeSocket(f);
      const { picking, prompt } = await pickedAndAsking(f, root, socket);
      const joining = f.hub.openProject(root);
      answer(f, prompt, true);
      await picking;
      const outcome = await joining;
      expect(outcome).toEqual({ focused: true });
      expect(f.opened()).toHaveLength(1);
      expect(f.sent).toContainEqual({ id: 1, type: "focus-window" });
    });
  });

  test("a window closed during its prompt is not brought back by the answer", async () => {
    const f = start();
    const root = f.makeProject("site");
    const socket = await welcomeSocket(f);
    const binding = socket.call("setWindowProject", { root });
    const prompt = await sentOf(f, "confirm-trust");
    f.hub.handle({ id: 1, type: "window-closed" });
    const before = f.sent.length;
    answer(f, prompt, true);
    await Bun.sleep(30);
    expect(f.sent.slice(before)).toEqual([]);
    expect(f.hub.windows()).toEqual([]);
    socket.close();
    expect(binding).toBeDefined();
  });
});

describe("what a decline reaches", () => {
  test("the RPCs say declined, so Studio can report what actually happened", async () => {
    const f = start();
    const root = f.makeProject("site");
    const socket = await welcomeSocket(f);

    const inNewWindow = socket.call("openProjectInNewWindow", { root });
    answer(f, await sentOf(f, "confirm-trust"), false);
    expect(await inNewWindow).toEqual({ declined: true, focused: false });

    f.sent.length = 0;
    const inThisWindow = socket.call("setWindowProject", { root });
    answer(f, await sentOf(f, "confirm-trust"), false);
    expect(await inThisWindow).toEqual({ config: null, declined: true, deduped: false });
  });

  test("the openProject RPC reads as a cancelled pick", async () => {
    const f = start();
    const root = f.makeProject("site");
    const socket = await welcomeSocket(f);
    const opening = socket.call("openProject");
    const dialog = await sentOf(f, "dialog");
    f.hub.handle({
      path: join(root, "project.json"),
      requestId: dialog.requestId,
      type: "dialog-result",
    });
    answer(f, await sentOf(f, "confirm-trust"), false);
    expect(await opening).toBeNull();
  });

  test("a cold launch declined ends the app, and one with a window open does not", async () => {
    const cold = start();
    const root = cold.makeProject("site");
    cold.hub.handle({ path: join(root, "project.json"), type: "open-path" });
    answer(cold, await sentOf(cold, "confirm-trust"), false);
    await sentOf(cold, "quit");
    cold.teardown();

    const warm = start();
    const other = warm.makeProject("site");
    await warm.open(null);
    warm.hub.handle({ path: join(other, "project.json"), type: "open-path" });
    answer(warm, await sentOf(warm, "confirm-trust"), false);
    await warm.hub.idle();
    await Bun.sleep(400);
    expect(warm.sent.some((message) => message.type === "quit")).toBe(false);
  });
});

describe("while a prompt is up", () => {
  test("a second double-click joins it: one prompt, one window, both documents", async () => {
    const f = start();
    const root = f.makeProject("site");
    writeFileSync(join(root, "a.json"), "{}");
    writeFileSync(join(root, "b.json"), "{}");
    f.hub.handle({ path: join(root, "a.json"), type: "open-path" });
    f.hub.handle({ path: join(root, "b.json"), type: "open-path" });
    const prompt = await sentOf(f, "confirm-trust");
    expect(prompts(f)).toHaveLength(1);
    answer(f, prompt, true);
    await f.hub.idle();
    expect(f.opened()).toHaveLength(1);
    const [window] = f.opened();
    const socket = await f.connect(window);
    const first = await socket.call("takeOpenDocuments");
    const second = await socket.call("takeOpenDocuments");
    expect(first).toEqual(["a.json", "b.json"]);
    expect(second).toEqual([]);
  });

  test("two windows asking about one folder see one prompt, and both hear the answer", async () => {
    const f = start();
    const root = f.makeProject("site");
    const socket = await welcomeSocket(f);
    const first = socket.call("setWindowProject", { root });
    const second = socket.call("openProjectInNewWindow", { root });
    const prompt = await sentOf(f, "confirm-trust");
    await Bun.sleep(20);
    expect(prompts(f)).toHaveLength(1);
    answer(f, prompt, false);
    expect(await first).toMatchObject({ declined: true });
    expect(await second).toMatchObject({ declined: true });
  });

  test("the hub going away answers no, so nothing is left waiting", async () => {
    const f = start();
    const root = f.makeProject("site");
    const opening = f.hub.openProject(root);
    await sentOf(f, "confirm-trust");
    f.hub.dispose();
    expect(await opening).toEqual({ declined: true, focused: false });
  });

  test("an answer to a prompt nobody asked is ignored", () => {
    const f = start();
    expect(() =>
      f.hub.handle({ requestId: 99, trusted: true, type: "trust-answer" }),
    ).not.toThrow();
  });
});

describe("when the hub cannot go on", () => {
  test("after it has gone, nothing is asked and nothing opens", async () => {
    const f = start();
    const root = f.makeProject("site");
    f.hub.dispose();
    const outcome = await f.hub.openProject(root);
    expect(outcome).toEqual({ declined: true, focused: false });
    expect(prompts(f)).toEqual([]);
  });

  test("a store that cannot answer opens nothing, says so, and ends a cold launch", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const f = start({
      grant: () => Promise.resolve(),
      isTrusted: () => Promise.reject(new Error("no store")),
    });
    const root = f.makeProject("site");
    const outcome = await f.hub.openProject(root);
    expect(outcome).toEqual({ focused: false });
    expect(f.hub.windows()).toEqual([]);
    expect(String(errors.mock.calls[0]?.[0])).toContain("opening a window failed");
    errors.mockRestore();
    await sentOf(f, "quit");
  });

  test("several refused paths in a row end the launch once", async () => {
    const f = start();
    f.hub.handle({ path: "/definitely/not/here/a.json", type: "open-path" });
    f.hub.handle({ path: "/definitely/not/here/b.json", type: "open-path" });
    await sentOf(f, "quit");
    await Bun.sleep(350);
    expect(f.sent.filter((message) => message.type === "quit")).toHaveLength(1);
    expect(f.sent.filter((message) => message.type === "notice")).toHaveLength(2);
  });
});

describe("what the prompt names", () => {
  test("the folder a symlink points at, and not the link's own name", async () => {
    const f = start();
    const root = f.makeProject("real");
    const link = join(root, "..", "trust-me");
    mkdirSync(join(root, "..", "unused"), { recursive: true });
    symlinkSync(root, link);
    const opening = f.hub.openProject(link);
    const prompt = await sentOf(f, "confirm-trust");
    expect(prompt.root).toBe(realpathSync(root));
    answer(f, prompt, false);
    await opening;
  });
});

describe("a store that cannot be written", () => {
  test("costs a second prompt next time, and not this open", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const f = start({
      grant: () => Promise.reject(new Error("read-only")),
      isTrusted: () => Promise.resolve(false),
    });
    const root = f.makeProject("site");
    const opening = f.hub.openProject(root);
    answer(f, await sentOf(f, "confirm-trust"), true);
    await opening;
    expect(f.hub.windows().map((window) => window.projectRoot)).toEqual([root]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  test("does not stop a project the application just created", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    const f = start({
      grant: () => Promise.reject(new Error("read-only")),
      isTrusted: () => Promise.resolve(false),
    });
    const parent = f.makeProject("parent");
    const socket = await welcomeSocket(f);
    const created = await socket.call("createProject", {
      destination: { kind: "path", parent },
      directory: "made",
      name: "Made",
    });
    expect(created).toMatchObject({ root: join(parent, "made") });
    errors.mockRestore();
  });
});

describe("a project the application created", () => {
  test("is remembered with nothing to ask", async () => {
    const store = memoryStore();
    const f = start(store);
    const parent = f.makeProject("parent");
    const socket = await welcomeSocket(f);
    const created = await socket.call("createProject", {
      destination: { kind: "path", parent },
      directory: "made",
      name: "Made",
    });
    const root = join(parent, "made");
    expect(created).toMatchObject({ root });
    expect(store.granted).toEqual([root]);
    expect(prompts(f)).toEqual([]);
  });
});

describe("paths the hub cannot open", () => {
  test("a refused path alone ends a cold launch", async () => {
    const f = start();
    f.hub.handle({ path: "/definitely/not/here/x.json", type: "open-path" });
    const notice = await sentOf(f, "notice");
    expect(notice.message).toContain("can't find");
    await sentOf(f, "quit");
    expect(f.opened()).toEqual([]);
  });

  test("a refused path beside one that opens does not end the launch", async () => {
    const f = start(memoryStore());
    const root = f.makeProject("site");
    f.hub.handle({ path: "/definitely/not/here/x.json", type: "open-path" });
    f.hub.handle({ path: join(root, "project.json"), type: "open-path" });
    answer(f, await sentOf(f, "confirm-trust"), true);
    await f.hub.idle();
    await Bun.sleep(400);
    expect(f.sent.some((message) => message.type === "quit")).toBe(false);
    expect(f.opened()).toHaveLength(1);
  });

  test("a project file with a typo opens, and the user hears why it may not load", async () => {
    const f = start(memoryStore());
    const root = f.makeProject("site");
    writeFileSync(join(root, "project.json"), "{ oops");
    f.hub.handle({ path: join(root, "project.json"), type: "open-path" });
    const notice = await sentOf(f, "notice");
    expect(notice.message).toContain("can't read");
    answer(f, await sentOf(f, "confirm-trust"), true);
    await f.hub.idle();
    expect(f.opened()).toHaveLength(1);
  });
});

describe("a path into a project already open", () => {
  test("raises its window and queues the document, telling the page to collect it", async () => {
    const f = start();
    const root = f.makeProject("site");
    writeFileSync(join(root, "page.json"), "{}");
    const opening = f.hub.openProject(root);
    answer(f, await sentOf(f, "confirm-trust"), true);
    await opening;
    const [window] = f.opened();
    const socket = await f.connect(window);
    const pushed = socket.push("documentsPending");
    f.hub.handle({ path: join(root, "page.json"), type: "open-path" });
    await pushed;
    expect(f.sent.some((message) => message.type === "focus-window")).toBe(true);
    expect(prompts(f)).toHaveLength(1);
    expect(f.opened()).toHaveLength(1);
    expect(await socket.call("takeOpenDocuments")).toEqual(["page.json"]);
  });
});

describe("what the shell hears a window holds", () => {
  test("window-root follows the window, including when it is re-rooted", async () => {
    const f = start(memoryStore());
    const root = f.makeProject("site");
    const socket = await welcomeSocket(f);
    expect(f.sent).toContainEqual({ id: 1, root: null, type: "window-root" });
    const binding = socket.call("setWindowProject", { root });
    answer(f, await sentOf(f, "confirm-trust"), true);
    await binding;
    expect(f.sent).toContainEqual({ id: 1, root, type: "window-root" });
  });
});

/**
 * Never called. This is the compile-time half of the gate, which `tsc` holds: a session cannot be
 * bound to a folder nobody has answered for, so a new way of opening a project cannot forget to
 * ask.
 */
export function aSessionTakesOnlyAnAnsweredRoot(): void {
  // @ts-expect-error A plain string is not an AuthorizedRoot.
  createProjectSession("/some/folder");
  // @ts-expect-error A plain string is not an AuthorizedRoot.
  createProjectSession(null).setProjectRoot("/some/folder");
}
