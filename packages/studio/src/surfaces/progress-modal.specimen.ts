/**
 * The progress dialog's specimen: a dependency install the reader may stop or send to the
 * background (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { ProgressScope } from "./progress-modal";

/** The dialog over one operation; an empty `cancelLabel` is one that cannot be stopped. */
function progress(cancelLabel: string): ProgressScope {
  const scope: ProgressScope = reactive<ProgressScope>({
    background: () => {
      scope.status = "Running in the background";
    },
    cancel: () => {
      scope.status = "Stopping";
    },
    cancelLabel,
    closed: () => {
      scope.status = "";
    },
    status: "Installing @jxsuite/parser and 3 more packages",
    title: "Installing dependencies",
  });
  return scope;
}

export const specimen = defineSpecimen<ProgressScope>({
  drive: (root) => {
    root.dispatchEvent(new CustomEvent("secondary"));
    root.dispatchEvent(new CustomEvent("confirm"));
    root.dispatchEvent(new CustomEvent("close"));
  },
  scope: () => progress("Stop"),
  variants: { "cannot-stop": () => progress("") },
});
