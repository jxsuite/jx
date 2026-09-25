---
title: "Jx Cloud: Studio in your browser, in development"
$head:
  - tagName: meta
    attributes:
      name: description
      content: Jx Cloud is a hosted Jx Studio you open in a browser and sign in to
        with GitHub. It is in development. The free desktop app is the way in today.
  - tagName: meta
    attributes:
      property: og:title
      content: "Jx Cloud: the same Studio, without the install"
  - tagName: meta
    attributes:
      property: og:description
      content: In development. Sign in with GitHub, publish to your own Cloudflare
        account, and keep every file in a repository you already own.
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/section-label.json
---

:::::hero{style.padding="clamp(4.5rem, 10vw, 7rem) clamp(1rem, 3vw, 2rem) clamp(3rem, 6vw, 4rem)" style.textAlign="center" style.background="radial-gradient(ellipse 80% 50% at 50% -20%, rgba(59, 130, 246, 0.15), transparent)"}
::::div{style.maxWidth="760px" style.margin="0 auto"}
::section-label{props.text="In development"}

:::h1{style.fontSize="clamp(2.5rem, 6vw, 4rem)" style.fontWeight="700" style.letterSpacing="-0.04em" style.lineHeight="1.1" style.margin="0 0 1.25rem" style.color="var(--color-text-primary)"}
Jx Cloud
:::

:::p{style.fontSize="clamp(1.25rem, 2.5vw, 1.75rem)" style.color="var(--color-accent)" style.fontWeight="600" style.letterSpacing="-0.02em" style.lineHeight="1.3" style.margin="0 auto 1.5rem" style.maxWidth="620px"}
The same Studio, without the install.
:::

:::p{style.fontSize="clamp(1rem, 2vw, 1.125rem)" style.color="var(--color-text-secondary)" style.lineHeight="1.7" style.margin="0 auto 2.5rem" style.maxWidth="640px"}
We are building a version of Jx Studio that opens in a browser tab. Your projects are your GitHub repositories, publishing goes to your own Cloudflare account, and the assistant runs on that same account. It is not open to the public yet, so there is nothing to sign up for on this page.
:::

:::div{style.display="flex" style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap"}
::cta-button{props.href="mailto:hello@jxsuite.com?subject=Jx%20Cloud" props.label="Email us about Jx Cloud" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::
::::
:::::

::::::cards{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(300px, 100%), 1fr))" style.gap="1rem"}
::::div{style.padding="2rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-secondary)"}
:::h2{style.fontSize="1.25rem" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 1rem" style.color="var(--color-text-primary)"}
Sign in with GitHub
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
A project is a GitHub repository, and GitHub stays the copy of record: every commit is written straight there with your own token. While a branch is open we hold a working copy of it, including the changes you have not committed yet, and the privacy policy says exactly what that holds and for how long. Permissions stay GitHub's: if you cannot write a repository there, you cannot write it here, and revoking the app in your GitHub settings ends our access.
:::
::::

::::div{style.padding="2rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-secondary)"}
:::h2{style.fontSize="1.25rem" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 1rem" style.color="var(--color-text-primary)"}
Publish to your own Cloudflare account
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
Publishing goes to Cloudflare Pages on an account you create and control, so the hosting stays between you and Cloudflare. Disconnecting revokes that token at Cloudflare and deletes the record we held. What lands there is the same prerendered HTML a desktop build produces, so a site published from the browser and a site published from your laptop are the same site.
:::
::::

::::div{style.padding="2rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-secondary)"}
:::h2{style.fontSize="1.25rem" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 1rem" style.color="var(--color-text-primary)"}
AI on the same account, billed to you
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
The assistant runs Workers AI on that same Cloudflare account, so there is no key to paste. Inference bills to you at Cloudflare's rates, the same as anything else you run there. Prompts and responses pass through our service and are not retained by us; the provider that answers holds them under its own terms. Bring a different provider with your own key if you would rather.
:::
::::
:::::
::::::

::::::unchanged{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.textAlign="center" style.marginBottom="3rem"}
::section-label{props.text="Desktop, files, license"}

:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0"}
What does not change
:::
:::::

:::::div{style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="repeat(auto-fit, minmax(min(300px, 100%), 1fr))" style.gap="1rem"}
::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
Desktop Studio stays free
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
Jx Studio runs offline on macOS, Windows and Linux under the MIT license, with no account behind it. Its assistant talks to whatever provider you connect, using your own key. Nothing that works in it today moves behind a sign-in later.
:::
::::

::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
Files stay plain JSON and Markdown
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
The editor is a view onto files you already own. A Jx site is JSON and Markdown in your own repository, whether you edited it in a browser or on your desktop: read it, hand it to a developer, or stop using Jx entirely and still have every page you wrote.
:::
::::

::::div{style.padding="1.75rem" style.borderRadius="var(--radius-lg)" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-bg-surface)"}
:::h3{style.fontSize="1rem" style.fontWeight="700" style.margin="0 0 0.75rem" style.color="var(--color-text-primary)"}
The framework stays MIT
:::

:::p{style.fontSize="0.9375rem" style.lineHeight="1.7" style.color="var(--color-text-secondary)" style.margin="0"}
The compiler, the runtime, the CLI and the extensions are MIT licensed and stay that way. The framework has no seats to buy, no per-site fee, and no feature withheld for a paid tier. If Jx Cloud went away tomorrow, `jx build` on your own machine would still produce your site.
:::
::::
:::::
::::::

::::::status{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)"}
:::::div{style.maxWidth="720px" style.margin="0 auto"}
:::h2{style.fontSize="clamp(1.5rem, 3vw, 2.25rem)" style.fontWeight="700" style.letterSpacing="-0.02em" style.margin="0 0 1.25rem"}
Where Jx Cloud stands
:::

:::p{style.color="var(--color-text-secondary)" style.fontSize="1.0625rem" style.lineHeight="1.7" style.margin="0 0 1rem"}
Jx Cloud is in development. There is no launch date, no pricing, and no way to sign in yet, and this page will keep saying so until that changes. What exists today is the desktop app: the same editor, on your own machine, free and open source. Your projects are the same files either way, so a site you start this week is a site Jx Cloud can pick up later. If you want to hear when the hosted version opens, email us and say so.
:::

:::p{style.color="var(--color-text-muted)" style.fontSize="0.9375rem" style.lineHeight="1.7" style.margin="0"}
The hosted service is named the Jx Publishing Platform in our [privacy policy](/privacy), which sets out exactly what it holds and for how long.
:::
:::::
::::::

:::::bottom-cta{style.padding="clamp(4rem, 8vw, 6rem) clamp(1rem, 3vw, 2rem)" style.borderTop="1px solid var(--color-border)" style.textAlign="center" style.background="radial-gradient(ellipse 60% 50% at 50% 100%, rgba(59, 130, 246, 0.1), transparent)"}
::::div{style.maxWidth="640px" style.margin="0 auto"}
:::h2{style.fontSize="clamp(1.75rem, 4vw, 2.5rem)" style.fontWeight="700" style.letterSpacing="-0.03em" style.margin="0 0 1.25rem" style.lineHeight="1.15"}
The version that exists is on your desktop
:::

:::p{style.color="var(--color-text-secondary)" style.margin="0 0 2.5rem" style.fontSize="1.0625rem" style.lineHeight="1.7"}
Jx Cloud will open the projects you already have, so the useful thing to do now is make one. Download Studio, build a site, and keep the files in your own repository. Then tell us what you would want from a hosted Studio, while there is still time for it to change what gets built.
:::

:::div{style.display="flex" style.gap="0.75rem" style.justifyContent="center" style.flexWrap="wrap"}
::cta-button{props.href="mailto:hello@jxsuite.com?subject=Jx%20Cloud" props.label="Email us about Jx Cloud" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::
::::
:::::
