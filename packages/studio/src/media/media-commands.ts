/**
 * The Media workspace's verbs, as command records (studio.md §22.6, §9.3).
 *
 * - `media.browse { filter?, query?, select? }` shows the Media home, set to a filter, a search or
 *   one file selected. It is what Add new › Media runs after an upload, so the reader lands on what
 *   arrived, and what a script or the palette runs to ask "what is unused".
 * - `media.upload` shows the Media home and opens its Upload picker.
 * - `media.replace { path }` selects a file and opens its Replace picker: the one overwrite.
 * - `media.delete { path }` deletes a file, through the confirmation that states its usage.
 *
 * Every one runs the flow, never a copy of it: the surface's Upload label and Replace input are the
 * same controls these open (`HTMLInputElement.showPicker()`), and Delete is the detail pane's own.
 *
 * DOM-free at import: the flow and the home opener are loaded on the first run, so
 * `commands/app-commands.ts` can list these records in a bare Bun process.
 *
 * @docs studio/projects/media
 */

import {
  argsSchema,
  enumArg,
  enumProperty,
  optionalStringArg,
  stringArg,
  stringProperty,
} from "../commands/command-args";
import { isMediaFile } from "../files/media-upload";
import { MEDIA_FILTER_KEYS } from "./media-library-model";
import type { MediaBrowseRequest } from "./media-library";
import type { CommandArgValues } from "../commands/command-args";
import type { AnyCommand, CommandRegistry } from "../commands/registry";
import type * as MediaLibraryModule from "./media-library";
import type * as WorkspaceHomeModule from "../workspace/workspace-home";

/** The ids, which Add new and the Site panel run. */
export const MEDIA_BROWSE = "media.browse";
export const MEDIA_UPLOAD = "media.upload";
export const MEDIA_REPLACE = "media.replace";
export const MEDIA_DELETE = "media.delete";

/**
 * The flow and the home opener, each imported once. One cached promise per module: two dynamic
 * imports of one module in flight at once is the shape that loses its coverage record.
 */
let _library: Promise<typeof MediaLibraryModule> | null = null;
let _home: Promise<typeof WorkspaceHomeModule> | null = null;

function library(): Promise<typeof MediaLibraryModule> {
  _library ??= import("./media-library");
  return _library;
}

function home(): Promise<typeof WorkspaceHomeModule> {
  _home ??= import("../workspace/workspace-home");
  return _home;
}

/** A path argument that must name a media file. Refused with the sentence a person can act on. */
function mediaPathArg(commandId: string, args: CommandArgValues, key: string): string {
  const path = stringArg(commandId, args, key).replace(/^\.\//, "");
  if (!isMediaFile(path)) {
    throw new RangeError(
      `command "${commandId}": "${path}" is not a media file (an image, video, audio, PDF or font).`,
    );
  }
  return path;
}

/** The `media.browse` arguments as a request, each read with the reader its schema names. */
function browseRequestOf(args: CommandArgValues): MediaBrowseRequest {
  const request: MediaBrowseRequest = {};
  if (args.filter !== undefined) {
    request.filter = enumArg(MEDIA_BROWSE, args, "filter", MEDIA_FILTER_KEYS);
  }
  const query = optionalStringArg(MEDIA_BROWSE, args, "query");
  if (query !== undefined) {
    request.query = query;
  }
  if (args.select !== undefined) {
    request.select = mediaPathArg(MEDIA_BROWSE, args, "select");
  }
  return request;
}

/** Open the Media home tab, which enters the Media workspace by being activated (§22.1). */
async function showHome(): Promise<void> {
  const { openWorkspaceHome } = await home();
  openWorkspaceHome("media");
}

const PATH_DESCRIPTION = "The media file's project path, such as public/media/hero.jpg.";

/** The four records. */
export function mediaCommands(): AnyCommand[] {
  const base = {
    category: "Project",
    group: "1_media",
    level: "project",
    menus: ["palette"],
    requires: "an open project",
    when: (ctx) => ctx.project.open,
  } satisfies Partial<AnyCommand>;
  return [
    {
      ...base,
      args: argsSchema(
        {
          filter: enumProperty(
            MEDIA_FILTER_KEYS,
            "Which media to show: all, image, video, audio, document, font, or unused (files no document references).",
          ),
          query: stringProperty("Search the media by name or path."),
          select: stringProperty(`A file to select and describe. ${PATH_DESCRIPTION}`),
        },
        [],
      ),
      icon: "image",
      id: MEDIA_BROWSE,
      run: async (_ctx, args) => {
        const request = browseRequestOf(args);
        const flow = await library();
        flow.applyMediaBrowse(request);
        await showHome();
      },
      title: "Browse Media",
      undo: "none",
    },
    {
      ...base,
      icon: "upload-simple",
      id: MEDIA_UPLOAD,
      run: async () => {
        const flow = await library();
        await showHome();
        flow.requestMediaUpload();
      },
      title: "Upload Media…",
      undo: "none",
    },
    {
      ...base,
      args: argsSchema({ path: stringProperty(`The file to replace. ${PATH_DESCRIPTION}`) }, [
        "path",
      ]),
      icon: "arrows-clockwise",
      id: MEDIA_REPLACE,
      run: async (_ctx, args) => {
        const path = mediaPathArg(MEDIA_REPLACE, args, "path");
        const flow = await library();
        await showHome();
        flow.requestMediaReplace(path);
      },
      title: "Replace Media File…",
      undo: "none",
    },
    {
      ...base,
      args: argsSchema({ path: stringProperty(`The file to delete. ${PATH_DESCRIPTION}`) }, [
        "path",
      ]),
      // A delete is a danger row wherever it is listed, and sorts last (studio-ui-guidelines.md §12.3).
      destructive: true,
      group: "9_danger",
      icon: "trash",
      id: MEDIA_DELETE,
      run: async (_ctx, args) => {
        const path = mediaPathArg(MEDIA_DELETE, args, "path");
        const flow = await library();
        await flow.deleteMediaFile(path);
      },
      title: "Delete Media File…",
      undo: "none",
    },
  ];
}

/** Register the Media records. */
export function registerMediaCommands(registry: CommandRegistry): void {
  registry.registerAll(mediaCommands());
}
