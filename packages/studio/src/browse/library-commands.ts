/**
 * The Library's verbs.
 *
 * Every piece of Library state a person can reach is reachable here, which is the difference
 * between this and the Manage view it replaces. That view's category filter, its search box and its
 * grid/table switch existed ONLY as buttons inside a modal, so `scripts/screenshots/automation.ts`
 * carried a hand-maintained `BROWSE_CATEGORY_LABELS` table and pressed the buttons through an XPath
 * matched on their rendered text, exactly what the shot contract's R1 forbids
 * (`scripts/screenshots/README.md`). `library.setCategory` is the same action the button runs, and
 * the button is now a rendering of the record.
 *
 * Every setter is idempotent and names the STATE it reaches, never a delta: there is no
 * `library.toggleLayout`, because a toggle against unstated state is what silently inverted
 * eighteen manifest steps when a default flipped.
 */

import {
  argsSchema,
  derivedEnumProperty,
  enumArg,
  enumProperty,
  optionalStringArg,
  stringProperty,
} from "../commands/command-args";
import { openLibraryTab } from "../grid/grid-open";
import {
  LIBRARY_CATEGORY_KEYS,
  LIBRARY_LAYOUTS,
  LIBRARY_LAYOUT_LABELS,
  projectLocales,
} from "./library-model";
import {
  createLibraryEntry,
  libraryNewEntries,
  refreshLibrary,
  setLibraryCategory,
  setLibraryLayout,
  setLibraryLocale,
  setLibrarySearch,
} from "./library-pane";
import type { LibraryLayout } from "./library-model";
import type { AnyCommand, CommandRegistry } from "../commands/registry";

/** Every value `library.setLocale` accepts: the project's own locales, plus "all" for none of them. */
function localeChoices(): string[] {
  return ["all", ...projectLocales()];
}

/** The Library's command records. */
export function libraryCommands(): AnyCommand[] {
  return [
    {
      category: "Project",
      id: "library.open",
      // ⌘⇧E, as studio.md §9.1.2 names it. The Library is the content surface for a site
      // With a collection, and it was reachable only by palette search and one overflow menu item.
      keybinding: "mod+shift+e",
      level: "project",
      menus: ["commandbar/overflow", "palette", "context/file"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`, by studio-ui-guidelines.md §12.4's first deletion rule: chrome. None of the
         Library family is projected — every one of these verbs shapes a listing a person reads,
         and the model has `list_files` / `search_files` for the same facts. */
      run: () => {
        openLibraryTab();
      },
      title: "Open Library",
    },
    {
      args: argsSchema({
        category: enumProperty(
          LIBRARY_CATEGORY_KEYS,
          'Which category the Library lists. "all" clears the category filter.',
        ),
      }),
      category: "Project",
      id: "library.setCategory",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: a listing filter for a person (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        const key = enumArg("library.setCategory", args, "category", LIBRARY_CATEGORY_KEYS);
        setLibraryCategory(key);
      },
      title: "Library: Show Category",
    },
    {
      args: argsSchema({
        layout: enumProperty(
          LIBRARY_LAYOUTS,
          `How the Library arranges its items — ${LIBRARY_LAYOUTS.map(
            (layout) => LIBRARY_LAYOUT_LABELS[layout],
          ).join(", ")}.`,
        ),
      }),
      category: "Project",
      id: "library.setLayout",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: a listing filter for a person (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        const layout = enumArg<LibraryLayout>("library.setLayout", args, "layout", LIBRARY_LAYOUTS);
        setLibraryLayout(layout);
      },
      title: "Library: Set Layout",
    },
    {
      args: {
        additionalProperties: false,
        properties: {
          query: stringProperty("Text matched against each file's name and path. Empty clears it."),
        },
        type: "object",
      },
      category: "Project",
      id: "library.setSearch",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: a listing filter for a person; the model has `search_files`
         (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        setLibrarySearch(optionalStringArg("library.setSearch", args, "query") ?? "");
      },
      title: "Library: Filter Files",
    },
    {
      args: argsSchema({
        /* Derived, for the reason `content/entry-commands.ts` gives at length: this record is
           built at module scope, before any project is open, so `enumProperty(localeChoices(), …)`
           would freeze at `["all"]` and the palette would offer that forever. The getter is read
           when the prompt opens, when the AI tool list is serialised, and when `registry.run`
           coerces the value. */
        locale: derivedEnumProperty(
          localeChoices,
          'Which language the Library lists, as a BCP 47 tag the project declares. "all" ' +
            "clears the language filter.",
        ),
      }),
      category: "Project",
      id: "library.setLocale",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "a project with more than one locale",
      // A monolingual project has no facet to set: the Library draws no picker, and offering the
      // Verb would name a value space with one member in it.
      when: (ctx) => ctx.project.open && ctx.project.isMultilingual,
      /* No `aiTool`: a listing filter for a person (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        const choice = enumArg("library.setLocale", args, "locale", localeChoices());
        setLibraryLocale(choice === "all" ? "" : choice);
      },
      title: "Library: Show Language",
    },
    {
      category: "Project",
      id: "library.refresh",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: chrome (studio-ui-guidelines.md §12.4, rule 1). */
      run: () => refreshLibrary(),
      title: "Library: Rescan Files",
    },
    {
      args: {
        additionalProperties: false,
        properties: {
          type: stringProperty(
            'What to create: "page", "layout", "component", or "collection:<name>" for a ' +
              "content collection this project declares.",
          ),
        },
        required: ["type"],
        type: "object",
      },
      category: "Project",
      id: "library.newEntry",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      undo: "project",
      /* No `aiTool`, by studio-ui-guidelines.md §12.4's second deletion rule: it waits on the New
         File prompt; `create_page` / `create_component` cover the job. */
      run: async (_ctx, args) => {
        const declared = libraryNewEntries().map((entry) => entry.key);
        const key = enumArg("library.newEntry", args, "type", declared);
        await createLibraryEntry(key);
      },
      title: "Library: New Entry",
    },
  ];
}

/** Register the Library's verbs. */
export function registerLibraryCommands(registry: CommandRegistry): void {
  registry.registerAll(libraryCommands());
}
