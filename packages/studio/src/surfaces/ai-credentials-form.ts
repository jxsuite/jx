/// <reference lib="dom" />
/**
 * The AI provider credentials form as a mounted document.
 *
 * `ui/ai-credentials-form.ts` is the flow — it holds the three drafts, decides which credentials a
 * listing is made with, what Save persists and re-reads, and whether Cancel is on offer — and this
 * is the surface it draws into.
 *
 * **The host element belongs to this module, not to the gate.** Every credentials gate is still a
 * lit template that interpolates the form beside the keyless offer, so there is no container in the
 * host to mount into and no way to make one without editing three surfaces this conversion does not
 * own. So the surface carries its own: one `<div>` per controller, mounted once and handed to lit
 * as a child value. lit inserts a Node it is given rather than cloning it, and re-inserting the
 * same node is a no-op, so the document survives every repaint of the gate around it — which
 * matters more here than anywhere else in the batch, because this surface is three text fields a
 * reader is typing into and a repaint that rebuilt them would take the caret with it.
 *
 * The host is `display: contents` for the same reason `surfaces/ai-managed-connect.ts` gives: the
 * gates lay their children out in a flex column (`.prefs-assistant` centres them,
 * `.new-project-creds` stretches them), and a wrapper box would become the flex item in the
 * document root's place and take the `max-width` below it with it.
 *
 * @docs studio/ai
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import credentialsDoc from "./ai-credentials-form.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("ai-credentials-form", credentialsDoc as unknown as JxDocument);

/** One row of the listed catalogue, as the document draws it. */
export interface CredentialsModelRow {
  /** The model id — the row's key, and what a pick writes into the model draft. */
  value: string;
  /** What the row reads. */
  label: string;
}

/** What the form says right now. Every field is the flow's, never a state it derives. */
export interface AiCredentialsView {
  /** The line under the title: where the key goes, and where it does not. */
  intro: string;
  /** The three drafts, exactly as the flow holds them. */
  keyDraft: string;
  modelDraft: string;
  baseUrlDraft: string;
  /** The catalogue the last successful listing returned; empty draws no list control. */
  models: CredentialsModelRow[];
  /** A listing is in flight: the button says so and refuses a second one. */
  modelsLoading: boolean;
  /** What the fetch button reads — including while it is working, and once a list has landed. */
  fetchLabel: string;
  /** Why the last listing did not finish. Empty draws nothing. */
  modelsError: string;
  /** A key is already stored, so abandoning the drafts means something. */
  haveKey: boolean;
}

/** Everything the reader can do here. */
export interface AiCredentialsActions {
  setKey: (value: string) => void;
  setModel: (value: string) => void;
  setBaseUrl: (value: string) => void;
  fetchModels: () => void;
  save: () => void;
  cancel: () => void;
}

export interface AiCredentialsSurface {
  /** The element the document lives in — handed to a gate's lit template as a child value. */
  readonly host: HTMLElement;
  /** Bring the standing surface up to date, remounting only if its root has been taken away. */
  update: (view: AiCredentialsView) => void;
}

/** What the document discriminates on, derived here so the flow never has to spell it. */
interface AiCredentialsFlags {
  /** Whether a catalogue has landed, and so whether the list control is drawn. */
  hasModels: boolean;
  /** Whether there is a refusal to draw beside the fetch button. */
  hasError: boolean;
  /** The catalogue as the kit's select reads it. */
  modelOptions: CredentialsModelRow[];
}

interface AiCredentialsScope
  extends Record<string, unknown>, AiCredentialsView, AiCredentialsActions, AiCredentialsFlags {}

/** The view plus the flags the document renders from. */
function derive(view: AiCredentialsView): AiCredentialsView & AiCredentialsFlags {
  return {
    ...view,
    hasError: view.modelsError !== "",
    hasModels: view.models.length > 0,
    modelOptions: view.models,
  };
}

/**
 * Create the form's surface, mounted into a host of its own.
 *
 * There is no teardown, deliberately: a controller lives as long as the gate that made it, and the
 * host it owns is the thing lit takes in and out of the page.
 *
 * @param {AiCredentialsView} view What the form says to begin with.
 * @param {AiCredentialsActions} actions What each control does.
 * @returns {AiCredentialsSurface}
 */
export function createAiCredentialsSurface(
  view: AiCredentialsView,
  actions: AiCredentialsActions,
): AiCredentialsSurface {
  const host = document.createElement("div");
  host.style.display = "contents";
  const scope = reactive({ ...derive(view), ...actions }) as AiCredentialsScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = false;

  function mount(): void {
    mounting = true;
    void mountSurface("ai-credentials-form", scope, host).then((mounted) => {
      mounting = false;
      handle = mounted;
    });
  }

  mount();

  return {
    host,
    update(next) {
      Object.assign(scope, derive(next));
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the gate around it
         would empty the field the reader is typing in. The remount below answers the one case
         assignment cannot — a host the document has been taken out of — and it cannot fire while a
         mount is in flight, because a record with no handle yet IS the standing one. */
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
