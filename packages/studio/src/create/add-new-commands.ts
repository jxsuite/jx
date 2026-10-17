/**
 * `file.new`: Add new, as a command record (`specs/studio.md` §9.1.1).
 *
 * One record, four doors: the palette, the Command Bar's overflow, the chords, and the assistant.
 * The Site panel's **+** and the Content home's **New** run it too, so there is one way in and
 * every surface is a rendering of it.
 *
 * **Two behaviours, chosen by the arguments.** With a `name`, it creates — kind, name and options
 * through `deriveCreation`, refused by throwing the sentence the dialog would print, written by the
 * flow's one write path — and opens nothing modal. Without one, it OPENS the dialog on the kind
 * asked for and returns at once, never awaiting it: a `run` that waits on a person is the second
 * deletion rule of `studio-ui-guidelines.md` §12.4, and returning is what keeps this record a tool.
 * The model is told as much in the description, and the report says which of the two happened.
 *
 * **The chords.** `⌘N` where the host owns it — the desktop app — and `⌘⌥N` everywhere, because a
 * browser keeps `⌘N` for a new window and never delivers it to the page.
 *
 * DOM-free at import: the flow is loaded on the first run, so `commands/app-commands.ts` can list
 * this record in a bare Bun process.
 *
 * @docs studio/projects/pages-layouts-components
 */

import {
  argsSchema,
  derivedEnumProperty,
  enumArg,
  enumProperty,
  optionalStringArg,
  stringProperty,
} from "../commands/command-args";
import { entryCollections } from "../content/entry-model";
import { CREATION_KINDS } from "./add-new";
import type { CreationKind } from "./add-new";
import type { AddNewRequest, AddNewResult } from "./add-new-flow";
import type { CommandArgValues } from "../commands/command-args";
import type { AiToolReport, AnyCommand, CommandRegistry } from "../commands/registry";

/** The id, which the Site panel and the Content home run. */
export const FILE_NEW = "file.new";

/** What one run did: a creation, or the dialog it opened instead. */
interface LastRun {
  created: AddNewResult | null;
  opened: CreationKind | null;
}

/** The last run, for `report`, which reads module state rather than an injected dep. */
let _lastRun: LastRun = { created: null, opened: null };

/** The arguments as a request, each one read with the reader its schema names. */
function requestOf(args: CommandArgValues): AddNewRequest {
  const request: AddNewRequest = {};
  if (args.kind !== undefined) {
    request.kind = enumArg(FILE_NEW, args, "kind", CREATION_KINDS);
  }
  const name = optionalStringArg(FILE_NEW, args, "name");
  if (name !== undefined) {
    request.name = name;
  }
  const collection = optionalStringArg(FILE_NEW, args, "collection");
  if (collection !== undefined) {
    request.collection = collection;
  }
  const template = optionalStringArg(FILE_NEW, args, "template");
  if (template !== undefined) {
    request.template = template;
  }
  return request;
}

/** The sentence the model reads after a run. */
function reportFor(): AiToolReport {
  const { created, opened } = _lastRun;
  if (created) {
    return { summary: describe(created), wrote: created.wrote };
  }
  return {
    summary:
      `Opened Add new on ${opened ?? "page"} for the person; nothing is created until they ` +
      "confirm. Pass a name to create without the dialog.",
    wrote: [],
  };
}

/** One sentence naming what a creation made. */
export function describe(result: AddNewResult): string {
  switch (result.kind) {
    case "page": {
      return `Created the page ${result.path}${result.route ? `, which opens at ${result.route}` : ""}, and opened it in Design.`;
    }
    case "component": {
      return `Created <${result.tag ?? ""}> in ${result.path}; it is listed under Components in the Site panel and open in Design.`;
    }
    case "template": {
      return `Created the template ${result.path} and opened it in Design.`;
    }
    case "entry": {
      return `Created the entry ${result.path} and opened it.`;
    }
    case "collection": {
      return `Created the ${result.path.replace(/^content\//, "")} collection, writing ${result.wrote.join(", ")}.`;
    }
    default: {
      return `Uploaded ${result.wrote.length === 1 ? "1 file" : `${result.wrote.length} files`} to public/media/.`;
    }
  }
}

/** The `file.new` record. */
export function addNewCommands(): AnyCommand[] {
  return [
    {
      aiTool: {
        description:
          "Create a page, collection, template, component or collection entry, the way Add new does: " +
          "pass kind and name and it is written and opened, with the path derived from the name " +
          "(pages/<slug>.json, layouts/<slug>.json, components/<tag>.json, a content/<name>/ " +
          "collection). Without a name it only opens the Add new dialog for the person.",
        name: "add_new",
        report: () => reportFor(),
      },
      args: argsSchema(
        {
          collection: derivedEnumProperty(
            () => entryCollections().map((collection) => collection.name),
            "For an entry: the content collection it is created in.",
          ),
          kind: enumProperty(
            CREATION_KINDS,
            "What to create: page, collection, template, component, media (an upload) or entry.",
          ),
          name: stringProperty(
            "The name. A page's URL, a template's file and a component's tag are derived from it. " +
              "Omit it to open the Add new dialog instead of creating.",
          ),
          template: stringProperty(
            "The template to start from: a layout such as base or layouts/base.json, article for a " +
              "Markdown page, or blank for none. A collection uses it for its own page; a template " +
              "is wrapped in it.",
          ),
        },
        [],
      ),
      category: "File",
      group: "1_file",
      icon: "plus",
      id: FILE_NEW,
      keybinding: ["mod+n", "mod+alt+n"],
      level: "project",
      menus: ["commandbar/overflow", "palette"],
      requires: "an open project",
      run: async (_ctx, args) => {
        const request = requestOf(args);
        const flow = await import("./add-new-flow");
        if (request.name !== undefined) {
          _lastRun = { created: null, opened: null };
          const created = await flow.createDirect({ ...request, name: request.name });
          _lastRun = { created, opened: null };
          return;
        }
        _lastRun = { created: null, opened: request.kind ?? "page" };
        // Opened, never awaited: the dialog belongs to the person (studio-ui-guidelines.md §12.4).
        void flow.openAddNew(request);
      },
      title: "Add New…",
      undo: "none",
      when: (ctx) => ctx.project.open,
    },
  ];
}

/** Register `file.new`. */
export function registerAddNewCommands(registry: CommandRegistry): void {
  registry.registerAll(addNewCommands());
}
