/**
 * Search-index — the `search` project-section owner.
 *
 * `projectData` normalizes the section into `_project.search`; `emit` (extensions.md §8.4) builds
 * the site's search index from the loaded content collections and returns it for the host to write
 * into the build output. Documents come in two granularities: one per content entry (full text)
 * and, when `sections` is on, one per heading section carrying a `#anchor` deep link (heading ids
 * are assigned by the parser — parser.md §3.2). An entry whose frontmatter says `search: false`
 * contributes neither.
 *
 * @docs extending/extensions/search
 */

import { isBoolean, isString } from "@jxsuite/schema/guards";
import { canonicalizeLocale, localeUrlPrefix, resolveI18n } from "@jxsuite/schema/locale";
import { entryUrl, jxTreeToText, normalizeSearchConfig, splitEntry } from "./shared.ts";
import type { NormalizedSearchConfig } from "./shared.ts";
import type { EmitHostContext } from "@jxsuite/schema/format-registry";
import type { ContentFieldValue, ContentLoaderEntry, JsonValue } from "@jxsuite/schema/types";

/** One searchable document in the emitted index. */
export interface SearchDocument {
  /**
   * Unique id: `<collection>:<entry-id>` for pages, `<collection>:<entry-id>#<anchor>` for
   * sections.
   */
  id: string;
  collection: string;
  slug: string;
  url: string;
  title: string;
  description: string;
  /** Section heading text; empty for page-level documents. */
  heading: string;
  text: string;
  /**
   * The entry's language, present only for a collection spread over one directory per locale
   * (site-architecture.md §13.3). Absent means "every language" — an unlocalized collection is not
   * in one language, it is outside the question.
   */
  locale?: string;
}

/** The emitted index file: engine-tagged envelope around the document list. */
export interface SearchIndexEnvelope {
  version: 1;
  engine: "minisearch";
  /** Fields the client indexes (union across collections). */
  fields: string[];
  /** Per-field score boosts (merged across collections). */
  boost: Record<string, number>;
  documents: SearchDocument[];
}

/**
 * The host's `emit` context (extensions.md §8.4) as `SearchIndex.emit` accepts it: any part of
 * {@link EmitHostContext}. The published name, kept for existing importers.
 */
export type EmitContext = Partial<EmitHostContext>;

/**
 * Whether an entry's frontmatter keeps it out of the index (`search: false`).
 *
 * The opt-out is per ENTRY, so it removes the page document and every section document with it: a
 * page that should not be found by its title should not be found by its headings either. It is also
 * the only lever a page has — the index is otherwise a pure function of the collection, which is
 * what lets a generated reference page (a spec changelog, a standards table) leave the index
 * without leaving the site or losing a word of its prose.
 *
 * Only the boolean `false` opts out. A string `"false"`, a `0` or a `"no"` reads like an opt-out to
 * the author who wrote it and like nothing at all to a strict reader, and silently honouring the
 * looser reading would make the index depend on YAML's coercion rules. So a non-boolean value is
 * INDEXED — the safe failure, because a page that is present can be found and a page that is absent
 * cannot say why — and reported once per entry, not once per document it yields.
 */
function isOptedOut(
  collection: string,
  entryId: string,
  value: ContentFieldValue | undefined,
): boolean {
  if (value === undefined || isBoolean(value)) {
    return value === false;
  }
  console.warn(
    `@jxsuite/search: "${collection}/${entryId}" sets search to ${JSON.stringify(value)}; ` +
      `only the boolean false opts a page out of the index — it stays indexed`,
  );
  return false;
}

/**
 * The `SearchIndex` capability surface. The extension host dispatches capability methods on the
 * export named by the descriptor title (specs/extensions.md §6.1); a plain object serves the
 * static-dispatch contract exactly like a class with static methods.
 */
export const SearchIndex = {
  /** Normalize the `search` section into `_project.search` (defaults applied). */
  projectData(sectionValue: JsonValue | undefined): NormalizedSearchConfig {
    return normalizeSearchConfig(sectionValue);
  },

  /** Build the search index from the loaded content collections. */
  emit(sectionValue: JsonValue | undefined, ctx: EmitContext): { path: string; content: string }[] {
    const config = normalizeSearchConfig(sectionValue);
    /* SAFETY: the `content` section's owner (the parser's `Content.projectData`) answers a
       Map of collection name to loaded entries (specs/extensions.md §8.4), and the host forwards
       each section's answer unchanged. */
    const content = ctx.sections?.content as Map<string, ContentLoaderEntry[]> | undefined;
    /*
     * `entryUrl` drops the trailing slash only for the exact string "never", so a setting that is
     * absent or not a string means "always", which is the default.
     */
    const trailingSlashSetting = ctx.projectConfig?.build?.trailingSlash;
    const trailingSlash = isString(trailingSlashSetting) ? trailingSlashSetting : "always";
    /*
     * A localized entry lives at a locale-prefixed URL, and the index is the only place that knew
     * the entry without knowing the prefix: every French post was indexed at the English post's
     * URL, so a reader who searched in French was sent to the English page. The prefix is the
     * routing rule, read from the same resolver the build reads.
     */
    const { i18n } = resolveI18n(ctx.projectConfig ?? {});

    const documents: SearchDocument[] = [];
    const fields = new Set<string>();
    const boost: Record<string, number> = {};

    for (const [name, collection] of Object.entries(config.collections)) {
      const entries = content?.get(name);
      if (!entries) {
        console.warn(
          `@jxsuite/search: collection "${name}" is not a loaded content collection — skipped`,
        );
        continue;
      }
      for (const field of collection.fields) {
        fields.add(field);
      }
      Object.assign(boost, collection.boost);

      for (const entry of entries) {
        const { data } = entry;
        if (isOptedOut(name, entry.id, data.search)) {
          continue;
        }
        /*
         * Only when the project declares locales. An entry cannot carry one otherwise — the loader
         * stamps it while expanding `{locale}`, which needs a list to expand over — and a stray tag
         * would make the client filter results away for a language the site does not have.
         */
        const locale =
          i18n === null ? undefined : (canonicalizeLocale(entry._meta?.locale) ?? undefined);
        /*
         * An entry of a content type with a `route` carries its URL (`_meta.url`), stamped by the
         * loader from the template its page and its links were generated from, so the index cannot
         * point at a URL the site does not have. Only an entry with none is placed by the
         * collection's `basePath` + id, the older, flat rule.
         */
        const stamped = entry._meta?.url;
        const url =
          stamped !== undefined && stamped.startsWith("/")
            ? stamped
            : entryUrl(
                `${localeUrlPrefix(locale, i18n)}${collection.basePath}`,
                entry.id,
                trailingSlash,
              );
        const title = isString(data.title) ? data.title : entry.id;
        const description = isString(data.description) ? data.description : "";
        const children = entry.$children;
        /*
         * Two translations of one post share an id (§13.3), so the document id has to carry the
         * locale as well — without it the French entry and the English one are one document and
         * whichever is indexed second wins.
         */
        const documentId =
          locale === undefined ? `${name}:${entry.id}` : `${name}:${locale}:${entry.id}`;

        /*
         * The preamble and the sections partition the entry, so the page document carries only the
         * preamble when sections were produced — emitting the full text as well indexed the whole
         * corpus twice, doubling both the bytes a visitor downloads and the tokenising their main
         * thread does before search can answer.
         *
         * An entry that yielded no sections keeps its full text: it has no headings, or none with
         * an id, and nothing else would index it.
         */
        const split = collection.sections
          ? splitEntry(children, collection.sectionDepth)
          : undefined;
        const sections = split?.sections ?? [];

        // `locale` is the last key of every document, and present only for a localized entry.
        const page: SearchDocument = {
          id: documentId,
          collection: name,
          slug: entry.id,
          url,
          title,
          description,
          heading: "",
          text: sections.length > 0 && split ? split.preamble : jxTreeToText(children),
        };
        if (locale !== undefined) {
          page.locale = locale;
        }
        documents.push(page);

        for (const section of sections) {
          const sectionDocument: SearchDocument = {
            id: `${documentId}#${section.anchor}`,
            collection: name,
            slug: entry.id,
            url: `${url}#${section.anchor}`,
            title,
            description,
            heading: section.heading,
            text: section.text,
          };
          if (locale !== undefined) {
            sectionDocument.locale = locale;
          }
          documents.push(sectionDocument);
        }
      }
    }

    const envelope: SearchIndexEnvelope = {
      version: 1,
      engine: config.engine,
      fields: [...fields],
      boost,
      documents,
    };
    return [{ path: config.output, content: JSON.stringify(envelope) }];
  },
};
