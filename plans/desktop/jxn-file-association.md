---
status: drafted
disposition: implement
claims:
  - desktop.md#7.8
requires: []
workspaces:
  - packages/desktop
  - specs
  - docs
size: M
---

# Double-clicking a `.jxn` file opens it in Jx Studio on every channel that can register a file type, and the channels that cannot say so

## Context

`specs/desktop.md` §7.8 is Pending. No channel declares `.jxn`, and desktop.md §4.6 and §4.7 have given every path one resolver and a trust prompt, and §7.4 has removed the old `.json` claim. This plan is what is left: declaring the type, per channel, with the things electron-builder does not do on its own.

**What electron-builder 26.18 does with `fileAssociations`, from its source:**

| Target | Generates                                                                                | Not enough because                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| NSIS   | `APP_ASSOCIATE` with `item.name` as the file class, and `<ext>.ico` from build resources | Works, and `name` must be class-shaped (`JxStudio.Document`). The macro's own header asks for that form                               |
| AppX   | `<uap:FileTypeAssociation Name="jx">` with only `.jxn`                                   | Works. It takes no display name or logo from the config, so a richer entry needs `customExtensionsPath`                               |
| macOS  | `CFBundleTypeExtensions`, name, role, rank                                               | No `LSItemContentTypes` and no exported type, so it cannot state what `.jxn` is. Declared by hand in `mac.extendInfo`; `mas` inherits |
| Linux  | `MimeType` only when `mimeType` is set; the AppImage stages a `mime/packages` file       | The current config sets none. The generated XML has no `sub-class-of`, and nothing installs it on the host                            |

**What the platforms allow.**

- **Snap:** a strict snap has no supported way to add a type to the host's MIME database. A desktop entry's `MimeType` works only for a type the host already knows, the forum's proposed interface for it remains a proposal, and `electron-builder`'s own docs describe `mimeTypes` as reusing existing types. On a host without our type, `.jxn` should sniff as `text/plain`. Listing `text/plain` would offer Jx Studio for every text file, and one click on "Always" would then take over all of them.
- **AppImage:** an AppImage is one file a user put somewhere, with no install step, so nothing registers anything unless something does it deliberately. Whether its launcher does so was not established from the builder's source.
- **Mac App Store:** the grant question is desktop.md §4.6's.

**`.jxn` is close to unclaimed.** `spec.md` §22 records why this extension was chosen over `.jx`. A few stray files use it and no format does, so `Owner` rank on macOS and a default on Windows take nothing from anyone. Jx Studio can still be handed a file of that name that is not ours, and has to say so.

**KDL names no media type or extension.** The current specification draft has no IANA section, so nothing conflicts with a `.jxn` type of our own.

## Outcome

- desktop.md §7.8 → Implemented, with Snap's row as a stated limit.
- Double-clicking a `.jxn` opens it through desktop.md §4.6 on macOS, the Mac App Store, Windows, the Microsoft Store and Nix. All but the Microsoft Store show a document icon and a "Jx file" kind.
- An AppImage user can register the type with one command. A Snap user reads why they cannot, in the install docs.
- A `.jxn` that is not ours gets a sentence, not a window.

## Decisions

- **Decided:** declare by platform and not at the top level of `fileAssociations`, because macOS needs a shape that key cannot express and would otherwise be declared twice. `win.fileAssociations` and `linux.fileAssociations` carry it, `AppxTarget` reads the former as well, and `mac.extendInfo` carries the rest.
- **Decided:** the Microsoft Store entry is what `win.fileAssociations` generates: the type with no display name or logo (`AppxTarget.js:331`). Adding `.jxn` to `customExtensionsPath` beside it would declare it twice (`:343`), and replacing `win.fileAssociations` with custom XML means owning the NSIS side too. A better Store icon can come later and does not change what opens.
- **Decided:** one type for both meanings of `.jxn`. A project file and a document differ by content (`site-architecture.md` §2.3) and an OS type is keyed by extension. `resolveOpenTarget` tells them apart.
- **Decided:** the macOS type is `com.jxsuite.jxn`, exported, conforming to `public.plain-text`, with `LSHandlerRank: Owner`. Conformance gives Quick Look and TextEdit for free. The rank is `Owner` because we define the format and no other application on most machines knows it.
- **Decided:** the MIME type is `text/x-jxn`, sub-class of `text/plain`, so a file manager's Open With still offers text editors. It is not registered with IANA. RFC 6648 discourages `x-` in new protocols, but it is what the shared MIME database uses for unregistered types, and a registered `vnd.` type is a process this format does not need yet. HTTP does not use this type; see `spec.md` §22.
- **Decided:** one committed MIME file, `packages/desktop/jx-studio.mime.xml`, which `package.nix` installs to `share/mime/packages` and the AppImage command writes. A test holds it equal to the two tracked desktop entries' `MimeType` lines and to `linux.fileAssociations`' `mimeType`, which feeds the generated entry.
- **Decided:** AppImage registration is a command the user runs, `file.registerFileTypes`, shown only when `process.env.APPIMAGE` is set. It writes `~/.local/share/mime/packages/` and a desktop entry whose `Exec` is the AppImage's current path, then runs `update-mime-database` and `update-desktop-database` when they are on `PATH`. It does not run on its own, because an AppImage's whole promise is that nothing changes on the system until you ask. If the file moves, the registered entry is stale, and the command says so on next launch rather than rewriting it silently.
- **Decided:** on Snap, no type and a documented limit, marked `> **Status: Future.**` in §7.8's row. Requesting a store-reviewed `personal-files` plug would give write access to `~/.local/share/mime` and still could not run `update-mime-database` on the host, so it does not solve this.
- **Decided:** a file that is not ours is refused by `resolveOpenTarget` with one sentence naming it, covering invalid UTF-8 and text that does not parse as KDL. It does not offer to open anything else.
- **Decided:** document icons are `build-resources/jxn.ico` and `jxn.icns`, which electron-builder finds by extension, rendered from `branding/` by a script. On Nix, `share/icons/hicolor/*/mimetypes/text-x-jxn.png`. A distinct document icon is an owner decision about artwork, and falling back to the app icon is acceptable until then.
- **Decided:** this may land before `plan:site-architecture/provision-project-jxn`, and should, so that the first people given a `project.jxn` can double-click it. It needs `.jxn` to open correctly, not to be the default.
- **Decided:** a loose document is `plan:desktop/single-file-mode`'s and not a requirement here. Until that lands, a `.jxn` in no project is refused with a sentence, as desktop.md §4.6 already does for `.json`. So associating `.jxn` does not wait for that plan and its prerequisites, and its `file` kind fills the row when it lands.
- **Open:** submit `*.jxn` upstream to `shared-mime-info`? Recommendation: yes, as an owner action after this ships. It is the only route that ever fixes Snap, since a type the host knows works with a plain `MimeType` line, and it also spares every other channel. It reaches users only as distributions update, so it is not a dependency.

## Implementation

- `packages/desktop/electron-builder.yml`: `win.fileAssociations`, `linux.fileAssociations`, `mac.extendInfo` beside what is there.
- `packages/desktop/jx-studio.desktop`, `snap/gui/jx-studio.desktop`: `text/x-jxn` in `MimeType`. On the snap it is inert until the host knows the type, which is what makes an upstream type fix it with no further release. `package.nix`: install the MIME file and icons.
- `src/main/`: the AppImage command through the launcher-extras path (`desktop.md` §3.1), which stays out of `StudioPlatform`, and a command record in Studio feature-detected the same way.
- `tests/`: as below. `scripts/desktop-build-lanes.test.ts` is unaffected, since no artifact name changes.
- `packages/desktop/AGENTS.md`: add each channel to "Unverified until a release has run them".

**Related, no edge.** `plan:desktop/packaged-window-boot-ci` would let CI prove a launch, and today none can. `plan:desktop/mac-app-store` also edits the `mas` block.

## Tests

- `tests/file-association-config.test.ts`: the config declares `.jxn` on each channel, `Owner` rank, `com.jxsuite.jxn` conforming to `public.plain-text`, the class-shaped `name`, and the MIME file equal to every desktop entry.
- `tests/electron-app.test.ts` with the fake electron: a `.jxn` path reaches `open-path`. `resolveOpenTarget`: `project.jxn`, a `.jxn` page in a project, `pages/project.jxn`, a binary `.jxn` and a `.jxn` in no project.
- The AppImage command against a temporary home: files written, tools skipped when absent, and stale-path reporting.
- A test calls electron-builder's `computeDesktopEntry` and asserts the entry names `text/x-jxn`. `--dir` cannot do this, since it is `NoOpTarget` (`targetFactory.js:80`) and generates no entry. Coverage thresholds ratchet. `bun test --isolate` throughout.

## Specs & docs

- `desktop.md` §7.8: delete the marker, and give the Snap row a `> **Status: Future.**` remainder. §7.4's tree lists the new files. §12 gains rows for the freedesktop shared MIME database and desktop entry specifications, with `scripts/docs/standards.json`. `bun run spec:change desktop.md minor -m "Jx Studio declares .jxn on each channel that can register a file type"`.
- `docs/studio/desktop.md`: opening a `.jxn` from the file manager, what the trust prompt is, and what to do on AppImage. `docs/start/install.md`: the per-channel limit. Marketing copy says nothing about file types beyond what `docs:claims` can check.

## Acceptance

Manual, per channel, because nothing boots a packaged window in CI. Each row needs a release build:

- macOS and Mac App Store: a `.jxn` shows the kind and icon, Quick Look shows its text, and a double-click opens it.
- Windows installer: the same, and "Open with" lists Jx Studio. `.json`'s default does not move. Microsoft Store: a double-click opens it.
- NixOS: `xdg-mime query filetype x.jxn` answers `text/x-jxn`, and `xdg-open x.jxn` opens it.
- AppImage: the same after running the command.
- Snap: the docs' limit matches what actually happens.
- A binary named `x.jxn`, and a text file there that is not KDL, each get a sentence and no window.
- `bun run all-the-things`, `plans:check`, `docs:check` and `docs:standards` are green.
