---
spec: compiler.md
level: minor
---

Cloudflare worker bundles keep bare Node builtins (tls, os, ...) external as node: imports, so packages that import them unprefixed (postgres 4) bundle
