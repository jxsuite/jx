/// <reference lib="dom" />
/**
 * Seo-modal.ts — Search appearance, as a surface of its own.
 *
 * It was a collapsible block inside the Document Header card: two rendered previews, a resolved
 * field list, a warning list, the page and Open Graph meta rows, and an icon picker — all disclosed
 * under one summary row, inside a card whose job is the four or five fields you fill in while
 * writing. A previewed SERP result is not a field; it is a picture you study, and studying it in a
 * strip above the canvas meant the card grew taller than the thing it describes.
 *
 * So it opens as a modal, from two places — the Document Header card and the Inspector's Page tab.
 * Two doors because the two are different moments: one while writing the page, one while working on
 * its head material. Both run `document.openSeo`, so there is a third door in the palette and no
 * surface owns the capability (one definition site per action, §13).
 *
 * **The card keeps the fields; the modal keeps the picture.** Title still lives on the card,
 * because it is the one head value you type while writing. Everything the modal holds is either a
 * rendering of what the build will emit or a field you set once and leave.
 *
 * **This module is the flow; `surfaces/seo.json` is the markup.** What lives here is every
 * judgement the picture rests on: which realm a commit is written into, what each previewed line
 * says when nothing supplies it, where a value came from and whether that donor is somewhere the
 * reader can go, which fields are counted, and what Browse and Upload do. The document holds no
 * decision — it holds the parts, the ARIA and the styling, and it branches on flags this module
 * hands it.
 *
 * The mutation path is the card's, unchanged: a markdown page commits through
 * `applyContentMutation` and a JSON one through `transact`, both taking the tab so the modal edits
 * the document it was opened over rather than whichever pane has focus.
 *
 * @docs studio/editing/frontmatter
 */

import { activeRegistry } from "../commands/active-registry";
import { HEAD_EDIT_DEBOUNCE } from "../ui/timing";
import { previewAssetSrc } from "../canvas/asset-refs";
import { layerHost } from "../ui/layers";
import { openSeoSurface } from "../surfaces/seo";
import { provenanceTitle } from "./provenance";
import { tabLabel } from "./tab-strip";
import { transact } from "../tabs/transact";
import { activeTab } from "../workspace/workspace";
import { pickAndUpload, showMediaPickerPopover } from "../ui/media-picker";
import {
  OG_FIELDS,
  PAGE_FIELDS,
  applyContentMutation,
  buildHeadDoc,
  findLinkEntry,
  findMetaEntry,
  seoField,
  reportSeoProblems,
  seoPreviewFor,
  upsertLink,
  upsertMeta,
  visibleLength,
} from "./head-panel";
import type { SeoField, SeoPreview } from "./head-panel";
import type { FieldProvenance } from "./provenance";
import type { SeoEditRowView, SeoFieldView, SeoSurfaceHandle, SeoView } from "../surfaces/seo";
import type { JxHeadEntry, JxMutableNode } from "@jxsuite/schema/types";
import type { Tab } from "../tabs/tab";
import type { AnyCommand, CommandRegistry } from "../commands/registry";

// ─── Provenance ───────────────────────────────────────────────────────────────

/*
 * Two rendered previews, a resolved-field list and a warning list, over the MERGED head — and no
 * score. A number out of a hundred aggregates unrelated facts into a verdict, and a verdict is
 * what gets optimised; a count beside a limit and a named consequence say the same thing without
 * ranking anything (§16.6).
 *
 * The previews are pictures of what the build emits, so a value the page did not author is marked
 * as inherited with the donor NAMED — the third cascade to use `panels/provenance.ts`'s vocabulary
 * after the style cascade and component props, and deliberately not a fourth vocabulary. It is the
 * whole reason the block can say "no description reaches this page" without saying it to a page
 * that inherits one from the site.
 */

/**
 * A resolved field's provenance chip, in the shared vocabulary.
 *
 * The two chips that can go somewhere do: a value from the site's own `$head` opens Project
 * Settings › Site head, and one from the site `name` opens Overview. The layout and build donors
 * get no handler, because the card has no verb for "open that layout" and a control that looks
 * pressable and does nothing is the defect §6.7 exists to remove — the document draws those two as
 * a `<span>` and the two below as a `<button>`, on exactly this answer.
 *
 * @param {SeoField} field
 * @returns {FieldProvenance}
 */
function seoProvenance(field: SeoField): FieldProvenance {
  const open = (section: string) => () => {
    void activeRegistry()?.run("settings.open", { section });
  };
  switch (field.source) {
    case "page": {
      return { state: "set", title: `${field.label} is set on this page` };
    }
    case "layout": {
      const donor = field.donor ?? "the layout";
      return {
        donor,
        state: "inherited",
        title: `${field.label} comes from the ${donor} layout — this page does not set it`,
      };
    }
    case "site": {
      const fromName = field.donor === "Site name";
      return {
        donor: field.donor ?? "the site",
        onClick: open(fromName ? "overview" : "head"),
        state: "inherited",
        title: `${field.label} comes from ${fromName ? "the project's name" : "the site-level $head"} — click to open it`,
      };
    }
    case "build": {
      return {
        donor: "the build",
        state: "inherited",
        title: `Nothing declares ${field.label}, so the build supplies “${field.value}”`,
      };
    }
    default: {
      return { state: "default" };
    }
  }
}

/** What a previewed line says when nothing in the cascade supplies it. */
function unsetLabel(field: SeoField): string {
  return `No ${field.label.toLowerCase()}`;
}

/** One resolved field, as the list draws it: the value, its budget, and where it came from. */
function fieldView(field: SeoField): SeoFieldView {
  const length = visibleLength(field.value);
  const provenance = seoProvenance(field);
  const inherited = provenance.state === "inherited";
  return {
    chipKind:
      provenance.state === "default"
        ? "none"
        : provenance.state === "set"
          ? "dot"
          : provenance.onClick
            ? "link"
            : "static",
    chipText: inherited ? `from ${provenance.donor ?? "the cascade"}` : "",
    chipTitle: provenanceTitle(field.key, provenance),
    count: field.limit === null ? "" : `${length}/${field.limit}`,
    counted: field.limit !== null,
    key: field.key,
    label: field.label,
    over: field.limit !== null && length > field.limit,
    unsetLabel: unsetLabel(field),
    value: field.value,
  };
}

// ─── The editable rows ────────────────────────────────────────────────────────

/** The one meta field a key names, so a commit knows which attribute it writes. */
const META_BY_KEY = new Map([...PAGE_FIELDS, ...OG_FIELDS].map((field) => [field.key, field]));

/** The favicon is a `<link rel="icon">` rather than a meta tag: the one row with its own realm. */
const ICON_KEY = "icon";

/** A field's placeholder. `viewport` gets the value almost every page wants, spelled out. */
function placeholderFor(key: string, label: string, media: boolean): string {
  if (key === "viewport") {
    return "width=device-width, initial-scale=1";
  }
  return media ? "/image.jpg" : `${label}…`;
}

/** One editable row, drawn from the entry currently in `$head`. */
function editRow(
  key: string,
  label: string,
  value: string,
  opts: { media?: boolean | undefined; multiline?: boolean | undefined } = {},
): SeoEditRowView {
  const media = Boolean(opts.media);
  return {
    isMedia: media,
    key,
    label,
    multiline: Boolean(opts.multiline),
    placeholder: placeholderFor(key, label, media),
    /* The thumbnail resolves the same way every other image in the studio chrome does, so a
       content-relative `./images/hero.jpg` previews at its asset-mount URL while the authored ref
       stays exactly as written. */
    thumb: media && value ? previewAssetSrc(value) : "",
    value,
  };
}

/** The current content of one meta row. */
function metaValue(head: JxHeadEntry[], key: string): string {
  const field = META_BY_KEY.get(key);
  if (!field) {
    return "";
  }
  return String(findMetaEntry(head, field.attr, field.key)?.attributes?.content ?? "");
}

/**
 * Write one row's value, in whichever realm the key belongs to.
 *
 * An empty value REMOVES the entry, which is what makes the control's own clear button and typing
 * the field empty one path rather than two.
 */
function writeField(
  key: string,
  value: string,
  applyMutation: (fn: (doc: JxMutableNode) => void) => void,
): void {
  const trimmed = value.trim();
  if (key === ICON_KEY) {
    applyMutation((doc: JxMutableNode) => upsertLink(doc, "icon", trimmed));
    return;
  }
  const field = META_BY_KEY.get(key);
  if (!field) {
    return;
  }
  applyMutation((doc: JxMutableNode) => upsertMeta(doc, field.attr, field.key, trimmed));
}

/** One timer per field key, so editing Description then Title does not cancel the first write. */
const _pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Forget every pending keystroke — the modal closed, or a commit already landed. */
function cancelPending(key?: string): void {
  if (key === undefined) {
    for (const timer of _pending.values()) {
      clearTimeout(timer);
    }
    _pending.clear();
    return;
  }
  const timer = _pending.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    _pending.delete(key);
  }
}

// ─── The modal ───────────────────────────────────────────────────────────────

/** The open surface, or `null`. One at a time: it is about the focused document. */
let _handle: SeoSurfaceHandle | null = null;

/** The tab it was opened over, so a re-render draws the same document the author opened. */
let _tab: Tab | null = null;

/** Where each chip that leads somewhere goes, rebuilt with the view it was drawn from. */
let _donors = new Map<string, () => void>();

/** What the SEO body reads and writes for one tab: its merged head, and how an edit lands. */
interface SeoContext {
  headDoc: JxMutableNode;
  head: JxHeadEntry[];
  applyMutation: (fn: (doc: JxMutableNode) => void) => void;
}

/**
 * What the SEO body needs from a tab, resolved once.
 *
 * Both realms in one place: a markdown page keeps its head material in frontmatter and a JSON one
 * in root properties, and `buildHeadDoc` is the card's own view of that difference.
 */
function seoContextFor(tab: Tab): SeoContext {
  const isContent = tab.doc.mode === "content";
  const headDoc = isContent
    ? buildHeadDoc(tab.doc.document, tab.doc.content.frontmatter)
    : tab.doc.document;
  return {
    applyMutation: isContent
      ? (fn: (doc: JxMutableNode) => void) => applyContentMutation(tab, renderSeoModal, fn)
      : (fn: (doc: JxMutableNode) => void) => {
          transact(tab, fn);
        },
    head: headDoc.$head ?? [],
    headDoc,
  };
}

/**
 * Everything the document draws, from the merged head of the tab it was opened over.
 *
 * The previews, then the resolved fields, then the controls that change them — that order on
 * purpose: what it looks like, what is wrong with it, and only then the form. The form was all this
 * block used to be, and a form cannot tell you that the description you are about to write is
 * already coming from the site.
 */
function buildView(tab: Tab, headDoc: JxMutableNode, head: JxHeadEntry[]): SeoView {
  // The card's tab, so the SERP row shows this document's route and this document's layout layer.
  const preview: SeoPreview = seoPreviewFor(tab, headDoc);
  const description = seoField(preview, "description");
  const ogTitle = seoField(preview, "og:title");
  const ogDescription = seoField(preview, "og:description");
  const image = seoField(preview, "og:image").value.trim();
  const iconHref = String(findLinkEntry(head, "icon")?.attributes?.href ?? "");

  _donors = new Map();
  for (const field of preview.fields) {
    const { onClick } = seoProvenance(field);
    if (onClick) {
      _donors.set(field.key, onClick);
    }
  }

  return {
    crumb: preview.url.crumb,
    description: description.value,
    descriptionUnset: unsetLabel(description),
    documentLabel: tab.documentPath ?? tabLabel(tab),
    domain: preview.url.host,
    fields: preview.fields.map(fieldView),
    groups: [
      {
        key: "page",
        note: "",
        rows: [
          ...PAGE_FIELDS.map((field) =>
            editRow(field.key, field.label, metaValue(head, field.key), {
              multiline: field.multiline,
            }),
          ),
          editRow(ICON_KEY, "Icon", iconHref, { media: true }),
        ],
        title: "Search result",
      },
      {
        key: "og",
        note: "Open Graph — what a shared link shows.",
        rows: OG_FIELDS.map((field) =>
          editRow(field.key, field.label, metaValue(head, field.key), {
            media: field.media,
            multiline: field.multiline,
          }),
        ),
        title: "Social card",
      },
    ],
    image: image ? previewAssetSrc(image) : "",
    socialDescription: ogDescription.value,
    socialDescriptionUnset: unsetLabel(ogDescription),
    socialTitle: ogTitle.value,
    socialTitleUnset: unsetLabel(ogTitle),
    title: seoField(preview, "title").value,
    warnings: preview.warnings,
  };
}

/** Repaint the modal if it is open. Every field commits live, so the picture follows the edit. */
export function renderSeoModal(): void {
  if (!_handle || !_tab) {
    return;
  }
  const { head, headDoc } = seoContextFor(_tab);
  _handle.update(buildView(_tab, headDoc, head));
}

/** Commit one field's value onto the document the modal was opened over. */
function commitField(key: string, value: string): void {
  cancelPending(key);
  if (!_tab) {
    return;
  }
  writeField(key, value, seoContextFor(_tab).applyMutation);
  // The JSON realm commits through `transact`, which does not repaint this surface for us.
  renderSeoModal();
}

/**
 * Upload into a media row: the image field's own Upload (`ui/media-picker.ts`), which opens the
 * picker, uploads through the one core, and hands the first file's ref back. A commit that lands
 * after the modal closed writes nothing, because {@link commitField} is about the open modal.
 */
function uploadInto(key: string): void {
  pickAndUpload((ref: string) => commitField(key, ref));
}

/**
 * Offer the project's images for one row: the media picker's own compact browser, with its **Browse
 * all images…** row opening the Media workspace's surface in pick mode.
 *
 * Not a list of this module's own. It kept one (a walk of `public/` alone, and a kit menu of site
 * URLs) because the old picker painted into a layer div UNDER the modal; the browser is a top-layer
 * `jx-popover` now, so it paints over the modal that opened it, and the field and this dialog
 * answer "what media does this project have" from the same listing (studio.md §9.3).
 */
function browseFor(key: string, anchor: HTMLElement): void {
  showMediaPickerPopover(anchor, (ref: string) => commitField(key, ref), { images: true });
}

/** Open it over `tab`. Idempotent — opening it again re-points it at the current document. */
export function openSeoModal(tab: Tab): void {
  _tab = tab;
  if (!_handle) {
    const { head, headDoc } = seoContextFor(tab);
    _handle = openSeoSurface({
      layer: layerHost("dialog"),
      onBrowse: browseFor,
      onClosed: closeSeoModal,
      onCommit: commitField,
      onEdit: (key: string, value: string) => {
        cancelPending(key);
        _pending.set(
          key,
          setTimeout(() => {
            _pending.delete(key);
            commitField(key, value);
          }, HEAD_EDIT_DEBOUNCE),
        );
      },
      onOpenDonor: (key: string) => {
        _donors.get(key)?.();
      },
      onUpload: uploadInto,
      view: buildView(tab, headDoc, head),
    });
  }
  renderSeoModal();
  /*
   * File the same warnings as Problems on the way in.
   *
   * A window someone has to open is not where a fact should live alone: a page shipped with no
   * description is worth knowing whether or not you thought to look, and Problems is where this app
   * keeps the records that outlive the frame you were not watching. Same list, keyed by warning id,
   * so the two surfaces are naming one thing rather than two.
   */
  reportSeoProblems(seoPreviewFor(tab, tab.doc.document), tab.documentPath ?? undefined);
}

/** Close it, and forget the document it was about. */
export function closeSeoModal(): void {
  cancelPending();
  const handle = _handle;
  /* Cleared FIRST: the platform's `close` raises the dialog's own `close` event, which arrives
     here as `onClosed` — and a re-entrant `closeSeoModal` that still saw a handle would close it
     twice. */
  _handle = null;
  _tab = null;
  _donors = new Map();
  handle?.close();
}

/**
 * `document.openSeo` — the one capability behind both buttons.
 *
 * The Document Header card and the Page panel each render a control that runs this, so neither owns
 * it and the palette has it by name. A record rather than two click handlers, for the reason the
 * rendering-context axes became records: a surface that IS the capability is a capability the
 * palette, the assistant and `__jxAutomation` cannot reach.
 *
 * @returns {AnyCommand[]}
 */
export function seoCommands(): AnyCommand[] {
  return [
    {
      category: "Document",
      id: "document.openSeo",
      level: "document",
      menus: ["palette"],
      group: "2_document",
      requires: "an open document",
      when: (ctx) => ctx.document.open,
      /* No `aiTool`, by `studio-ui-guidelines.md` §12.4's first rule: this opens a modal for a
         person. */
      run: () => {
        const tab = activeTab.value;
        if (!tab) {
          throw new RangeError(`command "document.openSeo" needs an open document`);
        }
        openSeoModal(tab);
      },
      title: "Search Appearance",
    },
  ];
}

/**
 * Register it.
 *
 * @param {CommandRegistry} registry
 */
export function registerSeoCommands(registry: CommandRegistry): void {
  registry.registerAll(seoCommands());
}
