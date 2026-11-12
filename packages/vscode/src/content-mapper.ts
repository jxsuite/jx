/**
 * Type checking in a `.jxn` file (`spec.md` §23.3): the TypeScript extension is told that `.jxn`
 * files are its to read, and given the mapper to read them with where no `tsconfig` names one.
 *
 * Nothing is checked here. TypeScript's language server starts the mapper and asks it what each
 * document's code is, as `tsc` does, so an editor and the terminal report the same errors. A
 * project whose `tsconfig` lists the mapper under `contentMappers` is read with the copy that
 * project installed, and the copy this extension ships serves every other `.jxn` file.
 *
 * The TypeScript extension does not run in a workspace that is not trusted, so there it is not
 * found and nothing is registered until trust is given and it appears.
 *
 * @docs framework/concepts/type-checking
 */
import { join } from "node:path";

import { Disposable, extensions, Uri } from "vscode";

/** The extension that runs TypeScript 7's language server, which is the one with content mappers. */
export const TYPESCRIPT_EXTENSION_ID = "TypeScriptTeam.native-preview";

/** The name this extension's contributions are registered under. */
export const CONTRIBUTOR_ID = "jxsuite.jx-vscode";

/** How a mapper is started, as a package's `typescript.contentMapper` manifest says it. */
interface ContentMapperManifest {
  cwd: Uri;
  dynamicConfig: boolean;
  exec: string[];
  name: string;
}

/** What the TypeScript extension is told about a kind of file. */
export interface ContentMapperContribution {
  /** The file extensions the language server is to be sent. */
  extensions: string[];
  /** The mapper for a file that no `tsconfig` names one for. */
  inferredProjectContribution: { manifest: ContentMapperManifest };
}

/** The part of the TypeScript extension's API this extension calls. */
interface ContentMapperApi {
  registerContentMappers: (
    contributor: string,
    contributions: readonly ContentMapperContribution[],
  ) => Disposable;
}

/** What the TypeScript extension exports: nothing where it is switched off, less where it is old. */
type TypeScriptExports = Partial<ContentMapperApi> | undefined;

/** The process a mapper is run by, as far as starting one reads it. */
export type MapperRuntime = Pick<NodeJS.Process, "env" | "execPath">;

/**
 * The command that starts the mapper this extension ships.
 *
 * @param extensionPath The folder this extension is installed in.
 * @param runtime The extension host. The language server and the mapper it starts inherit its
 *   environment, so where that says the editor's own binary runs as Node, the mapper needs no Node
 *   of the machine's; anywhere else it is started as a project's own copy is, by `node`.
 */
export function mapperCommand(extensionPath: string, runtime: MapperRuntime = process): string[] {
  const script = join(extensionPath, "dist", "mapper.mjs");
  return [runtime.env["ELECTRON_RUN_AS_NODE"] ? runtime.execPath : "node", script];
}

/**
 * What the TypeScript extension is told.
 *
 * @param extensionPath The folder this extension is installed in.
 * @param runtime The extension host.
 */
export function mapperContribution(
  extensionPath: string,
  runtime?: MapperRuntime,
): ContentMapperContribution {
  return {
    extensions: [".jxn"],
    inferredProjectContribution: {
      manifest: {
        cwd: Uri.file(extensionPath),
        dynamicConfig: true,
        exec: mapperCommand(extensionPath, runtime),
        name: "@jxsuite/content-mapper",
      },
    },
  };
}

/**
 * Tell the TypeScript extension about `.jxn` files, now if it is installed and enabled and
 * otherwise when it first is.
 *
 * @param extensionPath The folder this extension is installed in.
 * @param report Where a failure is written. None is shown to the person, because a `.jxn` file that
 *   is not type checked is still one that can be edited.
 * @returns What takes the registration away again.
 */
export function registerContentMapper(
  extensionPath: string,
  report: (message: string) => void,
): Disposable {
  let registration: Disposable | undefined;
  let asked = false;
  let over = false;

  const ask = async (): Promise<void> => {
    const typescript = extensions.getExtension<TypeScriptExports>(TYPESCRIPT_EXTENSION_ID);
    if (!typescript || asked) {
      return;
    }
    asked = true;
    try {
      const api = await typescript.activate();
      if (over) {
        return;
      }
      if (!api?.registerContentMappers) {
        report("The TypeScript extension has no content mappers: .jxn files are not type checked.");
        return;
      }
      registration = api.registerContentMappers(CONTRIBUTOR_ID, [
        mapperContribution(extensionPath),
      ]);
    } catch (error) {
      report(`The TypeScript extension did not take the .jxn content mapper: ${String(error)}`);
    }
  };

  const watching = extensions.onDidChange(() => {
    void ask();
  });
  void ask();
  return new Disposable(() => {
    over = true;
    watching.dispose();
    registration?.dispose();
  });
}
