/**
 * One live, mounted `jx-tabs` strip carrying its reactive state: the element shape both flood
 * fixtures compare. Shared so the two fixtures cannot drift apart in what they mount.
 */
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

/** Registers the kit (once), mounts a strip into the document and settles a task. */
export async function mountedStrip(): Promise<Element | null> {
  await registerUi({ theme: false });
  const host = document.createElement("div");
  document.body.append(host);
  await mount(strip(), host);
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  return host.querySelector("jx-tabs");
}
