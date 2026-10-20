/**
 * The snap's invariants, read from the files snapcraft reads (specs/desktop.md §9.6). The snap is
 * only packed on a release, by build-snap.yml, so these are the properties a careless edit would
 * otherwise break silently until then.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { JsonObject } from "@jxsuite/schema/types";

const desktopDir = resolve(import.meta.dir, "..");
const repo = resolve(desktopDir, "..", "..");

interface App {
  command: string;
  desktop: string;
  extensions?: string[];
  /** A bare interface name, or `{ <plug>: <attributes> }` for a plug that sets attributes. */
  plugs?: (string | JsonObject)[];
  environment?: Record<string, string>;
}
interface Part {
  plugin: string;
  source?: string;
  "build-snaps"?: string[];
  "override-build"?: string;
}
/* SAFETY: snap/snapcraft.yaml is committed beside this test and `snapcraft pack` refuses it unless
   the scalar top-level keys below are strings; the parts and apps this suite probes are declared
   optional, so a removed one reads as undefined and fails its expectation instead of crashing. */
const snapcraft = Bun.YAML.parse(
  readFileSync(resolve(desktopDir, "snap", "snapcraft.yaml"), "utf8"),
) as {
  name: string;
  base: string;
  confinement: string;
  grade: string;
  icon: string;
  "adopt-info": string;
  /** Architecture -> build settings, `null` when an architecture takes the defaults. */
  platforms: Record<string, JsonObject | null>;
  apps: { "jx-studio"?: App };
  parts: { app?: Part; bun?: Part; chromium?: Part };
};
const app = snapcraft.apps["jx-studio"]!;
const launcher = readFileSync(resolve(desktopDir, "snap", "local", "jx-studio"), "utf8");

describe("snapcraft.yaml", () => {
  test("is a strict core24 snap for both architectures", () => {
    expect(snapcraft.name).toBe("jx-studio");
    expect(snapcraft.base).toBe("core24");
    expect(snapcraft.confinement).toBe("strict");
    expect(snapcraft.grade).toBe("stable");
    expect(Object.keys(snapcraft.platforms).toSorted()).toEqual(["amd64", "arm64"]);
  });

  test("takes GTK and the host-matched GPU stack from the gnome extension", () => {
    /* The gnome extension is what wires gnome-46-2404 and gpu-2404 (mesa-2404), the reason the
       snap uses Canonical's Chromium build at all. */
    expect(app.extensions).toEqual(["gnome"]);
  });

  test("declares the loopback server's plug and does not request allow-sandbox", () => {
    expect(app.plugs).toContain("network-bind");
    expect(app.plugs).toContain("browser-support");
    // A plain string: the allow-sandbox attribute needs a store grant, and until there is one the
    // Launcher passes --no-sandbox (chromiumPlatformArgs).
    expect(JSON.stringify(app.plugs)).not.toContain("allow-sandbox");
  });

  test("points the launcher at the Chromium the chromium part copies in", () => {
    const chromium = snapcraft.parts.chromium!;
    expect(chromium["build-snaps"]).toEqual(["chromium/latest/stable"]);
    expect(chromium["override-build"]).toContain('cp -a "$from/chromium-browser" "$to/"');
    // Setuid upstream; the store review cannot even unpack a snap that carries it.
    expect(chromium["override-build"]).toContain('rm -f "$to/chromium-browser/chrome-sandbox"');
    expect(app.environment?.CHROMIUM_BIN).toBe("$SNAP/usr/lib/chromium-browser/chrome");
  });

  test("runs the app tree the staging step puts where the app part dumps it", () => {
    expect(snapcraft.parts.app?.source).toBe("snap-stage");
    expect(snapcraft["adopt-info"]).toBe("app");
    expect(app.environment?.JX_STUDIO_ASSETS).toBe(
      "$SNAP/lib/jx-studio/packages/desktop/assets/studio",
    );
    expect(launcher).toContain('"$SNAP/lib/jx-studio/packages/desktop/src/chromium/index.ts"');
    const workflow = readFileSync(resolve(repo, ".github/workflows/build-snap.yml"), "utf8");
    expect(workflow).toContain("packages/desktop/snap-stage/lib/");
  });

  test("hands the store review a snap the runner owns", () => {
    // The review-tools snap reads through the `home` interface, whose AppArmor rule carries
    // `owner`: a root-owned snap under $HOME is a `Permission denied` RUNTIME ERROR at any mode.
    const workflow = readFileSync(resolve(repo, ".github/workflows/build-snap.yml"), "utf8");
    const pack = workflow.indexOf("sudo snapcraft pack");
    const chown = workflow.indexOf('sudo chown "$(id -u):$(id -g)"');
    const review = workflow.indexOf("review-tools.snap-review");
    expect(pack).toBeGreaterThan(-1);
    expect(chown).toBeGreaterThan(pack);
    expect(review).toBeGreaterThan(chown);
    expect(workflow).not.toContain("sudo review-tools");
  });

  test("pins Bun to the exact version CI runs, by checksum", () => {
    const build = snapcraft.parts.bun?.["override-build"] ?? "";
    const pinned = /version=(\d+\.\d+\.\d+)/.exec(build)?.[1];
    // `.bun-version` is the one pin every workflow installs (.github/actions/setup-bun reads it).
    const ci = readFileSync(resolve(repo, ".bun-version"), "utf8").trim();
    expect(pinned).toBeDefined();
    expect(pinned).toBe(ci);
    expect(build).toContain("sha256sum -c -");
    expect(build.match(/sum=[0-9a-f]{64}/g)).toHaveLength(2);
  });

  test("ships the desktop entry and icon the Nix package installs", () => {
    expect(app.desktop).toBe("lib/jx-studio/packages/desktop/jx-studio.desktop");
    expect(existsSync(resolve(desktopDir, "jx-studio.desktop"))).toBe(true);
    expect(existsSync(resolve(desktopDir, snapcraft.icon))).toBe(true);
    expect(app.command).toBe("bin/jx-studio");
  });
});
