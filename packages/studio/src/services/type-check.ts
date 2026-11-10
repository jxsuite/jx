/**
 * Type errors in a function body, found by Monaco's own TypeScript worker (`studio.md` §16.7).
 *
 * The function editor holds a body and nothing around it, so the worker cannot read it: `return` is
 * not allowed at the top of a file and `state` is declared nowhere. `@jxsuite/schema/virtual-types`
 * writes the file around it (the body copied in verbatim, `State` built from the document), this
 * module hands that file to the worker through a model of its own, and an error comes back at a
 * position in the wrapper that maps to the same place in the body. Nothing runs on a machine: the
 * worker carries its own compiler, so the desktop app and the cloud host check types with no `tsc`
 * and no Node.
 *
 * **The editor's own model is never the thing checked.** It stays what it was (syntax only, owned
 * by Monaco), and the findings land on it as a second set of markers beside it. A syntax error in
 * the body is Monaco's to report, and while one stands this module says nothing: the errors a parse
 * failure causes downstream are noise, and `tsc` reports the same way.
 *
 * @docs studio/logic/code
 */
import { isString } from "@jxsuite/schema/guards";
import {
  UNRESOLVED_MODULE_CODES,
  bodyOffsetOf,
  generateBodyTypes,
} from "@jxsuite/schema/virtual-types";
import type { JxElement } from "@jxsuite/schema/types";
import type { VirtualBody, VirtualTarget } from "@jxsuite/schema/virtual-types";
import type { editor } from "monaco-editor";
import type { Diagnostic } from "monaco-editor/languages/features/typescript/register";
import { loadedMonaco } from "./monaco-lazy";
import { clearProblems, notify } from "./notify";
import type { NotifyOptions } from "./notify";

/** The Problems `source` these findings carry, so a re-check replaces rather than stacks. */
export const TYPE_PROBLEM_SOURCE = "Type check";

/** The marker owner, apart from Monaco's own (`typescript`) and the lint's (`oxlint`). */
export const TYPE_MARKER_OWNER = "jx-types";

/** One error, as a range of the body the author wrote. */
export interface TypeFinding {
  /** The TypeScript diagnostic code. */
  code: number;
  /** One past the last character, an offset in the body. */
  end: number;
  message: string;
  /** The first character, an offset in the body. */
  start: number;
}

/** The two calls of Monaco's TypeScript worker this module makes. */
export interface TypeWorker {
  getSemanticDiagnostics: (fileName: string) => Promise<Diagnostic[]>;
  getSyntacticDiagnostics: (fileName: string) => Promise<Diagnostic[]>;
}

/** What a diagnostic says: a sentence, or a chain of explanations. */
type MessageText = Diagnostic["messageText"];

/** A diagnostic's message, with each chained explanation on a line of its own, indented. */
function messageOf(text: MessageText, depth = 0): string {
  if (isString(text)) {
    return text;
  }
  const lines = [`${"  ".repeat(depth)}${text.messageText}`];
  for (const next of text.next ?? []) {
    lines.push(messageOf(next, depth + 1));
  }
  return lines.join("\n");
}

/**
 * The errors a worker reported for a wrapped body, as places in the body.
 *
 * @param unit The wrapped body the worker checked.
 * @param syntactic The worker's syntax diagnostics for that file.
 * @param semantic The worker's semantic diagnostics for that file.
 * @returns Nothing while the body does not parse; otherwise each error the author can act on, in
 *   the wrapper's order. An error in the wrapper itself, and an unresolvable module, are left out.
 */
export function findingsFor(
  unit: VirtualBody,
  syntactic: readonly Diagnostic[],
  semantic: readonly Diagnostic[],
): TypeFinding[] {
  if (syntactic.length > 0) {
    return [];
  }
  return semantic.flatMap((diagnostic) => {
    if (diagnostic.category !== 1 || diagnostic.start === undefined) {
      return [];
    }
    if (UNRESOLVED_MODULE_CODES.has(diagnostic.code)) {
      return [];
    }
    const start = bodyOffsetOf(unit, diagnostic.start);
    if (start === null) {
      return [];
    }
    const end = Math.min(
      start + Math.max(diagnostic.length ?? 1, 1),
      unit.bodyEnd - unit.bodyStart,
    );
    return [{ code: diagnostic.code, end, message: messageOf(diagnostic.messageText), start }];
  });
}

/** What {@link createTypeCheck} needs to know about the editor it serves. */
export interface TypeCheckInit {
  /** The buffer the findings are drawn on. */
  editor: editor.IStandaloneCodeEditor;
  /** The document the body is in, read afresh for each check so `State` follows an edit. */
  document: () => JxElement | null;
  /** A name unique to this editor, for the file the worker reads. */
  id: string;
  /**
   * Which body this is, across editors: the Problems it files carry it, so opening the same body
   * again replaces them instead of stacking beside them.
   */
  key: string;
  /** What the body is called in a Problem, such as `state.save` or `onclick`. */
  label: string;
  /** The document's path, so a Problem row can open the file it is about. */
  path?: string;
  /** Which body this is. */
  target: VirtualTarget;
  /** Whether an answer for `code` is still wanted: the editor is live and still holds that text. */
  wanted: (code: string) => boolean;
}

/** A running check of one editor's body. */
export interface TypeCheck {
  /**
   * Remove the markers and release the worker's file. Safe to call twice. The Problems stay: the
   * Problems tab shares the dock with the code surface, so it can only be read once the editor is
   * gone, and they are replaced the next time the body is checked.
   */
  dispose: () => void;
  /** Check `code` and draw what is found, unless it is no longer wanted when the answer comes. */
  run: (code: string) => Promise<void>;
}

/** The Problem key prefix for one body's findings. */
const keyPrefix = (key: string): string => `types.${key}.`;

/**
 * Check one editor's body as it is typed.
 *
 * @param init The editor, the body's place in its document, and the test of whether an answer is
 *   still wanted.
 * @returns A handle whose `run` draws findings as markers on the editor and files each as a Problem
 *   (`studio.md` §16.6), replacing the last run's.
 */
export function createTypeCheck(init: TypeCheckInit): TypeCheck {
  let model: editor.ITextModel | null = null;
  let disposed = false;
  let generation = 0;
  // A call rather than a read of `disposed`: the flag changes while a check is awaiting the worker.
  const isDisposed = (): boolean => disposed;

  const clearProblemsOfThis = (): void => {
    clearProblems(
      (record) =>
        record.source === TYPE_PROBLEM_SOURCE &&
        record.key?.startsWith(keyPrefix(init.key)) === true,
    );
  };

  const draw = (findings: readonly TypeFinding[]): void => {
    const monaco = loadedMonaco();
    const target = init.editor.getModel();
    if (!monaco || !target) {
      return;
    }
    monaco.editor.setModelMarkers(
      target,
      TYPE_MARKER_OWNER,
      findings.map((finding) => {
        const from = target.getPositionAt(finding.start);
        const to = target.getPositionAt(finding.end);
        return {
          code: `TS${finding.code}`,
          endColumn: to.column,
          endLineNumber: to.lineNumber,
          message: finding.message,
          severity: monaco.MarkerSeverity.Error,
          source: "typescript",
          startColumn: from.column,
          startLineNumber: from.lineNumber,
        };
      }),
    );
    clearProblemsOfThis();
    for (const [index, finding] of findings.entries()) {
      const from = target.getPositionAt(finding.start);
      const options: NotifyOptions = {
        detail: `In ${init.label}, line ${from.lineNumber}, column ${from.column} (TS${finding.code})`,
        key: `${keyPrefix(init.key)}${index}`,
        source: TYPE_PROBLEM_SOURCE,
        tier: "problem",
      };
      if (init.path !== undefined) {
        options.path = init.path;
      }
      notify.error(finding.message, options);
    }
  };

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const monaco = loadedMonaco();
      const target = init.editor.getModel();
      if (monaco && target) {
        monaco.editor.setModelMarkers(target, TYPE_MARKER_OWNER, []);
      }
      model?.dispose();
      model = null;
    },
    async run(code) {
      const monaco = loadedMonaco();
      const document = init.document();
      if (disposed || !monaco || !document) {
        return;
      }
      generation += 1;
      const mine = generation;
      const unit = generateBodyTypes(document, init.target, code);
      const uri = monaco.Uri.parse(`file:///jx-virtual/${init.id}.ts`);
      if (model) {
        model.setValue(unit.text);
      } else {
        model = monaco.editor.createModel(unit.text, "typescript", uri);
      }
      const { getTypeScriptWorker } =
        await import("monaco-editor/languages/features/typescript/register");
      const forModel = await getTypeScriptWorker();
      const worker = await forModel(uri);
      const [syntactic, semantic] = await Promise.all([
        worker.getSyntacticDiagnostics(uri.toString(true)),
        worker.getSemanticDiagnostics(uri.toString(true)),
      ]);
      // A newer check started, or the editor moved on, while the worker was thinking.
      if (isDisposed() || mine !== generation || !init.wanted(code)) {
        return;
      }
      draw(findingsFor(unit, syntactic, semantic));
    },
  };
}
