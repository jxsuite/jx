/// <reference lib="dom" />
/**
 * The Styles panel — the Styles workspace's Navigator panel (`specs/studio.md` §7.1).
 *
 * The Styles workspace edits the project's styles in `project.json`, and this panel is the map of
 * them, in the order a visit usually needs it:
 *
 * - **Variables.** Every CSS custom property in the root style block, by its real name, grouped as
 *   the Variables view groups them (`style/project-styles.ts` `groupTokens`: Colors, Fonts, Sizes &
 *   Spacing, and Other only when something is in it), each group with its count and each colour
 *   with a swatch of what it resolves to. A group heading or a property switches the pane to the
 *   Variables view and brings it on screen there (`style/variables-focus.ts`); **Add variable**
 *   focuses the view's own add row, so a variable is added the one way the editor adds one.
 * - **Elements.** The element defaults, by tag name: the specimen catalogue's tags
 *   (`data/stylebook-meta.json`) and the project's components, a dot on each tag project.json
 *   already styles. A row switches the pane to the Elements view and selects the tag there
 *   (`selectStylebookTag`), with the Inspector open on Element › Style.
 * - **Color schemes.** The schemes `$media` declares (`listTokenContexts`), and **Manage color
 *   schemes…**, which opens Project Settings › Contexts, where they are defined.
 *
 * It replaces the Outline as the Styles workspace's Navigator. The Outline still lists the element
 * catalogue beside a document's Elements view (`panels/stylebook-layers-panel.ts`), which is how a
 * page or a component styles its own element defaults in Design; the variables list it drew beside
 * the Variables view moved here, beside the variables' groups, counts and swatches.
 *
 * Nothing here writes a style. Every edit happens in the view the row leads to, under that view's
 * own save rule (`style/variables-view.ts` `VARIABLES_SAVING`).
 *
 * @docs studio/design/tokens
 */

import { nothing } from "lit-html";
import { effect, effectScope } from "../reactivity";
import { projectState } from "../store";
import { setDockCollapsed, shell } from "../shell";
import { workspace } from "../workspace/workspace";
import { PROJECT_CONFIG_PATH } from "../tabs/tab";
import { componentRegistry } from "../files/components";
import { runActiveReported } from "../commands/run-reported";
import { showSettingsDocument } from "../settings/settings-document";
import { groupIdOfToken, groupTokens, listTokenContexts } from "../style/project-styles";
import { resolveTokenValue } from "../style/token-ref";
import { requestVariablesFocus } from "../style/variables-focus";
import { catalogueRows, hasTagStyle } from "./stylebook-doc";
import { selectStylebookTag, stylebookMeta } from "./stylebook-panel";
import { INDENT_BASE, INDENT_STEP } from "./stylebook-layers-panel";
import { mountStylesPanelSurface } from "../surfaces/styles-panel";
import { registerPanel } from "./panel-registry";
import { isNonNullObject, isString } from "@jxsuite/schema/guards";
import type { EffectScope } from "@vue/reactivity";
import type { JxStyle } from "@jxsuite/schema/types";
import type { StylebookEntry } from "./stylebook-panel";
import type { TokenGroupId } from "../style/project-styles";
import type {
  StylesElementGroup,
  StylesElementRow,
  StylesPanelActions,
  StylesPanelSurfaceHandle,
  StylesPanelValues,
  StylesSchemeRow,
  StylesVariableGroup,
} from "../surfaces/styles-panel";

/** The `source` every command run from here reports under. */
const SOURCE = "Styles";

/** The catalogue the Elements section lists: the specimen sections. */
export interface StylesCatalogue {
  $sections: { label: string; elements: StylebookEntry[] }[];
}

/** What the panel is projected from. Injected so a test can hand in its own catalogue. */
export interface StylesPanelInput {
  /** `project.json` as the panel reads it, or `null` with no project open. */
  config: { style?: JxStyle; $media?: Record<string, string> } | null;
  catalogue: StylesCatalogue;
  /** The project's components, by tag name. */
  components: readonly { tagName: string }[];
  /** The tag the Elements view has selected (`shell.stylebook.selection`). */
  selection: string | null;
  /** The custom property the Variables view is pointed at (`shell.stylebook.variable`). */
  variable: string | null;
}

/**
 * `project.json` as the panel reads it: the open tab's document when the tab is open (so an edit
 * that has not been saved yet is what the panel lists), else the configuration the project was
 * opened with.
 */
export function stylesConfig(): StylesPanelInput["config"] {
  const tab = workspace.tabs.get(PROJECT_CONFIG_PATH);
  return (tab ? tab.doc.document : projectState?.projectConfig) ?? null;
}

/** The input the live panel is drawn from. */
function liveInput(): StylesPanelInput {
  return {
    catalogue: stylebookMeta,
    components: componentRegistry,
    config: projectState ? stylesConfig() : null,
    selection: shell.stylebook.selection,
    variable: shell.stylebook.variable,
  };
}

/** "1 variable", "6 variables". */
function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The variable groups, in the Variables view's order, the empty Other left out as it is there. */
function variableGroups(style: JxStyle, current: string | null): StylesVariableGroup[] {
  return groupTokens(style)
    .filter(({ group, tokens }) => group.id !== "other" || tokens.length > 0)
    .map(({ group, tokens }) => ({
      count: String(tokens.length),
      countLabel: counted(tokens.length, "variable"),
      id: group.id,
      title: group.title,
      variables: tokens.map((token) => {
        const resolved = group.id === "color" ? resolveTokenValue(style, token.value) : undefined;
        return {
          name: token.name,
          selected: token.name === current,
          swatch: resolved === undefined ? "" : String(resolved),
          swatchState: group.id === "color" ? ("swatch" as const) : ("none" as const),
          value: String(token.value),
        };
      }),
    }));
}

/**
 * The Elements section: one group per catalogue section, then the project's components. The rows
 * are the stylebook's own walk (`stylebook-doc.ts` `catalogueRows`, which the Outline's catalogue
 * draws from too); the dot reads the nested tag paths Stylebook edits write.
 */
function elementGroups(input: StylesPanelInput, style: JxStyle): StylesElementGroup[] {
  const groups: StylesElementGroup[] = input.catalogue.$sections.map((section) => ({
    key: section.label,
    label: section.label,
    rows: catalogueRows(section.elements, input.selection).map((row): StylesElementRow => ({
      customized: hasTagStyle(style, row.path),
      indent: `${INDENT_BASE + row.depth * INDENT_STEP}px`,
      key: row.path,
      selected: row.selected,
      tag: row.tag,
    })),
  }));
  if (input.components.length > 0) {
    groups.push({
      key: "components",
      label: "Components",
      rows: input.components.map((component) => ({
        customized: hasTagStyle(style, component.tagName),
        indent: `${INDENT_BASE}px`,
        key: component.tagName,
        selected: component.tagName === input.selection,
        tag: component.tagName,
      })),
    });
  }
  return groups;
}

/** The color schemes `$media` declares, by name and by the query that selects each. */
function schemeRows(media: Record<string, string> | undefined): StylesSchemeRow[] {
  return listTokenContexts(media)
    .filter((context) => context.kind === "scheme")
    .map((context) => {
      const query = media?.[context.name];
      return { key: context.name, label: context.label, query: isString(query) ? query : "" };
    });
}

/**
 * What the panel shows. Pure over its input: the configuration, the catalogue, the components and
 * the two current rows.
 *
 * @param {StylesPanelInput} [input] Defaults to the live project.
 * @returns {StylesPanelValues}
 */
export function stylesPanelValues(input: StylesPanelInput = liveInput()): StylesPanelValues {
  if (!input.config) {
    return {
      body: "none",
      customizedCount: "0",
      customizedLabel: "",
      elementGroups: [],
      groups: [],
      schemes: [],
      schemesState: "empty",
      variableCount: "0",
      variablesState: "empty",
    };
  }
  const style: JxStyle = isNonNullObject(input.config.style) ? input.config.style : {};
  const groups = variableGroups(style, input.variable);
  const variableCount = groups.reduce((sum, group) => sum + group.variables.length, 0);
  const elements = elementGroups(input, style);
  const customized = elements.reduce(
    (sum, group) => sum + group.rows.filter((row) => row.customized).length,
    0,
  );
  const schemes = schemeRows(input.config.$media);
  return {
    body: "styles",
    customizedCount: `${customized} styled`,
    customizedLabel: `${counted(customized, "tag")} styled`,
    elementGroups: elements,
    groups,
    schemes,
    schemesState: schemes.length > 0 ? "listed" : "empty",
    variableCount: String(variableCount),
    variablesState: variableCount > 0 ? "listed" : "empty",
  };
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Whether a string is a token group id. */
function isTokenGroupId(value: string): value is TokenGroupId {
  return value === "color" || value === "font" || value === "size" || value === "other";
}

/** The group "Add variable" adds to: the current property's, or Colors. */
export function addTargetGroup(current: string | null = shell.stylebook.variable): TokenGroupId {
  return current === null ? "color" : groupIdOfToken(current);
}

/**
 * What the panel's controls do. Each one shows the view it leads to first, then asks that view to
 * bring the row on screen, so a request made from Elements is served when Variables mounts.
 */
export const STYLES_PANEL_ACTIONS: StylesPanelActions = {
  addVariable: () => {
    showSettingsDocument("tokens");
    requestVariablesFocus({ add: true, group: addTargetGroup(), kind: "group" });
  },
  manageSchemes: () => {
    void runActiveReported("settings.open", { section: "contexts" }, SOURCE);
  },
  selectElement: (path) => {
    showSettingsDocument("stylebook");
    selectStylebookTag(path, undefined, { panCanvas: true });
    // `selectStylebookTag` puts the Inspector on Element › Style; the Inspector has to be open.
    setDockCollapsed("right", false);
  },
  selectVariable: (name) => {
    showSettingsDocument("tokens");
    requestVariablesFocus({ kind: "variable", name });
  },
  showGroup: (group) => {
    if (!isTokenGroupId(group)) {
      return;
    }
    showSettingsDocument("tokens");
    requestVariablesFocus({ add: false, group, kind: "group" });
  },
};

// ─── Mounting ────────────────────────────────────────────────────────────────

interface StandingPanel {
  host: HTMLElement;
  handle: StylesPanelSurfaceHandle;
  scope: EffectScope;
}

let _standing: StandingPanel | null = null;

/**
 * Mount the surface into `host`, or bring the one already there up to date.
 *
 * The projection runs in an effect of its own, because the Navigator repaints on a document's
 * IDENTITY and a variable's value is a write deep inside it: an edit in the Variables view, an undo
 * or a Code edit re-projects the panel through what the effect read.
 */
function mountInto(host: HTMLElement): void {
  if (_standing && (_standing.host !== host || !_standing.handle.connected())) {
    resetStylesPanel();
  }
  if (_standing) {
    // A repaint of the Navigator: the component registry is not reactive, so it is read here.
    _standing.handle.update(stylesPanelValues());
    return;
  }
  const handle = mountStylesPanelSurface(host, stylesPanelValues(), STYLES_PANEL_ACTIONS);
  const scope = effectScope();
  scope.run(() => {
    effect(() => {
      handle.update(stylesPanelValues());
    });
  });
  _standing = { handle, host, scope };
}

/** The Navigator's content area inside a panel body (`panels/collections-panel.ts` gives why). */
function contentArea(body: HTMLElement): HTMLElement {
  return body.querySelector<HTMLElement>(".panel-content") ?? body;
}

/**
 * Contribute the Styles panel: project level (it lists the project's styles), no rail button
 * (Styles has no rail), the Styles workspace's Navigator.
 */
export function registerStylesPanel(): void {
  registerPanel({
    id: "styles",
    title: "Styles",
    level: "project",
    dock: "navigator",
    icon: "paint-brush",
    rail: false,
    render: () => nothing,
    afterRender: (_ctx, host) => {
      mountInto(contentArea(host));
    },
  });
}

/** Forget the mounted panel: tests, a project switch, and a host the Navigator replaced. */
export function resetStylesPanel(): void {
  _standing?.scope.stop();
  _standing?.handle.dispose();
  _standing = null;
}
