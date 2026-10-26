/**
 * The Studio document host (src/services/harness/studio-documents.ts) and the transaction door it
 * writes through, `applyDocOpsAsUser` (src/tabs/transact.ts): specs/ai.md §3.9.
 */
import "./with-dom.ts";
import { afterEach, describe, expect, test } from "bun:test";
import type { DocEdit, DocumentRef, SelectionEffect } from "@jxsuite/ai/jx-tools";
import { FROZEN_SENTENCE } from "@jxsuite/ai/jx-tools";
import { createToolContext } from "@jxsuite/ai/tools";
import type { JxDocOp } from "@jxsuite/schema/doc-ops";
import { isString } from "@jxsuite/schema/guards";
import type { JxMutableNode } from "@jxsuite/schema/types";
import { toRaw } from "../src/reactivity";
import { NO_DOCUMENT_SENTENCE, studioDocumentHost } from "../src/services/harness/studio-documents";
import type { StudioDocumentHost } from "../src/services/harness/studio-documents";
import { createTab, disposeTab } from "../src/tabs/tab";
import type { Tab } from "../src/tabs/tab";
import { applyDocOpsAsUser, setTransactGate, undo } from "../src/tabs/transact";

const tabs: Tab[] = [];

function makeTab(documentPath?: string): Tab {
  const document: JxMutableNode = {
    children: [
      { tagName: "p", textContent: "a" },
      { children: [{ tagName: "em" }], tagName: "section" },
    ],
    tagName: "div",
  };
  const tab = createTab(documentPath ? { document, documentPath, id: "t" } : { document, id: "t" });
  tabs.push(tab);
  return tab;
}

afterEach(() => {
  setTransactGate(null);
  for (const tab of tabs.splice(0)) {
    disposeTab(tab);
  }
});

const setId: JxDocOp = { key: "id", op: "set-key", path: ["children", 0], value: "x" };

describe("applyDocOpsAsUser", () => {
  test("no ops is no transaction: no new root, no history entry, nothing dirty", () => {
    const tab = makeTab();
    const root = tab.doc.document;
    expect(applyDocOpsAsUser(tab, [])).toBe("unchanged");
    expect(tab.doc.document).toBe(root);
    expect(tab.history.snapshots).toHaveLength(1);
    expect(tab.doc.dirty).toBe(false);
  });

  test("records each op with its real inverse, so undo restores the document", () => {
    const tab = makeTab();
    const before = JSON.stringify(toRaw(tab.doc.document));
    expect(applyDocOpsAsUser(tab, [setId])).toBe("applied");
    const entry = tab.history.snapshots.at(-1)!;
    expect(entry.forwardOps).toEqual([setId]);
    expect(entry.inverseOps).toEqual([{ key: "id", op: "set-key", path: ["children", 0] }]);
    undo(tab);
    expect(JSON.stringify(toRaw(tab.doc.document))).toBe(before);
  });

  test("answers refused when the gate refuses, and changes nothing", () => {
    const tab = makeTab();
    setTransactGate(() => "frozen");
    expect(applyDocOpsAsUser(tab, [setId])).toBe("refused");
    expect(tab.history.snapshots).toHaveLength(1);
  });

  test("an op that cannot apply rolls back the ones before it, and the selection", () => {
    const tab = makeTab();
    tab.session.selection = [["children", 1, "children", 0]];
    const before = JSON.stringify(toRaw(tab.doc.document));
    const bad: JxDocOp = { index: 0, op: "remove-child", parentPath: ["children", 9] };
    expect(() =>
      applyDocOpsAsUser(tab, [setId, bad], {
        selection: { kind: "prune", under: [["children", 1, "children"]] },
      }),
    ).toThrow("doc-op-node-not-found");
    expect(JSON.stringify(toRaw(tab.doc.document))).toBe(before);
    expect(tab.session.selection).toEqual([["children", 1, "children", 0]]);
  });

  test("prune drops the selection under each path it names", () => {
    const tab = makeTab();
    tab.session.selection = [
      ["children", 1, "children", 0],
      ["children", 0],
    ];
    applyDocOpsAsUser(tab, [{ key: "children", op: "set-key", path: ["children", 1], value: [] }], {
      selection: { kind: "prune", under: [["children", 1, "children"]] },
    });
    expect(tab.session.selection).toEqual([["children", 0]]);
  });

  test("follow moves the selection only when its primary path is the moved node", () => {
    const move: JxDocOp = {
      fromIndex: 0,
      fromParentPath: [],
      op: "move-child",
      toIndex: 1,
      toParentPath: [],
    };
    const follow: SelectionEffect = { from: ["children", 0], kind: "follow", to: ["children", 1] };
    const tab = makeTab();
    tab.session.selection = [["children", 0]];
    applyDocOpsAsUser(tab, [move], { selection: follow });
    expect(tab.session.selection).toEqual([["children", 1]]);

    const other = makeTab();
    other.session.selection = [["children", 1]];
    applyDocOpsAsUser(other, [move], { selection: follow });
    expect(other.session.selection).toEqual([["children", 1]]);
  });
});

describe("studioDocumentHost", () => {
  const ctx = createToolContext();
  const accept: (doc: Readonly<JxMutableNode>) => DocEdit = () => ({
    ok: true,
    ops: [setId],
    selection: { kind: "keep" },
    summary: "done",
  });
  const meta = { actor: ctx.actor, callId: "c", tool: "set_property" };

  /** The ref `host` resolves, failing the test when it answers a refusal. */
  function refOf(host: StudioDocumentHost): DocumentRef {
    const ref = host.resolve(ctx);
    if (isString(ref)) {
      throw new TypeError(ref);
    }
    return ref;
  }

  test("resolves the active tab, or answers the no-document sentence", () => {
    expect(studioDocumentHost({ getTab: () => null }).resolve(ctx)).toBe(NO_DOCUMENT_SENTENCE);
    const saved = makeTab("pages/a.json");
    const host = studioDocumentHost({ getTab: () => saved });
    const ref = refOf(host);
    expect(ref).toEqual({ id: "t", path: "pages/a.json" });
    expect(host.tabOf(ref)).toBe(saved);
    const untitled = makeTab();
    expect(studioDocumentHost({ getTab: () => untitled }).resolve(ctx)).toEqual({
      id: "t",
      path: null,
    });
  });

  test("a ref stays on the tab it was resolved to when the active tab changes", () => {
    const first = makeTab();
    const second = makeTab();
    let active = first;
    const host = studioDocumentHost({ getTab: () => active });
    const ref = refOf(host);
    active = second;
    expect(host.snapshot(ref)).toBe(toRaw(first.doc.document));
    expect(host.edit(ref, accept, meta)).toEqual({ applied: true, changed: true });
    expect(second.history.snapshots).toHaveLength(1);
  });

  test("refuses a ref it never issued, a producer's refusal, and a frozen document", () => {
    const tab = makeTab();
    const host = studioDocumentHost({ getTab: () => tab });
    expect(host.tabOf({ id: "t", path: null })).toBeNull();
    expect(host.edit({ id: "t", path: null }, accept, meta)).toEqual({
      applied: false,
      message: NO_DOCUMENT_SENTENCE,
      reason: "not-open",
    });
    const ref = refOf(host);
    expect(host.edit(ref, () => ({ error: "no", ok: false }), meta)).toEqual({
      applied: false,
      message: "no",
      reason: "refused",
    });
    setTransactGate(() => "frozen");
    expect(host.edit(ref, accept, meta)).toEqual({
      applied: false,
      message: FROZEN_SENTENCE,
      reason: "frozen",
    });
  });

  test("an edit with no ops is applied and unchanged", () => {
    const tab = makeTab();
    const host = studioDocumentHost({ getTab: () => tab });
    const ref = refOf(host);
    const none = () => ({ ok: true, ops: [], selection: { kind: "keep" }, summary: "" }) as const;
    expect(host.edit(ref, none, meta)).toEqual({ applied: true, changed: false });
  });
});
