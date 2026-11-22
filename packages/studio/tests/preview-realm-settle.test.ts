/**
 * The preview realm's settle wait is bounded (`src/preview-realm/frame.ts`, `project-state.md`
 * §11.2): the runtime's `lookupsSettled` waits on every lookup in the realm and may never answer (a
 * slow API, an unreachable mount), so a tree is read once its time is up all the same.
 *
 * A file of its own because the runtime's lookup count is module state no test can hang from
 * outside: the runtime is doubled here with a `lookupsSettled` that never answers.
 */
import "./harness";
import { expect, mock, test } from "bun:test";

const runtime = await import("@jxsuite/runtime");
void mock.module("@jxsuite/runtime", () => ({
  ...runtime,
  lookupsSettled: () => new Promise<void>(() => {}),
}));

const { settleTree } = await import("../src/preview-realm/frame");

test("a lookup that never settles does not hold a tree past its limit", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  const started = Date.now();
  await settleTree(root, 40);
  expect(Date.now() - started).toBeLessThan(1000);
  root.remove();
});
