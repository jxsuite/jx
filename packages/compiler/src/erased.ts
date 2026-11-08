/**
 * Documents as the compiler reads them: with the TypeScript in their function bodies erased, once,
 * as each is read (`spec.md` §23.1, `compiler.md` §2.3). Everything after this, the analysis that
 * classifies a body and every emitter, sees JavaScript, so none of it changes.
 *
 * A body that was already JavaScript and reads differently as TypeScript (`a < b > (c)`) is said
 * once per place, on stderr, and the build goes on with the TypeScript reading.
 *
 * @docs framework/concepts/functions
 */
import { eraseClass, eraseDocument } from "@jxsuite/erase";
import type { EraseWarning } from "@jxsuite/erase";
import type { JsonValue, JxClassDef, JxDocument } from "@jxsuite/schema/types";

/** Every warning already printed, so a document read twice says each thing once. */
const said = new Set<string>();

/** Print what erasing found that did not stop it. */
function report(warnings: readonly EraseWarning[]): void {
  for (const { path, pointer, problem } of warnings) {
    const line = `${path}${pointer} (line ${problem.line}, column ${problem.column}): ${problem.message}`;
    if (!said.has(line)) {
      said.add(line);
      console.warn(`Warning: ${line}`);
    }
  }
}

/**
 * A document with its function bodies as JavaScript.
 *
 * @param document The document as read.
 * @param path Where it was read from, which names it in a message.
 * @throws {import("@jxsuite/erase").EraseError} When a body uses TypeScript that cannot be erased.
 */
export function erasedDocument<T extends JsonValue | JxDocument | JxClassDef>(
  document: T,
  path: string,
): T {
  const warnings: EraseWarning[] = [];
  const erased = eraseDocument(document, path, warnings);
  report(warnings);
  return erased;
}

/**
 * A class definition with its members' bodies as JavaScript.
 *
 * @param definition The class definition as read.
 * @param path Where it was read from.
 */
export function erasedClass<T extends JsonValue | JxDocument | JxClassDef>(
  definition: T,
  path: string,
): T {
  const warnings: EraseWarning[] = [];
  const erased = eraseClass(definition, path, warnings);
  report(warnings);
  return erased;
}
