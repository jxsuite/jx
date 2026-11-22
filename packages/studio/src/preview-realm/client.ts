/// <reference lib="dom" />
/**
 * The one preview realm of this window, and how a surface asks it for something (`project-state.md`
 * §11.2, `studio.md` §9.1.2).
 *
 * A surface never imports a project module and never defines a project element: it names the
 * document it wants by `DocId` (the path, while the host indexes no document there) and hands the
 * realm the document as the content store holds it. The bytes come from the store when it has them
 * and from the platform otherwise, and a read fills the store, so a preview is a function of the
 * same `(docId, hash)` entries every other cache derives from (§11.1).
 *
 * The realm belongs to the open project: opening another replaces it, since every definition it
 * holds is the old project's.
 *
 * @docs studio/interface
 */

import { contentHash } from "@jxsuite/protocol/project-state";
import { isString } from "@jxsuite/schema/guards";
import { getPlatform, hasPlatform } from "../platform";
import { contentStore } from "../project-state/store";
import { bundleUrl } from "../services/bundle-base";
import { projectState } from "../store";
import { createPreviewRealmHost, frameRealm } from "./host";
import type { PreviewRealmHost, RealmFactory } from "./host";

let _factory: RealmFactory | null = null;
let _host: PreviewRealmHost | null = null;
/** The project the realm was made for; another one replaces it. */
let _project: string | null = null;
/** Who hears that a realm was replaced because what it held went stale. */
const _replacedListeners = new Set<() => void>();

/**
 * Call `listener` each time this window's realm is replaced because a definition it holds changed
 * (at once, or when a reply in flight shows the realm defined it), or another project opened.
 * Answers the function that stops it.
 */
export function onPreviewRealmReplaced(listener: () => void): () => void {
  _replacedListeners.add(listener);
  return () => {
    _replacedListeners.delete(listener);
  };
}

function realmReplaced(): void {
  for (const listener of _replacedListeners) {
    listener();
  }
}

/** The canvas document, as the platform names it (`iframe-host.ts`'s `resolveCanvasUrl`). */
function canvasDocumentUrl(): string {
  return (hasPlatform() ? getPlatform().canvasUrl : undefined) || bundleUrl("../canvas.html");
}

/** The window's realm as Studio boots it: the frame, in the shell's body. */
export function framePreviewRealm(): ReturnType<RealmFactory> {
  return frameRealm({ canvasUrl: canvasDocumentUrl(), parent: document.body });
}

/** What a window with no realm installed answers: every preview fails, saying why. */
function noRealm(): never {
  throw new Error("no preview realm is installed");
}

/**
 * Make realms with `factory` from now on: Studio installs {@link framePreviewRealm} as it boots, and
 * a test an in-process realm. `null` takes the factory away. The realm standing now is replaced.
 */
export function setPreviewRealmFactory(factory: RealmFactory | null): void {
  _host?.replace();
  _host = null;
  _factory = factory;
}

/** This window's realm, replaced first when the open project is not the one it was made for. */
export function previewRealm(): PreviewRealmHost {
  const project = projectState?.projectRoot ?? null;
  if (_host !== null && project !== _project) {
    _host.replace();
  }
  _project = project;
  _host ??= createPreviewRealmHost(_factory ?? noRealm, undefined, realmReplaced);
  return _host;
}

/**
 * Definitions of `tags` changed (a save, a change on disk, a `dependentsInvalidated`): replace the
 * realm if it holds one of them. Answers whether it did.
 */
export function previewDefinitionsChanged(tags: readonly string[]): boolean {
  return _host?.definitionsChanged(tags) ?? false;
}

/**
 * The set of discoverable components changed (`componentsChanged`): a tag the realm defines may now
 * be defined by another file, or by none, so a realm that defines any is replaced.
 */
export function previewComponentsChanged(): boolean {
  const host = _host;
  if (host === null || host.tags().size === 0) {
    return false;
  }
  host.replace();
  return true;
}

/**
 * Moves each time this window's realm is made or let go: a preview that failed in one may draw in
 * the next, and one a replaced realm drew may be stale.
 */
export function previewRealmGeneration(): number {
  return _host?.generation() ?? 0;
}

/** The requests the realm has not answered, as the idle probe reads them (`services/idle.ts`). */
export function previewRealmIdleBlockers(): string[] {
  const count = _host?.inFlight() ?? 0;
  return count > 0 ? [`preview realm: ${count} request(s) in flight`] : [];
}

/** The `DocId` the realm is asked by: the store's document at `path`, else the path itself. */
export function realmDocId(path: string): string {
  return contentStore.docAt(path)?.docId ?? path;
}

/**
 * The text of the document at `path`, from the content store when it holds the current bytes, else
 * read through the platform. When the store indexes a document there (a subscription filled it), a
 * read is held in the store under the hash of the bytes it read, as a tab's read is
 * (`project-state/buffer.ts`).
 *
 * A write Studio made at `path` whose echo has not arrived means the store's bytes there are the
 * ones the write replaced: the host has not said so yet, and a definition read from them would be
 * the one just saved over. The platform has the written bytes, so they are read from it then.
 */
export async function storedText(path: string): Promise<string> {
  const held =
    contentStore.pendingWriteAt(path) === undefined ? contentStore.contentsAt(path) : undefined;
  if (isString(held)) {
    return held;
  }
  const text = await getPlatform().readFile(path);
  if (contentStore.docAt(path) !== undefined) {
    try {
      contentStore.put(path, await contentHash(text), text);
    } catch {
      // Unhashable here (no `crypto.subtle` outside a secure context): the read is not held.
    }
  }
  return text;
}
