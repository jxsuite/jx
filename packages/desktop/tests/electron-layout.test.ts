import { describe, expect, test } from "bun:test";
import { packagedLayout } from "../src/electron-shell/layout";
import { posix } from "./_posix";

describe("packagedLayout", () => {
  const resources = "/App/Contents/Resources";
  const asar = "/App/Contents/Resources/app.asar";

  test("names the backend, Bun, studio assets and icon beside app.asar, and the preload inside it", () => {
    const layout = packagedLayout(resources, asar, "linux");
    expect({
      ...layout,
      backend: posix(layout.backend),
      bun: posix(layout.bun),
      icon: layout.icon && posix(layout.icon),
      preload: posix(layout.preload),
      studio: posix(layout.studio),
    }).toEqual({
      backend: "/App/Contents/Resources/backend/index.js",
      bun: "/App/Contents/Resources/bun/bun",
      icon: "/App/Contents/Resources/icon.png",
      preload: "/App/Contents/Resources/app.asar/preload.js",
      studio: "/App/Contents/Resources/studio",
    });
  });

  test("Windows runs bun.exe", () => {
    expect(packagedLayout(String.raw`C:\r`, String.raw`C:\r\app.asar`, "win32").bun).toMatch(
      /bun\.exe$/,
    );
  });

  test("macOS draws the bundle's own icon, so the window is given none", () => {
    expect(packagedLayout(resources, asar, "darwin").icon).toBeNull();
  });
});
