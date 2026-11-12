/**
 * Completion in a `.jxn` file, from the schemas its JSON siblings are validated against.
 *
 * It decides nothing: `completeJxn` in `@jxsuite/schema/jxn-completion` is the one reader every
 * editor asks (`spec.md` §22.6), and this module is what turns its answer into VS Code's.
 *
 * **VS Code asks by the document's language**, so this provider is asked inside the TypeScript a
 * file holds too. The reader offers nothing in code, which leaves that to TypeScript's own server.
 *
 * @docs framework/concepts/jxn-files
 */
import { JXN_LANGUAGE_ID } from "@jxsuite/schema/jxn";
import { completeJxn, JXN_TRIGGER_CHARACTERS } from "@jxsuite/schema/jxn-completion";
import type { JxnCompletionKind } from "@jxsuite/schema/jxn-completion";
import type { ComposedProjectSchemas } from "@jxsuite/schema/project-schemas";
import { CompletionItem, CompletionItemKind, languages, Range } from "vscode";
import type { Disposable, Position, TextDocument } from "vscode";

/** What a completion reads of the document it is asked in. */
export type JxnCompletionDocument = Pick<TextDocument, "getText" | "offsetAt" | "positionAt">;

/** The icon each kind of offer is drawn with. */
const KINDS: Record<JxnCompletionKind, CompletionItemKind> = {
  annotation: CompletionItemKind.Keyword,
  element: CompletionItemKind.Class,
  member: CompletionItemKind.Property,
  value: CompletionItemKind.Value,
};

/**
 * What may be written at a position of a `.jxn` document, as VS Code lists it.
 *
 * @param schemas The schemas in force.
 * @param document The document.
 * @param position The position in it.
 * @returns The reader's offers in the reader's order, each replacing the stretch the reader names.
 */
export function jxnItems(
  schemas: ComposedProjectSchemas,
  document: JxnCompletionDocument,
  position: Position,
): CompletionItem[] {
  const found = completeJxn(document.getText(), document.offsetAt(position), schemas);
  const range = new Range(document.positionAt(found.start), document.positionAt(found.end));
  return found.items.map((offer, at) => {
    const item = new CompletionItem(offer.label, KINDS[offer.kind]);
    item.insertText = offer.insert;
    item.range = range;
    // VS Code sorts by label otherwise, and the reader's order is the useful one.
    item.sortText = String(at).padStart(5, "0");
    if (offer.detail !== undefined) {
      item.documentation = offer.detail;
    }
    if (offer.insert.endsWith("=")) {
      // A name is half of what is being written: go on to what its value may be.
      item.command = { command: "editor.action.triggerSuggest", title: "Suggest" };
    }
    return item;
  });
}

/**
 * Have VS Code complete Jx Notation.
 *
 * @param schemasFor The schemas in force for a file, asked for at each completion so a project
 *   whose schemas are written again is followed. It is given null for a document that is not a file
 *   on disk.
 * @returns What takes the provider away again.
 */
export function registerJxnCompletion(
  schemasFor: (file: string | null) => ComposedProjectSchemas,
): Disposable {
  return languages.registerCompletionItemProvider(
    JXN_LANGUAGE_ID,
    {
      provideCompletionItems: (document, position) =>
        jxnItems(
          schemasFor(document.uri.scheme === "file" ? document.uri.fsPath : null),
          document,
          position,
        ),
    },
    ...JXN_TRIGGER_CHARACTERS,
  );
}
