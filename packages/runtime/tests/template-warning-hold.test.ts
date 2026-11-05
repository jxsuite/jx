/**
 * A template that throws because a lookup has not answered yet is not an error worth reporting, so
 * its warning waits for the lookup (spec.md §6.1). The Studio canvas printed one for every binding
 * on a page whose collections resolve through the dev proxy, and every one of them then rendered.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { Mock } from "bun:test";
import { buildScope, lookupsSettled, renderNode, setTemplateErrorHandler } from "../src/runtime";
import type { JsonValue, JxDocument } from "@jxsuite/schema/types";

try {
  GlobalRegistrator.register();
} catch {
  /* Already registered */
}

/** Lets a settled lookup's chain run to its end. */
const settled = () =>
  new Promise<void>((done) => {
    setTimeout(done, 0);
  });

const realFetch = globalThis.fetch;
let warn: Mock<typeof console.warn>;
let answers: ((response: Response) => void)[];

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
  answers = [];
  const handler = mock(
    () =>
      new Promise<Response>((respond) => {
        answers.push(respond);
      }),
  );
  globalThis.fetch = Object.assign(handler, { preconnect: realFetch.preconnect });
});

afterEach(() => {
  warn.mockRestore();
  setTemplateErrorHandler(null);
  globalThis.fetch = realFetch;
});

/** Answer the oldest unanswered request. */
async function answer(body: JsonValue, status = 200) {
  answers.shift()!(Response.json(body, { status }));
  await settled();
}

/** Every template warning so far, by the source it names. */
function warned(source: string) {
  return warn.mock.calls.filter(([message]) => String(message).includes(source));
}

/** A collection the browser cannot resolve itself, so it goes through the dev proxy. */
const collection = { $prototype: "ContentCollection", $src: "@acme/pkg/Coll.class.json" };

/** A document binding one template over `state`, rendered as a page does. */
async function draw(state: NonNullable<JxDocument["state"]>, template: string) {
  const scope = await buildScope({ state, tagName: "div" }, {});
  const el = renderNode({ tagName: "p", textContent: template }, scope);
  if (!(el instanceof HTMLElement)) {
    throw new TypeError("expected an element");
  }
  return el;
}

describe("a template throwing while a lookup is in flight", () => {
  test("renders when the lookup answers, and is never reported", async () => {
    const el = await draw({ posts: collection }, "${state.posts.length} posts");
    expect(el.textContent).toBe("");
    await answer(["a", "b"]);
    expect(el.textContent).toBe("2 posts");
    expect(warned("posts.length")).toHaveLength(0);
  });

  test("is reported when the lookup fails, because nothing will fix it", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    await draw({ failed: collection }, "${state.failed.length} failed");
    expect(warned("failed.length")).toHaveLength(0);
    await answer({}, 500);
    expect(warned("failed.length")).toHaveLength(1);
    error.mockRestore();
  });

  test("is reported when the answer does not fix it", async () => {
    await draw({ wrong: collection }, "${state.wrong.missing.deeper}");
    await answer(["a"]);
    expect(warned("wrong.missing.deeper")).toHaveLength(1);
  });

  test("waits for every lookup, not just the first to answer", async () => {
    const el = await draw(
      { one: collection, two: collection },
      "${state.one.length + state.two.length} both",
    );
    await answer(["a"]);
    expect(warned("state.two.length")).toHaveLength(0);
    await answer(["b"]);
    expect(el.textContent).toBe("2 both");
    expect(warned("state.two.length")).toHaveLength(0);
  });

  test("an unrelated broken template is still reported once things settle", async () => {
    await draw({ posts: collection }, "${neverDefinedAnywhere}");
    expect(warned("neverDefinedAnywhere")).toHaveLength(0);
    await answer([]);
    expect(warned("neverDefinedAnywhere")).toHaveLength(1);
  });

  test("two broken bindings of one source warn once", async () => {
    const scope = await buildScope({ state: { items: collection }, tagName: "div" }, {});
    const source = "${state.items.none.x}";
    renderNode({ tagName: "p", textContent: source }, scope);
    renderNode({ tagName: "p", textContent: source }, scope);
    await answer([{}]);
    expect(warned("state.items.none.x")).toHaveLength(1);
  });

  test("a host's handler hears a throw at once, and never a throw held from before it", async () => {
    const heard: string[] = [];
    setTemplateErrorHandler((_error, source) => heard.push(source));
    await draw({ posts: collection }, "${state.posts.handled.x}");
    expect(heard).toEqual(["${state.posts.handled.x}"]);

    setTemplateErrorHandler(null);
    // Reads no state, so no answer re-runs it: only the release of the hold can report it.
    await draw({ posts: collection }, "${heldBackFromTheHandler}");
    setTemplateErrorHandler((_error, source) => heard.push(source));
    await answer([]);
    await answer([]);
    expect(heard).toEqual(["${state.posts.handled.x}", "${state.posts.handled.x}"]);
    expect(warned("heldBackFromTheHandler")).toHaveLength(1);
  });

  test("a Request entry holds the warning until it answers", async () => {
    const el = await draw(
      { feed: { $prototype: "Request", url: "/feed.json" } },
      "${state.feed.title} feed",
    );
    await answer({ title: "News" });
    expect(el.textContent).toBe("News feed");
    expect(warned("state.feed.title")).toHaveLength(0);
  });

  test("a server entry holds the warning until it answers", async () => {
    const el = await draw(
      { total: { $export: "total", $src: "./sum.js", timing: "server" } },
      "${state.total.value} total",
    );
    await answer({ value: 3 });
    expect(el.textContent).toBe("3 total");
    expect(warned("state.total.value")).toHaveLength(0);
  });
});

describe("lookupsSettled", () => {
  test("answers at once with nothing in flight", async () => {
    await lookupsSettled();
    expect(answers).toHaveLength(0);
  });

  test("answers after the last lookup, not the first", async () => {
    await buildScope({ state: { one: collection, two: collection }, tagName: "div" }, {});
    let woke = false;
    const waiting = lookupsSettled().then(() => {
      woke = true;
    });
    await answer([]);
    expect(woke).toBe(false);
    await answer([]);
    await waiting;
    expect(woke).toBe(true);
  });

  test("the data is in state by the time it answers", async () => {
    const scope = await buildScope({ state: { ready: collection }, tagName: "div" }, {});
    const waiting = lookupsSettled();
    await answer(["a"]);
    await waiting;
    expect(scope.ready).toEqual(["a"]);
  });
});

test("with nothing in flight a throw is reported at once", () => {
  renderNode({ tagName: "p", textContent: "${nothingPendingHere}" }, {});
  expect(warned("nothingPendingHere")).toHaveLength(1);
});
