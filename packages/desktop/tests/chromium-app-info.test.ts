/**
 * What this launcher can truthfully tell the About screen.
 *
 * The interesting assertion is the NEGATIVE one: no `updateStatus`. This build is replaced by the
 * system that packaged it, so an "Up to date" here would be a claim about a feed it never checked.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { appInfo, releaseChannel } from "../src/chromium/app-info";
import pkg from "../package.json" with { type: "json" };

const assets = process.env.JX_STUDIO_ASSETS;
const commit = process.env.JX_STUDIO_COMMIT;
const snap = process.env.SNAP;

afterEach(() => {
  restore("JX_STUDIO_ASSETS", assets);
  restore("JX_STUDIO_COMMIT", commit);
  restore("SNAP", snap);
});

function restore(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

describe("releaseChannel", () => {
  test("a packaged build reports `system` — its updates are the packager's job", () => {
    delete process.env.SNAP;
    process.env.JX_STUDIO_ASSETS = "/nix/store/abc-jx-studio/assets/studio";
    expect(releaseChannel()).toBe("system");
  });

  test("the same build inside a snap reports `snap` — the Snap Store replaces it", () => {
    process.env.JX_STUDIO_ASSETS =
      "/snap/jx-studio/12/lib/jx-studio/packages/desktop/assets/studio";
    process.env.SNAP = "/snap/jx-studio/12";
    expect(releaseChannel()).toBe("snap");
  });

  test("a repo checkout reports `development`", () => {
    delete process.env.SNAP;
    delete process.env.JX_STUDIO_ASSETS;
    expect(releaseChannel()).toBe("development");
  });
});

describe("appInfo", () => {
  test("carries the package version and the channel", () => {
    delete process.env.SNAP;
    process.env.JX_STUDIO_ASSETS = "/nix/store/abc/assets";
    expect(appInfo()).toMatchObject({
      channel: "system",
      version: (pkg as { version: string }).version,
    });
  });

  test("never claims an update status, because there is no feed to have checked", () => {
    expect(appInfo().updateStatus).toBeUndefined();
  });

  test("reports the stamped commit when the packager supplied one, else `unknown`", () => {
    delete process.env.JX_STUDIO_COMMIT;
    expect(appInfo().hash).toBe("unknown");
    process.env.JX_STUDIO_COMMIT = "deadbee";
    expect(appInfo().hash).toBe("deadbee");
  });
});
