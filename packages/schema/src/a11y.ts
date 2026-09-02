/**
 * Accessibility rules over a Jx document — the static half of WAI-ARIA and WCAG conformance.
 *
 * The same shape as `overlays.ts` and `dialogs.ts`: one walk, one defect record, a sentence an
 * author can act on, and a rule that stays silent whenever the fact it needs is BOUND rather than
 * written. A `${…}` template or a `{ $ref }` in a name, a role or an id is a value the document
 * decides at run time, and a lint that accused the author of a defect it could not see would teach
 * them to ignore it. Every rule here names the WCAG success criterion it stands on, so a finding
 * reads as a citation rather than an opinion.
 *
 * What is NOT judged, deliberately: colour and contrast (a style question the kit's tokens answer
 * and `check-styles` gates), keyboard behaviour (a runtime question), and reading order. Those
 * belong to a browser, not to a walk over JSON.
 *
 * @docs framework/concepts/accessibility
 */

import { isJsonObject, isRef } from "./guards";
import { attrs, labelOf, tagOf } from "./overlays";
import type { JxElement } from "../types";
import type { PopoverPath } from "./overlays";

export type A11yRule =
  | "interactive-unnamed"
  | "img-alt-missing"
  | "aria-target-missing"
  | "tab-outside-tablist"
  | "tablist-none-selected"
  | "menuitem-outside-menu"
  | "option-outside-listbox"
  | "dialog-unnamed"
  | "activedescendant-not-focusable";

export interface A11yDefect {
  rule: A11yRule;
  /** Where the defect is. */
  path: PopoverPath;
  /** One sentence naming what is wrong, in the author's language. */
  message: string;
  /** Why it is wrong and what to do instead. */
  detail: string;
  /** `error` fails a conformance check; `warn` is very probably not what was meant. */
  severity: "error" | "warn";
  /** The WCAG 2.2 success criterion the rule stands on, e.g. `4.1.2`. */
  criterion: string;
}

/** The success criteria the rules cite, by number. */
export const WCAG_CRITERIA: Readonly<Record<string, string>> = {
  "1.1.1": "Non-text Content",
  "1.3.1": "Info and Relationships",
  "2.1.1": "Keyboard",
  "4.1.2": "Name, Role, Value",
};

const DOCS = "See docs/framework/concepts/accessibility.";

// ─── Reading a node ─────────────────────────────────────────────────────────────

/** A value the document decides at run time: a `$ref`, an expression, or a `${…}` template. */
function isBound(value: unknown): boolean {
  if (isRef(value) || isJsonObject(value)) {
    return true;
  }
  return typeof value === "string" && value.includes("${");
}

/** An attribute or top-level property, whichever the author wrote. */
function valueOf(node: JxElement, name: string): unknown {
  const bag = attrs(node);
  if (name in bag) {
    return bag[name];
  }
  return (node as Record<string, unknown>)[name];
}

/** A literal, non-empty string value, or null when absent, empty or bound. */
function literal(node: JxElement, name: string): string | null {
  const value = valueOf(node, name);
  return typeof value === "string" && value.trim() !== "" && !isBound(value) ? value : null;
}

/** Whether the author wrote the attribute at all, bound or not. */
function has(node: JxElement, name: string): boolean {
  return valueOf(node, name) !== undefined && valueOf(node, name) !== null;
}

/** The sentinel a reader returns for a value the document decides at run time. */
const BOUND = "bound";

/** The node's role, lowercased; `null` when it has none and `"bound"` when it is not decidable. */
function roleOf(node: JxElement): string | null {
  const value = valueOf(node, "role");
  if (value === undefined || value === null) {
    return null;
  }
  if (isBound(value)) {
    return "bound";
  }
  return typeof value === "string" ? value.trim().toLowerCase().split(/\s+/)[0]! : null;
}

/** The node's literal id, or `"bound"` when it has one the document decides at run time. */
function idStateOf(node: JxElement): string | null {
  const value = valueOf(node, "id");
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return isBound(value) ? "bound" : typeof value === "string" ? value : null;
}

/** Whether a name source the platform reads is present, bound or literal and non-empty. */
function hasNameSource(node: JxElement, name: string): boolean {
  const value = valueOf(node, name);
  if (value === undefined || value === null) {
    return false;
  }
  return isBound(value) || (typeof value === "string" && value.trim() !== "");
}

/**
 * Whether the node's CONTENT can name it — text, a slot that may carry text, a named image, or
 * anything the document decides at run time.
 *
 * Conservative on purpose: a `$map`, a `$switch` with any named case, or a bound `textContent` all
 * count as content, because the lint may not accuse what it cannot read.
 */
function hasContentName(node: JxElement): boolean {
  const text = node.textContent;
  if (typeof text === "string") {
    if (text.trim() !== "") {
      return true;
    }
  } else if (text !== undefined && text !== null) {
    return true;
  }
  if (hasNameSource(node, "aria-label") || has(node, "aria-labelledby")) {
    return true;
  }
  if (tagOf(node) === "img" && (hasNameSource(node, "alt") || hasNameSource(node, "title"))) {
    return true;
  }
  if (tagOf(node) === "slot") {
    return true;
  }
  const { children } = node;
  if (Array.isArray(children)) {
    for (const child of children) {
      if (typeof child === "string") {
        if (child.trim() !== "") {
          return true;
        }
      } else if (child && typeof child === "object" && hasContentName(child)) {
        return true;
      }
    }
  } else if (children !== undefined && children !== null) {
    // A mapped array: rows the document decides.
    return true;
  }
  if (isJsonObject(node.map)) {
    return true;
  }
  const cases = isJsonObject(node.cases) ? Object.values(node.cases) : [];
  return cases.some((branch) => isJsonObject(branch) && hasContentName(branch as JxElement));
}

/** Roles that take their name from content, as ARIA's "name from: contents" allows. */
const CONTENT_NAMED_ROLES = new Set([
  "button",
  "checkbox",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "tab",
  "treeitem",
]);

/** Roles that must be named some other way — an accessible name from content is not allowed. */
const LABELLED_ROLES = new Set([
  "combobox",
  "listbox",
  "searchbox",
  "slider",
  "spinbutton",
  "textbox",
]);

/** `<input>` types named by their `value` rather than a label. */
const VALUE_NAMED_INPUTS = new Set(["button", "reset", "submit"]);

/** For each role the container rules judge, the container roles allowed to own it. */
const OWNING_ROLES: Readonly<Record<string, readonly string[]>> = {
  menuitem: ["menu", "menubar"],
  menuitemcheckbox: ["menu", "menubar"],
  menuitemradio: ["menu", "menubar"],
  option: ["listbox"],
  tab: ["tablist"],
};

/** Every role on the owning side of that map, so one walk can collect what each of them owns. */
const CONTAINER_ROLES = new Set(Object.values(OWNING_ROLES).flat());

// ─── Walking with ancestors ─────────────────────────────────────────────────────

interface Ancestry {
  node: JxElement;
  path: PopoverPath;
  /** Roles of every ancestor, nearest last; `"bound"` where one is not decidable. */
  roles: (string | null)[];
  /** Tags of every ancestor, nearest last. */
  tags: string[];
}

function* walkAncestry(
  root: JxElement,
  path: PopoverPath = [],
  roles: (string | null)[] = [],
  tags: string[] = [],
): Generator<Ancestry> {
  yield { node: root, path, roles, tags };
  const below = [...roles, roleOf(root)];
  const tagsBelow = [...tags, tagOf(root)];
  const { children } = root;
  if (Array.isArray(children)) {
    for (const [index, child] of children.entries()) {
      if (child && typeof child === "object") {
        yield* walkAncestry(child as JxElement, [...path, "children", index], below, tagsBelow);
      }
    }
  } else if (isJsonObject(children) && isJsonObject((children as JxElement).map)) {
    yield* walkAncestry(
      (children as JxElement).map as JxElement,
      [...path, "children", "map"],
      below,
      tagsBelow,
    );
  }
  if (isJsonObject(root.map)) {
    yield* walkAncestry(root.map as JxElement, [...path, "map"], below, tagsBelow);
  }
  const cases = isJsonObject(root.cases) ? (root.cases as Record<string, JxElement>) : {};
  for (const [key, branch] of Object.entries(cases)) {
    if (branch && typeof branch === "object") {
      yield* walkAncestry(branch, [...path, "cases", key], below, tagsBelow);
    }
  }
}

/** Whether any ancestor is a custom element, whose definition may supply the container role. */
function underCustomElement(tags: string[]): boolean {
  return tags.some((tag) => tag.includes("-"));
}

// ─── The rules ──────────────────────────────────────────────────────────────────

function defect(
  rule: A11yRule,
  path: PopoverPath,
  message: string,
  detail: string,
  criterion: string,
  severity: "error" | "warn" = "error",
): A11yDefect {
  return {
    criterion,
    detail: `${detail} ${DOCS}`,
    message,
    path,
    rule,
    severity,
  };
}

/**
 * What the document's `<label>` elements point at, and whether any of them points somewhere
 * unreadable.
 */
interface LabelTargets {
  /** Every literal `for` value. */
  ids: Set<string>;
  /** A `<label for="row-${index}">` exists, so which control it names is not decidable here. */
  bound: boolean;
}

/**
 * Whether an `<input>`, `<select>` or `<textarea>` is labelled by a `<label>`, by `for` or by
 * nesting.
 *
 * A BOUND id on either side answers true, which is this module's rule about not accusing an author
 * of a defect it cannot see. `<label for="row-${index}">` beside `<input id="row-${index}">` is the
 * only correct way to label a field inside a repeater, and both halves are templates: the id
 * resolves to the sentinel rather than to a value, and the `for` never enters the set at all. Read
 * literally that pairing looked like no label at all, so the one correct form was the one reported
 * — and at `error` severity, which fails `jx validate --strict` on a document that is fine.
 */
function labelledByLabel(id: string | null, labelledIds: LabelTargets, tags: string[]): boolean {
  if (tags.includes("label")) {
    return true;
  }
  if (id === BOUND || labelledIds.bound) {
    return true;
  }
  return id !== null && labelledIds.ids.has(id);
}

function unnamedInteractive(visit: Ancestry, labelledIds: LabelTargets): A11yDefect | null {
  const { node, path, tags } = visit;
  const tag = tagOf(node);
  const role = roleOf(node);
  if (role === "bound") {
    return null;
  }
  const named =
    hasNameSource(node, "aria-label") ||
    has(node, "aria-labelledby") ||
    hasNameSource(node, "title");
  if (named) {
    return null;
  }
  const what = labelOf(node, "the control");
  const fix = (how: string) =>
    defect(
      "interactive-unnamed",
      path,
      `${what} has no accessible name.`,
      `A control with no name is announced as its role alone, so a reader hears "button" and nothing else. ${how}`,
      "4.1.2",
    );
  /*
   * The NATIVE routes, judged before any role branch.
   *
   * A role on a native control is redundant, legal, and for `role="combobox"` on an `<input>` it is
   * the authoring practice the APG prescribes. Reporting the role first meant a `<label for>` was
   * never consulted for one, so the APG combobox — and a `role="slider"` range, and a
   * `role="spinbutton"` number — were all reported as unnamed while carrying a perfectly good name.
   */
  const nativeRoutes = nativeNameRoute(node, tag, labelledIds, tags);
  if (nativeRoutes === "named" || nativeRoutes === "exempt") {
    return null;
  }
  if (role !== null && CONTENT_NAMED_ROLES.has(role)) {
    return hasContentName(node) ? null : fix("Give it text content, or an aria-label.");
  }
  if (role !== null && LABELLED_ROLES.has(role)) {
    return fix("Give it an aria-label, or aria-labelledby naming its visible label.");
  }
  if (role !== null) {
    return null;
  }
  if (tag === "button" || tag === "summary" || (tag === "a" && has(node, "href"))) {
    return hasContentName(node) ? null : fix("Give it text content, or an aria-label.");
  }
  if (nativeRoutes === "unnamed") {
    return fix("Give it a <label for> naming its id, or an aria-label.");
  }
  if (nativeRoutes === "unnamed-value") {
    return fix("Give it a value, or an aria-label.");
  }
  if (nativeRoutes === "unnamed-alt") {
    return fix("Give it an alt, or an aria-label.");
  }
  return null;
}

/**
 * What the NATIVE labelling routes say about a form control or an image-map area, independently of
 * any role it carries.
 *
 * `"none"` means the node has no native route and these do not apply to it.
 */
function nativeNameRoute(
  node: JxElement,
  tag: string,
  labelledIds: LabelTargets,
  tags: string[],
): "named" | "exempt" | "unnamed" | "unnamed-value" | "unnamed-alt" | "none" {
  /*
   * An image-map hotspot, whose `alt` IS its link text.
   *
   * HTML requires the attribute on every `<area>` that has an `href`, and there is no other route
   * to a name: an area is a void element, so it has no content to fall back on, and no `<label>`
   * points at one. An empty `alt` is therefore NOT the decision it is on an `<img>` — a decorative
   * link is a contradiction — which is why this reports through the name rule rather than through
   * `img-alt-missing`. An `<area>` with no `href` is not a link and owes nothing, so it falls
   * through to the role branches like any other element.
   */
  if (tag === "area") {
    if (!has(node, "href")) {
      return "none";
    }
    return hasNameSource(node, "alt") ? "named" : "unnamed-alt";
  }
  if (tag === "select" || tag === "textarea") {
    return labelledByLabel(idStateOf(node), labelledIds, tags) || hasNameSource(node, "placeholder")
      ? "named"
      : "unnamed";
  }
  if (tag !== "input") {
    return "none";
  }
  const type = (literal(node, "type") ?? "text").toLowerCase();
  if (type === "hidden" || (has(node, "type") && literal(node, "type") === null)) {
    return "exempt";
  }
  if (VALUE_NAMED_INPUTS.has(type)) {
    return hasNameSource(node, "value") ? "named" : "unnamed-value";
  }
  if (type === "image") {
    return hasNameSource(node, "alt") ? "named" : "unnamed-alt";
  }
  return labelledByLabel(idStateOf(node), labelledIds, tags) || hasNameSource(node, "placeholder")
    ? "named"
    : "unnamed";
}

function imgAltMissing(visit: Ancestry): A11yDefect | null {
  const { node, path } = visit;
  if (tagOf(node) !== "img") {
    return null;
  }
  const role = roleOf(node);
  if (role === "bound" || role === "presentation" || role === "none") {
    return null;
  }
  if (has(node, "alt") || hasNameSource(node, "aria-label") || has(node, "aria-labelledby")) {
    return null;
  }
  return defect(
    "img-alt-missing",
    path,
    `${labelOf(node, "the image")} has no alt text.`,
    'An image with no alt is announced by its file name. Describe it in alt, or write alt="" for a decorative one.',
    "1.1.1",
  );
}

const ID_REFERENCE_ATTRS = [
  "aria-activedescendant",
  "aria-controls",
  "aria-describedby",
  "aria-details",
  "aria-errormessage",
  "aria-flowto",
  "aria-labelledby",
  "aria-owns",
];

function ariaTargetsMissing(visit: Ancestry, ids: Set<string>): A11yDefect[] {
  const { node, path } = visit;
  const defects: A11yDefect[] = [];
  for (const name of ID_REFERENCE_ATTRS) {
    const value = literal(node, name);
    if (value === null) {
      continue;
    }
    for (const token of value.split(/\s+/)) {
      if (token !== "" && !ids.has(token)) {
        defects.push(
          defect(
            "aria-target-missing",
            path,
            `${labelOf(node, "the element")} points ${name} at #${token}, which nothing in this document has as its id.`,
            "A reference to an id that is not in the document is silently dropped, so the relationship it declares does not exist. Name an element that is here, or give that element the id.",
            "1.3.1",
          ),
        );
      }
    }
  }
  return defects;
}

/** What the containers of one role name through `aria-owns`, across the whole document. */
interface OwnedTargets {
  /** Every literal id such a container owns. */
  ids: Set<string>;
  /** One of them owns `"tab-${state.i}"`, so which elements it owns is not decidable here. */
  bound: boolean;
}

/**
 * Whether a container that may own this role claims it through `aria-owns`.
 *
 * ARIA states containment where the DOM tree cannot: an element a `tablist` names in `aria-owns` is
 * that tablist's child in the accessibility tree wherever it sits in the markup, and the attribute
 * exists for exactly the arrangements a subtree cannot express. Walking ancestors alone therefore
 * reported the one correct way to write those, at `error` severity, so `jx validate --strict`
 * failed on a document that is fine.
 *
 * A BOUND `aria-owns`, or a bound id on the node itself, answers true, which is this module's rule
 * about not accusing an author of a defect it cannot see. The map is keyed by the OWNER's role, so
 * this stays a silence rather than a hole: a `role="banner" aria-owns="t1"` over a tab owns nothing
 * a tab may belong to, and the tab is still reported.
 */
function ownedByContainer(
  id: string | null,
  role: string,
  owned: Map<string, OwnedTargets>,
): boolean {
  for (const container of OWNING_ROLES[role] ?? []) {
    const targets = owned.get(container);
    if (targets === undefined) {
      continue;
    }
    if (targets.bound) {
      return true;
    }
    if (id === BOUND && targets.ids.size > 0) {
      return true;
    }
    if (id !== null && id !== BOUND && targets.ids.has(id)) {
      return true;
    }
  }
  return false;
}

function roleOutsideContainer(
  visit: Ancestry,
  owned: Map<string, OwnedTargets>,
): A11yDefect | null {
  const { node, path, roles, tags } = visit;
  const role = roleOf(node);
  if (role === null || role === "bound" || path.length === 0 || underCustomElement(tags)) {
    return null;
  }
  if (roles.includes("bound") || ownedByContainer(idStateOf(node), role, owned)) {
    return null;
  }
  const what = labelOf(node, "the element");
  if (role === "tab" && !roles.includes("tablist")) {
    return defect(
      "tab-outside-tablist",
      path,
      `${what} is a tab outside any tablist.`,
      'A tab is announced with its position in a tablist, so one with no tablist ancestor has no place to be counted in. Put the tabs in a container with role="tablist".',
      "1.3.1",
    );
  }
  if (
    (role === "menuitem" || role === "menuitemcheckbox" || role === "menuitemradio") &&
    !roles.includes("menu") &&
    !roles.includes("menubar")
  ) {
    return defect(
      "menuitem-outside-menu",
      path,
      `${what} is a ${role} outside any menu.`,
      'A menu item is owned by a menu, and is announced as one of its items. Put it in a container with role="menu" or role="menubar".',
      "1.3.1",
    );
  }
  if (
    role === "option" &&
    !roles.includes("listbox") &&
    !tags.includes("select") &&
    !tags.includes("datalist")
  ) {
    return defect(
      "option-outside-listbox",
      path,
      `${what} is an option outside any listbox.`,
      'An option is owned by a listbox, and is announced as one of its choices. Put it in a container with role="listbox", or in a <select>.',
      "1.3.1",
    );
  }
  return null;
}

/** Every literal `aria-selected` in the subtree's tabs, or null when one is bound. */
function tabSelections(root: JxElement): boolean[] | null {
  const seen: boolean[] = [];
  for (const { node } of walkAncestry(root)) {
    if (roleOf(node) !== "tab") {
      continue;
    }
    const value = valueOf(node, "aria-selected");
    if (isBound(value)) {
      return null;
    }
    seen.push(value === true || value === "true");
  }
  return seen;
}

function tablistNoneSelected(visit: Ancestry): A11yDefect | null {
  const { node, path } = visit;
  if (roleOf(node) !== "tablist") {
    return null;
  }
  const selections = tabSelections(node);
  if (selections === null || selections.length === 0 || selections.includes(true)) {
    return null;
  }
  return defect(
    "tablist-none-selected",
    path,
    `${labelOf(node, "the tablist")} has ${selections.length} tab(s) and none is selected.`,
    'A tablist always has a current tab, and aria-selected="true" is how it is announced. Mark the tab whose panel is showing.',
    "4.1.2",
    "warn",
  );
}

function dialogUnnamed(visit: Ancestry): A11yDefect | null {
  const { node, path } = visit;
  const role = roleOf(node);
  const isDialog = tagOf(node) === "dialog" || role === "dialog" || role === "alertdialog";
  if (!isDialog || role === "bound") {
    return null;
  }
  if (hasNameSource(node, "aria-label") || has(node, "aria-labelledby")) {
    return null;
  }
  return defect(
    "dialog-unnamed",
    path,
    `${labelOf(node, "the dialog")} has no accessible name.`,
    "A dialog is announced by its name when it opens, and its content does not name it. Give it aria-labelledby naming its heading, or an aria-label.",
    "4.1.2",
  );
}

const FOCUSABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

function activedescendantNotFocusable(visit: Ancestry): A11yDefect | null {
  const { node, path } = visit;
  if (!has(node, "aria-activedescendant")) {
    return null;
  }
  const tag = tagOf(node);
  const focusable =
    FOCUSABLE_TAGS.has(tag) ||
    (tag === "a" && has(node, "href")) ||
    has(node, "tabIndex") ||
    has(node, "tabindex") ||
    has(node, "contenteditable");
  if (focusable) {
    return null;
  }
  return defect(
    "activedescendant-not-focusable",
    path,
    `${labelOf(node, "the element")} manages focus with aria-activedescendant but cannot itself take focus.`,
    "aria-activedescendant names the active child of a FOCUSED container; on one that cannot be focused, the keyboard never reaches it. Give the container a tabindex.",
    "2.1.1",
  );
}

// ─── The entry point ────────────────────────────────────────────────────────────

/**
 * Every accessibility defect in a document, in document order.
 *
 * @param doc The document (or element definition, or fragment) to judge.
 */
export function findA11yDefects(doc: JxElement): A11yDefect[] {
  const visits = [...walkAncestry(doc)];
  const ids = new Set<string>();
  const labelledIds: LabelTargets = { bound: false, ids: new Set<string>() };
  const owned = new Map<string, OwnedTargets>();
  let boundIds = false;
  for (const { node } of visits) {
    const role = roleOf(node);
    if (role !== null && CONTAINER_ROLES.has(role)) {
      const targets = owned.get(role) ?? { bound: false, ids: new Set<string>() };
      const literalOwns = literal(node, "aria-owns");
      if (literalOwns === null) {
        // An `aria-owns` the document decides at run time: what it owns is not readable here.
        targets.bound ||= has(node, "aria-owns");
      } else {
        for (const token of literalOwns.split(/\s+/)) {
          if (token !== "") {
            targets.ids.add(token);
          }
        }
      }
      owned.set(role, targets);
    }
    const id = idStateOf(node);
    if (id === BOUND) {
      boundIds = true;
    } else if (id !== null) {
      ids.add(id);
    }
    if (tagOf(node) === "label") {
      const target = literal(node, "for") ?? literal(node, "htmlFor");
      if (target === null) {
        // A `for` the document decides at run time: which control it names is not readable here.
        labelledIds.bound ||= has(node, "for") || has(node, "htmlFor");
      } else {
        labelledIds.ids.add(target);
      }
    }
  }
  const defects: A11yDefect[] = [];
  for (const visit of visits) {
    const found = [
      unnamedInteractive(visit, labelledIds),
      imgAltMissing(visit),
      roleOutsideContainer(visit, owned),
      tablistNoneSelected(visit),
      dialogUnnamed(visit),
      activedescendantNotFocusable(visit),
    ];
    for (const one of found) {
      if (one) {
        defects.push(one);
      }
    }
    // An id the document decides at run time makes every reference undecidable, so the rule sleeps.
    if (!boundIds) {
      defects.push(...ariaTargetsMissing(visit, ids));
    }
  }
  return defects;
}
