/**
 * The Convert Project flow: plan, say what it will do, ask, run, report.
 *
 * Split from `convert-project.ts` so the part that decides and does stays free of dialogs and
 * testable without a DOM. Everything here that touches the screen is loaded on demand.
 *
 * **The warning about other branches is part of the question.** A rename is a delete and an add to
 * git, so a branch that still edits `pages/about.json` meets a file that is no longer there when it
 * merges. Nothing Studio can do repairs that afterwards, which is why it is stated before the
 * button and not after the fact.
 *
 * @docs studio/projects/settings
 */

import { NATIVE_FORMATS, nativeExtOf } from "./default-format";
import type { NativeExt } from "./default-format";
import type {
  BranchCheck,
  ProjectConversionPlan,
  ProjectConversionResult,
} from "./convert-project";

/** The notation's name as a reader says it. */
export function formatLabel(ext: NativeExt): string {
  return NATIVE_FORMATS.find((row) => row.ext === ext)?.label ?? ext;
}

/** The sentence about other branches, or null when there is nothing to say. */
export function branchWarning(check: BranchCheck): string | null {
  if (check.kind === "none") {
    return null;
  }
  const names = check.branches.slice(0, 5).join(", ");
  const more = check.branches.length > 5 ? ` and ${check.branches.length - 5} more` : "";
  const where = check.current === "" ? "this one" : `“${check.current}”`;
  return check.kind === "some"
    ? `${check.branches.length} other branch${check.branches.length === 1 ? " holds" : "es hold"} ` +
        `commits that ${where} does not: ${names}${more}. Converting renames files, so those ` +
        "branches will conflict with it where they edit a document. Merge or finish them first."
    : `Other branches exist (${names}${more}) and this host cannot say whether they are merged. ` +
        "Converting renames files, so a branch that still edits a document will conflict with " +
        "it. Merge or finish them first.";
}

/** The consequence lines of a plan, in the order they are shown. */
export function planLines(plan: ProjectConversionPlan): string[] {
  const label = formatLabel(plan.target);
  const count = plan.files.length;
  const lines = [
    `${count} document${count === 1 ? "" : "s"} in pages/, layouts/ and components/ ` +
      `${count === 1 ? "becomes" : "become"} ${label}. The original files are not kept, and every ` +
      "reference to them is rewritten.",
  ];
  if (plan.alreadyTarget > 0) {
    lines.push(
      `${plan.alreadyTarget} already ${plan.alreadyTarget === 1 ? "is" : "are"} ${label}.`,
    );
  }
  if (plan.skipped.length > 0) {
    const shown = plan.skipped
      .slice(0, 3)
      .map((skip) => `${skip.path} (${skip.reason})`)
      .join("; ");
    const more = plan.skipped.length > 3 ? `; and ${plan.skipped.length - 3} more` : "";
    lines.push(`${plan.skipped.length} will be left as they are: ${shown}${more}.`);
  }
  lines.push(
    `New documents will be written as ${label} from now on.`,
    "Commit first, so the whole conversion can be reverted as one change.",
  );
  return lines;
}

/** The sentence a finished run reports. */
export function resultLine(result: ProjectConversionResult, target: NativeExt): string {
  const base = `Converted ${result.converted} document${result.converted === 1 ? "" : "s"} to ${formatLabel(target)}`;
  return result.refsUpdated > 0
    ? `${base}; updated ${result.refsUpdated} reference${result.refsUpdated === 1 ? "" : "s"} in ${result.filesChanged} file${result.filesChanged === 1 ? "" : "s"}`
    : base;
}

/**
 * Convert the open project to a notation, after asking.
 *
 * @param targetValue - `"jxn"` or `"json"`.
 * @returns Whether anything was converted.
 */
export async function convertProject(targetValue: string): Promise<boolean> {
  const target = nativeExtOf(targetValue);
  const { notify } = await import("../services/notify");
  if (target === null) {
    notify.error(`“${targetValue}” is not a notation a project can be converted to.`, {
      source: "Convert",
    });
    return false;
  }
  const { projectState } = await import("../store");
  if (!projectState) {
    notify.error("Open a project to convert it.", { source: "Convert" });
    return false;
  }
  const { planProjectConversion, runProjectConversion } = await import("./convert-project");
  const { errorMessage } = await import("@jxsuite/schema/parse");
  const label = formatLabel(target);

  let plan: ProjectConversionPlan;
  try {
    notify.info(`Checking the project's documents…`, { key: "convert-project", source: "Convert" });
    plan = await planProjectConversion(target);
  } catch (error) {
    notify.error("Could not check the project's documents.", {
      detail: errorMessage(error),
      key: "convert-project",
      source: "Convert",
    });
    return false;
  }

  if (plan.dirty.length > 0) {
    notify.error(
      `${plan.dirty.length} document${plan.dirty.length === 1 ? " has" : "s have"} unsaved changes.`,
      {
        detail: `Save or discard the changes in ${plan.dirty.join(", ")}, then convert.`,
        key: "convert-project",
        source: "Convert",
        tier: "problem",
      },
    );
    return false;
  }
  if (plan.files.length === 0) {
    const skipped = plan.skipped.length;
    notify.info(
      skipped > 0
        ? `Nothing could be converted: ${skipped} document${skipped === 1 ? " was" : "s were"} skipped.`
        : `Every document is already ${label}.`,
      {
        detail: plan.skipped.map((skip) => `${skip.path}: ${skip.reason}`).join("\n"),
        key: "convert-project",
        source: "Convert",
      },
    );
    return false;
  }

  const warning = branchWarning(plan.branches);
  const { showConfirmDialog } = await import("../ui/layers");
  const { html } = await import("lit-html");
  const confirmed = await showConfirmDialog(
    "Convert project",
    html`<span>Convert this project's documents to <strong>${label}</strong>?</span>${
        warning === null
          ? ""
          : html`<p class="dialog-consequence" role="alert">
              <strong>Warning:</strong> ${warning}
            </p>`
      }${planLines(plan).map((line) => html`<p class="dialog-consequence">${line}</p>`)}`,
    { confirmLabel: warning === null ? "Convert" : "Convert anyway", destructive: true },
  );
  if (!confirmed) {
    return false;
  }

  const result = await runProjectConversion(plan, (done, total, path) => {
    notify.info(`Converting ${done} of ${total}: ${path}`, {
      key: "convert-project",
      source: "Convert",
    });
  });

  if (result.failed.length === 0) {
    try {
      const { updateSiteConfig } = await import("../site-context");
      await updateSiteConfig({
        defaults: {
          ...projectState.projectConfig?.defaults,
          format: target === ".json" ? "json" : "jxn",
        },
      });
    } catch {
      // The write has filed its own Problem; the documents are converted either way.
    }
    notify.success(resultLine(result, target), { key: "convert-project", source: "Convert" });
  } else {
    notify.warn(`${resultLine(result, target)}; ${result.failed.length} failed.`, {
      detail: result.failed.map((f) => `${f.path}: ${f.message} ${f.detail}`).join("\n"),
      key: "convert-project",
      source: "Convert",
      tier: "problem",
    });
  }
  return result.converted > 0;
}
