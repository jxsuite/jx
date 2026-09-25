/// <reference lib="dom" />
/**
 * The `secret` form control as a mounted document.
 *
 * `ui/form-controls.ts` is the flow — it knows whether the host has a secret store, what the field
 * already names, what a commit sends there and what the field persists afterwards — and this is the
 * surface it draws into (`surfaces/secret-field.json`). The host belongs to the CALLER: a
 * registered control is drawn into the empty `[part="control-host"]` that
 * `surfaces/schema-form.json` already announces for its field, so there is a container to mount
 * into and no wrapper of our own.
 *
 * **Clearing the field is a scope MOVE, not a write to the element.** The lit control assigned
 * `target.value = ""` from inside its own change handler, which `specs/ui.md` §2 rule 5 forbids a
 * surface from doing at all. A document's binding writes only when the scope value CHANGES, and the
 * scope holds the empty string before the commit and after it — so an assignment of `""` is a no-op
 * and the secret stays in the field. {@link SecretFieldSurface.clear} therefore moves `shown` to a
 * value that is neither the secret nor the empty string and then back, which is two changes and so
 * two writes, the second of which empties the control.
 *
 * The value that stands in the middle is a SPACE rather than what the reader typed, and that is the
 * point rather than a detail: the secret never enters the scope, so a bounce that somehow lost its
 * second half would leave a space in the field instead of the credential.
 *
 * @docs studio/data/auth-and-secrets
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import secretDoc from "./secret-field.json";

import type { JxDocument } from "@jxsuite/schema/types";
import type { SurfaceHandle } from "../ui/surface";

registerSurface("secret-field", secretDoc as unknown as JxDocument);

/** What the field says right now. Every field is the flow's, never a state it derives. */
export interface SecretFieldView {
  /** The accessible name — the field's own label, since the control is a bare box. */
  label: string;
  /**
   * Where the secret lives, or that it does not live anywhere yet.
   *
   * The only thing on screen that describes the value, and it names the ENV VAR rather than the
   * credential: `Stored as MAIN_URL`, or `Not set`.
   */
  placeholder: string;
  /** True where the host has no secret store, and so nowhere to put what is typed. */
  disabled: boolean;
}

/** The one thing the reader can do here. */
export interface SecretFieldActions {
  /** The reader committed a value. What it is worth is the flow's decision entirely. */
  commit: (value: string) => void;
}

export interface SecretFieldSurfaceHandle {
  /** The container the document was mounted into — the form's own control host. */
  host: HTMLElement;
  /** Resolves with the document's root once it has rendered. */
  ready: Promise<HTMLElement>;
  update: (view: SecretFieldView) => void;
  /** Empty the field, whatever it is holding. See the header for why it takes two writes. */
  clear: () => void;
  dispose: () => void;
}

interface SecretScope extends Record<string, unknown>, SecretFieldView, SecretFieldActions {
  /**
   * What the field's value is bound to, and the whole of the "never render a secret back" rule.
   *
   * It is the empty string at rest and holds a single space for the length of one synchronous
   * bounce; nothing else is ever assigned to it.
   */
  shown: string;
}

/** What a freshly mounted field says: no store named, and nothing to say about the value. */
function emptyView(): SecretFieldView {
  return { disabled: true, label: "", placeholder: "Not set" };
}

/**
 * Mount the secret field into `host`, wired to `actions`.
 *
 * @param {HTMLElement} host - The form's `[part="control-host"]` for this field
 * @param {SecretFieldActions} actions - What a committed value does
 * @returns {SecretFieldSurfaceHandle}
 */
export function mountSecretFieldSurface(
  host: HTMLElement,
  actions: SecretFieldActions,
): SecretFieldSurfaceHandle {
  host.textContent = "";
  const scope = reactive<SecretScope>({ ...emptyView(), ...actions, shown: "" }) as SecretScope;

  /** `null` while a mount is in flight — which is a standing surface, not a missing one. */
  let handle: SurfaceHandle | null = null;
  let mounting = true;
  let disposed = false;

  const mount = (): Promise<HTMLElement> =>
    mountSurface("secret-field", scope, host).then((mounted) => {
      mounting = false;
      if (disposed) {
        mounted.dispose();
        return mounted.root as HTMLElement;
      }
      handle = mounted;
      return mounted.root as HTMLElement;
    });

  const ready = mount();

  return {
    clear() {
      scope.shown = " ";
      scope.shown = "";
    },
    dispose() {
      disposed = true;
      handle?.dispose();
      handle = null;
      host.textContent = "";
    },
    host,
    ready,
    update(view) {
      scope.disabled = view.disabled;
      scope.label = view.label;
      scope.placeholder = view.placeholder;
      /* A standing mount is only ASSIGNED to: rebuilding it on every repaint of the form around it
         would empty the field the reader is typing in. The remount below answers the one case
         assignment cannot — a host the document has been taken out of — and it cannot fire while a
         mount is in flight, because a record with no handle yet IS the standing one. */
      if (disposed || mounting || (handle !== null && host.contains(handle.root))) {
        return;
      }
      handle?.dispose();
      handle = null;
      mounting = true;
      host.textContent = "";
      void mount();
    },
  };
}
