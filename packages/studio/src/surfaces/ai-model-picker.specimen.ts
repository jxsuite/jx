/**
 * The model picker's specimen: three models listed with one chosen, and the listing that failed
 * (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { ModelPickerScope } from "./ai-model-picker";

/** The picker; a non-empty `failure` draws the retry button beside it. */
function picker(failure: string): ModelPickerScope {
  const scope: ModelPickerScope = reactive<ModelPickerScope>({
    choose: (id) => {
      scope.value = id;
    },
    failure,
    hasFailure: failure !== "",
    hint: failure === "" ? "Model" : failure,
    options:
      failure === ""
        ? [
            { label: "Sonnet", value: "sonnet" },
            { label: "Opus", value: "opus" },
            { label: "Haiku", value: "haiku" },
          ]
        : [{ disabled: true, label: "No models listed", value: "" }],
    retry: () => {
      scope.failure = "";
      scope.hasFailure = false;
    },
    size: "sm",
    value: failure === "" ? "sonnet" : "",
    width: "compact",
  });
  return scope;
}

export const specimen = defineSpecimen<ModelPickerScope>({
  drive: (root) => {
    root.querySelector('[part="select"]')?.dispatchEvent(new Event("change", { bubbles: true }));
    root.querySelector<HTMLElement>('[part="retry"]')?.click();
  },
  scope: () => picker(""),
  variants: { failed: () => picker("The provider refused the listing: 401") },
});
