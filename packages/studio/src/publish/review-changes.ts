/**
 * What Review changes calls a change, in the words of the site rather than of git (studio.md
 * §22.8).
 *
 * Git reports files: `pages/pricing.md`, `??`. An author reviewing what is about to go live thinks
 * in pages, posts, components and images, so each changed file is stated as the thing it is on the
 * site: **Pricing**, a page at `/pricing`, new. The file stays one click away (the row's tooltip,
 * the Code view), because it is still what gets committed; it is just not the first thing said.
 *
 * Pure over the status and the project's configuration, so every rule is assertable without a
 * platform. The names come from the same helpers the Site panel names things with (`pageLabel`,
 * `humanize`), so a page is called the same thing in Design and in Publish.
 *
 * @docs studio/publish
 */

import { fileToRoute } from "@jxsuite/site/routes";
import { comparisonRefusal } from "../panels/git-diff-open";
import { humanize, pageLabel } from "../panels/site-model";
import { PAGES_COLLECTION, contentCollections } from "../content/content-collections";
import { changeGroupKey, isDiffableStatus } from "./source-control";
import { IMAGE_EXTENSIONS, extensionOf } from "../files/media-upload";
import type { ResolvedI18n } from "@jxsuite/schema/locale";
import type { GitFileStatus } from "../types";

/** What happened to a change, as its tag says it. */
export type ReviewTag = "new" | "edit" | "delete" | "rename";

/** One change, as Review changes lists and heads it. */
export interface ReviewItem {
  /** The project-relative file: the key, and what is committed. */
  path: string;
  /** Git's status letter, which says which sides a comparison of it has. */
  status: string;
  tag: ReviewTag;
  /** The tag's text: NEW, EDIT, DELETE, RENAME. */
  tagLabel: string;
  /** What the site calls it: "Pricing", "Designing for slowness", "Bl footer". */
  label: string;
  /** What kind of thing it is, with where it lives when that is a URL: "Page · /pricing". */
  kind: string;
  /** The page's URL pattern, or "" for a change with none. */
  url: string;
  /** One sentence saying what publishing it does. */
  summary: string;
  /** What it is, in the singular and lower case: "page", "post", "template", "image". */
  noun: string;
  /** The same in the plural: "pages", "posts" (a collection's own name), "images". */
  nounPlural: string;
  /** Whether it goes in the next publish. */
  included: boolean;
  /** Why it has no before-and-after comparison, or "" when it has one. */
  refusal: string;
}

const TAG_LABELS: ReadonlyMap<ReviewTag, string> = new Map([
  ["new", "NEW"],
  ["edit", "EDIT"],
  ["delete", "DELETE"],
  ["rename", "RENAME"],
]);

/** A git status letter as a review tag. Untracked is new: it is not on the site yet. */
export function reviewTag(status: string): ReviewTag {
  if (status === "A" || status === "U") {
    return "new";
  }
  if (status === "D") {
    return "delete";
  }
  return status === "R" ? "rename" : "edit";
}

/** The last path segment without its extension. */
function stemOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/** The file name, extension and all. */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** A thing's name and kind, before the tag decides the sentence. */
interface Subject {
  label: string;
  kind: string;
  url: string;
  /** The thing in the singular, lower case: "page", "post", "component". */
  noun: string;
  /** The thing in the plural, lower case: "pages", "posts", "components". */
  nounPlural: string;
  /**
   * What else publishing it changes, said after the first sentence, or "" when only itself. A
   * component or a template is drawn on other pages, so changing one changes them.
   */
  reach: string;
}

/** The subject of a page change: named and addressed by its route. */
function pageSubject(path: string, i18n: ResolvedI18n | null): Subject {
  const route = fileToRoute(path);
  return {
    kind: `Page · ${route.urlPattern}`,
    label: pageLabel(route, path, i18n),
    noun: "page",
    nounPlural: "pages",
    reach: "",
    url: route.urlPattern,
  };
}

/** The subject of a change, by what the file is to the site. */
function subjectOf(path: string, i18n: ResolvedI18n | null): Subject {
  const group = changeGroupKey(path);
  if (group === PAGES_COLLECTION) {
    return pageSubject(path, i18n);
  }
  const collection = contentCollections().find((entry) => entry.key === group);
  if (collection) {
    return {
      kind: `${humanize(collection.item)} · ${collection.title}`,
      label: humanize(stemOf(path)),
      noun: collection.item,
      // The collection is named in the plural already ("Posts"); its item is the singular.
      nounPlural: collection.title.toLowerCase(),
      reach: "",
      url: "",
    };
  }
  if (group === "folder:components") {
    return {
      kind: "Component",
      label: humanize(stemOf(path)),
      noun: "component",
      nounPlural: "components",
      reach: "Every page that uses it changes with it.",
      url: "",
    };
  }
  if (group === "folder:layouts") {
    return {
      kind: "Template",
      label: humanize(stemOf(path)),
      noun: "template",
      nounPlural: "templates",
      reach: "Every page drawn in it changes with it.",
      url: "",
    };
  }
  if (group === "folder:styles") {
    return {
      kind: "Styles",
      label: humanize(stemOf(path)),
      noun: "stylesheet",
      nounPlural: "stylesheets",
      reach: "Every page that loads it can change.",
      url: "",
    };
  }
  if (group === "media") {
    const image = IMAGE_EXTENSIONS.has(extensionOf(path));
    return {
      kind: "Media",
      label: baseName(path),
      noun: image ? "image" : "file",
      nounPlural: image ? "images" : "files",
      reach: "",
      url: "",
    };
  }
  return {
    kind: "Project file",
    label: baseName(path),
    noun: "file",
    nounPlural: "files",
    reach: "",
    url: "",
  };
}

/** The sentence a change's tag says about its subject. */
function firstSentence(tag: ReviewTag, subject: Subject): string {
  if (tag === "new") {
    return subject.url
      ? `A new ${subject.noun}. It goes live at ${subject.url}.`
      : `A new ${subject.noun}.`;
  }
  if (tag === "delete") {
    return `This ${subject.noun} is deleted.`;
  }
  if (tag === "rename") {
    return `This ${subject.noun} was renamed.`;
  }
  return `This ${subject.noun} changed.`;
}

/**
 * One changed file as Review changes states it.
 *
 * @param file The status row.
 * @param i18n The project's resolved `i18n`, which names a page in a locale folder.
 */
export function reviewItem(file: GitFileStatus, i18n: ResolvedI18n | null = null): ReviewItem {
  const tag = reviewTag(file.status);
  const subject = subjectOf(file.path, i18n);
  const reach = tag === "delete" || tag === "rename" ? "" : subject.reach;
  // The specific reason first (a rename, an image, a path outside the project), then the general.
  const refusal =
    comparisonRefusal(file.path, file.status) ??
    (isDiffableStatus(file.status) ? "" : `"${file.path}" has no change a comparison can show.`);
  return {
    included: Boolean(file.staged),
    kind: subject.kind,
    label: subject.label,
    noun: subject.noun,
    nounPlural: subject.nounPlural,
    path: file.path,
    refusal,
    status: file.status,
    summary: reach ? `${firstSentence(tag, subject)} ${reach}` : firstSentence(tag, subject),
    tag,
    tagLabel: TAG_LABELS.get(tag) ?? "EDIT",
    url: subject.url,
  };
}

/** Where each kind of change sorts: pages first, then entries, components, templates, the rest. */
function rankOf(path: string): number {
  const group = changeGroupKey(path);
  if (group === PAGES_COLLECTION) {
    return 0;
  }
  if (contentCollections().some((entry) => entry.key === group)) {
    return 1;
  }
  const order = ["folder:components", "folder:layouts", "folder:styles", "media"];
  const index = order.indexOf(group);
  return index === -1 ? order.length + 2 : index + 2;
}

/**
 * Every change, in the order a reviewer reads a site: pages, then entries, components, templates,
 * styles, media and the project's other files. Within a kind, git's order is kept.
 *
 * @param files The status rows.
 * @param i18n The project's resolved `i18n`.
 */
export function reviewItems(
  files: readonly GitFileStatus[],
  i18n: ResolvedI18n | null = null,
): ReviewItem[] {
  return files
    .map((file, index) => ({ index, item: reviewItem(file, i18n), rank: rankOf(file.path) }))
    .toSorted((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * The change Review changes shows: the one the author picked while it is still changed, else the
 * first. Null when there is nothing to review.
 *
 * @param items The changes, in list order.
 * @param picked The path the author last picked, or null.
 */
export function selectedReviewItem(
  items: readonly ReviewItem[],
  picked: string | null,
): ReviewItem | null {
  return items.find((item) => item.path === picked) ?? items[0] ?? null;
}
