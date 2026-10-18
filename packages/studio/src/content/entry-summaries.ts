/**
 * What the Collections panel says about each entry while one is being written: its title, its
 * status and a thumbnail (`specs/studio.md` §22.5, the Content-Entry board's list).
 *
 * The scan behind the Content home knows each entry's FILE (`browse/library-model.ts`); a title and
 * a draft flag are inside it. So this reads each entry once — a JSON entry's root, a Markdown
 * entry's frontmatter, through the same parse the editor uses — and keeps the answer until a file
 * event drops it ({@link invalidateEntrySummaries}, wired beside the scan's own invalidation in
 * `studio.ts`). A collection is read when its list is first shown, not before: the panel lists one
 * collection's entries at a time.
 *
 * The read never rejects. An entry that cannot be read is listed under its file name with no
 * status, which is what the file list would have said about it anyway.
 *
 * @docs studio/projects/browse
 */

import { isBoolean, isNonNullObject, isNumber, isString } from "@jxsuite/schema/guards";
import { getPlatform, hasPlatform } from "../platform";
import { isImage } from "../files/media-upload";
import { previewFileSrc } from "../files/media-paths";
import { hasDraftAxis, isDraftEntry } from "./draft-state";
import { entryCollection } from "./entry-model";
import { PAGES_COLLECTION, collectionKeyOfPath } from "./content-collections";
import type { EntryFields } from "./entry-fields";
import type { ContentTypeSchema } from "@jxsuite/schema/types";

/** One entry, as the Collections panel lists it. */
export interface EntrySummary {
  path: string;
  /** The entry's `title`, or its file name without the extension. */
  title: string;
  /** "Draft", "Published", or "" for a collection with no draft workflow. */
  status: string;
  /** A preview URL for the entry's first image field, or "" for none. */
  thumb: string;
  /** The entry's own date as `YYYY-MM-DD`, from its schema's date field, or "" for none. */
  date: string;
  /**
   * Each field the collection's schema declares and the entry holds, as the text a list cell shows.
   * Absent from a summary the read did not reach.
   */
  fields?: EntryFieldTexts;
}

/** An entry's declared fields as list text, keyed by field name. */
export type EntryFieldTexts = Readonly<Record<string, string>>;

/** Field names that mean "what this entry is called", in the order they are preferred. */
const TITLE_FIELD_NAMES = ["title", "name", "label", "heading"];

/**
 * The field an entry is called by: `title` where there is one, else the first conventionally named
 * field (`name`, `label`, `heading`) the schema declares or the entry holds. A menu item with a
 * `name` and no `title` is "Espresso Tiramisu", not `tiramisu`.
 */
export function titleFieldOf(
  schema: ContentTypeSchema | null | undefined,
  fields: EntryFields = {},
): string | null {
  // Whatever its capitalisation: a CSV's header row is often `Title`, and it is still the title.
  const named = (keys: readonly string[]): string | null => {
    for (const wanted of TITLE_FIELD_NAMES) {
      const key = keys.find((candidate) => candidate.toLowerCase() === wanted);
      if (key !== undefined) {
        return key;
      }
    }
    return null;
  };
  return (
    named(Object.keys(schema?.properties ?? {})) ??
    named(Object.keys(fields).filter((key) => isString(fields[key])))
  );
}

/** A field value as list text: a scalar as written, a list of scalars joined, anything else "". */
export function fieldText(value: EntryFields[string] | Date | undefined): string {
  if (value instanceof Date) {
    return entryDay(value);
  }
  if (isString(value)) {
    return value;
  }
  if (isNumber(value) || isBoolean(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => isString(item) || isNumber(item))
      .map(String)
      .join(", ");
  }
  return "";
}

/** The text of every field the schema declares and the entry holds. */
function fieldTexts(
  schema: ContentTypeSchema | null | undefined,
  fields: EntryFields,
): EntryFieldTexts {
  return Object.fromEntries(
    Object.keys(schema?.properties ?? {})
      .filter((name) => name in fields)
      .map((name) => [name, fieldText(fields[name])]),
  );
}

/** Field names that mean "when this entry is dated" when the schema types no field as a date. */
const DATE_FIELD_NAMES = ["date", "published", "publishedAt", "pubDate", "publishDate"];

/**
 * The field an entry is dated by: the first schema property typed `format: date` or `date-time`,
 * else the first conventionally named one present in the entry.
 */
export function dateFieldOf(
  schema: ContentTypeSchema | null | undefined,
  fields: EntryFields,
): string | null {
  for (const [name, field] of Object.entries(schema?.properties ?? {})) {
    if (field.format === "date" || field.format === "date-time") {
      return name;
    }
  }
  return DATE_FIELD_NAMES.find((name) => name in fields) ?? null;
}

/**
 * A date value as `YYYY-MM-DD`, or "". A value that already starts with a calendar date is taken as
 * written, so a date is never shifted a day by a time zone; anything else must parse.
 */
export function entryDay(value: EntryFields[string] | Date): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (!isString(value)) {
    return "";
  }
  const written = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (written) {
    return written[1]!;
  }
  const parsed = new Date(value);
  return value.trim() === "" || Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toISOString().slice(0, 10);
}

/** The file name without its extension: `content/posts/hello.md` → `hello`. */
export function entryStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The project path an image field names, resolved the way the entry's own page resolves it: a
 * root-relative URL is served from `public/`, anything else is relative to the entry's folder.
 */
export function imageFieldPath(entryPath: string, value: string): string {
  if (value.startsWith("/")) {
    return `public${value}`;
  }
  const dir = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/")) : "";
  const parts = [...(dir === "" ? [] : dir.split("/")), ...value.split("/")];
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") {
      continue;
    }
    if (part === "..") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.join("/");
}

/** The first field whose value is an image file, as a preview URL, or "". */
function thumbOf(entryPath: string, fields: EntryFields): string {
  for (const value of Object.values(fields)) {
    if (!isString(value) || /^[a-z][\d+.a-z-]*:/i.test(value)) {
      continue;
    }
    const dot = value.lastIndexOf(".");
    if (dot > 0 && isImage(value.slice(dot))) {
      return previewFileSrc(imageFieldPath(entryPath, value));
    }
  }
  return "";
}

/** One entry's summary, from its fields. Pure. */
export function summarize(path: string, collection: string, fields: EntryFields): EntrySummary {
  const schema = entryCollection(collection)?.schema ?? null;
  const titleField = titleFieldOf(schema, fields);
  const title = titleField === null ? undefined : fields[titleField];
  const draft = isDraftEntry(fields);
  const dateField = dateFieldOf(schema, fields);
  return {
    date: dateField === null ? "" : entryDay(fields[dateField]),
    fields: fieldTexts(schema, fields),
    path,
    status: hasDraftAxis(schema, fields) ? (draft ? "Draft" : "Published") : "",
    thumb: thumbOf(path, fields),
    title: isString(title) && title.trim() !== "" ? title : entryStem(path),
  };
}

/** Read one entry's fields: a JSON entry's root, any other entry's frontmatter. */
async function readFields(path: string): Promise<EntryFields> {
  try {
    const source = await getPlatform().readFile(path);
    if (path.endsWith(".json")) {
      const parsed: unknown = JSON.parse(source);
      /* SAFETY: a JSON entry is an object of fields (its collection's schema says so); a value
         that is not an object has no fields, which is what the fallback below says. */
      return isNonNullObject(parsed) && !Array.isArray(parsed) ? (parsed as EntryFields) : {};
    }
    const { parseSourceForPath } = await import("../files/file-ops");
    const parsed = await parseSourceForPath(path, source);
    return parsed.frontmatter;
  } catch {
    return {};
  }
}

// ─── The cache ───────────────────────────────────────────────────────────────

/** Entries read, keyed by collection and then by the paths listed, so a changed list re-reads. */
const _cache = new Map<string, { key: string; entries: EntrySummary[] }>();
const _loading = new Map<string, Promise<EntrySummary[]>>();
let _epoch = 0;
const _listeners = new Set<() => void>();

/** At most this many entries are read for one list; the rest are listed by file name. */
export const SUMMARY_READ_LIMIT = 200;

/** Read a collection's entries. */
async function readSummaries(
  collection: string,
  paths: readonly string[],
): Promise<EntrySummary[]> {
  const read = paths.slice(0, SUMMARY_READ_LIMIT);
  const summaries = await Promise.all(
    read.map(async (path) => summarize(path, collection, await readFields(path))),
  );
  const rest = paths.slice(SUMMARY_READ_LIMIT).map((path): EntrySummary => ({
    date: "",
    path,
    status: "",
    thumb: "",
    title: entryStem(path),
  }));
  return [...summaries, ...rest];
}

/**
 * A collection's entries as they stand: the summaries, or `null` while they are being read (which
 * starts the read; listeners are told when it lands).
 *
 * @param collection - The collection's name.
 * @param paths - Its entry files, in the order to list them.
 */
export function peekEntrySummaries(
  collection: string,
  paths: readonly string[],
): EntrySummary[] | null {
  const key = paths.join("\n");
  const cached = _cache.get(collection);
  if (cached?.key === key) {
    return cached.entries;
  }
  if (!hasPlatform()) {
    return paths.map((path) => ({ date: "", path, status: "", thumb: "", title: entryStem(path) }));
  }
  const inFlight = `${collection}\n${key}`;
  if (!_loading.has(inFlight)) {
    const epoch = _epoch;
    const read: Promise<EntrySummary[]> = readSummaries(collection, paths).then((entries) => {
      /* Only this read's own record: an invalidation in between may have handed the key to a newer
         read, and deleting THAT record would let the next peek start a duplicate of it. */
      if (_loading.get(inFlight) === read) {
        _loading.delete(inFlight);
      }
      if (epoch === _epoch) {
        _cache.set(collection, { entries, key });
        for (const listener of _listeners) {
          listener();
        }
      }
      return entries;
    });
    _loading.set(inFlight, read);
  }
  return null;
}

/**
 * Restate one entry from the fields Studio just saved, without reading the file back.
 *
 * A save is Studio's own write, so the fields it wrote are the answer, and re-reading them is both
 * slower and wrong: the dev server lets a file read be cached for five seconds, and its watcher
 * skips some trees outright, so the list kept the old title after an author renamed an entry and
 * pressed Save. An entry no cached list holds is left to that list's own first read.
 *
 * @returns Whether a cached list held the entry and now states the saved fields.
 */
export function noteEntrySaved(path: string, collection: string, fields: EntryFields): boolean {
  const cached = _cache.get(collection);
  const index = cached?.entries.findIndex((entry) => entry.path === path) ?? -1;
  if (!cached || index === -1) {
    return false;
  }
  const entries = cached.entries.with(index, summarize(path, collection, fields));
  _cache.set(collection, { entries, key: cached.key });
  for (const listener of _listeners) {
    listener();
  }
  return true;
}

/**
 * After a document saved: restate its entry, when it is one, from the fields it saved.
 *
 * The caller says where the fields live (`entryFields(tab)`, the live record, not a copy), which
 * keeps the editor's field store out of this data module's graph.
 *
 * @param path The saved document's path, or `null` for one with no file.
 * @param fields The saved document's fields: a JSON entry's root, any other entry's frontmatter.
 * @returns Whether a cached list changed, so the caller knows a repaint is due.
 */
export function noteSavedEntry(path: string | null, fields: EntryFields): boolean {
  const collection = collectionKeyOfPath(path);
  if (path === null || collection === null || collection === PAGES_COLLECTION) {
    return false;
  }
  return noteEntrySaved(path, collection, fields);
}

/** Forget every summary. The next list re-reads its entries. */
export function invalidateEntrySummaries(): void {
  _epoch += 1;
  _cache.clear();
  _loading.clear();
}

/** Be told when a read lands. Returns the function that stops it. */
export function onEntrySummariesRead(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
