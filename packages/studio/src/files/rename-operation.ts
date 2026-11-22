/**
 * Rename-operation.ts — a rename as one operation the host completes or rolls back
 * (`project-state.md` §9, `studio.md` §9.1.1).
 *
 * While the platform's host serves the project state subscription and offers `renameProjectState`,
 * Studio's rename sends a `RenameOperation` instead of `renameFile`: the host plans the move and
 * every reference rewrite, applies them from an outbox, and answers either what it did or why it
 * did nothing. A failure part-way leaves every file as it was, where `renameFile` moved the file
 * first and then rewrote each referrer as a separate write.
 *
 * **A referrer with unsaved edits keeps them.** The operation names every open tab with unsaved
 * edits and its buffer revision, with the policy `rewrite-buffer`: the host leaves those files on
 * disk untouched and answers the rewrite it made to the disk copy instead, which Studio applies to
 * the tab's document as one undoable edit. The tab stays dirty, now naming the new path, for the
 * author to save. A co-edited tab is named too, and its rewrite is an edit through its room, which
 * every participant sees. The rewrite maps reference values to their replacements, so it applies to
 * whatever the buffer holds when the answer arrives, including edits made while it was in flight; a
 * rewrite that finds nothing to change, or no tab to change, is named in the report's `errors`,
 * since the file on disk was left naming the old path.
 *
 * Without a served subscription, or on a platform without the member, the rename goes through
 * `renameFile` exactly as it did ({@link renamesThroughHost}).
 *
 * @license MIT
 * @docs studio/projects/pages-layouts-components
 */

import { isJsonObject, isString } from "@jxsuite/schema/guards";
import type { JsonValue, JxMutableNode } from "@jxsuite/schema/types";
import { CSS_URL_PATTERN } from "@jxsuite/protocol/project-state";
import type {
  BufferRewrite,
  RenameOperationResult,
  RenameRefused,
} from "@jxsuite/protocol/project-state";
import { getPlatform } from "../platform";
import type { ContentSectionEntry, RenameResult, StudioPlatform } from "../types";
import type { Tab } from "../tabs/tab";
import { mutateUpdateFrontmatter, mutateUpdateProperty, transactDoc } from "../tabs/transact";
import type { JxNodeValue } from "../tabs/transact";
import type { JxPath } from "../state";
import { workspace } from "../workspace/workspace";
import { contentStore } from "../project-state/store";
import { projectStateServed, whenProjectStateSettled } from "../project-state/subscription";
import { projectState } from "../store";
import { projectLocales } from "../canvas/asset-refs";
import { contentMountFor } from "../canvas/asset-resolve";
import { formatForPath, formatParse, formatSerialize, loadFormats } from "../format/format-host";
// The bound a save waits for the host's first answer is the bound a rename waits too.
import { SETTLE_TIMEOUT_MS } from "./based-writes";
import { loadWithFormats, planClientRewrites } from "./client-rewrites";
import type { ClientRewriteDeps, ClientRewritePlan } from "./client-rewrites";

/** Keys whose strings are prose: a rename never rewrites them (the refactor walker's rule). */
const PROSE_KEYS = new Set(["textContent", "innerHTML"]);

/**
 * A rename the host refused or rolled back. Nothing on disk changed, unless the refusal names
 * `unrestored` paths: the steps whose undo failed, left as they were made.
 */
export class RenameRefusedError extends Error {
  readonly refusal: RenameRefused;

  constructor(refusal: RenameRefused) {
    super(refusal.message);
    this.name = "RenameRefusedError";
    this.refusal = refusal;
  }
}

/**
 * Whether a rename goes through the host as one operation: it serves the subscription and the
 * member.
 */
export async function renamesThroughHost(
  platform: Pick<StudioPlatform, "renameProjectState"> = getPlatform(),
): Promise<boolean> {
  if (platform.renameProjectState === undefined) {
    return false;
  }
  await whenProjectStateSettled(SETTLE_TIMEOUT_MS);
  return projectStateServed();
}

/**
 * Every open tab whose buffer holds edits its file does not. A co-edited tab's dirty mark is its
 * room's, so a room with unsaved edits is named through it, and the rewrite reaches the room.
 */
function dirtyTabs(): Tab[] {
  return [...workspace.tabs.values()].filter((tab) => tab.documentPath !== null && tab.doc.dirty);
}

/** `value` with each `url(...)` the rename changed rewritten, or `undefined` when none was. */
function rewrittenUrls(value: string, changes: ReadonlyMap<string, string>): string | undefined {
  const out = value.replaceAll(CSS_URL_PATTERN, (match, quote: string, inner: string) => {
    const next = changes.get(inner.trim());
    return next === undefined ? match : `url(${quote}${next}${quote})`;
  });
  return out === value ? undefined : out;
}

/**
 * `value` with the rewrite applied, or `undefined` when it names nothing the rename changed: each
 * string equal to a rewritten reference becomes its replacement, as does each `url(...)` inside a
 * string and each key of a nested map (the configuration's `copy` names its files in its keys), and
 * each `tagName` equal to the renamed tag becomes the new tag. Prose keys are left alone, as the
 * host's walker leaves them.
 */
function rewritten(
  value: JsonValue,
  changes: ReadonlyMap<string, string>,
  tag: BufferRewrite["tag"],
  key: string | null = null,
): JsonValue | undefined {
  if (isString(value)) {
    if (key === "tagName" && tag !== undefined && value === tag.from) {
      return tag.to;
    }
    return changes.get(value) ?? rewrittenUrls(value, changes);
  }
  if (Array.isArray(value)) {
    const next = value.map((item) => rewritten(item, changes, tag));
    return next.some((item) => item !== undefined)
      ? next.map((item, at) => item ?? value[at]!)
      : undefined;
  }
  if (isJsonObject(value)) {
    let changed = false;
    const out: Record<string, JsonValue> = {};
    for (const [member, item] of Object.entries(value)) {
      const next = PROSE_KEYS.has(member) ? undefined : rewritten(item, changes, tag, member);
      const name = changes.get(member) ?? member;
      changed ||= next !== undefined || name !== member;
      out[name] = next ?? item;
    }
    return changed ? out : undefined;
  }
  return undefined;
}

/** One member of one node the rewrite replaces. */
interface NodeEdit {
  path: JxPath;
  key: string;
  value: JsonValue;
}

/** Collect the edits to the node at `path`, and to every node beneath it. */
function nodeEdits(
  node: JxMutableNode,
  path: JxPath,
  changes: ReadonlyMap<string, string>,
  tag: BufferRewrite["tag"],
  out: NodeEdit[],
): NodeEdit[] {
  const { children } = node;
  const nodes = Array.isArray(children);
  if (nodes) {
    for (const [at, child] of children.entries()) {
      if (!isString(child)) {
        nodeEdits(child, [...path, "children", at], changes, tag, out);
      }
    }
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "children" && nodes) {
      continue;
    }
    // SAFETY: a document node's members are JSON (an event binding is a JSON object too).
    const next = PROSE_KEYS.has(key) ? undefined : rewritten(value as JsonValue, changes, tag, key);
    if (next !== undefined) {
      out.push({ key, path, value: next });
    }
  }
  return out;
}

/**
 * Apply the host's rewrite of a dirty referrer's disk copy to `tab`'s document (§9.2): one undoable
 * edit, after which the tab is still dirty and names the new path. Answers whether it changed
 * anything; a rewrite that names nothing in the buffer makes no edit and leaves no undo step.
 */
export function applyBufferRewrite(tab: Tab, rewrite: BufferRewrite): boolean {
  const changes = new Map(rewrite.changes.map((change) => [change.from, change.to]));
  const edits = nodeEdits(tab.doc.document, [], changes, rewrite.tag, []);
  const fields: [string, JsonValue][] = [];
  for (const [field, value] of Object.entries(tab.doc.content.frontmatter)) {
    // SAFETY: frontmatter values are JSON, read here to find the strings the rename changed.
    const next =
      value === undefined ? undefined : rewritten(value as JsonValue, changes, rewrite.tag, field);
    if (next !== undefined) {
      fields.push([field, next]);
    }
  }
  if (edits.length === 0 && fields.length === 0) {
    return false;
  }
  transactDoc(tab, (target) => {
    for (const edit of edits) {
      // SAFETY: the rewrite of a node member keeps its shape and replaces only strings.
      mutateUpdateProperty(target, edit.path, edit.key, edit.value as JxNodeValue);
    }
    for (const [field, value] of fields) {
      mutateUpdateFrontmatter(target, field, value);
    }
  });
  return true;
}

/** Where `path` is once `from` has moved to `to`. */
function moved(path: string, from: string, to: string): string {
  return path === from || path.startsWith(`${from}/`) ? to + path.slice(from.length) : path;
}

/**
 * What {@link planClientRewrites} reads through in the open project: the window's store, the
 * platform's reads, the formats Studio has loaded, and the content mounts of the project's
 * configuration.
 */
export function studioRewriteDeps(): ClientRewriteDeps {
  const formats = loadWithFormats({ formatForPath, formatParse, formatSerialize, loadFormats });
  return {
    load: formats,
    mounts(path) {
      /* SAFETY: `content` is the parser extension's opaque project section, a map of section
         entries; contentMountFor reads only each entry's optional `source`. */
      const content = projectState?.projectConfig?.content as
        | Record<string, ContentSectionEntry>
        | undefined;
      const mount = contentMountFor(path, content, projectLocales());
      return mount === null ? [] : [mount];
    },
    read: (path) => getPlatform().readFile(path),
    store: contentStore,
  };
}

/**
 * Rename `from` to `to` through the host as one operation (§9), applying the host's rewrites to
 * every dirty referrer's buffer, and answer the report `renameFile` would have. Throws
 * {@link RenameRefusedError} when the host refused or rolled back: nothing changed on disk.
 *
 * When the store holds documents the host could not index (a partial graph, `project-state.md`
 * §8.2), the operation carries Studio's own rewrites of them (§9.1), and a dirty one among them is
 * rewritten in its buffer from the changes Studio computed, since the host leaves it alone.
 */
export async function renameThroughHost(
  from: string,
  to: string,
  deps: ClientRewriteDeps = studioRewriteDeps(),
): Promise<RenameResult> {
  // SAFETY: every caller is behind `renamesThroughHost`, which requires the member.
  const rename = getPlatform().renameProjectState!;
  const dirty = dirtyTabs();
  const opId = `studio-${crypto.randomUUID()}`;
  const client: ClientRewritePlan | null = await planClientRewrites(from, to, deps);
  // Every step's write id is `<opId>:<n>`, so its events are this window's own
  // (project-state.md §2.4, project-state.md §9.1).
  contentStore.noteOperationId(opId);
  const result: RenameOperationResult = await rename({
    dirtyReferrers: dirty.map((tab) => ({
      bufferRev: tab.doc.buffer.bufferRev,
      path: tab.documentPath!,
    })),
    from,
    opId,
    policy: "rewrite-buffer",
    ...(client !== null && {
      rewrites: client.rewrites.map(({ baseHash, contents, path }) => ({
        baseHash,
        contents,
        path,
      })),
    }),
    to,
  });
  if (!result.ok) {
    throw new RenameRefusedError(result);
  }
  const errors = [...result.errors, ...(client?.errors ?? [])];
  const computed = new Map(client?.rewrites.map((rewrite) => [rewrite.path, rewrite]));
  for (const answered of result.buffers) {
    let rewrite: BufferRewrite = answered;
    if (rewrite.changes.length === 0 && rewrite.tag === undefined) {
      const own = computed.get(rewrite.path);
      if (own === undefined) {
        // Nothing for Studio to apply: the host had no change to make to this buffer.
        continue;
      }
      // Studio's own rewrite of a dirty document the host could not read (§9.2).
      rewrite = { ...rewrite, changes: own.changes, ...(own.tag && { tag: own.tag }) };
    }
    /* By path, whatever revision the buffer is at now: the rewrite maps reference values, so it
       applies as well to edits the author made while the rename was in flight. */
    const tab = [...workspace.tabs.values()].find((open) => open.documentPath === rewrite.path);
    if (tab === undefined || !applyBufferRewrite(tab, rewrite)) {
      errors.push({
        error:
          tab === undefined
            ? "Its tab closed before its unsaved edits could be rewritten; its file still names the old path."
            : "Its unsaved edits no longer name what the rename changed; its file still names the old path.",
        path: moved(rewrite.path, from, to),
      });
    }
  }
  const report: RenameResult = {
    errors,
    from: result.from,
    isDir: result.isDir,
    ok: true,
    references: result.references,
    to: result.to,
  };
  if (result.tag !== undefined) {
    report.tag = result.tag;
  }
  if (result.tagSkipped !== undefined) {
    report.tagSkipped = result.tagSkipped;
  }
  return report;
}
