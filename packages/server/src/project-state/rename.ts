/**
 * The rename cascade (`specs/project-state.md` §9): one {@link RenameOperation} that moves a file or
 * a directory and rewrites every reference to it, planned before the disk is touched and applied
 * from an outbox that undoes its completed steps when a later one fails.
 *
 * The planning half is the refactor engine's (`planRename`, `../refactor/apply.ts`), run before the
 * move over the documents the dependency graph says may reference what moves (§8), the project
 * configuration (whose references are not graph edges), and every document the host could not
 * index. Each rewrite names the hash of the bytes it was planned from, so a referrer that changed
 * between planning and applying refuses its step and rolls the operation back (§5).
 *
 * The outbox is in memory: a crash mid-operation leaves the steps already applied, and the host's
 * next start reports them as external changes. A durable outbox waits for §13.
 *
 * This module holds no state and touches no disk itself; the host hands it what it needs ({@link
 * RenameCascadeHost}) inside the queued step that makes the whole operation atomic with respect to
 * every other write.
 *
 * @module
 * @docs studio/projects/pages-layouts-components
 */

import { extname } from "node:path";
import {
  contentHash,
  renameRollbackWriteId,
  renameStepWriteId,
} from "@jxsuite/protocol/project-state";
import type {
  BufferRewrite,
  ContentHash,
  RenameApplied,
  RenameOperation,
  RenameOperationResult,
  RenameRefusalReason,
  RenameRefused,
  WriteRequest,
  WriteResult,
} from "@jxsuite/protocol/project-state";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { FormatRegistry } from "@jxsuite/schema/format-registry";
import { errorMessage } from "@jxsuite/schema/parse";
import type { JsonValue } from "@jxsuite/schema/types";
import { planRename } from "../refactor/apply.ts";
import { parseDoc } from "../refactor/scan.ts";
import type { LoadedDoc } from "../refactor/scan.ts";

/** One file or directory the host's index holds. */
export interface RenameIndexEntry {
  path: string;
  isDir: boolean;
  /** Whether the host extracted its references (§8.2). */
  indexed: boolean;
}

/** The formats the host has loaded, `null` before `extensions-resolved` (§7). */
export interface RenameFormats {
  /** Every file extension a registered format parses, lowercase with its dot. */
  extensions: readonly string[];
  parse: (extension: string, text: string) => Promise<JsonValue>;
  /**
   * The registry that also writes a registered format back; absent, such a document is named, not
   * rewritten.
   */
  registry?: FormatRegistry;
  mounts: readonly AssetMount[];
}

/** What the host lends the cascade for one operation, inside its queue. */
export interface RenameCascadeHost {
  /** The absolute project root. */
  root: string;
  /** Every entry in the index, project-relative. */
  entries: () => RenameIndexEntry[];
  /**
   * The documents whose references may name a file at `paths` (§8), or `null` when the graph cannot
   * answer (it is not built, or its watcher is degraded) and every document is a candidate.
   */
  referrersOf: (paths: readonly string[]) => string[] | null;
  formats: () => RenameFormats | null;
  /** A file's bytes, `null` when nothing is there. */
  read: (path: string) => Promise<Uint8Array | null>;
  /**
   * Whether `path` is taken on disk by something other than the operation's `from`: on a
   * case-insensitive filesystem, `from` in another case is `from` itself, and a rename to it is a
   * rename (`studio.md` §9.1.1).
   */
  exists: (path: string) => Promise<boolean>;
  /**
   * Move `from` to `to` through the index, as the write `writeId` (§9.1), answering the directories
   * it created for `to`, outermost first. Throws on failure.
   */
  move: (from: string, to: string, writeId: string) => Promise<string[]>;
  /**
   * Remove each of `dirs` that is empty, innermost first, through the index, as the write
   * `writeId`: the undo of the directories a move created.
   */
  removeDirs: (dirs: readonly string[], writeId: string) => Promise<void>;
  /** A conditional write through the host, outside its queue (the caller holds it) (§5). */
  write: (request: WriteRequest) => Promise<WriteResult>;
  /** Append `operationApplied`, answering its revision (§4.7). */
  applied: (opId: string, files: string[]) => number;
  /** Called before each step runs, counted from 0; a throw fails that step. */
  beforeStep?: (step: number, path: string) => void | Promise<void>;
}

/** Paths a rename never moves: their arrival and departure move the configuration and readiness. */
export type Unmovable = (path: string) => boolean;

/** A document extension the host reads without an extension: JSON and Jx Notation. */
const NATIVE_DOCUMENT = /\.(?:json|jxn)$/i;

/** Media and stylesheets: indexed by name, never parsed, never a referrer. */
const NOT_A_DOCUMENT =
  /\.(?:css|png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp4|webm|ogg|mov|mp3|wav|flac|m4a|woff2?|ttf|otf|eot|pdf)$/i;

/** Generated schema artifacts, which the refactor sweep never rewrites (`skipScanPath`). */
const GENERATED_SCHEMA = /\.schema\.json$/;

const decoder = new TextDecoder();

/** Whether `path` is `dir` or beneath it. */
const within = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);

/** Where `path` lands when `from` moves to `to`. */
const remap = (path: string, from: string, to: string): string =>
  within(path, from) ? to + path.slice(from.length) : path;

/** The answer to a refused or failed operation (§9.1, §9.2). */
function refusal(
  opId: string,
  reason: RenameRefusalReason,
  message: string,
  paths: string[],
): RenameRefused {
  return { message, ok: false, opId, paths, reason };
}

/** One step of the outbox: what it does, and how to undo it once it has run. */
interface Step {
  /** The path the step changes, after the move. */
  path: string;
  run: (writeId: string) => Promise<WriteResult | null>;
  undo: (writeId: string) => Promise<void>;
}

/**
 * Plan `operation`, refuse it or apply it (§9). Runs inside the host's queue, so nothing the host
 * does interleaves; a program outside the host changing a referrer between planning and applying is
 * caught by that step's base hash.
 */
export async function runRenameCascade(
  host: RenameCascadeHost,
  operation: RenameOperation,
  unmovable: Unmovable,
): Promise<RenameOperationResult> {
  const { from, opId, to } = operation;
  if (from === to || within(to, from)) {
    return refusal(opId, "failed", `"${from}" cannot be moved into itself.`, [to]);
  }
  if (unmovable(from) || unmovable(to)) {
    return refusal(
      opId,
      "failed",
      "The project configuration, the package manifest and the lockfiles are not renamed.",
      [unmovable(from) ? from : to],
    );
  }
  const entries = host.entries();
  const top = entries.find((entry) => entry.path === from);
  if (top === undefined) {
    return refusal(opId, "conflict", `Nothing is at "${from}".`, [from]);
  }
  if (await host.exists(to)) {
    return refusal(opId, "conflict", `"${to}" already exists.`, [to]);
  }
  const formats = host.formats();
  const parses = (path: string): boolean => {
    const extension = extname(path).toLowerCase();
    return NATIVE_DOCUMENT.test(path) || (formats?.extensions.includes(extension) ?? false);
  };
  const isDocument = (entry: RenameIndexEntry): boolean =>
    !entry.isDir && !GENERATED_SCHEMA.test(entry.path) && parses(entry.path);

  /* ── Documents the host cannot parse (§8.2, §9.1) ──
     Only before the formats are known: once they are, a file no format parses is no document, and
     an unindexed one a format does parse (too large to index, say) is planned, read whole. */
  const unplannable =
    formats === null
      ? entries
          .filter(
            (entry) =>
              !entry.isDir &&
              !entry.indexed &&
              !parses(entry.path) &&
              !NOT_A_DOCUMENT.test(entry.path),
          )
          .map((entry) => entry.path)
      : [];
  if (unplannable.length > 0 && operation.rewrites === undefined) {
    return refusal(
      opId,
      "rewrites-required",
      "Some documents cannot be read until the project's extensions load, so their references cannot be rewritten yet.",
      unplannable,
    );
  }
  const clientRewrites = new Map((operation.rewrites ?? []).map((item) => [item.path, item]));

  // ── The candidates: what moves, what the graph says refers to it, the configuration ──
  const moved = entries.filter((entry) => within(entry.path, from));
  const movedFiles = moved.filter((entry) => !entry.isDir).map((entry) => entry.path);
  const referrers = host.referrersOf(movedFiles);
  const candidates = new Set<string>();
  for (const entry of entries) {
    const named =
      referrers === null ||
      within(entry.path, from) ||
      !entry.indexed ||
      referrers.includes(entry.path) ||
      unmovable(entry.path);
    if (named && isDocument(entry) && !clientRewrites.has(entry.path)) {
      candidates.add(entry.path);
    }
  }

  // ── The plan: every rewrite's bytes and the hash they replace, read before anything moves ──
  const root = host.root.replaceAll("\\", "/");
  const abs = (path: string): string => `${root}/${path}`;
  const rel = (path: string): string => path.slice(root.length + 1);
  const read = new Map<string, ContentHash>();
  const load = async (fp: string): Promise<LoadedDoc> => {
    const path = rel(fp);
    const bytes = await host.read(path);
    if (bytes === null) {
      throw new Error(`"${path}" is gone`);
    }
    read.set(path, await contentHash(bytes));
    const text = decoder.decode(bytes);
    if (formats?.registry !== undefined || NATIVE_DOCUMENT.test(path)) {
      return parseDoc(fp, text, formats?.registry ?? null);
    }
    // A registered format the host can read but not write: planned, then named in the report.
    const doc = await formats!.parse(extname(path).toLowerCase(), text);
    return { doc, rewrite: null, serialize: null };
  };
  let renamed: LoadedDoc | null = null;
  if (!top.isDir && isDocument(top)) {
    try {
      renamed = await load(abs(from));
    } catch {
      // Not a parseable document: no tag to derive.
    }
  }
  const plan = await planRename({
    absFrom: abs(from),
    absTo: abs(to),
    documents: [...candidates].toSorted().map((path) => abs(path)),
    load,
    mounts: formats?.mounts ?? [],
    phase: "before",
    renamed,
    root,
  });

  // ── Dirty referrers (§9.2) ──
  const dirty = new Map(operation.dirtyReferrers.map((item) => [item.path, item.bufferRev]));
  // Every path in the answer names the file after the move.
  const errors = plan.errors.map((entry) => ({
    error: entry.error,
    path: remap(rel(entry.abs), from, to),
  }));
  const buffers: BufferRewrite[] = [];
  const refused: string[] = [];
  const writes: {
    path: string;
    base: ContentHash;
    contents: string | Uint8Array;
    refs: number;
    tags: number;
    /** A client's rewrite (§9.1), whose references the host did not count. */
    client: boolean;
  }[] = [];
  for (const planned of plan.rewrites) {
    const path = rel(planned.abs);
    const bufferRev = dirty.get(path);
    if (bufferRev !== undefined) {
      if (operation.policy === "refuse") {
        refused.push(path);
        continue;
      }
      const rewrite: BufferRewrite = {
        bufferRev,
        changes: planned.changes.map((change) => ({ from: change.from, to: change.to })),
        path,
      };
      if (planned.tagCount > 0 && plan.tagRename !== null) {
        rewrite.tag = { ...plan.tagRename };
      }
      buffers.push(rewrite);
      continue;
    }
    if (planned.contents === null) {
      errors.push({
        error: `No serializer for "${remap(path, from, to)}"`,
        path: remap(path, from, to),
      });
      continue;
    }
    writes.push({
      base: read.get(path)!,
      contents: planned.contents,
      client: false,
      path: remap(path, from, to),
      refs: planned.changes.length,
      tags: planned.tagCount,
    });
  }
  for (const rewrite of clientRewrites.values()) {
    const bufferRev = dirty.get(rewrite.path);
    if (bufferRev !== undefined) {
      if (operation.policy === "refuse") {
        refused.push(rewrite.path);
        continue;
      }
      // The client computed this rewrite, so it applies it to its buffer; the file stays (§9.2).
      buffers.push({ bufferRev, changes: [], path: rewrite.path });
      continue;
    }
    writes.push({
      base: rewrite.baseHash,
      client: true,
      contents: rewrite.contents,
      path: remap(rewrite.path, from, to),
      refs: 0,
      tags: 0,
    });
  }
  if (refused.length > 0) {
    return refusal(
      opId,
      "dirty-referrers",
      "Some documents that refer to it have unsaved edits.",
      refused,
    );
  }

  // ── The outbox: the move, then every rewrite at its path after the move ──
  /** The bytes each rewritten file held when its step ran, for its undo. */
  const original = new Map<string, Uint8Array>();
  /** The directories the move created for `to`, which its undo removes again. */
  let created: string[] = [];
  const steps: Step[] = [
    {
      path: to,
      run: async (writeId) => {
        created = await host.move(from, to, writeId);
        return null;
      },
      undo: async (writeId) => {
        await host.move(to, from, writeId);
        await host.removeDirs(created, writeId);
      },
    },
    ...writes.map((write): Step => ({
      path: write.path,
      run: (writeId) =>
        host.write({
          baseHash: write.base,
          contents: write.contents,
          path: write.path,
          writeId,
        }),
      undo: async (writeId) => {
        // Back to the bytes the step replaced, against the bytes it wrote.
        const restored = await host.write({
          baseHash: await contentHash(write.contents),
          contents: original.get(write.path)!,
          path: write.path,
          writeId,
        });
        if (!restored.ok) {
          throw new Error(`"${write.path}" changed again before it could be restored`);
        }
      },
    })),
  ];
  const completed: number[] = [];
  const rollback = async (): Promise<{ path: string; error: string }[]> => {
    const failures: { path: string; error: string }[] = [];
    for (const at of completed.toReversed()) {
      try {
        await steps[at]!.undo(renameRollbackWriteId(opId, at));
      } catch (error) {
        failures.push({ error: errorMessage(error), path: steps[at]!.path });
      }
    }
    return failures;
  };
  const failed = async (
    reason: RenameRefusalReason,
    message: string,
    paths: string[],
  ): Promise<RenameOperationResult> => {
    const failures = await rollback();
    if (failures.length === 0) {
      return refusal(opId, reason, `${message} Nothing was changed.`, paths);
    }
    const listed = failures.map((failure) => `${failure.path}: ${failure.error}`).join("; ");
    return {
      ...refusal(opId, reason, `${message} Some steps could not be undone: ${listed}.`, paths),
      unrestored: failures.map((failure) => failure.path),
    };
  };
  for (const [at, step] of steps.entries()) {
    let result: WriteResult | null;
    try {
      await host.beforeStep?.(at, step.path);
      if (at > 0) {
        const before = await host.read(step.path);
        if (before !== null) {
          original.set(step.path, before);
        }
      }
      result = await step.run(renameStepWriteId(opId, at));
    } catch (error) {
      return failed("failed", `The rename failed at "${step.path}": ${errorMessage(error)}.`, [
        step.path,
      ]);
    }
    if (result !== null && !result.ok) {
      return failed("conflict", `"${step.path}" changed while the rename was being applied.`, [
        step.path,
      ]);
    }
    completed.push(at);
  }

  // ── Done: one operationApplied after every step's events (§4.7) ──
  // The moved document can also be a rewrite step (its own tag): name each path once, the move first.
  const files = [...new Set(steps.map((step) => step.path))];
  const rev = host.applied(opId, files);
  // A client's rewrite counts its file: the host did not count its references.
  const referenced = writes.filter((write) => write.refs > 0 || write.client);
  const applied: RenameApplied = {
    buffers,
    errors,
    files,
    from,
    isDir: top.isDir,
    ok: true,
    opId,
    references: {
      files: referenced.map((write) => ({ count: write.refs, path: write.path })),
      filesChanged: referenced.length,
      refsUpdated: referenced.reduce((sum, write) => sum + write.refs, 0),
    },
    rev,
    to,
  };
  if (plan.tagRename !== null) {
    const tagged = writes.filter((write) => write.tags > 0);
    applied.tag = {
      ...plan.tagRename,
      filesChanged: tagged.length,
      refsUpdated: tagged.reduce((sum, write) => sum + write.tags, 0),
    };
  }
  if (plan.tagSkipped !== undefined) {
    applied.tagSkipped = plan.tagSkipped;
  }
  return applied;
}
