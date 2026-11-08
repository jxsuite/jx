/// <reference lib="dom" />
/**
 * The design-token editor — the token half of **Project Styles** (§7.1).
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
 * write says. `renderCssVarsEditor` is unchanged as a contract: it is handed a container and mounts
 * a document into it instead of rendering lit.
 *
 * **Its host is the Styles workspace's Variables view** (`style/variables-view.ts`, §7.1), the
 * `tokens` editor of the `project.json` tab. It was Project Settings › CSS Variables, and its
 * persistence did not change with the move: an edit is committed through the configuration
 * chokepoint (`updateSiteConfig` → `commitProjectConfig`) as it is made, which writes the whole
 * document, so an element style edit the Elements view left unsaved on the same tab is written too
 * and the tab comes back clean. The view says so in as many words, rather than letting the Save
 * button's state be the first the author hears of it.
 *
 * Three things it does NOT do, each on purpose:
 *
 * - **It does not define a context.** Breakpoints and colour schemes are declared once, in Project
 *   Settings › Contexts, and this level only overrides against them (§6.2). Where nothing is
 *   declared it says so and routes there.
 * - **It does not change the file format.** Overrides are the same `"@--ctx": { "--token": … }`
 *   blocks the compiler already reads, and an emptied block is removed rather than left behind.
 * - **It does not re-render the canvas.** An edit is pushed to every live canvas in place through
 *   {@link pushProjectStylesToCanvas} — which is what makes "tune a token and watch the page
 *   change" true of the specimen canvas as well as the page one.
 */

import { projectConfigPath } from "../tabs/tab";
import { isJsonObject, isNumber, isString } from "@jxsuite/schema/guards";
import { errorMessage } from "@jxsuite/schema/parse";
import { runActiveReported } from "../commands/run-reported";
import { projectState } from "../store";
import { getEffectiveMedia, updateSiteConfig } from "../site-context";
import {
  TOKEN_GROUPS,
  addableContexts,
  groupTokens,
  listTokenContexts,
  readTokenOverride,
  writeTokenOverride,
} from "../style/project-styles";
import { resolveTokenValue, toTokenRef, tokenRefName } from "../style/token-ref";
import { pushProjectStylesToCanvas } from "../style/live-preview";
import {
  renderCssVarsSurface,
  revealCssVarsGroup,
  revealCssVarsToken,
} from "../surfaces/settings-css-vars";
import { camelToLabel, friendlyNameToVar } from "../utils/studio-utils";
import { contrastRatio, parseColor } from "@jxsuite/ui/color";

import type { JxStyle, ProjectConfig } from "@jxsuite/schema/types";
import type { ProjectToken, TokenContext, TokenGroup, TokenGroupId } from "../style/project-styles";
import type {
  CssVarsActions,
  CssVarsView,
  GroupView,
  OverrideRowView,
  TokenDetailView,
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
  /** The token the Outline pointed this editor at ({@link focusCssVar}), or `null`. */
  current: string | null;
  /** The colour scheme the swatches show (its `$media` name), or `""` for the base values. */
  scheme: string;
}

const forms = new WeakMap<HTMLElement, Form>();

/** This container's form, minted on first sight. */
function form(container: HTMLElement): Form {
  let state = forms.get(container);
  if (!state) {
    state = { add: {}, current: null, error: "", scheme: "" };
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
  return projectState?.projectConfig || {};
}

/**
 * The project's root style block, mutated IN PLACE and then persisted whole.
 *
 * The `{}` fallback is a throwaway for a project that declares no styles at all: the first token
 * added to one reaches disk through the patch below and comes back on the refresh that follows the
 * write, because there is no object here for it to have been written into.
 */
function style(): JxStyle {
  return config().style || {};
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
    form(container).error = `Could not save ${projectConfigPath()} — ${errorMessage(error)}`;
  }
  refresh(container);
}

// ─── Projection ──────────────────────────────────────────────────────────────

/** The colour a well is painted, and the colour the native input under it opens on. */
interface SwatchWell {
  /** The resolved value as a CSS background, or `transparent` when the token resolves to nothing. */
  swatchBg: string;
  /**
   * What the native colour input opens on: the background when it is a hex colour, else the
   * fallback.
   */
  swatchInput: string;
}

/** Paint one well from what the token resolves to. */
function well(resolved: string | number | undefined, fallback: string): SwatchWell {
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
    fieldLabel: `${token.name} in ${context.label}`,
    id: `${token.name} ${context.name}`,
    kind: context.kind,
    label: context.label,
    swatchLabel: `${token.name} in ${context.label}`,
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
 * A row is NAMED by its custom property, `--color-accent`, never by a friendly rewording of it: the
 * Outline beside the view lists the same `--name`, a `var()` reference spells it, and it is what
 * CSS reads. The same goes for a reference chip, which names the property the value follows.
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
  current: string | null,
  scheme: TokenContext | null = null,
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
    addLabel: `Add an override for ${token.name}`,
    addOptions: [ADD_OVERRIDE_ROW, ...addable.map((c) => ({ label: c.label, value: c.name }))],
    addPick: "",
    addState: addable.length === 0 ? "none" : "shown",
    chipLabel: refName ?? "",
    chipState: refName === null ? "none" : isColor && resolved !== undefined ? "swatch" : "plain",
    chipSwatch: resolved === undefined ? "" : String(resolved),
    chipTitle:
      refName === null
        ? ""
        : `${toTokenRef(refName)} → ${resolved === undefined ? "unresolved" : String(resolved)}`,
    current: token.name === current,
    currentFlag: token.name === current ? "true" : "false",
    label: token.name,
    name: token.name,
    overrides: shown.map((context) => overrideRow(token, context, isColor, rootStyle)),
    overrideState: shown.length === 0 && addable.length === 0 ? "none" : "shown",
    previewFont: group.id === "font" ? value : "",
    previewState: group.id === "font" ? "font" : "none",
    removeLabel: `Delete ${token.name}`,
    swatchLabel: `${token.name} color`,
    swatchState: isColor ? "swatch" : "none",
    ...tileOf(rootStyle, token, scheme),
    value,
    ...well(isColor ? resolved : undefined, COLOR_INPUT_FALLBACK),
  };
}

/** A token's value in `scheme`: its override there, else its base value. */
function shownValue(rootStyle: JxStyle, token: ProjectToken, scheme: TokenContext | null): string {
  const override = scheme ? readTokenOverride(rootStyle, scheme, token.name) : undefined;
  return String(override ?? token.value);
}

/** A colour tile's swatch and caption: the token's value in the scheme the swatches show. */
function tileOf(
  rootStyle: JxStyle,
  token: ProjectToken,
  scheme: TokenContext | null,
): Pick<TokenRowView, "tileBg" | "tileValue"> {
  const value = shownValue(rootStyle, token, scheme);
  const resolved = resolveTokenValue(rootStyle, value);
  return { tileBg: resolved === undefined ? "transparent" : String(resolved), tileValue: value };
}

// ─── The chosen colour ───────────────────────────────────────────────────────

/** What a colour's name says it is, when the page does not say which it uses. */
const BACKGROUND_NAME = /(?:^|-)(?:background|bg|paper|canvas|surface)(?:-|$)/u;
const TEXT_NAME = /(?:^|-)(?:text|ink|fg|foreground)(?:-|$)/u;

/** The variable a root declaration reads, when the whole value is one `var()`. */
function rootVar(rootStyle: JxStyle, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = rootStyle[key];
    const name = isString(value) || isNumber(value) ? tokenRefName(value) : null;
    if (name !== null) {
      return name;
    }
  }
  return null;
}

/**
 * What a colour is read against: the page's own background (the variable the root style's
 * `backgroundColor` reads), or, for that background itself, the page's text colour. A palette whose
 * page names neither falls back to the colours named for them (a dark variant is never the page).
 * Null when there is nothing to read it against.
 */
function counterpart(
  rootStyle: JxStyle,
  tokens: readonly ProjectToken[],
  name: string,
): ProjectToken | null {
  const named = (wanted: string | null) => tokens.find((token) => token.name === wanted) ?? null;
  const guess = (pattern: RegExp) =>
    tokens.find((token) => pattern.test(token.name) && !token.name.includes("dark")) ?? null;
  const background =
    named(rootVar(rootStyle, "backgroundColor", "background")) ?? guess(BACKGROUND_NAME);
  if (background && background.name !== name) {
    return background;
  }
  const text = named(rootVar(rootStyle, "color")) ?? guess(TEXT_NAME);
  return text && text.name !== name ? text : null;
}

/**
 * How one colour reads against another, as the detail says it: the WCAG 2 contrast ratio and what
 * it passes. `none` when either value is not a colour that can be read (a `var()` that resolves to
 * nothing, a gradient, a keyword the parser does not know).
 */
export function contrastLine(
  value: string | number | undefined,
  against: string | number | undefined,
  againstName: string,
): Pick<TokenDetailView, "contrast" | "contrastIcon" | "contrastState"> {
  const one = value === undefined ? null : parseColor(String(value));
  const two = against === undefined ? null : parseColor(String(against));
  if (!one || !two) {
    return { contrast: "", contrastIcon: "check", contrastState: "none" };
  }
  const ratio = contrastRatio(one, two);
  const shown = `${(Math.floor(ratio * 10) / 10).toFixed(1)}:1 on ${againstName}`;
  if (ratio >= 4.5) {
    return { contrast: `${shown}, passes AA`, contrastIcon: "check", contrastState: "pass" };
  }
  if (ratio >= 3) {
    return {
      contrast: `${shown}, passes AA for large text only`,
      contrastIcon: "warning-circle",
      contrastState: "fail",
    };
  }
  return { contrast: `${shown}, fails AA`, contrastIcon: "warning-circle", contrastState: "fail" };
}

/**
 * The style rules in the project's root style block that read a variable: "a, button, h1". Only the
 * project's own styles are read, since that is the one block this editor owns; a page or a
 * component may use it as well.
 */
export function usedBy(rootStyle: JxStyle, name: string): string {
  const needle = `var(${name}`;
  const uses = Object.entries(rootStyle).flatMap(([key, value]) => {
    if (key.startsWith("--") || !JSON.stringify(value ?? "").includes(needle)) {
      return [];
    }
    // A declaration of the root block is the page's own: "the page's background color".
    return [isJsonObject(value) ? key : `the page's ${camelToLabel(key).toLowerCase()}`];
  });
  return uses.length === 0 ? "No rule in the project's styles uses it yet." : uses.join(", ");
}

/** The detail beside the swatches, for the chosen colour in the scheme shown. */
function detailOf(
  token: ProjectToken,
  tokens: readonly ProjectToken[],
  rootStyle: JxStyle,
  row: TokenRowView,
  scheme: TokenContext | null,
): TokenDetailView {
  const value = shownValue(rootStyle, token, scheme);
  const resolved = resolveTokenValue(rootStyle, value);
  const other = counterpart(rootStyle, tokens, token.name);
  const againstValue = other
    ? resolveTokenValue(rootStyle, shownValue(rootStyle, other, scheme))
    : undefined;
  return {
    addLabel: row.addLabel,
    addOptions: row.addOptions,
    addPick: "",
    addState: row.addState,
    fieldLabel: scheme ? `${token.name} in ${scheme.label}` : `${token.name} value`,
    name: token.name,
    overrideState: row.overrideState,
    overrides: row.overrides,
    removeLabel: `Delete ${token.name}`,
    resolved: resolved === undefined ? "" : String(resolved),
    saved: `Saved as the ${token.name} variable in ${projectConfigPath()}`,
    schemeLabel: scheme ? scheme.label : "Base",
    usedBy: usedBy(rootStyle, token.name),
    value,
    ...contrastLine(resolved, againstValue, other?.name ?? ""),
  };
}

/** A radio segment's `checked`, which the kit reads as the string "true" or "false". */
function radioChecked(on: boolean): "true" | "false" {
  return on ? "true" : "false";
}

/** The detail when no colour is chosen: every field present, as the document binds them all. */
const NO_DETAIL: TokenDetailView = {
  addLabel: "",
  addOptions: [],
  addPick: "",
  addState: "none",
  contrast: "",
  contrastIcon: "check",
  contrastState: "none",
  fieldLabel: "",
  name: "",
  overrideState: "none",
  overrides: [],
  removeLabel: "",
  resolved: "",
  saved: "",
  schemeLabel: "",
  usedBy: "",
  value: "",
};

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
  const schemes = declared.filter((context) => context.kind === "scheme");
  const hasScheme = schemes.length > 0;
  const state = form(container);
  const scheme = schemes.find((context) => context.name === state.scheme) ?? null;
  const groups: GroupView[] = [];
  // The chosen colour's detail, which the colour group fills while it draws its swatches.
  const detailed: TokenDetailView[] = [];
  for (const { group, tokens } of groupTokens(rootStyle)) {
    /* A bucket named "Other" over an empty list teaches nothing (`studio-ui-guidelines.md` §11.1).
       Every other group keeps its heading and its add row, because an empty one is where a palette
       starts. */
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
      layout: group.id === "color" ? "tiles" : "rows",
      noticeState: group.id === "color" && !hasScheme ? "shown" : "none",
      schemeState: group.id === "color" && hasScheme ? "shown" : "none",
      title: group.title,
      tokens: rowsOf(group, tokens),
      valueHint: ADD_ROW_HINTS[group.id].value,
      valueLabel: `New ${group.title} value`,
    });
  }
  const [detail] = detailed;
  return {
    detail: detail ?? NO_DETAIL,
    detailState: detail ? "shown" : "none",
    error: state.error,
    groups,
    schemes: [
      { checked: radioChecked(scheme === null), label: "Base", value: "" },
      ...schemes.map((context) => ({
        checked: radioChecked(context === scheme),
        label: context.label,
        value: context.name,
      })),
    ],
  };

  /** A group's rows; for the colours, the chosen one (the current, else the first) is detailed. */
  function rowsOf(group: TokenGroup, tokens: ProjectToken[]): TokenRowView[] {
    if (group.id !== "color") {
      return tokens.map((token) => tokenRow(token, group, rootStyle, declared, state.current));
    }
    const chosen = tokens.find((token) => token.name === state.current) ?? tokens[0];
    return tokens.map((token) => {
      const row = tokenRow(token, group, rootStyle, declared, chosen?.name ?? null, scheme);
      if (token === chosen) {
        detailed.push(detailOf(token, tokens, rootStyle, row, scheme));
      }
      return row;
    });
  }
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
  if (!isString(base) && !isNumber(base)) {
    return;
  }
  writeTokenOverride(rootStyle, context, token, String(base));
  commit(container);
}

/**
 * Open Project Settings on Contexts, where the color schemes and breakpoints this editor overrides
 * per token are defined.
 *
 * Through the command rather than by writing the registry's section: the editor is hosted outside
 * Settings (the Styles workspace's Variables view), so selecting a section of a workspace that is
 * not on screen would change nothing the reader can see. A refusal is filed under "Styles", the
 * workspace the editor lives in, as the Variables view's own button files it.
 */
function openContextsSection(): void {
  void runActiveReported("settings.open", { section: "contexts" }, "Styles");
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
       * map whose other three lived in the wizard, Overview and Properties › Media. It goes there
       * through `settings.open`, so Settings opens on Contexts however this editor is hosted.
       */
      manageContexts: () => {
        openContextsSection();
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
        const group = groupOf(groupId);
        if (group) {
          pending(container, group.id).name = value;
        }
      },
      setAddValue: (groupId: string, value: string) => {
        const group = groupOf(groupId);
        if (group) {
          pending(container, group.id).value = value;
        }
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
      select: (name: string) => {
        form(container).current = name;
        refresh(container);
      },
      setScheme: (scheme: string) => {
        form(container).scheme = scheme;
        refresh(container);
      },
      /* The colour field edits what the swatches show: the base value, or the scheme's override. */
      setShownValue: (name: string, value: string) => {
        const scheme = contexts().find((c) => c.name === form(container).scheme);
        if (scheme) {
          writeTokenOverride(style(), scheme, name, value);
        } else {
          style()[name] = value;
        }
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

/**
 * Point the editor at one token: mark its row, scroll it into view and put the keyboard on its
 * value. What a variable row in the Styles workspace's Outline asks for.
 *
 * A name this project does not declare is still recorded (it may be about to be added, or the
 * Outline may be ahead of a write), and simply marks nothing. The flow only marks the row; bringing
 * it on screen is the surface's (`revealCssVarsToken`), because only the adapter knows where the
 * row it draws is.
 *
 * @param {HTMLElement} container
 * @param {string | null} name A custom property, `--accent`, or `null` to mark none
 * @param {{ reveal?: boolean }} [options] `reveal: false` marks the row without moving the keyboard
 *   or the scroll position
 */
export function focusCssVar(
  container: HTMLElement,
  name: string | null,
  options: { reveal?: boolean } = {},
): void {
  form(container).current = name;
  refresh(container);
  if (name === null || options.reveal === false) {
    return;
  }
  revealCssVarsToken(container, name);
}

/**
 * Point the editor at one group: bring its heading on screen, and with `add` put the keyboard on
 * its Add row, the editor's own way of adding a variable. What a group heading and "Add variable"
 * in the Styles workspace's Styles panel ask for.
 *
 * @param {HTMLElement} container
 * @param {TokenGroupId} group
 * @param {{ add?: boolean }} [options] `add: true` focuses the Add row's name field
 */
export function focusCssVarGroup(
  container: HTMLElement,
  group: TokenGroupId,
  options: { add?: boolean } = {},
): void {
  revealCssVarsGroup(container, group, options.add === true);
}
