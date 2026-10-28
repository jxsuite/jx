/**
 * The wire between the Electron main process and the Bun backend it spawns.
 *
 * One Electron process owns every window and the OS surface (menus, dialogs, the single-instance
 * lock, file associations); one Bun process owns every project (a `ProjectSession` and a loopback
 * server per window). They speak over the IPC channel Electron opens when it spawns the backend,
 * JSON-serialized so Bun, which is not Node, can read it (`serialization: "json"` on both ends).
 *
 * The protocol is deliberately small, and it carries no project I/O: that stays on each window's
 * token-gated WebSocket. These messages exist for the things a web page cannot do and a Bun process
 * cannot do either: draw a window, raise it, ask the user for a path.
 *
 * @docs studio/desktop
 */
import { isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";

/** What a native picker is asked to choose. */
export type DialogKind = "directory" | "file";

/** Backend → shell. */
export type BackendMessage =
  /** The backend is listening; the shell may now send it work. */
  | { type: "ready" }
  /** Open a window onto a window server the backend just stood up. */
  | { type: "open-window"; id: number; partition: string; title: string; url: string }
  /** Bring a window forward, restoring it first if it is minimized. */
  | { type: "focus-window"; id: number }
  /** The window now holds another project. */
  | { type: "set-title"; id: number; title: string }
  /** Ask the user for a path; answered by a {@link ShellMessage} `dialog-result` with the same id. */
  | { type: "dialog"; kind: DialogKind; requestId: number; title: string }
  /** The backend is finished and the app should end. */
  | { type: "quit" };

/** Shell → backend. */
export type ShellMessage =
  /** Open a project (or a welcome window, for null): argv, a second launch, a file association. */
  | { type: "open-project"; root: string | null }
  /** The user closed a window; its session and server are no longer wanted. */
  | { type: "window-closed"; id: number }
  /** The answer to a `dialog`: the chosen path, or null when the user cancelled. */
  | { type: "dialog-result"; path: string | null; requestId: number }
  /** What the updater last found, in words, for the About screen. */
  | { type: "update-status"; text: string };

/** Whether a value is an object with a string `type`, which is all a frame has to have to be read. */
function hasType(value: unknown): value is { type: string } {
  return isNonNullObject(value) && "type" in value && isString(value.type);
}

/**
 * Whether a value received from the backend is one of its messages.
 *
 * The channel's peer is a process this app started, but the guard is still the boundary: a frame is
 * trusted once it has the shape its `type` promises, and an unknown type is ignored rather than
 * guessed at.
 *
 * @param value The deserialized IPC payload.
 */
export function isBackendMessage(value: unknown): value is BackendMessage {
  if (!hasType(value)) {
    return false;
  }
  switch (value.type) {
    case "ready":
    case "quit": {
      return true;
    }
    case "open-window": {
      return (
        "id" in value &&
        isNumber(value.id) &&
        "partition" in value &&
        isString(value.partition) &&
        "title" in value &&
        isString(value.title) &&
        "url" in value &&
        isString(value.url)
      );
    }
    case "focus-window": {
      return "id" in value && isNumber(value.id);
    }
    case "set-title": {
      return "id" in value && isNumber(value.id) && "title" in value && isString(value.title);
    }
    case "dialog": {
      return (
        "kind" in value &&
        (value.kind === "file" || value.kind === "directory") &&
        "requestId" in value &&
        isNumber(value.requestId) &&
        "title" in value &&
        isString(value.title)
      );
    }
    default: {
      return false;
    }
  }
}

/**
 * Whether a value received from the shell is one of its messages.
 *
 * @param value The deserialized IPC payload.
 */
export function isShellMessage(value: unknown): value is ShellMessage {
  if (!hasType(value)) {
    return false;
  }
  switch (value.type) {
    case "open-project": {
      return "root" in value && (value.root === null || isString(value.root));
    }
    case "window-closed": {
      return "id" in value && isNumber(value.id);
    }
    case "dialog-result": {
      return (
        "requestId" in value &&
        isNumber(value.requestId) &&
        "path" in value &&
        (value.path === null || isString(value.path))
      );
    }
    case "update-status": {
      return "text" in value && isString(value.text);
    }
    default: {
      return false;
    }
  }
}
