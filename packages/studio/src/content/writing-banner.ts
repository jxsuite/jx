/// <reference lib="dom" />
/**
 * The writing-mode banner: what the canvas says while a collection entry is written inside its
 * template's layout (`specs/studio.md` §22.5).
 *
 * "Writing mode: text and media are editable, the layout is locked", with **Edit the <item>
 * template in Design**. The template it opens is the collection's template PAGE when the project
 * has one (the page whose `$paths.contentType` names the collection,
 * `content/collection-pages.ts`), because that is the page that decides what an entry looks like on
 * the site; with no such page it is the layout the entry is drawn in. Opening either activates it,
 * and activating a page or a layout enters Design (§22.1).
 *
 * One banner per pane, mounted into the host the canvas stage draws above Edit's column
 * (`surfaces/canvas-stage.json`'s `writing-banner`), exactly as the Document Header card is mounted
 * into its own; `canvas/canvas-render.ts` hands the host over and repaints it.
 *
 * @docs studio/projects/content-types
 */

import { isString } from "@jxsuite/schema/guards";
import { paneRegion } from "../ui/regions";
import { workspace } from "../workspace/workspace";
import { collectionForFile } from "./collection-match";
import { contentCollection, templateDisplayName } from "./content-collections";
import {
  entryLayoutPath,
  entryLocale,
  onCollectionPagesRead,
  peekCollectionPage,
} from "./collection-pages";
import { mountWritingBannerSurface } from "../surfaces/writing-banner";
import type { Tab } from "../tabs/tab";
import type { WritingBannerHandle, WritingBannerView } from "../surfaces/writing-banner";

/** The sentence the banner always says. */
export const WRITING_MODE_TEXT = "Writing mode: text and media are editable, the layout is locked";

/** Where the banner's button goes, and what it is called. `null` when there is nothing to open. */
export interface BannerTarget {
  path: string;
  /** The button's text, as `WritingBannerView.actionLabel` draws it. */
  actionLabel: string;
}

/**
 * What an entry's banner opens: its collection's page, else the layout it is drawn in.
 *
 * Each label names the file it opens. The collection's page is called what the Content home's
 * header line calls it ("Design the post page"), so the two surfaces that reach it agree; a layout
 * is a template everywhere in Studio, and is called one by its own name.
 */
export function bannerTarget(tab: Tab): BannerTarget | null {
  const match = collectionForFile(tab.documentPath);
  if (!match) {
    return null;
  }
  const item = contentCollection(match.name)?.item ?? "entry";
  const page = peekCollectionPage(match.name, entryLocale(tab.documentPath));
  if (page) {
    return { actionLabel: `Design the ${item} page`, path: page.path };
  }
  const own = tab.doc.document.$layout ?? tab.doc.content.frontmatter.$layout;
  const layout = entryLayoutPath(isString(own) || own === false ? own : undefined, page ?? null);
  if (!layout) {
    return null;
  }
  return {
    actionLabel: `Edit the ${templateDisplayName(layout)} template in Design`,
    path: layout.replace(/^\.\//, ""),
  };
}

/** What the banner over `tab` in `paneId` draws. */
export function writingBannerView(paneId: string, tab: Tab): WritingBannerView {
  const target = bannerTarget(tab);
  return {
    actionLabel: target?.actionLabel ?? "",
    actionState: target ? "shown" : "hidden",
    region: paneRegion(paneId, "writing-banner"),
    text: WRITING_MODE_TEXT,
  };
}

// ─── Mounting ────────────────────────────────────────────────────────────────

interface StandingBanner {
  host: HTMLElement;
  handle: WritingBannerHandle;
  /** The tab the banner was last drawn for: what its button opens the template of. */
  tabId: string | null;
}

const _banners = new Map<string, StandingBanner>();
let _unlisten: (() => void) | null = null;

/** Open the template of the entry a pane's banner is over. */
async function openTemplate(paneId: string): Promise<void> {
  const tabId = _banners.get(paneId)?.tabId;
  const tab = tabId ? workspace.tabs.get(tabId) : undefined;
  const target = tab ? bannerTarget(tab) : null;
  if (!target) {
    return;
  }
  const { openFileInTab } = await import("../files/files");
  await openFileInTab(target.path);
}

/** Repaint every banner: the collection pages it names its button from have just been read. */
function repaintAll(): void {
  for (const [paneId, banner] of _banners) {
    const tab = banner.tabId ? workspace.tabs.get(banner.tabId) : undefined;
    if (tab) {
      banner.handle.update(writingBannerView(paneId, tab));
    }
  }
}

/**
 * Take a pane's banner host, or let it go (`null`).
 *
 * The stage announces the host when it draws the `writing` or `banner` lead; the same host comes
 * back on every repaint that keeps that lead, so a second announcement of it changes nothing.
 */
export function attachWritingBanner(paneId: string, host: HTMLElement | null): void {
  const held = _banners.get(paneId);
  if (held?.host === host) {
    return;
  }
  if (held) {
    held.handle.dispose();
    _banners.delete(paneId);
  }
  if (!host) {
    return;
  }
  _unlisten ??= onCollectionPagesRead(repaintAll);
  const handle = mountWritingBannerSurface(
    host,
    {
      actionLabel: "",
      actionState: "hidden",
      region: paneRegion(paneId, "writing-banner"),
      text: WRITING_MODE_TEXT,
    },
    {
      openTemplate: () => {
        void openTemplate(paneId);
      },
    },
  );
  _banners.set(paneId, { handle, host, tabId: null });
}

/** Draw a pane's banner for the entry it is over. A pane with no banner host is left alone. */
export function renderWritingBanner(paneId: string, tab: Tab): void {
  const banner = _banners.get(paneId);
  if (!banner) {
    return;
  }
  banner.tabId = tab.id;
  banner.handle.update(writingBannerView(paneId, tab));
}

/** Take a pane's banner down (its lead went away, or the pane did). Idempotent. */
export function detachWritingBanner(paneId: string): void {
  attachWritingBanner(paneId, null);
}

/** Take every banner down — tests. */
export function resetWritingBanners(): void {
  for (const paneId of _banners.keys()) {
    detachWritingBanner(paneId);
  }
  _unlisten?.();
  _unlisten = null;
}
