/**
 * The native notation a project writes new documents in: its `defaults.format`.
 *
 * Unset reads as Jx Notation, which is what studio.md §8.5 has always said a new document is, so a
 * project that never chose is unchanged. The setting decides only what is CREATED. Every host reads
 * both notations, so a project may hold a mixture indefinitely, and converting what is already
 * there is a separate, explicit act (`format/convert-project.ts`).
 *
 * It is read from the live configuration on every call, never cached: Project Settings changes it
 * between one New File and the next, and a stale answer would write the old notation into a project
 * that has just asked for the other.
 */

import { projectState } from "../store";

/** The two native notations, by the extension each writes. */
export type NativeExt = ".json" | ".jxn";

/** What a project that never chose writes: Jx Notation, which `NATIVE_EXT` names. */
const FALLBACK_EXT: NativeExt = ".jxn";

/** Every notation a project may default to, in the order a picker offers them. */
export const NATIVE_FORMATS: readonly { ext: NativeExt; label: string; value: "json" | "jxn" }[] = [
  { ext: ".jxn", label: "Jx Notation (.jxn)", value: "jxn" },
  { ext: ".json", label: "JSON (.json)", value: "json" },
];

/** The extension a name in `defaults.format` writes, or null for anything else. */
export function nativeExtOf(value: string | undefined): NativeExt | null {
  return NATIVE_FORMATS.find((row) => row.value === value)?.ext ?? null;
}

/**
 * The extension a new page, template, component or collection page is written with.
 *
 * A value that is not one of the two is ignored rather than refused: a hand-edited
 * `defaults.format: "yaml"` is a validation problem for the schema to report, and must not stop an
 * author creating a page meanwhile.
 */
export function defaultNativeExt(): NativeExt {
  return nativeExtOf(projectState?.projectConfig?.defaults?.format) ?? FALLBACK_EXT;
}
