---
status: drafted
disposition: implement
claims:
  - desktop.md#7.7
requires:
  - desktop/node-backend-runtime
workspaces:
  - packages/desktop
  - .github
size: M
---

# Jx Studio reaches the Mac App Store, and the sandbox is measured

## Context

`specs/desktop.md` §7.7 adds the Mac App Store as a second macOS channel. What exists: the `mas` target in `electron-builder.yml`, the two entitlements files, `bun run package --target mas`, and the updater's refusal inside a Mac App Store install. What does not: any run of it with a distribution identity, an upload lane, and an answer to how the backend reaches a folder the user picked.

A sandboxed application reads a folder only after the user picks it, and the permission reaches a child process only if the child starts after it was given. The Bun backend started at launch, so a picked project was invisible to it. A local ad-hoc sandboxed build of the Mac App Store flavor showed it, and the fix (bookmarks, restored before the backend starts, plus a backend restart for a pick no bookmark covers) was measured to work, including after a relaunch. A build signed with the real identities (`6.1.0 (443)`, from TestFlight) was then measured the same way and passed: launch, pick, a full project, and Recent after a relaunch. App Review rejected it at the automated stage for two findings: 129 ICU symbols the pinned Bun imports from the system `libicucore` (non-public API), and the `network.server` entitlement. The first is closed only by removing Bun from the package, which is `plan:desktop/node-backend-runtime`; the second needs a reply, since the backend listens on loopback. What is left is that plan, Git in the sandbox, and review.

## Outcome

- §7.7 → Implemented: a TestFlight build opens a project folder the user picks, edits and saves in it, keeps it in recents across a relaunch, and the upload lane delivers each desktop release's build to App Store Connect.

## Decisions

- **Decided:** the lane uploads to TestFlight only. Submitting to App Review is a person's decision, and a bad build must not go straight to review.
- **Decided:** the store's build has no updater, and no site import (its browser is never set on macOS, §9.5).
- **Decided:** `com.apple.security.network.server` stays. Each window's backend server listens on loopback for its Studio window and canvas iframe (§9.7), and binding a listening socket in the sandbox needs it. The reply to App Review and the App Review Information notes say so.
- **Decided:** the backend reaches a picked folder because it starts after the grant. The sandbox build asks for the project folder (a picked file grants only itself), keeps an app-scope bookmark per folder, restores them before spawning the backend, and restarts the backend when a pick is not covered, asking first when a project is open. Routing file access through the main process was not needed.
- **Open:** whether `git` is worth keeping in the sandbox. The system's `git` is Apple's developer-tools shim and cannot read the user's Git configuration, keys or credential helpers. Options: keep it for HTTPS, disable the Git workflow in this build, or ship a Git of our own.

## Implementation

- Create the app record, the Apple Distribution and Mac Installer Distribution certificates and the provisioning profile (a person does this in App Store Connect and the developer portal), and store them as secrets (`MAS_CERTIFICATE_BASE64`, `MAS_INSTALLER_CERTIFICATE_BASE64`, their passwords, `MAS_PROVISIONING_PROFILE_BASE64`).
- Run `store-publish-mac.yml` by `workflow_dispatch` and read its logs, then install the build from TestFlight and open a project.
- Settle the two Open decisions above on what that build does, and implement the chosen access path.

## Tests

`tests/mas-config.test.ts` holds the `mas` block and the entitlements. The access path adds its own tests with the code that implements it, and the bookmarks or respawn logic is covered through the fake Electron in `tests/_fake-electron.ts`.

## Specs & docs

§7.7 is edited in place as each Open item closes, with a fragment (`bun run spec:change specs/desktop.md patch -m "..."`). `docs/studio/desktop.md` gains the Mac App Store install once the store lists the app, and `packages/desktop/AGENTS.md` records the one-time setup and the lane's behaviour.

## Acceptance

- A TestFlight build installs and opens a picked project, edits it, and finds it again after a relaunch.
- The lane uploads a build on a desktop release and warns, without failing, until its secrets exist.
- The two Open decisions are Decided in §7.7.
