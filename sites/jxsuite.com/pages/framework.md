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
  - $ref: ../components/pillar-card.json
  - $ref: ../components/section-label.json
  - $ref: ../components/interactive-demo.json
---

:::::hero{style.padding="clamp(4.5rem, 10vw, 7rem) clamp(1rem, 3vw, 2rem) clamp(3rem, 6vw, 4rem)" style.textAlign="center" style.background="radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59, 130, 246, 0.15), transparent)"}
::::div{style.maxWidth="820px" style.margin="0 auto"}
::section-label{props.text="The framework under Studio"}

:::h1{style.fontSize="clamp(2.25rem, 5vw, 3.75rem)" style.fontWeight="700" style.letterSpacing="-0.04em" style.lineHeight="1.1" style.margin="0 0 1.5rem" style.color="var(--color-text-primary)"}
The web already had a format.\
:span[Your site is JSON.]{style.color="var(--color-accent)"}
:::

:::p{style.fontSize="clamp(1.0625rem, 2vw, 1.25rem)" style.color="var(--color-text-secondary)" style.lineHeight="1.7" style.margin="0 auto 1rem" style.maxWidth="660px"}
Pages, components, styles, state, and server functions are all JSON and Markdown documents on disk. The compiler prerenders them to HTML, the runtime wakes up the parts that move, and git holds the whole thing.
:::

:::p{style.fontSize="0.9375rem" style.color="var(--color-text-muted)" style.margin="0 auto 2.5rem" style.maxWidth="620px" style.fontFamily="var(--font-mono)" style.letterSpacing="0.02em"}
Property names mirror the DOM. Reactivity is @vue/reactivity. Output is HTML.
:::

:::div{style.display="flex" style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap"}
::cta-button{props.href="/docs/framework" props.label="Read the framework docs" props.variant="primary"}

::cta-button{props.href="https://github.com/jxsuite/jx" props.label="View on GitHub" props.variant="secondary" props.newTab="true"}
:::
::::
:::::

::::::thesis{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="760px" style.margin="0 auto"}
:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1.5rem"}
The DOM was always the integration layer.
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0 0 2.5rem"}
HTML, CSS and JavaScript are three languages describing one tree, and every framework since 1995 has been a strategy for the plumbing between them: JSX, single-file components, a build step that mints an intermediate representation nothing else can read. The DOM already integrates structure, style and behavior, so Jx serializes it and calls that the source. A document names DOM properties, holds its own state, and carries its own styles, so there is no intermediate representation left to learn or to debug.
:::

```json
{
  "$id": "Counter",
  "state": {
    "count": 0,
    "increment": { "$prototype": "Function", "body": "state.count++" }
  },
  "tagName": "my-counter",
  "style": { "display": "flex", "gap": "1rem", "alignItems": "center" },
  "children": [
    { "tagName": "span", "textContent": { "$ref": "#/state/count" } },
    { "tagName": "button", "textContent": "+", "onclick": { "$ref": "#/state/increment" } }
  ]
}
```

:::p{style.color="var(--color-text-muted)" style.fontSize="0.9375rem" style.lineHeight="1.7" style.margin="1rem 0 0" style.textAlign="center"}
That file is the whole component. Studio edits it, the compiler reads it, a model writes it, and git diffs it a line at a time.
:::
:::::
::::::

::::::demo{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto"}
::::div{style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="Source, compiled, running"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
The same counter, three ways to look at it.
:::

:::p{style.color="var(--color-text-secondary)" style.maxWidth="680px" style.margin="0 auto" style.fontSize="1.0625rem" style.lineHeight="1.7"}
The first tab is the document you author. The second is the custom element the compiler writes from it, `@vue/reactivity` and all. The third is that element running in this page, and its buttons work. A page with nothing interactive on it emits none of this and ships no JavaScript at all.
:::
::::

::interactive-demo
:::::
::::::

::::::pillars{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto"}
:::div{style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(280px, 100%), 1fr))" style.gap="1rem"}
::pillar-card{props.icon="📄" props.title="File-based CMS" props.description="Content lives as Markdown and JSON in your repository, with frontmatter schemas saying what a post must have before it counts as one. There is no content database to run and no admin panel to secure, so review, branching and rollback are git's job. The tradeoff is worth saying out loud: an editor needs Studio or a git checkout, because there is no URL and password to hand out." props.features="Content collections · Markdown directives · Frontmatter schemas · Dynamic routes"}

::pillar-card{props.icon="⚡" props.title="Reactive framework" props.description="Declare state on a document, bind it into the tree with template expressions, and let the compiler decide what has to ship. Interactive components hydrate as islands, one at a time, on real custom elements, and the rest of the page stays HTML and CSS. Reactivity is @vue/reactivity, the published package, unmodified." props.features="@vue/reactivity · Web Components · Template expressions · Island hydration"}

::pillar-card{props.icon="🚀" props.title="Static generator" props.description="The build prerenders every page and writes a folder: HTML, CSS, responsive images, sitemap, redirects. A folder goes anywhere, so take your pick of Cloudflare Pages, GitHub Pages, Vercel, or a $5 VPS, an illustrative third-party hosting price and theirs to change. Adapters for cloudflare-workers, cloudflare-pages, node and bun cover the projects that outgrow a static host." props.features="No JavaScript on static pages · Responsive images · Sitemap and redirects · Cloudflare, Node and Bun adapters"}

::pillar-card{props.icon="🔐" props.title="Accounts and data" props.description="Some sites need a login. Add the auth and connector extensions, pick a server adapter, and the build emits one small worker beside the pages: sessions at /_jx/auth, your tables at /_jx/data, and per-table permission rules from the roles you declared in project.json. A state entry marked timing server compiles to an endpoint of its own, so keys and queries stay on the server. The pages themselves stay prerendered, so every visitor is served the same HTML and the logged-in view renders in the browser." props.features="Better Auth sessions · D1, Supabase, SQLite · Server functions · Per-table permissions"}
:::

:::p{style.color="var(--color-text-muted)" style.fontSize="0.9375rem" style.lineHeight="1.7" style.textAlign="center" style.margin="2.5rem auto 1rem" style.maxWidth="700px"}
A project that needs a login and a table declares both in `project.json`, and the build carries the declarations into the worker it writes.
:::

::::div{style.maxWidth="760px" style.margin="0 auto"}

```json
{
  "extensions": ["@jxsuite/connector", "@jxsuite/auth"],
  "connections": {
    "main": { "provider": "d1", "binding": "DB" }
  },
  "auth": {
    "connection": "main",
    "providers": { "github": {} },
    "roles": ["admin"]
  },
  "data": {
    "comments": {
      "connection": "main",
      "ownerField": "author_id",
      "permissions": {
        "read": "public",
        "insert": "authenticated",
        "update": "owner"
      },
      "schema": {
        "type": "object",
        "properties": { "message": { "type": "string" } }
      }
    }
  },
  "build": { "adapter": "cloudflare-workers" }
}
```

::::

:::::
::::::

::::::stack{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="900px" style.margin="0 auto"}
::::div{style.textAlign="center" style.marginBottom="2.5rem"}
:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Every layer is the same kind of file.
:::

:::p{style.color="var(--color-text-secondary)" style.maxWidth="680px" style.margin="0 auto" style.fontSize="1.0625rem" style.lineHeight="1.7"}
This is the same list the repository README carries, so nothing in it was written for a marketing page. Core packages never depend on an extension and a CI rule enforces it, which is why the first-party extensions in it use the same public hooks yours would.
:::
::::

:::::div{style.marginTop="0.5rem"}
::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Routing
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
File-based. `[param].json` and `[...path].json` catch-alls, enumerated at build time via `$paths`
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Content
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
Markdown collections with frontmatter schemas, Jx Markdown directives, relationships
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Styling
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
Design tokens, breakpoints, states and selectors, a forced color-scheme contract
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Logic
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
Reactive state, template expressions, declarative statements, sidecar JS modules
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Server
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
`timing: "server"` state entries compile to `POST /_jx/server/<fn>`; secrets never leave the server
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Data
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
D1, Supabase, and SQLite connections; CRUD over `/_jx/data`; additive schema sync via `jx db push`
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Auth
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
Better Auth sessions, sign-in flows, and per-table permission rules over `/_jx/auth`
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Search
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
A build-time index over your content collections plus a headless browser client
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Assets
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
Responsive image pipeline (WebP/AVIF), sitemap, robots, redirects
:::
::::

::::div{style.display="grid" style.gridTemplateColumns="150px 1fr" style.gap="0.35rem 1.5rem" style.padding="1.125rem 0" style.borderTop="1px solid var(--color-border-subtle)" style.--sm.gridTemplateColumns="1fr"}
:::div{style.fontFamily="var(--font-mono)" style.fontSize="0.8125rem" style.fontWeight="600" style.color="var(--color-accent)" style.letterSpacing="0.02em"}
Output
:::

:::div{style.color="var(--color-text-secondary)" style.fontSize="0.9375rem" style.lineHeight="1.7"}
Static HTML by default; adapters for `cloudflare-workers`, `cloudflare-pages`, `node`, and `bun`
:::
::::
:::::
:::::
::::::

::::::agents{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="Built for agents"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
A model edits the same artifact you do.
:::

:::p{style.color="var(--color-text-secondary)" style.maxWidth="660px" style.margin="0 auto" style.fontSize="1.0625rem" style.lineHeight="1.7"}
The document format is the contract, so there is no second API for machine edits: a generated page is checked and reviewed exactly like a hand-written one.
:::
:::::

:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(300px, 100%), 1fr))" style.gap="1rem"}
::::div{style.padding="2rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-secondary)"}
:::h3{style.fontSize="1.125rem" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 0.75rem" style.fontFamily="var(--font-mono)" style.color="var(--color-text-primary)"}
jx schema
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
Writes `project.schema.json` and `document.schema.json` into the project root, composed from the core schemas plus a fragment from every enabled extension. Each is one self-contained resource whose every internal reference points into the same file, so a validator resolves it with no `node_modules`, no network and no configuration.
:::
::::

::::div{style.padding="2rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-secondary)"}
:::h3{style.fontSize="1.125rem" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 0.75rem" style.fontFamily="var(--font-mono)" style.color="var(--color-text-primary)"}
jx validate
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
One deterministic pass over the whole project: `project.json`, every document under pages, components and layouts, every class file, every extension fragment. It prints one line per violation and exits non-zero, which makes it a CI gate for machine-written documents and a write-check-fix loop for whatever is writing them.
:::
::::

::::div{style.padding="2rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-secondary)"}
:::h3{style.fontSize="1.125rem" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
Studio's assistant
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
Describe a change and the assistant makes it through the same document operations a person uses, so an AI edit lands in the undo stack and in your git diff like any other. Today it is bring your own key: Studio ships no account and no hosted model, and sends nothing anywhere until you connect a provider.
:::
::::
:::::

:::p{style.color="var(--color-text-muted)" style.fontSize="0.9375rem" style.lineHeight="1.7" style.textAlign="center" style.margin="2rem auto 0" style.maxWidth="700px"}
The repository also carries `.claude/commands/jx.md`, a ready-made `/jx` authoring command for coding agents working inside a Jx project.
:::
::::::

::::::standards{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="Standards, not inventions"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
The primitives already existed.
:::

:::p{style.color="var(--color-text-secondary)" style.maxWidth="700px" style.margin="0 auto" style.fontSize="1.0625rem" style.lineHeight="1.7"}
Five years ago, building this would have meant inventing half a dozen formats and asking everyone to learn them. The browser now ships every primitive it needs, so Jx extends dialects that already have specifications and tooling behind them. Where it departs from one, the spec names the clause and says why, and the alignment tables list every standard the project binds, its conformance class, and the code that answers for it.
:::
:::::

:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(300px, 100%), 1fr))" style.gap="1rem"}
::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
JSON Schema 2020-12
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
A document validates as an instance against a meta-schema generated from W3C webref data, so any 2020-12 validator checks it and your editor autocompletes it. One limit, stated in the spec: Jx declares no `$vocabulary`, so it is not a JSON Schema dialect in the normative sense, and a standards-only processor ignores its reserved keywords.
:::
::::

::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
JSON Pointer, RFC 6901
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
A `$ref` path is pointer syntax as written, `~0` and `~1` escapes included, with `/` as the sole separator. The four deviations are enumerated rather than glossed: a `$ref` binds a live value off the reactive scope, and a token that matches nothing yields `undefined` instead of failing evaluation the way RFC 6901 section 4 requires.
:::
::::

::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
URLPattern
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
Dynamic routes and redirects use URLPattern pathname syntax: named parameters, wildcards, catch-alls. The filesystem decides the URL and the pattern decides its shape, and a dynamic route enumerates its concrete paths at build time through `$paths`.
:::
::::

::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
Web Components v1
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
A component compiles to a custom element, defined and upgraded the way the HTML standard describes. Light DOM is the default, so your page styles reach inside it and browser devtools inspect it with no special panel; slot distribution is emulated there, and a component that wants a real shadow root and real slots asks for one with `$shadow`.
:::
::::

::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
CSS nesting and custom properties
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
Style keys beginning with a colon, a dot, an ampersand or a bracket are nested selectors, resolved recursively by both the compiler and the runtime. Design tokens are custom properties compiled to `:root`, so any component reads `var(--color-primary)` without importing anything.
:::
::::
:::::

::::div{style.textAlign="center" style.marginTop="2.5rem"}
:::a{style.color="var(--color-accent)" style.textDecoration="none" style.fontWeight="600" style.fontSize="1rem" href="/docs/extending/reference/standards"}
See every standard, and every place Jx departs from one →
:::
::::
::::::

::::::quickstart{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="760px" style.margin="0 auto" style.textAlign="center"}
:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Start with one command.
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0 0 2rem"}
Scaffold a project, then edit the files in whatever you like. From there the `jx` CLI does the rest: dev with live reload, build to `dist/`, preview a build, generate schemas, validate the project. Open the same directory in Studio when you would rather point than type, because the CLI and the desktop app read and write the same files, so moving between them is not a migration.
:::

```bash
bun create @jxsuite my-site
cd my-site
bun run dev
```

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="2rem 0"}
One command turns the project into a folder, and what is in that folder decides where it can go.
:::

```text
$ jx build

✓ Compiled pages
✓ Optimized images (webp, avif)
✓ Generated sitemap.xml
✓ Output: ./dist

# Static host? Ship ./dist.
# Accounts or data? Set an adapter, and a worker ships alongside it.
```

:::div{style.display="flex" style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap" style.marginTop="2rem"}
::cta-button{props.href="/docs/start/first-project" props.label="Read the quickstart" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::
:::::
::::::
