/// <reference lib="dom" />
/**
 * The Locales settings section, as a mounted document.
 *
 * `settings/locales-section.ts` is the flow — it reads `project.json`, decides what a tag may be
 * and writes the `i18n` block — and this is the surface it draws into: the reactive scope the
 * document reads, the flags it discriminates on, and the mount that stays put while the section is
 * redrawn around it.
 *
 * **The scope is the whole re-render.** The lit version rebuilt its template on every keystroke
 * that changed the verdict, and had to say so: "redrawing on every character would push `.value`
 * back into a field the author is typing in". A reactive scope has no such trade — `jx-textfield`
 * never moves the caret for a write equal to what is already there — so the caller refreshes on
 * every edit and the rule that used to guard it is gone rather than transcribed.
 *
 * **Keyed by host, not by module.** Project Settings is a pane document and a pane can be split, so
 * two containers may be showing this section at once; a single module-level mount would take the
 * first one's surface away from it the moment the second drew. That is the same reason the flow
 * keeps its pending tag and its parked error per container.
 *
 * @docs studio/projects/settings
 */

import { reactive } from "../reactivity";
import { mountSurface, registerSurface } from "../ui/surface";
import localesDoc from "./settings-locales.json";
import type { SurfaceHandle } from "../ui/surface";
import type { JxDocument } from "@jxsuite/schema/types";

registerSurface("settings-locales", localesDoc as unknown as JxDocument);

/** One declared language: the tag as the author wrote it, and the name that language calls itself. */
export interface LocaleRow {
  tag: string;
  label: string;
}

/** One row of a picker. */
export interface LocaleChoice {
  value: string;
  label: string;
}

/** What the section shows — the flow's projection of `project.json` and of the form beside it. */
export interface LocalesView {
  locales: LocaleRow[];
  localeOptions: LocaleChoice[];
  routings: LocaleChoice[];
  defaultLocale: string;
  routing: string;
  /** The tag being typed, kept so an outside redraw does not take it away. */
  pending: string;
  /** Why the pending tag cannot be added, or `""` when it can. */
  refusal: string;
  /** What the last write failed with, or `""`. */
  error: string;
}

/** Everything the reader can do here. Each one is a write the flow decides and makes. */
export interface LocalesActions {
  add: () => void;
  remove: (tag: string) => void;
  edit: (value: string) => void;
  chooseDefault: (value: string) => void;
  chooseRouting: (value: string) => void;
}

/** What the document discriminates on. Derived here, so the flow never has to spell it. */
interface LocalesFlags {
  /**
   * Which list to draw, as a `$switch` discriminant: the rows, or the sentence saying there are
   * none. A list that simply rendered empty says nothing, and this is the one section where "no
   * languages" is the ordinary state of a monolingual project rather than a failure.
   */
  listState: "empty" | "listed";
  /** Both pickers are disabled with nothing to pick — the empty case, said to the controls. */
  noLocales: boolean;
  /** The tag field's own refusal state, beside the sentence it draws under itself. */
  invalid: boolean;
  hasError: boolean;
}

interface LocalesScope extends Record<string, unknown>, LocalesView, LocalesActions, LocalesFlags {}

interface Mounted {
  scope: LocalesScope;
  /** `null` while the mount is still in flight — which is a standing surface, not a missing one. */
  handle: SurfaceHandle | null;
}

const mounts = new WeakMap<HTMLElement, Mounted>();

/** The view plus the flags the document switches on. */
function derive(view: LocalesView): LocalesView & LocalesFlags {
  return {
    ...view,
    hasError: view.error !== "",
    invalid: view.refusal !== "",
    listState: view.locales.length === 0 ? "empty" : "listed",
    noLocales: view.locales.length === 0,
  };
}

/**
 * Draw the section into `host`, or bring the one already there up to date.
 *
 * A mount whose root has left the document is remade; one still standing is only assigned to, which
 * is what makes an edit reconcile the row that changed instead of rebuilding the form under the
 * reader's caret.
 *
 * @param {HTMLElement} host The section container the registry handed the renderer.
 * @param {LocalesView} view What to show.
 * @param {LocalesActions} actions What the reader may do — read once, when the surface is mounted.
 */
export function renderLocalesSurface(
  host: HTMLElement,
  view: LocalesView,
  actions: LocalesActions,
): void {
  const existing = mounts.get(host);
  if (existing && (existing.handle === null || existing.handle.root.isConnected)) {
    Object.assign(existing.scope, derive(view));
    return;
  }
  existing?.handle?.dispose();
  host.textContent = "";
  const scope = reactive({ ...derive(view), ...actions }) as LocalesScope;
  const record: Mounted = { handle: null, scope };
  mounts.set(host, record);
  /* No race to arbitrate: a redraw arriving while this is in flight takes the branch above — a
     record with no handle yet IS the standing one — so a second mount into the same host cannot
     start before this settles. The previous handle, when there was one, was disposed a few lines
     up; that is the only mount this surface ever has to take down. */
  void mountSurface("settings-locales", scope, host).then((handle) => {
    record.handle = handle;
  });
}
