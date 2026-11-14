/**
 * A scripted upstream provider: a `fetch` that answers each call with the next fixture.
 *
 * @module @jxsuite/ai/testing
 */

/** One upstream answer. */
export interface UpstreamFixture {
  /** The response's status. */
  readonly status: number;
  /** An event-stream body, sent as `text/event-stream`. */
  readonly sse?: string;
  /** Any other body, sent as `application/json`. */
  readonly body?: string;
  /**
   * End the stream with a read error once this many bytes have been delivered, the way a reset
   * connection does. Applies to `sse`.
   */
  readonly abortAfterBytes?: number;
}

/**
 * The call signature of `fetch`, and nothing a runtime adds to it (Bun's `preconnect`, say), so one
 * double serves every runtime a gateway runs in.
 */
export type UpstreamFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** What a scripted upstream records of each call it answered. */
export interface FakeUpstream extends UpstreamFetch {
  /** Every request made so far, in order: its URL and the init it was made with. */
  readonly calls: { readonly url: string; readonly init: RequestInit | undefined }[];
}

/**
 * A `fetch` double that answers its calls with `fixtures`, in order. A call past the last fixture
 * rejects, as a provider that has gone away does.
 *
 * @param {readonly UpstreamFixture[]} fixtures - The answers, one per expected call
 * @returns {FakeUpstream}
 */
export function fakeUpstream(fixtures: readonly UpstreamFixture[]): FakeUpstream {
  const calls: FakeUpstream["calls"] = [];
  let next = 0;
  const respond = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push({ init, url: urlOf(input) });
    const fixture = fixtures[next];
    next += 1;
    if (!fixture) {
      return Promise.reject(new TypeError("fakeUpstream: no fixture left for this request"));
    }
    if (fixture.sse === undefined) {
      return Promise.resolve(
        new Response(fixture.body ?? "", {
          headers: { "Content-Type": "application/json" },
          status: fixture.status,
        }),
      );
    }
    return Promise.resolve(
      new Response(streamOf(fixture.sse, fixture.abortAfterBytes), {
        headers: { "Content-Type": "text/event-stream" },
        status: fixture.status,
      }),
    );
  };
  return Object.assign(respond, { calls });
}

/**
 * The URL a fetch input names.
 *
 * @param {RequestInfo | URL} input - What `fetch` was called with
 * @returns {string}
 */
function urlOf(input: RequestInfo | URL): string {
  if (input instanceof URL) {
    return input.href;
  }
  return input instanceof Request ? input.url : input;
}

/**
 * A body stream of `text`, optionally failing after `abortAfterBytes` bytes.
 *
 * @param {string} text - The whole body
 * @param {number | undefined} abortAfterBytes - Where the read fails, or undefined for never
 * @returns {ReadableStream<Uint8Array>}
 */
function streamOf(text: string, abortAfterBytes: number | undefined): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let delivered = false;
  return new ReadableStream<Uint8Array>({
    // One chunk per pull: an error raised beside an enqueue would discard the chunk before a read.
    pull(controller) {
      if (!delivered) {
        delivered = true;
        controller.enqueue(abortAfterBytes === undefined ? bytes : bytes.slice(0, abortAfterBytes));
        return;
      }
      if (abortAfterBytes === undefined) {
        controller.close();
      } else {
        controller.error(new TypeError("fakeUpstream: connection reset"));
      }
    },
  });
}
