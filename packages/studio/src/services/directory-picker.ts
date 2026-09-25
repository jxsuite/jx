/// <reference lib="dom" />
/**
 * Browser-side folder picking for the New Project modal's **Browse…** button.
 *
 * `showDirectoryPicker()` is the only native folder chooser a web page gets, but it hands back a
 * `FileSystemDirectoryHandle` that exposes `.name` and nothing else — never a filesystem path
 * (specs/desktop.md §8.2). Opening a project works around that by searching for the `project.json`
 * the user pointed at, which is no help when choosing a _destination_: that folder is empty by
 * definition, and often does not exist as a project at all.
 *
 * So the handle is made to identify itself. Using the readwrite grant the picker just issued, we
 * drop a hidden {@link LOCATION_ID_FILE} holding a freshly generated id and ask the backend which
 * directory holds that exact id. A fixed filename with the identity in its _contents_ is what makes
 * the match unambiguous: two folders may share a basename, and a stale file from a crashed session
 * may still be lying around, but only one file anywhere holds this id. The file lives in the chosen
 * **Location** (the parent the project will be created in), never in the new project folder. The
 * backend deletes it as soon as it matches, and this module removes it on every path the page
 * survives, including a write that failed after the empty file was created. Only a tab closed
 * mid-lookup can leave one behind, and a stale id can never match a later pick.
 *
 * **`null` means the user dismissed the chooser, and nothing else does.** Every other failure
 * rejects with a sentence fit to show under the Location field: the chooser could not open, the
 * folder cannot be written, the backend could not be reached, or it found no folder holding the id.
 * This used to resolve `null` for all of them, which made a broken lookup indistinguishable from a
 * cancel, and Browse… a button that silently did nothing.
 *
 * Only the plain dev-server browser session needs this. Every packaged build has a real native
 * dialog that returns a path directly and keeps it — electrobun's `Utils.openFileDialog`, and the
 * NixOS chromium build's XDG desktop portal.
 *
 * @docs studio/projects/create
 */

import { LOCATION_ID_FILE } from "@jxsuite/protocol/routes";
import { errorMessage } from "@jxsuite/schema/parse";

/** Re-exported so a caller wiring up `locate` need not also reach into the protocol package. */
export { LOCATION_ID_FILE } from "@jxsuite/protocol/routes";

/** The subset of the File System Access API this module uses. */
interface WritableHandle {
  createWritable: () => Promise<{
    write: (data: string) => Promise<void>;
    close: () => Promise<void>;
  }>;
}

interface DirectoryHandle {
  name: string;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<WritableHandle>;
  removeEntry: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
}

type ShowDirectoryPicker = (opts?: {
  id?: string;
  mode?: "read" | "readwrite";
  startIn?: string;
}) => Promise<DirectoryHandle>;

/** Whether this browser can open a native folder chooser at all. */
export function canPickDirectory(): boolean {
  return (
    typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function"
  );
}

/** A location id: URL-safe, unguessable enough that a concurrent pick cannot collide. */
function newLocationId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * A thrown value's `name`, read structurally. A DOMException from another realm (an iframe's
 * `showDirectoryPicker`, a test double) is not `instanceof Error` here, but it still says what it
 * is.
 */
function nameOf(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string"
    ? error.name
    : "";
}

/**
 * Open the browser's native folder chooser and resolve the chosen folder's absolute path.
 *
 * Resolves `null` only when the user dismisses the chooser (an `AbortError`, which is also what a
 * declined readwrite grant reaches the page as: a user choice either way). Everything else rejects
 * with an Error whose message is a plain sentence the caller can show as is:
 *
 * - No `showDirectoryPicker` at all (the dev-server adapter never offers Browse… then, so only an
 *   embedder wiring this helper by hand reaches it);
 * - The chooser refused to open (a `SecurityError` included: this runs synchronously from the click,
 *   so a lost gesture means the environment is wrong, and silence would be a dead button);
 * - The folder cannot be written, so it cannot be tagged, and a project could not be created there
 *   either;
 * - `locate` threw (backend unreachable, non-ok), or answered `null` (no folder holds the id).
 *
 * MUST be called synchronously from a user gesture; `showDirectoryPicker()` is invoked before this
 * function awaits anything so a click handler that calls it directly keeps the gesture.
 *
 * @param locate Ask the backend which directory holds `id`, given the handle's `name`. Resolve the
 *   path, resolve `null` for "no directory holds this id", and throw on a transport or backend
 *   failure. The not-found sentence assumes a backend that searches the home folder, as the dev
 *   server does.
 */
export async function pickDirectoryPath(
  locate: (query: { name: string; id: string }) => Promise<string | null>,
): Promise<string | null> {
  const show = (globalThis as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker;
  if (typeof show !== "function") {
    throw new TypeError(
      "This browser has no folder chooser. Type the folder's path into Location instead.",
    );
  }

  let handle: DirectoryHandle;
  try {
    // `id` makes Chrome reopen at the last folder chosen for this purpose across sessions.
    handle = await show({ id: "jx-new-project-location", mode: "readwrite", startIn: "documents" });
  } catch (error) {
    if (nameOf(error) === "AbortError") {
      return null;
    }
    throw new Error(
      `The folder chooser could not open (${errorMessage(error)}). Type the folder's path into Location instead.`,
      { cause: error },
    );
  }

  const { name } = handle;
  const id = newLocationId();
  /* The `getFileHandle({ create: true })` call puts an empty file on disk before anything is
     written, so a write that fails after it still leaves a tag to clean up. Only remove what this
     call created. */
  let tagged = false;
  try {
    try {
      const file = await handle.getFileHandle(LOCATION_ID_FILE, { create: true });
      tagged = true;
      const writable = await file.createWritable();
      await writable.write(id);
      await writable.close();
    } catch (error) {
      /* The readwrite grant was just issued, so this is the filesystem refusing: a read-only
         mount, OS permissions, a full disk. Creating the project there would fail the same way. */
      throw new Error(
        `Jx Studio can't write to "${name}" (${errorMessage(error)}), so it can't create a project there. Choose a folder you can write to.`,
        { cause: error },
      );
    }

    let path: string | null;
    try {
      path = await locate({ id, name });
    } catch (error) {
      throw new Error(
        `Jx Studio could not look up where "${name}" is: ${errorMessage(error)}. Type the folder's path into Location instead.`,
        { cause: error },
      );
    }
    if (!path) {
      throw new Error(
        `Jx Studio could not find where "${name}" is. From a browser it can only find folders inside your home folder. Type its full path into Location instead.`,
      );
    }
    return path;
  } finally {
    // The backend removes the file the moment it matches; this covers every path where it did not
    // (no match, a network failure, a backend that never ran the lookup, a half-finished write).
    if (tagged) {
      await handle.removeEntry(LOCATION_ID_FILE).catch(() => {
        /* Already gone — the backend beat us to it. */
      });
    }
  }
}
