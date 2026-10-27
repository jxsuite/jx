# `@jxsuite/desktop`

> Jx Studio as a standalone desktop application, built with [Electron](https://www.electronjs.org).

## Overview

`@jxsuite/desktop` wraps `@jxsuite/studio` in a native desktop window. Electron is the root process: it owns every window, the application menu, the native dialogs, the single-instance lock and the updater. A Bun backend is its child and owns every project: one session and one loopback server per window, with filesystem I/O, Git, package management and the compiler behind a typed RPC. The two speak a small JSON protocol over the IPC channel Electron opens when it spawns the backend, and project I/O never crosses it: each window's page talks to its own server over a token-gated WebSocket.

The architecture is specified in [`specs/desktop.md`](../../specs/desktop.md) §9.7, and the packaging in §7.

## Platform targets

| Target                          | Runtime                                                | Channel                             |
| ------------------------------- | ------------------------------------------------------ | ----------------------------------- |
| macOS, Windows, Linux x64/arm64 | The Electron application, packaged by electron-builder | GitHub releases (auto-updates)      |
| Windows (Store)                 | The same application, as an appx                       | Microsoft Store                     |
| NixOS                           | The same application, built by Nix                     | `nix run github:jxsuite/jx/release` |
| Ubuntu (snap)                   | The same application, unpacked into a snap             | Snap Store                          |
| Dev mode                        | Chrome + `@jxsuite/server`                             | Studio development                  |

## Prerequisites

Just `bun install` at the repo root. Neither Electron nor Bun is installed by hand: `ELECTRON_BIN` names an Electron executable for the checkout runner, and electron-builder downloads the Electron it packages (the version is pinned in `electron-builder.yml`, and equals nixpkgs' `electron`). The npm `electron` package is deliberately not a dependency, because its postinstall downloads a ~100 MB binary.

## Development

```bash
ELECTRON_BIN=/path/to/electron bun run dev [project]   # The Electron application, from the checkout
```

A second `bun run dev <project>` hands its project to the running application instead of starting another copy.

## Packaging

```bash
bun run stage                                  # Assemble build/ for electron-builder, for this machine
bun run package [--target mac|win|linux]       # Stage, then run electron-builder
bun run package -- --dir                       # An unpacked application to run or inspect
bun run smoke                                  # Start the STAGED backend and exercise it
```

`bun run stage` writes `build/app` (the main process, the preload and a `package.json`, which become `app.asar`) and `build/resources` (the backend bundle and its data, the studio assets, and the pinned Bun that runs the backend). `electron-builder.yml` places them and names the installers: `macos-arm64-JxStudio.dmg` (and the zip electron-updater applies), `win-x64-JxStudio-Setup.exe` and the Store's `win-x64-JxStudio.appx`, and `linux-<arch>-JxStudio.AppImage`.

`bun run smoke` starts the packaged backend with the Bun that ships beside it, through the same IPC the Electron main process uses, and asks it to do the things a bundle can lose: create a project, build a site, preview it, read the extension catalog and resolve the client runtime. Unit tests run the sources and cannot see a data file nobody staged, so this runs on every pull request that reaches this package and in every release lane.

Signing and notarization read their credentials from the environment (`CSC_LINK`, `APPLE_API_KEY` and friends) and are skipped, loudly, when absent, so an unsigned local build still completes. See [`SIGNING.md`](./SIGNING.md) for the Windows Store certificate.

## Architecture

```
Electron main process  ←→  JSON IPC  ←→  Bun backend (src/hub/main.ts)
 windows · menu · dialogs                 one hub, N windows:
 single-instance lock · updater            ProjectSession + server + token each
        │                                           │
        └── one BrowserWindow per window ───────────┘ token-gated WebSocket RPC
```

Studio communicates with its backend through the [Platform Abstraction Layer](../studio/README.md): the same interface `@jxsuite/server` uses in dev mode, and the one cloud APIs will use in the future.

### RPC categories

| Category   | Handlers                                                                             |
| ---------- | ------------------------------------------------------------------------------------ |
| Filesystem | `readFile`, `writeFile`, `deleteFile`, `renameFile`, `createDirectory`, `uploadFile` |
| Project    | `openProject`, `listDirectory`, `discoverComponents`, `resolveSiteContext`           |
| Git        | `status`, `branches`, `log`, `stage`, `commit`, `push`, `pull`, `diff`, `discard`    |
| Packages   | `addPackage`, `removePackage`, `listPackages`                                        |
| Code       | `codeService`, `locateFile`, `fetchPluginSchema`                                     |

## Dependencies

| Package            | Purpose                                                      |
| ------------------ | ------------------------------------------------------------ |
| `@jxsuite/studio`  | Studio UI                                                    |
| `electron-builder` | Packages the application (dev dependency)                    |
| `electron-updater` | Self-updates, bundled into the main process (dev dependency) |

## License

MIT
