/**
 * Watcher.ts — a small chokidar wrapper that emits coalesced, batched FS-event payloads to a sink.
 *
 * Used by the desktop project session (which has no SSE stream) to push filesystem changes to its
 * webview over RPC, and by the dev server for an active project its own watcher in watch.ts
 * (intertwined with build/reload) cannot see. Both share the pure `toFsEvent`/`coalesceFsEvents`
 * helpers.
 */

import { watch } from "chokidar";
import { relative } from "node:path";
import { errorMessage } from "@jxsuite/schema/parse";
import { coalesceFsEvents, toFsEvent } from "./fs-events.ts";
import { invalidateReferenceCache } from "./find-refs.ts";
import { createWatchIgnore } from "../watch-policy.ts";
import type { FsEventPayload } from "./fs-events.ts";

const IGNORE_SEGMENTS = ["node_modules", ".git", "dist", ".jx", ".direnv", ".devenv"];

/**
 * Whether a path below `root` is one of the folders no project wants events for.
 *
 * Judged from the root down, because what lies above it says nothing about the project: read whole,
 * a project at `~/dist/site` or `~/sites/.jx/site` would have every entry in it ignored.
 */
function isIgnored(root: string, path: string): boolean {
  const f = `/${relative(root, path).replaceAll("\\", "/")}`;
  return IGNORE_SEGMENTS.some((s) => f.includes(`/${s}/`) || f.endsWith(`/${s}`));
}

export interface FsWatcherHandle {
  close: () => Promise<void>;
  /**
   * Settles once chokidar's initial scan is done and every directory under the root is watched.
   *
   * `ignoreInitial` means nothing that existed, or was written, while the scan ran is announced: a
   * consumer that listed the tree before this settles must list it again after, or a file written
   * in that window (a scaffold, an install) stays invisible until something else touches it. It
   * never rejects; a watcher closed before it was ready resolves it too.
   */
  ready: Promise<void>;
}

/** Options for {@link createFsWatcher}. */
export interface FsWatcherOptions {
  /** Quiet period, in ms, before a coalesced batch is delivered. Defaults to 40. */
  debounce?: number;
  /**
   * How long, in ms, a file's size must hold still before its `add`/`change` is reported. Defaults
   * to 50, the dev server's own watcher setting, so an editor's or an installer's partial write is
   * reported once, finished, rather than as a half-written file.
   */
  stabilityThreshold?: number;
  /**
   * Told about every watcher error, a non-Error cause wrapped in one. Errors are never fatal;
   * without this they are logged.
   */
  onError?: (error: Error) => void;
}

/**
 * Watch `root`, coalescing rapid changes and delivering batches to `sink`. Returns a handle whose
 * `close()` stops the watcher and clears any pending batch, and whose `ready` settles when the
 * initial scan has finished.
 */
export function createFsWatcher(
  root: string,
  sink: (events: FsEventPayload[]) => void,
  opts: FsWatcherOptions = {},
): FsWatcherHandle {
  const debounceMs = opts.debounce ?? 40;
  let buffer: FsEventPayload[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(root, {
    // The same settings as the dev server's watcher (watch.ts), so both report a write once it is whole.
    awaitWriteFinish: {
      pollInterval: 10,
      stabilityThreshold: opts.stabilityThreshold ?? 50,
    },
    /* Left on deliberately: a symlink inside a project is project content, and its events belong
       in the sidebar. It is the link pointing OUT of the root that walks the watcher off into the
       rest of the filesystem, and createWatchIgnore drops exactly those — along with the sockets
       and device nodes fs.watch answers with ENXIO. */
    followSymlinks: true,
    ignoreInitial: true,
    ignorePermissionErrors: true,
    ignored: createWatchIgnore(root, (path) => isIgnored(root, path)),
  });

  watcher.on("all", (eventType, changedPath) => {
    const event = toFsEvent(eventType, root, changedPath);
    if (!event) {
      return;
    }
    // Any move under the root can change who references what, so the usage cache drops the whole
    // Project rather than trying to derive which queries this one path could have affected.
    invalidateReferenceCache(root);
    buffer = coalesceFsEvents(buffer, event);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      if (buffer.length > 0) {
        sink(buffer);
        buffer = [];
      }
    }, debounceMs);
  });

  /* An `error` with no listener is not logged by an EventEmitter, it is THROWN — which is how a
     directory holding a few unix sockets took the whole launcher down rather than losing a few
     watches. The filter above means these should now be rare; the listener means they are never
     fatal when they are not. */
  watcher.on("error", (cause) => {
    if (opts.onError) {
      opts.onError(cause instanceof Error ? cause : new Error(errorMessage(cause)));
      return;
    }
    console.error(`[fs-watch] ${errorMessage(cause)}`);
  });

  // Assigned synchronously by the executor, so it is set before anything below can call it.
  let markReady: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  watcher.once("ready", () => markReady?.());

  return {
    close: async () => {
      markReady?.();
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      buffer = [];
      await watcher.close();
    },
    ready,
  };
}
