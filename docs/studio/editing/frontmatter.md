---
title: "Frontmatter and page metadata"
description: "Fill in titles, descriptions, social cards, and content-type fields on the Inspector's Page tab, then preview the head in Search appearance."
spec:
  - site-architecture.md#8.6
code:
  - packages/studio/src/panels/head-panel.ts
  - packages/studio/src/surfaces/panel-page.ts
  - packages/studio/src/panels/right-panel.ts
  - packages/studio/src/panels/seo-modal.ts
  - packages/studio/src/surfaces/seo.ts
  - packages/studio/src/panels/frontmatter-fields.ts
  - packages/studio/src/panels/provenance.ts
---

# Frontmatter and page metadata

Every page carries information that isn't part of its visible text: a title, a description for search engines, an image for social shares. Content like a blog post adds fields such as a date, an author, or tags. This is the page's _frontmatter_, and Studio edits all of it as plain forms.

All of it lives in one place: the **Page** tab of the Inspector. The canvas shows only the page itself, so in Edit view a page opens at the top with nothing docked above it, and its settings are a click away in the Inspector whichever view you are in.

## The Page panel

The Page panel is the Inspector's first tab. Click it, press :kbd[⌘⇧1] (:kbd[Ctrl+Shift+1] on Windows/Linux), or select nothing on the canvas: the Inspector switches to Page on its own when the selection goes away, and back to the element you select next. The tab is named for what the open file is (**Page**, **Template**, **Component**, **Entry**, or **Document**), and its sections, top to bottom, depend on the file you have open:

![The Inspector's Page tab for a page, showing its Layout, Page, and OpenGraph sections](../../images/document-panel.png)

A component has no page settings of its own, because its title, search and social details come from the page it is placed on. Its **Component** tab says so, and **Edit tag and props** selects the component's root, where Element › Content edits its tag name and the defaults of the props it takes.

### Frontmatter

For a content page that belongs to a collection (a blog post, a product, a listing), this section lists the collection's fields, with required ones marked `*`. Each field gets a control that fits its type:

- Text fields, number fields, and date fields (dates as `YYYY-MM-DD`)
- On/off checkboxes
- A dropdown for fields with a fixed set of choices
- A media picker for image fields
- A list editor for list fields: one row per item, with **Add** below and a remove button beside each (a list of pictures gets the media picker on every row)
- An entry picker for a field that points at another collection, so you choose an existing entry instead of typing its id from memory

Any extra field already present in the file appears too, even if the collection doesn't define it. Clearing a field removes it from the file entirely. Collections and their fields are defined in **[Content types](/docs/studio/projects/content-types)**.

### Layout

Site pages also get a **Layout** picker: keep the project default, choose a specific layout, or pick **None**; see **[Pages, layouts, components](/docs/studio/projects/pages-layouts-components)**. **Edit template** under it opens the layout the page is drawn in, so you can change the header or footer every page shares. A Markdown page keeps its choice as a `$layout` key in its frontmatter, and a JSON page on its root.

### Page

The basics every page should have:

- **Title**: the browser-tab and search-result title.
- **URL**: the address the page is published at, which comes from where its file sits in `pages/`. To change it, rename or move the file.
- **Description**: the summary search engines show under the title. A page has one description, and this field edits it wherever the page keeps it: a Markdown page's `description:` frontmatter key, or a description tag in the page's head. Because it is edited here, that frontmatter key is not listed again among the page's other fields.
- **Viewport**: leave the suggested default unless you have a specific reason not to.
- **Icon**: the small icon in the browser tab, picked from your media.

### OpenGraph

The card shown when the page is shared on social platforms: **Title**, **Description**, **Image**, and **Type**. If you fill in nothing else, fill in these and the Page section, because they're what links to your site look like elsewhere.

### Custom Tags

The escape hatch for everything else that can live in a page's head: analytics, a verification token, a webfont. Pick a tag (`meta`, `link`, or `script`), type its attribute and value, and click the add button or press :kbd[Enter] in either field. Existing custom entries are listed with a remove button each; before you add the first one the section says what it's for, with the add form right beneath. Most sites never need this section.

## Search appearance

**Search appearance** is a window of its own, and there are two ways in: the button beside the Page tab's **Page** heading (on a collection entry too, where the tab is titled **Entry**), and the command palette. Both open the same thing over the document you're working on.

The first thing it shows is not a form but two pictures of the finished page: a **Search result** preview (breadcrumb, title, description) and a **Social card** preview with its image, domain, headline and summary. Below them is the resolved-field list, then the warnings, and only then the controls that change any of it.

![Search appearance, open over a post: the search-result and social-card previews, the resolved fields, the warnings, and the fields that change them](../../images/seo-modal.png)

Every field commits as you type, and the previews above redraw with it. That is the reason it is a window rather than a panel: the previews want the width, and a search result rendered a third of a column wide is not a preview of anything.

:::doc-note
**The previews show the merged head, not just what this page declares.** A page's metadata is layered: the project's own `$head`, then the layout's, then the page's, with the later layer winning key by key. The title follows the same idea: the page's own title, or the project name, or `Jx Site` if nothing supplies one. What the previews draw is the result, which is what a search engine or a chat app will actually see.
:::

### The resolved fields

One row per value that reaches the browser: Title, Description, Social title, Social description, Social image, Social type. Each row shows the merged value, a character count against the length at which that field gets cut (`47/160`), and a chip saying where the value came from.

The count is of **characters as you see them**: an emoji counts as one, a flag counts as one, and an accented letter counts as one however it was typed. That is not what `length` gives you in most tools: it counts a rocket as two and a flag as four, so a headline with three emoji used to report six characters of budget it had not spent. The count is not a measure of _width_, and deliberately so: a search result truncates on pixels, in a font the engine picks at a size it picks, and any number here claiming to predict that would be a guess wearing a measurement's clothes.

A value this page sets shows the ordinary set dot. A value it inherits is marked **inherited** and names its donor: _from Base_ for a layout, _from Site head_ or _from Site name_ for the project, _from the build_ for a value the build supplies on your behalf. The two chips that lead somewhere are clickable and open the setting in Project Settings; the layout and build chips are plain text, because the card has no verb for them.

That marking is the whole point. A page inheriting its description from the site is not a page missing a description, and until the preview said which was which, the two looked identical.

### The warnings

A named list, in plain language, of things that are wrong or absent. It is decided on the **merged** value, so a page that inherits a description is never told it has none. Among them:

- Nothing names a title, so the build ships `Jx Site`.
- No description reaches this page from the site, its layout, or the page itself, so a result row will show whatever text the engine picks instead.
- No `og:title`, `og:description`, or `og:image`: a shared link with no headline, no summary, or a text-only card.
- A field is longer than its budget, with the actual length: _Description is 187 characters; summaries are cut near 160._
- Project Settings names no site URL, so the build emits no canonical link and no `og:url`.

:::doc-note
**These warnings also appear in Problems**, in the Bottom dock, filed the moment you open this window. Studio flags a page shipped with no description so it is caught even when this window is closed. Problems is where Studio keeps issues waiting to be fixed. Each row opens this window again.

There is a companion check for accessibility: **Check Accessibility** in the command palette reads the open document and files a Problem for each thing an author can fix, such as an image with no alt text, a control with no label, a skipped heading level, a link that reads "click here", a duplicate id. Every row names the WCAG criterion it comes from. It also always files two rows saying what it could **not** check: color contrast and target size are properties of the built page in a browser, not of the document, so a report that stayed silent about them would read as a clean bill it has no way to give.
:::

- A `<title>` element inside `$head` is discarded, because the build writes the title from the document's own title property.

When there is nothing to say, it says that too: _Nothing to flag — every previewed field resolves to a value._

:::doc-tip
**There is no score.** Counters and named warnings only. A single number out of a hundred adds unrelated facts together into a verdict, and the verdict is what ends up being optimized; a count beside a limit and a named consequence tell you the same thing without ranking anything.
:::

### The fields themselves

Under the warnings are the controls, in two groups named after the preview each one feeds. **Search result** holds **Description**, **Viewport** and the **Icon** picker; **Social card** holds the four OpenGraph fields. They're grouped because they collide: Open Graph has its own Title, Description and Image, and in one flat column "Description" named two different fields.

These edit exactly what the Page panel's Page and OpenGraph sections edit: the same values, from wherever you happen to be working.

:::doc-note
On disk, all of this lives at the top of the page's own file, in a small labeled block above the content: the frontmatter. That's why metadata travels with the page: copy the file and everything comes along, and any text editor can read it.
:::

## Next

- Edit a whole collection's frontmatter at once in **[Grid mode](/docs/studio/editing/grid)**
- Define collections and their fields in **[Content types](/docs/studio/projects/content-types)**
- How the three layers merge, and what the build adds, in **[SEO and metadata](/docs/framework/site/seo)**
