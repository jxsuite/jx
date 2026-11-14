---
title: "Jx Studio: a visual IDE for the web"
$head:
  - tagName: meta
    attributes:
      name: description
      content: "Jx Studio is a visual IDE for designing, editing and publishing websites. It saves plain JSON and Markdown, on your desktop or in a browser with Jx Cloud."
  - tagName: meta
    attributes:
      property: og:title
      content: "Jx Studio: a visual IDE for the web"
  - tagName: meta
    attributes:
      property: og:description
      content: "Design on a canvas, edit content in place, wire up logic and publish through git. Plain files, on desktop or in a browser."
  - tagName: meta
    attributes:
      property: og:type
      content: website
$elements:
  - $ref: ../components/cta-button.json
  - $ref: ../components/site-section.json
  - $ref: ../components/mode-card.json
  - $ref: ../components/fact-item.json
  - $ref: ../components/text-link.json
  - $ref: ../components/site-close.json
---

::::::section{style.padding="clamp(2rem, 4vw, 3.5rem) var(--gutter) clamp(2.5rem, 4vw, 4rem)" style.minHeight="calc(100svh - 4rem)" style.boxSizing="border-box" style.display="flex" style.alignItems="center"}
:::::div{style.width="100%" style.maxWidth="var(--max-width)" style.margin="0 auto" style.display="grid" style.gridTemplateColumns="5fr 7fr" style.gap="clamp(2rem, 4vw, 4rem)" style.alignItems="center" style.--lg.gridTemplateColumns="1fr"}
::::div
:::h1{style.fontSize="clamp(2.5rem, 5vw, 4.5rem)" style.fontWeight="var(--display-weight)" style.letterSpacing="-0.04em" style.lineHeight="1.02" style.margin="0" style.color="var(--color-text-primary)" style.textWrap="balance"}
Visual IDE for the people who build websites
:::

:::p{style.fontSize="clamp(1.0625rem, 1.4vw, 1.25rem)" style.color="var(--color-text-secondary)" style.lineHeight="1.5" style.margin="1.5rem 0 2rem" style.maxWidth="42ch"}
Create a project, design on a canvas, edit content in place, wire up interactivity and publish through git. Every change saves as plain JSON and Markdown.
:::

:::div{style.display="flex" style.gap="0.75rem" style.flexWrap="wrap"}
::cta-button{props.href="https://studio.jxsuite.com/" props.label="Start a free trial" props.variant="primary"}

::cta-button{props.href="/download" props.label="Download Studio" props.variant="secondary"}
:::

:::p{style.fontSize="0.875rem" style.color="var(--color-text-muted)" style.margin="1.25rem 0 0" style.lineHeight="1.5"}
Free on the desktop. In a browser tab with Jx Cloud.
:::
::::

::::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)"}
::img{style.display="block" style.width="100%" style.height="min(44rem, calc(100svh - 11rem))" style.minHeight="22rem" style.objectFit="cover" style.objectPosition="left top" style.--lg.height="auto" style.--lg.minHeight="0" style.--lg.aspectRatio="16 / 10" sizes="(max-width: 1024px) 92vw, 1130px" src="/content/docs/images/mode-edit.png" width="3840" height="2000" alt="Jx Studio with a cafe site open on the canvas beside its file tree" loading="eager" decoding="async"}
::::
:::::
::::::

:::::site-section{id="workspaces" props.ground="alt" props.heading="Four workspaces on the same files" props.lead="Move between them as the work changes. Each one reads and writes the same documents."}
::::div{style.display="grid" style.gridTemplateColumns="1fr 1fr" style.gap="1.5rem" style.--md.gridTemplateColumns="1fr"}
::mode-card{props.name="Manage" props.image="/content/docs/images/mode-manage.png" props.imageAlt="Jx Studio's file manager with live previews of every project file" props.description="Browse pages, components and content collections with a live preview of each. Create pages, upload media and define content types."}

::mode-card{props.name="Edit" props.image="/content/docs/images/mode-edit.png" props.imageAlt="Jx Studio editing page content in place on the canvas" props.description="Click any text and type. Slash commands insert blocks, and a form beside the page edits its fields. It saves as Markdown."}

::mode-card{props.name="Design" props.image="/content/docs/images/mode-design.png" props.imageAlt="Jx Studio's design canvas showing one component at several screen widths" props.description="A live canvas at every breakpoint, with an inspector for spacing, type, color, layout, hover states and design tokens."}

::mode-card{props.name="Script" props.image="/content/docs/images/mode-script.png" props.imageAlt="Jx Studio editing a component's state function in its code editor" props.description="State, data and events in structured panels, and a code editor for functions. One picker moves a fetch from the browser to the server."}
::::
:::::

:::::site-section{id="start" props.heading="A new project in one dialog" props.lead="Start from a starter site or an empty project. Studio scaffolds the files and opens them."}
::::div{style.display="grid" style.gridTemplateColumns="5fr 7fr" style.gap="clamp(2rem, 4vw, 4rem)" style.alignItems="start" style.--lg.gridTemplateColumns="1fr"}
:::div{style.display="flex" style.flexDirection="column" style.gap="1.75rem"}
::fact-item{props.title="Name it and place it" props.text="Give the project a name, a folder and its production URL."}

::fact-item{props.title="Pick where it deploys" props.text="Static hosting, Cloudflare, Node or Bun. You can change it later in the project file."}

::fact-item{props.title="Open what you already have" props.text="Open any Jx project from disk, or clone one from git. There is no import step."}

:::

:::div{style.minWidth="0"}
::img{style.display="block" style.width="100%" style.maxWidth="440px" style.height="auto" style.margin="0 auto" style.border="1px solid var(--color-border)" style.borderRadius="var(--radius-lg)" sizes="(max-width: 768px) 92vw, 440px" src="/content/docs/images/new-project-modal.png" width="1152" height="1796" alt="Jx Studio's New Project dialog: name, folder, production URL and deploy target" loading="lazy" decoding="async"}
:::
::::
:::::

:::::site-section{id="publish" props.ground="alt" props.heading="Publishing is a git commit" props.lead="Review what changed, write a note and publish. Your host builds the site on every push."}
:::div{style.borderRadius="var(--radius-lg)" style.overflow="hidden" style.border="1px solid var(--color-border)" style.backgroundColor="var(--color-inverse-bg)"}
::img{style.display="block" style.width="100%" style.height="auto" style.aspectRatio="16 / 7" style.objectFit="cover" style.objectPosition="top" sizes="(max-width: 1380px) 92vw, 1280px" src="/content/docs/images/git-panel.png" width="3840" height="1824" alt="Jx Studio's publish workspace: the changed files, their diff and the commit summary" loading="lazy" decoding="async"}
:::

::::div{style.display="grid" style.gridTemplateColumns="repeat(3, 1fr)" style.gap="2rem" style.--md.gridTemplateColumns="1fr" style.marginTop="2.5rem"}
::fact-item{props.title="Stage, diff, commit and branch" props.text="Source control is a workspace in Studio, so a change is reviewed where it was made."}

::fact-item{props.title="Create the repository from Studio" props.text="A new project gets its GitHub repository in one step."}

::fact-item{props.title="Roll back to any version" props.text="Every publish is in the history, with the note you wrote on it."}

::::
:::::

:::::site-section{id="files" props.heading="Your files stay readable" props.lead="Studio reads and writes the JSON and Markdown you would write by hand. Close it and the site is still there."}
::::div{style.display="grid" style.gridTemplateColumns="repeat(4, 1fr)" style.gap="2rem" style.--lg.gridTemplateColumns="1fr 1fr" style.--sm.gridTemplateColumns="1fr"}
::fact-item{props.title="No import step" props.text="Studio opens any Jx project straight from its folder."}

::fact-item{props.title="Standard formats" props.text="Pages and components are JSON. Content is Markdown."}

::fact-item{props.title="Offline on the desktop" props.text="The desktop app needs no network and no account."}

::fact-item{props.title="Clean diffs" props.text="A change to a page is a few changed lines, with no binary blobs."}

::::

:::div{style.marginTop="1.5rem"}
::text-link{props.href="/features" props.label="See every feature"}
:::
:::::

::site-close{props.heading="Open Studio in a browser or on your desktop" props.text="Jx Cloud is free for 30 days. The desktop app is free for good, and both open the same project."}
