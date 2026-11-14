/**
 * The Style tab's specimen: a heading selected in Design, its Typography and Size sections open
 * with every kind of row the tab draws, and the empty state the tab teaches from (studio.md §4.6).
 */
import { reactive } from "../reactivity";
import { defineSpecimen } from "./specimen";
import type {
  StyleButtonView,
  StylePanelScope,
  StyleRowView,
  StyleSectionView,
  StyleWidgetKind,
} from "./style-panel";

/**
 * One row, with every field the document binds present: a binding renders a value and a `$switch`
 * chooses on one, so the adapter fills them all and so does this.
 */
function row(
  key: string,
  label: string,
  widget: StyleWidgetKind,
  value: string,
  facts: Partial<StyleRowView> = {},
): StyleRowView {
  return {
    buttons: [],
    child: false,
    chip: "button",
    chipState: "set",
    chipText: "",
    chipTitle: `Clear ${label}`,
    choicesHint: "",
    choicesLabel: "",
    expandIcon: "caret-right",
    expandLabel: `Show the sides of ${label}`,
    expanded: false,
    hasChoices: false,
    hasLabel: true,
    hasSource: true,
    hasTokens: false,
    key,
    kind: "field",
    label,
    max: "",
    min: "",
    mono: false,
    name: "",
    openTitle: "",
    options: [],
    overflowSelected: false,
    placeholder: "",
    prop: key,
    removeLabel: "",
    resolved: "",
    sourceHint: "A value typed here",
    sourceLabel: "Custom",
    sourceState: "custom",
    span: false,
    step: "",
    tokens: [],
    value,
    warning: false,
    widget,
    ...facts,
  };
}

/** One button of a button-group row. */
function button(owner: string, value: string, title: string, chosen: string): StyleButtonView {
  return {
    checked: value === chosen ? "true" : "false",
    icon: "",
    row: owner,
    text: title,
    title,
    value,
  };
}

/** The sections of a heading with a few values set. */
function sections(): StyleSectionView[] {
  return [
    {
      canClear: true,
      clearTitle: "Clear every Typography value set here",
      hasMarks: true,
      key: "typography",
      label: "Typography",
      layout: "list",
      marks: [{ state: "set" }, { state: "inherited" }],
      open: true,
      rows: [
        row("fontFamily", "Font", "keywords", "var(--font-display)", {
          options: [
            { description: "--font-display", label: "Display", value: "var(--font-display)" },
            { description: "--font-body", label: "Body", value: "var(--font-body)" },
          ],
        }),
        row("fontSize", "Size", "group", "2.5", {
          choicesHint: "Choose a unit",
          choicesLabel: "rem",
          hasChoices: true,
        }),
        row("fontWeight", "Weight", "number", "700", { max: "900", min: "100", step: "100" }),
        row("textAlign", "Align", "buttons", "center", {
          buttons: [
            button("textAlign", "left", "Left", "center"),
            button("textAlign", "center", "Center", "center"),
            button("textAlign", "right", "Right", "center"),
          ],
          choicesHint: "More values",
          choicesLabel: "More",
          hasChoices: true,
        }),
        row("color", "Color", "color", "var(--color-ink)", {
          hasTokens: true,
          resolved: "#1d1d22",
          tokens: [
            { color: "#1d1d22", label: "Ink", value: "var(--color-ink)" },
            { color: "#2563eb", label: "Primary Blue", value: "var(--color-primary-blue)" },
          ],
        }),
      ],
      tally: "5 set here · 1 inherited",
    },
    {
      canClear: false,
      clearTitle: "",
      hasMarks: false,
      key: "spacing",
      label: "Spacing",
      layout: "list",
      marks: [],
      open: true,
      rows: [
        row("margin", "Margin", "shorthand", "0 0 1rem", { kind: "shorthand" }),
        row("letterSpacing", "Tracking", "text", "-0.01em", { chip: "none", mono: true }),
        row("custom:--card-gap", "", "kv", "12px", {
          hasLabel: false,
          hasSource: false,
          kind: "custom",
          name: "--card-gap",
          removeLabel: "Remove --card-gap",
        }),
        row("custom-add", "", "kvadd", "", {
          hasLabel: false,
          hasSource: false,
          kind: "custom-add",
        }),
        row("nested:&:hover", "", "nested", "", {
          hasLabel: false,
          hasSource: false,
          kind: "nested",
          name: "&:hover",
          openTitle: "Edit the &:hover rule",
          removeLabel: "Remove the &:hover rule",
        }),
        row("nested-add", "", "nestedadd", "", {
          hasLabel: false,
          hasSource: false,
          kind: "nested-add",
        }),
      ],
      tally: "",
    },
  ];
}

/** The tab on a heading (`editor`), or with nothing selected (`empty`). */
function panel(view: "empty" | "editor"): StylePanelScope {
  /** The row an action names. */
  const rowOf = (key: string): StyleRowView | undefined =>
    scope.sections.flatMap((section) => section.rows).find((candidate) => candidate.key === key);
  /** Write a row's value, which is what every edit of the tab comes to. */
  const write = (key: string, value: string): void => {
    const found = rowOf(key);
    if (found) {
      found.value = value;
    }
  };
  const scope: StylePanelScope = reactive<StylePanelScope>({
    addCustom: (key) => {
      write(key, "");
    },
    addNested: () => {
      scope.filter = "";
    },
    appliesTo: {
      allHint: "Open Project Styles on h1",
      allLabel: "All <h1>s",
      state: view === "editor" ? "shown" : "none",
      tag: "h1",
      thisLabel: "This <h1>",
    },
    chipClick: (key) => {
      write(key, "");
    },
    clearSection: (key) => {
      for (const section of scope.sections) {
        if (section.key === key) {
          section.canClear = false;
        }
      }
    },
    commitText: write,
    editText: write,
    emptyActionLabel: "Select the page",
    emptyMessage: "Select an element to style it.",
    filter: "",
    hasEmptyAction: true,
    newComponent: () => {
      scope.restyle.promptText = "";
    },
    openComponent: (path) => {
      scope.restyle.listTitle = path;
    },
    openNested: (key) => {
      write(key, "open");
    },
    pickChoice: (key) => {
      write(key, rowOf(key)?.value ?? "");
    },
    pickSource: (key) => {
      const found = rowOf(key);
      if (found) {
        found.sourceLabel = "Custom";
      }
    },
    pressButton: write,
    renameCustom: (key, name) => {
      const found = rowOf(key);
      if (found) {
        found.name = name;
      }
    },
    restyle: {
      components: [
        { openLabel: "Open site-hero", path: "components/site-hero.json", tagName: "site-hero" },
      ],
      listState: "list",
      listTitle: "Restyled by 1 component",
      promptText: "A second kind of heading is a component, not a variant.",
      promptTitle: "Need another kind of h1?",
      state: view === "editor" ? "shown" : "none",
    },
    runEmptyAction: () => {
      scope.view = "editor";
    },
    sections: view === "editor" ? sections() : [],
    setFilter: (value) => {
      scope.filter = value;
    },
    styleAllOfTag: (tag) => {
      scope.appliesTo.tag = tag;
    },
    toggleSection: (key, open) => {
      for (const section of scope.sections) {
        if (section.key === key) {
          section.open = open;
        }
      }
    },
    toggleShorthand: (key) => {
      const found = rowOf(key);
      if (found) {
        found.expanded = !found.expanded;
      }
    },
    view,
  });
  return scope;
}

/** Press every element `root` holds for `selector`. */
function press(root: HTMLElement, selector: string): void {
  for (const el of root.querySelectorAll<HTMLElement>(selector)) {
    el.click();
  }
}

/** Raise `type` on the first element `root` holds for `selector`, as its control would. */
function raise(root: HTMLElement, selector: string, type: string): void {
  root.querySelector(selector)?.dispatchEvent(new Event(type, { bubbles: true }));
}

export const specimen = defineSpecimen<StylePanelScope>({
  drive: (root) => {
    press(
      root,
      [
        '[part="empty-action"]',
        '[part="applies-all"]',
        '[part="restyle-open"]',
        '[part="restyle-new"]',
        'button[part="dot"]',
        '[part="chip"]',
        '[part="source"]',
        '[part="group-open"]',
        '[part="button"]',
        '[part="expand"]',
        '[part="nested-open"]',
        '[part="nested-add"]',
      ].join(","),
    );
    raise(root, '[part="filter-input"]', "input");
    raise(root, '[part="section"]', "toggle");
    raise(root, '[part="text"]', "input");
    raise(root, '[part="text"]', "change");
    raise(root, '[part="kv-key"]', "change");
    root
      .querySelector('[part="kv-add"]')
      ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
  },
  scope: () => panel("editor"),
  variants: { empty: () => panel("empty") },
});
