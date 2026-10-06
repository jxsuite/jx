/**
 * Content links — relative links between the entries of one collection, rewritten to routes.
 *
 * An author writes `[Swap](../Linux/Swap%20Configuration.md)` because that link works in Obsidian,
 * in VS Code and on GitHub. On the published site the same link has to go to the page that document
 * became, and that URL is not the file path: it is whatever the content type's `route` template
 * says (`content-routes.ts`). This module is the join between the two, run once over each entry's
 * rendered tree after the whole collection has loaded, because a link can only be resolved once
 * every other entry is known.
 *
 * **What it touches, and what it never does.** Only a relative reference that resolves to a file of
 * the collection is rewritten: an entry to its route, and any other file (a PDF, an image, a
 * download) to the URL the collection's asset mount publishes it at, the same remap an image's
 * `src` gets. A scheme (`https:`, `mailto:`, `tel:`), an absolute path and a same-page `#anchor`
 * that already is a heading id are left exactly as authored. The resolution is a walk over path
 * SEGMENTS against the entry's own directory and it stops at the source root: a `..` that would
 * climb out of it never produces a path, so a link cannot be made to name a file outside the
 * collection.
 *
 * **A link to nothing becomes text.** An entry that is excluded, filtered out, unrouted or simply
 * absent has no page, and neither has a folder with no README or index, or an excluded attachment;
 * a published `<a>` to any of them is a 404 waiting for a reader. The anchor is replaced by its own
 * content and the problem is reported with the source file and the target, at the severity the
 * content type's `links` option asks for.
 *
 * Pure: no `node:` imports. The loader supplies the file facts through {@link LinkIndex}.
 *
 * @module @jxsuite/parser/content-links
 * @license MIT
 * @docs framework/site/content-collections
 */

import type { JxElement } from "@jxsuite/schema/types";
import { routeHref } from "./content-routes.ts";
import type { ContentNodes } from "./inert.ts";
import { slugifyHeading } from "./transpile.ts";

/** What the loader knows about one source file of the collection. */
export type FileOutcome =
  /** Published at this route. */
  | { route: string }
  /** Loaded but not published, and why. */
  | { unpublished: string };

/** How the resolver asks the loader about files. */
export interface LinkIndex {
  /** Every file the collection loaded, keyed by path relative to the source root. */
  files: ReadonlyMap<string, FileOutcome>;
  /** Directory (relative path, `""` for the root) → the file that is its index. */
  indexes: ReadonlyMap<string, string>;
  /** Extensions that make a path an ENTRY link rather than an asset link (`.md`). */
  entryExtensions: ReadonlySet<string>;
  /** The `exclude` pattern that hides this path, if one does. */
  excludedBy: (path: string) => string | undefined;
  /** Whether a path exists on disk, so "excluded" and "missing" can be told apart. */
  exists: (path: string) => boolean;
  /** Whether a path is a directory on disk. */
  isDirectory?: (path: string) => boolean;
  /** Whether an `exclude` pattern hides every file below a directory. */
  excludesDir?: (path: string) => boolean;
  /**
   * What the collection's asset mount does with an existing file that is not an entry: the URL it
   * is published at, or why it is not. `undefined` when there is nothing to say (no such file, a
   * directory, or no mount), which leaves the link as authored.
   */
  asset?: (path: string) => { url: string } | { unpublished: string } | undefined;
  /** `build.trailingSlash`. */
  trailingSlash: string;
  /** A locale URL prefix (`/fr`), or `""`. */
  localePrefix: string;
}

/** One link that could not be resolved to a page. */
export interface LinkProblem {
  /** The href as authored. */
  href: string;
  /** Why it has no page: "is not published (…)", "does not exist", … */
  reason: string;
}

/** The outcome for one href. */
type Resolution = { keep: true } | { href: string } | { problem: string };

/** A scheme, so `https:`, `mailto:`, `tel:`, `data:` and friends are never ours. */
const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/**
 * A `#fragment` in the form the rendered heading ids use.
 *
 * Obsidian writes `Note.md#Heading%20Text` and GitHub writes `#heading-text`; the page carries
 * `id="heading-text"`. Both end up at the same slug, through the same function that built the ids
 * (`slugifyHeading`), so the link lands wherever the heading did however it was typed. The function
 * is idempotent on text that is already a slug, so a GitHub-spelled fragment (`#foo---bar` for `##
 * Foo - Bar`, whose id collapses the run to `foo-bar`) is not special-cased and cannot drift.
 */
function fragmentFor(raw: string): string {
  try {
    // A fragment with no letter or digit has no heading to name; it stays as written.
    return slugifyHeading(decodeURIComponent(raw)) || raw;
  } catch {
    return raw;
  }
}

/** Split `path?query#fragment` into its three parts (query and fragment keep their delimiter). */
function splitHref(href: string): { path: string; query: string; hash: string } {
  const hashAt = href.indexOf("#");
  const beforeHash = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : href.slice(hashAt);
  const queryAt = beforeHash.indexOf("?");
  return {
    hash,
    path: queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt),
    query: queryAt === -1 ? "" : beforeHash.slice(queryAt),
  };
}

/**
 * The source-root-relative path a relative href names, or `null` when it climbs out of the root.
 *
 * Decodes each segment on its own, so `%2F` stays a character of one name instead of becoming a
 * separator, then walks `.` and `..` against the entry's directory. `undefined` means the href is
 * not a path this module understands (a malformed escape, a decoded separator): leave it alone.
 */
function resolvePath(from: string, path: string): string | null | undefined {
  const segments = path.split("/");
  const stack = from.split("/").slice(0, -1);
  for (const raw of segments) {
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return undefined;
    }
    if (segment.includes("/") || segment.includes("\\")) {
      return undefined;
    }
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (stack.length === 0) {
        return null;
      }
      stack.pop();
    } else {
      stack.push(segment);
    }
  }
  return stack.join("/");
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

/** A path in the form two spellings of one name agree on: composed Unicode, lower case. */
const fold = (path: string): string => path.normalize("NFC").toLowerCase();

/** Folded path → the real paths it could mean, built once per index. */
const FOLDED = new WeakMap<LinkIndex, Map<string, string[]>>();

/**
 * A file of the collection by exact path, then by a match that ignores case and Unicode
 * normalisation form and is unambiguous. The second half is what makes a link typed on one system
 * (a decomposed `é`, written by a macOS sync) find the file stored on another.
 */
function findFile(index: LinkIndex, path: string): string | undefined {
  if (index.files.has(path)) {
    return path;
  }
  let folded = FOLDED.get(index);
  if (!folded) {
    folded = new Map();
    for (const key of index.files.keys()) {
      const name = fold(key);
      folded.set(name, [...(folded.get(name) ?? []), key]);
    }
    FOLDED.set(index, folded);
  }
  const hits = folded.get(fold(path));
  return hits?.length === 1 ? hits[0] : undefined;
}

/** The index file of a directory, matching the directory name by Unicode form as well. */
function findIndex(index: LinkIndex, dir: string): string | undefined {
  const exact = index.indexes.get(dir);
  if (exact !== undefined) {
    return exact;
  }
  const wanted = dir.normalize("NFC");
  for (const [name, file] of index.indexes) {
    if (name.normalize("NFC") === wanted) {
      return file;
    }
  }
  return undefined;
}

/** Why a path with an entry extension has no page: excluded, or simply not there. */
function whyMissing(index: LinkIndex, path: string): string {
  const pattern = index.excludedBy(path);
  if (pattern !== undefined && index.exists(path)) {
    return `is not published (excluded by "${pattern}")`;
  }
  return "does not exist";
}

/**
 * A relative link to something that is not an entry: an attachment, or a folder.
 *
 * An attachment that exists is published by the collection's asset mount at its own URL, so the
 * link follows it there (a relative `files/report.pdf` on a page at `/kb/a/note/` would otherwise
 * be `/kb/a/note/files/report.pdf`, which nothing serves). One the type does not publish, or a
 * folder with no README or index, has no page, which makes it a broken link like any other.
 * Anything else, a path that exists nowhere, is not this module's to judge and stays as authored.
 */
function resolveNonEntry(
  target: string,
  query: string,
  hash: string,
  index: LinkIndex,
): Resolution {
  const asset = index.asset?.(target);
  if (asset !== undefined) {
    return "url" in asset
      ? { href: `${asset.url}${query}${hash}` }
      : { problem: `is not published (${asset.unpublished})` };
  }
  if (index.isDirectory?.(target) === true) {
    return index.excludesDir?.(target) === true
      ? { problem: "is not published (its folder is excluded)" }
      : { problem: "is a folder with no README.md or index.md" };
  }
  return { keep: true };
}

/** Resolve one href found in the entry at `from`. */
function resolveHref(href: string, from: string, index: LinkIndex): Resolution {
  if (href === "" || href.startsWith("/") || SCHEME.test(href) || href.includes("${")) {
    return { keep: true };
  }
  const { path, query, hash } = splitHref(href);
  if (path === "") {
    // A same-page anchor: only the fragment can need work.
    const fixed = hash.length > 1 ? `#${fragmentFor(hash.slice(1))}` : hash;
    return fixed === hash ? { keep: true } : { href: fixed };
  }

  const target = resolvePath(from, path);
  if (target === undefined) {
    return { keep: true };
  }
  const entryLink = index.entryExtensions.has(extensionOf(path));
  if (target === null) {
    return entryLink
      ? { problem: "points outside the collection's source directory" }
      : { keep: true };
  }

  let file = findFile(index, target);
  if (file === undefined && (path.endsWith("/") || extensionOf(path) === "")) {
    /* A directory link (`../Frappe/`, `../Frappe`) names that directory's index entry, and an
       extension-less one may name a file whose extension the author left off. */
    file = findIndex(index, target);
    for (const ext of path.endsWith("/") ? [] : index.entryExtensions) {
      file ??= findFile(index, `${target}${ext}`);
    }
  }
  if (file === undefined) {
    return entryLink
      ? { problem: whyMissing(index, target) }
      : resolveNonEntry(target, query, hash, index);
  }

  const outcome = index.files.get(file)!;
  if ("unpublished" in outcome) {
    return { problem: `is not published (${outcome.unpublished})` };
  }
  const fragment = hash.length > 1 ? `#${fragmentFor(hash.slice(1))}` : hash;
  return {
    href: `${routeHref(outcome.route, index.trailingSlash, index.localePrefix)}${query}${fragment}`,
  };
}

/** What a removed anchor leaves behind: its own content, as inline nodes. */
function contentOf(anchor: JxElement): ContentNodes {
  if (Array.isArray(anchor.children)) {
    return anchor.children as ContentNodes;
  }
  if (typeof anchor.innerHTML === "string") {
    // Text that holds `${` was made inert as escaped `innerHTML` (inert.ts); it keeps that form.
    return [{ innerHTML: anchor.innerHTML, tagName: "span" }];
  }
  return typeof anchor.textContent === "string" ? [anchor.textContent] : [];
}

/**
 * Rewrite the relative links in an entry's rendered tree, in place.
 *
 * @param {ContentNodes} nodes - The entry's `$children`
 * @param {string} from - The entry's source file, relative to the source root, `/`-separated
 * @param {LinkIndex} index - What the collection knows about its files
 * @param {(problem: LinkProblem) => void} report - Called once per link that has no page
 */
export function rewriteLinks(
  nodes: ContentNodes,
  from: string,
  index: LinkIndex,
  report: (problem: LinkProblem) => void,
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (Array.isArray(node)) {
      // A raw HTML block arrives as a nested list of nodes.
      rewriteLinks(node, from, index, report);
      continue;
    }
    if (typeof node !== "object" || node === null) {
      continue;
    }
    const href = node.tagName === "a" ? node.attributes?.href : undefined;
    if (typeof href === "string") {
      const resolution = resolveHref(href, from, index);
      if ("problem" in resolution) {
        report({ href, reason: resolution.problem });
        const replacement = contentOf(node);
        rewriteLinks(replacement, from, index, report);
        nodes.splice(i, 1, ...replacement);
        i += replacement.length - 1;
        continue;
      }
      if ("href" in resolution) {
        node.attributes = { ...node.attributes, href: resolution.href };
      }
    }
    if (Array.isArray(node.children)) {
      rewriteLinks(node.children as ContentNodes, from, index, report);
    }
  }
}
