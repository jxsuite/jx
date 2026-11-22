// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * The dev-server adapter's project state client (`specs/project-state.md` §3.2, §5, §10.2): the
 * same `{ subscribe, write, delete }` shape the desktop adapter exposes, over the dev server's
 * event stream and its conditional file routes. A fetch stub stands in for the server, and each
 * stream is fed by hand so a frame split across reads, a replaced subscription and an early close
 * are all observable.
 */
import "./harness";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  encodeSseEvents,
  encodeSseSubscribe,
  PROJECT_EVENTS_PATH,
  preconditionFailedProblem,
} from "@jxsuite/protocol/project-state-frames";
import type { ProjectEventsParams } from "@jxsuite/protocol/project-state-frames";
import type { ProjectEvent, SubscribeResponse } from "@jxsuite/protocol/project-state";
import { createDevServerPlatform } from "../src/platforms/devserver";

const H = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" as const;

const ANSWER: SubscribeResponse = { epoch: "e1", events: [], kind: "events", rev: 4 };

const changed = (rev: number): ProjectEvent => ({
  docId: "d1",
  hash: H,
  origin: "external",
  path: "pages/a.json",
  rev,
  type: "fileChanged",
});

interface Call {
  url: URL;
  init: RequestInit;
}

const originalFetch = globalThis.fetch;
let calls: Call[];
let answer: (call: Call) => Response;

/** A stream the test writes to by hand. */
function handStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  const encoder = new TextEncoder();
  return {
    body,
    close: () => controller.close(),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
  };
}

/** A listener that records what it was handed. */
function recorder() {
  const events: ProjectEventsParams[] = [];
  const ended: string[] = [];
  return {
    ended,
    events,
    listener: {
      ended: (epoch: string) => {
        ended.push(epoch);
      },
      events: (params: ProjectEventsParams) => {
        events.push(params);
      },
    },
  };
}

beforeEach(() => {
  calls = [];
  answer = () => new Response(null, { status: 500 });
  const fetchStub = (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const call = { init, url: new URL(String(input), "http://localhost") };
    calls.push(call);
    return Promise.resolve(answer(call));
  };
  globalThis.fetch = Object.assign(fetchStub, { preconnect: originalFetch.preconnect });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** A header the adapter sent, by name. */
const header = (call: Call, name: string): string | null =>
  new Headers(call.init.headers).get(name);

/** Let the adapter's stream reader run. */
const turn = () => Bun.sleep(1);

describe("projectState.subscribe (§3.2)", () => {
  test("answers with the first frame, hands on later ones, and reports the close", async () => {
    const stream = handStream();
    answer = () => new Response(stream.body);
    const platform = createDevServerPlatform();
    const seen = recorder();
    const subscribing = platform.projectState.subscribe(
      { clientId: "tab 1", epoch: "e1", sinceRev: 4 },
      seen.listener,
    );
    // The answer arrives split across reads, after a heartbeat comment.
    const frame = encodeSseSubscribe(ANSWER);
    stream.push(": heartbeat\n\n");
    stream.push(frame.slice(0, 10));
    await turn();
    stream.push(frame.slice(10));
    expect(await subscribing).toEqual(ANSWER);
    const [call] = calls;
    expect(call!.url.pathname).toBe(PROJECT_EVENTS_PATH);
    expect(call!.url.searchParams.get("clientId")).toBe("tab 1");
    expect(header(call!, "Last-Event-ID")).toBe("e1:4");
    expect(header(call!, "Accept")).toBe("text/event-stream");

    // Another binding's line breaks, and an event name this exchange does not know.
    stream.push(encodeSseEvents("e1", [changed(5)]).replaceAll("\n", "\r\n"));
    stream.push("event: other\ndata: {}\n\n");
    await turn();
    expect(seen.events).toEqual([{ epoch: "e1", events: [changed(5)] }]);
    stream.close();
    await turn();
    expect(seen.ended).toEqual(["e1"]);
  });

  test("frames that arrive with the answer reach the listener only after the caller has it", async () => {
    const stream = handStream();
    answer = () => new Response(stream.body);
    const platform = createDevServerPlatform();
    const order: string[] = [];
    const subscribing = platform.projectState
      .subscribe(
        {},
        {
          ended: () => order.push("ended"),
          events: () => order.push("events"),
        },
      )
      .then((response) => {
        order.push("answer");
        return response;
      });
    // The server enqueues the answer and the first batch back to back: one read carries both,
    // And the close with them.
    stream.push(encodeSseSubscribe(ANSWER) + encodeSseEvents("e1", [changed(5)]));
    stream.close();
    expect(await subscribing).toEqual(ANSWER);
    await turn();
    expect(order).toEqual(["answer", "events", "ended"]);
  });

  test("the stream names the project this tab activated", async () => {
    const stream = handStream();
    answer = (call) =>
      call.url.pathname === "/__studio/activate"
        ? Response.json({ ok: true, root: "site" })
        : new Response(stream.body);
    const platform = createDevServerPlatform();
    platform.projectRoot = "site";
    const subscribing = platform.projectState.subscribe({}, recorder().listener);
    stream.push(encodeSseSubscribe(ANSWER));
    await subscribing;
    const call = calls.find((made) => made.url.pathname === PROJECT_EVENTS_PATH)!;
    expect(call.url.searchParams.get("root")).toBe("site");
    expect(call.url.searchParams.has("clientId")).toBe(false);
  });

  test("a first subscribe sends no cursor; a second ends the first without a word", async () => {
    const first = handStream();
    const second = handStream();
    const streams = [first, second];
    answer = () => new Response(streams.shift()!.body);
    const platform = createDevServerPlatform();
    const old = recorder();
    const subscribing = platform.projectState.subscribe({}, old.listener);
    first.push(encodeSseSubscribe(ANSWER));
    await subscribing;
    expect(header(calls[0]!, "Last-Event-ID")).toBeNull();
    expect(calls[0]!.url.search).toBe("");

    // The `StudioPlatform` member is the same subscribe, so it replaces the first too.
    const next = recorder();
    const resubscribing = platform.subscribeProjectState({}, next.listener);
    second.push(encodeSseSubscribe(ANSWER));
    await resubscribing;
    expect(calls[0]!.init.signal?.aborted).toBe(true);
    await turn();
    expect(old.ended).toEqual([]);
    expect(old.events).toEqual([]);
  });

  test("a server without the stream refuses the subscribe, and so does an early close", async () => {
    const platform = createDevServerPlatform();
    answer = () => new Response(null, { status: 404 });
    await expect(platform.projectState.subscribe({}, recorder().listener)).rejects.toThrow(
      "unavailable (404)",
    );
    const stream = handStream();
    answer = () => new Response(stream.body);
    const subscribing = platform.projectState.subscribe({}, recorder().listener);
    stream.close();
    await expect(subscribing).rejects.toThrow("closed before it answered");
  });

  test("a malformed frame ends the subscription, and is reported", async () => {
    const reported = spyOn(console, "error").mockImplementation(() => {});
    const stream = handStream();
    answer = () => new Response(stream.body);
    const platform = createDevServerPlatform();
    const seen = recorder();
    const subscribing = platform.projectState.subscribe({}, seen.listener);
    stream.push(encodeSseSubscribe(ANSWER));
    await subscribing;
    stream.push("event: project\ndata: {}\n\n");
    await turn();
    expect(seen.ended).toEqual(["e1"]);
    expect(reported).toHaveBeenCalledTimes(1);
    reported.mockRestore();
  });

  test("a stale subscription that fails says nothing", async () => {
    const reported = spyOn(console, "error").mockImplementation(() => {});
    const stream = handStream();
    const later = handStream();
    const streams = [stream, later];
    answer = () => new Response(streams.shift()!.body);
    const platform = createDevServerPlatform();
    const seen = recorder();
    const subscribing = platform.projectState.subscribe({}, seen.listener);
    stream.push(encodeSseSubscribe(ANSWER));
    await subscribing;
    const next = recorder();
    const replacing = platform.projectState.subscribe({}, next.listener);
    later.push(encodeSseSubscribe(ANSWER));
    expect(await replacing).toEqual(ANSWER);
    await turn();
    // The aborted stream's failure reaches neither listener nor the console.
    expect(seen.ended).toEqual([]);
    expect(next.ended).toEqual([]);
    expect(reported.mock.calls).toEqual([]);
    reported.mockRestore();
  });
});

describe("projectState.write and delete (§5)", () => {
  test("a write names its base and issuer, under the server's path for the project", async () => {
    answer = (call) =>
      call.url.pathname === "/__studio/activate"
        ? Response.json({ ok: true, root: "site" })
        : Response.json({ hash: H, ok: true, path: "pages/a.json", rev: 7 });
    const platform = createDevServerPlatform();
    platform.projectRoot = "site";
    // The `StudioPlatform` members Studio saves and deletes through are the same two calls.
    expect(platform.writeProjectState).toBe(platform.projectState.write);
    expect(platform.deleteProjectState).toBe(platform.projectState.delete);
    const result = await platform.projectState.write({
      baseHash: H,
      bufferRev: 3,
      contents: new Uint8Array([1, 2]),
      path: "pages/a.json",
      writeId: "w1",
    });
    expect(result).toEqual({ hash: H, ok: true, rev: 7 });
    const call = calls.at(-1)!;
    expect(call.init.method).toBe("PUT");
    expect(call.url.searchParams.get("path")).toBe("site/pages/a.json");
    expect(header(call, "If-Match")).toBe(`"${H}"`);
    expect(header(call, "Jx-Write-Id")).toBe("w1");
    expect(header(call, "Jx-Buffer-Rev")).toBe("3");
    expect(call.init.body).toEqual(new Uint8Array([1, 2]));
    // The activation went first: a write is never aimed at another tab's project.
    expect(calls.map((made) => made.url.pathname)).toEqual([
      "/__studio/activate",
      "/__studio/file",
    ]);
  });

  test("a stale base answers the conflict; any other failure throws", async () => {
    const conflict = { diskHash: H, docId: "d1", path: "pages/a.json" };
    const platform = createDevServerPlatform();
    const request = { baseHash: null, contents: "{}", path: "pages/a.json", writeId: "w" };
    answer = () => Response.json(preconditionFailedProblem(conflict), { status: 412 });
    expect(await platform.projectState.write(request)).toEqual({ conflict, ok: false });
    expect(header(calls.at(-1)!, "If-None-Match")).toBe("*");
    answer = () => Response.json({ detail: "boom", status: 500 }, { status: 500 });
    await expect(platform.projectState.write(request)).rejects.toThrow("boom");
    answer = () => new Response("not json", { status: 412 });
    await expect(platform.projectState.write(request)).rejects.toThrow("Request failed (412)");
  });

  test("a delete names its base: a file's hash, a directory's files", async () => {
    const platform = createDevServerPlatform();
    answer = () => Response.json({ ok: true, path: "pages/a.json", rev: 9 });
    expect(
      await platform.projectState.delete({ base: { hash: H }, path: "pages/a.json", writeId: "d" }),
    ).toEqual({ ok: true, rev: 9 });
    const file = calls.at(-1)!;
    expect(file.init.method).toBe("DELETE");
    expect(header(file, "If-Match")).toBe(`"${H}"`);
    expect(file.init.body).toBeUndefined();
    await platform.projectState.delete({
      base: { files: { "a.json": H } },
      path: "pages",
      writeId: "d",
    });
    const dir = calls.at(-1)!;
    expect(JSON.parse(String(dir.init.body))).toEqual({ files: { "a.json": H } });
    const conflict = { diskHash: null, docId: null, path: "pages" };
    answer = () => Response.json(preconditionFailedProblem(conflict), { status: 412 });
    expect(
      await platform.projectState.delete({ base: { hash: H }, path: "pages", writeId: "d" }),
    ).toEqual({ conflict, ok: false });
  });
});
