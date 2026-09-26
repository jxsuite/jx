// oxlint-disable typescript/await-thenable -- bun test .resolves/.rejects matchers are typed `void` but return real Promises at runtime; the await is required.
/**
 * Tests for src/services/directory-picker.ts — the browser-side folder chooser behind the New
 * Project modal's **Browse…** button.
 *
 * `showDirectoryPicker()` hands back a handle that knows only its own `.name`, so the module tags
 * the picked folder with a hidden `.jx-loc-id` whose CONTENTS are a one-shot random id, and asks a
 * caller-supplied `locate` which directory carries that id. These tests stub
 * `globalThis.showDirectoryPicker` (no DOM needed — the module reads the global lazily inside each
 * call) and assert the whole contract: the options handed to the picker, that the id written to
 * disk is the same id sent to the backend, and the one rule the modal depends on: **`null` means
 * the user dismissed the chooser, and every other failure rejects with a sentence fit to show.** It
 * used to resolve `null` for all of them, which is how Browse… came to do nothing at all when the
 * lookup broke. The tag is removed on every path where one was created, including a write that
 * failed after the empty file already existed. Every stubbed global is restored in `afterEach`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  LOCATION_ID_FILE,
  canPickDirectory,
  pickDirectoryPath,
} from "../src/services/directory-picker";

// ─── Global stubbing ─────────────────────────────────────────────────────────

interface PickerOptions {
  id?: string;
  mode?: string;
  startIn?: string;
}

interface LocateQuery {
  id: string;
  name: string;
}

/** One `getFileHandle` call recorded by the handle double. */
interface CreatedEntry {
  name: string;
  options?: { create?: boolean };
}

const globals = globalThis as Record<string, unknown>;
const REAL_PICKER = globals.showDirectoryPicker;

/** Install (or, with `undefined`, remove) the `showDirectoryPicker` global. */
function setPicker(fn: unknown): void {
  if (fn === undefined) {
    delete globals.showDirectoryPicker;
  } else {
    globals.showDirectoryPicker = fn;
  }
}

afterEach(() => {
  setPicker(REAL_PICKER);
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

/**
 * A `FileSystemDirectoryHandle` double recording the entries created and removed on it, and the
 * bytes written through each writable — the written id is the whole identification mechanism.
 */
class FakeDirectoryHandle {
  readonly created: CreatedEntry[] = [];
  readonly removed: string[] = [];
  readonly written: string[] = [];
  /** Whether every writable opened on this handle was closed (an unclosed one never flushes). */
  closed = 0;
  readonly name: string;
  createError: Error | null = null;
  writeError: Error | null = null;
  closeError: Error | null = null;
  removeError: Error | null = null;
  /**
   * Whether the tag file is on disk. `getFileHandle({ create: true })` creates it (empty) before a
   * byte is written, which is exactly why a failed write must still clean up.
   */
  exists = false;

  constructor(name = "Projects") {
    this.name = name;
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<unknown> {
    this.created.push({ name, ...(options ? { options } : {}) });
    // A read-only grant rejects here rather than silently doing nothing.
    if (this.createError) {
      return Promise.reject(this.createError);
    }
    this.exists = true;
    return Promise.resolve({
      createWritable: () => {
        if (this.writeError) {
          return Promise.reject(this.writeError);
        }
        return Promise.resolve({
          close: () => {
            if (this.closeError) {
              return Promise.reject(this.closeError);
            }
            this.closed += 1;
            return Promise.resolve();
          },
          write: (data: string) => {
            this.written.push(data);
            return Promise.resolve();
          },
        });
      },
    });
  }

  removeEntry(name: string): Promise<void> {
    this.removed.push(name);
    if (this.removeError) {
      return Promise.reject(this.removeError);
    }
    this.exists = false;
    return Promise.resolve();
  }
}

/**
 * Stub `showDirectoryPicker` with one that resolves `outcome` when it is a handle and rejects with
 * it otherwise, returning the array the options of every call are recorded into.
 */
function installPicker(outcome: unknown): PickerOptions[] {
  const calls: PickerOptions[] = [];
  setPicker((options?: PickerOptions) => {
    calls.push(options ?? {});
    return outcome instanceof FakeDirectoryHandle
      ? Promise.resolve(outcome)
      : Promise.reject(outcome);
  });
  return calls;
}

/** A `locate` double resolving `outcome` (or rejecting when it is an `Error`), plus its call log. */
function recordLocate(outcome: string | null | Error): {
  calls: LocateQuery[];
  locate: (query: LocateQuery) => Promise<string | null>;
} {
  const calls: LocateQuery[] = [];
  return {
    calls,
    locate: (query) => {
      calls.push(query);
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
}

/** An Error with a DOMException-style `name`, as Chrome rejects the chooser with. */
function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

/** The rejection Chrome produces when the user dismisses the folder chooser. */
function abortError(): Error {
  return namedError("AbortError", "The user aborted a request.");
}

/** What a promise rejected with, for assertions on more than the message. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

// ─── Availability ────────────────────────────────────────────────────────────

describe("canPickDirectory", () => {
  test("is false when the browser has no File System Access API", () => {
    setPicker(undefined);
    expect(canPickDirectory()).toBe(false);
  });

  test("is true only when the global is callable", () => {
    installPicker(new FakeDirectoryHandle());
    expect(canPickDirectory()).toBe(true);
    // A non-function value (an over-eager polyfill shim) must not count as support.
    setPicker({});
    expect(canPickDirectory()).toBe(false);
  });
});

// ─── pickDirectoryPath ───────────────────────────────────────────────────────

describe("pickDirectoryPath without the API", () => {
  /* The dev-server adapter never offers Browse… without the API, so only an embedder wiring the
     helper by hand gets here. `null` would read as a cancel the user never made. */
  test("rejects with a sentence, without ever consulting the backend", async () => {
    setPicker(undefined);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    await expect(pickDirectoryPath(locate)).rejects.toThrow(
      "This browser has no folder chooser. Type the folder's path into Location instead.",
    );
    expect(calls).toEqual([]);
  });
});

describe("pickDirectoryPath with the API", () => {
  test("opens the chooser with the stable id, readwrite grant, and documents start", async () => {
    const picked = installPicker(new FakeDirectoryHandle());
    const { locate } = recordLocate("/home/dev/Projects");

    await pickDirectoryPath(locate);

    expect(picked).toEqual([
      { id: "jx-new-project-location", mode: "readwrite", startIn: "documents" },
    ]);
  });

  test("writes the id into the hidden tag file and sends that same id to the backend", async () => {
    const handle = new FakeDirectoryHandle("Projects");
    installPicker(handle);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    expect(await pickDirectoryPath(locate)).toBe("/home/dev/Projects");

    expect(calls).toHaveLength(1);
    const { id, name } = calls[0]!;
    expect(name).toBe("Projects");
    // The backend matches on the FILE CONTENTS, so the two must be the same string.
    expect(handle.written).toEqual([id]);
    // The writable is closed, or the bytes would never reach disk.
    expect(handle.closed).toBe(1);
    // The tag is a fixed hidden filename, not a random one.
    expect(handle.created).toEqual([{ name: LOCATION_ID_FILE, options: { create: true } }]);
    expect(LOCATION_ID_FILE).toBe(".jx-loc-id");
    // The id must survive the server's `/^[a-f0-9]{32}$/` validation.
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    // Cleaned up rather than left behind in the user's new project folder.
    expect(handle.removed).toEqual([LOCATION_ID_FILE]);
  });

  test("uses a fresh id for every pick", async () => {
    const handle = new FakeDirectoryHandle();
    installPicker(handle);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    await pickDirectoryPath(locate);
    await pickDirectoryPath(locate);

    // A reused id would let a stale tag from an earlier pick claim a later one.
    expect(calls[0]!.id).not.toBe(calls[1]!.id);
    expect(handle.written[0]).not.toBe(handle.written[1]);
  });

  test("resolves null and writes nothing when the user cancels", async () => {
    const handle = new FakeDirectoryHandle();
    installPicker(abortError());
    const { calls, locate } = recordLocate("/home/dev/Projects");

    expect(await pickDirectoryPath(locate)).toBeNull();
    expect(handle.created).toEqual([]);
    expect(handle.removed).toEqual([]);
    expect(calls).toEqual([]);
  });

  /* A DOMException from another realm (an iframe's picker) is not `instanceof Error` in this one,
     so dismissal is read from the `name` alone. */
  test("reads a cancel structurally, so a plain { name: 'AbortError' } is still a cancel", async () => {
    installPicker({ message: "The user aborted a request.", name: "AbortError" });
    const { calls, locate } = recordLocate("/home/dev/Projects");

    expect(await pickDirectoryPath(locate)).toBeNull();
    expect(calls).toEqual([]);
  });

  /* The picker runs synchronously from the click, so a SecurityError means the environment is
     wrong (a cross-origin frame, a spent gesture). Swallowing it was the dead button. */
  test("rejects, naming the refusal, when the chooser will not open (SecurityError)", async () => {
    const handle = new FakeDirectoryHandle();
    const refusal = namedError("SecurityError", "Must be handling a user gesture.");
    installPicker(refusal);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    const error = await rejectionOf(pickDirectoryPath(locate));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "The folder chooser could not open (Must be handling a user gesture.). Type the folder's path into Location instead.",
    );
    expect((error as Error).cause).toBe(refusal);
    expect(handle.created).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("rejects when the chooser fails with a thrown non-Error", async () => {
    installPicker("picker exploded");
    const { locate } = recordLocate("/home/dev/Projects");

    await expect(pickDirectoryPath(locate)).rejects.toThrow(
      /^The folder chooser could not open \(picker exploded\)/,
    );
  });

  test("rejects without calling locate when the tag cannot be created", async () => {
    const handle = new FakeDirectoryHandle();
    const refusal = new Error("NotAllowedError");
    handle.createError = refusal;
    installPicker(handle);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    const error = await rejectionOf(pickDirectoryPath(locate));
    expect((error as Error).message).toBe(
      "Jx Studio can't write to \"Projects\" (NotAllowedError), so it can't create a project there. Choose a folder you can write to.",
    );
    expect((error as Error).cause).toBe(refusal);
    expect(handle.created).toHaveLength(1);
    expect(calls).toEqual([]);
    // Nothing was created, so there is nothing to clean up.
    expect(handle.removed).toEqual([]);
    expect(handle.exists).toBe(false);
  });

  test("rejects, and removes the empty tag, when the tag cannot be written", async () => {
    const handle = new FakeDirectoryHandle();
    handle.writeError = new Error("NoModificationAllowedError");
    installPicker(handle);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    await expect(pickDirectoryPath(locate)).rejects.toThrow(/can't write to "Projects"/);
    expect(handle.written).toEqual([]);
    expect(calls).toEqual([]);
    // `getFileHandle({ create: true })` already put an empty file on disk: it must not stay.
    expect(handle.removed).toEqual([LOCATION_ID_FILE]);
    expect(handle.exists).toBe(false);
  });

  test("rejects, and removes the tag, when the written bytes cannot be flushed", async () => {
    const handle = new FakeDirectoryHandle();
    handle.closeError = new Error("QuotaExceededError");
    installPicker(handle);
    const { calls, locate } = recordLocate("/home/dev/Projects");

    await expect(pickDirectoryPath(locate)).rejects.toThrow(
      /can't write to "Projects" \(QuotaExceededError\)/,
    );
    expect(calls).toEqual([]);
    expect(handle.removed).toEqual([LOCATION_ID_FILE]);
    expect(handle.exists).toBe(false);
  });

  test("rejects, saying the folder was not found, when the backend cannot place it", async () => {
    const handle = new FakeDirectoryHandle();
    installPicker(handle);
    const { locate } = recordLocate(null);

    await expect(pickDirectoryPath(locate)).rejects.toThrow(
      /^Jx Studio could not find where "Projects" is\..*Type its full path into Location instead\.$/,
    );
    // The backend never claimed it, so this side must clear the tag.
    expect(handle.removed).toEqual([LOCATION_ID_FILE]);
    expect(handle.exists).toBe(false);
  });

  test("rejects with the lookup's own reason, and still clears the tag, when locate throws", async () => {
    const handle = new FakeDirectoryHandle();
    installPicker(handle);
    const failure = new Error("500 from /__studio/locate-directory");
    const { locate } = recordLocate(failure);

    const error = await rejectionOf(pickDirectoryPath(locate));
    expect((error as Error).message).toBe(
      'Jx Studio could not look up where "Projects" is: 500 from /__studio/locate-directory. Type the folder\'s path into Location instead.',
    );
    expect((error as Error).cause).toBe(failure);
    expect(handle.removed).toEqual([LOCATION_ID_FILE]);
  });

  test("still returns the path when cleanup fails", async () => {
    const handle = new FakeDirectoryHandle();
    // The backend deletes the tag the moment it matches, so removeEntry losing the race is the
    // Expected case — never a reason to fail a pick the user already made.
    handle.removeError = new Error("NotFoundError");
    installPicker(handle);
    const { locate } = recordLocate("/home/dev/Projects");

    expect(await pickDirectoryPath(locate)).toBe("/home/dev/Projects");
    expect(handle.removed).toEqual([LOCATION_ID_FILE]);
  });
});
