/**
 * The Deploy settings section's specimen: the build adapter chosen from the ones a project may
 * name, and the write that was refused (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type { DeployScope } from "./settings-deploy";

/** The section; a non-empty `error` draws the alert above the field. */
function deploy(error: string): DeployScope {
  const scope: DeployScope = reactive<DeployScope>({
    adapter: "cloudflare",
    adapters: [
      { label: "Static", value: "static" },
      { label: "Cloudflare Workers", value: "cloudflare" },
      { label: "Node", value: "node" },
      { label: "Bun", value: "bun" },
    ],
    error,
    hasError: error !== "",
    setAdapter: (value) => {
      scope.adapter = value;
    },
  });
  return scope;
}

export const specimen = defineSpecimen<DeployScope>({
  drive: (root) => {
    root.querySelector('[part="adapter"]')?.dispatchEvent(new Event("change", { bubbles: true }));
  },
  scope: () => deploy(""),
  variants: { failed: () => deploy("project.json could not be written: the file is read-only") },
});
