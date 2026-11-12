/**
 * Remote data on the editing canvas (studio.md §4.5), end to end through the canvas frame: a `GET`
 * request and a `timing: "server"` function each run once and are kept, a request that writes never
 * runs, and a binding with no value says which of the three reasons it has none.
 *
 * The frame is the real one, over a fake channel, with `fetch` replaced: what is counted is what
 * the frame's runtime actually asked the network for.
 */
import "./with-dom.js";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { fakeChannelPair } from "../src/canvas/iframe-channel";
import { startCanvasIframe } from "../src/canvas/iframe-entry";
import { remoteKey } from "../src/canvas/iframe-remote";
import { prepareForEditMode } from "../src/utils/edit-display";
import { stripEventHandlers } from "../src/utils/strip-events";
import type {
  CanvasMode,
  IframeToParent,
  ParentToIframe,
  RemoteWire,
} from "../src/canvas/iframe-protocol";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";

type RenderMsg = Extract<ParentToIframe, { kind: "render" }>;
type Posted<K extends IframeToParent["kind"]> = Extract<IframeToParent, { kind: K }>;

/** One request the frame made. */
interface Call {
  url: string;
  method: string;
  /** Answer it. A test that never calls either leaves the request hanging. */
  answer: (value: JsonValue) => void;
  fail: (status: number, statusText: string) => void;
}

/** Every request made since the last {@link stubFetch}. */
let calls: Call[] = [];
const realFetch = global.fetch;

/**
 * Replace `fetch`. With `auto`, each request is answered at once from it (a `Response`, or JSON);
 * without, each stays pending until the test settles it.
 */
function stubFetch(auto?: (url: string, method: string) => JsonValue | Response): void {
  calls = [];
  const { preconnect } = realFetch;
  const fetchMock = mock((input: string | URL | Request, init?: RequestInit) => {
    const { promise, resolve } = Promise.withResolvers<Response>();
    const call: Call = {
      answer: (value) => resolve(Response.json(value)),
      fail: (status, statusText) => resolve(new Response(null, { status, statusText })),
      method: init?.method ?? "GET",
      url: String(input),
    };
    calls.push(call);
    if (auto) {
      const answer = auto(call.url, call.method);
      resolve(answer instanceof Response ? answer : Response.json(answer));
    }
    return promise;
  });
  global.fetch = Object.assign(fetchMock, { preconnect });
}

/** Let the frame's timers and the promises behind them run. */
const wait = (ms = 5) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A frame under test. */
interface Frame {
  container: HTMLElement;
  of: <K extends IframeToParent["kind"]>(kind: K) => Posted<K>[];
  /** The kind of every message the frame has posted, in order. */
  kinds: () => IframeToParent["kind"][];
  /** The last `bindingStatus` the frame posted. */
  status: () => Posted<"bindingStatus">;
  send: (msg: ParentToIframe) => Promise<void>;
  /** Draw `doc`, with `remote` as the render's remote data (null sends none). */
  render: (doc: JxMutableNode, remote?: Partial<RemoteWire> | null) => Promise<void>;
}

let teardown: (() => void) | undefined;
afterEach(() => {
  teardown?.();
  teardown = undefined;
  document.body.innerHTML = "";
  global.fetch = realFetch;
});

/** The remote data a host with a backend sends the tab's one frame at the start of a session. */
const SESSION: RemoteWire = { fetch: true, results: {}, server: true, session: "tab:0" };

/** Boot a frame. Nothing is drawn until `render`. */
function bootFrame(mode: CanvasMode = "edit"): Frame {
  const pair = fakeChannelPair<ParentToIframe, IframeToParent>();
  const posted: IframeToParent[] = [];
  pair.parent.onMessage((m) => posted.push(m));
  const container = document.createElement("div");
  document.body.append(container);
  const stop = startCanvasIframe({ channel: pair.iframe, container });
  const earlier = teardown;
  teardown = () => {
    stop();
    earlier?.();
  };
  let gen = 0;
  const send = async (msg: ParentToIframe): Promise<void> => {
    pair.parent.post(msg);
    pair.flush();
    await wait();
    pair.flush();
    await wait();
    pair.flush();
  };
  const of: Frame["of"] = (kind) => {
    // The channel is a queue: what the frame posted since is delivered before it is read.
    pair.flush();
    return posted.filter((m): m is Posted<typeof kind> => m.kind === kind);
  };
  pair.flush();
  return {
    container,
    kinds: () => {
      pair.flush();
      return posted.map((m) => m.kind);
    },
    of,
    render: (doc, remote = {}) => {
      gen += 1;
      const raw = structuredClone(doc);
      const drawn = mode === "preview" ? raw : prepareForEditMode(stripEventHandlers(raw));
      const msg: RenderMsg = {
        colorScheme: null,
        doc: structuredClone(drawn),
        docBase: "http://localhost:3000/",
        gen,
        kind: "render",
        mapperCtx: {
          canvasMode: mode,
          layoutWrapped: false,
          pageContentOffset: null,
          pageContentPrefix: null,
        },
        mode,
        shadowDoc: structuredClone(raw),
        siteStyle: null,
      };
      if (remote !== null) {
        msg.remote = { ...SESSION, ...remote };
      }
      return send(msg);
    },
    send,
    status: () => {
      const last = of("bindingStatus").at(-1);
      if (!last) {
        throw new Error("the frame posted no bindingStatus");
      }
      return last;
    },
  };
}

/** The chip drawn in the element with `id`. */
function chipIn(frame: Frame, id: string): HTMLElement {
  const chip = frame.container.querySelector<HTMLElement>(`#${id} [data-jx-tag]`);
  if (!chip) {
    throw new Error(`no chip in #${id}`);
  }
  return chip;
}

/** A page that reads one `GET` request in a paragraph and in a list. */
const page = (url = "/api/posts"): JxMutableNode => ({
  children: [
    { attributes: { id: "count" }, tagName: "p", textContent: "Posts: ${state.posts.length}" },
    {
      children: [
        {
          $prototype: "Array",
          items: { $ref: "#/state/posts" },
          map: { tagName: "li", textContent: "${item.title}" },
        },
      ],
      tagName: "ul",
    },
  ],
  state: { posts: { $prototype: "Request", url } },
  tagName: "main",
});

const POSTS = [{ title: "Alpha" }, { title: "Beta" }];

describe("a GET request on the editing canvas", () => {
  test("fires once across two full renders, and again after Refresh", async () => {
    stubFetch(() => POSTS);
    const frame = bootFrame();
    await frame.render(page());
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["GET /api/posts"]);
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect([...frame.container.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);

    // A second full render, as any structural edit causes: the same session, so nothing is asked.
    await frame.render(page());
    expect(calls).toHaveLength(1);
    expect(chipIn(frame, "count").textContent).toBe("2");

    // Refresh starts another session, which holds nothing: the request runs again, once.
    await frame.render(page(), { session: "tab:1" });
    await frame.render(page(), { session: "tab:1" });
    expect(calls).toHaveLength(2);
  });

  test("the answer goes to the host, and a render that carries it back asks for nothing", async () => {
    stubFetch(() => POSTS);
    const frame = bootFrame();
    await frame.render(page());
    const settled = frame.of("remoteSettled");
    expect(settled).toHaveLength(1);
    expect(settled[0]).toEqual({
      key: remoteKey({ kind: "request", request: { method: "GET", url: "/api/posts" } }),
      kind: "remoteSettled",
      result: { ok: true, value: POSTS },
      session: "tab:0",
    });

    // Another frame of the tab, or this one after a reload: seeded, it never touches the network.
    stubFetch(() => "refetched");
    const second = bootFrame();
    await second.render(page(), { results: { [settled[0]!.key]: settled[0]!.result } });
    expect(calls).toHaveLength(0);
    expect(chipIn(second, "count").textContent).toBe("2");
    expect(second.of("remoteSettled")).toHaveLength(0);
  });

  test("a changed definition is another lookup; the old one is still kept", async () => {
    stubFetch((url) => (url.endsWith("2") ? [...POSTS, { title: "Gamma" }] : POSTS));
    const frame = bootFrame();
    await frame.render(page("/api/posts"));
    await frame.render(page("/api/posts?page=2"));
    expect(calls.map((call) => call.url)).toEqual(["/api/posts", "/api/posts?page=2"]);
    expect(chipIn(frame, "count").textContent).toBe("3");
    // Back to the first definition: its answer was never thrown away.
    await frame.render(page("/api/posts"));
    expect(calls).toHaveLength(2);
    expect(chipIn(frame, "count").textContent).toBe("2");
  });

  test("a request that has not answered blocks nothing, and its bindings say they are loading", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(page());
    // The render is done and acknowledged while the request is still out.
    expect(frame.of("renderComplete")).toHaveLength(1);
    expect(calls).toHaveLength(1);
    const chip = chipIn(frame, "count");
    expect(chip.dataset.jxStatus).toBe("pending");
    expect(chip.dataset.jxStatusNote).toBe("Loading");
    // Never the expression: the chip is empty, and what it says is drawn from its attributes.
    expect(chip.textContent).toBe("");
    expect(frame.status().entries).toEqual({ posts: { status: "pending" } });
    // The list has no items yet, so it draws its template row, which says why.
    const row = frame.container.querySelector<HTMLElement>("[data-jx-template-row]");
    expect(row?.dataset.jxStatus).toBe("pending");

    calls[0]!.answer(POSTS);
    await wait();
    await wait();
    expect(chipIn(frame, "count").dataset.jxStatus).toBeUndefined();
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect(frame.status().entries).toEqual({ posts: { status: "resolved" } });
    expect(frame.container.querySelector("[data-jx-template-row]")).toBeNull();
  });

  test("a failure is an answer: reported with its reason, kept, and never retried by a render", async () => {
    stubFetch(() => new Response(null, { status: 404, statusText: "Not Found" }));
    const frame = bootFrame();
    await frame.render(page());
    expect(frame.of("renderComplete")).toHaveLength(1);
    expect(frame.status().entries).toEqual({ posts: { error: "Not Found", status: "failed" } });
    const chip = chipIn(frame, "count");
    expect(chip.dataset.jxStatus).toBe("failed");
    expect(chip.dataset.jxStatusNote).toBe("Could not load");
    expect(chip.getAttribute("title")).toBe("Not Found");
    expect(frame.status().bindings.find((b) => b.source === "${state.posts.length}")).toEqual({
      error: "Not Found",
      path: ["children", 0],
      source: "${state.posts.length}",
      status: "failed",
    });
    expect(frame.of("remoteSettled")[0]!.result).toEqual({ error: "Not Found", ok: false });

    await frame.render(page());
    expect(calls).toHaveLength(1);
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("failed");
  });

  test("a frame that is not the tab's fetcher waits, and is written when the host passes the answer on", async () => {
    stubFetch(() => "must not be asked");
    const frame = bootFrame();
    await frame.render(page(), { fetch: false });
    expect(calls).toHaveLength(0);
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");

    const key = remoteKey({ kind: "request", request: { method: "GET", url: "/api/posts" } });
    // An answer for another session is not this document's.
    await frame.send({
      kind: "remoteResults",
      results: { [key]: { ok: true, value: [] } },
      session: "other:0",
    });
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
    await frame.send({
      kind: "remoteResults",
      results: { [key]: { ok: true, value: POSTS } },
      session: "tab:0",
    });
    expect(calls).toHaveLength(0);
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect(chipIn(frame, "count").dataset.jxStatus).toBeUndefined();
    // It reports nothing back: the answer was never its own.
    expect(frame.of("remoteSettled")).toHaveLength(0);
  });

  test("named the fetcher after it waited, the frame fetches at its next render", async () => {
    stubFetch(() => POSTS);
    const frame = bootFrame();
    await frame.render(page(), { fetch: false });
    expect(calls).toHaveLength(0);
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
    // The artboard that fetched for the tab is gone, and the host names this one: same session.
    await frame.render(page(), { fetch: true });
    expect(calls.map((call) => call.url)).toEqual(["/api/posts"]);
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect(frame.status().entries).toEqual({ posts: { status: "resolved" } });
    expect(frame.of("remoteSettled")).toHaveLength(1);
  });

  test("handed another tab's document and then this one again, the frame keeps the request it had out", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(page());
    expect(calls).toHaveLength(1);
    // The pane shows another tab, and comes back, while the request is still out.
    await frame.render({ tagName: "main", textContent: "About" }, { session: "about:0" });
    await frame.render(page());
    expect(calls).toHaveLength(1);
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
    calls[0]!.answer(POSTS);
    await wait();
    await wait();
    // One request, one answer, and it is the one the host is told and the canvas draws.
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect(frame.of("remoteSettled").map((m) => [m.session, m.result])).toEqual([
      ["tab:0", { ok: true, value: POSTS }],
    ]);
  });

  test("an answer that lands while the frame draws another tab is reported for the tab that asked", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(page());
    await frame.render({ tagName: "main", textContent: "About" }, { session: "about:0" });
    calls[0]!.answer(POSTS);
    await wait();
    expect(frame.of("remoteSettled").map((m) => m.session)).toEqual(["tab:0"]);
  });

  test("a render with no remote data starts nothing, as a frame never did outside Preview", async () => {
    stubFetch(() => POSTS);
    const frame = bootFrame();
    await frame.render(page(), null);
    expect(calls).toHaveLength(0);
    expect(frame.of("bindingStatus")).toHaveLength(0);
    expect(frame.container.querySelector("[data-jx-status]")).toBeNull();
  });

  test("Preview runs the request as the page does, on every render, with no status drawn", async () => {
    stubFetch(() => POSTS);
    const frame = bootFrame("preview");
    await frame.render(page());
    await frame.render(page());
    expect(calls).toHaveLength(2);
    expect(frame.of("bindingStatus")).toHaveLength(0);
  });
});

describe("a binding is marked again when its answer arrives", () => {
  /** A page with no list: nothing redraws itself when the answer lands, only the chip's text. */
  const chipOnly = (): JxMutableNode => ({
    children: [
      { attributes: { id: "count" }, tagName: "p", textContent: "Posts: ${state.posts.length}" },
    ],
    state: { posts: { $prototype: "Request", url: "/api/posts" } },
    tagName: "main",
  });

  test("in the frame that fetched it", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(chipOnly());
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
    calls[0]!.answer(POSTS);
    await wait();
    await wait();
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect(chipIn(frame, "count").dataset.jxStatus).toBeUndefined();
    // The report that ends the Data panel's Refresh.
    expect(frame.status().entries).toEqual({ posts: { status: "resolved" } });
  });

  test("in a frame the host passes the answer to", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(chipOnly(), { fetch: false });
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
    await frame.send({
      kind: "remoteResults",
      results: {
        [remoteKey({ kind: "request", request: { method: "GET", url: "/api/posts" } })]: {
          ok: true,
          value: POSTS,
        },
      },
      session: "tab:0",
    });
    expect(chipIn(frame, "count").textContent).toBe("2");
    expect(chipIn(frame, "count").dataset.jxStatus).toBeUndefined();
    expect(frame.status().entries).toEqual({ posts: { status: "resolved" } });
  });
});

describe("the frame's report of where its bindings stand", () => {
  test("carries its render's generation, and every render reports even when nothing changed", async () => {
    stubFetch(() => POSTS);
    const frame = bootFrame();
    await frame.render(page());
    // Once with the request out, once with its answer: both of the first render.
    expect(frame.of("bindingStatus").map((m) => m.gen)).toEqual([1, 1]);
    // The same document again, from the kept answer: the same report, of another render.
    await frame.render(page());
    expect(frame.of("bindingStatus").map((m) => m.gen)).toEqual([1, 1, 2]);
  });

  test("is posted before the scope, which is what the host ends a Refresh on", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(page());
    const kinds = frame.kinds();
    const at = (kind: IframeToParent["kind"]) => kinds.indexOf(kind);
    expect(at("renderComplete")).toBeGreaterThan(-1);
    expect(at("bindingStatus")).toBeGreaterThan(at("renderComplete"));
    expect(at("dataScope")).toBeGreaterThan(at("bindingStatus"));
  });

  test("is not posted again by a patch that changes no binding's standing", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(page());
    expect(frame.of("bindingStatus")).toHaveLength(1);
    await frame.send({
      forwardOps: [{ key: "hidden", op: "set-key", path: ["children", 1], value: true }],
      gen: 1,
      kind: "patch",
    });
    expect(frame.of("patchComplete")).toHaveLength(1);
    expect(frame.of("bindingStatus")).toHaveLength(1);
  });
});

describe("a chip in a row", () => {
  test("is judged against its own row: an empty value is empty, not a failure", async () => {
    stubFetch(() => [{ title: "" }, { title: "Beta" }]);
    const frame = bootFrame();
    await frame.render(page());
    const chips = [...frame.container.querySelectorAll<HTMLElement>("li [data-jx-tag]")];
    expect(chips.map((chip) => chip.textContent)).toEqual(["", "Beta"]);
    // Asked of the document's scope, `item` is not there and the empty chip would read as failed.
    expect(chips.map((chip) => chip.dataset.jxStatus)).toEqual([undefined, undefined]);
    expect(chips.map((chip) => chip.hasAttribute("title"))).toEqual([false, false]);
  });

  test("in an echo row is reported under the template's path, like the first row's", async () => {
    stubFetch((url) =>
      url === "/bad" ? new Response(null, { status: 500, statusText: "Boom" }) : POSTS,
    );
    const frame = bootFrame();
    await frame.render({
      children: [
        { tagName: "p", textContent: "Posts" },
        {
          children: [
            {
              $prototype: "Array",
              items: { $ref: "#/state/posts" },
              map: { tagName: "li", textContent: "${item.title} / ${state.bad?.x}" },
            },
          ],
          tagName: "ul",
        },
      ],
      state: {
        bad: { $prototype: "Request", url: "/bad" },
        posts: { $prototype: "Request", url: "/api/posts" },
      },
      tagName: "main",
    });
    const inRows = frame.status().bindings.filter((b) => b.source === "${state.bad?.x}");
    expect(inRows.map((b) => [b.path, b.status])).toEqual([
      [["children", 1, "children", 0, "map"], "failed"],
      [["children", 1, "children", 0, "map"], "failed"],
    ]);
  });
});

describe("a document with no remote data", () => {
  const local: JxMutableNode = {
    children: [
      { attributes: { id: "user" }, tagName: "p", textContent: "User: ${state.user.name} end" },
      {
        children: [
          {
            $prototype: "Array",
            items: { $ref: "#/state/list" },
            map: { tagName: "li", textContent: "Row ${item.title} of ${item.owner.name}" },
          },
        ],
        tagName: "ul",
      },
    ],
    state: { list: [], user: null },
    tagName: "main",
  };

  test("an empty list's template row draws its chips by name, with no failure on any of them", async () => {
    stubFetch();
    const frame = bootFrame();
    const { warn } = console;
    console.warn = mock();
    try {
      await frame.render(local);
    } finally {
      console.warn = warn;
    }
    const row = frame.container.querySelector<HTMLElement>("[data-jx-template-row]");
    expect(row).not.toBeNull();
    const chips = [...row!.querySelectorAll<HTMLElement>("[data-jx-tag]")];
    expect(chips).toHaveLength(2);
    expect(chips.map((chip) => chip.dataset.jxStatus)).toEqual([undefined, undefined]);
    expect(chips.map((chip) => chip.hasAttribute("title"))).toEqual([false, false]);
    // The row itself keeps "No items": no reason to give.
    expect(row!.dataset.jxStatus).toBeUndefined();
    // A chip outside a row whose expression throws is said to have an error, not to have failed to load.
    const user = chipIn(frame, "user");
    expect(user.dataset.jxStatus).toBe("failed");
    expect(user.dataset.jxStatusNote).toBe("Has an error");
    expect(calls).toHaveLength(0);
  });

  test("a template row of a list still loading says Loading, and its chips say nothing of their own", async () => {
    stubFetch();
    const frame = bootFrame();
    const { warn } = console;
    console.warn = mock();
    try {
      await frame.render(page());
    } finally {
      console.warn = warn;
    }
    const row = frame.container.querySelector<HTMLElement>("[data-jx-template-row]");
    expect(row?.dataset.jxStatus).toBe("pending");
    const chip = row!.querySelector<HTMLElement>("[data-jx-tag]");
    expect(chip?.dataset.jxStatus).toBeUndefined();
    expect(chip?.hasAttribute("title")).toBe(false);
  });
});

describe("a request held up by another", () => {
  test("says it failed when the one its URL reads failed, not that the canvas does not run it", async () => {
    stubFetch(() => new Response(null, { status: 500, statusText: "Boom" }));
    const frame = bootFrame();
    await frame.render({
      children: [{ attributes: { id: "n" }, tagName: "p", textContent: "${state.posts?.length}" }],
      state: {
        me: { $prototype: "Request", url: "/api/me" },
        posts: { $prototype: "Request", url: "/api/posts/${state.me?.id}" },
      },
      tagName: "main",
    });
    expect(calls.map((call) => call.url)).toEqual(["/api/me"]);
    expect(frame.status().entries).toEqual({
      me: { error: "Boom", status: "failed" },
      posts: { error: "Boom", status: "failed" },
    });
    expect(chipIn(frame, "n").dataset.jxStatus).toBe("failed");
    expect(chipIn(frame, "n").dataset.jxStatusNote).toBe("Could not load");
  });
});

describe("what the editing canvas does not run", () => {
  const writing: JxMutableNode = {
    children: [
      { attributes: { id: "saved" }, tagName: "p", textContent: "Saved as ${state.saved.id}" },
      { attributes: { id: "sent" }, tagName: "p", textContent: "${state.sent?.id ?? 'none'}" },
      { attributes: { id: "later" }, tagName: "p", textContent: "${state.later?.id}" },
    ],
    state: {
      later: { $prototype: "Request", manual: true, url: "/api/later" },
      saved: { $prototype: "Request", body: { title: "x" }, method: "POST", url: "/api/save" },
      sent: { $prototype: "Request", method: "delete", url: "/api/item/1" },
    },
    tagName: "main",
  };

  test("a request that is not a GET never fires, on any render, and reads Runs on the live page", async () => {
    stubFetch(() => ({ id: 1 }));
    const frame = bootFrame();
    await frame.render(writing);
    await frame.render(writing);
    await frame.render(writing, { session: "tab:1" });
    expect(calls).toHaveLength(0);
    expect(frame.status().entries).toEqual({
      later: { status: "not-run" },
      saved: { status: "not-run" },
      sent: { status: "not-run" },
    });
    const chip = chipIn(frame, "saved");
    expect(chip.dataset.jxStatus).toBe("not-run");
    expect(chip.dataset.jxStatusNote).toBe("Runs on the live page");
    expect(chip.textContent).toBe("");
    // A binding that has a value all the same is still marked: the value is not the page's.
    expect(chipIn(frame, "sent").textContent).toBe("none");
    expect(chipIn(frame, "sent").dataset.jxStatus).toBe("not-run");
    // A `manual` request waits for a handler the canvas strips.
    expect(chipIn(frame, "later").dataset.jxStatus).toBe("not-run");
    expect(frame.of("remoteSettled")).toHaveLength(0);
  });

  test("a method fetch would coerce into a write is not sent: an array holding POST or DELETE", async () => {
    stubFetch(() => ({ id: 1 }));
    const frame = bootFrame();
    for (const method of [["POST"], ["DELETE"], 7, { verb: "GET" }]) {
      /* SAFETY: deliberately NOT a valid document. A `method` that is no string is what the schema
         refuses and the canvas is handed anyway, so the cast is the case under test. */
      await frame.render({
        children: [{ attributes: { id: "n" }, tagName: "p", textContent: "${state.posts?.id}" }],
        // Not what the schema allows, and the canvas draws the document as written all the same.
        state: { posts: { $prototype: "Request", method, url: "/api/posts" } },
        tagName: "main",
      } as JxMutableNode);
      expect(frame.status().entries).toEqual({ posts: { status: "not-run" } });
    }
    expect(calls).toHaveLength(0);
  });

  const serverPage: JxMutableNode = {
    children: [{ attributes: { id: "total" }, tagName: "p", textContent: "${state.total.sum}" }],
    state: {
      total: { $export: "sum", $src: "./sum.js", arguments: { a: 1 }, timing: "server" },
    },
    tagName: "main",
  };

  test("a server function is called once through the host's proxy, and kept", async () => {
    stubFetch(() => ({ sum: 3 }));
    const frame = bootFrame();
    await frame.render(serverPage);
    await frame.render(serverPage);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual(["POST /__jx_server__"]);
    expect(chipIn(frame, "total").textContent).toBe("3");
    expect(frame.status().entries).toEqual({ total: { status: "resolved" } });
  });

  test("on a host with no backend it is not called at all, and is not run rather than failed", async () => {
    stubFetch(() => ({ sum: 3 }));
    const frame = bootFrame();
    await frame.render(serverPage, { server: false });
    expect(calls).toHaveLength(0);
    expect(frame.of("renderComplete")).toHaveLength(1);
    expect(frame.status().entries).toEqual({ total: { status: "not-run" } });
    expect(chipIn(frame, "total").dataset.jxStatusNote).toBe("Runs on the live page");
  });

  test("a frame waiting for another's answer logs nothing when its session ends", async () => {
    stubFetch(() => ({ sum: 3 }));
    const frame = bootFrame();
    const errors = mock();
    const { error } = console;
    console.error = errors;
    try {
      const both = structuredClone(serverPage);
      both.state = { ...both.state, posts: { $prototype: "Request", url: "/api/posts" } };
      await frame.render(both, { fetch: false });
      // A Refresh: the waits of the session that is over are ended, and that is no failure.
      await frame.render(both, { fetch: false, session: "tab:1" });
      await wait();
    } finally {
      console.error = error;
    }
    expect(calls).toHaveLength(0);
    expect(errors.mock.calls).toEqual([]);
  });

  test("one that needs what the host lacks fails into the failed state, and the page still draws", async () => {
    stubFetch(() => new Response(null, { status: 500 }));
    const frame = bootFrame();
    const errors = mock();
    const { error } = console;
    console.error = errors;
    try {
      await frame.render(serverPage);
    } finally {
      console.error = error;
    }
    expect(frame.of("renderComplete")).toHaveLength(1);
    expect(frame.of("renderError")).toHaveLength(0);
    expect(frame.status().entries).toEqual({
      total: { error: 'Jx server proxy 500 for "total"', status: "failed" },
    });
    expect(chipIn(frame, "total").dataset.jxStatus).toBe("failed");
  });
});

describe("a binding whose own expression fails", () => {
  test("one throwing expression inside a longer template is reported on its chip alone", async () => {
    stubFetch();
    const frame = bootFrame();
    const { warn } = console;
    console.warn = mock();
    try {
      await frame.render({
        children: [
          {
            attributes: { id: "line" },
            tagName: "p",
            textContent: "By ${state.author.name} on ${state.missing.date}",
          },
        ],
        state: { author: { name: "Ada" } },
        tagName: "main",
      });
    } finally {
      console.warn = warn;
    }
    const chips = [...frame.container.querySelectorAll<HTMLElement>("#line [data-jx-tag]")];
    expect(chips.map((chip) => chip.dataset.jxStatus)).toEqual([undefined, "failed"]);
    expect(chips[0]!.textContent).toBe("Ada");
    expect(chips[1]!.getAttribute("title")).toContain("undefined");
    const failed = frame.status().bindings.filter((binding) => binding.status === "failed");
    expect(failed.map((binding) => binding.source)).toEqual(["${state.missing.date}"]);
    expect(failed[0]!.path).toEqual(["children", 0]);
  });

  test("a patch that draws a block again leaves its status on the new nodes", async () => {
    stubFetch();
    const frame = bootFrame();
    await frame.render(page());
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
    await frame.send({
      forwardOps: [
        {
          key: "textContent",
          op: "set-key",
          path: ["children", 0],
          value: "N: ${state.posts.length}",
        },
      ],
      gen: 1,
      kind: "patch",
    });
    expect(frame.container.querySelector("#count")?.textContent).toStartWith("N: ");
    expect(chipIn(frame, "count").dataset.jxStatus).toBe("pending");
  });
});
