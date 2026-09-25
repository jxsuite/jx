/**
 * Tests for tests/harness/score.ts — the headless eval's scorer reads the settled document out of
 * the tab's reactive proxy.
 */
import "./with-dom.ts";
import { expect, test } from "bun:test";
import { createTab, disposeTab } from "../src/tabs/tab";
import { EMPTY_TURN_TEXT } from "../src/services/tool-executor";
import { rawDoc, unscorableError } from "./harness/score";

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

/* An empty reply is the model's answer, and the worst one, so the headless eval scores it rather
   than dropping the run as errored and letting worst-of-N pick a better one. */
test("a failed request cannot be scored, and an empty reply can", () => {
  expect(unscorableError({ error: "API error 400", status: "error" })).toBe("API error 400");
  expect(unscorableError({ error: EMPTY_TURN_TEXT, status: "error" })).toBeNull();
  expect(unscorableError({ error: null, status: "idle" })).toBeNull();
});
