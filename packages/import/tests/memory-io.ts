/**
 * In-memory doubles of the two host interfaces the importer is written against.
 *
 * `memoryIo` is an `ImportIo` that keeps everything in a Map — the sink a caller with no filesystem
 * supplies. It is shared by the emit, asset-download and pipeline suites so all three assert the
 * same contract: project-relative forward-slashed keys, and nothing touching disk.
 *
 * `recordingPage` is an `ImportPage` that runs every `evaluate()` callback in-process and records
 * each viewport it is resized to, shared by the style-capture and media-extract suites.
 */
import type { ImportPage } from "../src/capture.ts";
import type { ImportIo } from "../src/io.ts";

export interface MemoryIo {
  io: ImportIo;
  /** Everything written, keyed by the project-relative path it was written under. */
  files: Map<string, string | Uint8Array>;
  /** Directories the sink was asked to create, in order. */
  dirs: string[];
  /** The text of one written file, for the common case of a JSON document. */
  text: (relPath: string) => string;
}

export function memoryIo(): MemoryIo {
  const files = new Map<string, string | Uint8Array>();
  const dirs: string[] = [];
  return {
    files,
    dirs,
    text(relPath) {
      const data = files.get(relPath);
      if (data === undefined) {
        throw new Error(`nothing was written to "${relPath}"`);
      }
      return data instanceof Uint8Array ? new TextDecoder().decode(data) : data;
    },
    io: {
      write(relPath, data) {
        files.set(relPath, data);
        return Promise.resolve();
      },
      mkdir(relPath) {
        dirs.push(relPath);
        return Promise.resolve();
      },
    },
  };
}

/** The viewport an `ImportPage` is resized to: exactly what its `setViewport` accepts. */
export type Viewport = Parameters<ImportPage["setViewport"]>[0];

export interface RecordingPage {
  page: ImportPage;
  /** Every viewport the page was resized to, in order. */
  viewports: Viewport[];
}

/**
 * An `ImportPage` for code that only evaluates and resizes. `evaluate()` callbacks run in-process,
 * so they see whatever DOM globals the suite registered; navigating, screenshotting or closing
 * rejects, naming `caller`, because the code under test was not expected to.
 */
export function recordingPage(caller: string): RecordingPage {
  const viewports: Viewport[] = [];
  const unused =
    (member: string): (() => Promise<never>) =>
    () =>
      Promise.reject(new Error(`${caller} called page.${member}`));
  const page: ImportPage = {
    close: unused("close"),
    evaluate: (fn, ...args) => Promise.resolve(fn(...args)),
    goto: unused("goto"),
    screenshot: unused("screenshot"),
    setViewport(viewport) {
      viewports.push(viewport);
      return Promise.resolve();
    },
  };
  return { page, viewports };
}
