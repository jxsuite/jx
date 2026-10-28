import { describe, expect, test } from "bun:test";
import { utilityBackend } from "../src/main/backend-process";
import type { BackendMessage } from "../src/shared/protocol";
import { fakeElectron } from "./_fake-electron";

/** A backend started through a fake `utilityProcess`, with the fork it made. */
function started() {
  const fake = fakeElectron();
  const backend = utilityBackend(fake.api.utilityProcess)("/r/backend/index.js", { HOME: "/h" });
  const fork = fake.forks.at(0);
  if (fork === undefined) {
    throw new Error("no fork");
  }
  return { backend, fork };
}

describe("utilityBackend", () => {
  test("forks the script as a named utility process with the environment and inherited output", () => {
    const { fork } = started();
    expect(fork.modulePath).toBe("/r/backend/index.js");
    expect(fork.args).toEqual([]);
    expect(fork.options).toEqual({
      env: { HOME: "/h" },
      serviceName: "Jx Studio Backend",
      stdio: "inherit",
    });
  });

  test("delivers the backend's messages and drops any frame that is not one", () => {
    const { backend, fork } = started();
    const received: BackendMessage[] = [];
    backend.onMessage((message) => received.push(message));
    fork.emitMessage({ type: "mystery" });
    fork.emitMessage(null);
    fork.emitMessage({ type: "ready" });
    expect(received).toEqual([{ type: "ready" }]);
  });

  test("posts the shell's messages until the backend exits, then drops them", () => {
    const { backend, fork } = started();
    const exits: number[] = [];
    backend.onExit(() => exits.push(1));
    backend.send({ root: "/p", type: "open-project" });
    fork.emitExit(0);
    backend.send({ root: null, type: "open-project" });
    expect(fork.posted.map((message) => JSON.stringify(message))).toEqual([
      JSON.stringify({ root: "/p", type: "open-project" }),
    ]);
    expect(exits).toEqual([1]);
  });

  test("kill ends the child", () => {
    const { backend, fork } = started();
    backend.kill();
    expect(fork.killed).toBe(true);
  });
});
