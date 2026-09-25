/**
 * Gap coverage for `src/panels/head-panel.ts` — the defensive branches inside the custom `$head`
 * entry's Remove, which the main `head-panel.test.ts` cannot reach because it always mutates the
 * same document it drew.
 *
 * The panel is a document now (`src/surfaces/panel-page.json`), so the Remove button is addressed
 * by its `part` and the row it sits in by the `data-tag` key the projection minted. What is being
 * exercised is unchanged: a mutation handed a document whose `$head` is absent, and one whose
 * `$head` does not contain the entry the row was drawn for.
 */
import { flush, installMockPlatform, pointer, resetStudioState } from "./harness";
import { beforeEach, describe, expect, test } from "bun:test";
import { renderPagePanel } from "../src/panels/head-panel";
import { closeAllTabs } from "../src/workspace/workspace";

import type { JxHeadEntry, JxMutableNode } from "@jxsuite/schema/types";

const CUSTOM_ENTRY: JxHeadEntry = {
  attributes: { content: "noindex", name: "robots" },
  tagName: "meta",
};

/** Draw the panel over one document while its mutations are applied to a _different_ one. */
async function drawAgainst(mutationDoc: JxMutableNode) {
  const drawnDoc = { $head: [CUSTOM_ENTRY], tagName: "html" } as unknown as JxMutableNode;
  const counts = { leftPanelRenders: 0, mutations: 0 };
  const host = document.createElement("div");
  document.body.append(host);
  renderPagePanel(host, {
    applyMutation: (fn) => {
      counts.mutations += 1;
      fn(mutationDoc);
    },
    document: drawnDoc,
    renderLeftPanel: () => {
      counts.leftPanelRenders += 1;
    },
  });
  await flush(4);
  const remove = host.querySelector<HTMLElement>('[part="tag-row"] [part="remove"]');
  if (!remove) {
    throw new Error("custom entry Remove was not drawn");
  }
  return { counts, host, remove };
}

describe("head-panel custom tag removal (defensive branches)", () => {
  beforeEach(() => {
    for (const stale of document.querySelectorAll("body > div:not([id])")) {
      stale.remove();
    }
    closeAllTabs();
    resetStudioState();
    installMockPlatform();
  });

  test("Remove is a no-op when the mutated document has no $head", async () => {
    const mutationDoc = { tagName: "html" } as unknown as JxMutableNode;
    const r = await drawAgainst(mutationDoc);

    pointer(r.remove, "click");

    expect(r.counts.mutations).toBe(1);
    expect(r.counts.leftPanelRenders).toBe(1);
    // The guard returned early: no $head was created or modified.
    expect(mutationDoc.$head).toBeUndefined();
  });

  test("Remove leaves $head untouched when the entry is not present", async () => {
    const otherEntry: JxHeadEntry = {
      attributes: { content: "abc", name: "verification" },
      tagName: "meta",
    };
    const mutationDoc = { $head: [otherEntry], tagName: "html" } as unknown as JxMutableNode;
    const r = await drawAgainst(mutationDoc);

    pointer(r.remove, "click");

    expect(r.counts.mutations).toBe(1);
    expect(r.counts.leftPanelRenders).toBe(1);
    // IndexOf returned -1, so nothing was spliced.
    expect(mutationDoc.$head).toHaveLength(1);
    expect(mutationDoc.$head?.[0]).toBe(otherEntry);
  });

  test("Remove splices the entry when the mutated document does hold it", async () => {
    const mutationDoc = {
      $head: [CUSTOM_ENTRY],
      tagName: "html",
    } as unknown as JxMutableNode;
    const r = await drawAgainst(mutationDoc);

    pointer(r.remove, "click");

    expect(r.counts.mutations).toBe(1);
    expect(mutationDoc.$head).toHaveLength(0);
  });

  test("a key whose entry the projection no longer holds asks for no mutation at all", async () => {
    const mutationDoc = { $head: [CUSTOM_ENTRY], tagName: "html" } as unknown as JxMutableNode;
    const r = await drawAgainst(mutationDoc);
    /* The panel is redrawn over a document with no custom tags, which empties the key table, and
       THEN the button that row drew is pressed. A key that no longer names an entry must ask for
       nothing: the alternative is a splice against whatever now sits at that position. */
    renderPagePanel(r.host, {
      applyMutation: (fn) => {
        r.counts.mutations += 1;
        fn(mutationDoc);
      },
      document: { tagName: "html" } as unknown as JxMutableNode,
      renderLeftPanel: () => {
        r.counts.leftPanelRenders += 1;
      },
    });
    await flush(3);
    const before = r.counts.mutations;
    pointer(r.remove, "click");
    expect(r.counts.mutations).toBe(before);
    expect(mutationDoc.$head).toHaveLength(1);
  });
});
