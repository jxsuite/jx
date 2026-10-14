import "./with-dom.ts";

import { describe, expect, spyOn, test } from "bun:test";

import { KIT_BASE, KIT_MODULES, KIT_TAGS, registerUi, themeInstalled } from "../src/index.ts";
import { resolve } from "@jxsuite/runtime";

describe("registerUi", () => {
  test("defines every kit element once, with no network, and adopts the theme", async () => {
    const fetchMock = spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network"));
    const doc = document.implementation.createHTMLDocument("kit");

    const first = registerUi({ document: doc });
    const second = registerUi({ document: doc });
    expect(second).toBe(first);
    await first;

    for (const tag of KIT_TAGS) {
      expect(customElements.get(tag), tag).toBeDefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(themeInstalled(doc)).toBe(true);
  });

  test("preloads each document under its kit URL and each behaviour module", async () => {
    await registerUi({ theme: false });
    for (const tag of KIT_TAGS) {
      const doc = await resolve(`${KIT_BASE}${tag}.json`);
      expect(doc.tagName).toBe(tag);
    }
    expect(Object.keys(KIT_MODULES)).toContain("jx-ui:/icons.ts");
  });
});
