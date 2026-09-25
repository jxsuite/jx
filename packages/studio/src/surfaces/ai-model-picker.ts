/// <reference lib="dom" />
/**
 * The model catalogue as a mounted document.
 *
 * `ui/ai-model-picker.ts` is the flow — it decides which credentials a catalogue may be shown for,
 * when to list, what a failed listing said and where a choice goes — and this is the surface it
 * draws into.
 *
 * **The host element belongs to this module, not to the host surface.** Both callers are still lit
 * templates that interpolate the picker into a row of their own (`panels/ai-chat/composer.ts`'s
 * button row, `new-project/import-tab.ts`'s field column), so there is no container in either to
 * mount into. So the surface carries its own: one `<div>` per controller, mounted once and handed
 * to lit as a child value. lit inserts a Node it is given rather than cloning it, and re-inserting
 * the same node is a no-op, so the document survives every repaint of the row around it. This is
 * the seam `surfaces/ai-managed-connect.ts` established; nothing here is new but the contents.
 *
 * The host is `display: contents` for the same reason it is there: both rows lay their children out
 * themselves (a flex row and a flex column), and a wrapper box would become the flex item in the
 * document root's place and take the width rule below it with it.
 *
 * @docs studio/ai
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import pickerDoc from "./ai-model-picker.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("ai-model-picker", pickerDoc as unknown as JxDocument);

/** One row the control offers. Already a label — the flow decides what a row is called. */
export interface ModelPickerRow {
  /** The model id, which is both the row's key and what a choice reports. */
  value: string;
  /** What the row reads, including any note the flow attached to it. */
  label: string;
  /** A row that stands for a state rather than a model, and so may not be chosen. */
  disabled?: boolean;
}

/** How wide the control is drawn. Two hosts, two shapes, and no class between them. */
export type ModelPickerWidth = "compact" | "fill";

/** What the picker says right now. Every field is the flow's, never a state it derives. */
export interface ModelPickerView {
  /** The rows to offer, in order, already including any placeholder the flow wants shown. */
  options: ModelPickerRow[];
  /** The id shown as chosen. The flow guarantees the rows contain it. */
  value: string;
  /** The control's tooltip: "Model", or what the last listing refused with. */
  hint: string;
  /** Why the last listing did not finish. Empty draws no retry button. */
  failure: string;
  /** The kit control size, `"sm"` or `"md"` — the host's to set. */
  size: "sm" | "md";
  /** Which of the two shapes to draw. */
  width: ModelPickerWidth;
}

/** The two things the reader can do here. */
export interface ModelPickerActions {
  /** A row was picked. Read once, when the surface is created. */
  choose: (id: string) => void;
  /** List again after a failure. */
  retry: () => void;
}

export interface ModelPickerSurface {
  /** The element the document lives in — handed to a host's lit template as a child value. */
  readonly host: HTMLElement;
  /** Bring the standing surface up to date, remounting only if its root has been taken away. */
  update: (view: ModelPickerView) => void;
}

/** What the document discriminates on, derived here so the flow never has to spell it. */
interface ModelPickerFlags {
  /** Whether there is a refusal, and so a retry button. The `$switch` reads it. */
  hasFailure: boolean;
}

interface ModelPickerScope
  extends Record<string, unknown>, ModelPickerView, ModelPickerActions, ModelPickerFlags {}

/** The view plus the flag the document switches on. */
function derive(view: ModelPickerView): ModelPickerView & ModelPickerFlags {
  return { ...view, hasFailure: view.failure !== "" };
}

/**
 * Create the picker's surface, mounted into a host of its own.
 *
 * There is no teardown, deliberately: a controller lives as long as the surface that made it, and
 * the host it owns is the thing lit takes in and out of the page.
 *
 * @param {ModelPickerView} view What the picker offers to begin with.
 * @param {ModelPickerActions} actions What a pick and a retry do.
 * @returns {ModelPickerSurface}
 */
export function createModelPickerSurface(
  view: ModelPickerView,
  actions: ModelPickerActions,
): ModelPickerSurface {
  const host = document.createElement("div");
  host.style.display = "contents";
  const scope = reactive({ ...derive(view), ...actions }) as ModelPickerScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = false;

  function mount(): void {
    mounting = true;
    void mountSurface("ai-model-picker", scope, host).then((mounted) => {
      mounting = false;
      handle = mounted;
    });
  }

  mount();

  return {
    host,
    update(next) {
      Object.assign(scope, derive(next));
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the row around it
         would take the control out from under a reader who has it open. The remount below answers
         the one case assignment cannot — a host the document has been taken out of — and it cannot
         fire while a mount is in flight, because a record with no handle yet IS the standing one. */
      if (mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      host.textContent = "";
      mount();
    },
  };
}
