---
spec: site-architecture.md
level: minor
---

§5.5: $page describes the page and never its layout, so $page.title is the page's own title as its title element shows it, resolved in the build before a layout reads it, $page.description carries the page's description meta and $page.locale follows the page's own $lang; the live preview gives a dynamic page its concrete URL and named parameters; the $page.$head, $page.frontmatter and $site.$head rows are dropped because nothing reads them
