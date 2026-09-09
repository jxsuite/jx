/// <reference lib="dom" />
/**
 * Search appearance as a mounted document.
 *
 * `panels/seo-modal.ts` is the flow — it resolves the merged head for the tab the reader opened it
 * over, decides what each preview says, where every value came from and which mutation path a
 * commit takes, and files the same warnings as Problems — and this is the surface it draws into:
 * the reactive scope the document reads, the flags it branches on, and the mount that lives in the
 * dialog layer until the flow takes it down.
 *
 * **The flow states facts; the surface derives what the document branches on.** Whether a previewed
 * line has text or is absent, whether a counter is over budget, which of the three chip shapes a
 * field's provenance is drawn as, whether a media row has a thumbnail to show — all of that is
 * {@link derive}'s, so the flow can hand over the plain answer ("the value is `""`") and the
 * document can hold one `$switch` instead of a conditional it has no way to express.
 *
 * **Await the ELEMENT, not just the mount.** `mountSurface` resolving means the DOCUMENT rendered;
 * a `jx-dialog`'s own template is one `connectedCallback` later, and `showModal` in between finds
 * no `<dialog>` to open — the body is all there, correctly styled, and never shows. `whenReady` is
 * shared with `surfaces/dialog.ts` and `surfaces/add-repo.ts` rather than reimplemented.
 *
 * **The region is stamped in the DOCUMENT, not on the slot, and that is the one place this adapter
 * differs from its siblings.** A modal `<dialog>` is in the top layer and `position: fixed`, so the
 * layer slot around it has a zero-size box — and `overlay.dialog:seo` is a region the screenshot
 * pipeline photographs (`scripts/screenshots/manifest.json`, shot `seo-modal`), which measures
 * `getBoundingClientRect()` and gives up on an empty one. The id therefore rides on the `jx-dialog`
 * element, whose `display: contents` box is the union of the dialog it draws.
 *
 * @docs studio/editing/frontmatter
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import { close as closeDialog, showModal } from "@jxsuite/ui/behaviors/dialog";
import { whenReady } from "./dialog";
import seoDoc from "./seo.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("seo", seoDoc as unknown as JxDocument);

/** How a field's provenance is drawn — §6.2's vocabulary, reduced to three shapes and an absence. */
export type SeoChipKind = "none" | "dot" | "static" | "link";

/** One row of the resolved-field list: what reaches the browser, how long it is, where it came from. */
export interface SeoFieldView {
  /** The head key — `title`, `description`, `og:image`, … Also the row's reconcile key. */
  key: string;
  label: string;
  /** The merged value. Empty means nothing in the cascade supplies it. */
  value: string;
  /** What to say instead when it is empty — "No social title". */
  unsetLabel: string;
  /** Whether anybody counts this field at all; `og:image` is a URL and nobody does. */
  counted: boolean;
  /** The counter, already formatted: `61/60`. Never a total, and never a grade (§9.2, §14). */
  count: string;
  /** Over its budget. Stated on the counter and named in the warning list — never summed. */
  over: boolean;
  chipKind: SeoChipKind;
  /** The chip's text — "from Base". Empty for the set dot, which is a dot. */
  chipText: string;
  chipTitle: string;
}

/** One named warning. A list, never a total. */
export interface SeoWarningView {
  id: string;
  /** The head key it is about, so the row can carry it as code. */
  field: string;
  message: string;
}

/** One editable head field. */
export interface SeoEditRowView {
  /** The head key, which is the row's `data-prop` and what every callback hands back. */
  key: string;
  label: string;
  value: string;
  placeholder: string;
  /** Draw the control as a text area — `og:description` is the only one. */
  multiline: boolean;
  /** The row carries the Upload and Browse controls, and a thumbnail when the value is an image. */
  isMedia: boolean;
  /** The resolved preview URL for the thumbnail; empty when there is nothing to show. */
  thumb: string;
}

/** One half of the form, headed by the preview card it feeds. */
export interface SeoGroupView {
  key: string;
  title: string;
  /** A sentence under the heading; empty for a group that needs none. */
  note: string;
  rows: SeoEditRowView[];
}

/** Everything the document draws. Every field is already a string, a flag or a list of those. */
export interface SeoView {
  /** Which document this is about — a modal has no tab strip behind it to say so. */
  documentLabel: string;
  /** The breadcrumb the canonical produces. */
  crumb: string;
  /** The search result's headline. It always resolves to something, so it has no unset form. */
  title: string;
  description: string;
  descriptionUnset: string;
  /** The social card's image, already resolved to a preview URL; empty for none. */
  image: string;
  /** The host the canonical names; empty when the project declares no URL. */
  domain: string;
  socialTitle: string;
  socialTitleUnset: string;
  socialDescription: string;
  socialDescriptionUnset: string;
  fields: SeoFieldView[];
  warnings: SeoWarningView[];
  groups: SeoGroupView[];
}

export interface SeoSurfaceOptions {
  /** Where the dialog is mounted — the dialog layer, handed in so this module never reaches back. */
  layer: HTMLElement;
  /** What to draw before anything else happens: the flow's own view, so there is one builder of it. */
  view: SeoView;
  /** A keystroke in a field. The flow debounces it and decides what a commit writes. */
  onEdit: (key: string, value: string) => void;
  /** A field was committed outright — `change`, or the control's own clear button. */
  onCommit: (key: string, value: string) => void;
  /** The Upload control on a media row. */
  onUpload: (key: string) => void;
  /** The Browse control on a media row, with the button it was pressed on as the menu's anchor. */
  onBrowse: (key: string, anchor: HTMLElement) => void;
  /** A provenance chip that leads somewhere was pressed. */
  onOpenDonor: (key: string) => void;
  /** The dialog closed, for any reason the platform owns as well as this module's `close`. */
  onClosed: () => void;
}

export interface SeoSurfaceHandle {
  /** The slot in the dialog layer that carries the mount. */
  host: HTMLElement;
  /** Resolves with the `jx-dialog` element once it has rendered and been opened. */
  ready: Promise<HTMLElement>;
  /** Redraw from the flow's current view. */
  update: (view: SeoView) => void;
  /** Close the dialog (the platform restores focus) and dispose the document. Idempotent. */
  close: () => void;
}

/** A previewed line as the document reads it: which branch, and the two strings either takes. */
type LineState = "text" | "unset";

/** One field row with the flags the document branches on. */
interface SeoFieldRow extends SeoFieldView, Record<string, unknown> {
  valueState: LineState;
}

/** One editable row with the flags the document branches on. */
interface SeoEditRow extends SeoEditRowView, Record<string, unknown> {
  hasThumb: boolean;
}

/** One group with its rows already flagged. */
interface SeoGroupRow extends Record<string, unknown> {
  key: string;
  title: string;
  note: string;
  hasNote: boolean;
  rows: SeoEditRow[];
}

/** What the document discriminates on. Derived, never handed in. */
interface SeoFlags {
  serpCrumb: string;
  serpTitle: string;
  serpDesc: string;
  serpDescUnset: string;
  serpDescState: LineState;
  socialImage: string;
  socialImageState: "image" | "unset";
  socialDomain: string;
  socialDomainState: LineState;
  socialTitle: string;
  socialTitleUnset: string;
  socialTitleState: LineState;
  socialDesc: string;
  socialDescUnset: string;
  socialDescState: LineState;
  /** Whether there is anything to flag, or the sentence that says there is not. */
  warningsState: "none" | "list";
  fields: SeoFieldRow[];
  warnings: SeoWarningView[];
  groups: SeoGroupRow[];
}

interface SeoScope extends Record<string, unknown>, SeoFlags {
  documentLabel: string;
  edit: (key: string, value: string) => void;
  commit: (key: string, value: string) => void;
  upload: (key: string) => void;
  browse: (key: string, anchor: unknown) => void;
  openDonor: (key: string) => void;
  closed: () => void;
}

/** Which branch a previewed line takes. */
function lineState(text: string): LineState {
  return text.trim() === "" ? "unset" : "text";
}

/** The view's flags and rows, in the shape the document reads. */
function derive(view: SeoView): SeoFlags & { documentLabel: string } {
  return {
    documentLabel: view.documentLabel,
    fields: view.fields.map((field) => ({ ...field, valueState: lineState(field.value) })),
    groups: view.groups.map((group) => ({
      hasNote: group.note !== "",
      key: group.key,
      note: group.note,
      rows: group.rows.map((row) => ({ ...row, hasThumb: row.thumb !== "" })),
      title: group.title,
    })),
    serpCrumb: view.crumb,
    serpDesc: view.description,
    serpDescState: lineState(view.description),
    serpDescUnset: view.descriptionUnset,
    serpTitle: view.title,
    socialDesc: view.socialDescription,
    socialDescState: lineState(view.socialDescription),
    socialDescUnset: view.socialDescriptionUnset,
    socialDomain: view.domain,
    socialDomainState: lineState(view.domain),
    socialImage: view.image,
    socialImageState: view.image === "" ? "unset" : "image",
    socialTitle: view.socialTitle,
    socialTitleState: lineState(view.socialTitle),
    socialTitleUnset: view.socialTitleUnset,
    warnings: view.warnings,
    warningsState: view.warnings.length > 0 ? "list" : "none",
  };
}

/** Open Search appearance. The handle's `ready` resolves once the dialog is showing. */
export function openSeoSurface(options: SeoSurfaceOptions): SeoSurfaceHandle {
  const slot = document.createElement("div");
  /* The layer is `pointer-events: none` so a click passes through it when nothing is up, and every
     slot in it turns them back on for its own content. `pointer-events` INHERITS, and the top layer
     changes paint order rather than inheritance, so a modal `<dialog>` in a slot that skipped this
     is painted above everything and hit-tests to nothing. */
  slot.style.pointerEvents = "auto";
  options.layer.append(slot);

  let closed = false;
  /**
   * Say it is over, once.
   *
   * Two paths reach here and either may be first: the platform's own `close`, which `close()`
   * provokes, and `close()` on a dialog that never got as far as being shown.
   */
  const finish = (): void => {
    if (closed) {
      return;
    }
    closed = true;
    options.onClosed();
  };

  const scope = reactive({
    ...derive(options.view),
    browse: (key: string, anchor: unknown) => {
      if (anchor instanceof HTMLElement) {
        options.onBrowse(key, anchor);
      }
    },
    closed: finish,
    commit: (key: string, value: string) => {
      options.onCommit(key, value);
    },
    edit: (key: string, value: string) => {
      options.onEdit(key, value);
    },
    openDonor: (key: string) => {
      options.onOpenDonor(key);
    },
    upload: (key: string) => {
      options.onUpload(key);
    },
  }) as SeoScope;

  let mounted: SurfaceHandle | null = null;
  const ready = mountSurface("seo", scope, slot).then(async (surface) => {
    mounted = surface;
    const element = surface.root as HTMLElement;
    if (closed) {
      surface.dispose();
      return element;
    }
    await whenReady(element);
    if (closed) {
      return element;
    }
    showModal(element);
    return element;
  });

  return {
    close() {
      /* Guarded on the WORK rather than on `closed`, and the difference is a slot that would
         otherwise be left behind: the platform's own `close` runs `finish()` before any caller
         reaches here, so a `close()` that returned early on `closed` would take the dialog down and
         leave its host div in the layer. Every line below is idempotent instead. */
      const element = mounted?.root;
      if (element instanceof HTMLElement) {
        // The platform's close first, so focus goes back where it came from; then the document.
        closeDialog(element);
      }
      // A mount that has not landed yet is disposed by `ready` when it does — `finish` tells it so.
      mounted?.dispose();
      mounted = null;
      slot.remove();
      finish();
    },
    host: slot,
    ready,
    update(view) {
      Object.assign(scope, derive(view));
    },
  };
}
