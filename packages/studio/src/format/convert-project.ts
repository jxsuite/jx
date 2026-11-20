/**
 * Convert-project — moving every native document of a project between JSON and Jx Notation.
 *
 * It is {@link convertFile} run over a project, and it adds only what a project needs that a file
 * does not: finding the documents, judging them all BEFORE any is touched, refusing as a whole when
 * a tab holds unsaved work, saying so when another branch still edits the files about to move, and
 * running the moves one after another so each one's reference repair sees the last one's result.
 *
 * **A plan is the whole truth before the first write.** Every file's bytes are produced and
 * schema-checked up front; a file that cannot be converted is listed as skipped, with the reason,
 * and the rest still go. Nothing is half-decided at the moment the dialog opens.
 *
 * **It is not atomic, and does not pretend to be.** A failure part-way leaves the files before it
 * converted and the files after it alone, every reference repaired as far as it went. Both
 * notations are read everywhere, so a half-converted project is a working one; running the
 * conversion again finishes it.
 *
 * Nothing here reaches the DOM at import time (see `convert-file.ts`), so every module that does is
 * loaded through `await import()`.
 *
 * @docs studio/projects/settings
 */

import { isString } from "@jxsuite/schema/guards";
import type { NativeExt } from "./default-format";
import { applyConversion, buildPlan } from "./convert-file";
import type { ConversionPlan } from "./convert-file";
import { convertTargets } from "./format-choices";

/** The folders whose native files are Jx documents. Everything else in a project is data. */
export const DOCUMENT_FOLDERS = ["pages", "layouts", "components"] as const;

/** Names that are documents' neighbours, not documents: class definitions and schemas. */
const NOT_DOCUMENTS = /\.(class|schema)\.json$/u;

/** One file the conversion will write. */
export interface ProjectConversionFile {
  path: string;
  plan: ConversionPlan;
  /** The text as read, restored if the move fails. */
  original: string;
}

/** A file the conversion leaves alone, and why. */
export interface ProjectConversionSkip {
  path: string;
  reason: string;
}

/** What another branch has that this one lacks. */
export interface BranchCheck {
  /**
   * - `none`: no other branch holds unmerged commits, or there is no repository.
   * - `some`: the named branches do.
   * - `unknown`: there are other branches and the host cannot say whether they are merged.
   */
  kind: "none" | "some" | "unknown";
  branches: string[];
  current: string;
}

/** Everything the reader is told before confirming. */
export interface ProjectConversionPlan {
  target: NativeExt;
  files: ProjectConversionFile[];
  skipped: ProjectConversionSkip[];
  /** Documents already in the target notation. */
  alreadyTarget: number;
  /** Open tabs with unsaved changes among the files to convert. A non-empty list blocks the run. */
  dirty: string[];
  branches: BranchCheck;
}

/** How a project's native documents divide between the two notations. */
export interface FormatCensus {
  json: number;
  jxn: number;
}

/** The lowercase extension of a path including its dot, or `""`. */
function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot > 0 ? path.slice(dot).toLowerCase() : "";
}

/** Whether a path is a native document, by name alone. */
function isNativeName(path: string): boolean {
  const ext = extensionOf(path);
  return (ext === ".json" || ext === ".jxn") && !NOT_DOCUMENTS.test(path);
}

/** Every native file under the document folders, project-relative. A missing folder is empty. */
export async function scanNativeDocuments(): Promise<string[]> {
  const { getPlatform } = await import("../platform");
  const platform = getPlatform();
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await platform.listDirectory(dir);
    } catch {
      return;
    }
    const subdirectories: string[] = [];
    for (const entry of entries) {
      if (entry.type === "directory") {
        if (entry.name !== "node_modules" && !entry.name.startsWith(".")) {
          subdirectories.push(entry.path);
        }
      } else if (isNativeName(entry.name)) {
        found.push(entry.path.replaceAll("\\", "/").replace(/^\.\//u, ""));
      }
    }
    await Promise.all(subdirectories.map((sub) => walk(sub)));
  };
  await Promise.all(DOCUMENT_FOLDERS.map((folder) => walk(folder)));
  return found.toSorted();
}

/**
 * Count the project's documents by notation, over the files a conversion would consider.
 *
 * Needs the formats loaded, because whether a path is convertible at all is `convertTargets`' rule.
 */
export async function censusOf(paths: readonly string[]): Promise<FormatCensus> {
  const { loadFormats } = await import("./format-host");
  await loadFormats();
  const census: FormatCensus = { json: 0, jxn: 0 };
  for (const path of paths) {
    if (convertTargets(path).length === 0) {
      continue;
    }
    if (extensionOf(path) === ".json") {
      census.json += 1;
    } else {
      census.jxn += 1;
    }
  }
  return census;
}

/**
 * Whether other branches hold work this one lacks.
 *
 * A host that lists branches but cannot say which are merged answers `unknown` when there are
 * others, which is a warning too: silence there would read as "safe" when nobody checked. No
 * repository, or no other branch, is `none`. A host that cannot list branches at all is `none` as
 * well, since a project outside version control has nothing to conflict with.
 */
export async function checkBranches(): Promise<BranchCheck> {
  const { getPlatform } = await import("../platform");
  try {
    const listed = await getPlatform().gitBranches();
    const { current } = listed;
    if (listed.unmerged !== undefined) {
      const branches = listed.unmerged.filter((name) => name !== current);
      return { branches, current, kind: branches.length > 0 ? "some" : "none" };
    }
    const others = listed.branches.filter(
      (name) => name !== current && !name.endsWith("/HEAD") && name !== `origin/${current}`,
    );
    return { branches: others, current, kind: others.length > 0 ? "unknown" : "none" };
  } catch {
    return { branches: [], current: "", kind: "none" };
  }
}

/** Run `work` over `items` a few at a time, keeping the results in order. */
async function inBatches<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let at = 0; at < items.length; at += size) {
    out.push(...(await Promise.all(items.slice(at, at + size).map((item) => work(item)))));
  }
  return out;
}

/**
 * Judge the whole project against a target notation, writing nothing.
 *
 * @param target - The notation to convert to.
 * @param onProgress - Told how many files have been judged, for a project large enough to notice.
 */
export async function planProjectConversion(
  target: NativeExt,
  onProgress?: (done: number, total: number) => void,
): Promise<ProjectConversionPlan> {
  const { loadFormats } = await import("./format-host");
  await loadFormats();
  const { getPlatform } = await import("../platform");
  const platform = getPlatform();
  const paths = await scanNativeDocuments();
  const taken = new Set(paths.map((path) => path.toLowerCase()));
  const convertible = paths.filter((path) => convertTargets(path).length > 0);
  const alreadyTarget = convertible.filter((path) => extensionOf(path) === target).length;
  const todo = convertible.filter((path) => extensionOf(path) !== target);

  const { workspace } = await import("../workspace/workspace");
  const { commitTabBuffers } = await import("../services/monaco-buffer");
  const dirty: string[] = [];
  for (const tab of workspace.tabs.values()) {
    if (tab.documentPath !== null && todo.includes(tab.documentPath)) {
      await commitTabBuffers(tab);
      if (tab.doc.dirty) {
        dirty.push(tab.documentPath);
      }
    }
  }

  const files: ProjectConversionFile[] = [];
  const skipped: ProjectConversionSkip[] = [];
  let done = 0;
  await inBatches(todo, 8, async (path) => {
    const targetPath = `${path.slice(0, path.length - extensionOf(path).length)}${target}`;
    try {
      if (taken.has(targetPath.toLowerCase())) {
        skipped.push({ path, reason: `${targetPath} already exists.` });
        return;
      }
      const read = await platform.readFile(path);
      const original = isString(read) ? read : "";
      const plan = await buildPlan(path, original, target, { references: false });
      if (plan.blocker === null) {
        files.push({ original, path, plan });
      } else {
        skipped.push({ path, reason: plan.blocker });
      }
    } catch (error) {
      const { errorMessage } = await import("@jxsuite/schema/parse");
      skipped.push({ path, reason: errorMessage(error) });
    } finally {
      done += 1;
      onProgress?.(done, todo.length);
    }
  });

  return {
    alreadyTarget,
    branches: await checkBranches(),
    dirty: dirty.toSorted(),
    files: files.toSorted((a, b) => a.path.localeCompare(b.path)),
    skipped: skipped.toSorted((a, b) => a.path.localeCompare(b.path)),
    target,
  };
}

/** What a run did. */
export interface ProjectConversionResult {
  converted: number;
  failed: { path: string; message: string; detail: string }[];
  refsUpdated: number;
  filesChanged: number;
}

/**
 * Convert every file in a plan, one at a time.
 *
 * Sequential on purpose: each rename repairs references by re-reading the project, and two running
 * at once would repair against a project the other is half-way through moving.
 *
 * @param plan - From {@link planProjectConversion}. Refused outright when `dirty` is not empty.
 * @param onProgress - Told after each file.
 */
export async function runProjectConversion(
  plan: ProjectConversionPlan,
  onProgress?: (done: number, total: number, path: string) => void,
): Promise<ProjectConversionResult> {
  if (plan.dirty.length > 0) {
    throw new Error(`Unsaved changes in ${plan.dirty.join(", ")}.`);
  }
  const { workspace } = await import("../workspace/workspace");
  const result: ProjectConversionResult = {
    converted: 0,
    failed: [],
    filesChanged: 0,
    refsUpdated: 0,
  };
  let done = 0;
  for (const file of plan.files) {
    const tabOpen = [...workspace.tabs.values()].some((tab) => tab.documentPath === file.path);
    const applied = await applyConversion(file.path, file.plan, file.original, tabOpen);
    if (applied.ok) {
      result.converted += 1;
      result.refsUpdated += applied.report.references?.refsUpdated ?? 0;
      result.filesChanged += applied.report.references?.filesChanged ?? 0;
    } else {
      result.failed.push({ detail: applied.detail, message: applied.message, path: file.path });
    }
    done += 1;
    onProgress?.(done, plan.files.length, file.path);
  }
  return result;
}
