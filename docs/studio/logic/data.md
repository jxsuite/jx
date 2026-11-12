---
title: "Data panel"
description: "Declare what a page or component knows and watch it resolve: values, computed entries, data sources and functions, each row beside its live value."
code:
  - packages/studio/src/panels/signals-panel.ts
  - packages/studio/src/panels/data-explorer.ts
  - packages/studio/src/surfaces/panel-signals.ts
  - packages/studio/src/surfaces/panel-data.ts
  - packages/studio/src/component-props.ts
  - packages/studio/src/canvas/iframe-remote.ts
  - packages/studio/src/canvas/remote-data.ts
  - packages/studio/src/canvas/state-values.ts
spec:
  - studio.md#5.6 # the Data panel
  - studio.md#4.5 # remote data fetched once, and a state value set for the canvas
---

# Data panel

Data is where you declare everything the open page or component knows: the values it holds, the values it derives, the data it fetches, the functions it can run. It is also where you watch each of them resolve as the canvas runs the page.

Both halves are one list. A row tells you how an entry is **defined**; expand it and you get its editor with the value it is worth **right now** underneath.

![Jx Studio Data panel listing a component's state and functions](../../images/state-panel.png)

## Open it

Click **Data** in the **Document** group of the Navigator rail, or run **Show Data** from :kbd[⌘K].

The panel opens under a **DATA · document** header. Declaring data writes the open file, so the panel is about the document in front of you. With nothing open it says so, and asks you to open a page to give it data: values the page can read, compute or fetch.

Every entry belongs to the open file, so each page or component carries its own data, saved inside its own JSON file.

## Read the list

Entries are grouped into collapsible sections with counts: **State**, **Computed**, **Data**, **Expressions**, **Functions**. Only sections with entries appear, and each row shows:

- A colored badge for the kind of entry (**S** state, **C** computed, **E** expression, **F** function; data sources show their kind's initial).
- The entry's name.
- One summary: what the entry **resolved to** once the canvas has rendered, and how it is **defined** before that.

The resolved summary reads as `Array(12)` for a list and how many items it holds, `{5}` for an object and how many fields, `string` / `number` / `boolean` for a plain value's type, or `pending` for no value yet. A source the canvas fetches says more than that, in a word or two because the row is narrow: **Loading** while its answer is out, **Failed** when it could not be loaded (hover the summary for the reason), and **Not run** for a source the canvas does not run at all, which runs on the live page. A source whose URL reads another source says what that one says while it is loading or failed, because it cannot ask until the other has answered. See **[Fetched once](#fetched-once)**. Before the canvas has rendered anything there is nothing to report, so the row shows the definition instead: a Request's method and URL, a storage entry's key, the first line of a function.

Functions and expressions that assign never show a value, because they don't hold one. They are things the page _does_. Those rows keep their definition summary.

Click a row to open it; click again to close it. Several rows can be open at once, because comparing two entries means seeing both, and what you left open is remembered per tab.

An open row shows the entry's editor and, under it, **Resolved to**: the live value as a tree. Long strings are shortened, and lists, objects and deep nesting are capped, but every cap ends in a **"… N more"** button. Click it to show fifty more of that list, that object, or that many levels deeper; each marker remembers its own limit, so opening one long array doesn't lengthen every other one.

A file with nothing declared yet says so and offers **Add a value**, which creates the first entry for you.

## Add an entry

1. Click the **+ Add…** picker at the bottom of the panel.
2. Choose what to add. The rows are grouped under headings that say which kind of thing each run is: **Values**, **Data sources**, **Project imports** and **Extensions** where your project has them, and **Logic**.
   - **Value**: a plain value the component holds (text, a number, a flag, a list).
   - **Computed**: a value derived from other entries, recalculated automatically.
   - **Fetch from a URL**, **LocalStorage**, **SessionStorage**, **IndexedDB**, **Cookie**, **Set**, **Map**, **FormData**: the built-in data sources, covered in **[Data sources](/docs/studio/logic/data-sources)**.
   - **From a module…**: a data source provided by a JavaScript module you point at.
   - Any sources your project imports or its extensions provide (for example **ContentCollection**) appear next.
   - **Expression**: a named formula, covered in **[Formulas and expressions](/docs/studio/logic/formulas)**.
   - **Function**: a reusable piece of behavior, covered in **[Statements](/docs/studio/logic/statements)** and **[Code editing](/docs/studio/logic/code)**.
3. The new entry appears with a placeholder name and its row open, so rename it first.

## Rename and delete

- To rename, edit the **Name** field at the top of an entry's editor. The change commits when you press :kbd[Enter] or leave the field. A name that is empty, or that the document already uses, is refused and the reason appears under the field. The document keeps the name it had. Everything that referred to the old name keeps its old reference, so rename before you wire an entry into formulas and events.
- To delete, click the trash icon on the entry's row.

## Plain values

A **Value** is the workhorse: the counter, the search text, the "menu open" flag. Its editor offers:

- **Type**: `string`, `integer`, `number`, `boolean`, `array`, or `object`. Defaults you type are converted to match.
- **Format**, for strings only: `image`, `date`, or `color`. An image-formatted value gets a media picker for its default.
- **Options**, for strings and numbers: the values the entry may hold, separated by commas (`left, center, right`). They are saved as the entry's `enum`, the **Default** becomes a choice among them, and a component's setting is offered as a dropdown of them wherever the component is placed. Clear the field to accept any value again.
- **Default**: the starting value. Array and object defaults are typed as JSON.
- **Description**: a note to your future self, also shown when the component is used elsewhere.

## Computed values

A **Computed** entry derives its value from other entries: a total from a price and a quantity, a filtered list from a search box. Type the calculation in the **Expression** field, referring to other entries by name (`$price * $qty`). Studio detects which entries the expression depends on and lists them underneath; the value recalculates whenever any of them changes.

## Functions

A **Function** entry is behavior you can bind to events or call from formulas. Its editor offers:

- **Description**: what the function does.
- **Parameters**: type a name and press :kbd[Enter] to add one as a chip; **Advanced** switches to full rows with a type, description, and optional flag per parameter.
- **Body**, with a **Statements**/**Code** toggle: build the body as visual steps, or write JavaScript. See **[Statements](/docs/studio/logic/statements)** and **[Code editing](/docs/studio/logic/code)**.

A function the document's own script exports shows **Script** with an **Open in code editor** button instead of a body, and one stored in a separate file shows **Source** and **Export** fields. See **[A document's script](/docs/studio/logic/code#a-documents-script)**.

## Components: props, attributes, and events

When the open file is a component, its plain state entries double as the component's options, the values a page can set when it uses the component. Component files add a few fields:

- On plain values: **Attribute** (the HTML attribute that sets this value), **Reflects**, and **Deprecated**. Every entry that names an attribute is listed back on the Logic tab's **Observed Attributes** section when the component's root is selected. That section is the read-out; this panel is where you declare it.
- On functions: an **Emits** list declaring the events the component can send, each with a name, type, and description. Declared events show up in the Inspector's **[Logic tab](/docs/studio/logic/events)** wherever the component is used.

An entry's **Default** is what an instance falls back to, and it is what the instance's provenance chip names: a setting left alone on the instance reads _from the component default_, and clicking that chip opens the component file this panel belongs to. See **[Working with components](/docs/studio/design/components)**.

Name an entry with a leading `#` (like `#cache`) to keep it private: private entries never become component options and are left out of the component's published description.

:::doc-note
Everything in this panel is written to the `state` object of the open file's JSON. The shapes Studio writes are documented in **[Components](/docs/framework/concepts/components)** and **[Reactivity](/docs/framework/concepts/reactivity)**: plain values, computed entries, `$prototype` sources, functions.
:::

## Fetched once

While you edit, the canvas draws your real data. A **Fetch from a URL** source that uses `GET`, and a server function, each run **once** when you open the document. The answer is kept for as long as the tab stays open, and every re-render after that reuses it. Editing a page re-renders the canvas many times, so this is what keeps your edits from calling the API over and over.

- **Change the source and it fetches again.** The answer is kept against what the source asks for: its method, URL, headers and body, with any values in the URL filled in. Edit the URL and that is a new question, fetched once. Change it back and the earlier answer is still there.
- **Only `GET` runs.** A source with any other method (`POST`, `PUT`, `DELETE`, `PATCH`) changes something on a server, so the canvas never sends it. The same goes for a method that is not written as plain text. Its row reads **Not run**, its editor ends with **Runs on the live page**, and anything bound to it on the canvas says the same.
- **A failure is kept too.** A source that failed stays failed until you ask again. Its row reads **Failed**, and its editor ends with the reason.
- **Nothing waits.** The page is drawn straight away and fills in when the answer arrives. A request with no answer after 30 seconds is given up as failed.

Everything listed in this panel that holds a value is also what a [dynamic tag](/docs/studio/editing/dynamic-tags) can read: a tag's **Source** and the **Insert dynamic tag** list offer the same entries, with the values inside them, by name.

On the canvas, text bound to a source with no value never shows its expression. It shows the binding's name and one of the same three states, quietly underlined: **Loading**, **Could not load** or **Runs on the live page**. A binding whose own expression fails, such as reading a field of a value that is `null`, says **Has an error** instead, with the error when you rest the pointer on it. Nothing failed to load there: the expression needs fixing.

## Refresh

Click **Refresh** in the panel's toolbar to fetch everything again: Studio forgets the answers it kept for this tab, re-reads the collections your lists use, and re-renders the canvas. Use it after the data behind a URL has changed, or to retry a source that failed. The button says **Refreshing…** until every source has answered or failed, so a slow fetch looks slow rather than looking like a button that did nothing.

:::doc-note
To see a `POST` run, or a server function with your deployment's real secrets, use **[Open in Browser](/docs/studio/interface#command-bar)**, where the page behaves as it will on the built site.
:::

## Set a value for the canvas

Nothing you click on the editing canvas runs, so a state the page only reaches through a click (a menu that is open, a tab that is chosen, a form that has failed) is never drawn there by itself. To look at it, set the value for the canvas:

1. Open a plain value's row. Its editor ends with an **On canvas** field.
2. Choose or type the value to draw. A flag offers `true` and `false`, a value with **Options** offers those, and anything else is a text field, read as the entry's own type (a number for a number, JSON for a list or an object).
3. The canvas re-renders with that value. Nothing is fetched again.

The row now shows the value you set, in the accent color with an `=` in front, and gains a **Use the document's value** button. A long value is cut short in the row, so rest the pointer on it to read it whole. Click the button, or pick the first choice in the **On canvas** field, to go back. Setting the value the document already holds goes back too, since there is nothing to set.

A value set this way is part of your editing session, like the row you last clicked in a list. It is never written to the file, so it does not mark the document as changed and there is nothing to undo. Only plain values have the field: a computed value, an expression, a function and a data source get their value from somewhere else.

The same thing is a command, **Set State Value on Canvas** (`canvas.setStateValue`), which takes the entry's `key` and a `value`, where `null` clears it.

## Test values for component options

A component file renders on the canvas with its options at their defaults. To see it with real-looking data, open the context bar's **resolving with** popover: one field per component option, stacked, as introduced in **[Modes and views](/docs/studio/interface/modes)**.

1. Open a component file. The context bar shows a field named after each option.
2. Type a test value. Values that read as JSON are treated that way (`42` is a number, `true` a flag, `["a","b"]` a list), and anything else is text.
3. The canvas re-renders with the value, and this panel, template previews, and formula badges all see it.
4. Clear the field to return that option to its authored default.

Test values are a preview aid. They live with your editing session, not in the component file.

![The Data panel with state entries expanded into live data trees](../../images/data-explorer.png)

## Debug with it

- A Request that reads **Failed** has the reason in its editor: usually a wrong URL, or a server that did not answer. Fix the URL and it fetches again, or click **Refresh** to retry the same one.
- A Request that reads **Not run** is not broken. Its method is not `GET`, so the canvas does not send it.
- A computed value that shows the wrong result: open the entries it depends on and read what they actually resolved to; most "formula bugs" are surprising input data.
- Want to see what an event leads to? Set the entry it writes with the **On canvas** field and look at the canvas, or trigger the event for real in the tab **Open in Browser** gives you.

## Next

- Feed these entries from files, APIs, and the browser with **[Data sources](/docs/studio/logic/data-sources)**
- Bind them to clicks and keystrokes in the Inspector's **[Logic tab](/docs/studio/logic/events)**
- The same live values ride along in the **[formula workspace](/docs/studio/logic/formula-workspace)**'s data rail
