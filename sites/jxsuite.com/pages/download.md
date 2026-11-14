---
title: "Download Jx Studio for macOS, Windows or Linux"
$head:
  - tagName: meta
    attributes:
      name: description
      content: "Download Jx Studio for macOS, Windows or Linux. A free, open-source visual IDE that saves your site as plain files. Or install from the command line."
  - tagName: meta
    attributes:
      property: og:title
      content: "Download Jx Studio"
  - tagName: meta
    attributes:
      property: og:description
      content: "Free, open-source desktop app for macOS, Windows and Linux. Or install from the command line."
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

:::page-hero{props.heading="Download Jx Studio" props.lead="The desktop app is free and open source. It runs on your own machine, on a folder of plain files, and it needs no account."}
:::

:::::site-section{id="installers" props.ground="alt" props.heading="Installers for three systems" props.lead=""}
::::div{style.display="grid" style.gridTemplateColumns="repeat(3, 1fr)" style.gap="2rem" style.--md.gridTemplateColumns="1fr"}
:::fact-item{props.title="macOS" props.text="Signed and notarized. Apple Silicon, macOS 12 or later."}
::cta-button{props.href="https://github.com/jxsuite/jx/releases/latest/download/macos-arm64-JxStudio.dmg" props.label="Download for Apple Silicon" props.variant="primary" props.newTab="true"}
:::

:::fact-item{props.title="Windows" props.text="Unsigned installer, so Windows SmartScreen warns on first run. Windows 10 or later, x64."}
::cta-button{props.href="https://github.com/jxsuite/jx/releases/latest/download/win-x64-JxStudio-Setup.exe" props.label="Download for Windows" props.variant="primary" props.newTab="true"}
:::

:::fact-item{props.title="Linux" props.text="An AppImage: make it executable and run it. It runs on most current distributions."}
::cta-button{props.href="https://github.com/jxsuite/jx/releases/latest/download/linux-x86_64-JxStudio.AppImage" props.label="Download for x64" props.variant="primary" props.newTab="true"}

::cta-button{props.href="https://github.com/jxsuite/jx/releases/latest/download/linux-arm64-JxStudio.AppImage" props.label="Download for ARM64" props.variant="secondary" props.newTab="true"}
:::
::::

:::p{style.margin="2rem 0 0" style.maxWidth="62ch" style.fontSize="1rem" style.lineHeight="1.6" style.color="var(--color-text-secondary)"}
Checksums, older versions and every build are on the [GitHub releases page](https://github.com/jxsuite/jx/releases/latest). On NixOS the same app builds from source with `nix run github:jxsuite/jx/release`, as [the install guide](/docs/start/install) explains.
:::
:::::

:::::site-section{id="other" props.heading="Two ways to skip the installer" props.lead=""}
::::div{style.display="grid" style.gridTemplateColumns="1fr 1fr" style.gap="2rem clamp(2rem, 4vw, 4rem)" style.--md.gridTemplateColumns="1fr"}
:::fact-item{props.title="Jx Cloud, in a browser" props.text="The same editor at studio.jxsuite.com, with nothing to install. Sign in with GitHub. It is a subscription with a 30-day free trial."}
::text-link{props.href="/cloud" props.label="See what Jx Cloud covers"}
:::

:::fact-item{props.title="The command line" props.text="Scaffold a project and run it locally with live reload. Open the same folder in Studio whenever you want the visual editor."}
::text-link{props.href="/docs/start/first-project" props.label="Read the quickstart"}
:::
::::

:::div{style.marginTop="2rem" style.maxWidth="40rem"}
```bash
bun create @jxsuite my-site
cd my-site && bun run dev
```
:::
:::::
