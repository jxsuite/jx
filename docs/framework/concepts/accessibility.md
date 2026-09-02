---
title: "Accessibility"
description: "The accessibility rules Jx checks in a document, each with its WCAG criterion, and where the findings appear: Studio, jx validate and the tests."
spec:
  - spec.md#8.8
code:
  - packages/schema/src/a11y.ts
  - packages/studio/src/services/a11y-report.ts
  - packages/compiler/src/site/validate-command.ts
---

# Accessibility

A Jx document is a tree, and a good deal of what makes a page accessible can be read off the tree before it is ever rendered: whether a button has a name, whether an image has alt text, whether a tab sits in a tablist. Jx checks those facts wherever a document is judged, and every finding names the WCAG 2.2 success criterion it stands on, so a finding reads as a citation you can look up rather than an opinion.

## Where the findings appear

- **Studio** files them under the **Accessibility** source in [Problems](/docs/studio/interface/problems-and-progress), on request through **Check Accessibility** in the command palette. Studio adds the checks that need the whole page: the heading outline, duplicate ids, the document language, vague link text, autocomplete purposes and autoplaying media. It also says what it could not check, such as colour contrast, rather than passing it.
- **`jx validate`** prints the same findings beside its verdict. They are advisory by default, because a well-formed project is still valid; pass `--strict` to fail the run on an accessibility or overlay error.
- **The UI kit, Studio's own chrome and every starter** run the rules in their test suites, so a defect cannot ship in a template you scaffold from.

## The rules

Each rule stays silent when the fact it needs is bound rather than written. A `${…}` template or a `$ref` in a name, a role or an id is a value the document decides while it runs, and a rule that accused you of a defect it could not see would teach you to ignore it.

| Rule                             | What it catches                                                                                       | Criterion                    |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------- |
| `interactive-unnamed`            | A button, a link, a form control or an element with an interactive role that has no accessible name.  | 4.1.2 Name, Role, Value      |
| `img-alt-missing`                | An `img` with no `alt` at all. An empty `alt` marks a decorative image and passes.                    | 1.1.1 Non-text Content       |
| `aria-target-missing`            | An `aria-labelledby`, `aria-controls` or similar reference to an id that nothing in the document has. | 1.3.1 Info and Relationships |
| `tab-outside-tablist`            | A `tab` role with no `tablist` ancestor.                                                              | 1.3.1 Info and Relationships |
| `menuitem-outside-menu`          | A menu item role with no `menu` or `menubar` ancestor.                                                | 1.3.1 Info and Relationships |
| `option-outside-listbox`         | An `option` role outside a `listbox`, a `select` or a `datalist`.                                     | 1.3.1 Info and Relationships |
| `tablist-none-selected`          | A tablist whose tabs are none selected. A warning.                                                    | 4.1.2 Name, Role, Value      |
| `dialog-unnamed`                 | A `dialog` with no `aria-label` or `aria-labelledby`. Its content does not name it.                   | 4.1.2 Name, Role, Value      |
| `activedescendant-not-focusable` | `aria-activedescendant` on an element that cannot take focus itself.                                  | 2.1.1 Keyboard               |

## Naming a control

An accessible name comes from the first of these the browser finds: `aria-labelledby`, `aria-label`, a native label, the control's own content for roles that allow it, and `title`. In a Jx document that means any of the following names a button:

```json
{ "tagName": "button", "textContent": "Save" }
```

```json
{
  "tagName": "button",
  "attributes": { "aria-label": "Close" },
  "children": [{ "tagName": "jx-icon", "$props": { "name": "x" } }]
}
```

A text field is named by a `label` whose `for` matches its `id`, by a `label` wrapped around it, by `aria-label`, or as a last resort by its `placeholder`. A submit button is named by its `value`. A `slot` counts as content, because the text it will carry is the component's caller's to write.

## Inside a component

The three container rules do not judge the root of a component definition, and they do not judge anything under a custom element on a page. A `role="tab"` row you slot into a tabs component is checked inside that component's own definition, where its `tablist` lives, not against the page that uses it.

## What is not checked

Colour contrast, target size, focus order and reading order depend on the rendered page and the cascade, and a tree cannot answer them. Studio's report lists each one it could not check so that an empty list never reads as a clean bill. Run the built site through a browser-based checker for those.
