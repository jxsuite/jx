---
status: drafted
disposition: implement
claims:
  - desktop.md#9.7
workspaces:
  - packages/desktop
  - packages/studio
  - scripts
  - .github
size: L
---

# Electron is the one desktop framework

## Context

Jx Studio ships three desktop shells. ElectroBun is the packaged application on macOS, Windows and Linux. The Nix package draws its window with a frameless Electron shell (`specs/desktop.md` §9.5). The snap runs Chromium `--app` (§9.6). ElectroBun 2 no longer bundles Bun and discourages depending on it, while this application's backend is Bun-native throughout (`Bun.serve`, `Bun.$`, `Bun.spawn`, `Bun.Glob`), so the framework that was chosen to carry Bun now works against it. Keeping three shells also means three window models, two launchers, a vendored SDK submodule and a build toolchain (Hutch) that exist only for one of them.

§9.7 now holds the arrangement the replacement needs and measures it. Electron is the root process and owns every window, a Bun backend is its child and owns every project, and the two speak a validated JSON IPC protocol (`packages/desktop/src/hub/protocol.ts`). It runs from a checkout (`bun run desktop:electron`) and was driven on macOS with a second launch, a deduped project, a welcome window, a closed window and each window's RPC. What it does not do is ship: nothing packages it, signs it, updates it or points an installer at it, and the Nix and snap builds still run the per-window launcher of §9.2.

What ElectroBun provides that Electron has to replace, from `packages/desktop/electrobun.config.ts` and `src/`:

- The window, its RPC bridge and its application menu. Replaced by the shell and hub of §9.7, which already carry every PAL request ElectroBun's `buildWindowRpc` answered except the updater's.
- The updater (`src/updater.ts`, `updaterCheckForUpdate` and its siblings in `rpc-schema.ts`) and the `release.baseUrl` feed.
- Packaging and signing: macOS codesign and notarization, the Windows MSI and MSIX lanes (`scripts/build-msi.ts`, `scripts/build-msix.ts`), and the file association for `project.json`.
- Bun itself, which ElectroBun vendored and an Electron application must carry in its resources.

## Outcome

Every packaged build runs the Electron application of §9.7, and `electrobun`, `vendor/electrobun`, `hutch.config.ts`, `electrobun.config.ts`, `src/index.ts`, `src/window-manager.ts` and the Electrobun adapter in `src/platform.ts` are deleted along with the workflows that exist to keep them building. The per-window launcher of §9.2 survives only where a snap's confinement needs it, if the measurement below says it must.

## Decisions

- **Decided:** Electron is the root process and the Bun backend is its child, because an application bundle's executable is Electron and a Bun-rooted launcher would make Electron a helper whose menu bar, Dock tile and signature belong to someone else.
- **Decided:** One server, session and token per window rather than one routed server, because a canvas iframe is cross-origin and carries its window's token in its URL.
- **Decided:** The IPC channel is Node's `child_process` channel in JSON mode, because it is the one framing Bun and Node both speak, and each side validates what it receives at the channel.
- **Decided:** Page storage is an Electron partition per project, and the single-instance lock replaces the file registry for finding a window, because both are Electron's own mechanisms and the registry exists only because a window used to be a process.
- **Decided:** The packager is electron-builder, because it covers macOS notarization, MSIX and the update feed in one tool, and its updater reads the GitHub releases feed. How `release-assets.json` and the existing MSIX publisher identity carry over is settled in the slice that adopts it.
- **Open:** The update feed. `electron-updater` against GitHub releases keeps the feed the installed ElectroBun 1.x and 2.x apps already read, but those apps must update into the Electron application once, and that handover has to be tested before the last ElectroBun release.
- **Open:** Whether the snap moves to Electron. §9.6 requires the official Electron prebuilt to render with hardware acceleration under `gpu-2404`, which has not been measured.
- **Decided:** No Wayland flag is carried over, because Electron 38 and later default `--ozone-platform` to `auto` and run native Wayland in a Wayland session, and a switch set from JavaScript would be too late to apply. Only the snap's `--no-sandbox` family remains, and it belongs to the snap's own launcher until the snap moves.
- **Decided:** The application pins its name and user-data directory before the single-instance lock, because an unpackaged Electron is named `Electron` and would share a lock and a profile with every other unpackaged Electron application.

## Implementation

The first slice is in the pull request that adds this plan: `src/hub/` (protocol, per-window handlers, window hub, backend), `src/electron-shell/app.ts`, `backend-process.ts` and `app-main.ts`, the bundler entry, `scripts/run-electron-app.ts` and the tests that hold them. Later slices reuse them as they are and add to them.

- Linux and Nix: `package.nix` bundles `app-main.js` and `preload.js` in the build phase and the wrapper runs Electron on them, naming Bun, the backend, the preload and the icon. This is in the adding change; what is left is the snap, which needs the measurement in the open decision above before it can move.
- macOS: package the application, carry the Bun binary in `Resources`, sign and notarize it, and register the `project.json` file association so the `open-file` path of §9.7 is exercised by the OS.
- Updater: an `updaterApplyUpdate` family answered by the shell, `appInfo` reporting the packaged channel, and the About screen unchanged.
- Windows: MSI and MSIX from the same bundle, keeping `MSIX_PUBLISHER_DISPLAY_NAME` and the Store lane.
- Removal: delete what the Outcome lists, the vendor submodule and its gate, the Electrobun lanes and the desktop notes that exist for them, and flip `docs/start/install.md` and `docs/studio/desktop.md` to the single framework.

## Tests

Each slice keeps `packages/desktop` at its per-file coverage bars (`bunfig.toml`) and adds its own suites beside `hub-*.test.ts` and `electron-app.test.ts`, which are the pattern: the Electron API faked in `tests/_fake-electron.ts`, a real hub over real servers in `tests/_hub-harness.ts`, and the real process adapter against a real Bun child. The packaging slices add the checks CI can run without a signing identity: the bundle's contents, its entitlements and that the packaged backend starts. Signing and notarization are verified by the release lane, not a unit test.

## Specs & docs

§9.7 is the contract. Each slice edits it in place and records a fragment (`bun run spec:change specs/desktop.md minor -m "..."`): the Linux slice moves §1.1a and §9.3, the packaging slices §1.1a and §7, and the removal slice deletes §7 down to a pointer and renames §1's target rows. User docs change only when a user-visible behavior does: `docs/start/install.md` when an installer changes, `docs/studio/desktop.md` when the framework statement does.

## Acceptance

- `bun run desktop:electron <project>` opens Studio; a second `jx-studio <project>` raises it and a different one opens another window of the same process.
- A packaged macOS build opens, signs and notarizes, opens a `project.json` double-clicked in Finder, and updates itself.
- No `electrobun` string remains in `packages/desktop`, the lockfile or the workflows, and `bun run docs:check` and `bun run plans:check` are green.

## Slices

| Slice | Scope                                                                                               | Claims | State                |
| ----- | --------------------------------------------------------------------------------------------------- | ------ | -------------------- |
| EL1.1 | Hub, Electron application, protocol, dev runner, tests, spec §9.7                                   | §9.7   | in the adding change |
| EL1.2 | Nix runs the application: build-time bundle, wrapper, install and CI checks                         | §9.7   | in the adding change |
| EL1.3 | Measure the official Electron prebuilt under the snap's `gpu-2404`; move the snap or record why not | §9.7   | open                 |
| EL2.1 | macOS package: Bun in resources, signing, notarization, `project.json` association                  | §9.7   | open                 |
| EL2.2 | Updater: `electron-updater`, the `updater*` requests, packaged `appInfo`, the handover build        | §9.7   | open                 |
| EL2.3 | Windows: MSI and MSIX from the same bundle                                                          | §9.7   | open                 |
| EL3.1 | Delete ElectroBun, Hutch, the vendor submodule, their lanes and notes; flip the user docs           | §9.7   | open                 |
