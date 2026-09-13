/// <reference lib="dom" />
/**
 * The Site head settings section: the project-level Google Fonts, and the raw `$head` tags every
 * page emits.
 *
 * The adapter owns the decisions — which field set an entry needs, when a write reaches disk, what
 * "remove this font" also has to remove — and `settings-head.json` draws them. That is the whole
 * shape of the conversion this replaced: `settings/head-editor.ts` built its markup from the
 * `$head` array on every pass and re-entered itself (`renderHeadEditor(container)`) after each
 * structural edit, so adding one entry rebuilt every field in the section. The rows are a
 * projection now, keyed per entry, so an added tag appears and nothing else is touched.
 *
 * **The `$head` array is edited in place, and that is the contract, not an implementation detail.**
 * `projectState.projectConfig.$head` is the array the rest of Studio reads; a copy would be a
 * second source of truth that the next `commitProjectConfig` would overwrite. So every mutation
 * here is `push`/`splice` on that same array, followed by the one commit call.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { projectState } from "../store";
import { updateSiteConfig } from "../site-context";
import {
  buildGoogleFontUrl,
  cleanupGoogleFontPreconnects,
  ensureGoogleFontPreconnects,
  extractFontFamily,
  isGoogleFontEntry,
} from "../utils/google-fonts";
import { mountSurface, registerSurface } from "../ui/surface";
import headDoc from "./settings-head.json";
import type { JxDocument, JxHeadEntry, ProjectConfig } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("settings-head", headDoc as unknown as JxDocument);

/**
 * How long a keystroke waits before it is written.
 *
 * Every field commit is a `project.json` write, and the two body fields commit on `input` — one
 * write per keystroke without this. The lit editor debounced per ENTRY, with one timer shared by
 * that entry's fields, so editing `rel` and then `href` inside the window cancelled the first write
 * outright; the timers are per field here, which is why each edit lands.
 */
const EDIT_DEBOUNCE_MS = 300;

/** One `$head` entry as the document draws it: which fields, and what is in them. */
interface HeadRow extends Record<string, unknown> {
  id: string;
  /** The tag name, drawn as `<link>` and named in the delete button. */
  tag: string;
  /**
   * Which field set to draw. `script-inline` is a script with no `src` — the one entry kind whose
   * shape depends on a value rather than on its tag.
   */
  kind: "link" | "meta" | "script" | "script-inline" | "style" | "none";
  rel: string;
  href: string;
  name: string;
  content: string;
  src: string;
  body: string;
}

/** One Google Fonts stylesheet link, by the family it loads. */
interface FontRow extends Record<string, unknown> {
  id: string;
  family: string;
}

/** One of the four tags the section can add, and the button that adds it. */
interface AddTag extends Record<string, unknown> {
  tag: string;
  label: string;
}

interface HeadScope extends Record<string, unknown> {
  rows: HeadRow[];
  fonts: FontRow[];
  /**
   * Whether to draw the font list or the empty line, as a `$switch` discriminant. Two states, not a
   * length test: the document says "No fonts imported." rather than drawing an empty box.
   */
  fontsState: "empty" | "listed";
  /** What is in the family field. The document reads it back, so clearing it is an assignment. */
  fontDraft: string;
  tags: AddTag[];
  add: (tag: string) => void;
  remove: (id: string) => void;
  edit: (id: string, key: string, value: string) => void;
  draftFont: (value: string) => void;
  addFont: () => void;
  removeFont: (id: string) => void;
}

const ADD_TAGS: AddTag[] = [
  { label: "+ Link", tag: "link" },
  { label: "+ Meta", tag: "meta" },
  { label: "+ Script", tag: "script" },
  { label: "+ Style", tag: "style" },
];

// ─── The entries, and the identity a row is keyed by ──────────────────────────

/**
 * A stable id per entry OBJECT, so the repeater can key on it.
 *
 * A `$head` entry carries nothing unique — two `<meta>` tags may be identical until they are filled
 * in — and keying on the index would rebuild every row below a deletion, taking the caret out of
 * whatever was being typed. A `WeakMap` gives each object one id for as long as it exists and
 * forgets it with the entry.
 */
const ids = new WeakMap<JxHeadEntry, string>();
let minted = 0;

function idOf(entry: JxHeadEntry): string {
  let id = ids.get(entry);
  if (id === undefined) {
    minted += 1;
    id = `head-${minted}`;
    ids.set(entry, id);
  }
  return id;
}

/** The config object the entries last came from, so a project switch does not inherit them. */
let _config: ProjectConfig | null = null;
/** The `$head` array being edited. */
let _entries: JxHeadEntry[] = [];

/**
 * The `$head` array this section edits — the project's own whenever it declares one.
 *
 * A project with no `$head` yet is the case worth stating: the array is held here until the first
 * commit lands one on the config, because the write is asynchronous and re-reading the config in
 * between would answer "no entries" and lose the tag that was just added.
 */
function entries(): JxHeadEntry[] {
  const config = (projectState?.projectConfig ?? null) as ProjectConfig | null;
  if (config !== _config) {
    _config = config;
    _entries = [];
    /* The half-typed family goes with the project it was typed into. The section is a singleton —
       one scope for every project this window opens — so a draft nobody submitted would otherwise
       be sitting in the field of the NEXT project, and the Add button would take it. */
    if (_scope) {
      _scope.fontDraft = "";
    }
  }
  const declared = config?.$head;
  if (Array.isArray(declared)) {
    _entries = declared as JxHeadEntry[];
  }
  return _entries;
}

/** The entry a row id names, or `undefined` when it has since been removed. */
function entryFor(id: string): JxHeadEntry | undefined {
  return entries().find((entry) => ids.get(entry) === id);
}

/** A `$head` attribute as a field's text: anything that is not a string has none to show. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ─── The projection ───────────────────────────────────────────────────────────

/** One entry as the document draws it. */
function row(entry: JxHeadEntry): HeadRow {
  const attributes = entry.attributes ?? {};
  const src = text(attributes["src"]);
  const tag = String(entry.tagName ?? "");
  const kinds: Record<string, HeadRow["kind"]> = {
    link: "link",
    meta: "meta",
    script: src === "" ? "script-inline" : "script",
    style: "style",
  };
  return {
    body: text(entry.textContent),
    content: text(attributes["content"]),
    href: text(attributes["href"]),
    id: idOf(entry),
    kind: kinds[tag] ?? "none",
    name: text(attributes["name"]),
    rel: text(attributes["rel"]),
    src,
    tag,
  };
}

/** The section, as the document reads it, from the project config as it stands now. */
function project(): Pick<HeadScope, "rows" | "fonts" | "fontsState"> {
  const list = entries();
  const fonts = list.filter((entry) => isGoogleFontEntry(entry));
  return {
    fonts: fonts.map((entry) => ({
      family: extractFontFamily(text(entry.attributes?.["href"])),
      id: idOf(entry),
    })),
    fontsState: fonts.length === 0 ? "empty" : "listed",
    rows: list.map((entry) => row(entry)),
  };
}

// ─── Writing ──────────────────────────────────────────────────────────────────

/** Commit the whole `$head` array through the project-config chokepoint. */
function save(): void {
  void updateSiteConfig({ $head: entries() });
}

/** Field edits waiting out {@link EDIT_DEBOUNCE_MS}, one per field. */
const _pending = new Map<string, { commit: () => void; timer: ReturnType<typeof setTimeout> }>();

/**
 * Write every waiting edit now.
 *
 * Called before each structural change, and it is not housekeeping: a structural change recomputes
 * the rows, so an edit still in flight would be drawn back at its OLD value and then written at its
 * new one — the field and the file disagreeing, with the reader watching their typing revert.
 */
function flushEdits(): void {
  for (const pending of _pending.values()) {
    clearTimeout(pending.timer);
    pending.commit();
  }
  _pending.clear();
}

/** Put a value on the entry, choosing the attribute or the text body the way `$head` means it. */
function write(id: string, key: string, value: string): void {
  const entry = entryFor(id);
  if (!entry) {
    return;
  }
  if (key === "content" && (entry.tagName === "script" || entry.tagName === "style")) {
    entry.textContent = value;
  } else {
    entry.attributes ??= {};
    entry.attributes[key] = value;
  }
  save();
}

// ─── The scope ────────────────────────────────────────────────────────────────

let _scope: HeadScope | null = null;

/** Recompute the projection; the surface follows. */
function refresh(): void {
  Object.assign(state(), project());
}

/** The reactive scope the surface reads, made once. */
function state(): HeadScope {
  _scope ??= reactive<HeadScope>({
    add(tag: string) {
      flushEdits();
      const attributes: Record<string, string | boolean> = {};
      const entry: JxHeadEntry = { attributes, tagName: tag };
      if (tag === "link") {
        attributes["rel"] = "stylesheet";
        attributes["href"] = "";
      } else if (tag === "meta") {
        attributes["name"] = "";
        attributes["content"] = "";
      } else if (tag === "script") {
        attributes["src"] = "";
      } else if (tag === "style") {
        entry.textContent = "";
      }
      entries().push(entry);
      save();
      refresh();
    },
    addFont() {
      flushEdits();
      const family = state().fontDraft.trim();
      if (family === "") {
        return;
      }
      const list = entries();
      ensureGoogleFontPreconnects(list);
      list.push({
        attributes: { href: buildGoogleFontUrl(family), rel: "stylesheet" },
        tagName: "link",
      });
      state().fontDraft = "";
      save();
      refresh();
    },
    draftFont(value: string) {
      state().fontDraft = value;
    },
    edit(id: string, key: string, value: string) {
      const token = `${id}:${key}`;
      clearTimeout(_pending.get(token)?.timer);
      const commit = (): void => {
        _pending.delete(token);
        write(id, key, value);
      };
      _pending.set(token, { commit, timer: setTimeout(commit, EDIT_DEBOUNCE_MS) });
    },
    fonts: [],
    fontDraft: "",
    fontsState: "empty",
    remove(id: string) {
      flushEdits();
      const list = entries();
      const index = list.findIndex((entry) => ids.get(entry) === id);
      if (index === -1) {
        return;
      }
      list.splice(index, 1);
      save();
      refresh();
    },
    removeFont(id: string) {
      flushEdits();
      const list = entries();
      const index = list.findIndex((entry) => ids.get(entry) === id);
      if (index === -1) {
        return;
      }
      list.splice(index, 1);
      /* The preconnects go with the last font, and only with the last: `cleanupGoogleFontPreconnects`
         answers with a new array when it dropped something, which is copied back into the array the
         project holds rather than replacing it. */
      const cleaned = cleanupGoogleFontPreconnects(list);
      if (cleaned !== list) {
        list.length = 0;
        list.push(...cleaned);
      }
      save();
      refresh();
    },
    rows: [],
    tags: ADD_TAGS,
  }) as HeadScope;
  return _scope;
}

// ─── The mount ────────────────────────────────────────────────────────────────

let _host: HTMLElement | null = null;
let _mount: Promise<SurfaceHandle> | null = null;
let _handle: SurfaceHandle | null = null;

/** Take the surface down and forget its host. */
function dispose(): void {
  const pending = _mount;
  _mount = null;
  if (_handle) {
    _handle.dispose();
    _handle = null;
  } else if (pending) {
    void pending.then((handle) => {
      handle.dispose();
    });
  }
  _host = null;
}

/**
 * Draw the Site head section into `container`, or bring the one already there up to date.
 *
 * This is the `render` the settings registry holds (`settings/section-registry.ts`), and the pane
 * calls it again on every registry change with the same container — so a mount still standing is
 * only refreshed, and one whose root has left the container is disposed and remade.
 *
 * @param {HTMLElement} container
 */
export function renderHeadEditor(container: HTMLElement): void {
  refresh();
  if (_host === container && _handle?.root.parentNode === container) {
    return;
  }
  if (_mount !== null && _host === container && _handle === null) {
    // Still mounting into this very container.
    return;
  }
  dispose();
  _host = container;
  container.textContent = "";
  const pending = mountSurface("settings-head", state(), container);
  _mount = pending;
  void pending.then((handle) => {
    if (_mount === pending) {
      _handle = handle;
    } else {
      handle.dispose();
    }
  });
}
