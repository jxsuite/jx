/**
 * Apply.ts — IO orchestrator for rename-refactoring, shared by the dev-server endpoint
 * (studio-api.ts) and the desktop project session.
 *
 * The caller performs the filesystem move first, then calls `applyRename`, which globs the
 * project's document + content files, runs the pure engines from refs.ts against each, writes back
 * only the files that changed, and returns a `RenameReport`. When the renamed file is a component,
 * the tag is auto-derived from the new filename and renamed everywhere it is used (Pillar C).
 */

import { basename, dirname, extname, relative, resolve } from "node:path";
import { stat, writeFile } from "node:fs/promises";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { isUnder } from "./paths.ts";
import { rewriteDocRefs, rewriteTagName } from "./refs.ts";
import { documentGlob, fwd, loadDoc, skipScanPath } from "./scan.ts";
import type { LoadedDoc } from "./scan.ts";
import { invalidateReferenceCache } from "./find-refs.ts";
import { refactorMounts } from "./mounts.ts";
import type { RefChange } from "./refs.ts";
import type { AssetMount } from "@jxsuite/schema/asset-paths";
import type { FormatRegistry } from "@jxsuite/schema/format-registry";
import { scanFiles } from "../fs-glob.ts";

export interface FileChange {
  path: string;
  count: number;
  changes: RefChange[];
}

export interface RenameReport {
  ok: boolean;
  from: string;
  to: string;
  isDir: boolean;
  references: {
    filesChanged: number;
    refsUpdated: number;
    files: FileChange[];
  };
  errors: { path: string; error: string }[];
  tag?: { from: string; to: string; filesChanged: number; refsUpdated: number };
  tagSkipped?: string;
}

export interface ApplyRenameOptions {
  /** Absolute project root to scan. */
  root: string;
  /** Absolute path of the renamed file/dir, before the move. */
  absFrom: string;
  /** Absolute path of the renamed file/dir, after the move (already on disk). */
  absTo: string;
  /** Format registry for the project (parse/serialize of non-JSON documents). */
  registry: FormatRegistry;
  /**
   * Project-relative asset mounts, for rewriting rooted references through the mount lane. Omitted,
   * the engine loads them from `root` — see `mounts.ts` for why that is the default and not the
   * exception.
   */
  mounts?: readonly AssetMount[];
}

/** Derive a custom-element tag from a component filename (strips `.class.json` or the extension). */
export function deriveTag(absPath: string): string {
  const base = basename(absPath);
  if (base.endsWith(".class.json")) {
    return base.slice(0, -".class.json".length);
  }
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Rewrite references (and, for components, the tag) across the project after a rename. The caller
 * must have already moved the file on disk.
 */
export async function applyRename(opts: ApplyRenameOptions): Promise<RenameReport> {
  /* The usage cache is otherwise dropped by the file watcher, which reports this rename some time
     after the route has answered it, and not at all under a path it ignores. The caller's very next
     question is "who uses the new name?", and a confident zero read from the old sweep is the one
     answer a delete must never be prompted by. On every exit: a pass that threw may have written. */
  try {
    return await rewriteReferences(opts);
  } finally {
    invalidateReferenceCache(opts.root);
  }
}

/** One document the planning half would rewrite, and what it would write. */
export interface PlannedRewrite {
  /** The document's absolute POSIX path where the plan read it. */
  abs: string;
  /** The file references it rewrote. */
  changes: RefChange[];
  /** How many nodes carry the component tag it renamed. */
  tagCount: number;
  /**
   * The rewritten text, or `null` when no write-back path the format declares can express the
   * change: a tag rename in a format with no serializer, or a format with neither path.
   */
  contents: string | null;
}

/** What a rename would do to the project's documents, before anything is written. */
export interface RenamePlan {
  /** The component tag derived from the new filename, when the renamed file is a component. */
  tagRename: { from: string; to: string } | null;
  /** Why a component's tag is left as it was. */
  tagSkipped?: string;
  /** Every document with something to rewrite, in the order the plan read them. */
  rewrites: PlannedRewrite[];
  /** Documents that could not be read or parsed, by absolute POSIX path. */
  errors: { abs: string; error: string }[];
}

export interface PlanRenameOptions {
  /** Absolute project root. */
  root: string;
  /** Absolute path of the renamed file or directory before the move. */
  absFrom: string;
  /** Absolute path of the renamed file or directory after the move. */
  absTo: string;
  /** Project-relative asset mounts, for rewriting rooted references through the mount lane. */
  mounts: readonly AssetMount[];
  /**
   * Where `documents` and `renamed` are read: `"after"` when the move has already happened (what
   * {@link applyRename} does), `"before"` when it has not (the project state host plans first and
   * moves as the first step of its outbox, `project-state.md` §9.1).
   */
  phase: "before" | "after";
  /**
   * The renamed file itself, parsed, for a component's tag; `null` for a directory or a
   * non-document.
   */
  renamed: LoadedDoc | null;
  /** The candidate referrers, absolute POSIX paths in the phase's locations. */
  documents: Iterable<string> | AsyncIterable<string>;
  /** Read and parse one candidate. */
  load: (abs: string) => Promise<LoadedDoc>;
}

/**
 * The planning half of a rename: for every candidate document, the rewritten references and, for a
 * component, the renamed tag, as the bytes that would be written. Nothing is written. Pure but for
 * `load`, so a caller decides where the documents come from and what to do with the plan.
 */
export async function planRename(opts: PlanRenameOptions): Promise<RenamePlan> {
  const root = fwd(opts.root);
  const absFrom = fwd(opts.absFrom);
  const absTo = fwd(opts.absTo);
  const plan: RenamePlan = { errors: [], rewrites: [], tagRename: null };

  // For a component file rename, derive the new tag from the new filename (Pillar C).
  const oldTag = isJsonObject(opts.renamed?.doc) ? opts.renamed.doc.tagName : undefined;
  const newTag = deriveTag(absTo);
  if (isString(oldTag) && oldTag.includes("-") && newTag !== oldTag) {
    if (newTag.includes("-")) {
      plan.tagRename = { from: oldTag, to: newTag };
    } else {
      plan.tagSkipped = `Tag "${oldTag}" left unchanged: "${newTag}" is not a valid custom-element name`;
    }
  }
  const { tagRename } = plan;

  for await (const candidate of opts.documents) {
    const fp = fwd(candidate);
    try {
      const { doc, rewrite, serialize } = await opts.load(fp);
      let docOldDir: string;
      let docNewDir: string;
      if (opts.phase === "after") {
        docNewDir = dirname(fp);
        docOldDir = isUnder(fp, absTo) ? dirname(absFrom + fp.slice(absTo.length)) : docNewDir;
      } else {
        docOldDir = dirname(fp);
        docNewDir = isUnder(fp, absFrom) ? dirname(absTo + fp.slice(absFrom.length)) : docOldDir;
      }
      const { changes } = rewriteDocRefs(doc, {
        docNewDir,
        docOldDir,
        mounts: opts.mounts,
        newAbs: absTo,
        oldAbs: absFrom,
        root,
      });
      const tagCount = tagRename ? rewriteTagName(doc, tagRename.from, tagRename.to).count : 0;
      if (changes.length === 0 && tagCount === 0) {
        continue;
      }
      /*
       * Two ways to write a document back, and the narrower one is not a fallback for a broken
       * format — it is the only honest promise a load-only format can make. A CSV collection has a
       * parser and deliberately no serializer, so a reference living in one used to be COUNTED and
       * then reported as a remainder the author had to repair by hand (issue 246). `rewrite`
       * replaces the authored values in the file's own bytes and changes nothing else, which is all
       * a rename ever needed.
       *
       * `serialize` still wins where it exists: a full round trip can express a change a list of
       * value edits cannot. A TAG rename is exactly such a change, so a document carrying one and
       * no serializer is still named in the report rather than half-written.
       */
      const contents =
        serialize === null
          ? tagCount === 0 && rewrite !== null
            ? await rewrite(changes)
            : null
          : await serialize(doc);
      plan.rewrites.push({ abs: fp, changes, contents, tagCount });
    } catch (error) {
      plan.errors.push({ abs: fp, error: errorMessage(error) });
    }
  }
  return plan;
}

/** The refactor pass itself: see {@link applyRename}. */
async function rewriteReferences(opts: ApplyRenameOptions): Promise<RenameReport> {
  const root = fwd(opts.root);
  const absFrom = fwd(opts.absFrom);
  const absTo = fwd(opts.absTo);
  const mounts = opts.mounts ?? (await refactorMounts(opts.root));
  const rel = (abs: string): string => fwd(relative(root, abs));

  let isDir = false;
  try {
    const stats = await stat(absTo);
    isDir = stats.isDirectory();
  } catch {
    isDir = false;
  }

  const report: RenameReport = {
    errors: [],
    from: fwd(relative(opts.root, opts.absFrom)),
    isDir,
    ok: true,
    references: { files: [], filesChanged: 0, refsUpdated: 0 },
    to: fwd(relative(opts.root, opts.absTo)),
  };

  let renamed: LoadedDoc | null = null;
  if (!isDir) {
    try {
      renamed = await loadDoc(absTo, opts.registry);
    } catch {
      // Not a parseable component — skip tag derivation.
    }
  }

  async function* documents(): AsyncGenerator<string> {
    for await (const match of scanFiles(documentGlob(opts.registry), opts.root)) {
      if (!skipScanPath(match)) {
        yield fwd(resolve(opts.root, match));
      }
    }
  }

  const plan = await planRename({
    absFrom,
    absTo,
    documents: documents(),
    load: (fp) => loadDoc(fp, opts.registry),
    mounts,
    phase: "after",
    renamed,
    root,
  });
  if (plan.tagSkipped !== undefined) {
    report.tagSkipped = plan.tagSkipped;
  }

  let tagFilesChanged = 0;
  let tagRefsUpdated = 0;
  const errors = new Map(plan.errors.map((entry) => [entry.abs, entry.error]));
  for (const planned of plan.rewrites) {
    const path = rel(planned.abs);
    if (planned.contents === null) {
      report.errors.push({ error: `No serializer for "${path}"`, path });
      continue;
    }
    try {
      await writeFile(planned.abs, planned.contents);
    } catch (error) {
      errors.set(planned.abs, errorMessage(error));
      continue;
    }
    if (planned.changes.length > 0) {
      report.references.files.push({
        changes: planned.changes,
        count: planned.changes.length,
        path,
      });
      report.references.filesChanged += 1;
      report.references.refsUpdated += planned.changes.length;
    }
    if (planned.tagCount > 0) {
      tagFilesChanged += 1;
      tagRefsUpdated += planned.tagCount;
    }
  }
  for (const [abs, error] of errors) {
    report.errors.push({ error, path: rel(abs) });
  }

  if (plan.tagRename) {
    report.tag = {
      filesChanged: tagFilesChanged,
      from: plan.tagRename.from,
      refsUpdated: tagRefsUpdated,
      to: plan.tagRename.to,
    };
  }
  return report;
}
