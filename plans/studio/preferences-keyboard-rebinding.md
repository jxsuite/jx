---
status: drafted
disposition: implement
claims:
  - studio.md#15
requires: []
workspaces:
  - packages/studio
  - specs
  - docs
size: M
---

# Application Preferences specifies the Keyboard sheet's rebinding layer, and every window keeps that layer whole

## Context

`specs/studio.md` §15, line 1556 (the census kept the section Partial and re-grounded it):

> **Status: Partial.** Everything the body specifies ships: the four sections, the Settings-menu deep links, account rows that never print a secret, the brokered Cloudflare row and the three value rules (`packages/studio/src/settings/preferences-dialog.ts`, `preferences-sections.ts`, `preferences-accounts.ts`). The table's Keyboard row says read-only, but the sheet rebinds: `preferences-keymap.ts` captures a chord, `rebindCommand` refuses a conflicting one, and the result is an override map laid over the registry and remembered across windows.

Line 1558 follows it and stays as it is:

> **Status: Future.** An Editor-behaviour pane and an Updates/About pane. Both were named in this section's status line from its first draft and never specified in its body, and `PREFERENCES_SECTIONS` is the four sections the table names.

The body still says read-only: the table's Keyboard row (line 1571) is "Read-only, **generated** from the command registry", and rule 2 (line 1576) says the sheet cannot drift "from the app or from the documentation", which stopped being literally true once the sheet printed the author's layer. Rebinding shipped in 0.9.30; the changelog entry says so.

**What ships** (verified against the tree, paths under `packages/studio/src/`)

- `settings/preferences-keymap.ts`: `isBindableChord`, `rebindCommand` with three refusals (not a chord; a bare printable key; a chord held in an overlapping scope, named with the holder's title and, across scopes, `SCOPE_WHERE`), `resetKeybinding`, `loadKeybindingOverrides` (entry-by-entry validation), `applyKeybindingOverrides`. Binding a command to its declared chord deletes the override.
- `commands/keymap.ts`: `setOverrides`, `declaredFor`, `overrides`, `onChange`, and the precedence rule (an override outranks a default; a default never evicts an override). `overlappingScopes`: a scope overlaps itself and `global`, `global` overlaps every scope but `palette`, `palette` overlaps only itself.
- `settings/preferences-dialog.ts`: the Keyboard view (`keyboardView`, search by name or by keystroke, **Change**/**Cancel**/**Reset**, **Show** on a conflict), capture with `stopPropagation` so a captured ⌘S does not save; `registerPreferencesCommands` applies the stored layer once at boot.
- The layer is the user setting `jx.keybindings` (`services/settings/definitions.ts`), so it is written through the settings kernel (`services/settings/kernel.ts`) and reaches the backend store.
- Tests: `tests/preferences-keymap.test.ts`, `tests/preferences-dialog.test.ts` ("Keyboard — rebinding"), `tests/commands-keymap.test.ts`, `tests/settings-kernel.test.ts`.

**What does not ship: rule 5 for the keyboard layer.** The stub listed "roaming through the PAL's `subscribeSettings`" as existing. The kernel roams; the keymap does not follow it.

- `applyKeybindingOverrides` has one caller, `registerPreferencesCommands` (`src/studio.ts` line 1571). Nothing re-applies the layer when `onSettingsChanged` fires, so a rebinding made in another window, or a layer that arrives with `hydrateSettings()` (fired un-awaited at line 1195, and so landing after line 1571's synchronous registration), updates the kernel and repaints the shell but never reaches this window's keymap or its canvas frame until a reload. On the chromium launcher every window has its own `localStorage`, so a fresh window boots with no layer at all.
- `rebindCommand` and `resetKeybinding` build the next layer from `registry.keymap.overrides()` (lines 235 and 253), the copy this window booted with, then `setSetting` the whole map. A stale window that rebinds anything therefore erases every rebinding another window made since it booted. That is the loss rule 5 forbids ("a window that knows nothing about a setting can never be the reason it is lost"), and it also falsifies `docs/studio/desktop.md` line 61 ("two windows open at once cannot overwrite each other's").
- The browser hosts (dev server, cloud) have no settings store and no `subscribeSettings`; `watchRemoteSettings` is a no-op there, and `tests/settings-kernel.test.ts` line 405 records that as intended ("stale, never wrong"). Two tabs of one origin share `localStorage` but not the kernel's in-memory values, so there a second tab is stale for every setting, and for the one-key keyboard layer, wrong.

**Also stale:** `settings/preferences-sections.ts` line 28 says "§15 lists six for the finished surface"; §15's table names four and records the other two as Future. `docs/studio/interface/preferences.md` line 72 says "Only the same group conflicts", but a chord held in **Anywhere** is refused for every other group (`overlappingScopes`).

**Related:** studio.md §13.1 (`keybinding`: "User overrides layer on top"), §13.3 (the scope stack, and the canvas frame's `keymap` message "reposted whenever a rebinding changes what is live"), §10 (the tables), §5.1 (the Settings menu).

## Outcome

- studio.md §15 → Implemented, with the Future remainder (Editor behaviour, Updates/About) unchanged. The Keyboard row and rule 2 specify the rebinding layer that ships; rule 5 holds for it on every host (on the browser hosts through the bridge the second Open recommends): a layer changed elsewhere is live here at once, and a rebinding or reset keeps every entry it does not name.
- studio.md stays Partial (27 other open items, §3.3 through §20.2, remain claimed by other plans), so nothing graduates and `plans/studio/` stays.

## Decisions

- **Open:** implement, where the census stub proposed reconcile. Recommendation: implement, because rule 5 is false for the keyboard layer in a way that loses data (a stale window's rebinding erases another window's), and reconciling would mean writing "except the keyboard" into the one rule whose stated purpose is that no window can lose a setting. The code change is about 40 lines in `preferences-keymap.ts` plus the kernel bridge below.
- **Open:** does rule 5 bind the browser hosts, where the platform has no settings store? Recommendation: yes; `watchRemoteSettings` listens for the browser's `storage` event whenever the platform has no `subscribeSettings`, because it is about 25 lines, it makes every preference (not only the keyboard) reach a second tab, and it is what `docs/studio/interface/preferences.md` line 25 already promises ("so a second window sees it"). Without it the merge below does not help between tabs: a stale tab's kernel is as stale as its keymap, so its rebinding still writes the whole layer over another tab's. Declining therefore costs two carve-outs, not one: rule 5's live clause is scoped to "where the platform keeps a settings store (the desktop app)", and its loss clause gains "except the keyboard layer between browser tabs, where a tab that has not reloaded can overwrite another's rebindings", which is the exception the first Open rejects; line 25 of the docs page is scoped the same way.
- **Decided:** the keymap follows the kernel through a new `followKeybindingOverrides(registry, onApplied?)` in `preferences-keymap.ts`, subscribed to `onSettingsChanged` and filtered on `jx.keybindings`, because the kernel is already the one owner of the value and already announces every local write, remote adoption and hydration. It re-applies only when the stored layer differs from `registry.keymap.overrides()`, so this window's own write (already applied by `rebindCommand`) does not rebuild the keymap twice or repost the canvas chord table twice.
- **Decided:** `rebindCommand` and `resetKeybinding` start from `loadKeybindingOverrides()` (the layer as the kernel holds it now) instead of `registry.keymap.overrides()`, because the write replaces the whole setting and must be computed from the value it replaces. The conflict check still reads the live keymap; the follower is what keeps the two equal, so a caller that never subscribed gets a correct merge but may miss a conflict with an entry it has not applied.
- **Decided:** the residual race is accepted. `jx.keybindings` is one setting and a patch is per key, so two windows rebinding within one push's latency still resolve last-write-wins on the whole layer. Splitting the layer into one setting per command would change the declared setting and every stored layer for a window of milliseconds; the spec text below says "as it is stored now", which is exact.
- **Decided:** a storage event is a doorbell, not the value. The bridge re-reads each named key from `localStorage` rather than adopting `event.newValue`, because events arrive after storage has moved on: in a burst (v1 then v2) the v1 event lands when storage already holds v2, and adopting v1 would write it back through `apply`'s cache write, reverting the store and firing a fresh event at every other tab. Re-reading makes that write-back a no-op, and the storage algorithm fires nothing for an unchanged value.
- **Decided:** the open sheet repaints when a remote layer lands (`registerPreferencesCommands` passes the dialog's `repaint` as `onApplied`); an armed capture and the last refusal are left alone, because the capture holds a command id and is resolved against the live registry when the chord lands.
- **Decided:** no unbind verb. The keymap honours a stored empty list as "unbound" (`KeybindingOverrides` in `commands/keymap.ts`), but the sheet only offers Change and Reset, and §15 specifies the sheet; a Remove verb is a feature no spec asks for.
- **Decided:** `registerPreferencesCommands` and `watchRemoteSettings` return their unsubscribe, which the bootstrap drops (as `watchRemoteSettings` already documents), because the tests must detach a module-level listener between cases.

## Implementation

All paths under `packages/studio/`.

1. **`src/settings/preferences-keymap.ts`**
   - Import `onSettingsChanged` beside the existing kernel imports.
   - Private `sameLayer(a: KeybindingOverrides, b: KeybindingOverrides): boolean`: equal size, and every id in `a` has an equal chord array in `b`.
   - `export function followKeybindingOverrides(registry: CommandRegistry, onApplied?: () => void): () => void`: call `applyKeybindingOverrides(registry)`, then return `onSettingsChanged((keys) => { … })`, whose body returns unless `keys.includes(KEYBINDINGS_STORAGE_KEY)`, loads the layer, returns if `sameLayer(loaded, registry.keymap.overrides())`, else `registry.keymap.setOverrides(loaded)` and `onApplied?.()`. `setOverrides` fires `keymap.onChange`, which is what `setKeymapSource` in `src/studio.ts` already listens to, so the canvas frame is reposted with no change there.
   - `rebindCommand` (line 235) and `resetKeybinding` (line 253): `const next = loadKeybindingOverrides();` in place of `new Map(registry.keymap.overrides())`. The rest (declared-chord deletion, `setOverrides`, `store`) is unchanged.
   - Header comment: replace the "Storage is `localStorage`" paragraph with: the layer is the user setting `jx.keybindings`, owned by the settings kernel; this window's keymap follows it, and a write is computed from the stored layer, so a window that booted before another window's rebinding cannot erase it (§15 rule 5).
2. **`src/settings/preferences-dialog.ts`**: `registerPreferencesCommands(registry): () => void` registers the verb and returns `followKeybindingOverrides(registry, repaint)`. Update its JSDoc: the layer is applied here and followed from here, so a rebinding in another window or a layer arriving with hydration is live without a reload. `src/studio.ts` keeps calling it as a statement.
3. **`src/settings/preferences-sections.ts`** lines 28 to 30 become: "§15 names these four; an Editor-behaviour and an Updates/About pane are recorded there as Future. A section is added here when it has something to configure, never before: an empty pane is the \"declared but unbuilt\" state the rail already refuses to render."
4. **`src/services/settings/kernel.ts`** (only if the second Open is accepted):
   - Private `adoptStorageEvent(event: StorageEvent)`, one `try` around the body (storage that throws, as at module evaluation, means the event is ignored): return unless `event.storageArea === globalThis.localStorage`; the keys to re-read are every `USER_SETTINGS` key when `event.key === null` (a cleared storage), `[event.key]` when it is a `USER_SETTINGS` key, and none otherwise. The patch maps each to `localStorage.getItem(key)` (the value storage holds now, `null` when absent; never `event.newValue`, per Decisions). `apply(patch)` and `announce(moved)` when something moved. It never enqueues a write: this is news, exactly as in `adoptRemoteSettings`.
   - `watchRemoteSettings(): () => void`: when a platform with `subscribeSettings` is registered, return `platform.subscribeSettings(adoptRemoteSettings)`; otherwise add `adoptStorageEvent` as a `storage` listener on `globalThis` and return its removal. Update its JSDoc (the unsubscribe is returned for tests; the boot drops it) and `hydrateSettings`' JSDoc (line 233), which says the browser hosts have "the cache is all there is": the cache is still all there is, and another tab's write to it is now adopted.
   - `src/types.ts` lines 717 to 724, `subscribeSettings`' JSDoc: a platform without it no longer leaves a second window stale until its next boot; the kernel falls back to the browser's `storage` event, which reaches tabs of one origin.
   - If the Open resolves the other way, skip this step and use the scoped rule 5 text in Specs & docs.

**Integration contract.** Once this lands: the live keymap's user layer equals the kernel's `jx.keybindings` value after every settings announcement, in every window that called `registerPreferencesCommands`; `rebindCommand` and `resetKeybinding` preserve every entry the kernel holds that they do not name; `followKeybindingOverrides(registry, onApplied?)` is exported from `src/settings/preferences-keymap.ts` and returns an unsubscribe; `registerPreferencesCommands` and `watchRemoteSettings` return an unsubscribe. With the bridge, a `USER_SETTINGS` value written in another tab of the same origin is adopted and announced as a remote one is. studio.md §15 states the layer (row, rule 2) and its roaming (rule 5).

## Tests

**`packages/studio`** (`bun test --isolate --coverage` from `packages/studio`).

`tests/preferences-keymap.test.ts`, new `describe("the layer follows the store")`, using `adoptRemoteSettings` and `hydrateSettings` from the kernel. Every `followKeybindingOverrides` call pushes its unsubscribe onto a list that an `afterEach` drains, because the kernel's listener set is module-level and a leaked follower keeps rewriting an old registry in every later case:

- `a rebinding made in another window is live here at once`: `followKeybindingOverrides(app)`, then `adoptRemoteSettings({ [KEYBINDINGS_STORAGE_KEY]: '{"file.save":["mod+alt+s"]}' })`; `bindingsFor("file.save")` is `["mod+alt+s"]` and `resolveChord("mod+s", ["global"])` is undefined.
- `a layer that arrives with hydration after boot is applied`: `installMockPlatform({ getSettings: async () => ({ "jx.keybindings": … }) })` (from `./harness`), follow with an empty kernel, `await hydrateSettings()`, the binding moved; the case deletes `globalThis.__jxPlatform` afterwards, as `settings-kernel.test.ts`'s `clearPlatform` does, so the rest of the file stays platform-free.
- `a reset elsewhere gives this window its declared chord back`: seed a layer, follow, `adoptRemoteSettings({})`; `bindingsFor("file.save")` is `["mod+s"]`.
- `this window's own rebinding is applied once`: count `keymap.onChange` calls while following; one `rebindCommand` notifies exactly once, and `onApplied` is not called.
- `onApplied runs only when the layer changed`, and `the unsubscribe stops following`.
- `a rebinding merges into the layer another window wrote, rather than erasing it`: without following, `adoptRemoteSettings` a layer holding `edit.redo`; `rebindCommand(app, file.save, "mod+alt+s")`; `stored()` holds both entries.
- `a reset keeps the entries it does not name`: the same stale setup; `resetKeybinding(app, "file.save")` leaves `{ "edit.redo": […] }` stored.

`tests/preferences-dialog.test.ts`:

- In "Keyboard — rebinding", `the open sheet follows a rebinding made in another window`: `clearSeededSettings()` first (the file's `beforeEach` clears `localStorage` but not the kernel, so without it the kernel still holds the `{"file.save":["mod+alt+s"]}` that "a rebinding is a LAYER" stored, registration applies it, the adoption below moves nothing, and the case passes before the change), then `editorRegistry()`, `setActiveRegistry`, `const off = registerPreferencesCommands(registry)`, open on `keyboard`, assert the Save row prints `⌘S` without "changed", `adoptRemoteSettings({ "jx.keybindings": '{"file.save":["mod+alt+s"]}' })`, `await flush(3)`; the row prints `⌘⌥S` and "changed". `off()`.
- Every `registerPreferencesCommands` call in the file (lines 672, 681, 693 and 703, in "the app.preferences record") keeps the returned unsubscribe and calls it at the end of its case, for the reason given above.

`tests/settings-kernel.test.ts`, `describe("watchRemoteSettings")` (with the bridge):

A real browser fires `storage` only in the other tabs, and happy-dom never fires it at all, so each case writes `localStorage` directly (the other tab's write) and then dispatches the event itself on `globalThis`; every case calls the unsubscribe `watchRemoteSettings()` returns.

- Replace `is a no-op on a platform without the subscription, and with no platform` with `on a platform without the subscription, another tab's write is adopted and announced`: `installMockPlatform({ patchSettings })` with a recording mock, `const off = watchRemoteSettings()`, `localStorage.setItem(MODEL, "from-a-tab")`, dispatch `new StorageEvent("storage", { key: MODEL, newValue: "from-a-tab", storageArea: localStorage })`; `readStoredSetting(SETTINGS.aiModel)` is `"from-a-tab"`, one announcement of `[MODEL]`, and after `await settingsSettled()` the mock recorded nothing. The same holds with no platform registered (`clearPlatform()`).
- `a burst is adopted as storage holds it now, not as the event said`: `localStorage.setItem(MODEL, "second")`, dispatch an event whose `newValue` is `"first"`; the kernel holds `"second"` and `localStorage` still holds `"second"`. Adopting `event.newValue` fails this.
- `a removal in another tab is forgotten here, and a cleared storage forgets every user setting` (`removeItem` then an event with `newValue: null`; then `localStorage.clear()` and `key: null`).
- `a key that is not a user setting, or a sessionStorage write, changes nothing`.
- `storage that cannot be read ignores the event`: `localStorage` redefined with a getter that throws (the existing `installThrowingStorage` only throws from its methods, so it does not reach this `catch`), then `restoreStorage()`.
- `a platform that pushes is not also fed by storage events`: with `subscribeSettings` mocked, a dispatched `storage` event changes nothing.
- `the unsubscribe removes the listener`.

**Coverage.** No source file is added, so `bun scripts/check-coverage-manifest.ts packages/studio` is unaffected. Every new branch above has a case, so `preferences-keymap.ts`, `preferences-dialog.ts` and `kernel.ts` stay above `coverageThreshold = { lines = 0.958, functions = 0.941 }` in `packages/studio/bunfig.toml`; the floors belong to `surfaces/preferences.ts` and `studio.ts`, which this plan does not touch, so no ratchet is expected. Ratchet only if the run shows the worst file moved.

## Specs & docs

**`specs/studio.md` §15**, in place:

- Replace the Partial marker with: `> **Status: Implemented.** The four sections, the Settings-menu deep links, account rows that never print a secret, the brokered Cloudflare row, the Keyboard sheet's search and its rebinding layer, and the five rules ship (`packages/studio/src/settings/preferences-dialog.ts`, `preferences-sections.ts`, `preferences-accounts.ts`, `preferences-keymap.ts`, `packages/studio/src/services/settings/kernel.ts`).` The Future marker after it is unchanged.
- Keyboard row: "Every binding, **generated** from the command registry; searchable by name or by pressing the keystroke; rebindable as the author's own layer (rule 2)".
- Rule 2 becomes: "**The Keyboard sheet is generated, never authored, and a rebinding is a layer, never an edit.** It is the projection (`shortcutReference()`) that produces `docs/studio/interface/shortcuts.md`: the page passes no layer and prints what Studio ships with, the sheet passes the author's layer and prints it over the declared chords, so neither can drift from the app, and a command contributed by an extension appears in both without anyone editing a list. One row per **binding**, not per command; a chordless command is not listed, because there is nothing to press. Per the screenshot contract there is deliberately **no screenshot** of it." Then a second paragraph of the same item: "**Change** captures the next chord (a modifier held alone is not one yet, and Escape cancels); while it listens no keystroke reaches the dispatcher, so capturing ⌘S does not save. The chord is stored as an override, command id to chords, in the user setting `jx.keybindings`, and the keymap lays it over what the records declare: an override outranks a default and a default never evicts one, so a later release shipping a default on an overridden chord leaves that newcomer unbound rather than failing the boot. Binding a command that declares one chord to that chord removes its override instead of pinning it, and **Reset** removes the override and restores every chord the record declares, so a default that moves in a later release moves this keyboard with it. Three chords are refused, with the reason and no change: one that is not a chord; a bare printable key, which would fire while the author types (a key that types nothing, such as Escape, Enter, Tab, the arrows, the page keys or F1 to F24, may stand alone); and one another command holds in a scope that can be live at the same instant (every stack in §13.3 is the overlay's alone or one engine scope over `global`, so a scope overlaps itself and `global`, `global` overlaps every scope but `palette`, and `palette` only itself). That refusal names the holder, says where it is live when that is another scope, and offers to show its row. A stored layer is untrusted input: an entry that is not a list of chords is dropped on its own, and its command keeps what it declares."
- Rule 5, recommended form: after "so a change in either reaches the other" insert ", through the platform's settings store where it keeps one and through the browser's `storage` event between tabs of one origin where it does not,"; after "can never be the reason it is lost." insert "The keyboard layer is one setting holding every rebinding, so it is where this rule is sharpest: a window lays a layer that changed elsewhere over its live keymap at once, the canvas frame's chord table included (§13.3), and a rebinding or reset is merged into the layer as it is stored now, never into the copy the window booted with." If the second Open is declined, the first insertion reads ", where the platform keeps a settings store (the desktop app); a second browser tab reads a change when it next loads", and the second gains "Between browser tabs the keyboard layer is the exception: a tab that has not reloaded can overwrite another tab's rebindings."

**Fragment:** `bun run spec:change studio.md minor -m "§15: the Keyboard row and rule 2 specify the rebinding layer that ships (capture, the three refusals, reset, precedence over declared chords), and rule 5 now holds for it: a layer changed in another window or tab is applied live, and a rebinding merges into the stored layer instead of overwriting it."` If the second Open is declined, "in another window or tab" reads "in another desktop window".

**Docs** (no em dashes). `bun run docs:sync` names `docs/studio/interface/preferences.md` (its `spec:` is `studio.md#15` and its `code:` lists the three preferences files); `docs/studio/interface/shortcuts.md` and `commands.md` are generated from `commands/keymap.ts` and friends, which this plan does not change.

- `docs/studio/interface/preferences.md`:
  - Line 72, replace "Only the same group conflicts: … checked on its own." with: "A shortcut in **Anywhere** is live whichever group has focus, so it conflicts with every group, and the refusal says where the holder is live (_⌘S is already Save, which is live everywhere._). The other groups never have focus at once, so the same keys can mean one thing on the canvas and another in the data grid. **Palette** shortcuts only conflict with each other, because nothing else runs while the palette is open."
  - Line 78: "Your changes take effect immediately in every Studio window you have open, are kept on this machine, and survive a reload." The rest of the paragraph stays.
  - Line 25: no change with the bridge. If the second Open is declined, "so a second window sees it" becomes "so a second window of the desktop app sees it at once, and a second browser tab when it next loads".
  - Frontmatter `code:`: add `packages/studio/src/services/settings/kernel.ts` (with the bridge), since line 25's "so a second window sees it" is the kernel's behaviour.
- `docs/studio/desktop.md` line 61 and `docs/extending/embedding/platform-adapter.md`: no change. This plan makes line 61 ("two windows open at once cannot overwrite each other's") true of the keyboard layer up to the accepted race in Decisions, which a reader rebinding in two windows at human speed never meets; the adapter page does not describe `subscribeSettings`.

No graduation: studio.md keeps other open items.

## Acceptance

- `bun test --isolate --coverage` from `packages/studio` passes with the cases above and no per-file threshold failure; `bun scripts/check-coverage-manifest.ts packages/studio` passes.
- `git grep -n "keymap.overrides())" -- packages/studio/src/settings/preferences-keymap.ts` finds only the `sameLayer` comparison in `followKeybindingOverrides`, not a merge base; `git grep -n "lists six" -- packages/studio/src` finds nothing.
- By hand, with two desktop windows (and, with the bridge, two dev-server tabs on one project): rebind Save to ⌘⌥S in the first; without reloading, the second's Keyboard sheet shows ⌘⌥S as changed and ⌘⌥S saves there, including with focus in the canvas. Then rebind Redo in the second, reload the first: both rebindings survive.
- `sed -n '/^## 15\. /,/^## 16\. /p' specs/studio.md` shows `> **Status: Implemented.**`, the unchanged Future marker, and the new row and rules; `bun run plans:status --spec studio` no longer lists `studio.md#15`.
- `bun run typecheck` (two return types change) and `bun run lint` pass; `bun run docs:section-refs` passes, since step 3 rewrites a bare `§15` citation in `packages/studio`.
- `bun run plans:check`, `bun run docs:status`, `bun run docs:spec-release`, `bun run docs:check`, `bun run docs:links`, `bun run docs:prose` and `bun run docs:markdown` pass.
