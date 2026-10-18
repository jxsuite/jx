/// <reference lib="dom" />
/**
 * The Inspector's Entry tab: what the Page tab draws while a collection entry is the focused
 * document (`specs/studio.md` §6, §22.5; the Content-Entry board's sidebar).
 *
 * Four things, in the board's order: the entry's **status** (its draft flag, when the collection
 * has a draft workflow, `content/draft-state.ts`), its **fields** as the collection's schema types
 * them (`ui/schema-form.ts` over `content/entry-fields.ts`, the same form and the same transacted
 * commits as the form-only editor, so ⌘Z undoes a field here exactly as it does there), the **URL**
 * its collection page publishes it at (`content/collection-pages.ts`), and the **file** it is
 * stored in, with what that file holds.
 *
 * The body is written on the canvas beside it; this tab is the entry's frontmatter (or, for a JSON
 * entry opened on the canvas by hand, its root). The form-only `entry` editor stays for the entries
 * the canvas cannot write.
 *
 * @docs studio/projects/content-types
 */

import { effect, effectScope } from "../reactivity";
import { projectState } from "../store";
import { runActiveReported } from "../commands/run-reported";
import { mountSchemaForm } from "../ui/schema-form";
import { collectionForFile } from "./collection-match";
import { capitalise, contentCollection } from "./content-collections";
import {
  entryLocale,
  entryUrl,
  onCollectionPagesRead,
  peekCollectionPage,
} from "./collection-pages";
import { commitEntryFields, entryFields } from "./entry-fields";
import { DRAFT_MEANING, hasDraftAxis, isDraftEntry } from "./draft-state";
import { entryCollection } from "./entry-model";
import {
  absentRequiredErrors,
  fieldLabels,
  formContext,
  setEntryDraft,
  titleFirst,
} from "./entry-editor";
import { mountEntryInspectorSurface } from "../surfaces/entry-inspector";
import type { EntryInspectorHandle, EntryInspectorView } from "../surfaces/entry-inspector";
import type { JsonSchema } from "../ui/schema-form";
import type { JsonObject } from "@jxsuite/schema/types";
import type { EffectScope } from "@vue/reactivity";
import type { Tab } from "../tabs/tab";

/** The region the tab's root carries. */
export const ENTRY_INSPECTOR_REGION = "inspector/entry";

/** A word with its first letter in capitals. */

/** Whether a tab's document is a collection entry: what titles the Page tab "Entry" (§6). */
export function isEntryTab(tab: Tab | null): boolean {
  const match = collectionForFile(tab?.documentPath);
  return match !== null && !match.fileBacked;
}

/** What the tab draws for an entry. */
export function entryInspectorView(tab: Tab): EntryInspectorView {
  const path = tab.documentPath ?? "";
  const match = collectionForFile(path);
  const name = match?.name ?? "";
  const collection = entryCollection(name);
  const fields = entryFields(tab);
  const draftAxis = hasDraftAxis(collection?.schema, fields);
  const draft = isDraftEntry(fields);
  const page = name === "" ? null : peekCollectionPage(name, entryLocale(path));
  const url = page ? entryUrl(page, path, fields) : null;
  const isJson = path.endsWith(".json");
  return {
    draft,
    draftAxis: draftAxis ? "shown" : "hidden",
    draftHint: DRAFT_MEANING,
    fieldsState: collection?.schema ? "form" : "none",
    kind: capitalise(contentCollection(name)?.item ?? "entry"),
    path,
    region: ENTRY_INSPECTOR_REGION,
    status: draftAxis ? (draft ? "Draft" : "Published") : "",
    storage: isJson
      ? ". Its fields are the file itself."
      : ". Fields are its frontmatter, and the body is its Markdown.",
    url: url ?? "",
    urlState: page === undefined ? "loading" : url ? "shown" : page ? "unlisted" : "none",
  };
}

// ─── Mounting ────────────────────────────────────────────────────────────────

interface StandingInspector {
  host: HTMLElement;
  tabId: string;
  handle: EntryInspectorHandle;
  scope: EffectScope;
  formHost: HTMLElement | null;
  /**
   * Repaint this tab, if it is still the one standing: the form's, the pages index's and the
   * effect's.
   */
  redraw: () => void;
  unlisten: () => void;
}

let _standing: StandingInspector | null = null;

/** Put the field form into the node the document made for it, or bring it up to date. */
function paintForm(standing: StandingInspector, tab: Tab): void {
  const collection = entryCollection(collectionForFile(tab.documentPath)?.name ?? "");
  if (!standing.formHost || !collection?.schema) {
    return;
  }
  const fields = entryFields(tab);
  /* SAFETY: `collection.schema` is the collection's JSON Schema, the shape `JsonSchema` names for
     the form; `fields` is a frontmatter block or a JSON entry's root, both parsed from YAML or JSON
     text, so every value is JSON. The same reading `entry-editor.ts` makes. */
  const form = mountSchemaForm(
    "entry-inspector",
    titleFirst(collection.schema as JsonSchema, collection.schema, fields),
    fields as JsonObject,
    {
      context: formContext(tab),
      errors: absentRequiredErrors(collection, fields),
      onChange: (patch) => commitEntryFields(tab, patch),
      rerender: standing.redraw,
      ui: fieldLabels(collection.schema),
    },
  );
  if (form.parentNode !== standing.formHost) {
    standing.formHost.replaceChildren(form);
  }
}

/** Repaint the tab and its form. */
function draw(standing: StandingInspector, tab: Tab): void {
  const view = entryInspectorView(tab);
  if (view.fieldsState === "none") {
    standing.formHost = null;
  }
  standing.handle.update(view);
  paintForm(standing, tab);
}

/** Take the tab down. Idempotent. */
export function unmountEntryInspector(host?: HTMLElement): void {
  if (!_standing || (host !== undefined && _standing.host !== host)) {
    return;
  }
  _standing.unlisten();
  _standing.scope.stop();
  _standing.handle.dispose();
  _standing = null;
}

/**
 * Draw the Entry tab for `tab` into `host`, or bring the one already there up to date.
 *
 * Owns its own effect over the entry's fields, like the form-only editor, so a field commit
 * repaints the tab and nothing else.
 */
export function renderEntryInspector(host: HTMLElement, tab: Tab): void {
  if (
    _standing &&
    _standing.host === host &&
    _standing.tabId === tab.id &&
    _standing.handle.attached()
  ) {
    draw(_standing, tab);
    return;
  }
  unmountEntryInspector();
  const scope = effectScope();
  const redraw = (): void => {
    if (_standing === standing) {
      draw(standing, tab);
    }
  };
  const standing: StandingInspector = {
    formHost: null,
    handle: mountEntryInspectorSurface(
      host,
      entryInspectorView(tab),
      {
        openFields: () => {
          const name = collectionForFile(tab.documentPath)?.name;
          void runActiveReported(
            "settings.open",
            name ? { entry: name, section: "content" } : { section: "content" },
            "Entry",
          );
        },
        setDraft: (draft) => setEntryDraft(tab, draft),
      },
      {
        fieldsSlot: (element) => {
          if (_standing === standing) {
            standing.formHost = element;
            paintForm(standing, tab);
          }
        },
      },
    ),
    host,
    redraw,
    scope,
    tabId: tab.id,
    unlisten: onCollectionPagesRead(redraw),
  };
  _standing = standing;
  scope.run(() => {
    effect(() => {
      // Both stores, for the reason `entry-editor.ts` gives: which one holds the fields is
      // `entry-fields.ts`'s answer, and the document is the reference every transaction replaces.
      void tab.doc.document;
      void tab.doc.content.frontmatter;
      void projectState?.projectConfig?.content;
      redraw();
    });
  });
}
