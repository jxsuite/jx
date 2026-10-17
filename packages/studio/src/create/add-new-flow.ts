/// <reference lib="dom" />
/**
 * Add new, as a flow: read the project, open the dialog, keep the answer, write it, open it.
 *
 * `specs/studio.md` §9.1.1. The derivation is `create/add-new.ts`'s and the markup is
 * `surfaces/add-new.json`'s; this module is everything between them that touches the app — the
 * {@link CreationContext} read off the stores, the directory listings the refusals need, the writes
 * through the one file writer (`files/files.ts` `writeNewFile`) and the configuration chokepoint
 * (`tabs/project-config.ts`), and what each kind opens afterwards.
 *
 * Two entry points, one write path. {@link openAddNew} is the dialog (`file.new` with no name, the
 * Site panel's **+**, the Content home's **New**); {@link createDirect} is the same derivation,
 * refusal and write with no dialog at all (`file.new` with a kind and a name — the assistant's way
 * in, and a script's). Both end in {@link perform}, so a page made by a person and a page made by
 * the assistant are the same bytes.
 *
 * @docs studio/projects/pages-layouts-components
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { serializeJson } from "@jxsuite/schema/json-layout";
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { getPlatform } from "../platform";
import { projectState } from "../store";
import { notify } from "../services/notify";
import { layerHost } from "../ui/layers";
import { activeRegistry } from "../commands/active-registry";
import { runActiveReported } from "../commands/run-reported";
import {
  defaultContentFormat,
  formatByExtension,
  formatSerialize,
  loadFormats,
} from "../format/format-host";
import { creationFormats } from "../format/format-choices";
import { collectionNames, entryCollections } from "../content/entry-model";
import { componentRegistry, noteComponentSaved } from "../files/components";
import { listTakenNames, openFileInTab, writeNewFile } from "../files/files";
import { slugify } from "../files/new-file-name";
import { DEFAULT_MEDIA_DIR, uploadAccept, uploadAssets } from "../files/media-upload";
import { commitProjectConfig } from "../tabs/project-config";
import { convertibleSelection, convertSelectionToComponent } from "../editor/convert-to-component";
import { invalidateLayoutPickerCache, listLayoutEntries } from "../panels/head-panel";
import { invalidateReferenceEntries } from "../ui/form-controls";
import { openEntry } from "../content/entry-open";
import { invalidateCollectionPages } from "../content/collection-pages";
import { entryFormatName } from "../content/entry-commands";
import { invalidateSiteIndex } from "../panels/site-panel";
import { invalidateLibrary } from "../browse/library-pane";
import { openAddNewSurface } from "../surfaces/add-new";
import {
  collectionPageBody,
  creationProblem,
  defaultTemplateChoice,
  deriveCreation,
  directoriesToList,
  DEFAULT_FIELD_PRESETS,
  FIELD_PRESET_INFO,
  FIELD_PRESETS,
  itemNoun,
  CREATION_KINDS,
  KIND_INFO,
  layoutValueFor,
  normalizeLayoutPath,
  schemaPresets,
  START_ARTICLE,
  START_BLANK,
  START_COPY,
  START_SELECTION,
} from "./add-new";
import type {
  CollectionChoice,
  Creation,
  CreationBody,
  CreationContext,
  CreationKind,
  CreationOptions,
  FieldPreset,
  LayoutChoice,
  WritingFormat,
} from "./add-new";
import type {
  AddNewChoiceRow,
  AddNewKindRow,
  AddNewSurfaceHandle,
  AddNewView,
} from "../surfaces/add-new";
import type { JsonObject, JxMutableNode } from "@jxsuite/schema/types";

/** The `source` every Problem this flow files carries. */
const SOURCE = "Add new";

/** What one creation produced, for the command's report and for a caller that opens it. */
export interface AddNewResult {
  kind: CreationKind;
  /** The main file, or the upload directory for Media. */
  path: string;
  /** Every path written, `project.json` included for a collection. */
  wrote: string[];
  route?: string;
  /** A component's custom element name. */
  tag?: string;
}

/** What `file.new` and the dialog's openers ask for. Every field is optional. */
export interface AddNewRequest {
  kind?: CreationKind | undefined;
  name?: string | undefined;
  collection?: string | undefined;
  /** A layout (path, `layouts/x.json` or the stem `x`), `article`, or `blank`. */
  template?: string | undefined;
}

// ─── Reading the project ─────────────────────────────────────────────────────

/**
 * The project's layouts, listed once per dialog through the Page panel's own listing
 * (`panels/head-panel.ts` {@link listLayoutEntries}), so both pickers name the same templates and
 * one invalidation forgets both.
 */
async function readLayouts(): Promise<LayoutChoice[]> {
  const entries = await listLayoutEntries();
  return entries
    .map((entry) => ({ name: entry.name, ref: entry.path }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/** The first page format that writes prose: what an Article page is saved in. */
function articleFormat(): WritingFormat | null {
  for (const row of creationFormats("page")) {
    if (row.ext === ".json") {
      continue;
    }
    const format = formatByExtension(row.ext, "serialize");
    if (format) {
      return { ext: row.ext, name: format.name };
    }
  }
  return null;
}

/** The format a new collection's entries are written in, or `null` for native JSON. */
function contentWritingFormat(): WritingFormat | null {
  const format = defaultContentFormat();
  const ext = format?.extensions[0];
  return format && ext ? { ext, name: format.name } : null;
}

/** Everything the derivation reads about the project, read now. */
export async function readCreationContext(): Promise<CreationContext> {
  await loadFormats().catch(() => {
    /* An unreachable format registry leaves JSON, which is the one shape that needs none. */
  });
  const collections: CollectionChoice[] = entryCollections().map((collection) => ({
    dir: collection.dir,
    ext: collection.ext,
    formatName: entryFormatName(collection),
    name: collection.name,
    schema: collection.schema,
  }));
  return {
    article: articleFormat(),
    collections,
    componentTags: componentRegistry.map((component) => component.tagName),
    copyableTags: componentRegistry
      .filter((component) => isCopyable(component))
      .map((component) => component.tagName),
    contentFormat: contentWritingFormat(),
    declaredContent: collectionNames(),
    defaultLayout: projectState?.projectConfig?.defaults?.layout ?? null,
    hasSelection: convertibleSelection() !== null,
    layouts: await readLayouts(),
  };
}

/** Whether a copy can be made of a registered component: a JSON definition the project owns. */
function isCopyable(component: (typeof componentRegistry)[number]): boolean {
  const { path } = component;
  return isString(path) && component.source !== "npm" && path.endsWith(".json");
}

/** Project component definitions a copy can be made of: JSON files the project owns. */
async function readComponentDocs(): Promise<Map<string, JxMutableNode>> {
  const docs = new Map<string, JxMutableNode>();
  for (const component of componentRegistry) {
    const { path } = component;
    if (!isCopyable(component) || !isString(path)) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(await getPlatform().readFile(path));
      if (isJsonObject(parsed)) {
        /* SAFETY: a component definition is a JSON object whose root is the component's element,
           which is a JxMutableNode by the document model's own definition. */
        docs.set(component.tagName, parsed as JxMutableNode);
      }
    } catch {
      // A definition that cannot be read is not offered to copy; the registry still lists it.
    }
  }
  return docs;
}

// ─── Arguments ───────────────────────────────────────────────────────────────

/** A `template` argument, resolved against the project's layouts; `null` when it names none. */
export function resolveTemplateArg(value: string, layouts: readonly LayoutChoice[]): string | null {
  const wanted = value.trim();
  if (wanted === START_BLANK || wanted === "none" || wanted === "") {
    return START_BLANK;
  }
  if (wanted === START_ARTICLE) {
    return START_ARTICLE;
  }
  const normalized = normalizeLayoutPath(wanted);
  const match = layouts.find(
    (layout) =>
      normalizeLayoutPath(layout.ref) === normalized ||
      normalizeLayoutPath(layout.ref) === `layouts/${normalized}` ||
      normalizeLayoutPath(layout.ref) === `layouts/${normalized}.json` ||
      layout.name.toLowerCase() === wanted.toLowerCase(),
  );
  return match?.ref ?? null;
}

/** The options a request implies for its kind. */
function optionsForRequest(request: AddNewRequest, ctx: CreationContext): CreationOptions {
  const options: CreationOptions = {};
  if (request.collection !== undefined) {
    options.collection = request.collection;
  }
  if (request.template !== undefined) {
    const resolved = resolveTemplateArg(request.template, ctx.layouts);
    if (resolved === null) {
      const names = ctx.layouts.map((layout) => normalizeLayoutPath(layout.ref));
      throw new RangeError(
        `command "file.new" argument "template": "${request.template}" names no template — ` +
          `declared: ${[START_BLANK, START_ARTICLE, ...names].join(", ")}`,
      );
    }
    if (request.kind === "collection") {
      options.pageTemplate = resolved === START_ARTICLE ? START_BLANK : resolved;
    } else if (request.kind === "template") {
      options.startFrom = resolved === START_BLANK || resolved === START_ARTICLE ? "" : resolved;
    } else {
      options.startFrom = resolved;
    }
  }
  return options;
}

// ─── Writing ─────────────────────────────────────────────────────────────────

/** A body's bytes: native JSON through the save serializer, anything else through its format. */
async function serializeBody(body: CreationBody): Promise<string> {
  if (body.format === null) {
    return serializeJson(body.doc, null);
  }
  /* SAFETY: a creation body is a document the derivation built — an element-shaped object, which is
     what a format's serializer reads. */
  return formatSerialize(body.format, body.doc as JxMutableNode, {
    frontmatter: body.frontmatter ?? true,
    mode: "roundtrip",
  });
}

/** List every directory a creation would write into, so its refusal is judged against disk. */
async function listFor(creation: Creation, taken: Map<string, Set<string>>, fresh = false) {
  await Promise.all(
    directoriesToList(creation).map(async (dir) => {
      if (fresh || !taken.has(dir)) {
        taken.set(dir, await listTakenNames(dir));
      }
    }),
  );
}

/** Tell everything that lists files that some just appeared. */
function announce(paths: readonly string[]): void {
  invalidateSiteIndex(paths);
  invalidateLibrary();
  if (paths.some((path) => path.startsWith("pages/"))) {
    invalidateCollectionPages();
  }
}

/** One file of a creation, written; throws the reason it could not be. */
async function writeOne(path: string, body: CreationBody, quiet: boolean): Promise<void> {
  let text: string;
  try {
    text = await serializeBody(body);
  } catch (error) {
    notify.error(`Could not prepare ${path}.`, {
      detail: errorMessage(error),
      path,
      source: SOURCE,
    });
    throw new Error(`could not prepare ${path}`, { cause: error });
  }
  if ((await writeNewFile(path, text, { quiet, source: SOURCE })) === null) {
    throw new Error(`could not write ${path}`);
  }
}

/** Add a collection's `project.json` entry, then its first entry and its own page. */
async function performCollection(creation: Creation): Promise<AddNewResult | null> {
  const config = creation.config!;
  const existing = projectState?.projectConfig?.content;
  const content: JsonObject = isJsonObject(existing) ? { ...existing } : {};
  content[config.name] = config.entry;
  const committed = await commitProjectConfig({ content });
  if (!committed.ok) {
    return null;
  }
  const wrote = ["project.json"];
  const missed: string[] = [];
  for (const write of [{ body: creation.content, path: creation.path }, ...creation.extraWrites]) {
    try {
      await writeOne(write.path, write.body, true);
      wrote.push(write.path);
    } catch {
      // Already a Problem naming its path; what was written stays written, and the toast says so.
      missed.push(write.path);
    }
  }
  if (missed.length === 0) {
    notify.success(`Created the ${config.name} collection`);
  } else {
    notify.warn(
      `Created the ${config.name} collection, but ${missed.join(" and ")} could not be written.`,
      { source: SOURCE },
    );
  }
  announce(wrote);
  invalidateReferenceEntries(config.name);
  // Then: the Content workspace, showing the collection just made (§9.1.1).
  void runActiveReported("content.showCollection", { collection: config.name }, SOURCE);
  const result: AddNewResult = { kind: "collection", path: `content/${config.name}`, wrote };
  if (creation.route !== undefined) {
    result.route = creation.route;
  }
  return result;
}

/**
 * Write a creation and open what it made. The refusal has already been judged.
 *
 * @returns What was written, or `null` when a write failed (already reported).
 */
async function perform(
  creation: Creation,
  options: CreationOptions,
  files: readonly File[],
): Promise<AddNewResult | null> {
  if (creation.kind === "media") {
    // Only what the Media workspace lists: the browse that follows selects the first file by path.
    const uploaded = await uploadAssets(files, { dir: DEFAULT_MEDIA_DIR, only: "media" });
    if (uploaded.length === 0) {
      return null;
    }
    const wrote = uploaded.map((asset) => asset.path);
    announce(wrote);
    // Then: the Media workspace, with what arrived selected so its detail pane describes it (§9.1.1).
    void runActiveReported("media.browse", { select: uploaded[0]!.path }, SOURCE);
    return { kind: "media", path: DEFAULT_MEDIA_DIR, wrote };
  }
  if (creation.kind === "collection") {
    return performCollection(creation);
  }
  const result: AddNewResult = { kind: creation.kind, path: creation.path, wrote: [creation.path] };
  if (creation.route !== undefined) {
    result.route = creation.route;
  }
  if (creation.tag !== undefined) {
    result.tag = creation.tag;
  }

  if (creation.kind === "component" && options.startFrom === START_SELECTION) {
    // The transaction first, the file only if the document took the reference (§9.1.1).
    const written = await convertSelectionToComponent(creation.tag!);
    if (written === null) {
      return null;
    }
    announce([written]);
    await openFileInTab(written);
    return result;
  }

  try {
    await writeOne(creation.path, creation.content, false);
  } catch {
    return null;
  }
  announce([creation.path]);
  switch (creation.kind) {
    case "component": {
      /* SAFETY: a component body is the element the derivation built, which is the document the
         registry's extractor reads. */
      noteComponentSaved(creation.path, creation.content.doc as JxMutableNode);
      await openFileInTab(creation.path);
      break;
    }
    case "template": {
      invalidateLayoutPickerCache();
      await openFileInTab(creation.path);
      break;
    }
    case "entry": {
      if (options.collection !== undefined) {
        invalidateReferenceEntries(options.collection);
      }
      await openEntry(creation.path);
      break;
    }
    default: {
      await openFileInTab(creation.path);
    }
  }
  return result;
}

// ─── Without the dialog ──────────────────────────────────────────────────────

/**
 * Create one thing from a kind and a name, with no dialog — `file.new { kind, name }`.
 *
 * Refuses by THROWING (`studio-ui-guidelines.md` §12.4): every refusal the dialog would print under
 * its field is a `RangeError` here, with the same sentence. Media is refused, because an upload
 * needs files and an argument cannot carry one.
 */
export async function createDirect(
  request: AddNewRequest & { name: string },
): Promise<AddNewResult> {
  const kind = request.kind ?? "page";
  if (kind === "media") {
    throw new RangeError(
      'command "file.new": Media is uploaded, not named; run file.new { kind: "media" } with no ' +
        "name to open the upload drop zone.",
    );
  }
  const ctx = await readCreationContext();
  const options = optionsForRequest({ ...request, kind }, ctx);
  if (kind === "entry" && options.collection === undefined && ctx.collections.length === 1) {
    options.collection = ctx.collections[0]!.name;
  }
  const creation = deriveCreation(kind, request.name, options, ctx);
  const taken = new Map<string, Set<string>>();
  await listFor(creation, taken, true);
  const problem = creationProblem(creation, request.name, options, ctx, (dir) => taken.get(dir));
  if (problem !== "") {
    throw new RangeError(`command "file.new": ${problem}`);
  }
  const result = await perform(creation, options, []);
  if (result === null) {
    throw new Error(`file.new could not create ${creation.path}; the reason is in Problems.`);
  }
  return result;
}

// ─── A page for an existing collection ───────────────────────────────────────

/**
 * Give an existing collection a page of its own: `pages/<name>/[slug].json`, written exactly as Add
 * new writes it for a new collection with **Give each item its own page** on (the blog starter's
 * shape, bound to whichever of title, image and body the collection has, in the default template).
 * The Content home's **Add one** (`specs/studio.md` §22.5).
 *
 * @returns The page's path, or `null` when it was refused or could not be written (said already).
 */
export async function addCollectionPage(name: string): Promise<string | null> {
  const ctx = await readCreationContext();
  const collection = ctx.collections.find((choice) => choice.name === name);
  if (!collection) {
    notify.error(`"${name}" is not a collection this project declares.`, { source: SOURCE });
    return null;
  }
  const dir = `pages/${slugify(name) || name}`;
  const path = `${dir}/[slug].json`;
  const taken = await listTakenNames(dir);
  if (taken.has("[slug].json")) {
    notify.error(`${path} already exists.`, {
      detail: "Open it in Design and point its $paths at this collection, or rename it first.",
      path,
      source: SOURCE,
    });
    return null;
  }
  const fields = schemaPresets(collection.schema, collection.formatName !== null);
  const doc = collectionPageBody(
    name,
    fields,
    layoutValueFor(defaultTemplateChoice(ctx), ctx),
    ctx,
  );
  try {
    await writeOne(path, { doc, format: null }, false);
  } catch {
    return null;
  }
  announce([path]);
  return path;
}

// ─── The dialog ──────────────────────────────────────────────────────────────

/** What the reader has chosen so far, per kind, so switching kinds does not lose an answer. */
interface DialogState {
  kind: CreationKind;
  name: string;
  /** The reader has typed: refusals are said from now on, not before. */
  touched: boolean;
  url: string;
  editingUrl: boolean;
  pageStart: string;
  wrap: string;
  componentStart: string;
  copyOf: string;
  fields: FieldPreset[];
  ownPage: boolean;
  pageTemplate: string;
  collection: string;
  files: File[];
  dropActive: boolean;
  busy: boolean;
}

/** The options the derivation reads for the chosen kind. */
function optionsOf(state: DialogState): CreationOptions {
  switch (state.kind) {
    case "page": {
      const options: CreationOptions = { startFrom: state.pageStart };
      if (state.editingUrl) {
        options.url = state.url;
      }
      return options;
    }
    case "template": {
      return { startFrom: state.wrap };
    }
    case "component": {
      const options: CreationOptions = { startFrom: state.componentStart };
      if (state.componentStart === START_COPY && state.copyOf !== "") {
        options.copyOf = state.copyOf;
      }
      return options;
    }
    case "collection": {
      return { fields: state.fields, ownPage: state.ownPage, pageTemplate: state.pageTemplate };
    }
    case "entry": {
      return state.collection === "" ? {} : { collection: state.collection };
    }
    default: {
      return { files: state.files.length };
    }
  }
}

/** A card row. */
function card(
  value: string,
  label: string,
  note: string,
  chosen: string,
  reason = "",
): AddNewChoiceRow {
  return {
    checked: value === chosen ? "true" : "false",
    disabled: reason !== "",
    label,
    note,
    reason,
    value,
  };
}

/**
 * The template cards for a page: every layout, then Article when the project writes prose, then
 * Blank.
 */
function startChoices(state: DialogState, ctx: CreationContext): AddNewChoiceRow[] {
  const rows = ctx.layouts.map((layout) =>
    card(
      layout.ref,
      layout.name,
      ctx.defaultLayout !== null &&
        normalizeLayoutPath(layout.ref) === normalizeLayoutPath(ctx.defaultLayout)
        ? "the site's default"
        : "a template",
      state.pageStart,
    ),
  );
  if (ctx.article !== null) {
    rows.push(card(START_ARTICLE, "Article", "mostly writing", state.pageStart));
  }
  rows.push(card(START_BLANK, "Blank", "no template", state.pageStart));
  return rows;
}

/** How many elements the canvas selection lifts out, said on its card. */
function selectionNote(): string {
  const subject = convertibleSelection();
  if (!subject) {
    return "nothing selected";
  }
  const children = Array.isArray(subject.node.children) ? subject.node.children.length : 0;
  const count = 1 + children;
  return count === 1 ? "1 element" : `${count} elements`;
}

/** The chords `file.new` answers to, as this platform prints them. */
function chordNote(): string {
  const keymap = activeRegistry()?.keymap;
  const chords = keymap?.bindingsFor("file.new") ?? [];
  if (!keymap || chords.length === 0) {
    return "";
  }
  const [first, ...rest] = chords.map((chord) => keymap.format(chord));
  /* The first chord is `⌘N`, which only the desktop app is handed: a browser keeps it for a new
     window. Every other chord is delivered everywhere (add-new-commands.ts). */
  return rest.length === 0
    ? `${first} opens this anywhere.`
    : `${first} opens this in the desktop app, ${rest.join(" or ")} anywhere.`;
}

/** The view the surface draws, from the state, the context and the derived result. */
function viewOf(
  state: DialogState,
  ctx: CreationContext,
  creation: Creation,
  problem: string,
): AddNewView {
  const info = KIND_INFO[state.kind];
  const kinds = CREATION_KINDS.filter((id) => id !== "entry" || ctx.collections.length > 0).map(
    (id): AddNewKindRow => ({
      checked: id === state.kind ? "true" : "false",
      hint: KIND_INFO[id].hint,
      icon: KIND_INFO[id].icon,
      id,
      label: KIND_INFO[id].label,
    }),
  );
  const slug = creation.config?.name ?? "";
  const item = itemNoun(slug === "" ? "items" : slug);
  const layoutOptions = [
    ...ctx.layouts.map((layout) => ({ label: layout.name, value: layout.ref })),
    { label: "No template", value: START_BLANK },
  ];
  return {
    canConfirm: problem === "" && !state.busy,
    chordNote: chordNote(),
    collection: state.collection,
    collectionOptions: ctx.collections.map((c) => ({ label: c.name, value: c.name })),
    componentChoices: [
      card("blank", "Blank", "an empty block", state.componentStart),
      card(
        START_SELECTION,
        "Current selection",
        selectionNote(),
        state.componentStart,
        ctx.hasSelection === true ? "" : "Select an element on the canvas first.",
      ),
      card(
        START_COPY,
        "Copy of…",
        "an existing one",
        state.componentStart,
        (ctx.copyableTags ?? []).length > 0
          ? ""
          : "This project has no components of its own to copy yet.",
      ),
    ],
    copyOf: state.copyOf,
    copyOptions: [...(ctx.componentDocs?.keys() ?? [])].map((tag) => ({
      label: `<${tag}>`,
      value: tag,
    })),
    copying: state.componentStart === START_COPY,
    cta: info.cta,
    dropActive: state.dropActive ? "true" : "false",
    editingUrl: state.editingUrl,
    error: state.touched || state.kind === "media" ? (state.kind === "media" ? "" : problem) : "",
    fileSummary: state.files.length === 0 ? "" : state.files.map((file) => file.name).join(", "),
    itemNoun: item,
    kind: state.kind,
    kindHint: info.hint,
    kindLabel: info.label,
    kinds,
    name: state.name,
    nameLabel: info.nameLabel,
    ownPage: state.ownPage,
    pageTemplate: state.pageTemplate,
    pattern: creation.route ?? `/${slug === "" ? "items" : slug}/:slug`,
    placeholder: info.placeholder,
    presets: FIELD_PRESETS.filter(
      (preset) => preset !== "richText" || ctx.contentFormat !== null,
    ).map((preset) => {
      const selected = state.fields.includes(preset);
      return {
        icon: selected ? "check" : "plus",
        id: preset,
        label: FIELD_PRESET_INFO[preset].label,
        selected,
      };
    }),
    route: creation.route === undefined || creation.route === "" ? "/" : creation.route,
    saved: creation.saved,
    startChoices: startChoices(state, ctx),
    templateOptions: layoutOptions,
    uploadAccept: uploadAccept(),
    url: state.url,
    wrapChoices: [
      ...ctx.layouts.map((layout) =>
        card(layout.ref, layout.name, "keeps its frame around this one", state.wrap),
      ),
      card("", "Nothing", "a fresh frame", state.wrap),
    ],
  };
}

/** The kind a dialog opens on: the request's, else Page. Entry needs a collection to exist. */
function initialKind(request: AddNewRequest, ctx: CreationContext): CreationKind {
  const kind = request.kind ?? "page";
  return kind === "entry" && ctx.collections.length === 0 ? "page" : kind;
}

/** The dialog that is showing, if one is: its handle once mounted, and what it resolves with. */
interface OpenDialog {
  handle: AddNewSurfaceHandle | null;
  done: Promise<AddNewResult | null>;
}

let _open: OpenDialog | null = null;

/**
 * Open Add new, and resolve with what it created, or `null` when it was dismissed.
 *
 * A second open while one is showing re-uses it: the dialog is modal, so a second request can only
 * come from a chord or a script, and stacking two would leave the first with no way out.
 */
export function openAddNew(request: AddNewRequest = {}): Promise<AddNewResult | null> {
  if (_open) {
    return _open.done;
  }
  let resolveDone!: (result: AddNewResult | null) => void;
  const done = new Promise<AddNewResult | null>((resolve) => {
    resolveDone = resolve;
  });
  const open: OpenDialog = { done, handle: null };
  _open = open;
  void start(request, resolveDone, open);
  return done;
}

/** The dialog's whole life: read the project, mount, answer events until it closes. */
async function start(
  request: AddNewRequest,
  resolveDone: (result: AddNewResult | null) => void,
  slot: OpenDialog,
): Promise<void> {
  const ctx = await readCreationContext();
  const taken = new Map<string, Set<string>>();
  const state: DialogState = {
    busy: false,
    collection: request.collection ?? ctx.collections[0]?.name ?? "",
    // Blank even with a selection: converting edits the open page, so it is chosen, never assumed.
    componentStart: "blank",
    copyOf: "",
    dropActive: false,
    editingUrl: false,
    fields: [...DEFAULT_FIELD_PRESETS],
    files: [],
    kind: initialKind(request, ctx),
    name: request.name ?? "",
    ownPage: true,
    pageStart: defaultTemplateChoice(ctx),
    pageTemplate: defaultTemplateChoice(ctx),
    touched: (request.name ?? "") !== "",
    url: "",
    // The site's frame, as the board shows it: a layout nests inside a layout.
    wrap: defaultTemplateChoice(ctx) === START_BLANK ? "" : defaultTemplateChoice(ctx),
  };
  if (request.template !== undefined) {
    const resolved = resolveTemplateArg(request.template, ctx.layouts);
    if (resolved !== null) {
      state.pageStart = resolved;
      state.pageTemplate = resolved === START_ARTICLE ? START_BLANK : resolved;
      state.wrap = resolved === START_BLANK || resolved === START_ARTICLE ? "" : resolved;
    }
  }
  if (ctx.contentFormat === null) {
    // Rich text is a body, and a JSON collection has none: do not start with a chip it cannot honour.
    state.fields = state.fields.filter((f) => f !== "richText");
  }

  let finished = false;
  let result: AddNewResult | null = null;

  const derive = () => deriveCreation(state.kind, state.name, optionsOf(state), ctx);
  const judge = (creation: Creation) =>
    creationProblem(creation, state.name, optionsOf(state), ctx, (dir) => taken.get(dir));
  const render = () => {
    const creation = derive();
    slot.handle?.update(viewOf(state, ctx, creation, judge(creation)));
    // A destination nobody has listed yet is listed now, and judged again when it lands.
    if (directoriesToList(creation).some((dir) => !taken.has(dir))) {
      void listFor(creation, taken).then(() => {
        if (!finished) {
          const again = derive();
          slot.handle?.update(viewOf(state, ctx, again, judge(again)));
        }
      });
    }
  };
  const change = (mutate: () => void) => {
    mutate();
    render();
  };

  const confirm = async () => {
    if (state.busy) {
      return;
    }
    state.touched = true;
    const creation = derive();
    await listFor(creation, taken, true);
    const problem = judge(creation);
    if (problem !== "") {
      render();
      return;
    }
    state.busy = true;
    render();
    try {
      result = await perform(creation, optionsOf(state), state.files);
    } catch (error) {
      notify.error("Could not create it.", { detail: errorMessage(error), source: SOURCE });
      result = null;
    }
    state.busy = false;
    if (result === null) {
      render();
      return;
    }
    slot.handle?.close();
  };

  const first = derive();
  const handle = openAddNewSurface({
    actions: {
      choose: (input) => {
        const chosen = [...(input.files ?? [])];
        input.value = "";
        change(() => {
          state.files = [...state.files, ...chosen];
        });
      },
      closed: () => {
        if (finished) {
          return;
        }
        finished = true;
        _open = null;
        // Dismissed by the platform (Cancel, Escape): take the slot down too. Idempotent.
        slot.handle?.close();
        resolveDone(result);
      },
      confirm: () => {
        void confirm();
      },
      dragOut: () => {
        change(() => {
          state.dropActive = false;
        });
      },
      dragOver: () => {
        if (!state.dropActive) {
          change(() => {
            state.dropActive = true;
          });
        }
      },
      drop: (files) => {
        change(() => {
          state.dropActive = false;
          const dropped = files ? [...files] : [];
          if (dropped.length > 0) {
            // A file dropped anywhere on the dialog is an upload, whatever kind was showing.
            state.kind = "media";
          }
          state.files = [...state.files, ...dropped];
        });
      },
      pickCollection: (value) => {
        change(() => {
          state.collection = value;
        });
      },
      pickComponentStart: (value) => {
        change(() => {
          state.componentStart = value;
        });
        if (value === START_COPY && ctx.componentDocs === undefined) {
          void readComponentDocs().then((docs) => {
            ctx.componentDocs = docs;
            if (state.copyOf === "") {
              state.copyOf = docs.keys().next().value ?? "";
            }
            if (!finished) {
              render();
            }
          });
        }
      },
      pickCopy: (value) => {
        change(() => {
          state.copyOf = value;
        });
      },
      pickKind: (kind) => {
        change(() => {
          state.kind = kind;
        });
      },
      pickPageTemplate: (value) => {
        change(() => {
          state.pageTemplate = value;
        });
      },
      pickStart: (value) => {
        change(() => {
          state.pageStart = value;
        });
      },
      pickWrap: (value) => {
        change(() => {
          state.wrap = value;
        });
      },
      setName: (value) => {
        change(() => {
          state.name = value;
          state.touched = true;
        });
      },
      setOwnPage: (checked) => {
        change(() => {
          state.ownPage = checked;
        });
      },
      setUrl: (value) => {
        change(() => {
          state.url = value;
          state.touched = true;
        });
      },
      toggleUrl: () => {
        change(() => {
          if (!state.editingUrl) {
            state.url = derive().route ?? "/";
          }
          state.editingUrl = !state.editingUrl;
        });
      },
      togglePreset: (id) => {
        change(() => {
          const preset = FIELD_PRESETS.find((p) => p === id);
          if (preset === undefined) {
            return;
          }
          state.fields = state.fields.includes(preset)
            ? state.fields.filter((f) => f !== preset)
            : [...state.fields, preset];
        });
      },
    },
    layer: layerHost("dialog"),
    view: viewOf(state, ctx, first, judge(first)),
  });
  slot.handle = handle;
  render();
}
