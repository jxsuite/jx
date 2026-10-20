/** Where a live render imports an `npm:` package from (src/canvas/npm-modules.ts). */
import { describe, expect, test } from "bun:test";
import { npmModuleUrl } from "../src/canvas/npm-modules";

describe("npmModuleUrl", () => {
  test("a package subpath under the serving origin's /node_modules/", () => {
    expect(npmModuleUrl("@jxsuite/search/client", "http://localhost:3417/canvas.html?t=1")).toBe(
      "http://localhost:3417/node_modules/@jxsuite/search/client",
    );
    expect(npmModuleUrl("lit", "http://127.0.0.1:9/")).toBe("http://127.0.0.1:9/node_modules/lit");
  });
});
