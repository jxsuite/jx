/**
 * Completion in the Code view of a `.jxn` file, from the schemas its JSON siblings are validated
 * against (§4.2.1).
 *
 * Monaco's JSON service completes JSON and nothing else, so Jx Notation gets a provider of its own.
 * It decides nothing: `completeJxn` in `@jxsuite/schema/jxn-completion` is the one reader every
 * editor asks (`spec.md` §22.6), and this module is what turns its answer into Monaco's.
 *
 * **Monaco asks by the model's language**, so this provider is asked inside the TypeScript a file
 * holds too. The reader offers nothing in code, and that is what keeps the two apart.
 *
 * @docs studio/logic/code
 */
import { completeJxn } from "@jxsuite/schema/jxn-completion";
import type { JxnCompletionKind } from "@jxsuite/schema/jxn-completion";
import type { ComposedProjectSchemas } from "@jxsuite/schema/project-schemas";
import type { IPosition, languages } from "monaco-editor/editor";
import { JXN_LANGUAGE_ID } from "./jxn-language";

/**
 * The characters that begin a member, an annotation or a value. Monaco asks at a word by itself,
 * and none of these is part of one.
 */
export const JXN_TRIGGER_CHARACTERS = [".", "$", "(", "=", '"', "/"];

/** The members of `monaco.languages.CompletionItemKind` an offer is drawn with. */
export type JxnCompletionKinds = Pick<
  typeof languages.CompletionItemKind,
  "Class" | "Keyword" | "Property" | "Value"
>;

/** The part of Monaco's API registering a completion provider uses. */
export interface MonacoCompletion {
  CompletionItemKind: JxnCompletionKinds;
  registerCompletionItemProvider: (typeof languages)["registerCompletionItemProvider"];
}

/** What a completion reads of the model it is asked in. */
export interface JxnCompletionModel {
  getOffsetAt: (position: IPosition) => number;
  getPositionAt: (offset: number) => IPosition;
  getValue: () => string;
}

/** The icon Monaco draws each kind of offer with. */
function kindsOf(
  kinds: JxnCompletionKinds,
): Record<JxnCompletionKind, languages.CompletionItemKind> {
  return {
    annotation: kinds.Keyword,
    element: kinds.Class,
    member: kinds.Property,
    value: kinds.Value,
  };
}

/**
 * What may be written at a position of a `.jxn` model, as Monaco lists it.
 *
 * @param kinds `monaco.languages.CompletionItemKind`.
 * @param schemas The schemas in force.
 * @param model The model.
 * @param position The position in it.
 * @returns The reader's offers in the reader's order, each replacing the stretch the reader names.
 */
export function jxnSuggestions(
  kinds: JxnCompletionKinds,
  schemas: ComposedProjectSchemas,
  model: JxnCompletionModel,
  position: IPosition,
): languages.CompletionList {
  const kindOf = kindsOf(kinds);
  const found = completeJxn(model.getValue(), model.getOffsetAt(position), schemas);
  const from = model.getPositionAt(found.start);
  const to = model.getPositionAt(found.end);
  const range = {
    endColumn: to.column,
    endLineNumber: to.lineNumber,
    startColumn: from.column,
    startLineNumber: from.lineNumber,
  };
  return {
    suggestions: found.items.map((item, at) => {
      const suggestion: languages.CompletionItem = {
        insertText: item.insert,
        kind: kindOf[item.kind],
        label: item.label,
        range,
        // Monaco sorts by label otherwise, and the reader's order is the useful one.
        sortText: String(at).padStart(5, "0"),
      };
      if (item.detail !== undefined) {
        suggestion.documentation = item.detail;
      }
      if (item.insert.endsWith("=")) {
        // A name is half of what is being written: go on to what its value may be.
        suggestion.command = { id: "editor.action.triggerSuggest", title: "Suggest" };
      }
      return suggestion;
    }),
  };
}

/**
 * The provider Monaco asks for a `.jxn` model.
 *
 * @param kinds `monaco.languages.CompletionItemKind`.
 * @param schemas The schemas in force, asked for at each completion so a project that is opened or
 *   changed is followed.
 * @returns A provider that answers with {@link jxnSuggestions}.
 */
export function jxnCompletionProvider(
  kinds: JxnCompletionKinds,
  schemas: () => ComposedProjectSchemas,
): languages.CompletionItemProvider {
  return {
    provideCompletionItems: (model, position) => jxnSuggestions(kinds, schemas(), model, position),
    triggerCharacters: JXN_TRIGGER_CHARACTERS,
  };
}

/**
 * Have Monaco complete Jx Notation.
 *
 * @param monaco `monaco.languages`. Absent under a double of Monaco that has no language API, and
 *   there is nothing to register with then.
 * @param schemas The schemas in force when a completion is asked for.
 */
export function registerJxnCompletion(
  monaco: MonacoCompletion | undefined,
  schemas: () => ComposedProjectSchemas,
): void {
  monaco?.registerCompletionItemProvider(
    JXN_LANGUAGE_ID,
    jxnCompletionProvider(monaco.CompletionItemKind, schemas),
  );
}
