/**
 * Type errors in the Code view of a `.jxn` file, found by Monaco's own TypeScript worker
 * (`studio.md` §16.7).
 *
 * The Code view holds the file, and the file is not TypeScript: its code is the strings of a Jx
 * Notation document. `@jxsuite/schema/virtual-document` writes the modules a compiler reads for it
 * (the scripts, one for each body, one for each template, the references and props), which is what
 * `tsc` reads through the content mapper, so the two say the same of a file. This module hands
 * those modules to the worker as models of their own, asks about each, and puts every answer back
 * where the author wrote it.
 *
 * **The modules are one program.** A body's module imports `State` from the main one by the file's
 * name, so the models are named as files beside each other in a folder of this editor's own, and
 * the worker resolves the import between them as it would on disk.
 *
 * **The models are plain text.** Monaco checks every model of a language it has a worker for, and
 * these are read by this module alone, through the worker it asks for by name.
 *
 * **So the worker has to be woken.** Monaco sets its TypeScript worker up when it first meets a
 * model of that language, and refuses to hand the worker over before then. Nothing here is such a
 * model, and a Code view can be the first editor a session opens, so each check makes that meeting
 * happen once, with a model that holds nothing and is gone again at once. The setting up takes a
 * moment after that, which `typeScriptWorker` waits out.
 *
 * @docs studio/logic/code
 */
import {
  generateVirtualDocument,
  writtenBefore,
  writtenRange,
} from "@jxsuite/schema/virtual-document";
import { UNRESOLVED_MODULE_CODES } from "@jxsuite/schema/virtual-types";
import type { JxnSpan, OutsideState, VirtualUnit } from "@jxsuite/schema/virtual-document";
import type { Uri, editor } from "monaco-editor";
import type { Diagnostic } from "monaco-editor/languages/features/typescript/register";
import { loadedMonaco } from "./monaco-lazy";
import type { Monaco } from "./monaco-lazy";
import { clearProblems, notify } from "./notify";
import type { NotifyOptions } from "./notify";
import { TYPE_MARKER_OWNER, TYPE_PROBLEM_SOURCE, messageOf, typeScriptWorker } from "./type-check";
import type { TypeCheck } from "./type-check";

/** One error, as a stretch of the file the author wrote. */
export interface SourceFinding {
  /** The TypeScript diagnostic code, or null where the file itself is what is wrong. */
  code: number | null;
  /** One past the last character, an offset in the file. */
  end: number;
  message: string;
  /** The first character, an offset in the file. */
  start: number;
}

/**
 * Where a syntax error the compiler placed in a module's own text belongs: at the end of the code
 * before it, or at the first thing the author wrote where nothing comes before it.
 */
function placedBefore(unit: VirtualUnit, offset: number): JxnSpan | null {
  const at = writtenBefore(unit, offset) ?? unit.spans[0]?.originalStart;
  return at === undefined ? null : { end: at, start: at };
}

/**
 * The errors a worker reported for one module of a file, as places in the file.
 *
 * @param unit The module the worker read.
 * @param diagnostics What it said of that module.
 * @param syntax Whether these are syntax errors. One is the author's wherever the compiler places
 *   it, so it is drawn at the end of the code before it where it stands in the module's own text. A
 *   type error there is about text the author did not write, and is left out.
 * @returns Each error the author can act on. An unresolvable module is left out: the worker holds
 *   this file alone.
 */
export function findingsIn(
  unit: VirtualUnit,
  diagnostics: readonly Diagnostic[],
  syntax: boolean,
): SourceFinding[] {
  return diagnostics.flatMap((diagnostic) => {
    const { code, start } = diagnostic;
    if (diagnostic.category !== 1 || start === undefined || UNRESOLVED_MODULE_CODES.has(code)) {
      return [];
    }
    const written = writtenRange(unit, start, diagnostic.length ?? 1);
    const range = written ?? (syntax ? placedBefore(unit, start) : null);
    if (!range) {
      return [];
    }
    return [
      { code, end: range.end, message: messageOf(diagnostic.messageText), start: range.start },
    ];
  });
}

/** What {@link createSourceTypeCheck} needs to know about the Code view it serves. */
export interface SourceTypeCheckInit {
  /** The buffer the findings are drawn on, which holds the file. */
  editor: editor.IStandaloneCodeEditor;
  /** A name unique to this editor, for the folder the worker reads its modules from. */
  id: string;
  /** The tab the file is open in: the Problems this files carry it, and replace that tab's. */
  key: string;
  /** The file's name with its extension, which is how its modules import each other. */
  name: string;
  /**
   * What the file's project gives it, read afresh for each check so `State` follows the project's
   * settings. A file checked without it is read as alone.
   */
  outside?: () => OutsideState;
  /** The file's path, so a Problem row can open it and say where it is. */
  path?: string;
  /** Whether an answer for `text` is still wanted: the editor is live and still holds that text. */
  wanted: (text: string) => boolean;
}

/** The name a file's modules are known by, which holds nothing a URI would have to escape. */
const moduleNameOf = (name: string): string => name.replaceAll(/[^\w.-]/gu, "_");

/** By where each starts in the file, so the Problems read down the file as the markers do. */
const byStart = (one: SourceFinding, other: SourceFinding): number => one.start - other.start;

/**
 * Check the Code view of one `.jxn` file as it is typed.
 *
 * @param init The editor, the file's name and tab, and the test of whether an answer is still
 *   wanted.
 * @returns A handle whose `run` draws findings as markers on the editor and files each type error
 *   as a Problem (`studio.md` §16.6), replacing every Type check Problem of its tab.
 */
export function createSourceTypeCheck(init: SourceTypeCheckInit): TypeCheck {
  const models = new Map<string, editor.ITextModel>();
  const folder = `file:///jx-virtual/${init.id}/`;
  const moduleName = moduleNameOf(init.name);
  const specifier = `./${moduleName}`;
  const where = init.path ?? init.name;
  /** A message that names the file names a model of this folder: say the name its author knows. */
  const named = (finding: SourceFinding): SourceFinding => ({
    ...finding,
    message: finding.message.replaceAll(`${folder}${moduleName}`, init.name),
  });
  let disposed = false;
  let generation = 0;
  let woken = false;
  // A call rather than a read of `disposed`: the flag changes while a check is awaiting the worker.
  const isDisposed = (): boolean => disposed;

  /** Have Monaco meet the language its worker is for, which is what sets the worker up. */
  const wake = (monaco: Monaco): void => {
    if (!woken) {
      woken = true;
      monaco.editor.createModel("", "typescript").dispose();
    }
  };

  /** Give the worker's models the modules as they now are, and say what each is called. */
  const hold = (monaco: Monaco, units: readonly VirtualUnit[]): Uri[] => {
    const live = new Set<string>();
    const uris = units.map((unit, at) => {
      const file = at === 0 ? `${moduleName}.ts` : `${moduleName}.${at}${unit.extension}`;
      const uri = monaco.Uri.parse(`${folder}${file}`);
      const name = uri.toString();
      live.add(name);
      const held = models.get(name);
      if (!held) {
        models.set(name, monaco.editor.createModel(unit.text, "plaintext", uri));
      } else if (held.getValue() !== unit.text) {
        // Only where it changed, so the worker reads again no module that is the same.
        held.setValue(unit.text);
      }
      return uri;
    });
    for (const [name, model] of models) {
      if (!live.has(name)) {
        model.dispose();
        models.delete(name);
      }
    }
    return uris;
  };

  const draw = (findings: readonly SourceFinding[]): void => {
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
        const marker: editor.IMarkerData = {
          endColumn: to.column,
          endLineNumber: to.lineNumber,
          message: finding.message,
          severity: monaco.MarkerSeverity.Error,
          source: finding.code === null ? "jx" : "typescript",
          startColumn: from.column,
          startLineNumber: from.lineNumber,
        };
        if (finding.code !== null) {
          marker.code = `TS${finding.code}`;
        }
        return marker;
      }),
    );
    // Every one the tab has, a body's included: the file is the newer reading of all of them.
    clearProblems(
      (record) =>
        record.source === TYPE_PROBLEM_SOURCE &&
        record.key?.startsWith(`types.${init.key}:`) === true,
    );
    for (const [index, finding] of findings.entries()) {
      // A buffer that is not Jx Notation is never the document's, so no Problem outlives it.
      if (finding.code !== null) {
        const from = target.getPositionAt(finding.start);
        const options: NotifyOptions = {
          detail: `In ${where}, line ${from.lineNumber}, column ${from.column} (TS${finding.code})`,
          key: `types.${init.key}:source.${index}`,
          source: TYPE_PROBLEM_SOURCE,
          tier: "problem",
        };
        if (init.path !== undefined) {
          options.path = init.path;
        }
        notify.error(finding.message, options);
      }
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
      for (const model of models.values()) {
        model.dispose();
      }
      models.clear();
    },
    async run(text) {
      const monaco = loadedMonaco();
      if (disposed || !monaco) {
        return;
      }
      generation += 1;
      const mine = generation;
      // A newer check started, or the editor went, while the worker was thinking. Asked before
      // Each question too, because the models a question names are the newer check's by then.
      const stale = (): boolean => isDisposed() || mine !== generation;
      const outside = init.outside?.();
      const written = generateVirtualDocument(
        text,
        outside ? { outside, specifier } : { specifier },
      );
      if (written.problems.length > 0) {
        if (!init.wanted(text)) {
          return;
        }
        draw(
          written.problems.map((problem) => ({
            code: null,
            end: problem.offset + problem.length,
            message: problem.message,
            start: problem.offset,
          })),
        );
        return;
      }
      const units = [written.main, ...written.supplemental];
      const uris = hold(monaco, units);
      wake(monaco);
      const forModel = await typeScriptWorker();
      if (stale()) {
        return;
      }
      const worker = await forModel(...uris);
      if (stale()) {
        return;
      }
      const names = uris.map((uri) => uri.toString());
      const syntactic = await Promise.all(
        names.map((name) => worker.getSyntacticDiagnostics(name)),
      );
      if (stale()) {
        return;
      }
      // As `tsc` does: while any module does not parse, the type errors are noise.
      const parses = syntactic.every((list) => list.length === 0);
      const said = parses
        ? await Promise.all(names.map((name) => worker.getSemanticDiagnostics(name)))
        : syntactic;
      if (stale() || !init.wanted(text)) {
        return;
      }
      const found = units.flatMap((unit, at) => findingsIn(unit, said[at] ?? [], !parses));
      draw(found.map((finding) => named(finding)).toSorted(byStart));
    },
  };
}
