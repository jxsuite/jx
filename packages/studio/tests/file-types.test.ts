/**
 * Registering `.jxn` from Studio (desktop.md §7.8): offered only where the desktop adapter
 * publishes `fileTypes`, which only an AppImage does, and a moved AppImage told so as it opens.
 */
import { installMockPlatform } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { problems, resetNotifications, toasts } from "../src/services/notify";
import {
  REGISTER_FILE_TYPES,
  checkJxnRegistration,
  fileTypeCommands,
  fileTypeRegistration,
  registerJxnFiles,
} from "../src/services/file-types";
import type { FileTypeRegistration, FileTypeState } from "../src/types";
import { emptyContext } from "../src/commands/context";

/** Give the installed mock platform an AppImage's `fileTypes`. */
function withFileTypes(fileTypes: FileTypeRegistration): void {
  const { platform } = installMockPlatform();
  Object.assign(platform, { fileTypes });
}

/** A registration answering `state` with this, and `register` with what it is given. */
function registration(
  state: FileTypeState,
  register: FileTypeRegistration["register"] = () =>
    Promise.resolve({ ran: ["update-mime-database"], skipped: [], wrote: ["x"] }),
): FileTypeRegistration {
  return { register, state: () => Promise.resolve(state) };
}

/** Every message the user has been shown, toast or Problem. */
function said(): string[] {
  return [...toasts, ...problems].map((record) => record.message);
}

beforeEach(() => {
  resetNotifications();
});

describe("where it is offered", () => {
  test("only a host whose adapter publishes both members", () => {
    installMockPlatform();
    expect(fileTypeRegistration()).toBeNull();
    expect(fileTypeRegistration(null)).toBeNull();
    expect(fileTypeRegistration({ fileTypes: { register: () => null } })).toBeNull();
    expect(fileTypeRegistration({ fileTypes: null })).toBeNull();
    expect(fileTypeRegistration({ fileTypes: registration("unregistered") })).not.toBeNull();
  });

  test("what the desktop answers is read, not trusted", async () => {
    const odd = fileTypeRegistration({
      fileTypes: {
        register: () => Promise.resolve({ ran: ["update-mime-database", 7], wrote: null }),
        state: () => Promise.resolve("maybe"),
      },
    });
    expect(await odd?.state()).toBe("unregistered");
    expect(await odd?.register()).toEqual({
      ran: ["update-mime-database"],
      skipped: [],
      wrote: [],
    });
    const nothing = fileTypeRegistration({
      fileTypes: { register: () => Promise.resolve(null), state: () => Promise.resolve("stale") },
    });
    expect(await nothing?.register()).toEqual({ ran: [], skipped: [], wrote: [] });
    expect(await nothing?.state()).toBe("stale");
  });

  test("the command follows the capability", () => {
    const [command] = fileTypeCommands();
    expect(command?.id).toBe(REGISTER_FILE_TYPES);
    const ctx = emptyContext();
    expect(command?.when?.(ctx)).toBe(false);
    ctx.capability.fileTypes = true;
    expect(command?.when?.(ctx)).toBe(true);
  });
});

describe("registering", () => {
  test("says double-clicking a .jxn now opens this copy", async () => {
    withFileTypes(registration("unregistered"));
    await fileTypeCommands()[0]?.run(emptyContext());
    expect(said().at(-1)).toContain("now opens it in this copy of Jx Studio.");
  });

  test("says when the desktop notices it later, because a tool is missing", async () => {
    withFileTypes(
      registration("unregistered", () =>
        Promise.resolve({ ran: [], skipped: ["update-mime-database"], wrote: ["x"] }),
      ),
    );
    await registerJxnFiles();
    expect(said().at(-1)).toContain("because update-mime-database is not installed");
  });

  test("a failure is a Problem with the reason", async () => {
    withFileTypes(registration("unregistered", () => Promise.reject(new Error("read-only home"))));
    await registerJxnFiles();
    expect(problems.at(-1)?.message).toBe("Could not register .jxn files.");
    expect(problems.at(-1)?.detail).toBe("read-only home");
  });

  test("does nothing on a host without it", async () => {
    installMockPlatform();
    await registerJxnFiles();
    expect(said()).toEqual([]);
  });
});

describe("as the window opens", () => {
  test("a stale registration is told, with the command to fix it", async () => {
    withFileTypes(registration("stale"));
    await checkJxnRegistration();
    const warning = [...toasts, ...problems].at(-1);
    expect(warning?.message).toContain("somewhere else");
    expect(warning?.action).toBe(REGISTER_FILE_TYPES);
  });

  test("a current one, none at all, a failed check and another host say nothing", async () => {
    for (const fileTypes of [
      registration("registered"),
      registration("unregistered"),
      { register: registration("stale").register, state: () => Promise.reject(new Error("x")) },
    ]) {
      withFileTypes(fileTypes);
      await checkJxnRegistration();
    }
    installMockPlatform();
    await checkJxnRegistration();
    expect(said()).toEqual([]);
  });
});
