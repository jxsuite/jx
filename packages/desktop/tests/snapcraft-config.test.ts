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
  extensions?: string[];
  /** A bare interface name, or `{ <plug>: <attributes> }` for a plug that sets attributes. */
  plugs?: (string | JsonObject)[];
  environment?: Record<string, string>;
}
interface Part {
  plugin: string;
  source?: string;
  organize?: Record<string, string>;
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

const workflow = readFileSync(resolve(repo, ".github/workflows/build-snap.yml"), "utf8");

describe("snapcraft.yaml", () => {
  test("is a strict core24 snap for both architectures", () => {
    expect(snapcraft.name).toBe("jx-studio");
    expect(snapcraft.base).toBe("core24");
    expect(snapcraft.confinement).toBe("strict");
    expect(snapcraft.grade).toBe("stable");
    expect(Object.keys(snapcraft.platforms).toSorted()).toEqual(["amd64", "arm64"]);
  });

  test("takes GTK and the host-matched GPU stack from the gnome extension", () => {
    expect(app.extensions).toEqual(["gnome"]);
  });

  test("declares the loopback server's plug and does not request allow-sandbox", () => {
    expect(app.plugs).toContain("network-bind");
    expect(app.plugs).toContain("browser-support");
    // A plain string: the allow-sandbox attribute needs a store grant, and until there is one the
    // Launcher passes --no-sandbox.
    expect(JSON.stringify(app.plugs)).not.toContain("allow-sandbox");
    expect(launcher).toContain("--no-sandbox");
  });

  test("runs the Electron application, not the Bun launcher or a Nix tree", () => {
    expect(launcher).toContain('"$SNAP/app/jx-studio"');
    expect(launcher).not.toContain("chromium/index.ts");
    expect(snapcraft.parts.app?.source).toBe("snap-stage");
    expect(snapcraft.parts.app?.organize).toEqual({ "*": "app/" });
    expect(snapcraft["adopt-info"]).toBe("app");
    expect(snapcraft.parts.bun).toBeUndefined();
    expect(app.environment?.JX_STUDIO_ASSETS).toBeUndefined();
  });

  test("builds from electron-builder's unpacked Linux app, whose executable has the name it runs", () => {
    expect(workflow).toContain("-- --dir --publish never");
    expect(workflow).toContain("packages/desktop/snap-stage");
    expect(workflow).not.toContain("nix build");
    const config = Bun.YAML.parse(
      readFileSync(resolve(desktopDir, "electron-builder.yml"), "utf8"),
    );
    expect(config).toMatchObject({ linux: { executableName: "jx-studio" } });
  });

  test("drops the setuid sandbox helpers the store refuses", () => {
    expect(snapcraft.parts.app?.["override-build"]).toContain(
      'rm -f "$CRAFT_PART_INSTALL/chrome-sandbox"',
    );
    expect(snapcraft.parts.chromium?.["override-build"]).toContain(
      'rm -f "$to/chromium-browser/chrome-sandbox"',
    );
  });

  test("keeps Canonical's Chromium for the site import, which reads CHROME_PATH", () => {
    const chromium = snapcraft.parts.chromium!;
    expect(chromium["build-snaps"]).toEqual(["chromium/latest/stable"]);
    expect(chromium["override-build"]).toContain('cp -a "$from/chromium-browser" "$to/"');
    expect(app.environment?.CHROME_PATH).toBe("$SNAP/usr/lib/chromium-browser/chrome");
  });

  test("hands the store review a snap the runner owns", () => {
    // The review-tools snap reads through the `home` interface, whose AppArmor rule carries
    // `owner`: a root-owned snap under $HOME is a `Permission denied` RUNTIME ERROR at any mode.
    const pack = workflow.indexOf("sudo snapcraft pack");
    const chown = workflow.indexOf('sudo chown "$(id -u):$(id -g)"');
    const review = workflow.indexOf("review-tools.snap-review");
    expect(pack).toBeGreaterThan(-1);
    expect(chown).toBeGreaterThan(pack);
    expect(review).toBeGreaterThan(chown);
    expect(workflow).not.toContain("sudo review-tools");
  });

  test("ships a desktop entry that starts the command and shows the snap's icon", () => {
    const entry = readFileSync(resolve(desktopDir, "snap", "gui", "jx-studio.desktop"), "utf8");
    expect(entry).toContain("Exec=jx-studio %F");
    expect(entry).toContain("Icon=${SNAP}/meta/gui/icon.png");
    expect(entry).toContain("StartupWMClass=jx-studio");
    expect(existsSync(resolve(desktopDir, snapcraft.icon))).toBe(true);
    expect(app.command).toBe("bin/jx-studio");
  });
});
