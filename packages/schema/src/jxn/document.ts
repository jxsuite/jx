/**
 * Read a document file whichever native format it is in, which is the choice every host has to make
 * before it reaches for a format extension.
 *
 * `.json` and `.jxn` are the two formats that need no extension to read (`spec.md` §22). This lives
 * here rather than in `parse.ts` because `parse.ts` is imported by what ships to a browser, and
 * this is the module that brings in a KDL parser.
 */
import type { JxDocument } from "../../types.ts";
import { parseJxDocument } from "../parse.ts";
import { parseJxn } from "./parse.ts";

/**
 * Whether a path names a `.jxn` file.
 *
 * @param path A file path, in either separator.
 */
export function isJxnPath(path: string): boolean {
  return path.toLowerCase().endsWith(".jxn");
}

/**
 * Whether a path names a document format that needs no extension to read.
 *
 * @param path A file path, in either separator.
 */
export function isNativeDocumentPath(path: string): boolean {
  return path.endsWith(".json") || isJxnPath(path);
}

/**
 * Read a native document file.
 *
 * @param text The file.
 * @param path Its path, which decides the format and names it in any error.
 * @throws {Error} When it does not read: a `JxnError`, with a line and column, for a `.jxn` file.
 */
export function parseNativeDocument(text: string, path: string): JxDocument {
  return isJxnPath(path) ? parseJxn(text, path) : parseJxDocument(text, path);
}
