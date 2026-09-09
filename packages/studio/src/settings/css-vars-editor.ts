/// <reference lib="dom" />
/**
 * The design-token editor — the token half of **Project Styles** (plan §9.4).
 *
 * Every token in the project's root `style` block, grouped by what it names, each editable in place
 * and each able to carry a different value in any **rendering context** the project declares. The
 * model — groups, tokens, contexts, overrides — lives in {@link file://../style/project-styles.ts}
 * so the catalogue, the canvas and this form all read the same vocabulary; this module is the form
 * over it.
 *
 * **The markup left.** The section is the `settings-css-vars` surface
 * (`surfaces/settings-css-vars.json`), mounted by `surfaces/settings-css-vars.ts`; what is here is
 * the part that was always this module's — what a row shows, what an edit writes, and what a failed
 * write says. `renderCssVarsEditor` is unchanged as a contract: the registry hands a container to a
 * `render`, and this one mounts a document into it instead of rendering lit.
 *
 * Three things it does NOT do, each on purpose:
 *
 * - **It does not define a context.** Breakpoints and colour schemes are declared once, in Project
 *   Settings › Contexts, and this level only overrides against them (§2 principle 5). Where nothing
 *   is declared it says so and routes there.
 * - **It does not change the file format.** Overrides are the same `"@--ctx": { "--token": … }`
 *   blocks the compiler already reads, and an emptied block is removed rather than left behind.
 * - **It does not re-render the canvas.** An edit is pushed to every live canvas in place through
 *   {@link pushProjectStylesToCanvas} — which is what makes "tune a token and watch the page
 *   change" true of the specimen canvas as well as the page one.
 */

import { errorMessage } from "@jxsuite/schema/parse";
import { notify } from "../services/notify";
import { projectState } from "../store";
import { getEffectiveMedia, updateSiteConfig } from "../site-context";
import {
  TOKEN_GROUPS,
  addableContexts,
  groupTokens,
  listTokenContexts,
  readTokenOverride,
  tokenLabel,
  writeTokenOverride,
} from "../style/project-styles";
import { resolveTokenValue, toTokenRef, tokenRefName } from "../style/token-ref";
import { pushProjectStylesToCanvas } from "../style/live-preview";
import { renderCssVarsSurface } from "../surfaces/settings-css-vars";
import { friendlyNameToVar } from "../utils/studio-utils";

import type { JxStyle, ProjectConfig } from "@jxsuite/schema/types";
import type { ProjectToken, TokenContext, TokenGroup, TokenGroupId } from "../style/project-styles";
import type {
  CssVarsActions,
  CssVarsView,
  GroupView,
  OverrideRowView,
  TokenRowView,
} from "../surfaces/settings-css-vars";

/**
 * What each group's add row hints with — an example friendly name and an example value. These are
 * the form's illustrations, not the model's data: they teach the shape of an answer and are never
 * written anywhere.
 */
const ADD_ROW_HINTS: Readonly<Record<TokenGroupId, { name: string; value: string }>> = {
  color: { name: "Primary Blue", value: "#3b82f6" },
  font: { name: "Body Serif", value: "'Georgia', serif" },
  other: { name: "Custom Var", value: "value" },
  size: { name: "Spacing Large", value: "32px" },
};

/** The colour a `<input type="color">` shows when the token's value is not a hex literal. */
const COLOR_INPUT_FALLBACK = "#3b82f6";

/** The same, for an override row: a scheme override is usually a darker value than the base. */
const OVERRIDE_INPUT_FALLBACK = "#111111";

/** The picker's own first row: what it reads while nothing has been picked. */
const ADD_OVERRIDE_ROW = { label: "Add override…", value: "" };

/**
 * The add row being typed into, per group, and the last write that failed.
 *
 * Keyed by container so two mounted copies (and two tests) never share either — the same shape
 * `general-settings.ts` and `locales-section.ts` use, and for the same reason: this section saves
 * on change, so a silent rejection reads as "my edit just vanished". The pending add row is here
 * rather than in the document because typing must survive the section being redrawn from outside;
 * its predecessor held the two values in the DOM through `ref()`, which meant every redraw emptied
 * them and the reader lost half a token name to a nav click they did not make.
 */
interface Form {
  add: Partial<Record<TokenGroupId, { name: string; value: string }>>;
  error: string;
}

const forms = new WeakMap<HTMLElement, Form>();

/** This container's form, minted on first sight. */
function form(container: HTMLElement): Form {
  let state = forms.get(container);
  if (!state) {
    state = { add: {}, error: "" };
    forms.set(container, state);
  }
  return state;
}

/** This container's pending add row for one group, minted on first sight. */
function pending(container: HTMLElement, group: TokenGroupId): { name: string; value: string } {
  const { add } = form(container);
  return (add[group] ??= { name: "", value: "" });
}

/** The live project configuration, or an empty one before a project is open. */
function config(): ProjectConfig {
  return (projectState?.projectConfig || {}) as ProjectConfig;
}

/**
 * The project's root style block, mutated IN PLACE and then persisted whole.
 *
 * The `{}` fallback is a throwaway for a project that declares no styles at all: the first token
 * added to one reaches disk through the patch below and comes back on the refresh that follows the
 * write, because there is no object here for it to have been written into.
 */
function style(): JxStyle {
  return (config().style || {}) as JxStyle;
}

/** Every rendering context this project declares, schemes first. */
function contexts(): TokenContext[] {
  return listTokenContexts(getEffectiveMedia(config().$media));
}

/**
 * Push the mutated style at the canvases, show it, and write it — in that order.
 *
 * The canvas and the form are updated synchronously because the edit is already true of the model;
 * the write is awaited only so that its REJECTION has somewhere to land. The predecessor dropped it
 * with a bare `void`, so a read-only `project.json` took every edit and kept none of them without
 * ever saying so.
 *
 * @param {HTMLElement} container
 */
function commit(container: HTMLElement): void {
  pushProjectStylesToCanvas();
  refresh(container);
  void persist(container);
}

/** @param {HTMLElement} container */
async function persist(container: HTMLElement): Promise<void> {
  try {
    await updateSiteConfig({ style: { ...style() } });
    form(container).error = "";
  } catch (error) {
    form(container).error = `Could not save project.json — ${errorMessage(error)}`;
  }
  refresh(container);
}

// ─── Projection ──────────────────────────────────────────────────────────────

/** The colour a well is painted, and the colour the native input under it opens on. */
function well(
  resolved: string | number | undefined,
  fallback: string,
): { swatchBg: string; swatchInput: string } {
  const swatchBg = resolved === undefined ? "transparent" : String(resolved);
  return { swatchBg, swatchInput: swatchBg.startsWith("#") ? swatchBg : fallback };
}

/**
 * One override row: what this token is in one context, and what an edit to it names.
 *
 * The row carries its token AND its context because the document's inner `$map` shadows the outer
 * one — a row cannot ask which token it hangs under, so it is told.
 *
 * @param {ProjectToken} token
 * @param {TokenContext} context
 * @param {boolean} isColor
 * @param {JxStyle} rootStyle
 * @returns {OverrideRowView}
 */
function overrideRow(
  token: ProjectToken,
  context: TokenContext,
  isColor: boolean,
  rootStyle: JxStyle,
): OverrideRowView {
  const current = readTokenOverride(rootStyle, context, token.name);
  return {
    ctx: context.name,
    fieldLabel: `${token.label} in ${context.label}`,
    id: `${token.name} ${context.name}`,
    kind: context.kind,
    label: context.label,
    swatchLabel: `${token.label} in ${context.label}`,
    swatchState: isColor ? "swatch" : "none",
    token: token.name,
    value: current === undefined ? "" : String(current),
    ...well(resolveTokenValue(rootStyle, current), OVERRIDE_INPUT_FALLBACK),
  };
}

/**
 * One token row: its value, the chip it wears when that value follows another token, its font
 * preview, its per-context values and the contexts it could still be given one in.
 *
 * A colour's scheme rows are shown whether or not they carry a value, because "what is this colour
 * in dark mode" is a question a palette is always answering. A token with no value is offered no
 * picker: writing an empty override is how one is CLEARED, so the affordance would be inert.
 *
 * @param {ProjectToken} token
 * @param {TokenGroup} group
 * @param {JxStyle} rootStyle
 * @param {TokenContext[]} declared
 * @returns {TokenRowView}
 */
function tokenRow(
  token: ProjectToken,
  group: TokenGroup,
  rootStyle: JxStyle,
  declared: TokenContext[],
): TokenRowView {
  const isColor = group.id === "color";
  const value = String(token.value);
  const resolved = resolveTokenValue(rootStyle, token.value);
  const refName = tokenRefName(token.value);
  const shown = declared.filter(
    (context) =>
      (isColor && context.kind === "scheme") ||
      readTokenOverride(rootStyle, context, token.name) !== undefined,
  );
  const addable = value === "" ? [] : addableContexts(rootStyle, declared, token.name, shown);
  return {
    addLabel: `Add an override for ${token.label}`,
    addOptions: [ADD_OVERRIDE_ROW, ...addable.map((c) => ({ label: c.label, value: c.name }))],
    addPick: "",
    addState: addable.length === 0 ? "none" : "shown",
    chipLabel: refName === null ? "" : tokenLabel(refName),
    chipState: refName === null ? "none" : isColor && resolved !== undefined ? "swatch" : "plain",
    chipSwatch: resolved === undefined ? "" : String(resolved),
    chipTitle:
      refName === null
        ? ""
        : `${toTokenRef(refName)} → ${resolved === undefined ? "unresolved" : String(resolved)}`,
    label: token.label,
    name: token.name,
    overrides: shown.map((context) => overrideRow(token, context, isColor, rootStyle)),
    overrideState: shown.length === 0 && addable.length === 0 ? "none" : "shown",
    previewFont: group.id === "font" ? value : "",
    previewState: group.id === "font" ? "font" : "none",
    removeLabel: `Delete ${token.label}`,
    swatchLabel: `${token.label} colour`,
    swatchState: isColor ? "swatch" : "none",
    value,
    ...well(isColor ? resolved : undefined, COLOR_INPUT_FALLBACK),
  };
}

/**
 * What the section shows right now.
 *
 * Read from `config()` at the moment of drawing rather than carried from the last one:
 * `projectState` is a plain module binding replaced wholesale on a project switch, and an extension
 * or the raw JSON editor can write `style` between two of these.
 *
 * @param {HTMLElement} container
 * @returns {CssVarsView}
 */
function view(container: HTMLElement): CssVarsView {
  const rootStyle = style();
  const declared = contexts();
  const hasScheme = declared.some((context) => context.kind === "scheme");
  const groups: GroupView[] = [];
  for (const { group, tokens } of groupTokens(rootStyle)) {
    /* A bucket named "Other" over an empty list teaches nothing (§2 principle 6). Every other
       group keeps its heading and its add row, because an empty one is where a palette starts. */
    if (group.id === "other" && tokens.length === 0) {
      continue;
    }
    const draft = pending(container, group.id);
    groups.push({
      addLabel: `Add a ${group.title} variable`,
      addName: draft.name,
      addValue: draft.value,
      id: group.id,
      nameHint: ADD_ROW_HINTS[group.id].name,
      nameLabel: `New ${group.title} name`,
      noticeState: group.id === "color" && !hasScheme ? "shown" : "none",
      title: group.title,
      tokens: tokens.map((token) => tokenRow(token, group, rootStyle, declared)),
      valueHint: ADD_ROW_HINTS[group.id].value,
      valueLabel: `New ${group.title} value`,
    });
  }
  return { error: form(container).error, groups };
}

/** Re-read the file and the form, and let the surface reconcile. */
function refresh(container: HTMLElement): void {
  renderCssVarsSurface(container, view(container), actions(container));
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** The group a token can be added to, by id. */
function groupOf(id: string): TokenGroup | undefined {
  return TOKEN_GROUPS.find((group) => group.id === id);
}

/** Add the group's pending token, if it names one this project can take. */
function addToken(container: HTMLElement, groupId: string): void {
  const group = groupOf(groupId);
  if (!group) {
    return;
  }
  const draft = pending(container, group.id);
  const varName = friendlyNameToVar(draft.name, group.prefix);
  if (!varName || !draft.value) {
    return;
  }
  style()[varName] = draft.value;
  draft.name = "";
  draft.value = "";
  commit(container);
}

/**
 * Give a token a value in a context it has none in, seeded from its base value.
 *
 * A name the picker did not offer is ignored rather than written: the control's first row is the
 * placeholder, whose value is the empty string, and a context that already carries an override is
 * not a context this can create one in.
 *
 * @param {HTMLElement} container
 * @param {string} token
 * @param {string} ctx
 */
function addOverride(container: HTMLElement, token: string, ctx: string): void {
  const rootStyle = style();
  const context = contexts().find((c) => c.name === ctx);
  if (!context || readTokenOverride(rootStyle, context, token) !== undefined) {
    refresh(container);
    return;
  }
  const base = rootStyle[token];
  if (typeof base !== "string" && typeof base !== "number") {
    return;
  }
  writeTokenOverride(rootStyle, context, token, String(base));
  commit(container);
}

/**
 * What the reader may do, bound to one container.
 *
 * Memoized per container so the surface is handed the same functions every time: they are read
 * once, when it mounts, and a fresh set on every refresh would be a scope write that says nothing.
 */
const bound = new WeakMap<HTMLElement, CssVarsActions>();

function actions(container: HTMLElement): CssVarsActions {
  let acts = bound.get(container);
  if (!acts) {
    acts = {
      addOverride: (token: string, ctx: string) => {
        addOverride(container, token, ctx);
      },
      addToken: (groupId: string) => {
        addToken(container, groupId);
      },
      /*
       * Without a declared scheme query there is nothing to override, so this section can only
       * point at the place a scheme is DEFINED. It used to define one itself — a button here
       * appended `'--dark': '(prefers-color-scheme: dark)'` to `$media` without ever using the word
       * breakpoint, which made this form the fourth and least discoverable definition site for a
       * map whose other three lived in the wizard, Overview and Properties › Media. The lazy import
       * breaks the css-vars-editor ↔ section-registry cycle.
       */
      manageContexts: () => {
        void import("./section-registry")
          .then(({ setSettingsSection }) => setSettingsSection("contexts"))
          .catch((error: unknown) => {
            notify.error(`Could not open Settings › Contexts — ${errorMessage(error)}`, {
              source: "Settings",
            });
          });
      },
      removeToken: (name: string) => {
        delete style()[name];
        commit(container);
      },
      /*
       * Recorded, and nothing redrawn. The field already holds what the reader typed — a refresh
       * here would re-derive every group, every token and every override row to write each control
       * the value it already has, once per keystroke. What the record buys is the redraw the reader
       * did NOT ask for: a nav click, an extension registering, a write landing. The projection
       * reads it, so the half-typed name comes back rather than being emptied, which is what the
       * predecessor's `ref()` into the DOM could never do.
       */
      setAddName: (groupId: string, value: string) => {
        pending(container, groupId as TokenGroupId).name = value;
      },
      setAddValue: (groupId: string, value: string) => {
        pending(container, groupId as TokenGroupId).value = value;
      },
      setOverride: (token: string, ctx: string, value: string) => {
        const context = contexts().find((c) => c.name === ctx);
        if (!context) {
          return;
        }
        /* The block is recreated on demand, so a caller holding a stale row still writes to the
           right place — and an emptied block is removed rather than left as `"@--dark": {}`. */
        writeTokenOverride(style(), context, token, value);
        commit(container);
      },
      setToken: (name: string, value: string) => {
        style()[name] = value;
        commit(container);
      },
    };
    bound.set(container, acts);
  }
  return acts;
}

/**
 * The project's design tokens, grouped, with their per-context values.
 *
 * @param {HTMLElement} container
 */
export function renderCssVarsEditor(container: HTMLElement): void {
  refresh(container);
}
