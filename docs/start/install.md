---
title: "Install Jx Studio"
description: "Download the Jx Studio desktop app for macOS, Windows, or Linux, and run the visual editor on your own machine, against your own files."
code:
  - packages/desktop/snap/snapcraft.yaml
  - packages/desktop/package.nix
---

# Install Jx Studio

Jx Studio is a desktop application: you run it on your own machine, against your own files. Jx Cloud, a hosted version you open in a browser and sign in to with GitHub, is in development, so the desktop app is how you run the visual editor today.

## Download the app

Grab an installer for your platform from the [latest release](https://github.com/jxsuite/jx/releases/latest):

| Platform              | Download                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------ |
| macOS (Apple Silicon) | [`JxStudio.dmg`](https://github.com/jxsuite/jx/releases/latest/download/macos-arm64-JxStudio.dmg)            |
| Windows (x64)         | [`JxStudio-Setup.exe`](https://github.com/jxsuite/jx/releases/latest/download/win-x64-JxStudio-Setup.exe)    |
| Linux (x64)           | [`JxStudio.AppImage`](https://github.com/jxsuite/jx/releases/latest/download/linux-x86_64-JxStudio.AppImage) |
| Linux (ARM64)         | [`JxStudio.AppImage`](https://github.com/jxsuite/jx/releases/latest/download/linux-arm64-JxStudio.AppImage)  |

The macOS build is notarized, so it opens without a Gatekeeper prompt. The Windows installer is not yet code-signed, so SmartScreen warns on first run. Choose **More info → Run anyway**. The [Download page](/download) has the same links plus checksums and release notes.

:::doc-note
Jx Studio is Apple Silicon only. There is no macOS x64 build, so Intel Macs can still run the last release that had one, which no longer receives automatic updates.
:::

On Linux, make the AppImage executable (`chmod +x JxStudio.AppImage`) and run it. It needs FUSE 2, which recent Ubuntu releases no longer install by default: `sudo apt install libfuse2t64` on 24.04, `libfuse2` before that. Ubuntu 24.04 and later also restrict the sandbox Electron relies on for apps that are not installed from a package, so on Ubuntu the snap below is the better route.

## Ubuntu (Snap Store)

On Ubuntu, and on any distribution with snapd, install Jx Studio from the Snap Store:

```bash
sudo snap install jx-studio
```

The snap runs the same Studio application as every other platform, with the window frame and buttons Studio draws itself, and draws natively on Wayland. It updates through the Snap Store rather than through Studio's own update prompt.

The snap is confined, so it reaches the folders in your home directory and on removable media. To open a project on removable media, connect that interface once:

```bash
sudo snap connect jx-studio:removable-media
```

## NixOS

On NixOS the same desktop app is packaged as a Nix derivation rather than an installer, because its bundler cannot run in a Nix sandbox. It runs Studio in an Electron window from nixpkgs with the same title bar and window buttons as the other platforms, and presents the identical editor.

```bash
nix run github:jxsuite/jx/release
```

Pin the `release` branch, not `main`: `release` holds only released code, and it advances to a release only after that release has built. `main` is the development trunk, so it will sometimes be ahead of anything that has shipped.

To install it instead of running it once:

```bash
nix profile install github:jxsuite/jx/release
```

Either form takes an optional project directory, as in `nix run github:jxsuite/jx/release -- ~/sites/my-site`, and opens the project picker without one. Running it again while Studio is open does not start a second copy: it opens that project in the running app, or brings its window forward if it is already open.

### Fetch it instead of building it

Released builds are published to a public [Cachix](https://cachix.org) cache, so the commands above can download Studio without compiling the monorepo on your machine. The rest of the closure (Electron, Chromium for site import, and Bun) already comes from `cache.nixos.org`.

The flake names the cache itself, so Nix offers to use it the first time you run one of the commands above. Answer `y`, or pass `--accept-flake-config` to skip the prompt:

```bash
nix run github:jxsuite/jx/release --accept-flake-config
```

:::doc-warning
Nix honours a flake's own substituter settings only for users listed in `trusted-users`, which on a stock NixOS install is `root` alone. If you see `ignoring untrusted substituter`, the prompt was accepted but the cache was not used, and Studio is being built from source.
:::

To make it stick regardless, add the cache to your system configuration:

```nix
nix.settings = {
  extra-substituters = [ "https://jxsuite.cachix.org" ];
  extra-trusted-public-keys = [
    "jxsuite.cachix.org-1:kwYafZ+qeKSsR7F9dxC2zLJjsJtGaBk012QoLhe4zMM="
  ];
};
```

Off NixOS, the same two keys go in `/etc/nix/nix.conf`, or run `cachix use jxsuite` to write them for you.

Once installed, open Studio and either **create a new project**, **open an existing folder**, or **clone a repository**. [Your first project](/docs/start/first-project) walks through it.

## Updating

Studio checks your project's `@jxsuite/*` dependencies against each package's own newest published version and offers to update them when one is behind, and prompts when a newer release of the app itself is available (the snap and the Nix package are updated by the Snap Store and by Nix instead). Studio's own copy of those packages is separate. Your project's ranges govern `jx build` and your project's types rather than the running app, so there is no reason for them to match Studio's version.

## For developers: scaffolding from a terminal

Today the visual editor runs as the desktop app above. The Nix commands build and launch that same app, and there is no way to serve Studio itself as a headless web app. If you'd rather generate a project's files from a terminal before opening them in Studio, see [CLI commands](/docs/framework/build/cli) for `bun create @jxsuite` and the `jx` CLI.

## Next

Continue to **[Your first project](/docs/start/first-project)**.
