/**
 * Studio-documents.ts — the open tab as a `DocumentHost` for the portable tree tools (specs/ai.md
 * §3.9).
 *
 * The producers in `@jxsuite/ai/jx-tools` plan an edit as doc ops; this host resolves the call to
 * the active tab, hands the producer the raw document, and applies its ops through
 * `applyDocOpsAsUser`, so an assistant edit is an ordinary transaction: the gate, the turn's batch
 * lane, history, the canvas patch and the collab observer all see it the way they see the
 * person's.
 *
 * @license MIT
 */

import type { DocumentHost, DocumentRef, WriteReporter } from "@jxsuite/ai/jx-tools";
import { FROZEN_SENTENCE } from "@jxsuite/ai/jx-tools";
import { toRaw } from "../../reactivity";
import type { Tab } from "../../tabs/tab";
import { applyDocOpsAsUser } from "../../tabs/transact";
import { reportDocumentWrite, snapshotBeforeWrite } from "../ai-write-report";
import type { WriteReportDeps, WriteSnapshot } from "../ai-write-report";

/** What a tree tool reads when no document is open. */
export const NO_DOCUMENT_SENTENCE =
  "No document is open — use open_document(path) to open one on the canvas, or " +
  "read_file/write_file to work with project files directly.";

/** A {@link DocumentHost} over Studio's tabs, which can also name the tab behind a ref. */
export interface StudioDocumentHost extends DocumentHost {
  /** The tab `ref` was resolved to, or null for a ref this host never issued. */
  readonly tabOf: (ref: DocumentRef) => Tab | null;
}

/**
 * The host the tree tools edit through. A call is pinned to the tab active when it began: a ref
 * holds that tab for the whole call, so a person switching tabs during the call's validation does
 * not redirect its write.
 *
 * @param {{ getTab: () => Tab | null }} deps
 * @returns {StudioDocumentHost}
 */
export function studioDocumentHost({ getTab }: { getTab: () => Tab | null }): StudioDocumentHost {
  const tabs = new WeakMap<DocumentRef, Tab>();

  function tabOf(ref: DocumentRef): Tab | null {
    return tabs.get(ref) ?? null;
  }

  return {
    edit(ref, produce, { actor }) {
      const tab = tabOf(ref);
      if (!tab) {
        return { applied: false, message: NO_DOCUMENT_SENTENCE, reason: "not-open" };
      }
      // Planned and applied in one synchronous step, against the raw tree (never the proxy).
      const edit = produce(toRaw(tab.doc.document));
      if (!edit.ok) {
        return { applied: false, message: edit.error, reason: "refused" };
      }
      /* Named, not inferred: the write joins the turn's batch lane by its actor (specs/ai.md §3.3).
         A refusal is the collab gate pausing structural edits while source is canonical, which the
         model must be told rather than congratulated on. */
      const outcome = applyDocOpsAsUser(tab, edit.ops, { actor, selection: edit.selection });
      if (outcome === "refused") {
        return { applied: false, message: FROZEN_SENTENCE, reason: "frozen" };
      }
      return { applied: true, changed: outcome === "applied" };
    },
    resolve() {
      const tab = getTab();
      if (!tab) {
        return NO_DOCUMENT_SENTENCE;
      }
      const ref: DocumentRef = { id: tab.id, path: tab.documentPath ?? null };
      tabs.set(ref, tab);
      return ref;
    },
    snapshot(ref) {
      /* SAFETY: every ref a tree tool snapshots came from `resolve` on this host in the same call,
         and `resolve` registers the tab before it returns the ref. */
      return toRaw(tabOf(ref)!.doc.document);
    },
    tabOf,
    undoable: "document",
  };
}

/**
 * The write verdict (`ai-write-report.ts`) as a reporter: the schema errors and render state before
 * the write, and the new errors, the render check and the token hints after it.
 *
 * @param {StudioDocumentHost} host
 * @param {WriteReportDeps} deps
 * @returns {WriteReporter<WriteSnapshot>}
 */
export function studioWriteReporter(
  host: StudioDocumentHost,
  deps: WriteReportDeps,
): WriteReporter<WriteSnapshot> {
  return {
    /* SAFETY (both): the entries bracket only a write whose ref `resolve` issued in the same call,
       so the host still holds its tab. */
    after: (ref, before, summary) => reportDocumentWrite(host.tabOf(ref)!, before, summary, deps),
    before: (ref) => snapshotBeforeWrite(host.tabOf(ref)!, deps),
  };
}
