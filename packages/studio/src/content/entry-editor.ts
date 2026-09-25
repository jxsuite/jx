/// <reference lib="dom" />
/**
 * The **Entry editor** — a content entry's fields, as a form, in a pane (§7.4, plan §9.2).
 *
 * Until now a markdown entry could be edited two ways and neither was its schema: the canvas edited
 * its BODY, and the Document Header card drew a field list from `panels/frontmatter-fields.ts`'s
 * own type→widget ladder, which is a second implementation of `ui/schema-form.ts` with no reference
 * branch, no validation and no value-source ladder. A JSON entry (`authors/ada.json`) had no field
 * editor at all — it opened as a component tree, so `bio` was a node's property and `links` was a
 * child array.
 *
 * This is one editor over the schema form, so every improvement to the engine reaches content
 * entries, settings and the inspector at once — and the `reference` control in particular arrives
 * here for free, which is what makes `author: { "$ref": "#/content/authors" }` a picker instead of
 * a text field you have to type an id into.
 *
 * **This module is the FLOW; `surfaces/entry-editor.json` is the markup.** Everything below decides
 * something — which pane holds which tab, which collection a path belongs to, which record the
 * fields live in, which required keys are absent, what a draft flag commits into — and hands the
 * surface a projection with no decisions left in it. The form itself is an island the surface
 * renders empty: `ui/schema-form.ts` hands back a host ELEMENT, and {@link renderEntryMode} places
 * it in the node the document announces.
 *
 * **It is an editor of the same tab, not a second document.** Like `settings/settings-document.ts`,
 * it unshifts its mode onto the tab the file already has, so ⌘S, the dirty flag, the transaction
 * log and undo are the ordinary document verbs. Every field commits through
 * {@link mutateEntryField}, so an edit made here is undone by ⌘Z and replayed by a collaborator
 * exactly as one made in the Document Header card.
 *
 * **One editor, two storage shapes.** A markdown entry keeps its fields in frontmatter; a JSON
 * entry IS its fields. `content/entry-fields.ts` owns that single question, and this file never
 * touches `content.frontmatter` directly — reading it unconditionally is what made a JSON entry's
 * form blank, its valid required fields look absent, and every edit vanish at save time.
 *
 * **The mode is registered in all three tables.** `commands/context.ts` holds the one map from mode
 * to editor kind; a mode missing from it does not fail, it silently answers `"canvas"`, and that is
 * how ⌘V once inserted an element node into `project.json`. `entry` → `entry` → "Entry" is added to
 * `EDITOR_KIND_BY_MODE`, `EditorKind` and `EDITOR_KIND_LABELS` in the same change as this file.
 *
 * @docs studio/projects/content-types
 */

import { activeRegistry } from "../commands/active-registry";
import { effect, effectScope } from "../reactivity";
import { projectState } from "../store";
import { resolveContextPointer } from "../services/context-resolver";
import { transactDoc } from "../tabs/transact";
import { mountSchemaForm } from "../ui/schema-form";
import { mountEntryEditorSurface } from "../surfaces/entry-editor";
import { paneRegion } from "../ui/regions";
import { activateTab, workspace } from "../workspace/workspace";
import { commitEntryFields, entryFields, mutateEntryField } from "./entry-fields";
import { DRAFT_FIELD, DRAFT_MEANING, hasDraftAxis, isDraftEntry } from "./draft-state";
import { collectionOfPath, missingRequired } from "./entry-model";
import type { EntryCollection } from "./entry-model";
import type { EntryEditorSurfaceHandle, EntryEditorView } from "../surfaces/entry-editor";
import type { JsonSchema, SchemaFormContext } from "../ui/schema-form";
import type { Tab } from "../tabs/tab";
import type { CanvasSurface } from "../canvas/canvas-surface";
import type { JsonValue } from "../types";

/** The `canvasMode` the entry form draws under. */
export const ENTRY_MODE = "entry";

/** What an entry tab's mode list becomes when the Entry editor opens it: the form leads. */
const ENTRY_TAB_MODES = [ENTRY_MODE];

// ─── Mounting ────────────────────────────────────────────────────────────────

interface ActiveEntryPane {
  /** The pane whose stage this form is drawn on. */
  paneId: string;
  tabId: string;
  wrap: HTMLElement;
  surface: EntryEditorSurfaceHandle;
  scope: { stop: () => void; run: <T>(fn: () => T) => T | undefined };
}

/**
 * The entry form mounted in each pane, keyed by pane id.
 *
 * `entry` is one of the kinds the side pane may host, so this singleton was reachable from two
 * panes at once the day the grid drew a second cell: pane B's mount stopped pane A's effect scope,
 * leaving a form on screen that no longer tracked its own frontmatter.
 */
const _active = new Map<string, ActiveEntryPane>();

/** The form mounted in a pane, or null. */
function activeIn(paneId: string): ActiveEntryPane | null {
  return _active.get(paneId) ?? null;
}

/** Whether this tab's entry form is already mounted in this pane and still in the document. */
export function entryPaneMounted(paneId: string, tab: Tab): boolean {
  const panel = activeIn(paneId);
  return (
    panel !== null && panel.tabId === tab.id && panel.wrap.isConnected && panel.surface.attached()
  );
}

/** Tear one pane's entry form down (mode change, tab switch, project close). Idempotent. */
export function detachEntryPane(paneId: string): void {
  const panel = _active.get(paneId);
  if (!panel) {
    return;
  }
  panel.scope.stop();
  panel.surface.dispose();
  _active.delete(paneId);
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

/**
 * Set this entry's draft flag. A setter, never a toggle — the pill, the command and the assistant
 * all reach the same state whatever it was before.
 *
 * `draft: false` is written rather than removed. The absence of the key and the value `false` mean
 * the same thing to a reader, but only one of them survives a glance at the file, and an author who
 * has explicitly published something should be able to see that they did.
 */
export function setEntryDraft(tab: Tab, draft: boolean): void {
  transactDoc(tab, (t) => mutateEntryField(t, DRAFT_FIELD, draft as JsonValue));
}

/** What the tab chip's draft pill says. A value, drawn by `surfaces/tab-strip.json`. */
export interface DraftPill {
  /** The word on the pill: "Draft" or "Published". */
  text: string;
  /** Its tooltip: what being a draft actually excludes, or that it is not one. */
  title: string;
  draft: boolean;
}

/**
 * The draft pill for a tab, or `null` when its document has no draft axis at all.
 *
 * Drawn on the pane's tab chip (`panels/tab-strip.ts`) rather than only inside the editor, because
 * the failure this exists to prevent is publishing something you thought was private — and that
 * mistake is made while looking at a tab, not while looking at a form. It states its two words for
 * any entry whose collection declares the field, so "Published" is as visible as "Draft"; a
 * collection with no draft workflow states neither, which is what `null` means.
 *
 * **It was the ONE piece of markup left in this file, and it was not this surface's.** It was a
 * fragment of the tab CHIP — a `<span>` lit interpolated into a `repeat()` that rebuilt on every
 * strip repaint — and it said so, and that it would convert when `panels/tab-strip.ts` converted.
 * The strip is a Jx document now, so this is a projection: two strings and a flag, drawn by the
 * chip's `status` slot, and `.entry-pill`'s rules in `styles/overlays.css` are dead with it.
 */
export function entryDraftPill(tab: Tab): DraftPill | null {
  const collection = collectionOfPath(tab.documentPath);
  const fields = entryFields(tab);
  if (!collection || !hasDraftAxis(collection.schema, fields)) {
    return null;
  }
  const draft = isDraftEntry(fields);
  return {
    draft,
    text: draft ? "Draft" : "Published",
    title: draft ? DRAFT_MEANING : "Not marked a draft.",
  };
}

// ─── The form ────────────────────────────────────────────────────────────────

/** The form's host context: enum pointers resolve against this project's configuration. */
function formContext(tab: Tab): SchemaFormContext {
  return {
    fieldKeyPrefix: `entry:${tab.id}`,
    resolvePointer: (pointer, scope) =>
      resolveContextPointer(pointer, {
        projectConfig: (projectState?.projectConfig ?? {}) as Record<string, unknown>,
        scope,
      }),
  };
}

/**
 * Required fields this entry does not have.
 *
 * Deliberately keyed on ABSENCE, not emptiness. A seeded entry's `title: ""` is present and the
 * author has not done anything wrong yet, so §7.1 says not to paint it red; a required key that is
 * missing from the file is a fact about the document, and saying so is the whole reason the form
 * knows the schema.
 */
function absentRequiredErrors(
  collection: EntryCollection,
  fields: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of missingRequired(collection.schema, fields)) {
    errors[field] = "Required — this entry does not have one.";
  }
  return errors;
}

/** What the document says when the file belongs to no collection: the reason, then the fix. */
function emptyLine(tab: Tab): string {
  return `${tab.documentPath ?? "This document"} is not an entry of any content collection, so there is no schema to draw a form from.`;
}

/** Everything the document draws, computed from the tab and the project's content map. */
function entryView(paneId: string, tab: Tab, collection: EntryCollection | null): EntryEditorView {
  const region = paneRegion(paneId, "entry");
  const fieldsRegion = paneRegion(paneId, "entry/fields");
  if (!collection) {
    return {
      collection: "",
      draft: false,
      draftAxis: "hidden",
      draftHint: DRAFT_MEANING,
      emptyLine: emptyLine(tab),
      fieldsRegion,
      name: "",
      note: "",
      noteState: "hidden",
      region,
      stage: "empty",
    };
  }
  const fields = entryFields(tab);
  const draft = isDraftEntry(fields);
  return {
    collection: collection.name,
    draft,
    draftAxis: hasDraftAxis(collection.schema, fields) ? "shown" : "hidden",
    draftHint: DRAFT_MEANING,
    emptyLine: "",
    fieldsRegion,
    name: tab.documentPath?.split("/").pop() ?? "Untitled",
    note: DRAFT_MEANING,
    noteState: draft ? "shown" : "hidden",
    region,
    stage: "entry",
  };
}

/**
 * Mount the entry form into the pane.
 *
 * The same non-iframe-editor pattern as the grid, the Library and Project Settings: this owns its
 * own effect scope from here, so a field commit repaints the form and nothing else — repainting
 * through the canvas pipeline would remount the document's iframe on every keystroke.
 *
 * @param {CanvasSurface} surface
 * @param {Tab} tab
 */
export function renderEntryMode(surface: CanvasSurface, tab: Tab): void {
  const { paneId, wrap: canvasWrap } = surface;
  if (entryPaneMounted(paneId, tab)) {
    return;
  }
  detachEntryPane(paneId);

  let panel: ActiveEntryPane | null = null;
  /**
   * The node the document renders for the schema form, as the document announced it.
   *
   * Held rather than queried: it lives inside a `$switch` case, so the reconciler builds a NEW one
   * whenever the file stops or starts belonging to a collection, and a handle found once by
   * selector would be detached DOM from that moment on.
   */
  let formHost: HTMLElement | null = null;

  const redraw = () => {
    if (panel !== null && activeIn(paneId) === panel) {
      draw();
    }
  };

  /**
   * Put the schema form into the node the document made for it.
   *
   * `ui/schema-form.ts` hands back a host ELEMENT rather than a template, so this places it.
   * Calling `mountSchemaForm` again with the same key updates the standing form in place, which is
   * what keeps the caret in a field across the repaint a commit provokes.
   */
  const paintForm = (collection: EntryCollection | null) => {
    if (!formHost || !collection) {
      return;
    }
    const fields = entryFields(tab);
    const form = mountSchemaForm(`entry:${paneId}`, collection.schema as JsonSchema, fields, {
      context: formContext(tab),
      errors: absentRequiredErrors(collection, fields),
      onChange: (patch) => commitEntryFields(tab, patch),
      rerender: redraw,
    });
    if (form.parentNode !== formHost) {
      formHost.replaceChildren(form);
    }
  };

  const draw = () => {
    const collection = collectionOfPath(tab.documentPath);
    if (!collection) {
      /* The `fields` node goes with the case that held it, so the handle is dropped here rather
         than left pointing at a node the reconciler is about to remove. */
      formHost = null;
    }
    panel?.surface.update(entryView(paneId, tab, collection));
    paintForm(collection);
  };

  const scope = effectScope();
  const mounted = mountEntryEditorSurface(
    canvasWrap,
    entryView(paneId, tab, collectionOfPath(tab.documentPath)),
    {
      openContentTypes: () => {
        void activeRegistry()?.run("settings.open", { section: "content" });
      },
      setDraft: (draft) => setEntryDraft(tab, draft),
    },
    {
      fieldsSlot: (host) => {
        formHost = host;
        paintForm(collectionOfPath(tab.documentPath));
      },
    },
  );
  panel = { paneId, scope, surface: mounted, tabId: tab.id, wrap: canvasWrap };
  _active.set(paneId, panel);

  scope.run(() => {
    effect(() => {
      if (activeIn(paneId) !== panel) {
        return;
      }
      // Everything the form draws from: the entry's own fields, and the schema that types them.
      // BOTH stores are read, because which one holds the fields is `entry-fields.ts`'s answer,
      // Never this effect's guess. `tab.doc.document` is also the reference every transaction
      // Replaces, so it is how an undo reaches the form whichever store the edit was in.
      void tab.doc.document;
      void tab.doc.content?.frontmatter;
      void projectState?.projectConfig?.content;
      draw();
    });
  });
}

// ─── Opening ─────────────────────────────────────────────────────────────────

/**
 * Open a content entry in its form editor.
 *
 * Reveals the tab the file already has rather than building a second one — same id, same history,
 * same dirty flag — and only then switches the editor, so an author who was editing the body keeps
 * their undo stack. Returns null when the file could not be opened at all.
 */
export async function openEntryEditor(path: string): Promise<Tab | null> {
  /* Dynamic: `files/files.ts` reaches the platform, the format registry and the packages layer, and
     a static edge from here would drag all of it into every importer of the content model. */
  const { openFileInTab } = await import("../files/files");
  await openFileInTab(path);
  for (const [id, tab] of workspace.tabs.entries()) {
    if (tab.documentPath !== path) {
      continue;
    }
    for (const mode of ENTRY_TAB_MODES) {
      if (!tab.capabilities.modes.includes(mode)) {
        tab.capabilities.modes.unshift(mode);
      }
    }
    tab.session.ui.canvasMode = ENTRY_MODE;
    tab.session.ui.preview = false;
    activateTab(id);
    return tab as Tab;
  }
  return null;
}
