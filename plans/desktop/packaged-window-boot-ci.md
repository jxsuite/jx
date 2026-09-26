---
status: stub
disposition: implement
claims:
  - desktop.md#3.3
size: M
workspaces:
  - packages/desktop
  - .github/workflows
---

# CI boots a packaged window on each OS and proves the desktop adapter registered

## Context

`specs/desktop.md` §3.3, line 130:

> **Status: Partial.** Registration and all three rules below ship: `registerPlatform` in `packages/studio/src/platform.ts`, the launcher signal in `packages/desktop/src/boot.ts`, the build's refusal in `packages/desktop/scripts/init-bundle.ts` and `verify-bundle.ts`, and `resolveDefaultPlatform` with `PlatformUnavailableError` in `packages/studio/src/platforms/default-platform.ts`. Nothing boots a packaged window in CI on any OS to observe the desktop adapter register: the `bundle-desktop-*.yml` lanes are release-only and stop at a static check of the bundle's content.

This was the retired §11 roadmap's row "Boot a packaged window in CI on each OS and assert the desktop adapter registered". The section was unmarked before the census; its last paragraph admits the gap. Disposition `implement`: desktop 5.0.0 through 5.1.3 shipped an `init.js` that threw on import, and every check that now holds the line is static or a unit test, so a regression of a kind nobody has thought of yet still reaches a release.

**What exists**

- `packages/desktop/scripts/init-bundle.ts`, run by `pre-build.ts` and `verify-bundle.ts`: judges the bundle's content (no `node_modules/electrobun` stub, the inlined `Electroview`, the launcher signal).
- `packages/desktop/tests/boot.test.ts`, `init-shim.test.ts`, `init-shim-success.test.ts`, `chromium-init-shim.test.ts`, `init-bundle.test.ts`, and `packages/studio/tests/studio-boot-refusal.test.ts`, which boots the studio entry under an announced launcher in happy-dom.
- `.github/workflows/bundle-desktop-linux.yml`, `bundle-desktop-macos.yml`, `bundle-desktop-windows.yml`: `workflow_call` only, from the release pipeline; they build and attach artifacts and launch nothing.
- `scripts/desktop-build-lanes.test.ts`, which fails a lane that builds without `check-electrobun-vendor.ts --init` in front of it.

**What is missing**

- A job per OS that starts the packaged app (a display on Linux, such as Xvfb), waits for the studio window, and reads back whether `globalThis.__jxLauncher` recorded an error and whether `__jxPlatform` is the RPC-backed desktop adapter, failing on the §3.4 boot-failure state.
- A way to read that state out of the webview: a launcher-side boot report the Bun process writes when the RPC first answers, or a debugging protocol on the renderer.
- A decision on where it runs: the bundle lanes are release-only (CLAUDE.md names release-only workflows as the unexercised part of the pipeline), so either a pull-request leg gated on `packages/desktop/**`, or the release lanes gaining a boot step before they attach anything.
- Whether the chromium launcher (§9) gets the same check, since its `init` shim has the same failure shape.

**Related**

- desktop.md §3.4 (the boot-failure state the check must detect), desktop.md §7.2 (construction needs the preload and the vendored SDK), desktop.md §9.2 (the chromium launcher).
- studio.md §11.2 (`studioShellHtml` and its boot slot).
