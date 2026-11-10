/**
 * Doubles for every `monaco-editor` entrypoint `src/services/monaco-setup.ts` imports.
 *
 * Monaco cannot load under happy-dom, so a suite that imports `monaco-setup` must intercept ALL of
 * them: the editor API, every editor feature at once (`features/register.all`) and the language
 * registrations. Two suites need it (`monaco-setup.test.ts`, `monaco-font-remeasure.test.ts`) and a
 * list copied into both would drift, so it lives here once.
 *
 * {@link MONACO_SETUP_ENTRIES} is also the drift guard: `monaco-setup.test.ts` asserts it is
 * exactly the set of specifiers the source imports, so adding a feature register without adding it
 * here fails by name rather than by a happy-dom crash in an unrelated suite.
 */

import { mock } from "bun:test";
import type { DiagnosticsOptions } from "monaco-editor/languages/features/json/register";
import type {
  CompilerOptions,
  DiagnosticsOptions as TypeScriptDiagnosticsOptions,
} from "monaco-editor/languages/features/typescript/register";

/** The three entries that carry VALUES monaco-setup reads. */
export const MONACO_EDITOR_ENTRY = "monaco-editor/editor";
export const MONACO_JSON_ENTRY = "monaco-editor/languages/features/json/register";
export const MONACO_TYPESCRIPT_ENTRY = "monaco-editor/languages/features/typescript/register";

/** The rest — imported purely to register a capability with the editor. */
export const MONACO_SIDE_EFFECT_ENTRIES = [
  "monaco-editor/features/register.all",
  "monaco-editor/languages/definitions/javascript/register",
  "monaco-editor/languages/definitions/typescript/register",
] as const;

/** Every `monaco-editor` specifier the module under test imports. */
export const MONACO_SETUP_ENTRIES: readonly string[] = [
  MONACO_EDITOR_ENTRY,
  MONACO_JSON_ENTRY,
  MONACO_TYPESCRIPT_ENTRY,
  ...MONACO_SIDE_EFFECT_ENTRIES,
];

/** The slice of the `monaco-editor/editor` namespace monaco-setup reaches for. */
export interface MonacoEditorApiDouble {
  /** The `editor` namespace; monaco-setup calls only `remeasureFonts` on it, once fonts are ready. */
  editor?: { remeasureFonts: () => void };
}

export interface MonacoSetupMockOptions {
  /** Stands in for the `jsonDefaults` monaco-setup pushes diagnostics options into. */
  jsonDefaults?: { setDiagnosticsOptions: (options: DiagnosticsOptions) => void };
  /** Stands in for the `typescriptDefaults` monaco-setup sets a body's diagnostics and options on. */
  typescriptDefaults?: {
    setCompilerOptions?: (options: CompilerOptions) => void;
    setDiagnosticsOptions: (options: TypeScriptDiagnosticsOptions) => void;
  };
  /** Stands in for the editor API namespace (`editor.remeasureFonts`). */
  editorApi?: MonacoEditorApiDouble;
}

/**
 * Install a double for every entry in {@link MONACO_SETUP_ENTRIES}. Call BEFORE importing
 * `../src/services/monaco-setup`.
 */
export function installMonacoSetupMocks(options: MonacoSetupMockOptions = {}): void {
  const jsonDefaults = options.jsonDefaults ?? { setDiagnosticsOptions: () => {} };
  void mock.module(MONACO_EDITOR_ENTRY, () => options.editorApi ?? {});
  void mock.module(MONACO_JSON_ENTRY, () => ({ jsonDefaults }));
  const typescriptDefaults = {
    setCompilerOptions: () => {},
    ...(options.typescriptDefaults ?? { setDiagnosticsOptions: () => {} }),
  };
  // The enums are the values monaco-setup names its compiler options by; the numbers are TypeScript's.
  void mock.module(MONACO_TYPESCRIPT_ENTRY, () => ({
    ModuleKind: { ESNext: 99 },
    ModuleResolutionKind: { NodeJs: 2 },
    ScriptTarget: { ESNext: 99 },
    typescriptDefaults,
  }));
  for (const entry of MONACO_SIDE_EFFECT_ENTRIES) {
    void mock.module(entry, () => ({}));
  }
}
