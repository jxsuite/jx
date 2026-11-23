---
title: "Jx: a visual website builder that saves plain files"
$head:
  - tagName: meta
    attributes:
      name: description
      content: Design pages on a canvas or describe them to the assistant. Jx saves JSON and Markdown to your own repository. Run it in a browser with Jx Cloud, or free on desktop.
  - tagName: meta
    attributes:
      property: og:title
      content: "Jx: a visual website builder that saves plain files"
  - tagName: meta
    attributes:
      property: og:description
      content: Jx Studio runs in a browser tab with Jx Cloud, or free on your desktop. Either way your site is plain files in your own repository.
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/site-section.json
  - $ref: ../components/path-card.json
  - $ref: ../components/fact-item.json
  - $ref: ../components/text-link.json
  - $ref: ../components/site-close.json
---

::::::section{style.padding="clamp(2rem, 4vw, 3.5rem) var(--gutter) clamp(2.5rem, 4vw, 4rem)" style.minHeight="calc(100svh - 4rem)" style.boxSizing="border-box" style.display="flex" style.alignItems="center"}
:::::div{style.width="100%" style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="5fr 7fr" style.gap="clamp(2rem, 4vw, 4rem)" style.alignItems="center" style.--lg.gridTemplateColumns="1fr"}
::::div
:::h1{style.fontSize="clamp(2.5rem, 5vw, 4.5rem)" style.fontWeight="var(--display-weight)" style.letterSpacing="-0.04em" style.lineHeight="1.02" style.margin="0" style.color="var(--color-text-primary)" style.textWrap="balance"}
Visual website builder that saves plain files
:::

:::p{style.fontSize="clamp(1.0625rem, 1.4vw, 1.25rem)" style.color="var(--color-text-secondary)" style.lineHeight="1.5" style.margin="1.5rem 0 2rem" style.maxWidth="42ch"}
Design pages on a canvas or describe them to the assistant. Jx writes JSON and Markdown to your own repository and builds static HTML from them.
:::

:::div{style.display="flex" style.gap="0.75rem" style.flexWrap="wrap"}
::cta-button{props.href="https://studio.jxsuite.com/" props.label="Start a free trial" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::

:::p{style.fontSize="0.875rem" style.color="var(--color-text-muted)" style.margin="1.25rem 0 0" style.lineHeight="1.5"}
Jx Cloud is $10 a month after a 30-day free trial. The desktop app is free.
:::
::::

::::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)"}
::img{style.display="block" style.width="100%" style.height="min(44rem, calc(100svh - 11rem))" style.minHeight="22rem" style.objectFit="cover" style.objectPosition="left top" style.--lg.height="auto" style.--lg.minHeight="0" style.--lg.aspectRatio="16 / 10" sizes="(max-width: 1024px) 92vw, 1130px" src="/content/docs/images/hero.png" width="3840" height="2400" alt="Jx Studio editing a real estate home page: the outline, the live canvas and the element inspector" loading="eager" decoding="async"}
::::
:::::
::::::

:::::site-section{id="run" props.heading="Two ways to run Studio" props.lead="The editor is the same in both, and so are the files. A project you start in one opens in the other."}
::::div{style.display="grid" style.gridTemplateColumns="1fr 1fr" style.gap="1.5rem" style.--md.gridTemplateColumns="1fr"}
::path-card{props.name="Jx Cloud" props.text="Studio in a browser tab, with nothing to install. Sign in with GitHub, open a repository, and edit it with other people at the same time." props.browser="true" props.bar="studio.jxsuite.com" props.from="GitHub repository" props.via="Jx Cloud" props.to="Cloudflare Pages" props.price="$10 a month per person, after a 30-day free trial" props.needs="A browser and a GitHub account" props.href="/cloud" props.linkLabel="See what Jx Cloud covers"}

::path-card{props.name="Jx Studio for desktop" props.text="The same editor for macOS, Windows and Linux. It works offline, on a folder on your own machine, and it never asks for an account." props.bar="Jx Studio" props.from="Folder on your disk" props.via="Jx Studio" props.to="Any static host" props.price="Free, under the MIT license" props.needs="macOS, Windows or Linux" props.href="/download" props.linkLabel="Download Studio for your system"}
::::
:::::

:::::site-section{id="studio" props.ground="alt" props.heading="The canvas edits the real page" props.lead="Studio draws your site with the runtime that ships it, so what you arrange is what a visitor gets."}
:::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)"}
::img{style.display="block" style.width="100%" style.height="auto" style.aspectRatio="16 / 7" style.objectFit="cover" style.objectPosition="top" sizes="(max-width: 1380px) 92vw, 1280px" src="/content/docs/images/mode-design.png" width="3840" height="2000" alt="Jx Studio's design view showing one page at three screen widths with the layout inspector open" loading="lazy" decoding="async"}
:::

::::div{style.display="grid" style.gridTemplateColumns="repeat(3, 1fr)" style.gap="2rem" style.marginTop="2.5rem" style.--md.gridTemplateColumns="1fr"}
::fact-item{props.title="Design on the canvas" props.text="Click any text and type. Set spacing, type and color in the inspector, and check the layout at phone and tablet widths."}

::fact-item{props.title="Describe a change" props.text="The assistant edits the same files you do, on an AI provider you connect. On Jx Cloud that is Workers AI on your Cloudflare account."}

::fact-item{props.title="Publish with git" props.text="Every publish is a commit with your note on it, so any earlier version of the site can come back."}
::::

:::div{style.marginTop="1.5rem"}
::text-link{props.href="/studio" props.label="See Studio's four workspaces"}
:::
:::::

:::::site-section{id="output" props.heading="Pages ship as static HTML" props.lead="Jx builds every page ahead of time. What reaches your host is a folder of finished files."}
::::div{style.display="grid" style.gridTemplateColumns="5fr 7fr" style.gap="clamp(2rem, 4vw, 4rem)" style.alignItems="start" style.--lg.gridTemplateColumns="1fr"}
:::div{style.display="flex" style.flexDirection="column" style.gap="1.75rem"}
::fact-item{props.title="No JavaScript on static pages" props.text="A page with nothing interactive on it ships as HTML and CSS only. Interactive parts load their own script and nothing else."}

::fact-item{props.title="No database by default" props.text="There is no admin login, database or plugin behind a static page, so there is nothing there to patch or break into."}

::fact-item{props.title="A server when you want one" props.text="Add the auth or data extension and the build writes one small worker beside the pages, for accounts and tables."}
:::

:::div{style.minWidth="0"}
```md
---
title: Tonight's menu
---

# Tonight's menu

Wood-fired mains, served from five.

::menu-list{props.course="mains"}
```

```html
<main>
  <h1>Tonight's menu</h1>
  <p>Wood-fired mains, served from five.</p>
  <menu-list data-jx-static>
    <ul>
      <li>Hearth-roasted chicken</li>
      <li>Charred leeks, brown butter</li>
    </ul>
  </menu-list>
</main>
```
:::
::::
:::::

:::::site-section{id="framework" props.ground="alt" props.heading="An open-source framework underneath" props.lead="Studio is one editor for the Jx framework. The compiler, the runtime and the command line work without it."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr"}
::fact-item{props.title="MIT licensed" props.text="The framework, the extensions and the desktop app are yours to fork, host and keep."}

::fact-item{props.title="Documents you can read" props.text="Pages, styles, state and server logic are serializable documents and Markdown, checked against a JSON Schema generated from the web platform."}

::fact-item{props.title="Standard reactivity" props.text="Interactive parts are the browser's own custom elements, made reactive by the published @vue/reactivity package."}

::fact-item{props.title="Three server adapters" props.text="A project with accounts or data builds for Cloudflare, Node or Bun. A project without them needs no server."}
::::

:::div{style.display="flex" style.flexWrap="wrap" style.gap="0.5rem 2rem" style.marginTop="1.5rem"}
::text-link{props.href="/framework" props.label="Read the framework guide"}

::text-link{props.href="https://github.com/jxsuite/jx" props.label="See the source on GitHub"}
:::
:::::

::site-close{props.heading="Jx Cloud is free for 30 days" props.text="Sign in with GitHub and open a starter site. The files land in your own repository, and they stay there whether or not you subscribe."}
