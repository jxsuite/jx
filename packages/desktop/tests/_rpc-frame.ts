/* The wire frame the Chromium platform's transport writes, shared by the three suites that stand up
   a mock RPC server for it (chromium-platform, -gaps, -references). */
import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import type { JsonObject, JsonValue } from "@jxsuite/schema/types";

/**
 * One request frame the platform's transport writes: `ws.send(JSON.stringify({ id, method, params
 * }))`.
 */
export interface RpcRequest {
  id: number;
  method: string;
  params?: JsonObject;
}

/** A request as a mock server records it: the frame without its correlation id. */
export type ReceivedMessage = Omit<RpcRequest, "id">;

/**
 * Decode one frame the platform sent. Its `request()` only ever passes an object or nothing as
 * `params`, so anything else is a transport defect and fails the test where it happened.
 */
export function decodeRequest(raw: string | Buffer): RpcRequest {
  const frame: JsonValue = JSON.parse(String(raw));
  if (!isJsonObject(frame) || !isNumber(frame.id) || !isString(frame.method)) {
    throw new TypeError(`Not an RPC request: ${String(raw)}`);
  }
  const { id, method } = frame;
  // JSON.stringify drops an undefined `params`, so a frame sent without one carries no key at all.
  if (!("params" in frame)) {
    return { id, method };
  }
  const { params } = frame;
  if (!isJsonObject(params)) {
    throw new TypeError(`RPC params must be an object: ${String(raw)}`);
  }
  return { id, method, params };
}
