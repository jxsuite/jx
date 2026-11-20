/**
 * The Document format section's specimen: a project mostly in JSON, with the conversion on offer,
 * and the write that was refused (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { FormatScope } from "./settings-format";

/** The section; a non-empty `error` draws the alert above the field. */
function section(error: string): FormatScope {
  const scope: FormatScope = reactive<FormatScope>({
    canConvert: true,
    convert: () => {
      scope.error = "";
    },
    convertLabel: "Convert 12 documents to Jx Notation…",
    error,
    format: "jxn",
    formats: [
      { label: "Jx Notation (.jxn)", value: "jxn" },
      { label: "JSON (.json)", value: "json" },
    ],
    hasError: error !== "",
    setFormat: (value) => {
      scope.format = value;
    },
    summary: "12 documents are JSON and 3 are Jx Notation.",
  });
  return scope;
}

export const specimen = defineSpecimen<FormatScope>({
  drive: (root) => {
    root.querySelector('[part="default"]')?.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector('[part="convert"]')?.dispatchEvent(new Event("click", { bubbles: true }));
  },
  scope: () => section(""),
  variants: { failed: () => section("project.json could not be written: the file is read-only") },
});
