/// <reference lib="dom" />
/**
 * Preferences-dialog.ts — ⌘, the application-preferences surface Studio did not have.
 *
 * Plan §9.3 draws the line this file finally makes real. **Project Settings** configures a project
 * and belongs to the project (breakpoints, definitions, deploy); **Preferences** configures the
 * application and follows you between them. Studio shipped only the first, behind a gear in the
 * rail — the slot every other editor spends on the second — and so had nowhere at all to put the
 * chrome theme, the assistant's provider key, the keyboard, or the three credentials it holds.
 *
 * Four sections, and each one closes a hole that was named in the plan:
 *
 * - **Appearance** — the chrome theme. `shell.theme` and `view.setTheme` already existed; nothing
 *   rendered them, so the only way to change the theme was to run a command by hand.
 * - **Assistant** — the provider key. It used to live in `Assistant: Settings…`, a dialog reachable
 *   only from inside the assistant panel, which meant a key had to be configured from the surface
 *   that was broken for want of one. That dialog is deleted; this is where it went.
 * - **Accounts** — GitHub, the AI provider and Cloudflare, listed with a Disconnect each. Before
 *   this, `clearGithubToken()` had zero callers: signing out of GitHub was not expressible.
 * - **Keyboard** — GENERATED from `commands/reference.ts`'s `shortcutReference()`, the same
 *   projection `docs/studio/interface/shortcuts.md` is built from. The registry is the one place a
 *   chord is declared, so the sheet cannot drift from the app or from the docs. Per §13.5 there is
 *   deliberately no screenshot of it — photographing generated content is a bug. It is searchable
 *   two ways, because there are two questions ("what is the shortcut for X" and "what did I just
 *   press"), and rebindable — as a LAYER over the registry (`settings/preferences-keymap.ts`), so
 *   the sheet stays a projection and the app's own record of a default is never edited.
 *
 * **This module is the FLOW; `surfaces/preferences.json` is what it draws.** Every function below
 * either answers a question about state or changes some, and the answers leave here as strings and
 * booleans — `keyboardEmpty` is a sentence rather than a case name, a row's chord is already
 * formatted, an account's buttons are already decided. Which of those add up to which branch of the
 * document is `surfaces/preferences.ts`'s.
 *
 * **Only the showing section is projected.** `accountsView()` reads three credential stores and
 * `keyboardView()` walks the whole registry, and a repaint of the theme toggle has no business
 * doing either — so each is built when its own section is up and left empty otherwise, exactly as
 * the four `*Tpl()` functions this replaced were called one at a time.
 *
 * Modality: a `jx-dialog` in the dialog layer, which is focus-managed, dismissed by Escape and
 * backed by the platform's own top layer — not `openModal`'s `inset:40px` blackout. Preferences
 * does not suspend the app.
 */

import { CHROME_THEMES, setChromeTheme, shell } from "../shell";
import { layerHost } from "../ui/layers";
import { createAiCredentialsForm } from "../ui/ai-credentials-form";
import { createManagedConnect } from "../ui/ai-managed-connect";
import { activeRegistry } from "../commands/active-registry";
import { shortcutReference, SCOPE_LABELS } from "../commands/reference";
import { chordFromEvent } from "../commands/keymap";
import {
  ensureCfConnection,
  listAccounts,
  notifyCredentialsChanged,
  platformBrokersCf,
  refreshCfConnection,
  resetCfConnectionCache,
  revokeAccount,
} from "./preferences-accounts";
import { applyKeybindingOverrides, rebindCommand, resetKeybinding } from "./preferences-keymap";
import { openPreferencesSurface } from "../surfaces/preferences";

import type { ChromeTheme } from "../shell";
import type { ShortcutRow } from "../commands/reference";
import type { RebindResult } from "./preferences-keymap";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type {
  PreferencesAccountRow,
  PreferencesIsland,
  PreferencesKeyGroup,
  PreferencesSectionRow,
  PreferencesSurfaceHandle,
  PreferencesThemeRow,
  PreferencesView,
} from "../surfaces/preferences";

/*
 * The sections moved to `./preferences-sections`, a leaf with no imports, so the rail's gear menu
 * can enumerate `app.preferences`'s own `section` argument without pulling this module's graph
 * (ai-models, github-auth, cf-settings, the settings kernel) into the rail. Re-exported here so
 * every existing import site is unchanged.
 */
import {
  DEFAULT_PREFERENCES_SECTION,
  isPreferencesSection,
  PREFERENCES_SECTIONS,
} from "./preferences-sections";

export {
  DEFAULT_PREFERENCES_SECTION,
  isPreferencesSection,
  PREFERENCES_SECTIONS,
} from "./preferences-sections";
export type { PreferencesSection } from "./preferences-sections";

// ─── Open state ───────────────────────────────────────────────────────────────

let _section = DEFAULT_PREFERENCES_SECTION;

/** The mounted sheet, or `null` while none is up. */
let _surface: PreferencesSurfaceHandle | null = null;

/** Whether Preferences is on screen. */
export function isPreferencesOpen(): boolean {
  return _surface !== null;
}

/** The section currently showing. Exposed for tests and for the `app.preferences` round-trip. */
export function preferencesSection(): string {
  return _section;
}

function repaint(): void {
  _surface?.update(view());
  fillIslands();
}

/** Save/revoke both change what other surfaces show, so they announce as well as repaint. */
function credentialsChanged(): void {
  notifyCredentialsChanged();
  repaint();
}

/**
 * Showing a section is a chance to find out it is stale.
 *
 * Only Accounts has anything to re-read: the brokered Cloudflare connection lives on the server, so
 * a grant that lapsed while Preferences was closed — or while the author was in Keyboard — would
 * otherwise be reported from a cache taken before it did.
 */
function sectionShown(): void {
  if (_section === "accounts" && platformBrokersCf()) {
    void refreshCfConnection().then(repaint);
  }
}

/** The shared credentials form — draft state lives inside the form's closure. */
const credsForm = createAiCredentialsForm({
  /* A sentence rather than a template: the form is a document now, and a document renders text
     rather than another module's markup. */
  intro:
    "Any OpenAI-compatible key works. Stored locally on this machine; sent only to the Studio proxy (never to a third party except your chosen endpoint).",
  // Both buttons keep the sheet open: Preferences is a place, not a wizard step, and the previous
  // Dialog's habit of vanishing on Save is what made "did that take?" unanswerable.
  onCancel: repaint,
  onSaved: credentialsChanged,
  requestRender: repaint,
});

/** Shared with the New Project modal's gates — see ui/ai-managed-connect.ts. */
const managedConnect = createManagedConnect({ requestRender: credentialsChanged });

// ─── The Assistant islands ────────────────────────────────────────────────────

/*
 * The two elements the Assistant section renders and does not fill.
 *
 * Both belong to a controller that outlives this sheet and is embedded by three other credentials
 * gates, so the document renders an empty box for each and the elements are MOVED into it. Moving a
 * node keeps everything inside it — which is the whole point: the credentials form is three fields
 * a reader is typing into, and a repaint that rebuilt them would take the caret with it.
 */
let _managedSlot: HTMLElement | null = null;
let _credsSlot: HTMLElement | null = null;

/** A slot was created by the document. Remember it, and fill it. */
function islandCreated(island: PreferencesIsland, host: HTMLElement): void {
  if (island === "managed") {
    _managedSlot = host;
  } else {
    _credsSlot = host;
  }
  fillIslands();
}

/**
 * Put each controller's element in its slot, and bring both up to date.
 *
 * `render()` on either controller is an UPDATE when the surface already exists, so this is also how
 * a repaint reaches them. The parent check is what keeps it from being a rebuild: re-appending a
 * node that is already there would be a move, and a move of a focused field takes the caret.
 */
function fillIslands(): void {
  if (_managedSlot) {
    managedConnect.ensureProbe();
    const element = managedConnect.render();
    if (element === null) {
      _managedSlot.replaceChildren();
    } else if (element.parentNode !== _managedSlot) {
      _managedSlot.replaceChildren(element);
    }
  }
  if (_credsSlot) {
    const element = credsForm.render();
    if (element.parentNode !== _credsSlot) {
      _credsSlot.replaceChildren(element);
    }
  }
}

// ─── Sections ─────────────────────────────────────────────────────────────────

/** The nav, with the showing row marked as the accessibility tree already marks it. */
function sectionsView(): PreferencesSectionRow[] {
  return PREFERENCES_SECTIONS.map((section) => ({
    current: section.id === _section ? "true" : "false",
    id: section.id,
    title: section.title,
  }));
}

/** The theme segments. `checked` is a string because that is what `aria-checked` takes. */
function themesView(): PreferencesThemeRow[] {
  return CHROME_THEMES.map((theme) => ({
    checked: shell.theme === theme ? "true" : "false",
    label: theme === "dark" ? "Dark" : "Light",
    value: theme,
  }));
}

function selectSection(id: string): void {
  _section = id;
  // Leaving a section abandons what it was in the middle of: an armed key capture whose listener
  // Is no longer mounted would otherwise swallow the first chord pressed on the author's NEXT
  // Visit.
  resetKeyboardState();
  repaint();
  sectionShown();
}

function setTheme(value: string): void {
  setChromeTheme(value as ChromeTheme);
  repaint();
}

// ─── Accounts ─────────────────────────────────────────────────────────────────

/**
 * What each account button does, by the key the row carries.
 *
 * Rebuilt with the rows, because `listAccounts()` mints a fresh closure per call and the one a
 * click must run is the one that was drawn. A key that is no longer in the map is a click on a row
 * that has since been redrawn, which is a no-op rather than an error.
 */
let _accountRuns = new Map<string, () => void | Promise<void>>();

/**
 * The accounts, as rows.
 *
 * A record that declares `actions` decides its own verbs; everything else keeps the original rule —
 * a connected credential offers Disconnect and a disconnected one offers nothing.
 */
function accountsView(): PreferencesAccountRow[] {
  // First paint asks the broker what it holds; the answer arrives as a credentials-changed repaint.
  ensureCfConnection();
  const runs = new Map<string, () => void | Promise<void>>();
  const rows = listAccounts().map((account) => {
    const declared =
      account.actions ??
      (account.connected
        ? [
            {
              id: "disconnect",
              label: "Disconnect",
              run: () => {
                revokeAccount(account.id);
              },
              variant: "negative",
            },
          ]
        : []);
    return {
      actions: declared.map((action) => {
        const key = `${account.id}/${action.id}`;
        runs.set(key, action.run);
        return {
          id: action.id,
          key,
          label: action.label,
          variant: action.variant ?? "secondary",
        };
      }),
      detail: account.detail,
      id: account.id,
      label: account.label,
    };
  });
  _accountRuns = runs;
  return rows;
}

/**
 * Run one account button.
 *
 * Every one of them repaints when it settles, because a hosted Reconnect is a round trip through a
 * Cloudflare popup and the row must not still be reading "expired" when it comes back.
 */
function runAccountAction(key: string): void {
  const run = _accountRuns.get(key);
  if (!run) {
    return;
  }
  void Promise.resolve(run()).finally(repaint);
}

// ─── Keyboard ─────────────────────────────────────────────────────────────────

/**
 * What the sheet is showing, if not everything.
 *
 * Two kinds because there are two questions. `text` answers "what is the shortcut for Duplicate";
 * `chord` answers "what did I just press", which is the one a list cannot answer by being read — a
 * chord's printed form is not what a person searching for it would type.
 */
type KeyFilter = { kind: "text"; value: string } | { kind: "chord"; chord: string } | null;

/**
 * The next chord goes to the search box, or onto a command. `null` while nothing is listening.
 *
 * A rebind capture holds the command's ID rather than its record, because the click that armed it
 * arrived from a document and carried a string. The record is looked up when the chord lands, which
 * is also the one moment at which "the registry went away under the open sheet" can be answered
 * honestly rather than asserted against.
 */
type KeyCapture = { mode: "search" } | { mode: "rebind"; commandId: string } | null;

/** Keydowns that are not a chord yet: a modifier held on its way to one. */
const MODIFIER_KEYS = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "OS"]);

let _keyFilter: KeyFilter = null;
let _keyCapture: KeyCapture = null;
/** The last refusal, held until the author does something else. */
let _keyRefusal: (RebindResult & { ok: false }) | null = null;

/** Forget the Keyboard section's transient state. Opening the sheet should never resume a capture. */
function resetKeyboardState(): void {
  _keyFilter = null;
  _keyCapture = null;
  _keyRefusal = null;
}

/** Whether a row survives the current filter. `format` is injected so one platform decision holds. */
function keyRowMatches(row: ShortcutRow, format: (chord: string) => string): boolean {
  if (!_keyFilter) {
    return true;
  }
  if (_keyFilter.kind === "chord") {
    return row.chord === _keyFilter.chord;
  }
  const query = _keyFilter.value.toLowerCase();
  return (
    row.title.toLowerCase().includes(query) ||
    row.commandId.toLowerCase().includes(query) ||
    format(row.chord).toLowerCase().includes(query)
  );
}

/**
 * One keydown while the sheet is listening.
 *
 * `stopPropagation` is the load-bearing line: the dispatcher is a `document` listener and
 * Preferences deliberately does not suspend the app (§15), so without it, capturing ⌘S would SAVE
 * while the author was trying to bind it.
 */
function onKeyboardKeyDown(event: KeyboardEvent): void {
  if (!_keyCapture || MODIFIER_KEYS.has(event.key)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const capture = _keyCapture;
  _keyCapture = null;
  if (event.key === "Escape") {
    _keyRefusal = null;
    repaint();
    return;
  }
  const registry = activeRegistry();
  if (!registry) {
    repaint();
    return;
  }
  const chord = chordFromEvent(event, registry.keymap.mac);
  if (capture.mode === "search") {
    _keyFilter = { kind: "chord", chord };
    _keyRefusal = null;
  } else {
    const command = commandById(registry, capture.commandId);
    if (command) {
      const result = rebindCommand(registry, command, chord);
      _keyRefusal = result.ok ? null : result;
    }
  }
  repaint();
}

/** The record behind a row's id, or `undefined` when the registry no longer holds one. */
function commandById(registry: CommandRegistry, commandId: string): AnyCommand | undefined {
  return [...registry.list()].find((candidate) => candidate.id === commandId);
}

/** Arm or disarm the search box's chord capture. */
function toggleKeystroke(): void {
  _keyCapture = _keyCapture?.mode === "search" ? null : { mode: "search" };
  _keyRefusal = null;
  repaint();
}

/** Arm or disarm one row's rebind. */
function toggleRebind(commandId: string): void {
  const capturing = _keyCapture?.mode === "rebind" && _keyCapture.commandId === commandId;
  _keyCapture = capturing ? null : { mode: "rebind", commandId };
  _keyRefusal = null;
  repaint();
}

/** Put a rebound chord back, and forget whatever the last attempt said. */
function resetBinding(commandId: string): void {
  const registry = activeRegistry();
  if (registry) {
    resetKeybinding(registry, commandId);
  }
  _keyRefusal = null;
  repaint();
}

/** Go and look at the command holding the chord that was refused. */
function showConflict(): void {
  const conflict = _keyRefusal?.conflict;
  if (!conflict) {
    return;
  }
  _keyFilter = { kind: "text", value: conflict.title };
  _keyRefusal = null;
  repaint();
}

/** Type into the search box. A keystroke capture is abandoned: the author changed their mind. */
function setKeyQuery(value: string): void {
  _keyFilter = value ? { kind: "text", value } : null;
  _keyCapture = null;
  repaint();
}

/** The Keyboard half of the view, with nothing to say when its section is not up. */
type KeyboardView = Pick<
  PreferencesView,
  | "capturingSearch"
  | "conflictLabel"
  | "groups"
  | "keyboardEmpty"
  | "keyQuery"
  | "keystrokeLabel"
  | "refusal"
  | "rowsEmpty"
>;

const KEYBOARD_IDLE: KeyboardView = {
  capturingSearch: false,
  conflictLabel: "",
  groups: [],
  keyboardEmpty: "",
  keyQuery: "",
  keystrokeLabel: "",
  refusal: "",
  rowsEmpty: "",
};

/**
 * The keyboard sheet — every live binding, grouped by the scope it is live in.
 *
 * The rows come from the running registry through `shortcutReference`, so a command registered by
 * an extension appears here without this file knowing it exists, and the user's layer is passed to
 * the same projection rather than patched into its output.
 *
 * A command that declares two chords has two rows and rebinding either one leaves it with one — a
 * user who asked for ⌥⌘Y is not also asking to keep ⌘Y, and Reset brings both back. The two rows
 * share a `commandId` and differ by chord, which is why the row key is both.
 */
function keyboardView(): KeyboardView {
  const registry = activeRegistry();
  const commands: readonly AnyCommand[] = registry ? [...registry.list()] : [];
  const rows = registry ? shortcutReference(commands, registry.keymap.overrides()) : [];
  if (!registry || rows.length === 0) {
    return { ...KEYBOARD_IDLE, keyboardEmpty: "No commands are registered in this window." };
  }
  const format = (chord: string) => registry.keymap.format(chord);
  const known = new Set(commands.map((command) => command.id));
  const visible = rows.filter((row) => known.has(row.commandId) && keyRowMatches(row, format));
  const capturingSearch = _keyCapture?.mode === "search";
  const groups: PreferencesKeyGroup[] = [];
  const byScope = new Map<string, PreferencesKeyGroup>();
  for (const row of visible) {
    const capturing = _keyCapture?.mode === "rebind" && _keyCapture.commandId === row.commandId;
    let group = byScope.get(row.scope);
    if (!group) {
      group = { label: SCOPE_LABELS[row.scope], rows: [], scope: row.scope };
      byScope.set(row.scope, group);
      groups.push(group);
    }
    group.rows.push({
      capturing,
      changeLabel: capturing ? "Cancel" : "Change",
      changeName: capturing ? `Stop changing ${row.title}` : `Change the shortcut for ${row.title}`,
      chord: capturing ? "Press a shortcut…" : format(row.chord),
      commandId: row.commandId,
      key: `${row.commandId}/${row.chord}`,
      overridden: row.overridden,
      resetName: `Reset the shortcut for ${row.title}`,
      title: `${row.title}${row.overridden ? " — changed" : ""}`,
    });
  }
  return {
    capturingSearch,
    conflictLabel: _keyRefusal?.conflict ? `Show ${_keyRefusal.conflict.title}` : "",
    groups,
    keyboardEmpty: "",
    keyQuery:
      _keyFilter === null
        ? ""
        : _keyFilter.kind === "chord"
          ? format(_keyFilter.chord)
          : _keyFilter.value,
    keystrokeLabel: capturingSearch ? "Press it now" : "Search by keystroke",
    refusal: _keyRefusal?.reason ?? "",
    rowsEmpty:
      visible.length > 0
        ? ""
        : _keyFilter?.kind === "chord"
          ? `Nothing is bound to ${format(_keyFilter.chord)}.`
          : "No shortcut matches that.",
  };
}

// ─── The sheet ────────────────────────────────────────────────────────────────

/** Everything the document reads, built from the section that is actually showing. */
function view(): PreferencesView {
  const active = PREFERENCES_SECTIONS.find((candidate) => candidate.id === _section);
  return {
    accounts: _section === "accounts" ? accountsView() : [],
    section: _section,
    sectionBlurb: active?.blurb ?? "",
    sectionTitle: active?.title ?? "",
    sections: sectionsView(),
    themes: themesView(),
    ...(_section === "keyboard" ? keyboardView() : KEYBOARD_IDLE),
  };
}

/**
 * Open Preferences, optionally on a named section. Resolves when it is dismissed.
 *
 * Re-opening while it is already up SELECTS the section instead of stacking a second sheet — which
 * is what makes "Assistant: no provider connected → Preferences" land on the Assistant section from
 * inside the assistant, rather than on top of itself.
 *
 * @param section One of {@link PREFERENCES_SECTIONS}' ids. An unknown id falls back to Appearance.
 */
export function openPreferences(section?: string): Promise<null> {
  /* Opening is a fresh look, so nothing may be reported from the last one: a brokered Cloudflare
     grant can lapse between visits, and a row that repaints the previous answer first is stating
     something it has no reason to believe. */
  resetCfConnectionCache();
  _section = section !== undefined && isPreferencesSection(section) ? section : _section;
  if (_surface) {
    repaint();
    sectionShown();
    return Promise.resolve(null);
  }
  _section =
    section !== undefined && isPreferencesSection(section) ? section : DEFAULT_PREFERENCES_SECTION;
  credsForm.startEdit();
  resetKeyboardState();
  sectionShown();
  return new Promise<null>((resolve) => {
    /* Guarded rather than trusted to the handle, because closing is what RAISES `onClosed` — so a
       teardown that re-entered through it would call itself until the stack ran out. The close is
       made HERE and not left to the platform: a `close` the flow did not ask for (Escape, or the
       Close button) must also take the document out of the dialog layer, or the surface outlives
       the dialog it drew. */
    let closing = false;
    _surface = openPreferencesSurface({
      layer: layerHost("dialog"),
      onAccountAction: runAccountAction,
      onCaptureKey: onKeyboardKeyDown,
      onClosed: () => {
        if (closing) {
          return;
        }
        closing = true;
        const handle = _surface;
        _surface = null;
        _managedSlot = null;
        _credsSlot = null;
        handle?.close();
        resolve(null);
      },
      onIsland: islandCreated,
      onKeyQuery: setKeyQuery,
      onResetBinding: resetBinding,
      onSelectSection: selectSection,
      onSetTheme: setTheme,
      onShowConflict: showConflict,
      onToggleKeystroke: toggleKeystroke,
      onToggleRebind: toggleRebind,
      view: view(),
    });
  });
}

/** Close Preferences if it is open. Tests, and the shell teardown. */
export function closePreferences(): void {
  _surface?.close();
}

// ─── Command ──────────────────────────────────────────────────────────────────

/**
 * `app.preferences` — ⌘, everywhere, with no precondition.
 *
 * Application level, and deliberately not gated on an open project: the theme, the provider key and
 * the keyboard are all configurable from the welcome screen, which is exactly where a first-run
 * user is when they need them.
 */
export function preferencesCommands(): AnyCommand[] {
  return [
    {
      args: {
        additionalProperties: false,
        properties: {
          section: {
            type: "string",
            enum: PREFERENCES_SECTIONS.map((section) => section.id),
            description: "Which Preferences section to show. Defaults to Appearance.",
          },
        },
        required: [],
        type: "object",
      },
      category: "View",
      id: "app.preferences",
      level: "application",
      keybinding: "mod+,",
      menus: ["commandbar/overflow", "settings/menu", "palette"],
      group: "7_settings",
      run: (_ctx, args) => {
        const section = (args as { section?: unknown } | undefined)?.section;
        if (section !== undefined && !isPreferencesSection(section)) {
          throw new RangeError(
            `command "app.preferences" argument "section": "${String(section)}" is not a ` +
              `Preferences section — declared: ` +
              `${PREFERENCES_SECTIONS.map((candidate) => candidate.id).join(", ")}`,
          );
        }
        void openPreferences(section as string | undefined);
      },
      title: "Preferences…",
    },
  ];
}

/**
 * Register the preferences verb, and apply the preferences that are already stored.
 *
 * The keyboard layer is applied HERE rather than at the end of the bootstrap because the keymap
 * holds the layer itself: every record registered after this call — including the ones the
 * bootstrap registers below it — is indexed against the author's overrides, so a rebinding survives
 * a reload without anything having to run last.
 */
export function registerPreferencesCommands(registry: CommandRegistry): void {
  registry.registerAll(preferencesCommands());
  applyKeybindingOverrides(registry);
}
