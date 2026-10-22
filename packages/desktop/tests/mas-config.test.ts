/**
 * The Mac App Store build's invariants (specs/desktop.md §7.7), read from the files
 * electron-builder and the signer read. The build is only made by the upload lane, so these are the
 * properties a careless edit would otherwise break until a person opens App Store Connect.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const desktopDir = resolve(import.meta.dir, "..");
const read = (relative: string): string => readFileSync(resolve(desktopDir, relative), "utf8");

/** The `<key>`s of a plist that are set to `<true/>`. */
function enabled(plist: string): string[] {
  return [...plist.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((match) => match[1]);
}

/** The string value of one plist key. */
function stringOf(plist: string, key: string): string | undefined {
  return new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(plist)?.[1];
}

const builder = read("electron-builder.yml");
const masBlock = /^mas:\n((?:  .*\n)+)/m.exec(builder)?.[1] ?? "";
const app = read("build-resources/entitlements.mas.plist");
const inherit = read("build-resources/entitlements.mas.inherit.plist");

describe("electron-builder.yml's mas block", () => {
  test("is signed for distribution, with the two MAS entitlements files and a profile", () => {
    expect(masBlock).toContain("type: distribution");
    expect(masBlock).toContain("entitlements: build-resources/entitlements.mas.plist");
    expect(masBlock).toContain(
      "entitlementsInherit: build-resources/entitlements.mas.inherit.plist",
    );
    expect(masBlock).toContain("provisioningProfile: build-resources/embedded.provisionprofile");
  });

  test("leaves the hardened runtime off, because the store replaces notarization", () => {
    expect(masBlock).toContain("hardenedRuntime: false");
  });

  test("does not collide with the DMG's artifact names", () => {
    expect(masBlock).toContain("artifactName: mas-${arch}-JxStudio.${ext}");
  });
});

describe("the sandbox entitlements", () => {
  test("the application is sandboxed, can read what the user picks, and has the network it needs", () => {
    expect(enabled(app)).toEqual(
      expect.arrayContaining([
        "com.apple.security.app-sandbox",
        "com.apple.security.files.user-selected.read-write",
        "com.apple.security.files.bookmarks.app-scope",
        "com.apple.security.network.client",
        "com.apple.security.network.server",
      ]),
    );
  });

  test("names the team and the one appId every channel shares", () => {
    const appId = /^appId: (.+)$/m.exec(builder)?.[1];
    expect(appId).toBe("com.jxsuite.studio");
    const team = stringOf(app, "com.apple.developer.team-identifier");
    expect(team).toBe("5466QQ2CL8");
    expect(stringOf(app, "com.apple.application-identifier")).toBe(`${team}.${appId}`);
  });

  test("joins the app group Chromium's Mach service is named after", () => {
    const team = stringOf(app, "com.apple.developer.team-identifier");
    expect(app).toContain("com.apple.security.application-groups");
    expect(app).toContain(`<string>${team}.com.jxsuite.studio</string>`);
  });

  test("every nested executable inherits the sandbox and keeps its JIT entitlements", () => {
    expect(enabled(inherit)).toEqual(
      expect.arrayContaining([
        "com.apple.security.app-sandbox",
        "com.apple.security.inherit",
        "com.apple.security.cs.allow-jit",
        "com.apple.security.cs.allow-unsigned-executable-memory",
      ]),
    );
  });

  test("does not carry an exception the store rejects", () => {
    const granted = enabled(app);
    expect(granted).not.toContain("com.apple.security.cs.disable-library-validation");
    expect(granted).not.toContain("com.apple.security.files.all");
  });
});

describe("the package script", () => {
  test("asks electron-builder for `--mac mas`, which has no switch of its own", () => {
    const script = read("scripts/package-app.ts");
    expect(script).toContain('["--mac", "mas"]');
    expect(script).toContain('mas: "darwin"');
  });
});
