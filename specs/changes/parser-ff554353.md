---
spec: parser.md
level: minor
---

§9: a lazily requested `content` section loads each collection on first use with frontmatter only, and parses an entry's body only when it is returned (`ContentStore`; `Markdown.load` `deferBody`, §3); §9.6: on-demand link reporting
