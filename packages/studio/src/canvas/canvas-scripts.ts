/**
 * A document's own scripts on the canvas (`spec.md` §23.2, `studio.md` §4.1).
 *
 * The canvas draws a page inside its layout, and an entry inside its collection's page, as ONE
 * document, and `$src: "#client"` says nothing about which of them it was written in. So each
 * document is given its address before it is merged with another, the way a build gives it one:
 * `#client` becomes `jx-script:<the document's URL>#client`, and the merged document then names two
 * modules where it has two. The URL is the one the frame would read the document from, so a
 * component drawn from its own tab and the same component fetched by a page are one module, and the
 * development host can turn a `#server` entry's address back into the file to run.
 *
 * `$script` itself never crosses into the frame. The client module's text rides beside the document
 * instead, under the specifier that names it, and the server module's text goes nowhere: it is
 * called over the network and run from the saved file.
 *
 * **A script reaches the canvas when its document is saved.** A function body is one expression of
 * an entry and is drawn as it is typed; a module that is half typed does not load, and one that
 * loads on every pause would start again each time, with whatever its top level does. So the text
 * the frame is given for the document being edited is the text that document was last saved with.
 *
 * @docs framework/concepts/functions
 */
import { isJsonObject, isString } from "@jxsuite/schema/guards";
import { qualifyScripts, scriptSpecifier } from "@jxsuite/schema/document-scripts";
import type { JxDocument, JxMutableNode } from "@jxsuite/schema/types";

/** The client modules one render draws with: each one's text, under the specifier that names it. */
export type CanvasScripts = Record<string, string>;

/**
 * The client script each document was last saved with, by the document's address. `undefined` is an
 * answer: the document was seen saved, and had none.
 */
const savedClient = new Map<string, string | undefined>();

/** The text of a document's client script, or `undefined` when it carries none. */
function clientScriptOf(doc: JxMutableNode): string | undefined {
  const scripts = doc.$script;
  return isJsonObject(scripts) && isString(scripts.client) ? scripts.client : undefined;
}

/**
 * Record what a document's client script is on disk, and say whether that is news: whether a canvas
 * that drew the document before is now drawing an older script.
 *
 * @param address The document's address ({@link scriptAddress}), or nothing for one with none.
 * @param doc The document as it was just written.
 */
export function noteSavedScript(address: string | null, doc: JxMutableNode): boolean {
  if (address === null) {
    return false;
  }
  const client = clientScriptOf(doc);
  const changed = savedClient.has(address)
    ? savedClient.get(address) !== client
    : client !== undefined;
  savedClient.set(address, client);
  return changed;
}

/** Forget every saved script. For a test, which starts with nothing drawn. */
export function resetSavedScripts(): void {
  savedClient.clear();
}

/**
 * A document's address: the URL a frame would read it from, which is what its script is named by.
 *
 * @param path The document's path under the project.
 * @param base The URL project paths resolve against (`documentBase()`).
 * @returns Nothing for a document with no file, which the runtime addresses itself when it is
 *   handed one as an object, and nothing where the two do not make a URL.
 */
export function scriptAddress(path: string | null | undefined, base: string): string | null {
  return path && URL.canParse(path, base) ? new URL(path, base).href : null;
}

/**
 * A document as a frame holds it: every `$src` naming its own script qualified with the document's
 * address, and `$script` gone. One with no script is returned as it is, and the one given is never
 * changed.
 */
function addressed(doc: JxMutableNode, address: string): JxMutableNode {
  if (doc.$script === undefined) {
    return doc;
  }
  /* SAFETY: `qualifyScripts` reads a document as a tree of JSON values and returns the same tree
     with `$src` strings replaced, so the editor's mutable node form goes through it as a
     `JxDocument` and comes back the node it was. */
  const qualified = qualifyScripts(doc as JxDocument, address) as JxMutableNode;
  const { $script: _script, ...rest } = qualified;
  return rest;
}

/**
 * The document a frame folds patches into, which is the edited document as written. It names the
 * modules the drawn document names, because a node drawn again after a patch is read from here.
 *
 * @param doc The edited document. Not changed.
 * @param path Its path under the project, or nothing for a document with no file.
 * @param base The URL project paths resolve against (`documentBase()`).
 */
export function ownShadow(
  doc: JxMutableNode,
  path: string | null | undefined,
  base: string,
): JxMutableNode {
  const address = scriptAddress(path, base);
  return address === null ? doc : addressed(doc, address);
}

/**
 * The values a patch carries, as the frame is given them: every `$src` naming the edited document's
 * own script qualified the way {@link ScriptCollector.own} qualified the document they are written
 * into. A node pasted with its state arrives naming the same module the rest of the document does.
 *
 * @param ops The patch's operations. Returned as they are when nothing in them names a script.
 * @param path The edited document's path under the project, or nothing for one with no file.
 * @param base The URL project paths resolve against (`documentBase()`).
 */
export function ownPatch<T extends object>(
  ops: T[],
  path: string | null | undefined,
  base: string,
): T[] {
  const address = scriptAddress(path, base);
  if (address === null) {
    return ops;
  }
  /* SAFETY: `qualifyScripts` walks any tree of JSON values and returns it with `$src` strings
     replaced, and a patch operation is such a tree, so each one comes back the operation it was. */
  return ops.map((op) => qualifyScripts(op as JxDocument, address) as T);
}

/** Gathers the client modules of the documents one render is composed from. */
export interface ScriptCollector {
  /**
   * A document as the frame is given it: every `$src` naming its own script qualified with its
   * address, and `$script` gone. Its client script is kept in {@link ScriptCollector.scripts}. A
   * document with no script is returned as it is, and the one given is never changed.
   *
   * @param doc The document, before it is merged with any other.
   * @param path Its path under the project, or nothing for a document with no file.
   * @param unsaved True when the document holds edits its file does not, so its script is read as
   *   it was last saved rather than as it stands.
   */
  own: (doc: JxMutableNode, path: string | null | undefined, unsaved?: boolean) => JxMutableNode;
  /** What was gathered so far. */
  readonly scripts: CanvasScripts;
}

/**
 * A collector for one render.
 *
 * @param base The URL project paths resolve against (`documentBase()`).
 */
export function scriptCollector(base: string): ScriptCollector {
  const scripts: CanvasScripts = {};
  return {
    own(doc, path, unsaved = false) {
      // No file, no address: the runtime gives a document handed to it as an object one of its own.
      const address = scriptAddress(path, base);
      if (address === null) {
        return doc;
      }
      const live = clientScriptOf(doc);
      let client = live;
      if (unsaved && savedClient.has(address)) {
        client = savedClient.get(address);
      } else {
        savedClient.set(address, live);
      }
      if (doc.$script !== undefined && client !== undefined) {
        scripts[scriptSpecifier(address, "client")] = client;
      }
      return addressed(doc, address);
    },
    scripts,
  };
}
