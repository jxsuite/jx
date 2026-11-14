---
spec: site-architecture.md
level: minor
---

§10.7, §14.1 and §14.2 describe the build output that ships: a page inlines the CSS of every light-DOM component it uses after its own styles, a shadow component links its sheet from inside its declarative shadow root and stands outside the page cascade, and _redirects is written whenever redirects has a rule, under every adapter and with none.
