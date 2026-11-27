---
spec: site-architecture.md
level: minor
---

§4.4 routes rank segment by segment, so a more specific dynamic route outranks a less specific one; when two pages generate one URL the route with priority builds it with a warning, and a tie between two pages of one shape fails the build.
