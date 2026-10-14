// Fixture server functions for runtime-gaps-resolve.test.ts (timing: "server")

import type { JsonObject } from "@jxsuite/schema/types";

export async function echoArgs(args: JsonObject) {
  return { got: args };
}

export async function double(args: JsonObject) {
  // `*` applies ToNumber to its operand, so Number() is the same coercion made explicit.
  return Number(args.n ?? 0) * 2;
}

export async function failing(args: JsonObject) {
  if (args.boom) {
    throw new Error("boom");
  }
  return "ok";
}

export const notFn = 7;
