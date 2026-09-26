---
title: "Jx: websites that are fast, safe, and cheap to run"
$head:
  - tagName: meta
    attributes:
      name: description
      content: Build it on a canvas, or describe it to Studio's assistant. By
        default pages ship as plain HTML from a CDN, with no database or admin panel
        behind them.
  - tagName: meta
    attributes:
      property: og:title
      content: "Jx: fast, safe websites you build visually"
  - tagName: meta
    attributes:
      property: og:description
      content: A free, open-source visual editor for websites. Design on a canvas,
        or describe what you want. Your site saves as plain files you keep forever.
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/mode-card.json
  - $ref: ../components/step-card.json
  - $ref: ../components/check-item.json
  - $ref: ../components/stat-card.json
  - $ref: ../components/pillar-card.json
  - $ref: ../components/section-label.json
---

:::::hero{style.padding="clamp(5rem, 12vw, 9rem) clamp(1rem, 3vw, 2rem) clamp(3rem, 6vw, 5rem)" style.textAlign="center" style.background="radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59, 130, 246, 0.15), transparent)"}
::::div{style.maxWidth="960px" style.margin="0 auto"}
:::div{style.display="inline-flex" style.alignItems="center" style.gap="0.5rem" style.padding="0.375rem 0.875rem" style.borderRadius="999px" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)" style.fontSize="0.8125rem" style.color="var(--color-text-secondary)" style.marginBottom="2rem"}
::span{style.width="6px" style.height="6px" style.borderRadius="50%" style.backgroundColor="#22c55e" style.display="inline-block"}

Free · Open source · macOS, Windows & Linux
:::

:::h1{style.fontSize="clamp(2.25rem, 4.6vw, 3.375rem)" style.fontWeight="700" style.letterSpacing="-0.035em" style.lineHeight="1.1" style.margin="0 0 1.5rem" style.color="var(--color-text-primary)"}
Websites that load fast, stay safe,\
:span[and cost almost nothing to run.]{style.color="var(--color-accent)"}
:::

:::p{style.fontSize="clamp(1.0625rem, 2vw, 1.3125rem)" style.color="var(--color-text-secondary)" style.lineHeight="1.7" style.margin="0 auto 1rem" style.maxWidth="680px"}
Jx builds your site into plain HTML pages and serves them from a CDN close to whoever is reading. By default nothing sits behind those pages: no database, no admin panel, no plugins waiting to be updated.
:::

:::p{style.fontSize="1rem" style.color="var(--color-text-muted)" style.margin="0 auto 2.5rem" style.maxWidth="600px" style.fontFamily="var(--font-mono)" style.letterSpacing="0.02em"}
Draw it on a canvas, or describe it in a sentence. Both write the same files.
:::

:::div{style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap" style.marginBottom="0.75rem"}
::cta-button{props.href="/download" props.label="Download Studio" props.variant="primary"}

::cta-button{props.href="/templates" props.label="Start from a template" props.variant="secondary"}
:::

:::p{style.fontSize="0.8125rem" style.color="var(--color-text-muted)" style.margin="0 0 3rem"}
MIT licensed. No account to create, and Studio keeps working offline.
:::

:::div{style.maxWidth="960px" style.margin="0 auto"}
::img{style.display="block" style.width="100%" style.height="auto" style.boxSizing="border-box" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.boxShadow="0 24px 64px rgba(0, 0, 0, 0.45)" src="/content/docs/images/hero.png" width="3840" height="2400" alt="Jx Studio editing a website: layers panel, live canvas, and element inspector" loading="eager" decoding="async"}
:::
::::
:::::

::::::advantages{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto"}
::::div{style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="What that buys you"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Speed, safety, and price stop competing.
:::

:::p{style.color="var(--color-text-secondary)" style.maxWidth="640px" style.margin="0 auto" style.fontSize="1.0625rem" style.lineHeight="1.7"}
With most website tools those three trade against each other: the builder that is easiest to use is the slowest to load, and the site that is cheapest to host is the one nobody is maintaining. A finished page sitting on a CDN settles all three in one move.
:::
::::

:::div{style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(280px, 100%), 1fr))" style.gap="1rem"}
::pillar-card{props.icon="⚡" props.title="Fast for everyone" props.description="Every page is built ahead of time and served as finished HTML from a CDN near your visitor. Static pages carry no JavaScript at all, so there is nothing to download and run before the words appear. That gap is widest on an old phone and a weak signal." props.features="Built ahead of time · No JavaScript on static pages · Served from a CDN · Images sized for every screen"}

::pillar-card{props.icon="🔒" props.title="Safe while you sleep" props.description="The attacks that take down small websites go after the login page, the database, and the plugin nobody updated. A Jx site ships with none of the three: a visitor asks for a page and gets a file, and that is the whole transaction." props.features="No admin login · No database by default · No plugins to update · Accounts and data when you want them"}

::pillar-card{props.icon="🪙" props.title="Cheap to keep online" props.description="Static files fit inside the free tier of most hosts, and nothing on the Jx side charges by the seat, the month, or the page view. For a small site, the domain name is usually the whole bill. Hosting prices are your host's to set, so check theirs before you plan around them." props.features="MIT licensed · No seats, no subscription · Fits most free hosting tiers · Your host, your account"}
:::

:::p{style.color="var(--color-text-muted)" style.fontSize="0.9375rem" style.lineHeight="1.7" style.maxWidth="760px" style.margin="2rem auto 0" style.textAlign="center"}
One exception, and it is the useful one: add the auth or connector extensions and the build puts one small server program beside the pages, so your visitors can have accounts and your site can have a database. The pages themselves are still built ahead of time.
:::
:::::
::::::

::::::studio-capabilities{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto"}
::::div{style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="Two ways to build"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Design it on a canvas. Or just describe it.
:::

:::p{style.color="var(--color-text-secondary)" style.maxWidth="680px" style.margin="0 auto" style.fontSize="1.0625rem" style.lineHeight="1.7"}
Studio is a free desktop app with four places to work on the same site. Move a headline, rewrite a paragraph, pick a color. The assistant sits in the same window and runs on an AI provider you connect yourself: Studio ships no account and no model of its own, and sends nothing anywhere until you connect one.
:::
::::

:::div{style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(420px, 100%), 1fr))" style.gap="1.5rem"}
::mode-card{props.name="Manage" props.image="/content/docs/images/mode-manage.png" props.imageAlt="Jx Studio Manage Files modal with live previews of every project file" props.description="Every page, post, and image in one window, each with a preview, so you can add, rename, and organize without digging through folders."}

::mode-card{props.name="Edit" props.image="/content/docs/images/mode-edit.png" props.imageAlt="Jx Studio editing markdown content inline with a WYSIWYG editor" props.description="Click any text on the page and type, the way you would in a document, and it saves as clean Markdown."}

::mode-card{props.name="Design" props.image="/content/docs/images/mode-design.png" props.imageAlt="Jx Studio design canvas showing one component across four responsive breakpoints with a style inspector" props.description="Move things, size them, and set the colors and type on a live canvas, then see how it looks on a phone before anyone else does."}

::mode-card{props.name="Script" props.image="/content/docs/images/mode-script.png" props.imageAlt="Jx Studio editing a component state function in the Monaco code editor" props.description="Make things happen when someone clicks: a menu that opens, a form that sends, and a list that fills itself from real data when your site needs it."}
:::

::::div{style.textAlign="center" style.marginTop="2.5rem"}
:::a{style.color="var(--color-accent)" style.textDecoration="none" style.fontWeight="600" style.fontSize="1rem" href="/studio"}
Take the full tour of Studio →
:::
::::
:::::
::::::

::::::templates{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)" style.textAlign="center"}
:::::div{style.maxWidth="680px" style.margin="0 auto"}
::section-label{props.text="Templates"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Pick a site that already looks like yours.
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0 0 2rem"}
Every template is a finished site for a real kind of business: a restaurant with a menu, a shop, a portfolio, a conference. Open one in Studio, change the words and the pictures, and it is yours. The structure is already decided.
:::

::cta-button{props.href="/templates" props.label="Browse the templates" props.variant="secondary"}
:::::
::::::

::::::workflow{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto"}
::::div{style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="Publishing"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Three steps, and the last one is automatic.
:::
::::

:::div{style.display="grid" style.gridTemplateColumns="repeat(3, 1fr)" style.gap="2rem" style.--md.gridTemplateColumns="1fr"}
::step-card{props.number="1" props.title="Author" props.description="Open a template or an empty project and make it yours: write the words, place the pictures, choose the colors. Every change is written to ordinary files in a folder you can see."}

::step-card{props.number="2" props.title="Publish" props.description="When it looks right, send the changes from Studio in one action, with a short note about what you did. Every send is kept, so an earlier version of the site is always there to go back to."}

::step-card{props.number="3" props.title="Live" props.description="Your host picks it up, builds the site, and puts it on a CDN around the world. Nothing to upload by hand, and nothing to remember next time."}
:::
:::::
::::::

::::::files{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="1fr 1fr" style.gap="clamp(3rem, 6vw, 5rem)" style.alignItems="center" style.--md.gridTemplateColumns="1fr"}
::::div
::section-label{props.text="No lock-in"}

:::h2{style.fontSize="clamp(1.5rem, 3vw, 2.25rem)" style.fontWeight="700" style.letterSpacing="-0.02em" style.lineHeight="1.2" style.margin="0 0 1rem"}
Your site is a folder, not an account.
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0"}
Jx writes ordinary text files into a folder on your computer: your pages, your writing, your pictures. Nothing is kept in a shape that needs Jx to open it, so leaving is a copy rather than an export.
:::
::::

:::div{style.display="flex" style.flexDirection="column" style.gap="0.75rem"}
::check-item{props.text="Pages and posts are plain text you can open in any editor"}

::check-item{props.text="The whole site lives in one folder on your computer"}

::check-item{props.text="Studio runs on your own machine, offline, with no Jx account"}

::check-item{props.text="Every change is recorded, so you can go back to any version"}
:::
:::::
::::::

:::::stats{style.padding="clamp(3rem, 6vw, 4rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
::::div{style.maxWidth="var(--max-width)" style.margin="0 auto"}
:::div{style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" style.gap="1rem"}
::stat-card{props.value="0kb" props.label="JavaScript on static pages, by default"}

::stat-card{props.value="$0" props.label="License cost: MIT, no subscription"}

::stat-card{props.value="MIT" props.label="Yours to fork, self-host, and keep"}

::stat-card{props.value="1" props.label="Folder holds your whole website"}
:::
::::
:::::

::::::cloud{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)" style.textAlign="center"}
:::::div{style.maxWidth="720px" style.margin="0 auto"}
::section-label{props.text="Coming soon"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
The same Studio, in a browser tab.
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0 0 1rem"}
Jx Cloud is a hosted Studio, in development now: you sign in with GitHub, and your projects are GitHub repositories, so your repository stays the copy of record and your permissions stay GitHub's. Publishing goes to your own Cloudflare account, and the assistant runs Workers AI on that same account, billed to you.
:::

:::p{style.color="var(--color-text-muted)" style.fontSize="0.9375rem" style.lineHeight="1.7" style.margin="0 0 2rem"}
The desktop app stays free, open source, and offline, and it is the way in today.
:::

::cta-button{props.href="/cloud" props.label="See what Jx Cloud will do" props.variant="secondary"}
:::::
::::::

::::::developers{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)" style.textAlign="center"}
:::::div{style.maxWidth="760px" style.margin="0 auto"}
::section-label{props.text="For developers"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1rem"}
Underneath, it is a framework you can read.
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0 0 2rem"}
Pages, styles, state, data, and server logic are declarative JSON and Markdown documents, validated against a JSON Schema generated from the live web platform, so the file you edit is the file the compiler reads. Reactivity is `@vue/reactivity`, routes come from the filesystem, and the whole project compiles to static HTML, with adapters for Cloudflare, Node, and Bun when you need a server.
:::

:::div{style.display="flex" style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap"}
::cta-button{props.href="/framework" props.label="See the framework" props.variant="primary"}

::cta-button{props.href="https://github.com/jxsuite/jx" props.label="View on GitHub" props.variant="secondary" props.newTab="true"}
:::
:::::
::::::

:::::bottom-cta{style.padding="clamp(5rem, 10vw, 8rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)" style.textAlign="center" style.background="radial-gradient(ellipse 60% 50% at 50% 100%, rgba(59, 130, 246, 0.1), transparent)"}
::::div{style.maxWidth="640px" style.margin="0 auto"}
:::h2{style.fontSize="clamp(2rem, 4vw, 3rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1.5rem" style.lineHeight="1.1"}
Start today.\
:span[Own it in ten years.]{style.color="var(--color-accent)"}
:::

:::p{style.color="var(--color-text-secondary)" style.margin="0 0 2.5rem" style.fontSize="1.0625rem" style.lineHeight="1.7"}
Studio is free to download, with nothing to sign up for, subscribe to, or wait for approval on. Pick a template, or start from an empty page.
:::

:::div{style.display="flex" style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap"}
::cta-button{props.href="/download" props.label="Download Studio" props.variant="primary"}

::cta-button{props.href="/compare" props.label="See how it compares" props.variant="secondary"}
:::
::::
:::::
