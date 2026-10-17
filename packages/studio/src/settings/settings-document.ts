/// <reference lib="dom" />
/**
 * Project Settings: the built-in sections, the `project.json` tab's editors, and the two commands
 * that reach them.
 *
 * **Settings is a dialog; the configuration DOCUMENT is still a tab.** `project.json` is a real Tab
 * under the transaction log with one write chokepoint (`tabs/project-config.ts`, §17.1), and it has
 * three editors, the Styles workspace's three views: Elements (`stylebook`), Variables (`tokens`,
 * `style/variables-view.ts`) and Code (`source`). Project Settings is neither of them: it is a
 * dialog in the dialog layer (`./settings-dialog.ts`) hosting the section list, reachable from
 * every workspace, and every section in it writes through the same chokepoint the tab's editors do,
 * so the file has one history whichever door changed it.
 *
 * **`settings.open` did not change what it means.** It still means "reach project settings,
 * optionally at a named section and entry", its args schema still declares `section` and `entry`,
 * and a key nobody registered still fails the call. What changed is the `run`: a dialog instead of
 * a tab mode.
 *
 * @docs studio/projects/settings
 */

import { errorMessage } from "@jxsuite/schema/parse";
import {
  argsSchema,
  enumArg,
  enumProperty,
  optionalStringArg,
  stringProperty,
} from "../commands/command-args";
import { notify } from "../services/notify";
import { projectState } from "../state";
import { PROJECT_CONFIG_PATH } from "../tabs/tab";
import { lendProjectConfigLayout } from "../tabs/project-config";
import { focusPane, openTab, workspace } from "../workspace/workspace";
import {
  notifySettingsDocument,
  registerSettingsSection,
  setSettingsSection,
  settingsSectionKeys,
} from "./section-registry";
import { renderContextsSection } from "./contexts-section";
import { renderDefsEditor } from "./defs-editor";
import { renderDependenciesEditor } from "./dependencies-editor";
import { renderExtensionsSection } from "./extensions-section";
import { renderRawJsonSection } from "./project-sections";
import { renderGeneralSettings } from "./general-settings";
import { renderHeadEditor } from "./head-editor";
import { renderLocalesSection } from "./locales-section";
import { selectContributedEntry } from "./contributed-section";
import { closeSettingsDialog, openSettingsDialog } from "./settings-dialog";
// The NAME and the wire value, kept apart by that module on purpose — see its docstring.
import {
  PROJECT_STYLES_TITLE,
  PROJECT_STYLES_VIEW,
  STYLES_TAB_MODES,
  STYLES_VIEWS,
  STYLES_VIEW_MODES,
} from "../style/project-styles";
import { activeRegistry } from "../commands/active-registry";
import type { Tab } from "../tabs/tab";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type { CommandArgValues } from "../commands/command-args";

/** The Code editor's mode, `source`, which `commands/context.ts` maps to the `code` kind. */
const SOURCE_MODE = STYLES_VIEW_MODES.code;

/**
 * The `project.json` tab's editors, in the order its Editor control offers them: Elements,
 * Variables and Code, the Styles workspace's three views.
 */
const PROJECT_TAB_MODES = STYLES_TAB_MODES;

// ─── Built-in sections ────────────────────────────────────────────────────────
/* Orders leave gaps so a contribution can land between two built-ins. Content Types is NOT here:
   the parser extension contributes it (order 50) through its Content class descriptor's
   `$studio.settings` block, registered via ./extension-sections, which is the same path any
   extension's section takes, and it is listed under Integrations because that is the default
   group for a contribution.

   Two sections that used to be here are not, and their renderers are not deleted: CSS Variables
   (`./css-vars-editor.ts`) belongs to the Styles workspace, and Deploy (`renderDeploySection`) to
   the Publish workspace. The dialog's Moved footnote says where each went.

   `icon` is a KEY into the kit's glyph manifest (`@jxsuite/ui/icons`), not a tag: `studio.md`
   §13.5 is about exactly this distinction, and a key with no row draws nothing and says nothing.
   The field is still documented as reserved (`section-registry.ts`), so nothing here draws today;
   the names are held to the kit's manifest by `settings-document.test.ts` so that a name is right
   when the nav does draw it, rather than discovered wrong then. */

registerSettingsSection({
  group: "general",
  icon: "sliders-horizontal",
  key: "overview",
  label: "Overview",
  order: 10,
  render: renderGeneralSettings,
});
/*
 * Locales sits with Overview because both are what every author decides about the whole site: its
 * name and address, and the languages it is published in. It is also the definition site the
 * pane's language control, the Languages panel and `i18n.addLocale` all read: there is one
 * `i18n.locales` and this is the form over it.
 */
registerSettingsSection({
  group: "general",
  icon: "globe",
  key: "locales",
  label: "Locales",
  order: 25,
  render: renderLocalesSection,
});
registerSettingsSection({
  group: "integrations",
  icon: "share-network",
  key: "extensions",
  label: "Extensions",
  order: 5,
  render: renderExtensionsSection,
});
/*
 * Contexts leads Advanced because it is the project's second identity: Overview says what the site
 * IS, Contexts says what it is rendered UNDER (breakpoints, color schemes, features). It is a
 * definition site only: the pane context bar selects among what is defined here, and its "Manage
 * contexts…" footer names this key (§6.2).
 */
registerSettingsSection({
  group: "advanced",
  icon: "browser",
  key: "contexts",
  label: "Contexts",
  order: 15,
  render: renderContextsSection,
});
registerSettingsSection({
  group: "advanced",
  icon: "file-code",
  key: "head",
  label: "Site head",
  order: 20,
  render: renderHeadEditor,
});
registerSettingsSection({
  group: "advanced",
  icon: "brackets-curly",
  key: "definitions",
  label: "Data Shapes",
  order: 40,
  render: renderDefsEditor,
});
registerSettingsSection({
  group: "advanced",
  icon: "cube",
  key: "dependencies",
  label: "Packages",
  order: 60,
  render: renderDependenciesEditor,
});
/*
 * Raw JSON's "Edit as code" leaves the dialog: the Code editor is the `project.json` tab's, which is
 * the Styles workspace's, so the dialog closes and the tab opens in its source editor. Activating
 * it is what switches the workspace (`workspace/tab-workspace.ts`).
 */
registerSettingsSection({
  group: "advanced",
  icon: "code",
  key: "rawJson",
  label: "Raw JSON",
  order: 900,
  render: (container) => {
    renderRawJsonSection(container, {
      editAsCode: () => {
        closeSettingsDialog();
        showSettingsDocument(SOURCE_MODE);
      },
    });
  },
});

// ─── The document ─────────────────────────────────────────────────────────────

/**
 * Open (or reveal) the configuration document in one of its editors.
 *
 * The tab is keyed by `project.json` on purpose: opening the file from the Files tree, opening
 * Project Styles and "Edit as code" all reach the same tab, the same history and the same dirty
 * flag. When it is already open this only switches the editor, so an author who was reading the raw
 * JSON keeps their undo stack.
 *
 * @param {string} [mode] The editor: Elements (`stylebook`, the default), Variables (`tokens`) or
 *   Code (`source`)
 * @returns {Tab | null} The tab, or null when no project is open
 */
export function showSettingsDocument(mode: string = PROJECT_STYLES_VIEW): Tab | null {
  const state = projectState;
  if (!state) {
    return null;
  }
  const existing = workspace.tabs.get(PROJECT_CONFIG_PATH);
  if (existing) {
    for (const candidate of PROJECT_TAB_MODES.toReversed()) {
      if (!existing.capabilities.modes.includes(candidate)) {
        existing.capabilities.modes.unshift(candidate);
      }
    }
    existing.session.ui.canvasMode = mode;
    existing.session.ui.preview = false;
    return revealTab(existing);
  }
  const tab = openTab({
    capabilities: { modes: [...PROJECT_TAB_MODES] },
    document: state.projectConfig ?? {},
    documentPath: PROJECT_CONFIG_PATH,
    id: PROJECT_CONFIG_PATH,
  });
  /* The mode is written here rather than left to the capability list, because `createTab` seeds
     `session.ui.canvasMode` from the first non-preview mode, and a door over the same document has
     to SAY which editor it is: "Edit as code" from a cold workspace must open the source, not
     Project Styles. */
  tab.session.ui.canvasMode = mode;
  tab.session.ui.preview = false;
  /* The tab was opened over the configuration OBJECT: the platform parsed it, so there is no text
     here to read a layout from, and `doc.layout` is null. A ⌘S on it would then write the
     formatter's layout for fresh output while a settings commit on the same document wrote the
     file's (`tabs/project-config.ts`, issue 308). The chokepoint reads the file once anyway; it
     lends the tab that record, and the Code view re-renders when it lands (`doc` is reactive). */
  void lendProjectConfigLayout(tab);
  return tab;
}

/**
 * Make an already-open tab the active one without rebuilding it.
 *
 * `openTab` recreates the tab from scratch, which would discard the configuration document's
 * history.
 *
 * @param {Tab} tab
 * @returns {Tab}
 */
function revealTab(tab: Tab): Tab {
  for (const pane of workspace.panes) {
    if (pane.tabOrder.includes(tab.id)) {
      pane.activeTabId = tab.id;
      /* `focusPane`, not `workspace.activePaneId = pane.id`. Moving the keyboard is four
         operations, and the assignment is one of them: the other three are `resetTabCycle` (so
         Ctrl-Tab cycles from where you now are, not from the pane you left), `promoteMru` (so the
         MRU order agrees with what is on screen) and `syncTreeSelection` (so the file tree points
         at the document you are looking at). */
      focusPane(pane.id);
      break;
    }
  }
  return tab;
}

/**
 * Reach Project Settings, optionally at a named section.
 *
 * Opens the dialog on the requested section (or on the one it last showed, which the registry
 * remembers for the session), then awaits the contributed-section sync before returning, so a
 * caller that then asks whether a section exists is asking the complete registry. The sync is
 * COALESCED (`extension-sections.ts`): `refreshExtensionUi` fires the same function on project
 * activation and after every `project.json` write, and a second, interleaved run could otherwise
 * take the caller's section down between the promise resolving and the frame being drawn.
 *
 * @param {string} [section]
 */
export async function openProjectSettings(section?: string): Promise<void> {
  if (section !== undefined) {
    setSettingsSection(section);
  }
  void openSettingsDialog();
  try {
    const { syncExtensionSettingsSections } = await import("./extension-sections");
    await syncExtensionSettingsSections();
  } catch (error) {
    /* Contributed sections are optional (the built-ins render regardless) but a contribution that
       will not load is a broken extension, and §17.1 files a section that fails to load as a
       Problem rather than a toast that erases itself. */
    notify.warn(`Could not load extension settings sections — ${errorMessage(error)}`, {
      key: "settings:sections",
      path: PROJECT_CONFIG_PATH,
      source: "Settings",
      tier: "problem",
    });
  }
  notifySettingsDocument();
}

/** Await the contributed-section sync — the readiness `probe.idle()` and the command both need. */
export async function settingsSectionsReady(): Promise<void> {
  const { extensionSectionsReady } = await import("./extension-sections");
  await extensionSectionsReady();
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * Open Project Settings: optionally on a named section, optionally at a named entry.
 *
 * Sections have KEYS and map-layout sections have ENTRY keys; this names both, so a deep link (the
 * entry editor's "Fields", the Languages panel, the pane's "Manage contexts…") and a screenshot
 * step are the same call.
 *
 * The validation is deliberately asynchronous. Extension-contributed sections (`connections`,
 * `data`, `content`) register a tick after the dialog opens, so refusing synchronously would reject
 * three legitimate section ids; the command opens, awaits the sync, and only then decides whether
 * the caller named something real. A wrong key therefore fails the call instead of rendering an
 * empty body.
 *
 * @returns {AnyCommand[]}
 */
export function settingsCommands(): AnyCommand[] {
  return [
    {
      args: {
        additionalProperties: false,
        properties: {
          entry: stringProperty(
            "An entry key inside the named section (map-layout sections only), e.g. a content " +
              "type or a data connection.",
          ),
          section: stringProperty(
            "The settings section key to show. Defaults to the section shown last, or Overview.",
          ),
        },
        required: [],
        type: "object",
      },
      category: "Project",
      id: "settings.open",
      level: "project",
      // ⌘⇧, — the other half of §15's `⌘, / ⌘⇧,` pair.
      keybinding: "mod+shift+,",
      menus: ["commandbar/overflow", "settings/menu", "palette"],
      group: "7_settings",
      requires: "an open project",
      /* `enablement`, not `when`: with no project open this row is DRAWN, greyed, carrying the
         sentence above (`studio-ui-guidelines.md` §12.3: a control which cannot act explains itself
         rather than vanishing). `enabledWith` still refuses, so `registry.run` and the assistant's
         tool throw `CommandUnavailableError`. */
      enablement: (ctx) => ctx.project.open,
      /* No `aiTool`, by `studio-ui-guidelines.md` §12.4's first rule: this opens a surface for a
         person; the model writes `project.json` through `write_file` and the extension verbs. */
      run: async (_commandCtx, args) => {
        const section = optionalStringArg("settings.open", args, "section");
        const entry = optionalStringArg("settings.open", args, "entry");
        await openProjectSettings(section);
        if (section === undefined) {
          if (entry !== undefined) {
            throw new RangeError(
              'command "settings.open" argument "entry" needs a "section" to name an entry of',
            );
          }
          return;
        }
        const keys = settingsSectionKeys();
        if (!keys.includes(section)) {
          throw new RangeError(
            `command "settings.open" argument "section": "${section}" is not a registered ` +
              `settings section — registered: ${keys.join(", ")}`,
          );
        }
        if (entry === undefined) {
          return;
        }
        const entries = selectContributedEntry(section, entry);
        if (entries !== null) {
          throw new RangeError(
            `command "settings.open" argument "entry": "${entry}" is not an entry of settings ` +
              `section "${section}" — entries: ${entries.join(", ") || "none"}`,
          );
        }
        notifySettingsDocument();
      },
      title: "Open Project Settings",
    },
    /*
     * Project Styles by name: an ALIAS of `view.setWorkspace { workspace: "styles" }`, which shows
     * the Styles workspace's last tab or opens its home (`project.json` in its Elements view). The
     * id is kept because it is how deep links, the docs and older scripts name the place; the
     * switch itself has one implementation, the workspace's, so the two doors cannot disagree about
     * what "open Project Styles" means. `view` then picks one of the tab's three views, which is
     * how a deep link (Project Settings' Moved footnote, a screenshot) reaches the Variables view
     * from anywhere: `canvas.setMode` cannot stand in for it, being level `document`.
     *
     * It is a peer of `settings.open` and declares the same gate, byte for byte
     * (`studio-ui-guidelines.md` §12.4: two verbs over one document declare ONE availability rule).
     * It is not in the gear menu: the gear holds Preferences and Project Settings, and Styles is a
     * workspace the top bar already names.
     */
    {
      args: argsSchema(
        {
          view: enumProperty(
            STYLES_VIEWS,
            "Which view of the project's styles to show: elements (element defaults by tag " +
              "name), variables (the CSS custom properties) or code (project.json as text). " +
              "Defaults to the view the Styles workspace was left in.",
          ),
        },
        [],
      ),
      category: "Project",
      id: "styles.open",
      level: "project",
      /* `never`, not `palette`, for the reason `view.setWorkspace` gives: the palette's way into
         Styles is `workspace.focus.styles` ("Go to Styles", ⌘4), and a second row running the same
         switch would be the same action under a second name. This record is the scripted door:
         the Moved footnote, the Overview's Styles row and the screenshot manifest name it, and
         `view` is what they can say that the chord cannot. */
      menus: ["never"],
      group: "7_settings_styles",
      requires: "an open project",
      /* `studio-ui-guidelines.md` §12.4: two verbs over ONE document declare ONE availability rule,
         byte-identical. */
      enablement: (ctx) => ctx.project.open,
      /* No `aiTool`, by `studio-ui-guidelines.md` §12.4's first rule: this opens a surface for a
         person. */
      run: async (_commandCtx, args: CommandArgValues) => {
        const view =
          args["view"] === undefined ? null : enumArg("styles.open", args, "view", STYLES_VIEWS);
        const registry = activeRegistry();
        if (!registry) {
          throw new Error('command "styles.open" needs the window\'s command registry');
        }
        await registry.run("view.setWorkspace", { workspace: "styles" });
        if (view !== null) {
          showSettingsDocument(STYLES_VIEW_MODES[view]);
        }
      },
      // Named, never spelled from the wire value: `stylebook` is shared with `dist/iframe-entry.js`
      // And may never be renamed, so nothing a reader sees is derived from it (`style/project-styles`).
      title: `Open ${PROJECT_STYLES_TITLE}`,
    },
  ];
}

/**
 * Register the settings verbs.
 *
 * @param {CommandRegistry} registry
 */
export function registerSettingsCommands(registry: CommandRegistry): void {
  registry.registerAll(settingsCommands());
}
