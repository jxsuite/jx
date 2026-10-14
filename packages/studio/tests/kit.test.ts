import "./with-dom.js";

import { describe, expect, mock, test } from "bun:test";
import { themeInstalled } from "@jxsuite/ui";

import { kitReady, registerKit } from "../src/ui/kit";

describe("registerKit", () => {
  test("defines the kit once, adopts the theme, and touches no network", async () => {
    const fetchMock = mock((_resource: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject<Response>(new Error("no network")),
    );
    // Keeping Bun's `preconnect` makes the stub a whole `fetch`.
    globalThis.fetch = Object.assign(fetchMock, { preconnect: globalThis.fetch.preconnect });
    const doc = document.implementation.createHTMLDocument("kit");

    const first = registerKit(doc);
    expect(registerKit(doc)).toBe(first);
    expect(kitReady()).toBe(first);
    await first;

    expect(customElements.get("jx-icon")).toBeDefined();
    expect(themeInstalled(doc)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
