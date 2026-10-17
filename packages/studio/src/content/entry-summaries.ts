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

import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import { getPlatform, hasPlatform } from "../platform";
import { isImage } from "../files/media-upload";
import { previewFileSrc } from "../files/media-paths";
import { hasDraftAxis, isDraftEntry } from "./draft-state";
import { entryCollection } from "./entry-model";
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
  const { title } = fields;
  const schema = entryCollection(collection)?.schema ?? null;
  const draft = isDraftEntry(fields);
  const dateField = dateFieldOf(schema, fields);
  return {
    date: dateField === null ? "" : entryDay(fields[dateField]),
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
