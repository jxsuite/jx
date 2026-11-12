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
  givenByProject,
  outsideAt,
} from "@jxsuite/schema/virtual-types";
import type { JxElement, ProjectConfig } from "@jxsuite/schema/types";
import type { OutsideState, VirtualBody, VirtualTarget } from "@jxsuite/schema/virtual-types";
import type { editor } from "monaco-editor";
import type {
  Diagnostic,
  getTypeScriptWorker,
} from "monaco-editor/languages/features/typescript/register";
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

/** Monaco's hand on its TypeScript worker: name the models, and it answers about them. */
export type TypeWorkerFor = Awaited<ReturnType<typeof getTypeScriptWorker>>;

/** How long a refusal waits before the worker is asked for again. */
const WORKER_WAIT_MS = 50;

/** How often a refusal is asked again, which with {@link WORKER_WAIT_MS} is ten seconds. */
const WORKER_ASKS = 200;

/**
 * Monaco's TypeScript worker, once Monaco has set it up.
 *
 * Monaco sets the worker up when it first meets a model of the language, in a module it loads for
 * the purpose, and refuses to hand the worker over until that has run. Nothing says when it has:
 * the load is Monaco's own, and two imports of one module settle in no promised order, so a check
 * that asks straight after the first such model is made is refused about as often as not. A refusal
 * is therefore asked again, briefly, until the worker is there.
 *
 * @returns The worker's hand.
 * @throws {unknown} What Monaco last refused with, where it never set the worker up.
 */
export async function typeScriptWorker(): Promise<TypeWorkerFor> {
  const register = await import("monaco-editor/languages/features/typescript/register");
  for (let asked = 0; ; asked += 1) {
    try {
      return await register.getTypeScriptWorker();
    } catch (error) {
      if (asked === WORKER_ASKS) {
        throw error;
      }
      await new Promise((resolve) => {
        setTimeout(resolve, WORKER_WAIT_MS);
      });
    }
  }
}

/** What a diagnostic says: a sentence, or a chain of explanations. */
type MessageText = Diagnostic["messageText"];

/** A diagnostic's message, with each chained explanation on a line of its own, indented. */
export function messageOf(text: MessageText, depth = 0): string {
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

/**
 * What a document is given by the project it is open in (`spec.md` §23.3): the project's own
 * `state`, a default layout, or, for a layout, the state of each page it wraps. Each makes `State`
 * open, because a body may read a name the document never declares.
 *
 * @param path The document's path from the project's folder.
 * @param config The project's configuration.
 * @returns Nothing for a document with no path or no project, which is read as alone.
 */
export function outsideOfDocument(
  path: string | null | undefined,
  config: ProjectConfig | null | undefined,
): OutsideState {
  if (!path || !config) {
    return {};
  }
  const [folder] = path.replace(/^\.\//u, "").split("/");
  return outsideAt(folder, givenByProject(config));
}

/** What {@link createTypeCheck} needs to know about the editor it serves. */
export interface TypeCheckInit {
  /** The buffer the findings are drawn on. */
  editor: editor.IStandaloneCodeEditor;
  /** The document the body is in, read afresh for each check so `State` follows an edit. */
  document: () => JxElement | null;
  /**
   * What the document's project gives it, read afresh for each check so `State` follows the
   * project's settings. A document checked without it is read as alone.
   */
  outside?: () => OutsideState;
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
      const unit = generateBodyTypes(document, init.target, code, init.outside?.());
      const uri = monaco.Uri.parse(`file:///jx-virtual/${init.id}.ts`);
      if (model) {
        model.setValue(unit.text);
      } else {
        model = monaco.editor.createModel(unit.text, "typescript", uri);
      }
      const forModel = await typeScriptWorker();
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
