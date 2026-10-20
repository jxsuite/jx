---
title: "Pages, layouts, and components"
description: "When to use a page, a layout, or a component in Jx Studio, how to create each one with Add new, and where each lives in your project folder."
spec:
  - site-architecture.md#2
code:
  - packages/studio/src/create/add-new.ts
  - packages/studio/src/create/add-new-flow.ts
  - packages/studio/src/create/add-new-commands.ts
  - packages/studio/src/surfaces/add-new.ts
  - packages/studio/src/browse/library-model.ts
  - packages/studio/src/browse/library-pane.ts
  - packages/studio/src/services/references.ts
  - packages/studio/src/files/file-ops.ts
  - packages/server/src/refactor/refs.ts
  - packages/server/src/refactor/find-refs.ts
  - packages/server/src/refactor/paths.ts
---

# Pages, layouts, and components

Everything you build in Studio is one of a few kinds of file. Knowing which is which, and when to reach for each, is most of what there is to learn about structuring a Jx site.

## Pages

A page is one address on your site. Each file in your project's `pages/` folder becomes one URL: the file named `index` is your home page, `about` becomes `/about`, and a file inside a `blog/` subfolder becomes `/blog/…`. Add a page and you've added a place visitors can go; delete it and the address is gone.

Routing details (dynamic addresses, catch-alls) live in **[Site architecture](/docs/framework/site)**.

## Layouts

A layout is the shared frame around your pages: the header, footer, and everything else that repeats on every page of a section. Layouts live in the `layouts/` folder, and each page picks the layout that wraps it, so changing the header in one layout changes it on every page that uses it.

Reach for a layout when you catch yourself rebuilding the same surroundings on a second page.

A layout can sit inside another one: a post layout that adds a byline can itself be wrapped in the base layout that carries the site's navigation and footer. The canvas draws the whole chain, the way the built site does, and the Site panel counts every page that names a layout, whether it writes `./layouts/post.json` or `layouts/post.json`.

## Components

A component is a reusable building block: a card, a hero section, a testimonial, a navigation bar. Components live in the `components/` folder and can be placed on any page or layout, as many times as you like. Edit the component once and every place it appears updates.

Reach for a component when the same element shows up more than once, or when a page is getting big enough that you want to name its parts. The underlying idea is documented in **[Components](/docs/framework/concepts/components)**.

## Create one

All three, and collections and uploads too, come from one dialog: **Add new**. Open it with :kbd[⌘N], the **+** at the top of the [Site panel](/docs/studio/interface#the-site-panel), **New page** in the [Content workspace](/docs/studio/projects/browse), or **Add New…** in the command palette. In a browser, which keeps :kbd[⌘N] for a new window, press :kbd[⌘⌥N] instead.

1. Pick what to make from the list on the left: **Page**, **Collection**, **Template** (what this page calls a layout), **Component** or **Media**. Once your project has a content collection, **Entry** is there too.
2. Type a name. It is the only thing the dialog requires, and the cursor is already in the field.
3. Adjust the options for that kind, if you want to (below), and click the button, which says what it makes: **Create page**, **Create template**, and so on. :kbd[Enter] does the same, and :kbd[Escape] closes the dialog.

The line above the buttons says what will be written before you write it: _Saved as pages/pricing.json · opens at /pricing_. You never type a file name or an extension; Studio derives them from the name. A name the folder already holds is refused under the field, so nothing is ever overwritten.

| Kind      | Options                                                                                                                                                             | What it writes                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Page      | **Start from** one of your templates, **Article** for a page that is mostly writing, or **Blank**; **Edit** changes the URL; **Language** in a multilingual project | `pages/<name>.json`, or a Markdown `.md` for an Article, using the template you chose. A page in another language goes in that language's folder, so a French page is `pages/fr-ca/<name>.json` at `/fr-ca/<name>` |
| Template  | **Wrap it in** another template, or **Nothing** for a fresh frame                                                                                                   | `layouts/<name>.json` with one slot, where the pages that use it go                                                                                                                                                |
| Component | **Start from** **Blank**, the **Current selection** on the canvas, or a **Copy of…** an existing component                                                          | `components/<tag>.json`, where the tag is the name in lower case with a hyphen (`Hero` becomes `site-hero`)                                                                                                        |
| Media     | Drop files on the dialog, or **Browse files**                                                                                                                       | The files, in `public/media/`                                                                                                                                                                                      |

In a [multilingual project](/docs/framework/site/i18n), Page has a **Language** picker that starts on the site's default language. Choosing another one moves the file into that language's folder, and the line above the buttons shows the new path and URL before you create anything. Until you pick a template yourself, the page starts in its language's own template when your project has one named for the language (`layouts/fr-ca.json` for a French page), and in your default template otherwise.

A new page, template or component opens in a tab, ready to edit, and a new component is in the Site panel's **Components** and the [Insert palette](/docs/studio/design/elements) straight away. An upload opens the [Media workspace](/docs/studio/projects/media#the-media-workspace) with the first file selected. Collections and entries are covered in **[Content types](/docs/studio/projects/content-types)**.

![The Content workspace showing the Pages collection as cards with live previews, with the Collections panel on the left](../../images/mode-manage.png)

:::doc-note
Studio writes each new file into `pages/`, `layouts/`, or `components/` in your project folder. They are plain files you can rename, duplicate, or delete from the right-click menu of the Files panel, or, for a page, of the Content workspace.
:::

## Where is it used?

Once a component is placed on a few pages, the useful question stops being "what does this do?" and becomes "what depends on it?" Select any component instance on the canvas and the inspector answers, right under its settings: **Used on 3 pages and 1 other file**. Expand it for the list, and click any row to open that file.

The same answer is reachable by name: **Find Usages** in the command palette, or in the right-click menu on a component.

:::doc-tip
The count separates **pages** from **other files** on purpose. A component used only inside another component has not been placed on your site yet, and its line says so plainly: **Used in 1 file**, with no page in it. A component used on seven pages is load-bearing.
:::

### Before you delete, rename or convert

Every delete, rename and convert confirmation carries that same count, so you can see what an action breaks before you take it, not after.

- **Deleting** a file tells you how many references stop resolving, and that the files holding them stay exactly where they are. Only the references break.
- **Renaming** a file tells you how many references will be **updated automatically**. Studio rewrites them across the project, in pages, layouts, components, `project.json`, and the front matter of content entries. For a component it renames the element tag to match the new filename too.

Renaming a **folder** counts too. If a content collection's `source` points at the folder you are moving, `project.json` follows it, and so does a file named by `project.json`'s `copy` map, which lists the extra files a build copies into the output. The copy map's destinations are paths inside the built site, so those are left alone: moving a file in your project does not move where the build puts it.

- **[Converting](/docs/studio/interface#converting-a-file-to-another-format)** a file to another format tells you the same, in its own words: those references are repaired, but the file itself is not the file it was, so the rename's "nothing else changes" would be untrue. It adds what the file is becoming, and whether it will read back identically.

If Studio cannot count (a backend without project search), the confirmation says so rather than showing a zero. "We could not check" and "nothing uses this" are never displayed as the same thing.

:::doc-note
A CSV content collection is a data source Studio loads entries from rather than a document it round-trips, so it is never rewritten wholesale. A reference inside one is still repaired: Studio replaces that cell's text and leaves the rest of the file byte for byte as you wrote it, quoting and line endings included. Where a reference genuinely cannot be updated (a file that will not parse), the rename says so, reporting a **warning** that names the files instead of a plain "Renamed", so you know where to look. Dragging a file to a new folder in the Files panel does the same refactor, and reports the same way, as does converting one to another format.
:::

## Which one do I want?

- **A destination** people should be able to visit → a **page**.
- **The frame** that repeats around many pages → a **layout**.
- **An element** that repeats within pages → a **component**.

When in doubt, start with a page. You can always select part of it later and grow that part into a component once it earns reuse.

## Next

- **[Design mode](/docs/studio/design)**: style what you just created on the live canvas
- **[Edit mode](/docs/studio/editing)**: write content inline
- **[Site architecture](/docs/framework/site)**: the folder-by-folder anatomy underneath
