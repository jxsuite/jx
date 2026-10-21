---
title: "The desktop app"
description: "Jx Studio as a native app: open projects with native dialogs, one window per project, automatic background updates, and no dev server to run."
spec:
  - desktop.md#1
  - desktop.md#3.4
  - desktop.md#4
  - desktop.md#7.5
  - desktop.md#7.7
  - desktop.md#9.5
  - desktop.md#9.7
code:
  - packages/desktop/src/boot.ts
  - packages/studio/src/platforms/default-platform.ts
  - packages/studio/src/surfaces/boot-failure.ts
  - packages/studio/src/surfaces/boot-failure.json
  - packages/desktop/src/chromium/platform.ts
  - packages/desktop/src/chromium/shell-command.ts
  - packages/desktop/src/open-external.ts
  - packages/desktop/src/hub/backend.ts
  - packages/desktop/src/hub/handlers.ts
  - packages/desktop/src/hub/main.ts
  - packages/desktop/src/hub/protocol.ts
  - packages/desktop/src/hub/window-hub.ts
  - packages/desktop/src/electron-shell/app-main.ts
  - packages/desktop/src/electron-shell/app.ts
  - packages/desktop/src/electron-shell/backend-process.ts
  - packages/desktop/src/electron-shell/bridge.ts
  - packages/desktop/src/electron-shell/bundle.ts
  - packages/desktop/src/electron-shell/layout.ts
  - packages/desktop/src/electron-shell/main.ts
  - packages/desktop/src/electron-shell/preload.ts
  - packages/desktop/src/electron-shell/shell.ts
  - packages/desktop/src/electron-shell/updater.ts
---

# The desktop app

The desktop app is Jx Studio as a native application: the same Studio documented everywhere else in this section, wrapped in its own window with everything it needs bundled inside. You install it, open it, and build, with no terminal, no dev server and no browser tab. It edits the plain files in your project folders directly.

![The Studio workspace, the same interface in the desktop app and the browser](../images/hero.png)

## Install and update

Download the installer for macOS, Windows, or Linux from the **[install page](/docs/start/install)**, which covers each platform's package and what to expect on first launch.

Once installed, updates take care of themselves. The app checks for a new release shortly after launch and every few hours after that, and downloads it in the background. When one is ready, a dialog reading **Jx Studio x.y.z is ready** offers **Restart Now** or **Later**, and asks once per version. Choosing **Later** loses nothing: the update installs the next time you quit.

To see where you stand, click **About** at the foot of the Navigator rail. The dialog shows the app version, its release channel, and the current update status.

Where an update comes from depends on how you installed. The macOS app, the Windows installer and the Linux AppImage update themselves as described above. A Microsoft Store or Mac App Store install is updated by its store, the Ubuntu snap by the Snap Store, and the NixOS build by your package manager.

## Open a project

A fresh window greets you with the **[welcome screen](/docs/studio/interface/welcome-screen)**: create a **[new project](/docs/studio/projects/create)**, open an existing one, or pick from your recent projects, a list shared across all windows.

To open an existing project:

1. Choose _File > Open Project…_ or press :kbd[⌘O] (macOS) / :kbd[Ctrl+O] (Windows/Linux), or click **Open Project...** on the welcome screen.
2. If a project is already open, Studio asks where the next one should go: **This Window** or **New Window**.
3. A native file dialog opens. Select the project's `project.json` file, the file that marks a folder as a Jx project.
4. The project opens with the folder around `project.json` as the project root.

You can also open a project straight from your file manager: if your system associates it with Jx Studio, double-clicking a `project.json` opens that project.

:::doc-note
`project.json` is the project's settings file, and Studio creates it for every new project. What's inside is described in **[Project settings](/docs/studio/projects/settings)**.
:::

## One window per project

Each window holds one project, and the window's title tells you which. When you open another project from a window that already has one, Studio asks where it should go:

- **New Window** leaves this window untouched, with its project, its tabs and its unsaved work, and the project you pick opens beside it.
- **This Window** replaces the project here. Anything unsaved is confirmed first.

Opening a project that's already open never duplicates it: whichever you chose, the window that has it comes to the front instead.

**[New Project](/docs/studio/projects/create)** never asks where to put the result. If this window already has a project, the one you just created opens in a window of its own automatically, leaving this window exactly as it was; if it doesn't, the new project opens right here.

What belongs to **you** rather than to a project is shared by every window: your recent projects, and everything in **[Preferences](/docs/studio/interface/preferences)**: the theme, your AI provider, the accounts you are signed in to. Each window writes only the settings it actually changed, so two windows open at once cannot overwrite each other's.

_File > Open Project…_ from the app menu always opens into a window of its own, and **New Window** (:kbd[⇧⌘N] / :kbd[Ctrl+Shift+N]) opens a fresh welcome window when you want to start something else, either from the _File_ menu or by name from the **[command list](/docs/studio/interface/commands)**.

## How it differs from Studio in the browser

Studio itself is identical in both, and every page in this documentation applies to each. The differences are around the edges:

- **Nothing to run.** In the browser, Studio is served by a local dev server you start from a terminal (see **[The dev server](/docs/framework/build/dev-server)**). The desktop app carries its own backend, so you launch it like any other application.
- **Native dialogs.** Opening projects and picking folders use your operating system's file dialogs instead of the browser's folder picker.
- **Windows, menus, and file associations.** One window per project, `project.json` opening from the file manager, and on macOS a real _File_ menu in the menu bar. On Windows and Linux, Studio draws its own menu in the command bar.
- **Built-in updates.** The app updates itself in the background; a dev-server setup, and the NixOS build below, updates with your package manager.

The AI assistant, publishing, and everything on the canvas behave the same in both.

## Platform notes

Installers are provided for macOS (Apple Silicon), Windows (x64), and Linux (x64 and ARM64). See the **[install page](/docs/start/install)** for downloads. Intel Macs are no longer among the builds. Every one of them is the same application, built on Electron. On NixOS the app is packaged by Nix instead of an installer: `nix build` produces it, and it runs on the Electron that nixpkgs provides.

Everything on this page applies to the NixOS build. Projects open the same way, through the same native dialogs; each project gets a window of its own, and opening one that is already open brings that window forward. One thing differs, because of who packaged it:

- **Your package manager updates it**, so there is no in-app updater and _About_ shows no update status.

The window itself is Studio's, as on every other platform: the command bar is the title bar, so drag it to move the window, and the minimize, maximize and close buttons sit at its right end. Resize the window from its edges as usual. If a project has unsaved changes, closing the window asks first. The window opens the same way whatever starts `jx-studio`, including a task or extension in an editor such as VS Code.

Further windows come from the _File_ menu's **New Window**, from the **This Window / New Window** question above, or from running `jx-studio <project>` again, and running it for a project that is already open raises that window instead of opening a second one.

## If a window can't reach the app

Everything a window does with your files (opening and creating projects, reading, saving) goes through the app's background process. If a window starts without that connection, it shows **Jx Studio couldn't connect to its backend** in place of the editor, together with the error it ran into. Nothing on disk is touched, so closing the window loses nothing.

Click **Reload** first. If the message comes back, quit and reopen Jx Studio, then reinstall it from the [install page](/docs/start/install). When you report it, click **Copy details** and include what it copies, along with your operating system and its version.

:::doc-note
Versions 5.0.0 through 5.1.3 didn't catch this, and every desktop build in that range started without its connection. The window opened normally, but the New Project gallery offered only **Start from scratch**, **Browse…** opened a picker whose choice never reached **Location**, and **Create Project** failed with "Failed to fetch". Those symptoms together are this problem, and your projects are unaffected. Those versions also can't apply an update, so the notice to restart never appears: download the current release from the [install page](/docs/start/install) and install it over the old one.
:::

## Next

- Get it installed: **[Install Jx Studio](/docs/start/install)**
- Build something: **[Your first project](/docs/start/first-project)**
- Find your way around: **[Studio tour](/docs/start/studio-tour)**
