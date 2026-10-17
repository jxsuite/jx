/**
 * Add new, as a pure derivation: what a kind, a name and that kind's options WRITE.
 *
 * `specs/studio.md` §9.1.1. One function, {@link deriveCreation}, answers the directory, the file
 * name, the extension, the route, the tag and the initial content of whatever the dialog is about
 * to create, and {@link creationProblem} answers whether it may. The dialog prints the first as its
 * "Saved as …" hint and refuses with the second; the flow (`create/add-new-flow.ts`) writes the
 * first once the second is empty. What the dialog says is what it writes BY CONSTRUCTION, because
 * there is no second place a path is composed.
 *
 * The refusals a file name earns are New File's (`files/new-file-name.ts`): blank, a slug of
 * nothing, a `..`, a collision in the destination. A component's tag is HTML's valid custom element
 * name (`create/element-name.ts`). Neither is restated here.
 *
 * Nothing here touches the platform, the DOM or a store. The caller hands in a
 * {@link CreationContext} — the layouts, collections and components the project has — and a `taken`
 * lookup over the directory listings it made, so every branch is a unit test.
 *
 * @docs studio/projects/pages-layouts-components
 */

import { fileToRoute } from "@jxsuite/site/routes";
import { isJsonObject } from "@jxsuite/schema/guards";
import { seedEntry } from "../content/entry-model";
import { slugify, validateNewFileName } from "../files/new-file-name";
import { customElementNameProblem, deriveTagName } from "./element-name";
import type {
  ContentTypeSchema,
  ContentTypeSchemaField,
  JsonObject,
  JxMutableNode,
} from "@jxsuite/schema/types";

// ─── Kinds ───────────────────────────────────────────────────────────────────

/** What Add new creates, in the order its list shows them. */
export const CREATION_KINDS = [
  "page",
  "collection",
  "template",
  "component",
  "media",
  "entry",
] as const;

export type CreationKind = (typeof CREATION_KINDS)[number];

/** How a kind is named and introduced: the list row, the field label and the button. */
export interface KindInfo {
  id: CreationKind;
  label: string;
  /** The muted line under the row's label. */
  hint: string;
  icon: string;
  /** The primary button. */
  cta: string;
  /** The name field's label. Media has no name. */
  nameLabel: string;
  placeholder: string;
}

/** The copy the approved Add new board carries, one row per kind. */
export const KIND_INFO: Readonly<Record<CreationKind, KindInfo>> = {
  collection: {
    cta: "Create collection",
    hint: "Posts, products, team… with a page each",
    icon: "stack",
    id: "collection",
    label: "Collection",
    nameLabel: "Collection name",
    placeholder: "Recipes",
  },
  component: {
    cta: "Create component",
    hint: "A reusable block for any page",
    icon: "cube",
    id: "component",
    label: "Component",
    nameLabel: "Component name",
    placeholder: "Pricing table",
  },
  entry: {
    cta: "Create entry",
    hint: "A new item in a collection",
    icon: "file-text",
    id: "entry",
    label: "Entry",
    nameLabel: "Entry name",
    placeholder: "My first post",
  },
  media: {
    cta: "Upload",
    hint: "Images, video, documents",
    icon: "image",
    id: "media",
    label: "Media",
    nameLabel: "",
    placeholder: "",
  },
  page: {
    cta: "Create page",
    hint: "A new URL on your site",
    icon: "file",
    id: "page",
    label: "Page",
    nameLabel: "Page name",
    placeholder: "Pricing",
  },
  template: {
    cta: "Create template",
    hint: "Shared frame that pages sit inside",
    icon: "frame-corners",
    id: "template",
    label: "Template",
    nameLabel: "Template name",
    placeholder: "Landing",
  },
};

/** Where uploads land when nothing else names a folder (`specs/studio.md` §9.3). */
export const MEDIA_DIR = "public/media";

// ─── Options ─────────────────────────────────────────────────────────────────

/** A page's Start from: no template at all. */
export const START_BLANK = "blank";
/** A page's Start from: prose, saved in the project's writing format (Markdown). */
export const START_ARTICLE = "article";
/** A component's Start from: lift the canvas selection out (Convert to Component). */
export const START_SELECTION = "selection";
/** A component's Start from: a copy of an existing component. */
export const START_COPY = "copy";

/** The field presets a new collection can start with, in the board's order. */
export const FIELD_PRESETS = [
  "title",
  "image",
  "richText",
  "date",
  "tags",
  "number",
  "link",
] as const;

export type FieldPreset = (typeof FIELD_PRESETS)[number];

/** What a preset is called, and what it adds to the schema. `richText` is the entry's BODY. */
export const FIELD_PRESET_INFO: Readonly<
  Record<FieldPreset, { label: string; key: string | null; schema: ContentTypeSchemaField | null }>
> = {
  date: { key: "date", label: "Date", schema: { format: "date", type: "string" } },
  image: { key: "cover", label: "Image", schema: { format: "image", type: "string" } },
  link: { key: "link", label: "Link", schema: { format: "uri", type: "string" } },
  number: { key: "number", label: "Number", schema: { type: "number" } },
  richText: { key: null, label: "Rich text", schema: null },
  tags: { key: "tags", label: "Tags", schema: { items: { type: "string" }, type: "array" } },
  title: { key: "title", label: "Title", schema: { type: "string" } },
};

/** The presets a new collection starts with checked. */
export const DEFAULT_FIELD_PRESETS: readonly FieldPreset[] = ["title", "image", "richText"];

/** What the reader chose beyond the name. Each kind reads the options it has. */
export interface CreationOptions {
  /**
   * Page: {@link START_BLANK}, {@link START_ARTICLE} or a layout path. Template: a layout path to
   * wrap in, or `""` for nothing. Component: `"blank"`, {@link START_SELECTION} or
   * {@link START_COPY}.
   */
  startFrom?: string | undefined;
  /** Page: the URL, when the reader edited it. Derived from the name otherwise. */
  url?: string | undefined;
  /** Collection: the field presets. */
  fields?: readonly FieldPreset[] | undefined;
  /** Collection: give each entry a page of its own. */
  ownPage?: boolean | undefined;
  /** Collection: the own page's template — a layout path, or {@link START_BLANK} for none. */
  pageTemplate?: string | undefined;
  /** Entry: the collection it is created in. */
  collection?: string | undefined;
  /** Component: the tag of the component a copy is made of. */
  copyOf?: string | undefined;
  /** Media: how many files are waiting to upload. */
  files?: number | undefined;
}

// ─── Context ─────────────────────────────────────────────────────────────────

/** A layout the project has, as the Page panel's picker lists it. */
export interface LayoutChoice {
  name: string;
  /** The `$layout` reference: project-root relative, `./layouts/base.json`. */
  ref: string;
}

/** A collection an entry can be created in. */
export interface CollectionChoice {
  name: string;
  /** Source directory, without a trailing slash. May hold a `{locale}` placeholder. */
  dir: string;
  ext: string;
  schema: ContentTypeSchema | null;
  /** The format class that writes its entries, or `null` for native JSON. */
  formatName: string | null;
}

/** A format the derivation can write a body-bearing document in. */
export interface WritingFormat {
  /** The format class's import name, `Markdown`. */
  name: string;
  /** The extension it writes, `.md`. */
  ext: string;
}

/** What the project has, read once by the flow and handed in. */
export interface CreationContext {
  layouts: readonly LayoutChoice[];
  /** `project.json` `defaults.layout`, as written, or `null`. */
  defaultLayout: string | null;
  collections: readonly CollectionChoice[];
  /** Every `content` name `project.json` declares, file-backed ones included. */
  declaredContent: readonly string[];
  /** The tags the component registry knows. */
  componentTags: readonly string[];
  /** The tags a copy can be made of: the project's own JSON definitions, npm packages excluded. */
  copyableTags?: readonly string[] | undefined;
  /** Component definitions a copy can be made of, by tag. */
  componentDocs?: ReadonlyMap<string, JxMutableNode> | undefined;
  /** Whether the canvas has an element a conversion could lift out. */
  hasSelection?: boolean | undefined;
  /** The format an Article page is written in, or `null` when the project has none. */
  article: WritingFormat | null;
  /** The format a new collection's entries are written in, or `null` for native JSON. */
  contentFormat: WritingFormat | null;
}

/**
 * Names already in a directory, lower-cased, or `undefined` while it has not been listed.
 *
 * `undefined` is "not known yet" and is never read as "free": the flow lists every destination it
 * is about to write before it writes, and judges again.
 */
export type TakenLookup = (dir: string) => ReadonlySet<string> | undefined;

// ─── The result ──────────────────────────────────────────────────────────────

/** A document to write, and the format that writes it (`null` is native JSON). */
export interface CreationBody {
  doc: JsonObject;
  format: string | null;
  /** Write a frontmatter block. Only a format reads it. */
  frontmatter?: boolean;
}

/** One more file a creation writes beside its main one. */
export interface CreationWrite {
  path: string;
  body: CreationBody;
}

/** What one Add new writes, derived. */
export interface Creation {
  kind: CreationKind;
  dir: string;
  fileName: string;
  /** The main file's extension, `.json`, `.md`, or `""` for Media. */
  ext: string;
  /** `dir/fileName`, or the upload directory for Media. */
  path: string;
  /** A component's custom element name. */
  tag?: string;
  /** The URL a page, or a collection's own page, opens at. */
  route?: string;
  content: CreationBody;
  /** The files written beside the main one: a collection's first entry and its own page. */
  extraWrites: CreationWrite[];
  /** A collection's `project.json` `content` entry. */
  config?: { name: string; entry: JsonObject };
  /** The one-line "Saved as …" hint. */
  saved: string;
}

// ─── Small derivations ───────────────────────────────────────────────────────

/** `dir/name`, with the project root spelled as no prefix. */
function join(dir: string, name: string): string {
  return dir === "." || dir === "" ? name : `${dir}/${name}`;
}

/** `./layouts/base.json` → `layouts/base.json`: the spelling a path comparison needs. */
export function normalizeLayoutPath(path: string): string {
  return path.replace(/^\.\//, "");
}

/**
 * The `$layout` a document should carry for a chosen template.
 *
 * `undefined` is "say nothing": the project's default already applies, so writing it again would
 * freeze this document to today's default. {@link START_BLANK} is `false` when a default exists to
 * opt out of, and nothing when there is none.
 */
export function layoutValueFor(choice: string, ctx: CreationContext): string | false | undefined {
  const fallback = ctx.defaultLayout;
  if (choice === START_BLANK || choice === "") {
    return fallback ? false : undefined;
  }
  if (fallback && normalizeLayoutPath(fallback) === normalizeLayoutPath(choice)) {
    return undefined;
  }
  return choice;
}

/** The template a new page, or a collection's page, starts from unless the reader picks another. */
export function defaultTemplateChoice(ctx: CreationContext): string {
  const fallback = ctx.defaultLayout;
  if (fallback) {
    const match = ctx.layouts.find(
      (layout) => normalizeLayoutPath(layout.ref) === normalizeLayoutPath(fallback),
    );
    return match?.ref ?? fallback;
  }
  return ctx.layouts[0]?.ref ?? START_BLANK;
}

/** A collection's item, said in the singular: `recipes` → `recipe`, `stories` → `story`. */
export function itemNoun(collection: string): string {
  if (/[^aeiou]ies$/.test(collection)) {
    return `${collection.slice(0, -3)}y`;
  }
  if (/[^s]s$/.test(collection)) {
    return collection.slice(0, -1);
  }
  return collection;
}

/**
 * A page URL as the reader typed it, reduced to path segments: each one slugified, empty ones
 * dropped. `"/Docs/Getting Started/"` → `["docs", "getting-started"]`, `"/"` → `[]`.
 */
export function urlSegments(url: string): string[] {
  return url
    .trim()
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => slugify(segment))
    .filter((segment) => segment !== "");
}

/** The schema a collection's presets add up to. Title, when chosen, is required. */
export function presetSchema(fields: readonly FieldPreset[]): ContentTypeSchema {
  const properties: Record<string, ContentTypeSchemaField> = {};
  for (const preset of FIELD_PRESETS) {
    const info = FIELD_PRESET_INFO[preset];
    if (fields.includes(preset) && info.key !== null && info.schema !== null) {
      properties[info.key] = { ...info.schema };
    }
  }
  const schema: ContentTypeSchema = { properties, type: "object" };
  if (fields.includes("title")) {
    schema.required = ["title"];
  }
  return schema;
}

/**
 * A seeded entry body: the schema's defaults and required keys, the title set to the name when the
 * schema has one, written in the collection's format.
 *
 * The shape `content/entry-commands.ts` has always seeded with — `{ ...seed, children: [] }` with a
 * frontmatter block when the seed has keys — so the New File route into a collection folder and Add
 * new write the same bytes.
 */
export function entryBody(
  collection: Pick<CollectionChoice, "schema" | "formatName" | "ext">,
  title?: string,
): CreationBody {
  const seed = seedEntry(collection.schema);
  if (title !== undefined && title !== "" && collection.schema?.properties?.title !== undefined) {
    seed.title = title;
  }
  if (collection.ext === ".json" || collection.formatName === null) {
    return { doc: seed, format: null };
  }
  return {
    doc: { ...seed, children: [] },
    format: collection.formatName,
    frontmatter: Object.keys(seed).length > 0,
  };
}

/**
 * The page every entry of a collection opens at: the blog starter's `pages/[slug].json`, field for
 * field — `$paths` over the `slug` param, a `ContentEntry` named `entry`, the chosen `$layout` —
 * with a body bound to whichever of title, image and rich text the collection has.
 */
export function collectionPageBody(
  name: string,
  fields: readonly FieldPreset[],
  layout: string | false | undefined,
  ctx: Pick<CreationContext, "contentFormat">,
): JsonObject {
  const children: JsonObject[] = [];
  if (fields.includes("title")) {
    children.push({ tagName: "h1", textContent: "${state.entry.data.title}" });
  }
  if (fields.includes("image")) {
    children.push({
      attributes: {
        alt: fields.includes("title") ? "${state.entry.data.title}" : "",
        loading: "lazy",
        src: "${state.entry.data.cover}",
      },
      tagName: "img",
    });
  }
  if (fields.includes("richText") && ctx.contentFormat !== null) {
    children.push({ children: "${state.entry.$children}", tagName: "div" });
  }
  const page: JsonObject = {};
  if (layout !== undefined) {
    page.$layout = layout;
  }
  page.$paths = { contentType: name, field: "id", param: "slug" };
  page.title = fields.includes("title") ? "${state.entry.data.title}" : itemNoun(name);
  page.state = {
    entry: {
      $prototype: "ContentEntry",
      $src: "@jxsuite/parser/ContentEntry.class.json",
      contentType: name,
      field: "id",
      id: { $ref: "#/$params/slug" },
    },
  };
  page.tagName = "article";
  page.children = children;
  return page;
}

// ─── The derivation ──────────────────────────────────────────────────────────

/** A blank component's whole definition. */
function componentDoc(tagName: string, options: CreationOptions, ctx: CreationContext): JsonObject {
  if (options.startFrom === START_COPY && options.copyOf !== undefined) {
    const source = ctx.componentDocs?.get(options.copyOf);
    if (source) {
      // SAFETY: a definition read from disk is a JSON document, and this clone is a fresh copy.
      // oxlint-disable-next-line unicorn/prefer-structured-clone
      const copy = JSON.parse(JSON.stringify(source)) as JsonObject;
      delete copy.$id;
      copy.tagName = tagName;
      return copy;
    }
  }
  return { children: [], tagName };
}

/** A page: its file, its URL, and its body. */
function derivePage(name: string, options: CreationOptions, ctx: CreationContext): Creation {
  const startFrom = options.startFrom ?? defaultTemplateChoice(ctx);
  const article = startFrom === START_ARTICLE && ctx.article !== null ? ctx.article : null;
  const ext = article?.ext ?? ".json";
  const segments =
    options.url === undefined ? [slugify(name)].filter((s) => s !== "") : urlSegments(options.url);
  const stem =
    segments.length === 0 ? (options.url === undefined ? "" : "index") : segments.at(-1)!;
  const dir = ["pages", ...segments.slice(0, -1)].join("/");
  const fileName = stem === "" ? "" : `${stem}${ext}`;
  const path = join(dir, fileName);
  const title = name.trim();
  let content: CreationBody;
  if (article) {
    content = {
      doc: { children: [{ tagName: "h1", textContent: title }], title },
      format: article.name,
      frontmatter: true,
    };
  } else {
    const doc: JsonObject = {};
    const layout = layoutValueFor(startFrom === START_ARTICLE ? START_BLANK : startFrom, ctx);
    if (layout !== undefined) {
      doc.$layout = layout;
    }
    doc.title = title;
    doc.tagName = "main";
    doc.children = [{ tagName: "h1", textContent: title }];
    content = { doc, format: null };
  }
  const route = fileName === "" ? "" : fileToRoute(path).urlPattern;
  return {
    content,
    dir,
    ext,
    extraWrites: [],
    fileName,
    kind: "page",
    path,
    route,
    saved: fileName === "" ? "" : `Saved as ${path} · opens at ${route}`,
  };
}

/** A collection: its `project.json` entry, its folder's first entry, and optionally its page. */
function deriveCollection(name: string, options: CreationOptions, ctx: CreationContext): Creation {
  const slug = slugify(name);
  const fields = options.fields ?? DEFAULT_FIELD_PRESETS;
  const dir = `content/${slug}`;
  const format = ctx.contentFormat;
  const ext = format?.ext ?? ".json";
  const item = itemNoun(slug);
  const fileName = slug === "" ? "" : `first-${item}${ext}`;
  const schema = presetSchema(fields);
  // The schema as the JSON `project.json` stores: a copy the guard proves is a JSON object.
  const stored: unknown = structuredClone(schema);
  const entry: JsonObject = {
    format: format?.name ?? "json",
    schema: isJsonObject(stored) ? stored : {},
    source: `./${dir}`,
  };
  const first = entryBody({ ext, formatName: format?.name ?? null, schema }, `First ${item}`);
  const extraWrites: CreationWrite[] = [];
  let route: string | undefined;
  let pageNote = "";
  if (options.ownPage !== false && slug !== "") {
    const template = options.pageTemplate ?? defaultTemplateChoice(ctx);
    const pagePath = `pages/${slug}/[slug].json`;
    route = fileToRoute(pagePath).urlPattern;
    extraWrites.push({
      body: {
        doc: collectionPageBody(slug, fields, layoutValueFor(template, ctx), ctx),
        format: null,
      },
      path: pagePath,
    });
    pageNote = `, and ${pagePath} at ${route}`;
  }
  const result: Creation = {
    config: { entry, name: slug },
    content: first,
    dir,
    ext,
    extraWrites,
    fileName,
    kind: "collection",
    path: join(dir, fileName),
    saved:
      slug === ""
        ? ""
        : `Adds a “${slug}” collection to project.json, a ${dir}/ folder with a first entry${pageNote}.`,
  };
  if (route !== undefined) {
    result.route = route;
  }
  return result;
}

/** A template: always `.json`, because both readers of a layout parse it as JSON only. */
function deriveTemplate(name: string, options: CreationOptions): Creation {
  const slug = slugify(name);
  const fileName = slug === "" ? "" : `${slug}.json`;
  const path = join("layouts", fileName);
  const doc: JsonObject = {};
  const wrap = options.startFrom ?? "";
  if (wrap !== "" && wrap !== START_BLANK) {
    doc.$layout = wrap;
  }
  doc.tagName = "div";
  doc.children = [{ children: [{ tagName: "slot" }], tagName: "main" }];
  return {
    content: { doc, format: null },
    dir: "layouts",
    ext: ".json",
    extraWrites: [],
    fileName,
    kind: "template",
    path,
    saved: fileName === "" ? "" : `Saved as ${path} with one slot.`,
  };
}

/** A component: the tag the name derives to, and a definition that carries it. */
function deriveComponent(name: string, options: CreationOptions, ctx: CreationContext): Creation {
  const tagName = deriveTagName(name);
  const fileName = tagName === "" ? "" : `${tagName}.json`;
  const path = join("components", fileName);
  return {
    content: { doc: componentDoc(tagName, options, ctx), format: null },
    dir: "components",
    ext: ".json",
    extraWrites: [],
    fileName,
    kind: "component",
    path,
    saved: fileName === "" ? "" : `Saved as ${path} with tag <${tagName}>.`,
    tag: tagName,
  };
}

/** An entry: a seeded file in the collection's source root, in its fixed format. */
function deriveEntry(name: string, options: CreationOptions, ctx: CreationContext): Creation {
  const collection = ctx.collections.find((c) => c.name === options.collection) ?? null;
  const slug = slugify(name);
  const ext = collection?.ext ?? ".json";
  const dir = collection?.dir ?? "content";
  const fileName = slug === "" || collection === null ? "" : `${slug}${ext}`;
  const path = join(dir, fileName);
  return {
    content: collection ? entryBody(collection, name.trim()) : { doc: {}, format: null },
    dir,
    ext,
    extraWrites: [],
    fileName,
    kind: "entry",
    path,
    saved: fileName === "" ? "" : `Saved as ${path} in ${collection!.name}.`,
  };
}

/**
 * Everything one Add new would write, from the kind, the name and the options.
 *
 * Total: an empty or unusable name derives an empty `fileName` and an empty `saved`, never a throw,
 * so the dialog can call this on every keystroke and let {@link creationProblem} say why.
 */
export function deriveCreation(
  kind: CreationKind,
  name: string,
  options: CreationOptions,
  ctx: CreationContext,
): Creation {
  switch (kind) {
    case "page": {
      return derivePage(name, options, ctx);
    }
    case "collection": {
      return deriveCollection(name, options, ctx);
    }
    case "template": {
      return deriveTemplate(name, options);
    }
    case "component": {
      return deriveComponent(name, options, ctx);
    }
    case "entry": {
      return deriveEntry(name, options, ctx);
    }
    default: {
      const files = options.files ?? 0;
      return {
        content: { doc: {}, format: null },
        dir: MEDIA_DIR,
        ext: "",
        extraWrites: [],
        fileName: "",
        kind,
        path: MEDIA_DIR,
        saved:
          files === 0
            ? `Saved under ${MEDIA_DIR}/. No folder to choose.`
            : `${files === 1 ? "1 file" : `${files} files`} will be saved under ${MEDIA_DIR}/.`,
      };
    }
  }
}

// ─── The refusal ─────────────────────────────────────────────────────────────

/** New File's refusal for one path, judged against its directory's listing when there is one. */
function fileProblem(path: string, taken: TakenLookup): string {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "." : path.slice(0, slash);
  const listing = taken(dir);
  return validateNewFileName(path.slice(slash + 1), "", {
    dir,
    taken: listing ?? new Set<string>(),
  });
}

/**
 * The directories that could hold another page at a page's route, beside the one it is written in.
 *
 * `pages/about.json` opens where `pages/about.md` and `pages/about/index.json` do, and
 * `pages/about/index.json` where `pages/about.json` does, so the refusal lists the neighbour too.
 */
function routeNeighbours(creation: Creation): { dir: string; stem: string }[] {
  if (creation.kind !== "page" || creation.fileName === "") {
    return [];
  }
  const stem = creation.fileName.slice(0, creation.fileName.length - creation.ext.length);
  if (stem !== "index") {
    // `<dir>/<stem>.*` in its own directory, and `<dir>/<stem>/index.*` one down.
    return [
      { dir: creation.dir, stem },
      { dir: join(creation.dir, stem), stem: "index" },
    ];
  }
  const slash = creation.dir.lastIndexOf("/");
  if (slash === -1) {
    return [{ dir: creation.dir, stem }];
  }
  // `<parent>/<dir>.*` claims the route `<dir>/index.*` opens at.
  return [
    { dir: creation.dir, stem },
    { dir: creation.dir.slice(0, slash), stem: creation.dir.slice(slash + 1) },
  ];
}

/** Another page file that already opens at this page's route, or `null`. */
function routeClaimant(creation: Creation, taken: TakenLookup): string | null {
  const own = creation.fileName.toLowerCase();
  for (const { dir, stem } of routeNeighbours(creation)) {
    const prefix = `${stem.toLowerCase()}.`;
    for (const name of taken(dir) ?? []) {
      if (name.startsWith(prefix) && !(dir === creation.dir && name === own)) {
        return join(dir, name);
      }
    }
  }
  return null;
}

/** The name refusals every named kind shares: blank, then a slug of nothing. */
function nameProblem(name: string): string {
  return validateNewFileName(name, "", {
    choice: { ext: "", kind: "fixed" },
    dir: ".",
    taken: new Set(),
  });
}

/**
 * Why this creation may not be made, or `""` when it may.
 *
 * The first refusal that applies, in the order a reader fixes them: the name, then what the kind
 * needs (a valid tag, a collection, a selection, a URL), then a collision on disk or in the
 * project's declarations.
 */
export function creationProblem(
  creation: Creation,
  name: string,
  options: CreationOptions,
  ctx: CreationContext,
  taken: TakenLookup,
): string {
  if (creation.kind === "media") {
    return (options.files ?? 0) === 0 ? "Drop files here, or browse for them." : "";
  }
  const named = nameProblem(name);
  if (named !== "") {
    return named;
  }
  switch (creation.kind) {
    case "page": {
      if (options.url !== undefined) {
        if (options.url.replaceAll("\\", "/").split("/").includes("..")) {
          return "A URL cannot step outside the site.";
        }
        if (!options.url.trim().startsWith("/")) {
          return "A URL starts with a slash, such as /pricing.";
        }
      }
      const claimed = routeClaimant(creation, taken);
      if (claimed !== null) {
        return `${claimed} already opens at ${creation.route ?? "/"}.`;
      }
      break;
    }
    case "component": {
      const tag = creation.tag ?? "";
      const problem = customElementNameProblem(tag);
      if (problem !== "") {
        return problem;
      }
      if (ctx.componentTags.includes(tag)) {
        return `A component named <${tag}> already exists.`;
      }
      if (options.startFrom === START_SELECTION && ctx.hasSelection !== true) {
        return "Select an element on the canvas to make a component from it.";
      }
      if (
        options.startFrom === START_COPY &&
        (options.copyOf === undefined || ctx.componentDocs?.get(options.copyOf) === undefined)
      ) {
        return "Choose the component to copy.";
      }
      break;
    }
    case "collection": {
      const slug = creation.config?.name ?? "";
      if (ctx.declaredContent.includes(slug)) {
        return `A collection named “${slug}” already exists.`;
      }
      if (taken("content")?.has(slug) === true) {
        return `content/${slug}/ already exists.`;
      }
      break;
    }
    case "entry": {
      const collection = ctx.collections.find((c) => c.name === options.collection);
      if (!collection) {
        return "Choose the collection this entry belongs to.";
      }
      if (collection.dir.includes("{locale}")) {
        return (
          `“${collection.name}” is a localized collection. Open the folder for the language you ` +
          "are writing in and create the entry there."
        );
      }
      break;
    }
    default: {
      break;
    }
  }
  const paths = [
    ...(creation.kind === "collection" ? [] : [creation.path]),
    ...creation.extraWrites.map((write) => write.path),
  ];
  for (const path of paths) {
    const problem = fileProblem(path, taken);
    if (problem !== "") {
      return problem;
    }
  }
  return "";
}

/** Every directory a creation's refusal reads, so the flow lists exactly those. */
export function directoriesToList(creation: Creation): string[] {
  const dirs = new Set<string>();
  const add = (path: string) => {
    const slash = path.lastIndexOf("/");
    dirs.add(slash === -1 ? "." : path.slice(0, slash));
  };
  if (creation.kind === "media") {
    return [];
  }
  if (creation.kind === "collection") {
    dirs.add("content");
  } else if (creation.fileName !== "") {
    add(creation.path);
  }
  for (const write of creation.extraWrites) {
    add(write.path);
  }
  for (const { dir } of routeNeighbours(creation)) {
    dirs.add(dir);
  }
  return [...dirs];
}
