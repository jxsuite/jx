---
status: drafted
disposition: implement
claims:
  - desktop.md#7.6
  - desktop.md#9.7
workspaces:
  - packages/desktop
  - .github
size: M
---

# The Electron application's release lanes have run once, and the snap is measured

## Context

Jx Studio's three desktop shells became one. The Electron application of `specs/desktop.md` §9.7 is what every installer and the Nix package run, packaged by electron-builder (§7), and ElectroBun, Hutch, the vendored SDK and the WiX and MSIX pipelines are gone. What shipped with that change was written and verified as far as a machine without signing identities, a Windows host or a Linux arm64 host allows: on macOS the staged backend ran under its own Bun (`bun run smoke`), the unpacked application launched, handled second launches, a `project.json` path and a welcome window, and electron-builder produced `macos-arm64-JxStudio.dmg`, the update zip and a `latest-mac.yml` whose relative URLs resolve against the existing `releases/latest/download/` feed.

Two things are open, and each is a claim the spec still carries:

- **§7.6, the release lanes.** `bundle-desktop-macos.yml`, `bundle-desktop-windows.yml` and `bundle-desktop-linux.yml` have never run. Release-only workflows are `workflow_call`-only, so nothing exercises them before a tag, and the first run is the test. Specifically unproven: macOS signing, notarization and stapling with the hardened-runtime entitlements (`build-resources/entitlements.mac.plist`), and whether notarization accepts the Bun binary inside `Resources`; the Windows lane end to end (the NSIS installer, the appx under `makeappx`, and the smoke test, which is `continue-on-error` there until it has run); the Linux arm64 AppImage; and electron-updater against a real release's `latest*.yml`.
- **§9.7, the snap.** It still runs the per-window Bun launcher with Chromium `--app`, because the official Electron prebuilt has not been measured under the snap's `gpu-2404` graphics interface, which is the reason the snap carries Canonical's Chromium (`packages/desktop/AGENTS.md`).

Installed ElectroBun builds cannot update into this application: their updater applies archives of its own format. That handover is one reinstall, and it is a property of the release, not something a lane can fix.

## Outcome

- §7.6 → Implemented, once one release has produced signed and notarized macOS installers, an NSIS installer and an appx that the Store accepted, and AppImages for both architectures, and the lanes' smoke steps are blocking everywhere.
- §9.7 → Implemented, with the snap either moved to the Electron application or recorded as a deliberate exception (`Future` with the measurement that justifies it).

## Decisions

- **Decided:** electron-builder is the packager, because it covers macOS notarization, the Store appx and the update feed in one tool, and its updater reads the same GitHub releases feed.
- **Decided:** the Windows installer is NSIS and the WiX `.msi` is gone, because NSIS is what electron-updater replaces in place. If an MSI is wanted for managed deployment it is a new `electron-builder.yml` target, not a lane.
- **Decided:** Linux ships an AppImage per architecture and no `.deb`: the snap and the Nix package already cover the package-manager channels, and the tool electron-builder needs for a deb does not ship for arm64.
- **Open:** whether the AppImage should pass `--no-sandbox`. Ubuntu 24.04 and later restrict the unprivileged user namespaces Electron's sandbox falls back on for an app that is not installed from a package, so an AppImage fails to start there unless the sandbox is disabled or the user relaxes the AppArmor policy. The docs currently send Ubuntu users to the snap. The trade is a renderer sandbox against a first run that works; the snap already runs `--no-sandbox` for its own reason.
- **Open:** whether the snap can move. It needs the official Electron prebuilt to render with hardware acceleration under `gpu-2404`, which has not been measured. The result is either a snap that runs the application or a recorded reason it does not.

## Implementation

- Run the three lanes by `workflow_dispatch` against a throwaway release tag before the next real release, with the real secrets, and read each step's log. Fix what they find in `bundle-desktop-*.yml`, `electron-builder.yml` or the entitlements, not in the lane's glue.
- macOS: confirm `codesign --verify --deep --strict`, `xcrun stapler validate` and `spctl --assess` pass on the app inside the DMG, that the Bun and the native addons load under the hardened runtime, and that an installed older build updates into the new one through `latest-mac.yml`.
- Windows: install and uninstall the NSIS build, confirm the appx builds and the Store accepts it, confirm `project.json` opens through the file association, then drop `continue-on-error` from the smoke step.
- Linux: run the arm64 AppImage on a real arm64 host, check the FUSE and sandbox notes in `docs/start/install.md` against what actually happens on Ubuntu 24.04, and decide the `--no-sandbox` question above.
- Snap: measure the Electron prebuilt under `gpu-2404` (frame time and the renderer's GPU process), then either change `snapcraft.yaml` to run the application or write the measurement into §9.6 and mark the exception `Future`.

## Tests

The lanes themselves are the test, and `scripts/desktop-build-lanes.test.ts` already holds what can be read from the files (names, flags, globs, wiring). A lane that proves out adds its first real result to `packages/desktop/AGENTS.md`'s list of verified paths in the same change that removes it from the unverified one. Coverage thresholds in `packages/desktop/bunfig.toml` do not move.

## Specs & docs

Each landed slice edits §7.6 or §9.6 and §9.7 in place and records a fragment (`bun run spec:change specs/desktop.md patch -m "..."`). `docs/start/install.md` changes if the AppImage's sandbox or FUSE behaviour turns out different from what it says, and `packages/desktop/AGENTS.md` loses each unverified item as it is verified.

## Acceptance

- A tag's three lanes are green, and the release carries `macos-arm64-JxStudio.dmg` and its zip, `win-x64-JxStudio-Setup.exe`, `win-x64-JxStudio.appx`, both AppImages and every `latest*.yml`.
- `spctl --assess --type execute` accepts the notarized macOS app, and an installed previous build updates itself.
- The Store accepts the appx.
- The snap question has an answer in the spec.

## Slices

| Slice | Scope                                                                                  | Claims | State |
| ----- | -------------------------------------------------------------------------------------- | ------ | ----- |
| EV1.1 | macOS lane: signing, notarization, stapling, entitlements, updater against a real feed | §7.6   | open  |
| EV1.2 | Windows lane: NSIS, appx, Store acceptance, smoke test made blocking                   | §7.6   | open  |
| EV1.3 | Linux lanes: arm64 AppImage, FUSE and sandbox behaviour, the `--no-sandbox` decision   | §7.6   | open  |
| EV1.4 | Snap: measure Electron under `gpu-2404`; move the snap or record the exception         | §9.7   | open  |
