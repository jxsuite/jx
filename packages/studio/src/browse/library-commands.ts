/**
 * The Content home's verbs (`specs/studio.md` §22.5).
 *
 * Every piece of the home's state a person can reach is reachable here: which collection it shows,
 * how that collection is arranged, what it is filtered to. The view switch, the search field and
 * the language picker are renderings of the same records, and the Collections panel's rows run
 * `content.showCollection` rather than writing the state themselves, so a shot or a script names
 * the collection instead of pressing a row it found by its text.
 *
 * Every setter is idempotent and names the STATE it reaches, never a delta: there is no
 * `content.toggleLayout`, because a toggle against unstated state is what silently inverted
 * eighteen manifest steps when a default flipped. The view setters write the SHOWN collection's own
 * view, so each collection keeps its own.
 */

import {
  argsSchema,
  derivedEnumProperty,
  enumArg,
  enumProperty,
  optionalStringArg,
  stringProperty,
} from "../commands/command-args";
import { LIBRARY_LAYOUTS, LIBRARY_LAYOUT_LABELS, projectLocales } from "./library-model";
import { contentCollectionKeys } from "../content/content-collections";
import {
  refreshLibrary,
  setContentCollection,
  setLibraryLayout,
  setLibraryLocale,
  setLibrarySearch,
} from "./library-pane";
import type { LibraryLayout } from "./library-model";
import type { AnyCommand, CommandRegistry } from "../commands/registry";

/** Every value `content.setLocale` accepts: the project's own locales, plus "all" for none of them. */
function localeChoices(): string[] {
  return ["all", ...projectLocales()];
}

/**
 * Show a collection in the Content home, opening the home if it is not open.
 *
 * Opening the home activates it, and activating a tab enters its workspace (§22.1), so this is also
 * how a script reaches Content on a named collection in one step.
 */
export async function showCollection(key: string): Promise<void> {
  setContentCollection(key);
  /* Dynamic: the home's module mounts surfaces, and this record is loaded in the bare Bun process
     the CI checks run in. */
  const { openWorkspaceHome } = await import("../workspace/workspace-home");
  openWorkspaceHome("content");
}

/** The Content home's command records. */
export function contentViewCommands(): AnyCommand[] {
  return [
    {
      args: argsSchema({
        /* Derived: this record is built at module scope, before any project is open, so a frozen
           enum would offer only `pages` forever. The getter is read when the prompt opens, when
           the tool list is serialised, and when `registry.run` coerces the value; an enum is also
           what keeps the verb in the palette, which prompts for enums only. A shot is checked with
           no project open, so a manifest step may name `pages` and nothing else. */
        collection: derivedEnumProperty(
          contentCollectionKeys,
          'Which collection the Content home shows: "pages", or a collection project.json declares.',
        ),
      }),
      category: "Project",
      id: "content.showCollection",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`, by studio-ui-guidelines.md §12.4's first deletion rule: it shapes a listing a
         person reads, and the model has `list_files` for the same facts. */
      run: async (_ctx, args) => {
        const key = enumArg("content.showCollection", args, "collection", contentCollectionKeys());
        await showCollection(key);
      },
      title: "Content: Show Collection",
    },
    {
      args: argsSchema({
        layout: enumProperty(
          LIBRARY_LAYOUTS,
          `How the Content home arranges the collection it shows: ${LIBRARY_LAYOUTS.map(
            (layout) => LIBRARY_LAYOUT_LABELS[layout],
          ).join(", ")}.`,
        ),
      }),
      category: "Project",
      id: "content.setLayout",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: a listing view for a person (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        const layout = enumArg<LibraryLayout>("content.setLayout", args, "layout", LIBRARY_LAYOUTS);
        setLibraryLayout(layout);
      },
      title: "Content: Set View",
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
      id: "content.setSearch",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: a listing filter for a person; the model has `search_files`
         (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        setLibrarySearch(optionalStringArg("content.setSearch", args, "query") ?? "");
      },
      title: "Content: Search Collection",
    },
    {
      args: argsSchema({
        /* Derived, for the reason `content.showCollection` gives. */
        locale: derivedEnumProperty(
          localeChoices,
          'Which language the Content home lists, as a BCP 47 tag the project declares. "all" ' +
            "clears the language filter.",
        ),
      }),
      category: "Project",
      id: "content.setLocale",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "a project with more than one locale",
      // A monolingual project has no facet to set: the home draws no picker, and offering the verb
      // Would name a value space with one member in it.
      when: (ctx) => ctx.project.open && ctx.project.isMultilingual,
      /* No `aiTool`: a listing filter for a person (studio-ui-guidelines.md §12.4, rule 1). */
      run: (_ctx, args) => {
        const choice = enumArg("content.setLocale", args, "locale", localeChoices());
        setLibraryLocale(choice === "all" ? "" : choice);
      },
      title: "Content: Show Language",
    },
    {
      category: "Project",
      id: "content.refresh",
      level: "project",
      menus: ["palette"],
      group: "1_file",
      requires: "an open project",
      when: (ctx) => ctx.project.open,
      /* No `aiTool`: chrome (studio-ui-guidelines.md §12.4, rule 1). */
      run: () => refreshLibrary(),
      title: "Content: Rescan Files",
    },
  ];
}

/** Register the Content home's verbs. */
export function registerContentViewCommands(registry: CommandRegistry): void {
  registry.registerAll(contentViewCommands());
}
