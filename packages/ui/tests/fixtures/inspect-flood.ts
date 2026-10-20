/**
 * A deliberately failing test, run as a child process by `inspect-dom.test.ts` and never by the
 * suite itself (no `.test.` in the name). Two live, mounted `jx-tabs` strips, each carrying its
 * reactive state, compared with `toBe`: the shape that once printed 2.8 million lines in CI. The
 * workspace preload's compact printer is what keeps its failure message short.
 */
import "../with-dom.ts";

import { expect, test } from "bun:test";

import { mount } from "@jxsuite/runtime";
import type { JxDocument } from "@jxsuite/schema/types";

import { registerUi } from "../../src/index.ts";

function strip(): JxDocument {
  return {
    children: [
      {
        attributes: { label: "Open documents", selected: "one" },
        children: ["one", "two", "three"].map((value) => ({
          attributes: { label: value, value },
          tagName: "jx-tab",
        })),
        tagName: "jx-tabs",
      },
    ],
    tagName: "div",
  };
}

async function mounted(): Promise<Element | null> {
  const host = document.createElement("div");
  document.body.append(host);
  await mount(strip(), host);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return host.querySelector("jx-tabs");
}

test("two live strips are not the same element", async () => {
  await registerUi({ theme: false });
  const first = await mounted();
  const second = await mounted();
  expect(first).toBe(second);
});
