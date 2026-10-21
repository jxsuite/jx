---
status: drafted
disposition: implement
claims:
  - desktop.md#7.7
workspaces:
  - packages/desktop
  - .github
size: M
---

# Jx Studio reaches the Mac App Store, and the sandbox is measured

## Context

`specs/desktop.md` §7.7 adds the Mac App Store as a second macOS channel. What exists: the `mas` target in `electron-builder.yml`, the two entitlements files, `bun run package --target mas`, and the updater's refusal inside a Mac App Store install. What does not: any run of it with a distribution identity, an upload lane, and an answer to how the backend reaches a folder the user picked.

A sandboxed application reads a folder only after the user picks it, and the grant belongs to the process that received it. The Bun backend is spawned at launch, before any pick, so a project chosen later is invisible to it. That is the one open design question, and it can only be answered on a signed sandboxed build.

## Outcome

- §7.7 → Implemented: a TestFlight build opens a project folder the user picks, edits and saves in it, keeps it in recents across a relaunch, and the upload lane delivers each desktop release's build to App Store Connect.

## Decisions

- **Decided:** the lane uploads to TestFlight only. Submitting to App Review is a person's decision, and a bad build must not go straight to review.
- **Decided:** the store's build has no updater, and no site import (its browser is never set on macOS, §9.5).
- **Open:** how the backend reaches a picked folder. Candidates: spawn the backend after the first pick and respawn per project; have the main process perform file access over the existing IPC; or find an entitlement review will accept. The first is the least code and costs a backend per project, the second is a rearchitecture of the file API. Measure on a signed build before choosing.
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
