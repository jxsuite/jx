/**
 * A tab's remote data: what its document's requests and server functions answered, kept for as long
 * as the tab is open (studio.md §4.5).
 *
 * The canvas frame is what runs a lookup (`canvas/iframe-remote.ts`), because the frame's runtime
 * is the one resolver a canvas has: a URL that reads a state value is only known there. But a frame
 * is the wrong place to KEEP an answer. It is reused from tab to tab, Design draws one per
 * breakpoint, and it reloads. So each answer is posted here, to the tab's **session**, and every
 * render carries the session's answers back, which is what makes "fetched once" true across
 * renders, across artboards and across a frame that rebooted.
 *
 * Refresh is the one verb that fetches again: it starts a new session, with a new name, and a frame
 * that sees a name it does not know forgets what it held.
 *
 * @docs studio/logic/data
 */

import { getPlatform, hasPlatform } from "../platform";
import { toRaw } from "../reactivity";
import type { RemoteResult, RemoteWire } from "./iframe-protocol";
import type { Tab } from "../tabs/tab";

/** One tab's kept answers. */
interface TabRemote {
  /** Counts the tab's Refreshes: part of the session's name. */
  epoch: number;
  results: Map<string, RemoteResult>;
  /**
   * The frame that fetches what the session lacks, as its host's identity. Exactly one: every
   * artboard of a Design view draws the same document, and each fetching for itself would be one
   * request per breakpoint.
   */
  fetcher: WeakKey | null;
  /** Whether the author has been told this host resolves no collections. */
  noticedSources: boolean;
}

/** By tab, and gone with it: an answer is kept for as long as the document is open. */
const byTab = new WeakMap<Tab, TabRemote>();

/** `tab`'s record, made on first use. */
function recordOf(tab: Tab): TabRemote {
  /* The tab itself, not whichever reactive proxy of it the caller holds: the workspace hands out
     both, and two keys for one tab would be two sessions for one document. */
  const key = toRaw(tab);
  let record = byTab.get(key);
  if (!record) {
    record = { epoch: 0, fetcher: null, noticedSources: false, results: new Map() };
    byTab.set(key, record);
  }
  return record;
}

/** The name of `tab`'s current session, which a frame keys what it holds on. */
export function remoteSession(tab: Tab): string {
  return `${tab.id}:${recordOf(tab).epoch}`;
}

/** The id of the tab a session's name was made from. A tab's id never holds what follows it. */
export function remoteSessionTabId(session: string): string {
  return session.slice(0, Math.max(0, session.lastIndexOf(":")));
}

/**
 * What a render of `tab` on `host` is told about the tab's remote data.
 *
 * The first host asked becomes the session's fetcher and stays it while `isLive` says it is still
 * there; a host that has gone (a closed pane, a breakpoint removed) hands the role to the next one
 * asked.
 *
 * @param tab The tab being drawn.
 * @param host The host the render is posted to, by identity.
 * @param isLive Whether a host is still on screen.
 */
export function remoteWireFor(
  tab: Tab,
  host: WeakKey,
  isLive: (host: WeakKey) => boolean,
): RemoteWire {
  const record = recordOf(tab);
  if (record.fetcher === null || !isLive(record.fetcher)) {
    record.fetcher = host;
  }
  return {
    fetch: record.fetcher === host,
    results: Object.fromEntries(record.results),
    /* A `timing: "server"` function runs in the backend, through the same door a class is
       resolved through. A host with no such door (the cloud) can run none. */
    server: hasPlatform() && getPlatform().resolveClass !== undefined,
    session: remoteSession(tab),
  };
}

/**
 * Keep an answer a frame reported. Returns whether it was taken: one for a session a Refresh has
 * since replaced is dropped, and so is a second answer to a lookup already answered.
 */
export function recordRemoteResult(
  tab: Tab,
  session: string,
  key: string,
  result: RemoteResult,
): boolean {
  const record = recordOf(tab);
  if (session !== remoteSession(tab) || record.results.has(key)) {
    return false;
  }
  record.results.set(key, result);
  return true;
}

/** Forget every answer `tab` holds, so its next render fetches again: the Data panel's Refresh. */
export function refreshRemoteData(tab: Tab): void {
  const record = recordOf(tab);
  record.epoch += 1;
  record.results = new Map();
  record.fetcher = null;
}

/**
 * Whether the author still has to be told that this host resolves no collections, answered once per
 * tab: a page with six lists says it once, and so does a page drawn sixty times.
 */
export function takeSourcesNotice(tab: Tab): boolean {
  const record = recordOf(tab);
  if (record.noticedSources) {
    return false;
  }
  record.noticedSources = true;
  return true;
}
