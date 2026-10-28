import { describe, expect, test } from "bun:test";
import { isBackendMessage, isShellMessage } from "../src/shared/protocol";

describe("isBackendMessage", () => {
  test("accepts every message the backend sends", () => {
    for (const message of [
      { type: "ready" },
      { type: "quit" },
      { id: 1, partition: "persist:p", title: "T", type: "open-window", url: "http://x" },
      { id: 2, type: "focus-window" },
      { id: 3, title: "T", type: "set-title" },
      { kind: "file", requestId: 4, title: "T", type: "dialog" },
      { kind: "directory", requestId: 5, title: "T", type: "dialog" },
    ]) {
      expect(isBackendMessage(message)).toBe(true);
    }
  });

  test("rejects a message missing or mistyping a field its type promises", () => {
    for (const message of [
      { id: "1", partition: "p", title: "T", type: "open-window", url: "u" },
      { id: 1, title: "T", type: "open-window", url: "u" },
      { id: 1, partition: "p", type: "open-window", url: "u" },
      { id: 1, partition: "p", title: "T", type: "open-window" },
      { type: "focus-window" },
      { id: 1, type: "set-title" },
      { id: "1", title: "T", type: "set-title" },
      { kind: "folder", requestId: 1, title: "T", type: "dialog" },
      { kind: "file", title: "T", type: "dialog" },
      { kind: "file", requestId: 1, type: "dialog" },
    ]) {
      expect(isBackendMessage(message)).toBe(false);
    }
  });

  test("rejects what is not a message at all, and types it does not know", () => {
    for (const value of [null, undefined, "ready", 7, [], {}, { type: 1 }, { type: "nope" }]) {
      expect(isBackendMessage(value)).toBe(false);
    }
    // A shell message is not a backend message, whatever it looks like.
    expect(isBackendMessage({ root: null, type: "open-project" })).toBe(false);
  });
});

describe("isShellMessage", () => {
  test("accepts every message the shell sends", () => {
    for (const message of [
      { root: "/p", type: "open-project" },
      { root: null, type: "open-project" },
      { id: 1, type: "window-closed" },
      { path: "/p/project.json", requestId: 2, type: "dialog-result" },
      { path: null, requestId: 3, type: "dialog-result" },
      { text: "Update ready (1.2.3)", type: "update-status" },
    ]) {
      expect(isShellMessage(message)).toBe(true);
    }
  });

  test("rejects a message missing or mistyping a field its type promises", () => {
    for (const message of [
      { type: "open-project" },
      { root: 3, type: "open-project" },
      { type: "window-closed" },
      { id: "1", type: "window-closed" },
      { path: "/p", type: "dialog-result" },
      { path: "/p", requestId: "1", type: "dialog-result" },
      { requestId: 1, type: "dialog-result" },
      { path: 5, requestId: 1, type: "dialog-result" },
      { type: "update-status" },
      { text: 5, type: "update-status" },
    ]) {
      expect(isShellMessage(message)).toBe(false);
    }
  });

  test("rejects what is not a message at all, and types it does not know", () => {
    for (const value of [null, undefined, "open-project", 7, [], {}, { type: "ready" }]) {
      expect(isShellMessage(value)).toBe(false);
    }
  });
});
