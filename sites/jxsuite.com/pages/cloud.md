---
title: "Jx Cloud: Jx Studio in your browser"
$head:
  - tagName: meta
    attributes:
      name: description
      content: Jx Cloud is Jx Studio in a browser tab. Sign in with GitHub, edit a repository together, and publish to your own Cloudflare account. Free for 30 days.
  - tagName: meta
    attributes:
      property: og:title
      content: "Jx Cloud: a website builder for your GitHub repositories"
  - tagName: meta
    attributes:
      property: og:description
      content: Sign in with GitHub, edit together, and publish to your own Cloudflare account. Free for 30 days, then $10 a month per person.
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/site-section.json
  - $ref: ../components/fact-item.json
  - $ref: ../components/faq-item.json
  - $ref: ../components/plan-card.json
  - $ref: ../components/text-link.json
  - $ref: ../components/site-close.json
---

::::::section{style.padding="clamp(2rem, 4vw, 3.5rem) var(--gutter) clamp(2.5rem, 4vw, 4rem)" style.minHeight="calc(100svh - 4rem)" style.boxSizing="border-box" style.display="flex" style.alignItems="center"}
:::::div{style.width="100%" style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="5fr 7fr" style.gap="clamp(2rem, 4vw, 4rem)" style.alignItems="center" style.--lg.gridTemplateColumns="1fr"}
::::div
:::h1{style.fontSize="clamp(2.5rem, 5vw, 4.5rem)" style.fontWeight="var(--display-weight)" style.letterSpacing="-0.04em" style.lineHeight="1.02" style.margin="0" style.color="var(--color-text-primary)" style.textWrap="balance"}
Website builder for your GitHub repositories
:::

:::p{style.fontSize="clamp(1.0625rem, 1.4vw, 1.25rem)" style.color="var(--color-text-secondary)" style.lineHeight="1.5" style.margin="1.5rem 0 2rem" style.maxWidth="42ch"}
Jx Cloud is Jx Studio in a browser tab. Sign in with GitHub, open a repository, edit it with your team at the same time, and publish to your own Cloudflare account.
:::

:::div{style.display="flex" style.gap="0.75rem" style.flexWrap="wrap"}
::cta-button{props.href="https://studio.jxsuite.com/" props.label="Start a free trial" props.variant="primary"}

::cta-button{props.href="#price" props.label="See the price" props.variant="secondary"}
:::

:::p{style.fontSize="0.875rem" style.color="var(--color-text-muted)" style.margin="1.25rem 0 0" style.lineHeight="1.5"}
Free for 30 days, then $10 a month per person.
:::
::::

::::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)"}
::img{style.display="block" style.width="100%" style.height="min(44rem, calc(100svh - 11rem))" style.minHeight="22rem" style.objectFit="cover" style.objectPosition="left top" style.--lg.height="auto" style.--lg.minHeight="0" style.--lg.aspectRatio="16 / 10" sizes="(max-width: 1024px) 92vw, 1130px" src="/content/docs/images/collab-presence.png" width="3840" height="2400" alt="Jx Studio in a browser with two collaborators editing the same page" loading="eager" decoding="async"}
::::
:::::
::::::

:::::site-section{id="how" props.ground="alt" props.heading="What Jx Cloud does" props.lead="It is the editor you would download, opened at studio.jxsuite.com. Your accounts hold the project, the hosting and the AI."}
::::div{style.display="grid" style.gridTemplateColumns="1fr 1fr" style.gap="2rem clamp(2rem, 4vw, 4rem)" style.--md.gridTemplateColumns="1fr"}
::fact-item{props.title="Opens your GitHub repositories" props.text="A project is a repository, and every commit is written there with your own token. If you cannot write to it on GitHub, you cannot write to it here."}

::fact-item{props.title="Edits with your team, live" props.text="Everyone on a branch works in one shared copy and sees each change as it is made. Each commit is credited to the person who made it."}

::fact-item{props.title="Publishes to your Cloudflare account" props.text="Sites go to Cloudflare Pages on an account you control, as the same static HTML a desktop build produces."}

::fact-item{props.title="Runs the assistant with no key" props.text="The assistant uses Workers AI on that same Cloudflare account. Cloudflare bills you for what it runs, at its own rates."}
::::

:::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)" style.marginTop="2.5rem"}
::img{style.display="block" style.width="100%" style.height="auto" style.aspectRatio="16 / 7" style.objectFit="cover" style.objectPosition="top" sizes="(max-width: 1380px) 92vw, 1280px" src="/content/docs/images/git-panel.png" width="3840" height="1824" alt="Jx Studio's publish workspace listing changed files, their diff and the commit summary" loading="lazy" decoding="async"}
:::
:::::

:::::site-section{id="price" props.heading="One plan, $10 a month" props.lead="Jx Studio Cloud is priced per person and billed monthly through Stripe. Each GitHub account gets one free trial."}
::::div{style.display="grid" style.gridTemplateColumns="1fr 1fr" style.gap="1.5rem" style.alignItems="stretch" style.--md.gridTemplateColumns="1fr"}
:::plan-card{props.name="Jx Studio Cloud" props.price="$10 a month" props.text="Per person, after a 30-day free trial. Cancel any time from Preferences, Accounts."}
- Open and save GitHub projects in the browser editor
- Realtime collaboration on every branch
- Publishing through your own Cloudflare account
- The assistant, on Workers AI in that account

::cta-button{props.href="https://studio.jxsuite.com/" props.label="Start a free trial" props.variant="primary"}
:::

:::plan-card{props.name="Desktop and framework" props.price="Free" props.text="The open-source side of Jx is not a trial and has no paid tier."}
- Jx Studio for desktop, on macOS, Windows and Linux
- The framework, the command line and every extension
- 30 days of Jx Cloud for each pull request of yours merged into jxsuite/jx

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::
::::
:::::

:::::site-section{id="questions" props.ground="alt" props.heading="Questions about Jx Cloud" props.lead=""}
::::div{style.maxWidth="52rem" style.borderBottom="1px solid var(--color-border)"}
:::faq-item{props.question="Do I need a payment card to start the trial?"}
Usually not. Most accounts start the trial without one, and some are asked for one at checkout. If no card is on file when the 30 days end, the trial ends and nothing is charged.
:::

:::faq-item{props.question="Can I sign in without GitHub?"}
No. Jx Cloud signs you in with GitHub and opens GitHub repositories, and it has no other kind of account. The desktop app needs no account at all.
:::

:::faq-item{props.question="What does Jx Cloud keep of my project?"}
GitHub stays the copy of record. While a branch is open we hold a working copy of it, including changes you have not committed yet. The [privacy policy](/privacy) lists what is held and for how long.
:::

:::faq-item{props.question="Who pays for hosting and AI?"}
You do, to Cloudflare, on your own account. The subscription covers the editor, collaboration and the publishing and assistant connections. It does not cover Cloudflare's own charges.
:::

:::faq-item{props.question="Can a team share one subscription?"}
No. The plan is per person, and each collaborator needs their own.
:::

:::faq-item{props.question="What happens to my site if I cancel?"}
Nothing happens to the site. The files are in your GitHub repository and the published pages are on your Cloudflare account. The free desktop app opens the same project.
:::
::::

:::div{style.marginTop="1.5rem"}
::text-link{props.href="/terms" props.label="Read the subscription terms"}
:::
:::::

::site-close{props.heading="Jx Cloud is free for 30 days" props.text="Sign in with GitHub and open a repository or a starter site. Your files stay in your repository whether or not you subscribe."}
