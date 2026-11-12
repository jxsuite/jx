/**
 * The harness address: the one string Studio writes and a previewing backend reads.
 *
 * What is pinned is the shape both sides depend on, and the two ways an address could come out
 * meaning something other than the document it was built for.
 */

import { describe, expect, test } from "bun:test";
import { HARNESS_QUERY_MAX, HARNESS_ROUTE, harnessAddress } from "../src/preview-harness";

describe("harnessAddress", () => {
  test("is the route prefix followed by the document's project path", () => {
    expect(HARNESS_ROUTE).toBe("/__jx_live__/harness/");
    expect(harnessAddress("components/site-card.json")).toEqual({
      dropped: false,
      path: "/__jx_live__/harness/components/site-card.json",
    });
  });

  test("no values, null and an empty set all add no query", () => {
    const bare = "/__jx_live__/harness/layouts/base.json";
    expect(harnessAddress("layouts/base.json").path).toBe(bare);
    expect(harnessAddress("layouts/base.json", null).path).toBe(bare);
    expect(harnessAddress("layouts/base.json", {}).path).toBe(bare);
  });

  test("test values travel as one JSON object in the props parameter", () => {
    const { dropped, path } = harnessAddress("components/site-card.json", {
      count: 3,
      heading: "Hi & <bye>",
      tags: ["a", "b"],
    });
    expect(dropped).toBe(false);
    const url = new URL(path, "http://127.0.0.1");
    expect(url.pathname).toBe("/__jx_live__/harness/components/site-card.json");
    expect(JSON.parse(url.searchParams.get("props")!)).toEqual({
      count: 3,
      heading: "Hi & <bye>",
      tags: ["a", "b"],
    });
  });

  test("a path segment is encoded, so a file name cannot start a query or a fragment", () => {
    const { path } = harnessAddress("components/ui/a b?#.json", { n: 1 });
    expect(path.startsWith("/__jx_live__/harness/components/ui/a%20b%3F%23.json?props=")).toBe(
      true,
    );
    expect(new URL(path, "http://127.0.0.1").hash).toBe("");
  });

  test("values whose encoded form passes the bound are left out whole, and that is reported", () => {
    const fits = harnessAddress("components/c-d.json", { heading: "x".repeat(1000) });
    expect(fits.dropped).toBe(false);
    expect(fits.path.length).toBeLessThan(HARNESS_QUERY_MAX);

    const tooLarge = harnessAddress("components/c-d.json", {
      heading: "x".repeat(HARNESS_QUERY_MAX),
    });
    expect(tooLarge).toEqual({ dropped: true, path: "/__jx_live__/harness/components/c-d.json" });
  });
});
