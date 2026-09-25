/**
 * Tests for tests/harness/score.ts — the headless eval's scorer reads the settled document out of
 * the tab's reactive proxy.
 */
import "./with-dom.ts";
import { expect, test } from "bun:test";
import { createTab, disposeTab } from "../src/tabs/tab";
import { rawDoc } from "./harness/score";

test("rawDoc clones the live document out of its reactive proxy", () => {
  const tab = createTab({
    document: { children: [{ tagName: "p" }], tagName: "div" },
    id: "score",
  });
  const copy = rawDoc(tab);
  expect(copy).toEqual({ children: [{ tagName: "p" }], tagName: "div" });
  (copy.children as object[]).push({ tagName: "span" });
  expect(tab.doc.document.children).toHaveLength(1);
  disposeTab(tab);
});
