import { describe, expect, test } from "bun:test";
import { packagedLayout } from "../src/main/layout";
import { posix } from "./_posix";

describe("packagedLayout", () => {
  const resources = "/App/Contents/Resources";
  const asar = "/App/Contents/Resources/app.asar";

  test("names the backend, studio assets and icon beside app.asar, and the preload inside it", () => {
    const layout = packagedLayout(resources, asar, "linux");
    expect({
      ...layout,
      backend: posix(layout.backend),
      icon: layout.icon && posix(layout.icon),
      preload: posix(layout.preload),
      studio: posix(layout.studio),
    }).toEqual({
      backend: "/App/Contents/Resources/backend/index.js",
      icon: "/App/Contents/Resources/icon.png",
      preload: "/App/Contents/Resources/app.asar/preload.js",
      studio: "/App/Contents/Resources/studio",
    });
  });

  test("macOS draws the bundle's own icon, so the window is given none", () => {
    expect(packagedLayout(resources, asar, "darwin").icon).toBeNull();
  });
});
