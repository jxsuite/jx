/// <reference lib="dom" />
/**
 * The CSS Variables settings section, as a mounted document.
 *
 * `settings/css-vars-editor.ts` is the flow — it reads the project's root style block, decides what
 * an edit writes and pushes the result at every live canvas — and this is the surface it draws
 * into: the reactive scope the document reads, the flags it discriminates on, and the mount that
 * stays put while the section is redrawn around it.
 *
 * **The projection is flattened here, and it has to be.** A `$map` nests, but the inner one SHADOWS
 * `$map/item`, so a row cannot reach the row that contains it — and this section is three levels
 * deep (a group, a token, one of that token's contexts). So every row carries what its own handlers
 * need: an override row names its token AND its context rather than inheriting either. The same
 * rule is what turns the lit template's four derived decisions — is there a swatch, is there a
 * chip, is there a font preview, is there anything under this token at all — into four `$switch`
 * discriminants computed on this side.
 *
 * **The colour well is a native `<input type="color">`,** because the kit has no colour control and
 * inventing one to be photographed is what the screenshot policy forbids. It is the one place a
 * document reaches past the kit, and it reaches for a platform element rather than a Spectrum one.
 *
 * **Keyed by host, not by module.** Project Settings is a pane document and a pane can be split, so
 * two containers may be showing this section at once; a single module-level mount would take the
 * first one's surface away from it the moment the second drew.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import cssVarsDoc from "./settings-css-vars.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("settings-css-vars", cssVarsDoc as unknown as JxDocument);

/** One row of the add-an-override picker. */
export interface OverrideChoice {
  value: string;
  label: string;
}

/** One of a token's per-context values. */
export interface OverrideRowView {
  /** The row's identity: a token and a context, which is the pair that makes it unique. */
  id: string;
  /** The token this overrides — carried because the enclosing `$map` is shadowed here. */
  token: string;
  /** The `$media` entry name the override is written under. */
  ctx: string;
  /** What the reader sees: "Dark" for a scheme, the raw `@--sm` for anything else. */
  label: string;
  /** The current override, or `""` when this context inherits the base value. */
  value: string;
  /** `size`, `scheme` or `feature` — stamped as `data-kind`, never used to decide the row. */
  kind: string;
  /** The field's own accessible name, which the visible label cannot be: it names a whole row. */
  fieldLabel: string;
  /** Whether this row carries a colour well. */
  swatchState: "swatch" | "none";
  swatchBg: string;
  swatchInput: string;
  swatchLabel: string;
}

/** One token: its value, what that value follows, and every context it differs in. */
export interface TokenRowView {
  /** The custom property. The row's key, and every handler's first argument. */
  name: string;
  label: string;
  value: string;
  removeLabel: string;
  swatchState: "swatch" | "none";
  swatchBg: string;
  swatchInput: string;
  swatchLabel: string;
  /**
   * Whether the value is a bare `var()` reference, and whether that reference resolves to a colour
   * worth drawing. Three states rather than a flag and a nested flag: `$switch` is the document's
   * only conditional, so a chip with a swatch and a chip without one are two cases of one
   * question.
   */
  chipState: "none" | "plain" | "swatch";
  chipLabel: string;
  chipTitle: string;
  chipSwatch: string;
  previewState: "none" | "font";
  previewFont: string;
  /** Whether anything at all hangs under this token — a row, a picker, or both. */
  overrideState: "none" | "shown";
  overrides: OverrideRowView[];
  /** Whether the add-an-override picker is offered. */
  addState: "none" | "shown";
  addOptions: OverrideChoice[];
  /** What the picker currently reads. Always `""` in practice — see {@link renderCssVarsSurface}. */
  addPick: string;
  addLabel: string;
}

/** One group of tokens: its heading, its rows, its add row, and what it says about contexts. */
export interface GroupView {
  id: string;
  title: string;
  tokens: TokenRowView[];
  /** The friendly name being typed into the add row, kept so an outside redraw does not take it. */
  addName: string;
  addValue: string;
  nameHint: string;
  valueHint: string;
  nameLabel: string;
  valueLabel: string;
  addLabel: string;
  /**
   * The colour group's "no scheme is declared" sentence, and the way to the level that declares
   * one.
   */
  noticeState: "none" | "shown";
}

/** What the section shows — the flow's projection of the project's root style block. */
export interface CssVarsView {
  groups: GroupView[];
  /** What the last write failed with, or `""`. */
  error: string;
}

/** Everything the reader can do here. Each one is a write the flow decides and makes. */
export interface CssVarsActions {
  setToken: (name: string, value: string) => void;
  removeToken: (name: string) => void;
  setOverride: (token: string, ctx: string, value: string) => void;
  addOverride: (token: string, ctx: string) => void;
  setAddName: (group: string, value: string) => void;
  setAddValue: (group: string, value: string) => void;
  addToken: (group: string) => void;
  manageContexts: () => void;
}

/** What the document discriminates on at the top level. Derived here, so the flow never spells it. */
interface CssVarsFlags {
  hasError: boolean;
}

interface CssVarsScope extends Record<string, unknown>, CssVarsView, CssVarsActions, CssVarsFlags {}

interface Mounted {
  scope: CssVarsScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
}

const mounts = new WeakMap<HTMLElement, Mounted>();

/** The view plus the one flag the document switches on at section level. */
function derive(view: CssVarsView): CssVarsView & CssVarsFlags {
  return { ...view, hasError: view.error !== "" };
}

/**
 * Draw the section into `host`, or bring the one already there up to date.
 *
 * A mount whose root has left the document is remade; one still standing is only assigned to, which
 * is what makes an edit reconcile the row that changed instead of rebuilding the form under the
 * reader's caret.
 *
 * **Every refresh hands in fresh row objects, and that is what makes a control obey the file
 * again.** A binding re-runs when what it read changes; a keyed row's `$map.item` IS what it read,
 * so a new object per refresh re-runs every binding in the row, and the runtime then skips each
 * write the live element already agrees with. That is `live()`, rebuilt out of the two rules the
 * runtime already has — and it is what puts the add-an-override picker back on its placeholder
 * after a pick, and what would snap a refused value back into its field.
 *
 * @param {HTMLElement} host The section container the registry handed the renderer.
 * @param {CssVarsView} view What to show.
 * @param {CssVarsActions} actions What the reader may do — read once, when the surface is mounted.
 */
export function renderCssVarsSurface(
  host: HTMLElement,
  view: CssVarsView,
  actions: CssVarsActions,
): void {
  const existing = mounts.get(host);
  if (existing && (existing.handle === null || existing.handle.root.isConnected)) {
    Object.assign(existing.scope, derive(view));
    return;
  }
  existing?.handle?.dispose();
  host.textContent = "";
  const scope = reactive({ ...derive(view), ...actions }) as CssVarsScope;
  const record: Mounted = { handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a redraw arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. The previous handle, when there was one, was disposed a few lines
     up; that is the only mount this surface ever has to take down. */
  void mountSurface("settings-css-vars", scope, host).then((handle) => {
    record.handle = handle;
  });
}
