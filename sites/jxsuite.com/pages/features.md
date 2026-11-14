---
title: "Features of Jx Studio and the Jx framework"
$head:
  - tagName: meta
    attributes:
      name: description
      content: "Design pages, write content, add interactivity, accounts and data, and publish. Jx saves all of it as plain JSON and Markdown you keep."
  - tagName: meta
    attributes:
      property: og:title
      content: "Features of Jx Studio and the Jx framework"
  - tagName: meta
    attributes:
      property: og:description
      content: "Design, content, interactivity, accounts, data and publishing, all saved as plain files."
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
  - $ref: ../components/site-close.json
---

:::page-hero{props.heading="Features of Jx Studio and the framework" props.lead="Studio is where you write pages, design them, add the parts that move, and publish. Underneath, Jx turns all of it into plain HTML you can host anywhere."}
::cta-button{props.href="https://studio.jxsuite.com/" props.label="Start a free trial" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::

:::::site-section{id="design" props.ground="alt" props.heading="Design on a live canvas" props.lead="The canvas renders the real page, so there is no preview mode to switch to."}
:::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)"}
::img{style.display="block" style.width="100%" style.height="auto" style.aspectRatio="16 / 7" style.objectFit="cover" style.objectPosition="top" sizes="(max-width: 1380px) 92vw, 1280px" src="/content/docs/images/mode-design.png" width="3840" height="2000" alt="Jx Studio's design view with one component at several screen widths" loading="lazy" decoding="async"}
:::

::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr" style.marginTop="2.5rem"}
::fact-item{props.title="Edit text in place" props.text="Click any text on the page and type."}

::fact-item{props.title="Full style control" props.text="Spacing, type, color and layout, with hover states and design tokens."}

::fact-item{props.title="Every screen width" props.text="Check and adjust the layout at phone and tablet widths."}

::fact-item{props.title="Logic in panels" props.text="Clicks, forms and data are wired up in structured panels."}

::::
:::::

:::::site-section{id="content" props.heading="Content lives in files" props.lead="Pages and posts are Markdown and JSON in a folder, so there is no content database to run and no admin panel to secure."}
::::div{style.display="grid" style.gridTemplateColumns="5fr 7fr" style.gap="clamp(2rem, 4vw, 4rem)" style.alignItems="start" style.--lg.gridTemplateColumns="1fr"}
:::div{style.display="flex" style.flexDirection="column" style.gap="1.75rem"}
::fact-item{props.title="Markdown with rich blocks" props.text="Components sit inside Markdown as directives, and the file stays readable."}

::fact-item{props.title="Collections with a schema" props.text="A content type says what every post must have before it counts as one."}

::fact-item{props.title="Addresses follow folders" props.text="A page's URL is where you put its file."}

::fact-item{props.title="History for every change" props.text="Git records each edit, and any version can come back."}

:::

:::div{style.minWidth="0"}
```text
my-site/
├── pages/
│   ├── index.md
│   ├── about.json
│   └── blog/
│       └── [slug].json
├── content/
│   └── posts/
│       ├── hello-world.md
│       └── launch-day.md
├── components/
│   ├── hero.json
│   └── card.json
├── layouts/
│   └── base.json
└── project.json
```
:::
::::
:::::

:::::site-section{id="interactivity" props.ground="alt" props.heading="Interactive parts ship alone" props.lead="Add a toggle, a filter, a form or a list that fills itself from data. Jx sends the browser only the pieces that move."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr"}
::fact-item{props.title="No JavaScript on static pages" props.text="A page with nothing interactive on it is HTML and CSS."}

::fact-item{props.title="Standard custom elements" props.text="A component compiles to the browser's own custom element."}

::fact-item{props.title="Published reactivity" props.text="State is made reactive by the @vue/reactivity package, unmodified."}

::fact-item{props.title="Built-in pieces" props.text="Fetch data, store choices and handle forms without writing a framework."}

::::
:::::

:::::site-section{id="accounts" props.heading="Accounts and a database, when you need them" props.lead="Turn on the auth and data extensions and the build writes one small server program beside the pages. Keys and queries stay on the server."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr"}
::fact-item{props.title="Sign-in" props.text="Email and password or social sign-in, through Better Auth."}

::fact-item{props.title="Per-table rules" props.text="Each table is public, authenticated, owner-only or limited by role."}

::fact-item{props.title="Three databases" props.text="Connect Cloudflare D1, Supabase or SQLite."}

::fact-item{props.title="Server functions" props.text="A function marked for the server runs there, so secrets never reach the browser."}

::::
:::::

:::::site-section{id="publishing" props.ground="alt" props.heading="One folder to publish" props.lead="One command turns the project into a folder: every page as finished HTML, images sized for each screen, a sitemap and your redirects."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr"}
::fact-item{props.title="Any static host" props.text="GitHub Pages, Cloudflare, Vercel or your own server."}

::fact-item{props.title="Images in modern formats" props.text="The build writes AVIF and WebP at the widths each screen needs."}

::fact-item{props.title="Server adapters" props.text="Cloudflare Workers, Cloudflare Pages, Node and Bun, for projects with accounts or data."}

::fact-item{props.title="No server otherwise" props.text="There is no PHP, no container and no database behind a static site."}

::::

:::div{style.display="flex" style.flexWrap="wrap" style.gap="0.5rem 2rem" style.marginTop="1.5rem"}
::text-link{props.href="/compare" props.label="Compare Jx with other tools"}

::text-link{props.href="/framework" props.label="Read the framework guide"}
:::
:::::

::site-close{props.heading="Jx Cloud is free for 30 days" props.text="Open Studio in a browser tab and build a page. The desktop app is free, and both open the same project."}
