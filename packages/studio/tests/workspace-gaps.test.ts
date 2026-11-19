/**
 * Workspace gaps (C7): closeTab early return, closeAllTabs — paths not covered by
 * tests/workspace.test.ts.
 */
import "./with-dom.js";
import { beforeEach, describe, expect, test } from "bun:test";
import { effect } from "../src/reactivity";
import {
  activeTab,
  closeAllTabs,
  closeTab,
  openTab,
  tabIsLive,
  workspace,
} from "../src/workspace/workspace";
import type { Tab } from "../src/tabs/tab";

beforeEach(() => {
  closeAllTabs();
});

/**
 * The question a CAPTURED tab owes before anything is written into it.
 *
 * Both Monaco surfaces commit on a debounce, and a debounce is a promise to write into a tab that
 * was open half a second ago. `null` is one of the answers callers rely on: `commitTabBuffers`
 * flushes a buffer whose `_editingTab` may be nothing at all.
 */
describe("tabIsLive", () => {
  test("is false for no tab, for a closed one, and for a stale object of the same id", () => {
    const nothing: Tab | undefined = undefined;
    expect(tabIsLive(null)).toBe(false);
    expect(tabIsLive(nothing)).toBe(false);

    const tab = openTab({ document: { tagName: "div" }, id: "t1" });
    expect(tabIsLive(tab)).toBe(true);

    // Same id, different object: a tab that was closed and reopened is not the tab a commit was
    // Promised to, and writing into it would push history onto a document nobody asked about.
    const stale: Tab = { ...tab, id: "t1" };
    expect(tabIsLive(stale)).toBe(false);

    closeTab("t1");
    expect(tabIsLive(tab)).toBe(false);
  });
});

describe("closeTab early return", () => {
  test("closing a nonexistent tab id is a no-op", () => {
    openTab({ document: { tagName: "div" }, id: "t1" });
    closeTab("does-not-exist");
    expect(workspace.tabs.size).toBe(1);
    expect(workspace.activeTabId).toBe("t1");
    expect(workspace.tabOrder).toEqual(["t1"]);
  });
});

describe("closeAllTabs", () => {
  test("clears tabs, order, and active id", () => {
    openTab({ document: { tagName: "div" }, id: "a" });
    openTab({ document: { tagName: "span" }, id: "b" });

    closeAllTabs();

    expect(workspace.tabs.size).toBe(0);
    expect(workspace.tabOrder).toEqual([]);
    expect(workspace.activeTabId).toBeNull();
    expect(activeTab.value).toBeNull();
  });

  test("disposes every tab scope", () => {
    const t1 = openTab({ document: { tagName: "div" }, id: "a" });
    const t2 = openTab({ document: { tagName: "span" }, id: "b" });
    let runs1 = 0;
    let runs2 = 0;
    t1.scope.run(() => {
      effect(() => {
        runs1 += 1;
        void t1.doc.dirty;
      });
    });
    t2.scope.run(() => {
      effect(() => {
        runs2 += 1;
        void t2.doc.dirty;
      });
    });

    closeAllTabs();
    t1.doc.dirty = true;
    t2.doc.dirty = true;

    expect(runs1).toBe(1);
    expect(runs2).toBe(1);
  });
});
