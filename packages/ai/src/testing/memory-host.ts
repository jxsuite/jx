/**
 * An in-memory harness host: a document the portable tree tools read and write, and a place to keep
 * checkpoints, with nothing behind either but this process.
 *
 * It exists so a test can run a whole turn (or the same turn two ways, inline and suspended) and
 * compare the documents they leave, with no Studio and no disk (specs/ai.md §3.9, §3.12).
 *
 * @module @jxsuite/ai/testing
 */

import { applyDocOpsWithInverse } from "@jxsuite/schema/doc-ops";
import type { JxMutableNode } from "@jxsuite/schema/types";
import type { TurnCheckpoint } from "../harness/types.ts";
import type { ProjectEntry, ProjectHost } from "../jx-tools/project.ts";
import type { DocumentHost, DocumentRef, WriteReporter } from "../jx-tools/types.ts";

/** What {@link createMemoryHarnessHost} hands back. */
export interface MemoryHarnessHost {
  /** The host the tree tools are built over (`docToolEntries(host.documents, …)`). */
  readonly documents: DocumentHost;
  /** A reporter that brackets each write with nothing, and answers the producer's own summary. */
  readonly reporter: WriteReporter<null>;
  /** The document as it stands now. */
  readonly document: () => JxMutableNode;
  /** Checkpoints by turn id, for a test that stores one and resumes it. */
  readonly checkpoints: Map<string, TurnCheckpoint>;
  /** The host the file tools are built over (`projectToolEntries(host.project)`). */
  readonly project: ProjectHost;
  /** The project's files by project-relative path, as they stand now. */
  readonly files: Map<string, string>;
}

/**
 * A host holding one document in memory. It cannot undo, so an edit its producer refuses is not
 * applied, and one it accepts is applied to the live document at once.
 *
 * Its project is a flat map of files: a directory is whatever paths share its prefix, a search
 * matches a file's name, and a write is allowed unless `beforeWrite` (which a test may set on the
 * returned `project`) says otherwise.
 *
 * @param {JxMutableNode} initial - The document to start from; it is copied, never written
 * @param {Readonly<Record<string, string>>} [files] - The project's files, by relative path
 * @returns {MemoryHarnessHost}
 */
export function createMemoryHarnessHost(
  initial: JxMutableNode,
  files: Readonly<Record<string, string>> = {},
): MemoryHarnessHost {
  const held = new Map(Object.entries(files));
  const project: ProjectHost = {
    list(dir) {
      const prefix = dir === "." ? "" : `${dir}/`;
      const entries = new Map<string, ProjectEntry>();
      for (const [path, text] of held) {
        if (!path.startsWith(prefix)) {
          continue;
        }
        const [name = "", ...deeper] = path.slice(prefix.length).split("/");
        const entry: ProjectEntry =
          deeper.length > 0
            ? { name, path: `${prefix}${name}`, type: "directory" }
            : { name, path, size: text.length, type: "file" };
        entries.set(name, entry);
      }
      return entries.size === 0 && prefix !== ""
        ? Promise.reject(new Error(`No such directory: ${dir}`))
        : Promise.resolve([...entries.values()]);
    },
    read(path) {
      const text = held.get(path);
      return text === undefined
        ? Promise.reject(new Error("No such file."))
        : Promise.resolve(text);
    },
    search(query, extensions) {
      const matches = [...held.keys()].filter((path) => {
        const name = path.split("/").at(-1) ?? "";
        return (
          name.includes(query) &&
          (!extensions || extensions.some((extension) => name.endsWith(extension)))
        );
      });
      return Promise.resolve(matches.map((path) => ({ path })));
    },
    write(path, text) {
      held.set(path, text);
      return Promise.resolve();
    },
  };
  const live = structuredClone(initial);
  const ref: DocumentRef = { id: "memory", path: null };
  const documents: DocumentHost = {
    edit(_ref, produce) {
      const edit = produce(live);
      if (!edit.ok) {
        return { applied: false, message: edit.error, reason: "refused" };
      }
      applyDocOpsWithInverse(live, edit.ops);
      return { applied: true, changed: edit.ops.length > 0 };
    },
    resolve: () => ref,
    snapshot: () => live,
    undoable: "none",
  };
  const reporter: WriteReporter<null> = {
    after: (_ref, _before, summary) => Promise.resolve({ success: true, summary }),
    before: () => Promise.resolve(null),
  };
  return {
    checkpoints: new Map(),
    document: () => structuredClone(live),
    documents,
    files: held,
    project,
    reporter,
  };
}
