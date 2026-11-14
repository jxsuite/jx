---
title: "The Jx framework: your site is JSON"
$head:
  - tagName: meta
    attributes:
      name: description
      content: "Jx compiles JSON and Markdown documents into prerendered HTML:
        file-based routing, @vue/reactivity islands, and an optional worker for
        accounts and data."
  - tagName: meta
    attributes:
      property: og:title
      content: Your site is JSON.
  - tagName: meta
    attributes:
      property: og:description
      content: Pages, styles, state and server logic as declarative documents.
        Prerendered to HTML, validated by JSON Schema 2020-12, open under MIT.
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/page-hero.json
  - $ref: ../components/site-section.json
  - $ref: ../components/fact-item.json
  - $ref: ../components/text-link.json
  - $ref: ../components/interactive-demo.json
  - $ref: ../components/site-close.json
---

:::page-hero{props.heading="A web framework whose source is JSON" props.lead="Pages, components, styles, state and server functions are JSON and Markdown documents on disk. The compiler prerenders them to HTML, the runtime wakes the parts that move, and git holds all of it."}
::cta-button{props.href="/docs/framework" props.label="Read the framework docs" props.variant="primary"}

::cta-button{props.href="https://github.com/jxsuite/jx" props.label="See the source on GitHub" props.variant="secondary" props.newTab="true"}
:::

:::::site-section{id="demo" props.ground="alt" props.heading="One counter, as source, output and element" props.lead="The first tab is the document you author. The second is the custom element the compiler writes from it. The third is that element running in this page."}
::interactive-demo

:::p{style.margin="0 0 1rem" style.maxWidth="62ch" style.fontSize="1rem" style.lineHeight="1.6" style.color="var(--color-text-secondary)" style.marginTop="1.5rem"}
A document names DOM properties, holds its own state and carries its own styles, so there is no intermediate representation to learn or to debug. A page with nothing interactive on it emits none of this and ships no JavaScript.
:::
:::::

:::::site-section{id="parts" props.heading="Four jobs in one framework" props.lead=""}
::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr"}
::fact-item{props.title="File-based content" props.text="Content is Markdown and JSON in your repository, with schemas saying what a post must have. Review, branching and rollback are git's job. The tradeoff: an editor needs Studio or a git checkout."}

::fact-item{props.title="Reactive components" props.text="Declare state on a document and bind it into the tree. Interactive components hydrate as islands on real custom elements, with @vue/reactivity unmodified."}

::fact-item{props.title="Static generation" props.text="The build prerenders every page and writes a folder: HTML, CSS, responsive images, a sitemap and redirects. A folder goes on any host."}

::fact-item{props.title="Accounts and data" props.text="Add the auth and connector extensions and the build emits one worker beside the pages, with sessions, tables and per-table permission rules."}

::::
:::::

:::::site-section{id="accounts" props.ground="alt" props.heading="A login and a table in the project file" props.lead="Name a connection, say who may read and write each table, and pick an adapter. The build carries those declarations into the worker it writes."}
:::div{style.maxWidth="52rem" style.minWidth="0"}
```json
{
  "extensions": ["@jxsuite/connector", "@jxsuite/auth"],
  "connections": { "main": { "provider": "d1", "binding": "DB" } },
  "auth": { "connection": "main", "providers": { "github": {} } },
  "data": {
    "comments": {
      "connection": "main",
      "ownerField": "author_id",
      "permissions": { "read": "public", "insert": "authenticated", "update": "owner" }
    }
  },
  "build": { "adapter": "cloudflare-workers" }
}
```
:::
:::::

:::::site-section{id="layers" props.heading="Ten layers, one kind of file" props.lead="Core packages never depend on an extension, and a CI rule enforces it. The first-party extensions use the same public hooks yours would."}
:::div{style.overflowX="auto"}
| Layer   | What it covers                                                                                            |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Routing | File-based, with `[param].json` and `[...path].json` catch-alls enumerated at build time through `$paths` |
| Content | Markdown collections with frontmatter schemas, Jx Markdown directives, relationships                      |
| Styling | Design tokens, breakpoints, states and selectors, a forced color-scheme contract                          |
| Logic   | Reactive state, template expressions, declarative statements, sidecar JS modules                          |
| Server  | `timing: "server"` state entries compile to `POST /_jx/server/<fn>`, and secrets never leave the server   |
| Data    | D1, Supabase and SQLite connections, CRUD over `/_jx/data`, additive schema sync with `jx db push`        |
| Auth    | Better Auth sessions, sign-in flows and per-table permission rules over `/_jx/auth`                       |
| Search  | A build-time index over your content collections plus a headless browser client                           |
| Assets  | A responsive image pipeline, sitemap, robots and redirects                                                |
| Output  | Static HTML by default, with adapters for `cloudflare-workers`, `cloudflare-pages`, `node` and `bun`      |
:::
:::::

:::::site-section{id="agents" props.ground="alt" props.heading="A model edits the same documents" props.lead="The document format is the contract, so there is no second API for machine edits. A generated page is checked and reviewed like a hand-written one."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(3, 1fr)" style.gap="2rem" style.--md.gridTemplateColumns="1fr"}
::fact-item{props.title="jx schema" props.text="Writes the project and document schemas into the project root, each one self-contained, so a validator needs no network and no configuration."}

::fact-item{props.title="jx validate" props.text="One deterministic pass over the whole project. It prints one line per violation and exits non-zero, which makes it a CI gate and a write-check-fix loop."}

::fact-item{props.title="Studio's assistant" props.text="It edits through the same operations a person uses, so its changes land in undo and in your git diff. On the desktop you bring your own key. On Jx Cloud it runs on Workers AI in your Cloudflare account."}

::::
:::::

:::::site-section{id="standards" props.heading="Built on five web standards" props.lead="Jx extends dialects that already have specifications and tooling. Where it departs from one, the spec names the clause and says why."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(3, 1fr)" style.gap="2rem" style.--md.gridTemplateColumns="1fr"}
::fact-item{props.title="JSON Schema 2020-12" props.text="A document validates against a meta-schema generated from W3C webref data, so any 2020-12 validator checks it and your editor autocompletes it."}

::fact-item{props.title="JSON Pointer, RFC 6901" props.text="A $ref path is pointer syntax as written. The four deviations are listed in the spec, one by one."}

::fact-item{props.title="URLPattern" props.text="Dynamic routes and redirects use URLPattern pathname syntax: named parameters, wildcards and catch-alls."}

::fact-item{props.title="Web Components v1" props.text="A component compiles to a custom element. Light DOM is the default, and a component that wants a shadow root asks for one."}

::fact-item{props.title="CSS nesting and custom properties" props.text="Nested selectors resolve the same way in the compiler and the runtime, and design tokens compile to custom properties."}

::::

:::div{style.marginTop="1.5rem"}
::text-link{props.href="/docs/extending/reference/standards" props.label="See every standard and every departure"}
:::
:::::

:::::site-section{id="quickstart" props.ground="alt" props.heading="A project from one command" props.lead="Scaffold a project and edit the files in whatever you like. Open the same folder in Studio when you would rather point than type."}
:::div{style.maxWidth="40rem" style.minWidth="0"}
```bash
bun create @jxsuite my-site
cd my-site
bun run dev
```
:::

:::div{style.marginTop="1.5rem"}
::text-link{props.href="/docs/start/first-project" props.label="Read the quickstart"}
:::
:::::

::site-close{props.heading="The framework is MIT licensed" props.text="Use it from the command line for nothing. When you want the visual editor, Jx Cloud is free for 30 days and the desktop app is free."}
