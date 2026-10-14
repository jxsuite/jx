/// <reference lib="dom" />
/**
 * The schema-push plan, as a mounted document.
 *
 * This is the adapter. `panels/data-grid.ts` is the flow — the dry run, the confirmation that gates
 * the apply, and what the outcome was — and this is the body it draws into the confirm dialog's
 * island. The dialog itself is `ui/layers.ts`'s, headline and buttons and all: a push is a confirm,
 * and a second answer to that question is a defect (specs/studio-ui-guidelines.md §12.5).
 *
 * @docs studio/data/grid
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import pushPlanDoc from "./push-plan.json";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("push-plan", pushPlanDoc);

/** One step of the plan. `kind` colours the rule beside it; nothing here reads it otherwise. */
export interface PushStepRow {
  key: string;
  kind: string;
  summary: string;
}

/** One warning or one error. */
export interface PushNoteRow {
  key: string;
  text: string;
}

/** Everything the body draws. */
export interface PushPlanView {
  steps: PushStepRow[];
  warnings: PushNoteRow[];
  errors: PushNoteRow[];
}

export interface PushPlanSurfaceHandle {
  ready: Promise<HTMLElement>;
  update: (view: PushPlanView) => void;
  dispose: () => void;
}

/**
 * Mount the plan into `host`.
 *
 * @param {HTMLElement} host - The dialog's island node
 * @param {PushPlanView} view - What to draw right now
 * @returns {PushPlanSurfaceHandle}
 */
export function mountPushPlanSurface(host: HTMLElement, view: PushPlanView): PushPlanSurfaceHandle {
  const scope: PushPlanView = reactive<PushPlanView>({
    errors: view.errors,
    steps: view.steps,
    warnings: view.warnings,
  });

  let mounted: SurfaceHandle | null = null;
  let disposed = false;
  const ready = mountSurface("push-plan", scope, host).then((surface) => {
    if (disposed) {
      surface.dispose();
    } else {
      mounted = surface;
    }
    /* SAFETY: `push-plan.json`'s root definition is a `div` element, so the runtime mounts an
       HTMLElement; a `Text` root only comes from a document whose root is a bare string. */
    return surface.root as HTMLElement;
  });

  return {
    dispose() {
      disposed = true;
      mounted?.dispose();
      mounted = null;
    },
    ready,
    update(next) {
      scope.steps = next.steps;
      scope.warnings = next.warnings;
      scope.errors = next.errors;
    },
  };
}
