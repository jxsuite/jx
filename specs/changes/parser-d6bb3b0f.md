---
spec: parser.md
level: minor
---

Roundtrip serialization writes an element as markdown only when markdown can say all of it: attributes markdown cannot spell, block-level images and tables GFM cannot read back stay directives, and frontmatter is written unfolded with YAML 1.1 quoting.
