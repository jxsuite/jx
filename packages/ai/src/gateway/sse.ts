/**
 * The chat route's framing: one Server-Sent Events `data:` line per frame.
 *
 * @module @jxsuite/ai/gateway
 */

import type { StreamEvent } from "../streaming-client.ts";

/**
 * The headers a chat stream is answered with. `no-cache` because a replayed stream is a different
 * turn, and `keep-alive` because the answer is long-lived by design.
 */
export const SSE_HEADERS: Readonly<Record<string, string>> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/**
 * Frame `events` as a Server-Sent Events body: `data: <JSON>` and a blank line per frame, and
 * nothing else (no `event:`, `id:` or `retry:` field), so the JSON's own `type` is the only
 * discriminator a reader needs.
 *
 * The stream is PUSHED: iteration starts when the stream is constructed, not when it is first read,
 * and every frame is enqueued as soon as it exists. That is how the proxy has always behaved (its
 * upstream request is on the wire before the response is returned), and this extraction keeps it.
 * An iterable that throws errors the stream.
 *
 * @param {AsyncIterable<StreamEvent>} events - The frames, in wire order
 * @returns {ReadableStream<Uint8Array>}
 */
export function encodeSse(events: AsyncIterable<StreamEvent>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
}
